// 統一檢查：依各專案 project.json 的 checks 設定執行，所有專案用同一套流程。
//   node core/tools/check.mjs [專案…] [--quick] [--only 名稱,…]
// --quick：部署前的快速檢查（GitHub Actions 使用）；不加則跑完整檢查。
//
// project.json：
//   "checks": {
//     "quick": ["tools/verify.mjs"],                      // 快速＋完整都跑
//     "full":  ["tools/verify-scene.mjs --dt=0.5", …]     // 只在完整檢查跑
//   }
// core 本身：models（core/models 每個模型走完狀態範圍的干涉與重合面，快速）、examples（core/examples/segment2 第二段範例的電控與配線檢查，快速）。
// core 內建檢查（每個專案都跑；後三項需要 web/js/project.js）：
//   imports      靜態 import 路徑（快速）
//   determinism  倒序／跳播一致（快速）
//   layout       project.layoutChecks() 空間檢核（快速）
//   scene        全場動態／靜態干涉＋重合面閃爍（快速）
//   electrical   電控元件在櫃內、不重疊、櫃內連線、穿板孔；project.verify.cables 宣告時另做配線動態取樣（快速；沒有電控就略過）
//   names        不得出現用戶名稱（本機名單 .private/client-names.txt 或工作區 .studio/client-names.txt；沒有名單就略過，快速）
//   ui           標準互動測試：桌面／手機直向／手機橫向／觸控平板的播放列、選單、側欄、標籤與版面（ui-check.mjs，只在完整檢查）
// project.json 的 "core" 可覆寫：{ "skip": ["scene"], "quick": ["scene"] }
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pickProjects, REPO, CORE, WORKSPACE } from './projects.mjs';
import { runScript } from './run.mjs';
import { checkProject as checkImports } from './check-imports.mjs';
import { scanDirs, clientNames } from './check-names.mjs';

const argv = process.argv.slice(2), quick = argv.includes('--quick');
const only = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv.splice(i, 2)[1].split(',') : null; })();
const projects = pickProjects(argv.filter(a => !a.startsWith('--')));
const RUN = join(CORE, 'verify', 'run.mjs');
const viaRunner = (check, args = []) => async p => {
  const r = await runScript(p, RUN, [check, ...args], { echo: false });
  const lines = r.out.trim().split('\n');
  // 每個情境一行摘要（scene 的 JSON、determinism 的「一致」、layout 的「通過」）
  const summary = lines.filter(l => /^(\[[^\]]+\] )?(\{|一致|不一致|\d+\/\d+ 通過)|略過/.test(l)).map(l => l.replace(/"(meshes|moving|joints|samples)":\d+,?/g, '').slice(0, 140));
  return { ok: r.code === 0, note: summary.join(' ／ ') || `exit ${r.code}`, detail: r.code ? lines.slice(-25) : [] };
};
const BUILTIN = {
  imports: { quick: true, run: async p => { const r = checkImports(p); return { ok: !r.missing.length, note: `${r.modules} 個模組`, detail: r.missing }; } },
  names: { quick: true, run: async p => { const n = clientNames(); if (!n.length) return { ok: true, note: '沒有名單，略過' }; const h = scanDirs([p.dir], n); return { ok: !h.length, note: h.length ? `${h.length} 處出現用戶名稱` : `通過（名單 ${n.length} 個）`, detail: h.slice(0, 20).map(x => `${x.file.slice(p.dir.length + 1)}${x.line ? ':' + x.line : '（檔名）'}：改成中性描述`) }; } },
  determinism: { quick: true, needsProject: true, run: viaRunner('determinism') },
  layout: { quick: true, needsProject: true, run: viaRunner('layout') },
  scene: { quick: true, needsProject: true, run: viaRunner('scene') },     // 干涉與閃爍也擋部署
  electrical: { quick: true, needsProject: true, run: viaRunner('electrical') },
  ui: { quick: false, run: async p => {
    const r = await runScript(p, join(CORE, 'tools', 'ui-check.mjs'), [p.id, '--port', process.env.UI_PORT || '8771'], { echo: false }), lines = r.out.trim().split('\n');
    const rows = lines.filter(l => /^[✓✗] /.test(l));
    return { ok: r.code === 0, note: rows.map(l => l.replace(/^.*· /, '').split('  ').slice(0, 2).join(' ')).join(' ／ ') || `exit ${r.code}`, detail: r.code ? lines.filter(l => l.startsWith('✗')).concat(lines.slice(-5)) : [] };
  } },
};

const split = cmd => cmd.match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, ''));
const results = [];
// core 本身：共用模型（core/models）的干涉與重合面；指定專案時略過
if (!argv.some(a => !a.startsWith('--')) && (!only || only.includes('models'))) {
  const t0 = Date.now(), r = await runScript({ dir: CORE }, join(CORE, 'verify', 'models.mjs'), [], { echo: false });
  const lines = r.out.trim().split('\n'), sec = (Date.now() - t0) / 1000;
  results.push({ project: 'core', check: 'models', ok: r.code === 0, note: `${lines.filter(l => l.startsWith('✓')).length}/${lines.filter(l => /^[✓✗]/.test(l)).length} 個模型`, seconds: +sec.toFixed(1) });
  console.log(`${r.code === 0 ? '✓' : '✗'} core · models  ${results.at(-1).note}  (${sec.toFixed(1)} s)`);
  if (r.code) for (const l of lines.filter(l => !l.startsWith('✓'))) console.log('     ' + l);
}
// core 本身：第二段範例（core/examples/segment2，電控、配線、相機）仍然通過電控與配線檢查
if (!argv.some(a => !a.startsWith('--')) && (!only || only.includes('examples'))) {
  const t0 = Date.now(), r = await runScript({ dir: CORE }, join(CORE, 'examples', 'segment2', 'check.mjs'), [], { echo: false });
  const lines = r.out.trim().split('\n'), sec = (Date.now() - t0) / 1000;
  results.push({ project: 'core', check: 'examples', ok: r.code === 0, note: lines.find(l => /^[✓✗]/.test(l))?.slice(2) || `exit ${r.code}`, seconds: +sec.toFixed(1) });
  console.log(`${r.code === 0 ? '✓' : '✗'} core · examples  ${results.at(-1).note}  (${sec.toFixed(1)} s)`);
  if (r.code) for (const l of lines.slice(1)) console.log('     ' + l);
}
for (const p of projects) {
  const scripts = [...(p.checks?.quick || []), ...(quick ? [] : p.checks?.full || [])];
  const hasProject = existsSync(join(p.web, 'js', 'project.js')), cc = p.core || {};
  const builtins = Object.entries(BUILTIN).filter(([k, b]) => (!b.needsProject || hasProject) && !(cc.skip || []).includes(k) && (!quick || b.quick || (cc.quick || []).includes(k)));
  const jobs = [...builtins.map(([k, b]) => ({ name: k, run: () => b.run(p) })),
    ...scripts.map(cmd => ({ name: cmd, run: async () => { const [script, ...args] = split(cmd); const r = await runScript(p, script, args, { echo: false }); return { ok: r.code === 0, note: `exit ${r.code}`, detail: r.code ? r.out.trim().split('\n').slice(-12) : [] }; } }))];
  for (const job of jobs) {
    if (only && !only.some(o => job.name.includes(o))) continue;
    const t0 = Date.now(); let r;
    try { r = await job.run(); } catch (e) { r = { ok: false, note: e.message.split('\n')[0], detail: [String(e.stack || e)] }; }
    const sec = (Date.now() - t0) / 1000;
    results.push({ project: p.id, check: job.name, ok: r.ok, note: r.note, seconds: +sec.toFixed(1) });
    console.log(`${r.ok ? '✓' : '✗'} ${p.id} · ${job.name}  ${r.note || ''}  (${sec.toFixed(1)} s)`);
    if (!r.ok) for (const d of r.detail || []) console.log('     ' + d);
  }
}
const failed = results.filter(r => !r.ok);
// 工作區模式只檢查單一專案時，結果寫在該專案的 TEMP/（代理的沙箱只能寫自己的專案資料夾）
const tempDir = WORKSPACE && projects.length === 1 ? join(projects[0].dir, 'TEMP') : join(REPO, 'TEMP');
mkdirSync(tempDir, { recursive: true });
writeFileSync(join(tempDir, quick ? 'check-quick.json' : 'check-full.json'), JSON.stringify({ at: new Date().toISOString(), quick, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} 通過${failed.length ? '；失敗：' + failed.map(f => `${f.project} · ${f.check}`).join('、') : ''}`);
process.exit(failed.length ? 1 : 0);
