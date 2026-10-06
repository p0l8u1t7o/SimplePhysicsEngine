// 成本表介面的端對端測試（手動執行，約 15 秒；會開無頭 Chrome；評估平台 Q3）：
//   npm --prefix studio/ui run build
//   node studio/test/cost-e2e.mjs [--shots 資料夾]
// 暫存工作區放一個假專案，用 API 建元件與 BOM，然後在專案頁的「成本表」分頁：看摘要 → 加一行（客製件）→ 改數量
// → 元件改價後出現新版提示 → 比較差異 → 勾選升級（自動快照）→ 存快照、和目前比較 → 改預備費重算 → 下載 xlsx 讀回核對。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { STUDIO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { readZip, xlsxSheets } from '../lib/office.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-cost-ui-')), port = await freePort(), base = `http://127.0.0.1:${port}`, t0 = Date.now();
mkdirSync(join(ws, 'projects', 'Demo'), { recursive: true });
writeFileSync(join(ws, 'projects', 'Demo', 'studio.json'), '{}\n'); writeFileSync(join(ws, 'projects', 'Demo', 'project.json'), '{ "title": "示範專案" }\n');
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--no-repo', '--workspace', ws, '--db', join(ws, 'studio.db')],
  { env: { ...process.env, VS3D_USERS: join(ws, 'users.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${s}`);
const check = (ok, label) => { if (!ok) throw new Error(`不符預期：${label}`); log(`✓ ${label}`); };
const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${path}：${j.error}`); return j; };
let browser, step = 0;
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };
const HELPERS = `window.t = {
  button: (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().includes(text)),
  field: (label, root = document) => [...root.querySelectorAll('input, textarea, select')].find(e => (e.getAttribute('aria-label') || '').startsWith(label) || e.closest('label')?.querySelector('span')?.textContent.trim().startsWith(label)),
  type(el, value) { const proto = el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); },
  card: title => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.includes(title)),
}; true`;
const run = body => browser.evaluate(`(async () => { ${body} })()`);
async function waitFor(expr, label, timeout = 15000) { for (let t = 0; t < timeout; t += 200) { if (await browser.evaluate(expr).catch(() => false)) return; await sleep(200); } throw new Error(`逾時：${label}`); }
const bom = () => call('GET', '/api/projects/Demo/bom');

try {
  for (let i = 0; i < 80 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  // 元件與 BOM
  const cam = await call('POST', '/api/parts', { name: '工業相機', brand: 'Basler', model: 'ace 2', unit: '台' });
  await call('POST', `/api/parts/${cam.id}/prices`, { unit_price: 20000, grade: 'B' });
  for (const v of [{ part: cam.code, qty: 2, line: '3-01', section: '3 視覺' }, { labor: 'eng', name: '機構設計', qty: 30, line: '6-01', section: '6 工程' }, { name: '組裝治具', unit_price: 90000, grade: 'C', qty: 2, line: '4-01', section: '4 治具' }])
    await call('POST', '/api/projects/Demo/bom/items', v);
  let b = await bom();
  check(b.summary.subtotal === 40000 + 240000 + 180000, `API 算出小計 ${b.summary.subtotal}`);

  browser = await openBrowser({ width: 1500, height: 1000 });
  await browser.goto(base + '/#p/Demo', '!!document.querySelector(".tabs")');
  await browser.evaluate(HELPERS);
  await run(`t.button('成本表', document.querySelector('.tabs')).click(); return true;`);
  await waitFor(`!!t.card('成本摘要') && t.card('成本摘要').innerText.includes('529,000')`, '成本摘要顯示含預備費的主數字');
  log('✓ 成本摘要'); await shot('summary');

  // 加一行（客製件）
  await run(`t.button('＋ 加一行').click(); return true;`);
  await waitFor(`!!document.querySelector('.bom-form')`, '加一行的表單');
  await run(`const f = document.querySelector('.bom-form'); t.type(f.querySelector('select'), 'custom'); await new Promise(r => setTimeout(r, 100));
    t.type(t.field('編號', f), '5-01'); t.type(t.field('子系統', f), '5 機台'); t.type(t.field('項目名稱', f), '機台與外罩'); t.type(t.field('數量', f), '1'); t.type(t.field('單價', f), '380000');
    await new Promise(r => setTimeout(r, 100)); t.button('加入', f).click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/bom').then(r => r.json()).then(d => d.lines.some(l => l.line === '5-01' && l.subtotal === 380000))`, '在畫面上加客製件');
  log('✓ 加一行（客製件）');
  // 改數量
  await waitFor(`!document.querySelector('.bom-form')`, '表單關閉');
  await run(`const row = [...document.querySelectorAll('table.bom tbody tr')].find(r => r.innerText.includes('工業相機')); t.button('編輯', row).click(); return true;`);
  await waitFor(`!!document.querySelector('.bom-form')`, '編輯表單');
  await run(`const f = document.querySelector('.bom-form'); t.type(t.field('數量', f), '3'); await new Promise(r => setTimeout(r, 100)); t.button('儲存', f).click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/bom').then(r => r.json()).then(d => d.lines.find(l => l.line === '3-01').subtotal === 60000)`, '改數量');
  log('✓ 改數量');

  // 元件改價 → 新版提示 → 比較 → 升級
  await call('POST', `/api/parts/${cam.id}/prices`, { unit_price: 25000, grade: 'A', quoted_on: '2026-10-06' });
  b = await bom();
  check(b.lines.find(l => l.line === '3-01').subtotal === 60000 && b.summary.flags.newer === 1, '元件改價後，專案成本不變、標出 1 行有新版');
  await browser.evaluate(`location.reload(); true`); await sleep(500);
  await browser.evaluate(HELPERS);
  await run(`t.button('成本表', document.querySelector('.tabs')).click(); return true;`);
  await waitFor(`document.body.innerText.includes('1 行的元件有新版')`, '新版提示');
  await run(`t.button('比較差異').click(); return true;`);
  await waitFor(`document.body.innerText.includes('v2 → v3') && document.body.innerText.includes('+NT$ 15,000')`, '差異：版本與小計差額');
  await shot('new-versions');
  await run(`t.button('升級勾選').click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/bom').then(r => r.json()).then(d => d.lines.find(l => l.line === '3-01').subtotal === 75000 && d.snapshots.length === 1)`, '升級後帶入新價格、自動留快照');
  log('✓ 比較差異、升級（自動快照）');

  // 存快照、和目前比較
  await waitFor(`!!t.field('快照名稱')`, '快照區');
  await run(`t.type(t.field('快照名稱'), '報價 v1 給客戶'); await new Promise(r => setTimeout(r, 100)); t.button('儲存快照').click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/bom').then(r => r.json()).then(d => d.snapshots.some(s => s.name === '報價 v1 給客戶'))`, '存快照');
  await call('PUT', `/api/projects/Demo/bom/items/${(await bom()).lines.find(l => l.line === '4-01').id}`, { qty: 3 });
  await browser.evaluate(`location.reload(); true`); await sleep(500); await browser.evaluate(HELPERS);
  await run(`t.button('成本表', document.querySelector('.tabs')).click(); return true;`);
  await waitFor(`!!t.card('快照') && !!t.button('和目前比較', t.card('快照'))`, '快照清單');
  await run(`[...t.card('快照').querySelectorAll('tr')].find(r => r.innerText.includes('報價 v1')).querySelector('button').click(); return true;`);
  await waitFor(`!!document.querySelector('.cost-compare') && document.querySelector('.cost-compare').innerText.includes('+NT$ 90,000')`, '快照和目前比較：治具多一套');
  log('✓ 存快照、和目前比較'); await shot('compare');

  // 改預備費重算
  await run(`const c = t.card('費率與匯率'); t.type(t.field('預備金', c), '10'); await new Promise(r => setTimeout(r, 100)); t.button('儲存並重算', c).click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/bom').then(r => r.json()).then(d => d.settings.contingency === 0.1)`, '改預備費');
  b = await bom();
  check(Math.abs(b.summary.total - b.summary.subtotal * 1.1) < 0.01, '預備費 10% 重算');

  // 下載 xlsx 讀回核對
  const x = await fetch(base + '/api/projects/Demo/bom/xlsx'), buf = Buffer.from(await x.arrayBuffer());
  check(x.headers.get('content-disposition').includes('xlsx') && buf.subarray(0, 2).toString() === 'PK', '下載 xlsx');
  const sum = xlsxSheets(readZip(buf)).find(s => s.name === '摘要').rows, val = re => Number(sum.find(r => re.test(String(r.cells[0])))?.cells[1]);
  check(val(/^含預備費/) === b.summary.total && val(/^含稅/) === b.summary.taxed, 'xlsx 的摘要和畫面一致');
  console.log('✓ 成本表介面測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill();
  await sleep(800);
  for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { }
  rmSync(ws, { recursive: true, force: true });
}
