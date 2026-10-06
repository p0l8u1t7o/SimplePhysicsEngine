// 中央主機的安全（評估平台 Q1）：登入失敗次數限制、依專案分權限、開放給區網的條件（要有帳號、要 HTTPS）、HTTPS 與預覽代理。
//   node --test studio/test/security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { request } from 'node:https';
import { createAuth, AuthError, LOGIN_LIMIT, canEditProject, canManageProject } from '../lib/auth.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';
import { startUi } from '../lib/server.mjs';
import { setReadOnly, paths } from '../lib/workspace.mjs';

const temp = async fn => { const dir = mkdtempSync(join(tmpdir(), 'vs3d-sec-')); try { return await fn(dir); } finally { for (const d of [paths(dir).core, paths(dir).pristine]) try { setReadOnly(d, false); } catch { } rmSync(dir, { recursive: true, force: true }); } };

test('登入失敗次數限制：同帳號或同 IP 錯 5 次鎖 15 分鐘，時間到或登入成功就清掉', () => temp(dir => {
  let t = 1e12; const auth = createAuth({ file: join(dir, 'users.json'), clock: () => t });
  auth.create({ name: 'amy', password: 'password-1' }); auth.create({ name: 'bob', password: 'password-2' });
  const fails = (fn, status) => assert.throws(fn, e => e instanceof AuthError && e.status === status);
  for (let i = 0; i < LOGIN_LIMIT.max - 1; i++) fails(() => auth.login('amy', 'x'), 401);
  auth.login('amy', 'password-1');                                         // 第 4 次之後登入成功：次數歸零
  for (let i = 0; i < LOGIN_LIMIT.max; i++) fails(() => auth.login('amy', 'x'), 401);
  fails(() => auth.login('amy', 'password-1'), 429);                       // 鎖住：密碼對也不行
  auth.login('bob', 'password-2');                                         // 別的帳號不受影響
  t += LOGIN_LIMIT.lockMs + 1; auth.login('amy', 'password-1');            // 時間到就解鎖
  // 同一個 IP 換不同帳號亂試，也會被鎖
  for (let i = 0; i < LOGIN_LIMIT.max; i++) fails(() => auth.login(`guess${i}`, 'x', { ip: '10.0.0.9' }), 401);
  fails(() => auth.login('bob', 'password-2', { ip: '10.0.0.9' }), 429);
  auth.login('bob', 'password-2', { ip: '10.0.0.8' });
  // 超過時間窗才錯的不累計
  for (let i = 0; i < LOGIN_LIMIT.max - 1; i++) fails(() => auth.login('bob', 'x'), 401);
  t += LOGIN_LIMIT.windowMs + 1; fails(() => auth.login('bob', 'x'), 401); auth.login('bob', 'password-2');
  assert.match(createAuth({ file: join(dir, 'users.json'), secure: true }).cookie('abc'), /; Secure$/);
}));

test('專案權限：沒有成員所有一般帳號都能動；有成員只有成員與管理者；擁有者與管理者才能改名單', () => {
  const admin = { name: 'boss', role: 'admin' }, amy = { name: 'amy', role: 'editor' }, bob = { name: 'Bob', role: 'editor' }, view = { name: 'v', role: 'viewer' };
  const m = [{ user: 'amy', role: 'owner' }, { user: 'bob', role: 'member' }];
  assert.ok(canEditProject(null, m), '還沒有帳號的單機模式不限');
  assert.ok(canEditProject(amy, []) && !canEditProject(view, []));
  assert.ok(canEditProject(admin, m) && canEditProject(amy, m) && canEditProject(bob, m), '成員（不分大小寫）與管理者');
  assert.ok(!canEditProject({ name: 'carl', role: 'editor' }, m) && !canEditProject({ name: 'v', role: 'viewer' }, [{ user: 'v', role: 'owner' }]));
  assert.ok(canManageProject(admin, m) && canManageProject(amy, m) && !canManageProject(bob, m) && !canManageProject(amy, []));
});

test('專案成員資料表：至少一個擁有者、不重複、建立的人成為擁有者、清空就回到開放', () => {
  const db = openPartsDb(':memory:');
  db.claimProject('Demo', 'amy'); db.claimProject('Demo', 'bob');            // 已經有成員時不動
  assert.deepEqual(db.members('Demo').map(x => [x.user, x.role]), [['amy', 'owner']]);
  assert.throws(() => db.setMembers('Demo', [{ user: 'amy', role: 'member' }]), /擁有者/);
  assert.throws(() => db.setMembers('Demo', [{ user: 'amy', role: 'owner' }, { user: 'AMY' }]), /重複/);
  db.setMembers('@RecycleSorter', [{ user: 'bob', role: 'owner' }, { user: 'amy' }], 'boss');
  assert.deepEqual(db.allMembers(), { Demo: [{ user: 'amy', role: 'owner' }], '@RecycleSorter': [{ user: 'bob', role: 'owner' }, { user: 'amy', role: 'member' }] });
  assert.deepEqual(db.setMembers('Demo', []), []);
  db.dropMembers('@RecycleSorter'); assert.deepEqual(db.allMembers(), {});
  db.close();
});

// openssl：Git for Windows 內附；找不到就跳過 HTTPS 的部分
const openssl = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'].find(c => spawnSync(c, ['version'], { windowsHide: true }).status === 0);
const get = (url, headers = {}) => new Promise((ok, fail) => request(url, { rejectUnauthorized: false, headers }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', fail).end());
const post = (url, body) => new Promise((ok, fail) => { const q = request(url, { method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, body: b })); }); q.on('error', fail); q.end(JSON.stringify(body)); });

test('開放給區網：沒有帳號、沒有 HTTPS 都拒絕啟動；HTTPS 時 cookie 加 Secure，預覽代理也走 HTTPS 並要登入', { skip: !openssl && '找不到 openssl' }, () => temp(async dir => {
  const authFile = join(dir, 'users.json'), common = { port: 0, log: () => {}, partsDb: join(dir, 'studio.db'), authFile, host: '0.0.0.0' };
  await assert.rejects(startUi(dir, common), /先建立管理者帳號/);
  createAuth({ file: authFile }).create({ name: 'boss', password: 'correct-horse' });
  await assert.rejects(startUi(dir, common), /HTTPS/);
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  const r = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { windowsHide: true });
  assert.equal(r.status, 0, String(r.stderr)); assert.ok(existsSync(cert));
  const ui = await startUi(dir, { ...common, host: '127.0.0.1', tls: { cert: readFileSync(cert), key: readFileSync(key) } });
  try {
    const base = `https://127.0.0.1:${ui.server.address().port}`;
    assert.equal((await get(base + '/api/projects')).status, 401);
    const login = await post(base + '/api/auth/login', { name: 'boss', password: 'correct-horse' });
    assert.equal(login.status, 200); assert.match(login.headers['set-cookie'][0], /; Secure/);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await get(base + '/api/projects', { Cookie: cookie })).status, 200);
    const pv = `https://127.0.0.1:${ui.previewPort}/core/catalog/`;
    assert.equal((await get(pv)).status, 401, '預覽沒登入被擋');
    assert.equal((await get(pv, { Cookie: cookie })).status, 200, '預覽代理走 HTTPS，登入後轉給本機的 serve.mjs');
  } finally { ui.close(); }
}));
