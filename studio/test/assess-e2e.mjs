// 評估流程的端對端測試（手動執行，約 30 秒；會開無頭 Chrome；評估平台 Q6）：
//   npm --prefix studio/ui run build
//   node studio/test/assess-e2e.mjs [--shots 資料夾]
// 暫存工作區＋假代理（走真正的代理佇列）：建立只勾「評估＋成本」的專案 → 回答問題 → 規劃寫的 BOM 格式不對被退回 → 確認提案
// → 可行性分頁（結論、平台檢查）、沒有 3D 的分頁 → 在介面上修改（存一版、不得顯示的名稱被換掉）→ 匯出報告 HTML／PDF／Markdown
// → 請代理修改（存成新的一版、BOM 重新匯入前留快照）→ 加上 3D 動畫後出現 3D 的分頁。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { STUDIO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-assess-ui-')), port = await freePort(), base = `http://127.0.0.1:${port}`, t0 = Date.now();
const env = { ...process.env, VS3D_USERS: join(ws, 'users.json'), VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs') };
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--no-repo', '--workspace', ws, '--db', join(ws, 'studio.db')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${s}`);
const check = (ok, label) => { if (!ok) throw new Error(`不符預期：${label}`); log(`✓ ${label}`); };
const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${path}：${j.error}`); return j; };
let browser, step = 0;
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };
const HELPERS = `window.t = {
  button: (text, root = document) => [...root.querySelectorAll('button')].find(b => b.textContent.trim().includes(text)),
  tab: text => [...document.querySelectorAll('.tabs button')].find(b => b.textContent.trim().startsWith(text)),
  card: title => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.startsWith(title)),
  type(el, value) { const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); },
}; true`;
const run = body => browser.evaluate(`(async () => { ${body} })()`);
async function waitFor(expr, label, timeout = 30000) { for (let t = 0; t < timeout; t += 250) { if (await browser.evaluate(expr).catch(() => false)) return; await sleep(250); } throw new Error(`逾時：${label}`); }
const until = async (fn, label, timeout = 60000) => { for (let t = 0; t < timeout; t += 300) { if (await fn().catch(() => false)) return; await sleep(300); } throw new Error(`逾時：${label}`); };

try {
  for (let i = 0; i < 80 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  await call('POST', '/api/projects', { id: 'Quote', title: '報價評估', prompt: '輸送帶＋龍門取放', cli: 'fake', components: ['assess'], clientNames: '示範客戶' });
  const proj = () => call('GET', '/api/projects/Quote'), idle = p => !p.running && !p.queued;
  await until(async () => (p => idle(p) && p.questions.some(q => !q.answered))(await proj()), '規劃角色提問');
  await call('POST', '/api/projects/Quote/answer', { qid: 'site-1', choices: [0] });
  await until(async () => (p => idle(p) && p.questions.some(q => !q.answered && q.id.startsWith('vs3d-proposal')))(await proj()), '提案確認卡片');
  const p1 = await proj();
  check(p1.log.some(l => /可行性分析或 BOM的格式不對/.test(l)), '市購品標成客製件被退回給規劃角色');
  check(/確認後存進資料庫並產生成本表/.test(p1.questions.find(q => !q.answered).question), '只做評估的確認卡片');
  await call('POST', '/api/projects/Quote/answer', { qid: p1.questions.find(q => !q.answered).id, choices: [0] });
  await until(async () => (p => idle(p) && p.stage === 'done')(await proj()), '評估完成');
  check((await proj()).log.some(l => /評估資料存進資料庫：提案 v1、可行性分析 v1；BOM 3 行/.test(l)), '提案、可行性與 BOM 存進資料庫');

  browser = await openBrowser({ width: 1400, height: 1000 });
  await browser.goto(base + '/#p/Quote', '!!document.querySelector(".tabs")');
  await browser.evaluate(HELPERS);
  check(await browser.evaluate(`!!t.tab('可行性') && !t.tab('預覽') && !t.tab('截圖')`), '有「可行性」分頁、沒有 3D 的分頁');
  await run(`t.tab('可行性').click(); return true;`);
  await waitFor(`!!document.querySelector('.chip.verdict') && document.querySelector('.chip.verdict').textContent === '有條件可行'`, '結論');
  check(await browser.evaluate(`t.card('平台檢查').innerText.includes('BOM') && t.card('平台檢查').innerText.includes('3 行')`), '平台檢查列出 BOM');
  await shot('assess');
  // 在介面上修改：結論改成可行，條件寫了不得顯示的名稱
  await run(`t.button('修改', document.querySelector('.assess')).click(); return true;`);
  await waitFor(`!!document.querySelector('.assess textarea.mono')`, '編輯畫面');
  await run(`const f = document.querySelector('.assess .form'); t.type(f.querySelector('select'), '可行'); t.type(f.querySelector('textarea'), '示範客戶要提供治具圖'); t.type(f.querySelector('input[aria-label="修改說明"]'), '結論改可行'); return true;`);
  await run(`t.button('存成新的一版').click(); return true;`);
  await waitFor(`document.body.innerText.includes('已存成新的一版') && document.querySelector('.chip.verdict').textContent === '可行'`, '存成第 2 版');
  const a2 = await call('GET', '/api/projects/Quote/assessment');
  check(a2.feasibility.version === 2 && a2.feasibility.source === 'user' && a2.feasibility.data.conditions[0] === '（用戶）要提供治具圖', '存一版、不得顯示的名稱被換掉');
  // 匯出報告
  const html = await (await fetch(base + '/api/projects/Quote/report?format=html')).text();
  check(html.includes('報價評估') && html.includes('可行') && html.includes('成本摘要') && html.includes('定位治具') && !html.includes('示範客戶'), '報告 HTML：結論、成本、明細，沒有用戶名稱');
  const pdf = Buffer.from(await (await fetch(base + '/api/projects/Quote/report?format=pdf')).arrayBuffer());
  check(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 5000, `報告 PDF（${(pdf.length / 1024).toFixed(0)} KB）`);
  const md = await (await fetch(base + '/api/projects/Quote/report?format=md')).text();
  check(md.startsWith('# 報價評估 評估報告') && md.includes('## 成本明細'), '報告 Markdown');
  // 請代理修改
  await run(`t.type(document.querySelector('textarea[aria-label="要代理修改的內容"]'), '節拍有餘裕，結論改成可行；加現場安裝'); t.button('送出', t.card('請代理修改')).click(); return true;`);
  await waitFor(`document.body.innerText.includes('已排進代理佇列')`, '排進代理佇列');
  await until(async () => (await call('GET', '/api/projects/Quote/assessment')).feasibility.version === 3 && idle(await proj()), '代理修改後存成第 3 版');
  const b = await call('GET', '/api/projects/Quote/bom');
  check(b.lines.length === 4 && b.snapshots.length === 1, 'BOM 加了一行、重新匯入前留快照');
  // 加上 3D 動畫
  await run(`t.tab('進度').click(); return true;`);
  await waitFor(`!!document.querySelector('.bar.components')`, '專案組成');
  await run(`[...document.querySelectorAll('.bar.components label')].find(l => l.textContent.includes('3D')).querySelector('input').click(); return true;`);
  await run(`t.button('儲存', document.querySelector('.bar.components')).click(); return true;`);
  await waitFor(`document.body.innerText.includes('已加上 3D 動畫')`, '加上 3D 的提示');
  await waitFor(`!!t.tab('預覽')`, '出現 3D 的分頁');
  check((await proj()).stage === 'build', '下一次續跑開始第一段開發');
  await shot('components');
  console.log('✓ 評估流程介面測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill();
  await sleep(800);
  for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { }
  rmSync(ws, { recursive: true, force: true });
}
