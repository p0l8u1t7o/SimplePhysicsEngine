// 情境截圖（評估簡報與人工檢視用）：四種情境、精簡／完整模式、非法參數、外罩、本機參考照片、候選定位；最後量渲染時間（rAF 間隔）。
//   node project-site/WaferInspection/tools/scenario-shots.mjs [輸出資料夾]   （在庫根目錄執行；重工作，開發機經 cpu-cap 包裝）
// 輸出預設 TEMP/WaferInspection-shots/scenarios（不進版控）。參考照片讀本站 docs/（只留本機），沒有就略過那一張。
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../../core/tools/serve.mjs';
import { openBrowser, sleep } from '../../../core/tools/cdp.mjs';
const SITE = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(process.argv[2] || 'TEMP/WaferInspection-shots/scenarios'); mkdirSync(out, { recursive: true });
const JOBS = [
  ['01-line-scan', 'sc=line', 'iso', 0.5],
  ['02-line-review', 'sc=line', 'top', 0.86],
  ['03-clean-end', 'sc=clean', 'top', 1],
  ['04-particle-optics', 'sc=particle', 'optics', 0.45],
  ['05-particle-end-truth', 'sc=particle&truth=1', 'top', 1],
  ['06-defocus-review', 'sc=defocus&channel=DF', 'top', 0.83],
  ['07-full-mid', 'mode=full&sc=particle', 'iso', 0.5],
  ['08-full-end', 'mode=full&sc=particle', 'top', 1],
  ['09-invalid', 'mag=-1', 'iso', 0],
  ['10-hood-solid-df', 'sc=line&hood=solid', 'front', 0.3],
];
const server = await startServer({ port: 0, quiet: true }), port = server.address().port;
const browser = await openBrowser({ width: 1680, height: 1000 });
for (const [name, q, view, frac] of JOBS) {
  if (!await browser.goto(`http://127.0.0.1:${port}/WaferInspection/?pause&${q}`)) { console.log('✗ load', name); continue; }
  await sleep(1500);
  const info = await browser.evaluate(`(() => { const s = window.sim; const T = s.total * ${frac}; s.seekTo(T); s.setView(${JSON.stringify(view)}, true); return { T, total: s.total }; })()`);
  await browser.frames(); await sleep(600); await browser.frames();
  writeFileSync(join(out, name + '.png'), await browser.screenshot('png'));
  console.log(name, JSON.stringify(info));
}
// 本機參考照片（客戶截圖，含紅色箭頭）＋人工標記；只拍到本機 TEMP
{
  const { readFileSync } = await import('node:fs');
  const name = 'messageImage_1793703272665.jpg', file = join(SITE, 'docs', name);
  const data = existsSync(file) ? 'data:image/jpeg;base64,' + readFileSync(file).toString('base64') : null;
  if (data) {
  await browser.goto(`http://127.0.0.1:${port}/WaferInspection/?pause&sc=line`); await sleep(1500);
  await browser.evaluate(`window.sim.loadPhoto(${JSON.stringify(data)}, ${JSON.stringify(name)})`); await sleep(800);
  await browser.frames(); await sleep(400); await browser.frames();
  writeFileSync(join(out, '11-photo.png'), await browser.screenshot('png')); console.log('11-photo');
  }
  await browser.goto(`http://127.0.0.1:${port}/WaferInspection/?pause&sc=line`); await sleep(1500);
  await browser.evaluate(`(() => { const s = window.sim; s.seekTo(s.total); const it = s.project.review[0]; s.select({ at: it.at, k: it.k, label: it.ref }); return it.ref; })()`);
  await browser.frames(); await sleep(900); await browser.frames();
  writeFileSync(join(out, '12-select-candidate.png'), await browser.screenshot('png')); console.log('12-select');
}
// 渲染時間：iso 視角連續播放 4 s，量 requestAnimationFrame 間隔
await browser.goto(`http://127.0.0.1:${port}/WaferInspection/?sc=line`); await sleep(2000);
const perf = await browser.evaluate(`new Promise(r => { const t = []; let last = performance.now(); const f = now => { t.push(now - last); last = now; if (t.length < 240) requestAnimationFrame(f); else { t.sort((a,b)=>a-b); r({ frames: t.length, medianMs: t[t.length>>1], p95Ms: t[Math.floor(t.length*.95)], gl: (() => { const c = document.getElementById('c').getContext('webgl2'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }); } }; requestAnimationFrame(f); })`);
console.log('perf', JSON.stringify(perf));
const errs = browser.errors.splice(0); for (const e of errs) console.log('✗ console', String(e).slice(0, 200));
await browser.close(); server.close();
