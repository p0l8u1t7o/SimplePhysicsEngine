// 登入帳號與權限、元件的 3D 模型與附件的端對端測試（手動執行，約 30 秒；會開無頭 Chrome）：
//   npm --prefix studio/ui run build
//   node studio/test/accounts-e2e.mjs [--shots 資料夾]
// 暫存的工作區、元件資料庫與帳號檔：沒有帳號時不用登入 → 在介面建立第一個管理者 → 之後沒登入的請求被擋
// → 唯讀帳號不能修改、一般帳號不能管帳號 → 停用後舊的登入失效 → 元件連到 core 模型、產生渲染圖、上傳與下載附件。
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { STUDIO, freePort, sleep } from '../lib/util.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';
import { openBrowser } from '../../core/tools/cdp.mjs';

const argv = process.argv.slice(2), shotDir = argv.includes('--shots') ? resolve(argv[argv.indexOf('--shots') + 1]) : null;
const ws = mkdtempSync(join(tmpdir(), 'vs3d-acc-')), port = await freePort(), base = `http://127.0.0.1:${port}`, t0 = Date.now();
const server = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), 'ui', '--port', String(port), '--no-open', '--workspace', ws, '--db', join(ws, 'parts.db')],
  { env: { ...process.env, VS3D_USERS: join(ws, 'users.json'), VS3D_THUMBS: join(ws, 'thumbs') }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; server.stdout.on('data', d => { out += d; }); server.stderr.on('data', d => { out += d; });
const log = s => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${s}`);
const check = (ok, label) => { if (!ok) throw new Error(`不符預期：${label}`); log(`✓ ${label}`); };
let browser, step = 0;
const shot = async name => { if (!shotDir) return; mkdirSync(shotDir, { recursive: true }); writeFileSync(join(shotDir, `${String(++step).padStart(2, '0')}-${name}.png`), await browser.screenshot('png')); };
// 用 Node 直接打 API（自己帶 cookie）：回傳 { status, body, cookie }
async function call(method, path, { body, cookie, raw } = {}) {
  const r = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const type = r.headers.get('content-type') || '';
  if (type.includes('event-stream')) { await r.body.cancel(); return { status: r.status, body: null, cookie: '' }; }
  return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const login = async (name, password) => (await call('POST', '/api/auth/login', { body: { name, password } })).cookie;
async function waitFor(fn, label, timeout = 60000) { for (let t = 0; t < timeout; t += 300) { if (await fn()) return; await sleep(300); } throw new Error(`逾時：${label}`); }
const page = expr => browser.evaluate(expr).catch(() => false);
const type = (label, value) => page(`(() => { const el = [...document.querySelectorAll('input')].find(e => e.closest('label')?.querySelector('span')?.textContent.startsWith(${JSON.stringify(label)})); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const click = text => page(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);

try {
  for (let i = 0; i < 80 && !out.includes('vs3d 介面'); i++) await sleep(250);
  if (!out.includes('vs3d 介面')) throw new Error('vs3d ui 沒有啟動：\n' + out);
  check((await call('GET', '/api/auth/me')).body.required === false && (await call('GET', '/api/projects')).status === 200, '沒有帳號時不需要登入');

  // 在介面建立第一個管理者
  browser = await openBrowser({ width: 1500, height: 950 });
  await browser.goto(base + '/#accounts', '!!document.querySelector(".page h2")');
  await waitFor(() => page(`document.body.innerText.includes('建立第一個管理者')`), '帳號頁');
  await shot('setup');
  await type('帳號', 'boss'); await type('顯示名稱', '老闆'); await type('密碼', 'correct-horse'); await sleep(200);
  check(await click('建立並登入'), '按下建立並登入');
  await waitFor(() => page(`!!document.querySelector('.tools .avatar') && document.body.innerText.includes('帳號清單')`), '建立後直接登入、看到帳號清單');
  check((await call('GET', '/api/projects')).status === 401 && (await call('GET', '/api/events')).status === 401 && (await call('GET', '/files/x/TEMP/a.png')).status === 401, '有帳號後，沒登入的 API、事件串流與專案檔案都被擋');
  check((await call('POST', '/api/auth/login', { body: { name: 'boss', password: 'wrong-password' } })).status === 401, '密碼錯不能登入');
  check((await call('POST', '/api/auth/setup', { body: { name: 'x2', password: 'correct-horse' } })).status === 400, '已經有帳號就不能再用「第一個管理者」');
  const admin = await login('boss', 'correct-horse');
  check((await call('GET', '/api/auth/me', { cookie: admin })).body.user.role === 'admin', '管理者登入');

  // 角色
  for (const [name, role] of [['reader', 'viewer'], ['maker', 'editor']]) check((await call('POST', '/api/users', { cookie: admin, body: { name, role, password: 'password-123' } })).status === 200, `建立${role === 'viewer' ? '唯讀' : '一般'}帳號`);
  const viewer = await login('reader', 'password-123'), editor = await login('maker', 'password-123');
  check((await call('GET', '/api/parts', { cookie: viewer })).status === 200 && (await call('POST', '/api/parts', { cookie: viewer, body: { name: 'x' } })).status === 403, '唯讀帳號可以看、不能改');
  check((await call('GET', '/api/users', { cookie: editor })).status === 403 && (await call('PUT', '/api/settings', { cookie: editor, body: {} })).status === 403, '一般帳號不能管帳號、不能改設定');
  const made = await call('POST', '/api/parts', { cookie: editor, body: { name: '工業相機', category: '相機與讀碼', model_id: 'camera' } });
  check(made.status === 200 && made.body.code === 'P-00001' && made.body.grp === '視覺', '一般帳號可以新增元件，編號 P-00001');
  check((await call('POST', '/api/parts', { cookie: editor, body: { name: 'x' } })).body.code === 'P-00002', '編號往上編');
  check((await fetch(base + '/api/parts', { method: 'POST', headers: { Cookie: editor, Origin: 'http://evil.example', 'Content-Type': 'application/json' }, body: '{"name":"y"}' })).status === 403, '別的網站送來的修改請求被拒絕');
  check((await call('PUT', '/api/users/boss', { cookie: admin, body: { role: 'viewer' } })).status === 400 && (await call('DELETE', '/api/users/boss', { cookie: admin })).status === 400, '不能讓系統沒有管理者、不能刪自己');

  // 依專案分權限（評估平台 Q1）：放一個假的工作區專案；沒有成員時一般帳號都能動，有成員後只有成員與管理者能動
  mkdirSync(join(ws, 'projects', 'Demo'), { recursive: true });
  writeFileSync(join(ws, 'projects', 'Demo', 'studio.json'), '{}\n'); writeFileSync(join(ws, 'projects', 'Demo', 'project.json'), '{ "title": "示範專案" }\n');
  let d = await call('GET', '/api/projects/Demo', { cookie: editor });
  check(d.status === 200 && d.body.canEdit === true && d.body.members.length === 0, '沒有成員的專案：一般帳號可以動');
  check((await call('GET', '/api/projects/Demo', { cookie: viewer })).body.canEdit === false, '唯讀帳號對專案只能看');
  check((await call('PUT', '/api/projects/Demo/members', { cookie: admin, body: { members: [{ user: 'boss', role: 'member' }] } })).status === 400, '成員至少要有一個擁有者');
  check((await call('PUT', '/api/projects/Demo/members', { cookie: admin, body: { members: [{ user: 'nobody', role: 'owner' }] } })).status === 400, '不能加不存在的帳號');
  check((await call('PUT', '/api/projects/Demo/members', { cookie: admin, body: { members: [{ user: 'boss', role: 'owner' }] } })).status === 200, '管理者設定擁有者');
  check((await call('GET', '/api/projects/Demo', { cookie: editor })).body.canEdit === false && (await call('POST', '/api/projects/Demo/cancel', { cookie: editor })).status === 403
    && (await call('PUT', '/api/projects/Demo/members', { cookie: editor, body: { members: [] } })).status === 403, '不是成員：不能執行、不能改成員');
  check((await call('GET', '/api/projects', { cookie: editor })).body.projects.find(p => p.id === 'Demo').canEdit === false, '專案清單標出能不能動');
  await call('PUT', '/api/projects/Demo/members', { cookie: admin, body: { members: [{ user: 'boss', role: 'owner' }, { user: 'maker', role: 'member' }] } });
  check((await call('POST', '/api/projects/Demo/cancel', { cookie: editor })).status !== 403, '加入成員後可以執行');
  check((await call('GET', '/api/projects/Demo/members', { cookie: viewer })).body.members.length === 2, '成員名單大家都看得到');
  // 介面：成員分頁
  await browser.evaluate(`location.hash = 'p/Demo'; true`);
  await waitFor(() => page(`!!document.querySelector('.tabs')`), '專案頁');
  await click('成員');
  await waitFor(() => page(`document.body.innerText.includes('專案成員') && document.body.innerText.includes('maker') && document.body.innerText.includes('擁有者')`), '成員分頁列出擁有者與成員');
  await shot('members');
  log('✓ 成員分頁');

  // 預覽與模型目錄的代理：沒登入的請求被擋，登入後轉給本機的 serve.mjs
  const pv = (await call('GET', '/api/info', { cookie: admin })).body.previewPort, catalog = `http://127.0.0.1:${pv}/core/catalog/`;
  check((await fetch(catalog)).status === 401 && (await fetch(catalog, { headers: { Cookie: admin } })).status === 200, '3D 預覽要登入才能看');

  // 登入失敗次數限制：同一個帳號錯 5 次就鎖住，正確的密碼也要等
  await call('POST', '/api/users', { cookie: admin, body: { name: 'locked', role: 'editor', password: 'password-123' } });
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { body: { name: 'locked', password: 'wrong-password' } });
  const lockedOut = await call('POST', '/api/auth/login', { body: { name: 'locked', password: 'password-123' } });
  check(lockedOut.status === 429 && /分鐘後再試/.test(lockedOut.body.error), '登入錯 5 次後鎖住');
  await call('PUT', '/api/users/maker', { cookie: admin, body: { disabled: true } });
  check((await call('GET', '/api/parts', { cookie: editor })).status === 401, '停用後舊的登入失效');
  const audit = (await call('GET', '/api/users', { cookie: admin })).body.audit;
  check(audit.some(a => a.user === 'maker' && a.method === 'POST' && a.path === '/api/parts') && audit.some(a => a.user === 'reader' && a.status === 403), '操作紀錄記下誰做了什麼');

  // 附件：上傳、下載、刪除
  const id = made.body.id, data = Buffer.from('ISO-10303-21;\nHEADER;\n/* 測試用的 STEP 檔 */\nENDSEC;\n');
  const up = await call('POST', `/api/parts/${id}/files?name=${encodeURIComponent('相機支架.step')}`, { cookie: admin, raw: data });
  check(up.status === 200 && up.body.name === '相機支架.step' && up.body.size === data.length, '上傳 CAD 檔');
  const down = await call('GET', `/api/parts/${id}/files/${up.body.id}`, { cookie: admin });
  check(down.status === 200 && Buffer.compare(down.body, data) === 0, '下載回來的內容相同');
  check((await call('GET', `/api/parts/${id}/files/${up.body.id}`)).status === 401, '附件也要登入才能下載');

  // 3D 模型與渲染圖：伺服器在背景用模型目錄頁拍縮圖
  await waitFor(async () => { const m = (await call('GET', '/api/models', { cookie: admin })).body; if (m.error) throw new Error('渲染圖產生失敗：' + m.error); return m.models.find(x => x.id === 'camera')?.thumb && !m.rendering; }, '產生渲染圖', 180000);
  const thumb = await call('GET', '/api/models/camera/thumb', { cookie: admin });
  check(thumb.status === 200 && thumb.body.length > 5000 && thumb.body.subarray(1, 4).toString() === 'PNG', '渲染圖是 PNG');

  // 介面：清單有編號與縮圖，編輯面板有 3D 畫面與附件
  await browser.evaluate(`location.hash = 'parts'; true`);
  await waitFor(() => page(`!!document.querySelector('tr.part .p-thumb') && document.querySelector('tr.part').innerText.includes('P-00001')`), '清單顯示編號與渲染圖');
  await shot('parts');
  await page(`document.querySelector('tr.part').click(); true`);
  await waitFor(() => page(`!!document.querySelector('iframe.model') && document.querySelector('.modal').innerText.includes('相機支架.step')`), '編輯面板有 3D 畫面與附件');
  await sleep(2500); await shot('editor');
  check((await call('DELETE', `/api/files/${up.body.id}`, { cookie: admin })).status === 200 && (await call('GET', `/api/parts/${id}`, { cookie: admin })).body.files.length === 0, '刪除附件');

  // 登出
  await click('✕ 關閉'); await page(`document.querySelector('.tools .avatar').click(); true`); await sleep(200);
  check(await click('登出'), '按登出');
  await waitFor(() => page(`!!document.querySelector('.login')`), '登出後回到登入頁');
  await shot('login');
  console.log('✓ 帳號與元件附件測試通過');
} catch (e) {
  console.log('✗ ' + e.message); process.exitCode = 1;
  if (browser) await shot('failure').catch(() => {});
} finally {
  await browser?.close(); server.kill();
  await sleep(800);
  for (const d of [paths(ws).core, paths(ws).pristine]) try { setReadOnly(d, false); } catch { }
  rmSync(ws, { recursive: true, force: true });
}
