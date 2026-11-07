#!/usr/bin/env node
// 匯入 OpenFOAM 結果：node import-results.mjs <案例資料夾> [--out <檔案.cfdpack>] [--time <時間>] [--quiet]
// 讀 cfd-case.json（產生器寫的座標轉換與參考值）與 postProcessing/：
//   surfaces/<時間>/*.vtk（切面、patch 面；舊版的「欄位_面名.vtk」會自動合併）
//   streamLines/<時間>/*.vtk 或 sets/streamLines/<時間>/*.vtk（流線）
//   forces_<名稱>/<起始時間>/force.dat 或 forces.dat、probes/<起始時間>/{p,U}、yPlus/…/yPlus.dat、residuals/…/solverInfo.dat
// 輸出單一 .cfdpack（預設 <案例資料夾>/results.cfdpack），網頁用 lib/pack.js 的 loadPack 讀。
// 只讀 OpenFOAM 的輸出檔，不呼叫 OpenFOAM。
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVtk } from '../../core/cfd/vtk.js';
import { parseDat, forcesSeries, mergeSeries, parseProbes, residualSeries, yPlusSummary } from '../../core/cfd/dat.js';
import { buildPack } from '../../core/cfd/pack.js';

const isTime = s => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s);
const timeDirs = dir => (existsSync(dir) ? readdirSync(dir).filter(d => isTime(d) && statSync(join(dir, d)).isDirectory()).sort((a, b) => Number(a) - Number(b)) : []);

function pickTime(dir, want) {
  const ts = timeDirs(dir);
  if (!ts.length) return null;
  if (want === undefined || want === 'latest') return ts.at(-1);
  const t = ts.find(x => Number(x) === Number(want));
  if (!t) throw new Error(`${dir} 沒有時間 ${want}（有 ${ts.join(', ')}）`);
  return t;
}

// 同一個面拆成多個欄位檔時合併欄位（幾何以第一個檔為準，點數與 cell 數要相同）
function mergeVtk(list) {
  const base = list[0];
  for (const v of list.slice(1)) {
    if (v.nPoints !== base.nPoints || v.nCells !== base.nCells) throw new Error('同一個面的欄位檔幾何不同，無法合併');
    Object.assign(base.pointData, v.pointData); Object.assign(base.cellData, v.cellData);
  }
  return base;
}

export function importCase(caseDir, { time } = {}) {
  const meta = JSON.parse(readFileSync(join(caseDir, 'cfd-case.json'), 'utf8'));
  const pp = join(caseDir, 'postProcessing');
  if (!existsSync(pp)) throw new Error(`${pp} 不存在：案例還沒跑，或結果沒有複製回來`);
  const sources = [];
  const read = p => { const b = readFileSync(p); sources.push({ path: relative(caseDir, p).replace(/\\/g, '/'), bytes: b.length }); return b; };
  const notes = [];

  // ---- 切面與 patch 面
  const sliceNames = new Set(meta.sampling.slices.map(s => s.name));
  const patchNames = new Set(meta.sampling.patches);
  const surfaces = [];
  const sDir = join(pp, 'surfaces');
  const sTime = pickTime(sDir, time);
  if (sTime) {
    const groups = new Map();
    for (const f of readdirSync(join(sDir, sTime)).filter(f => f.endsWith('.vtk')).sort()) {
      const stem = f.slice(0, -4);
      let surf = stem;
      if (!sliceNames.has(stem) && !patchNames.has(stem)) {
        const m = /^[^_]+_(.+)$/.exec(stem); // 舊版：p_plan.vtk、U_plan.vtk
        if (m && (sliceNames.has(m[1]) || patchNames.has(m[1]))) surf = m[1];
      }
      if (!groups.has(surf)) groups.set(surf, []);
      groups.get(surf).push(parseVtk(read(join(sDir, sTime, f))));
    }
    for (const f of readdirSync(join(sDir, sTime)).filter(f => /\.vt[pu]$/.test(f))) notes.push(`略過 XML 格式 ${f}：controlDict 的 formatOptions 要 legacy true`);
    for (const [name, list] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const kind = patchNames.has(name) ? 'patch' : 'slice';
      surfaces.push({ name, kind, obstacle: kind === 'patch' ? name.replace(/^patch_/, '') : null, vtk: mergeVtk(list) });
    }
  } else notes.push('沒有 surfaces 結果');

  // ---- 流線
  const lines = [];
  for (const d of [join(pp, 'streamLines'), join(pp, 'sets', 'streamLines')]) {
    const t = pickTime(d, time);
    if (!t) continue;
    const vtks = readdirSync(join(d, t)).filter(f => f.endsWith('.vtk')).sort().map(f => ({ f, v: parseVtk(read(join(d, t, f))) }));
    // 同一組軌跡拆成多個欄位檔時合併
    const byShape = new Map();
    for (const { f, v } of vtks) {
      const key = `${v.nPoints}:${v.lines?.count || 0}`;
      if (byShape.has(key)) mergeVtk([byShape.get(key).v, v]); else byShape.set(key, { f, v });
    }
    for (const { f, v } of byShape.values()) lines.push({ name: f.replace(/\.vtk$/, ''), vtk: v });
    break;
  }

  // ---- 力
  const forces = [];
  for (const fo of meta.sampling.forces) {
    const d = join(pp, fo);
    const parts = [];
    for (const t of timeDirs(d)) {
      const f = ['force.dat', 'forces.dat'].map(n => join(d, t, n)).find(existsSync);
      if (f) parts.push(forcesSeries(parseDat(read(f).toString('utf8'))));
    }
    if (parts.length) forces.push({ obstacle: fo.replace(/^forces_/, ''), series: mergeSeries(parts) });
    else notes.push(`沒有 ${fo} 結果`);
  }

  // ---- 探針（多個起始時間依序接起來）
  let probes = null;
  const pd = join(pp, 'probes');
  for (const t of timeDirs(pd)) {
    for (const field of ['p', 'U']) {
      const f = join(pd, t, field);
      if (!existsSync(f)) continue;
      const pr = parseProbes(read(f).toString('utf8'));
      probes ??= {};
      if (!probes[field]) probes[field] = pr;
      else { probes[field].time.push(...pr.time); probes[field].values.push(...pr.values); }
    }
  }

  // ---- y+ 與殘差（取最後一個起始時間）
  let yPlus = null, residuals = null;
  const yd = join(pp, 'yPlus'), yt = timeDirs(yd).at(-1);
  if (yt && existsSync(join(yd, yt, 'yPlus.dat'))) yPlus = yPlusSummary(parseDat(read(join(yd, yt, 'yPlus.dat')).toString('utf8')));
  for (const name of ['residuals', 'solverInfo']) {
    const rd = join(pp, name), rt = timeDirs(rd).at(-1);
    if (rt && existsSync(join(rd, rt, 'solverInfo.dat'))) {
      const r = residualSeries(parseDat(read(join(rd, rt, 'solverInfo.dat')).toString('utf8')));
      // 縮到最多 200 點（等距抽樣＋最後一點），決定性
      const n = r.time.length, step = Math.max(1, Math.ceil(n / 200));
      const idx = [...Array(n).keys()].filter(i => i % step === 0 || i === n - 1);
      residuals = { time: idx.map(i => r.time[i]), fields: Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, idx.map(i => v[i])])), final: Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.at(-1)])) };
      break;
    }
  }

  const synthetic = existsSync(join(pp, 'SYNTHETIC.txt'));
  if (synthetic) notes.push('postProcessing 是測試用的假資料（SYNTHETIC.txt）');
  const bytes = buildPack({ meta, surfaces, lines, forces, probes, yPlus, residuals, time: sTime ? Number(sTime) : null, sources, synthetic });
  return { bytes, meta, notes, counts: { surfaces: surfaces.length, lines: lines.length, forces: forces.length, probes: probes ? Object.keys(probes).length : 0 } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const caseDir = args.find((a, i) => !a.startsWith('--') && !['--out', '--time'].includes(args[i - 1]));
  if (!caseDir) { console.error('用法：node import-results.mjs <案例資料夾> [--out <檔案.cfdpack>] [--time <時間>] [--quiet]'); process.exit(2); }
  try {
    const { bytes, notes, counts } = importCase(caseDir, { time: opt('--time') });
    const out = resolve(opt('--out') || join(caseDir, 'results.cfdpack'));
    writeFileSync(out, bytes);
    if (!args.includes('--quiet')) {
      console.log(`${basename(out)}：${(bytes.length / 1024).toFixed(1)} KB（面 ${counts.surfaces}、流線組 ${counts.lines}、力 ${counts.forces}、探針欄位 ${counts.probes}）`);
      for (const n of notes) console.log(`注意：${n}`);
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
