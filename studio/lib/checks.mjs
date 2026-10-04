// 品質檢查：由 app 自己執行工作區 core 的 check.mjs（不採信代理自己回報的「已通過」），整理失敗摘要回送代理。
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths, projectPaths } from './workspace.mjs';
import { compareFingerprints } from '../../core/verify/fingerprint-compare.mjs';
import { run, readJson, freePort } from './util.mjs';

// check.mjs 的輸出：「✗ <專案> · <項目>  <說明>  (1.2 s)」後面接 5 格縮排的細節
const ROW = /^([✓✗]) (.+?) · (.+?)  (.*?)\s*\(([\d.]+) s\)$/;

export function parseCheckOutput(out) {
  const rows = [];
  for (const l of out.split(/\r?\n/)) {
    const m = ROW.exec(l);
    if (m) { rows.push({ ok: m[1] === '✓', project: m[2], check: m[3], note: m[4].trim(), seconds: +m[5], detail: [] }); continue; }
    if (rows.length && /^ {5}/.test(l)) rows.at(-1).detail.push(l.slice(5));
  }
  return rows;
}

export async function runChecks(ws, id, { quick = true } = {}) {
  const P = paths(ws), J = projectPaths(ws, id), port = await freePort();
  const args = [join(P.core, 'tools', 'check.mjs'), id, ...(quick ? ['--quick'] : [])];
  const t0 = Date.now();
  const r = await run(process.execPath, args, { cwd: ws, env: { UI_PORT: String(port) } });
  const rows = parseCheckOutput(r.out);
  const saved = readJson(join(J.temp, quick ? 'check-quick.json' : 'check-full.json'), null);
  // 輸出解析不到任何項目（例如 project.js 語法錯誤讓 check.mjs 直接崩潰）也算失敗
  const failures = rows.filter(x => !x.ok);
  if (r.code && !failures.length) failures.push({ ok: false, project: id, check: 'check.mjs', note: `exit ${r.code}`, detail: r.out.trim().split('\n').slice(-20) });
  return { ok: r.code === 0 && rows.length > 0, quick, rows, failures, saved, seconds: +((Date.now() - t0) / 1000).toFixed(1), out: r.out };
}

export function failureSummary(c) {
  if (c.ok) return `${c.quick ? '快速' : '完整'}檢查全部通過（${c.rows.length} 項）。`;
  return [`${c.quick ? '快速' : '完整'}檢查有 ${c.failures.length} 項失敗（共 ${c.rows.length || '?'} 項）：`,
    ...c.failures.map(f => [`- **${f.check}**：${f.note}`, ...f.detail.slice(0, 25).map(d => `    ${d}`)].join('\n'))].join('\n');
}

// 排程指紋（含 layoutChecks 結果）：core/verify/run.mjs fingerprint 印出的一行 JSON；多情境時取全部情境
export async function runFingerprint(ws, id) {
  const P = paths(ws), J = projectPaths(ws, id);
  const r = await run(process.execPath, ['--no-warnings', '--import', pathToFileURL(join(P.core, 'tools', 'register.mjs')).href, join(P.core, 'verify', 'run.mjs'), 'fingerprint'], { cwd: J.dir });
  const line = r.out.split(/\r?\n/).find(l => l.startsWith('FINGERPRINT '));
  if (!line) return { ok: false, error: r.out.trim().split('\n').slice(-8).join('\n') };
  const j = JSON.parse(line.slice(12));
  return { ok: true, variants: j.variants || [{ variant: '預設', ...j }] };
}

export function compareRenderFingerprint(base, now) {
  if (!now.ok) return [`排程指紋無法產生：${now.error}`];
  const fails = [];
  for (const b of base.variants) {
    const n = now.variants.find(x => x.variant === b.variant);
    if (!n) { fails.push(`情境 ${b.variant} 不見了`); continue; }
    const tag = base.variants.length > 1 ? `［${b.variant}］` : '';
    fails.push(...compareFingerprints(b, n).diffs.map(d => tag + d));
    if (JSON.stringify(b.layout) !== JSON.stringify(n.layout)) {
      const changed = b.layout.filter((x, i) => JSON.stringify(x) !== JSON.stringify(n.layout[i])).map(x => x[1]);
      fails.push(`${tag}空間檢核結果改變：${changed.join('、') || `項目數 ${b.layout.length} → ${n.layout.length}`}`);
    }
  }
  return fails;
}

// 效能：core/tools/perf-check.mjs（各視角 renderer.info、手機直向幀率）
export async function runPerf(ws, id, outFile) {
  const P = paths(ws), port = await freePort();
  const r = await run(process.execPath, [join(P.core, 'tools', 'perf-check.mjs'), id, '--port', String(port), '--out', outFile], { cwd: ws });
  const line = r.out.split(/\r?\n/).find(l => l.startsWith('PERF '));
  return line ? JSON.parse(line.slice(5)) : { errors: [r.out.trim().split('\n').slice(-5).join('\n')] };
}

// 預算：三角面 ≤ base × trianglesRatio、draw call ≤ base × drawCallsRatio、手機幀率 ≥ base × 0.8（絕對值低於 phoneMinFps 只提示）
export function comparePerf(base, now, budget = {}) {
  const { trianglesRatio = 1.5, drawCallsRatio = 1.3, phoneMinFps = 30 } = budget, fails = [], notes = [];
  if (!now?.max) return { fails: [`效能量測失敗：${(now?.errors || []).join('；')}`], notes };
  const ratio = (k, lim, label) => { const b = base.max[k] || 1, r = now.max[k] / b; if (r > lim) fails.push(`${label} ${base.max[k]} → ${now.max[k]}（${r.toFixed(2)} 倍，上限 ${lim} 倍）`); };
  ratio('triangles', trianglesRatio, '三角面數');
  ratio('calls', drawCallsRatio, 'draw call');
  if (base.phoneFps && now.phoneFps != null && now.phoneFps < base.phoneFps * .8) fails.push(`手機幀率 ${base.phoneFps} → ${now.phoneFps} fps（低於補強前的 80%）`);
  if (now.phoneFps != null && now.phoneFps < phoneMinFps) notes.push(`手機幀率 ${now.phoneFps} fps 低於 ${phoneMinFps} fps（無頭瀏覽器＋CPU 降速 4 倍的量測，只供參考）`);
  return { fails, notes };
}

export async function takeShots(ws, id, outDir) {
  const P = paths(ws), port = await freePort();
  const r = await run(process.execPath, [join(P.core, 'tools', 'shots.mjs'), id, '--out', outDir, '--port', String(port)], { cwd: ws });
  return { ok: r.code === 0, out: r.out, dir: outDir };
}
