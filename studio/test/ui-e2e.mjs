// 介面端對端測試（手動執行，約數分鐘；會開無頭 Chrome，並跑真正的檢查、截圖與效能量測）：
//   npm --prefix studio/ui run build
//   node studio/test/ui-e2e.mjs [--keep] [--shots 資料夾]
// 在暫存工作區啟動 vs3d ui（假代理走真正的命令列），用 API 建立專案，之後全部在網頁上點選：
// 回答代理的問題 → 確認提案 → 等第一段、審查、補強、守門跑完 → 在補強結果卡片按「送出」（接受）→ 完成。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { STUDIO, REPO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), keep = argv.includes('--keep');
const shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-ui-')), port = await freePort();
const env = { ...process.env, VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs') };
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--workspace', ws], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const base = `http://127.0.0.1:${port}`;
const api = async (path, body) => (await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
let browser, step = 0;
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${s}`);
const t0 = Date.now();
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };

async function waitFor(expr, label, timeout = 600000) {
  for (let t = 0; t < timeout; t += 1000) { if (await browser.evaluate(expr).catch(() => false)) return; await sleep(1000); }
  throw new Error(`逾時：${label}\n${out.slice(-2000)}`);
}
// 點「送出」：問題卡片預設已選建議選項
const answerAll = async () => browser.evaluate(`(async () => { const b = [...document.querySelectorAll('.qcard .bar button.primary')].find(x => x.textContent.includes('送出')); if (!b) return false; b.click(); return true; })()`);
const pendingIds = () => api('/api/projects/E2E').then(p => p.questions.filter(q => !q.answered).map(q => q.id));

try {
  for (let i = 0; i < 40 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  browser = await openBrowser({ width: 1400, height: 900 });
  await browser.goto(base + '/', '!!document.querySelector(".side")');
  log('介面載入');
  await shot('home');
  const r = await api('/api/projects', { id: 'E2E', title: '端對端測試站', prompt: '輸送帶＋龍門取放', cli: 'fake', autoApprove: false });
  if (!r.started) throw new Error('建立失敗：' + JSON.stringify(r));
  await browser.evaluate(`location.hash = 'p/E2E'; true`);
  for (const expect of [/^site-1$/, /^vs3d-proposal/, /^vs3d-render-accept/]) {
    await waitFor(`fetch('/api/projects/E2E').then(r => r.json()).then(p => !p.running && p.questions.some(q => !q.answered))`, `等待問題 ${expect}`);
    const ids = await pendingIds();
    if (!ids.some(x => expect.test(x))) throw new Error(`預期問題 ${expect}，實際 ${ids}`);
    await waitFor(`!!document.querySelector('.qcard .bar button.primary')`, '問題卡片出現', 30000);
    log(`回答 ${ids.join('、')}`);
    await shot(ids[0]);
    if (!await answerAll()) throw new Error('找不到送出按鈕');
    await sleep(1500);
  }
  await waitFor(`fetch('/api/projects/E2E').then(r => r.json()).then(p => !p.running && p.stage === 'done')`, '完成');
  await browser.evaluate(`location.reload(); true`); await sleep(1500);
  await waitFor(`document.body.innerText.includes('完成')`, '畫面顯示完成', 30000);
  const p = await api('/api/projects/E2E');
  log(`完成：${p.round} 輪、審查 ${p.state.reviews} 次、補強 ${p.state.render?.result}、截圖 ${p.shots.length} 張`);
  if (p.state.render?.result !== 'accepted' || !p.shots.length) throw new Error('結果不符預期');
  for (const t of ['審查', '補強對照', '截圖']) { await browser.evaluate(`[...document.querySelectorAll('.tabs button')].find(b => b.textContent.startsWith('${t}')).click(); true`); await sleep(1200); await shot(t); }
  console.log('✓ 介面端對端測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill();
  await sleep(800);
  if (!keep) { for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { } rmSync(ws, { recursive: true, force: true }); }
  else console.log('工作區保留在 ' + ws);
}
