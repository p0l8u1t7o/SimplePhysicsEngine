// 品質檢查：由 app 自己執行工作區 core 的 check.mjs（不採信代理自己回報的「已通過」），整理失敗摘要回送代理。
import { join } from 'node:path';
import { paths, projectPaths } from './workspace.mjs';
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

export async function takeShots(ws, id, outDir) {
  const P = paths(ws), port = await freePort();
  const r = await run(process.execPath, [join(P.core, 'tools', 'shots.mjs'), id, '--out', outDir, '--port', String(port)], { cwd: ws });
  return { ok: r.code === 0, out: r.out, dir: outDir };
}
