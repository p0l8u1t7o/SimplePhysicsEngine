// 效能量測：渲染與細節補強的效能預算（studio 的守門檢查）與前後對照用。
//   node core/tools/perf-check.mjs <專案> [--port 8795] [--out 檔案.json]
// 桌面（1680×1000）逐一切到各視角，量 renderer.info（三角面數、draw call、貼圖、幾何數）；
// 手機直向（390×844、CPU 降速 4 倍）播放 3 秒量幀率。無頭瀏覽器的幀率只適合前後相對比較。
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pickProjects } from './projects.mjs';
import { startServer } from './serve.mjs';
import { openBrowser, sleep } from './cdp.mjs';
import { viewNames } from './views.mjs';

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const PORT = +opt('--port', 8795), OUT = opt('--out', null);
const [p] = pickProjects(argv.filter(a => !a.startsWith('--')));
if (!p) { console.log('用法：node core/tools/perf-check.mjs <專案> [--port 8795] [--out 檔案.json]'); process.exit(2); }

// 量一格：先強制重繪（按需重繪的舞台也要畫），累計這一格所有 render 呼叫
const SAMPLE = `(async () => {
  const st = globalThis.__coreStages || [];
  if (!st.length) return null;
  for (const s of st) { s.renderer.info.autoReset = false; s.renderer.info.reset(); s.invalidate?.(); }
  await new Promise(r => requestAnimationFrame(r));     // 舞台的畫面迴圈先於這個回呼執行，量到的就是這一格
  const out = { triangles: 0, calls: 0, textures: 0, geometries: 0 };
  for (const s of st) { const i = s.renderer.info; out.triangles += i.render.triangles; out.calls += i.render.calls; out.textures += i.memory.textures; out.geometries += i.memory.geometries; i.autoReset = true; }
  return out;
})()`;
const FPS = `(async () => {
  window.sim.play?.(); await new Promise(r => setTimeout(r, 500));
  let n = 0; const t0 = performance.now();
  await new Promise(r => { const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  window.sim.pause?.();
  return +(n * 1000 / (performance.now() - t0)).toFixed(1);
})()`;

const server = await startServer({ port: PORT, quiet: true });
const url = `http://127.0.0.1:${PORT}/${encodeURIComponent(p.id)}/?pause`;
const result = { project: p.id, views: {}, errors: [] };
let browser = await openBrowser();
try {
  if (!await browser.goto(url)) throw new Error('window.sim 未就緒');
  await sleep(1200);
  const total = await browser.evaluate('+(window.sim.total || 0)');
  const skip = p.shots?.skip || ['follow'];
  const views = (p.shots?.views || viewNames(readFileSync(join(p.web, 'js', 'main.js'), 'utf8'))).filter(v => !skip.includes(v));
  for (const [k, v] of ['iso', ...views].entries()) {
    const t = +(total * [.12, .31, .5, .69, .88][k % 5]).toFixed(2);
    await browser.evaluate(`(() => { const s = window.sim; s.seekTo(${t}); s.setView?.(${JSON.stringify(v)}, true); return true; })()`).catch(e => result.errors.push(`${v}: ${e.message.split('\n')[0]}`));
    await browser.frames(); await sleep(300);
    const m = await browser.evaluate(SAMPLE);
    if (!m) { result.errors.push('頁面沒有用 createStage（找不到 __coreStages）'); break; }
    result.views[v] = m;
  }
  const vs = Object.values(result.views);
  result.max = Object.fromEntries(['triangles', 'calls', 'textures', 'geometries'].map(k => [k, Math.max(0, ...vs.map(x => x[k]))]));
  await browser.close();
  // 手機直向：重新開一個瀏覽器，用行動裝置尺寸與 CPU 降速
  browser = await openBrowser({ width: 390, height: 844 });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await browser.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  if (!await browser.goto(url)) throw new Error('手機尺寸下 window.sim 未就緒');
  await sleep(1500);
  result.phoneFps = await browser.evaluate(FPS);
  result.errors.push(...browser.errors.splice(0));
} catch (e) { result.errors.push(e.message); }
await browser.close(); server.close();

const line = `${p.id}：三角面最多 ${result.max?.triangles ?? '?'}、draw call 最多 ${result.max?.calls ?? '?'}、貼圖 ${result.max?.textures ?? '?'}、手機幀率 ${result.phoneFps ?? '?'} fps`;
console.log(line);
for (const e of result.errors) console.log('  ✗ ' + String(e).slice(0, 200));
console.log('PERF ' + JSON.stringify(result));
if (OUT) { mkdirSync(dirname(resolve(OUT)), { recursive: true }); writeFileSync(resolve(OUT), JSON.stringify(result, null, 2)); }
process.exit(result.errors.length ? 1 : 0);
