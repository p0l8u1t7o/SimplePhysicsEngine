// 元件資料庫的介面端對端測試（手動執行，約 20 秒；會開無頭 Chrome）：
//   npm --prefix studio/ui run build
//   node studio/test/parts-e2e.mjs [--shots 資料夾]
// 在暫存工作區與暫存資料庫啟動 vs3d ui，全部在網頁上操作：新增供應商 → 新增元件（含自由規格欄位）→ 加價格與使用紀錄
// → 搜尋與篩選 → 編輯 → 刪除價格 → 刪除元件，每一步都用 API 核對資料庫的內容。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { STUDIO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-parts-ui-')), port = await freePort(), dbFile = join(ws, 'parts.db');
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--no-repo', '--workspace', ws, '--db', dbFile], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const base = `http://127.0.0.1:${port}`, t0 = Date.now();
const api = async path => (await fetch(base + path)).json();
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${s}`);
let browser, step = 0;
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };
const check = (ok, label) => { if (!ok) throw new Error(`不符預期：${label}`); log(`✓ ${label}`); };

// 在頁面裡執行的小工具：依文字找按鈕、依 placeholder／aria-label 找輸入框並輸入（走 React 的 onChange）
const HELPERS = `
  window.t = {
    button: (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().includes(text)),
    field: (label, root = document) => [...root.querySelectorAll('input, textarea, select')].find(e => (e.getAttribute('aria-label') || '').startsWith(label) ||(e.placeholder || '').includes(label) || e.closest('label')?.querySelector('span')?.textContent.trim().startsWith(label)),
    type(el, value) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    },
    card: title => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.includes(title)),
    // 等卡片裡的「＋ 新增…」按鈕出現（上一筆儲存完、表格回到非編輯狀態）再按
    async add(title, label) { for (let i = 0; i < 50; i++) { const b = t.card(title) && t.button(label, t.card(title)); if (b) { b.click(); await new Promise(r => setTimeout(r, 100)); return t.card(title).querySelector('tr.editing'); } await new Promise(r => setTimeout(r, 100)); } throw new Error('找不到按鈕：' + label); },
  }; true`;
const run = body => browser.evaluate(`(async () => { ${body} })()`);
async function waitFor(expr, label, timeout = 15000) {
  for (let t = 0; t < timeout; t += 200) { if (await browser.evaluate(expr).catch(() => false)) return; await sleep(200); }
  throw new Error(`逾時：${label}`);
}
// 逐列編輯的表格：在指定卡片按「＋ 新增…」，填好後按儲存
const addRecord = (cardTitle, addLabel, values) => run(`
  const row = await t.add(${JSON.stringify(cardTitle)}, ${JSON.stringify(addLabel)});
  for (const [label, v] of ${JSON.stringify(Object.entries(values))}) t.type(t.field(label, row), v);
  await new Promise(r => setTimeout(r, 100));
  t.button('儲存', row).click(); return true;`);

try {
  for (let i = 0; i < 80 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  browser = await openBrowser({ width: 1500, height: 950 });
  await browser.goto(base + '/#parts', '!!document.querySelector(".page h2")');
  await browser.evaluate(HELPERS);
  await waitFor(`document.body.innerText.includes('資料庫還是空的')`, '空資料庫的提示');
  check((await api('/api/parts')).file === dbFile, '介面用的是指定的資料庫檔');
  await shot('empty');

  // 供應商
  await run(`t.button('供應商').click(); return true;`);
  await waitFor(`document.body.innerText.includes('還沒有供應商')`, '供應商分頁');
  await run(`
    t.button('新增供應商').click(); await new Promise(r => setTimeout(r, 100));
    const row = document.querySelector('tr.editing');
    t.type(t.field('名稱 *', row), '測試代理商'); t.type(row.querySelector('select'), '代理商'); t.type(t.field('交期', row), '4～6 週');
    await new Promise(r => setTimeout(r, 100)); t.button('儲存', row).click(); return true;`);
  await waitFor(`fetch('/api/suppliers').then(r => r.json()).then(d => d.suppliers.length === 1)`, '供應商寫入');
  const sup = (await api('/api/suppliers')).suppliers[0];
  check(sup.name === '測試代理商' && sup.kind === '代理商' && sup.lead_time === '4～6 週', '新增供應商');
  await shot('supplier');

  // 新增元件
  await run(`t.button('＋ 新增元件').click(); return true;`);
  await waitFor(`!!document.querySelector('.modal')`, '編輯面板開啟');
  await run(`
    const m = document.querySelector('.modal');
    t.type(t.field('名稱', m), '工業相機'); t.type(t.field('類別', m), '相機與讀碼'); t.type(t.field('廠牌', m), 'Basler');
    t.type(t.field('型號', m), 'ace 2 a2A2448-23gcPRO'); t.type(t.field('單位', m), '台'); t.type(t.field('規格', m), '500 萬畫素、全域快門、GigE PoE');
    t.button('＋ 規格欄位', m).click(); await new Promise(r => setTimeout(r, 100));
    t.type(t.field('規格欄位名稱', m), '解析度'); t.type(t.field('規格欄位值', m), '2448 × 2048');
    await new Promise(r => setTimeout(r, 100)); t.button('新增', m.querySelector('form')).click(); return true;`);
  await waitFor(`fetch('/api/parts').then(r => r.json()).then(d => d.total === 1)`, '元件寫入');
  const id = (await api('/api/parts')).parts[0].id;
  let part = await api(`/api/parts/${id}`);
  check(part.name === '工業相機' && part.brand === 'Basler' && part.attrs['解析度'] === '2448 × 2048' && part.unit === '台', '新增元件（含自由規格欄位）');
  await waitFor(`!!t.card('價格紀錄')`, '新增後出現價格紀錄區');

  // 價格紀錄兩筆、使用紀錄一筆
  await addRecord('價格紀錄', '新增價格', { 報價日: '2026-09-01', 單價: '20000', 來源: 'Q-0901' });
  await waitFor(`fetch('/api/parts/${id}').then(r => r.json()).then(d => d.prices.length === 1)`, '第一筆價格');
  await run(`
    const row = await t.add('價格紀錄', '新增價格'), sel = row.querySelectorAll('select');
    t.type(t.field('報價日', row), '2026-10-02'); t.type(t.field('單價', row), '21500'); t.type(sel[1], 'A'); t.type(sel[2], '${sup.id}'); t.type(t.field('有效期限', row), '2026-10-03');
    await new Promise(r => setTimeout(r, 100)); t.button('儲存', row).click(); return true;`);
  await waitFor(`fetch('/api/parts/${id}').then(r => r.json()).then(d => d.prices.length === 2)`, '第二筆價格');
  await addRecord('專案使用紀錄', '新增使用紀錄', { 專案: 'RecycleSorter', 編號: '2-01', 數量: '4', 選型理由: '兩站各一組立體對' });
  await waitFor(`fetch('/api/parts/${id}').then(r => r.json()).then(d => d.usages.length === 1)`, '使用紀錄');
  part = await api(`/api/parts/${id}`);
  check(part.prices[0].unit_price === 21500 && part.prices[0].grade === 'A' && part.prices[0].supplier === '測試代理商' && part.prices[1].source === 'Q-0901', '兩筆價格紀錄（新的在前、連到供應商）');
  check(part.usages[0].project === 'RecycleSorter' && part.usages[0].qty === 4, '使用紀錄');
  await waitFor(`t.card('價格紀錄').innerText.includes('已過期')`, '過期的報價有標示');
  await shot('editor');

  // 編輯：改型號後儲存，關閉面板
  await run(`const m = document.querySelector('.modal'); t.type(t.field('選型備註', m), '回收場粉塵多，要加防塵罩'); await new Promise(r => setTimeout(r, 100)); t.button('儲存', m.querySelector('form')).click(); return true;`);
  await waitFor(`fetch('/api/parts/${id}').then(r => r.json()).then(d => d.selection_note.includes('防塵罩'))`, '編輯元件');
  log('✓ 編輯元件');
  await run(`t.button('✕ 關閉').click(); return true;`);
  await waitFor(`!document.querySelector('.modal')`, '面板關閉');

  // 清單與查詢
  await waitFor(`document.querySelector('table.parts tbody tr td.num')?.textContent.includes('21,500')`, '清單顯示最新單價');
  check(await browser.evaluate(`(() => { const r = document.querySelector('table.parts tbody tr').innerText; return r.includes('測試代理商') && r.includes('RecycleSorter') && r.includes('Basler'); })()`), '清單列出廠牌、供應商、用過的專案');
  await shot('list');
  await run(`t.type(t.field('搜尋元件'), '找不到的東西'); return true;`);
  await waitFor(`document.body.innerText.includes('沒有符合條件的元件')`, '查詢：沒有符合');
  await run(`t.type(t.field('搜尋元件'), 'basler 立體對'); return true;`);
  await waitFor(`document.querySelectorAll('table.parts tbody tr:not(.none)').length === 1 && document.body.innerText.includes('符合 1 個')`, '查詢：多個關鍵字（廠牌＋使用紀錄的理由）');
  log('✓ 查詢');
  await run(`t.button('清除條件').click(); return true;`);

  // 刪除價格（按兩次確認）、刪除元件
  await run(`document.querySelector('table.parts tbody tr').click(); return true;`);
  await waitFor(`!!t.card('價格紀錄')?.querySelector('tbody tr .danger')`, '重新開啟元件');
  await run(`const b = t.card('價格紀錄').querySelector('tbody tr .danger'); b.click(); await new Promise(r => setTimeout(r, 150)); return true;`);
  check((await api(`/api/parts/${id}`)).prices.length === 2, '刪除按第一次只是進入確認');
  await run(`t.button('確定刪除？', t.card('價格紀錄')).click(); return true;`);
  await waitFor(`fetch('/api/parts/${id}').then(r => r.json()).then(d => d.prices.length === 1 && d.prices[0].unit_price === 20000)`, '刪除價格紀錄');
  log('✓ 刪除價格紀錄');
  await run(`t.button('刪除元件').click(); await new Promise(r => setTimeout(r, 150)); t.button('確定刪除？', document.querySelector('.modal form')).click(); return true;`);
  await waitFor(`fetch('/api/parts').then(r => r.json()).then(d => d.total === 0)`, '刪除元件');
  await waitFor(`!document.querySelector('.modal') && document.body.innerText.includes('資料庫還是空的')`, '刪除後回到空清單');
  log('✓ 刪除元件');
  console.log('✓ 元件資料庫介面測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill();
  await sleep(800);
  for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { }
  rmSync(ws, { recursive: true, force: true });
}
