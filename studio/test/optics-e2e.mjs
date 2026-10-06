// 光學工作台的端對端測試（手動執行，約 15 秒；會開無頭 Chrome；評估平台 Q4）：
//   npm --prefix studio/ui run build
//   node studio/test/optics-e2e.mjs [--shots 資料夾]
// 暫存工作區＋假專案；用 API 建相機、遠心鏡頭、一般鏡頭（規格欄位）；在光學工作台挑元件 → 結果表算出視野 → 改參數即時重算
// → 存兩個方案 → 並排比較 → 選用（相機與鏡頭加進成本表）→ 3D 檢視頁載入。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { STUDIO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-optics-ui-')), port = await freePort(), base = `http://127.0.0.1:${port}`, t0 = Date.now();
// 真的建立專案（光學代理要在專案的 git 裡跑），狀態設成完成
const made = spawnSync(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'new', 'Demo', '--prompt', 'AOI 評估', '--title', '示範專案', '--create-only', '--workspace', ws], { encoding: 'utf8' });
if (made.status) throw new Error(made.stderr || made.stdout);
mkdirSync(join(ws, 'projects', 'Demo', '.studio'), { recursive: true });
writeFileSync(join(ws, 'projects', 'Demo', '.studio', 'state.json'), JSON.stringify({ stage: 'done', round: 0, sessions: {}, streak: {}, waiting: null, violations: [] }));
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--no-repo', '--workspace', ws, '--db', join(ws, 'studio.db')],
  { env: { ...process.env, VS3D_USERS: join(ws, 'users.json'), VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs') }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${s}`);
const check = (ok, label) => { if (!ok) throw new Error(`不符預期：${label}`); log(`✓ ${label}`); };
const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${path}：${j.error}`); return j; };
let browser, step = 0;
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };
const HELPERS = `window.t = {
  button: (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().includes(text)),
  field: (label, root = document) => [...root.querySelectorAll('input, select')].find(e => (e.getAttribute('aria-label') || '').startsWith(label) || e.closest('label')?.querySelector('span')?.textContent.trim().startsWith(label)),
  type(el, value) { const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); },
  card: title => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.startsWith(title)),
}; true`;
const run = body => browser.evaluate(`(async () => { ${body} })()`);
async function waitFor(expr, label, timeout = 15000) { for (let t = 0; t < timeout; t += 200) { if (await browser.evaluate(expr).catch(() => false)) return; await sleep(200); } throw new Error(`逾時：${label}`); }

try {
  for (let i = 0; i < 80 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  const vis = (await call('GET', '/api/categories')).nodes.find(n => n.name === '視覺').children, cat = n => vis.find(c => c.name === n).id;
  const cam = await call('POST', '/api/parts', { name: '5MP GigE 相機', category_id: cat('相機與讀碼'), attrs: { 像素尺寸: '3.45', 水平像素: '2448', 垂直像素: '2048', 幀率: '23', 介面: 'GigE', 鏡頭接口: 'C' } });
  const tele = await call('POST', '/api/parts', { name: '0.35× 遠心鏡頭', category_id: cat('鏡頭與光學'), attrs: { 鏡頭類型: '遠心', 倍率: '0.35', 最小光圈: '8', 鏡頭接口: 'C', 工作距離: '110' } });
  const std = await call('POST', '/api/parts', { name: '25 mm 鏡頭', category_id: cat('鏡頭與光學'), attrs: { 鏡頭類型: '定焦', 焦距: '25', 最小光圈: '4', 鏡頭接口: 'C', 最近對焦距離: '100' } });
  for (const [p, price] of [[cam, 20000], [tele, 50000], [std, 6000]]) await call('POST', `/api/parts/${p.id}/prices`, { unit_price: price });

  browser = await openBrowser({ width: 1500, height: 1000 });
  await browser.goto(base + '/#optics', '!!document.querySelector(".optics")');
  await browser.evaluate(HELPERS);
  await waitFor(`[...t.card('相機').querySelectorAll('option')].some(o => o.textContent.includes('5MP'))`, '相機的候選來自元件庫的分類');
  await run(`t.type(t.card('相機').querySelector('select'), '${cam.code}'); t.type(t.card('鏡頭').querySelector('select'), '${tele.code}'); return true;`);
  await waitFor(`t.card('結果').innerText.includes('24.13 × 20.19')`, '挑相機與遠心鏡頭後算出視野');
  await waitFor(`t.field('相機 像素尺寸').placeholder === '3.45'`, '參數用元件的規格欄位（灰字）');
  await run(`const s = t.card('工件與場景'); t.type(t.field('工件與場景 最小缺陷', s), '0.05'); t.type(t.field('工件與場景 工件寬', s), '30'); return true;`);
  await waitFor(`t.card('結果').innerText.includes('5.072') && t.card('結果').innerText.includes('✗ 不符合')`, '改參數即時重算：缺陷 5 px、視野不夠 30 mm');
  check(await browser.evaluate(`t.card('結果').innerText.includes('NT$ 70,000')`), '元件參考成本');
  await shot('workbench');
  // 存甲案、改成一般鏡頭存乙案
  await run(`t.type(t.field('方案名稱'), '甲：遠心'); await new Promise(r => setTimeout(r, 100)); t.button('存成方案').click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/aoi').then(r => r.json()).then(d => d.setups.length === 1)`, '存甲案');
  await run(`t.type(t.card('鏡頭').querySelector('select'), '${std.code}'); t.type(t.field('工件與場景 工作距離', t.card('工件與場景')), '300'); t.type(t.field('方案名稱'), '乙：25 mm'); return true;`);
  await waitFor(`t.card('結果').innerText.includes('92.9 × 77.72')`, '換成一般鏡頭：薄透鏡的視野');
  await run(`t.button('另存新方案').click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/aoi').then(r => r.json()).then(d => d.setups.length === 2)`, '另存乙案');
  await waitFor(`t.card('方案').querySelectorAll('tbody tr').length === 2`, '方案清單重新載入');      // 畫面的清單在存檔後才重新載入
  await run(`for (const c of t.card('方案').querySelectorAll('input[type=checkbox]')) c.click(); return true;`);
  await waitFor(`!!document.querySelector('table.compare') && document.querySelector('table.compare').innerText.includes('乙：25 mm')`, '兩個方案並排比較');
  log('✓ 存方案、並排比較');
  // 選用甲案：相機與遠心鏡頭加進成本表
  await run(`[...t.card('方案').querySelectorAll('tbody tr')].find(r => r.innerText.includes('甲：遠心')).querySelector('button[title^="其他方案"]').click(); return true;`);
  await waitFor(`fetch('/api/projects/Demo/bom').then(r => r.json()).then(d => d.lines?.length === 2 && d.lines.every(l => l.section === 'AOI 視覺'))`, '選用的方案加進成本表');
  await waitFor(`document.body.innerText.includes('已選用「甲：遠心」')`, '畫面提示選用');
  log('✓ 選用方案、元件加進成本表');
  check(await browser.evaluate(`document.querySelector('iframe.optics-frame')?.src.includes('/core/optics/view.html')`), '3D 檢視頁嵌在工作台');
  const viewUrl = await browser.evaluate(`document.querySelector('iframe.optics-frame').src`);
  check((await fetch(viewUrl)).status === 200, '3D 檢視頁載得到');
  await shot('chosen');
  // L2：工件材質與要檢出的缺陷 → 結果表多出明暗場與缺陷對比
  for (const [card, label, v] of [['光源', '光源類型', '環形'], ['光源', '光源 發光尺寸', '200'], ['光源', '光源 距離工件', '30'], ['工件與場景', '工件材質', '鏡面金屬']]) {
    await run(`t.type(t.field('${label}', t.card('${card}')), '${v}'); return true;`).catch(e => { throw new Error(`${label}：${e.message}`); });
    await sleep(50);
  }
  await run(`[...t.card('工件與場景').querySelectorAll('label.check')].find(x => x.textContent.includes('刮傷')).querySelector('input').click(); return true;`);
  await waitFor(`t.card('結果').innerText.includes('明暗場') && t.card('結果').innerText.includes('缺陷可見度：刮傷')`, 'L2 結果：明暗場與刮傷的對比');
  // 光學代理（假代理，走真正的代理佇列）：提 2 個方案、1 個被退回後修正，存進方案清單
  await call('PUT', '/api/settings', { defaultCli: 'fake', roles: {} });
  await run(`t.type(document.querySelector('textarea[aria-label="光學需求"]'), '鏡面工件，刮傷與髒污都要檢出'); t.button('送出', t.card('方案')).click(); return true;`);
  await waitFor(`document.body.innerText.includes('已排進代理佇列')`, '排進代理佇列');
  await waitFor(`[...t.card('方案').querySelectorAll('tbody tr')].some(r => r.innerText.includes('乙：5MP＋0.5× 遠心'))`, '光學代理的方案出現在清單', 60000);
  const setups = (await call('GET', '/api/projects/Demo/aoi')).setups;
  check(setups.length === 4 && setups.filter(s => s.created_by === 'optics 代理').every(s => s.result.status !== 'fail'), '代理的兩個方案都通過檢查');
  await shot('agent');
  console.log('✓ 光學工作台介面測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill();
  await sleep(800);
  for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { }
  rmSync(ws, { recursive: true, force: true });
}
