// 指定視角與時間的少量截圖（開發中看自己的成品用；core/SITE-RULES.md「完成定義」第 3 項的輕量版）。
//   node core/tools/snap.mjs <站> [--view iso,robot] [--t 0,12.5] [--size desktop|phone|phone-land|tablet] [--out 資料夾] [--list]
//   - 每個視角 × 每個時間各拍一張，一次最多 8 張；沒給 --view 就是 iso，沒給 --t 就是總長的 50%。
//   - 自動找空的 port，不和其他伺服器衝突；輸出預設在站的 TEMP/snap/（不進版控），印出檔案路徑與主控台錯誤，用讀檔工具打開圖片看。
//   - --list 只列出視角名稱與動畫總長。
// 和 shots.mjs 的差別：shots 拍全部視角給回歸比對用；snap 只拍要看的那幾張，給代理反覆「改 → 看 → 改」。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pickProjects } from './projects.mjs';
import { startServer } from './serve.mjs';
import { openBrowser, sleep } from './cdp.mjs';

const SIZES = { desktop: [1680, 1000], phone: [390, 844], 'phone-land': [844, 390], tablet: [1024, 1366] };
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const views = String(opt('--view', 'iso')).split(',').map(s => s.trim()).filter(Boolean);
const times = opt('--t', null), size = opt('--size', 'desktop'), outOpt = opt('--out', null), list = argv.includes('--list');
const names = argv.filter(a => !a.startsWith('--'));
if (names.length !== 1) { console.log('用法：node core/tools/snap.mjs <站> [--view iso,robot] [--t 0,12.5] [--size desktop|phone|phone-land|tablet] [--out 資料夾] [--list]'); process.exit(2); }
if (!SIZES[size]) { console.log(`--size 只能是 ${Object.keys(SIZES).join('、')}`); process.exit(2); }
const [p] = pickProjects(names);

const server = await startServer({ port: 0, quiet: true }), port = server.address().port;
const [width, height] = SIZES[size];
const browser = await openBrowser({ width, height });
let code = 0;
try {
  if (!await browser.goto(`http://127.0.0.1:${port}/${encodeURIComponent(p.id)}/?pause`)) throw new Error('頁面載入逾時：window.sim 沒有就緒（先跑快速檢查看 imports 與主控台錯誤）');
  await sleep(1200);
  const info = await browser.evaluate(`(() => { const s = window.sim, v = s.views; return { total: +(s.total || 0), views: Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : [] }; })()`);
  if (list) { console.log(`視角：${info.views.join('、') || '（沒有 window.sim.views）'}\n總長：${info.total} s`); }
  else {
    const ts = times ? times.split(',').map(Number) : [+(info.total * .5).toFixed(2)];
    if (ts.some(t => !Number.isFinite(t))) throw new Error('--t 要是秒數，用逗號分隔');
    const bad = views.filter(v => v !== 'iso' && info.views.length && !info.views.includes(v));
    if (bad.length) throw new Error(`沒有這些視角：${bad.join('、')}（有：${info.views.join('、')}）`);
    const jobs = views.flatMap(v => ts.map(t => [v, Math.max(0, Math.min(info.total, t))]));
    if (jobs.length > 8) throw new Error(`一次最多 8 張（這次 ${jobs.length} 張）：減少視角或時間`);
    const out = resolve(outOpt || join(p.dir, 'TEMP', 'snap')); mkdirSync(out, { recursive: true });
    for (const [v, t] of jobs) {
      await browser.evaluate(`(() => { const s = window.sim; s.seekTo(${t}); if (s.setView) s.setView(${JSON.stringify(v)}, true); return true; })()`);
      await browser.frames(); await sleep(400); await browser.frames();
      const f = join(out, `${`${v}@${t}`.replace(/[^\w@.-]/g, '_')}${size === 'desktop' ? '' : '-' + size}.png`);
      writeFileSync(f, await browser.screenshot('png'));
      console.log(f);
    }
  }
  const errs = browser.errors.splice(0);
  for (const e of errs) console.log(`✗ 主控台錯誤：${String(e).slice(0, 200)}`);
  if (errs.length) code = 1;
} catch (e) { console.log(`✗ ${e.message}`); code = 1; }
finally { await browser.close(); server.close(); }
process.exit(code);
