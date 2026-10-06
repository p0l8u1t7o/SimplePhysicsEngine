// 元件補全的端對端測試（手動執行，約 20 秒；會開無頭 Chrome；評估平台 Q5）：
//   npm --prefix studio/ui run build
//   node studio/test/enrich-e2e.mjs [--shots 資料夾]
// 暫存工作區＋假代理（test/fake-agent.mjs，不耗額度，走真正的代理佇列）：元件編輯視窗按「開始補全」→ 佇列跑完 → 審核表的預設勾選
// （合格的勾、沒來源與型別不對的不能勾）→ 加勾價格與規格書 → 採用 → 元件升版、規格欄位、C 級價格、附件、來源紀錄 → 「AI 補全」分頁 → 批次補全。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { STUDIO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-enrich-ui-')), port = await freePort(), base = `http://127.0.0.1:${port}`, t0 = Date.now();
// 假的原廠網站：規格書 PDF
const site = createServer((req, res) => { if (req.url === '/ds.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('%PDF-1.4 demo datasheet'); } else { res.writeHead(404); res.end(); } });
await new Promise(r => site.listen(0, '127.0.0.1', r));
const env = { ...process.env, VS3D_USERS: join(ws, 'users.json'), VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs'), FAKE_ENRICH_FILE: `http://127.0.0.1:${site.address().port}/ds.pdf` };
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--no-repo', '--workspace', ws, '--db', join(ws, 'studio.db')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${s}`);
const check = (ok, label) => { if (!ok) throw new Error(`不符預期：${label}`); log(`✓ ${label}`); };
const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${path}：${j.error}`); return j; };
let browser, step = 0;
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };
const HELPERS = `window.t = {
  button: (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().includes(text)),
  card: title => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.startsWith(title)),
  box: label => document.querySelector('input[aria-label="' + label + '"]'),
}; true`;
const run = body => browser.evaluate(`(async () => { ${body} })()`);
async function waitFor(expr, label, timeout = 20000) { for (let t = 0; t < timeout; t += 200) { if (await browser.evaluate(expr).catch(() => false)) return; await sleep(200); } throw new Error(`逾時：${label}`); }

try {
  for (let i = 0; i < 80 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  await call('PUT', '/api/settings', { defaultCli: 'fake', roles: {} });       // 補全角色用假代理
  const vis = (await call('GET', '/api/categories')).nodes.find(n => n.name === '視覺').children, cat = vis.find(c => c.name === '相機與讀碼').id;
  const cam = await call('POST', '/api/parts', { name: '5MP GigE 相機', category_id: cat });
  const other = await call('POST', '/api/parts', { name: '環形光源', category_id: vis.find(c => c.name === '光源').id });

  browser = await openBrowser({ width: 1400, height: 1000 });
  await browser.goto(base + '/#parts', '!!document.querySelector("table.parts")');
  await browser.evaluate(HELPERS);
  await waitFor(`[...document.querySelectorAll('tr.part')].some(r => r.innerText.includes('5MP GigE'))`, '清單有元件');
  await run(`[...document.querySelectorAll('tr.part')].find(r => r.innerText.includes('5MP GigE')).click(); return true;`);
  await waitFor(`!!t.card('AI 補全規格') && !!t.button('開始補全', t.card('AI 補全規格'))`, '元件視窗有「AI 補全規格」卡片');
  await run(`t.button('開始補全', t.card('AI 補全規格')).click(); return true;`);
  await waitFor(`!!document.querySelector('table.enrich-review')`, '佇列跑完假代理，出現審核表');
  check(await browser.evaluate(`t.box('採用 像素尺寸').checked && !t.box('採用 型號').checked && t.box('採用 型號').disabled && t.box('採用 幀率').disabled`), '預設勾合格的；沒有來源、型別不對的不能勾');
  check(await browser.evaluate(`document.querySelector('table.enrich-review').innerText.includes('沒有來源網址') && document.querySelector('table.enrich-review').innerText.includes('example.com')`), '錯誤原因與來源網站');
  await run(`t.box('採用價格').click(); t.box('下載 規格書').click(); t.card('AI 補全規格').scrollIntoView(); return true;`);
  await shot('review');
  await run(`t.button('採用勾選的', t.card('AI 補全規格')).click(); return true;`);
  await waitFor(`t.card('AI 補全規格').innerText.includes('✓ 採用')`, '採用完成的訊息');
  const p = await call('GET', `/api/parts/${cam.id}`);
  check(p.attrs.像素尺寸 === '3.45' && p.attrs.介面 === 'GigE' && p.brand === '示範廠', '欄位寫進元件');
  check(p.prices[0]?.grade === 'C' && p.prices[0].unit_price === 21000, '價格記成 C 級');
  check(p.files.length === 1 && p.files[0].kind === 'datasheet', '規格書下載成附件');
  check(p.sources.length === 4 && p.version === 2, '來源紀錄 4 筆、元件升到 v2');
  await waitFor(`t.card('AI 補全規格').innerText.includes('採用過的來源（4）')`, '卡片顯示採用過的來源');
  await shot('accepted');
  // 「AI 補全」分頁與批次補全
  await run(`t.button('✕ 關閉').click(); return true;`);
  await run(`t.button('AI 批次補全').click(); return true;`);
  await waitFor(`!!document.querySelector('[aria-label="批次補全"]')`, '批次補全視窗');
  await run(`t.box('補全 環形光源').click(); t.button('開始補全（1）').click(); return true;`);
  await waitFor(`document.body.innerText.includes('1 個元件排進代理佇列')`, '批次排進佇列');
  await waitFor(`[...document.querySelectorAll('table.data tr')].some(r => r.innerText.includes('環形光源') && r.innerText.includes('待審核'))`, '「AI 補全」分頁：批次的工作跑完待審核');
  check(await browser.evaluate(`[...document.querySelectorAll('table.data tr')].some(r => r.innerText.includes('5MP GigE') && r.innerText.includes('已採用'))`), '分頁也列出已採用的工作');
  check((await call('GET', `/api/enrich?part=${other.id}`)).jobs[0].status === 'review', 'API 查得到批次的工作');
  await shot('jobs');
  console.log('✓ 元件補全介面測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill(); site.close();
  await sleep(800);
  for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { }
  rmSync(ws, { recursive: true, force: true });
}
