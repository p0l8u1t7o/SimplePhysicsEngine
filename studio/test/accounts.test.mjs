// 登入帳號與權限、元件的唯一編號、提案元件自動匯入、core 模型清單。
//   node --test studio/test/accounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuth, denied, AuthError } from '../lib/auth.mjs';
import { openPartsDb, PENDING } from '../lib/partsdb.mjs';
import { importPlanParts, importFromProject } from '../lib/parts-import.mjs';
import { coreModels, withThumbs } from '../lib/thumbs.mjs';
import { projectPaths } from '../lib/workspace.mjs';
import { REPO, writeJson } from '../lib/util.mjs';

const temp = fn => { const dir = mkdtempSync(join(tmpdir(), 'vs3d-acc-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const fails = (fn, re, status = 400) => assert.throws(fn, e => e instanceof AuthError && e.status === status && re.test(e.message));

test('帳號：第一個一定是管理者、密碼只存雜湊、登入與失效', () => temp(dir => {
  const file = join(dir, 'users.json'), auth = createAuth({ file });
  assert.equal(auth.enabled(), false);
  fails(() => auth.create({ name: 'a', password: 'long-enough' }), /帳號用英數/);
  fails(() => auth.create({ name: 'boss', password: 'short' }), /至少 8/);
  assert.equal(auth.create({ name: 'boss', role: 'viewer', password: 'correct-horse' }).role, 'admin', '第一個帳號強制是管理者');
  assert.equal(auth.enabled(), true);
  assert.ok(!readFileSync(file, 'utf8').includes('correct-horse'), '檔案裡沒有明碼');
  fails(() => auth.create({ name: 'BOSS', password: 'correct-horse' }), /已經有/);
  fails(() => auth.login('boss', 'wrong-password'), /帳號或密碼不對/, 401);
  fails(() => auth.login('nobody', 'correct-horse'), /帳號或密碼不對/, 401);
  const { token, user } = auth.login('Boss', 'correct-horse');
  assert.deepEqual([user.name, user.role], ['boss', 'admin']);
  assert.equal(auth.verify(token).name, 'boss');
  assert.equal(auth.verify(token.slice(0, -2) + 'xx'), null, '簽章不對');
  assert.equal(auth.verify(token.replace(/\.(\d+)\./, '.1.')), null, '改過到期時間');
  assert.equal(auth.fromRequest({ headers: { cookie: `a=1; vs3d_session=${token}; b=2` } }).name, 'boss');
  assert.equal(auth.fromRequest({ headers: {} }), null);
  // 重新載入檔案後登入還有效；改密碼後舊的失效
  assert.equal(createAuth({ file }).verify(token).name, 'boss');
  auth.update('boss', { password: 'another-password' });
  assert.equal(auth.verify(token), null);
  assert.equal(auth.verify(auth.login('boss', 'another-password').token).name, 'boss');
}));

test('帳號：角色、停用、至少留一個管理者', () => temp(dir => {
  const auth = createAuth({ file: join(dir, 'users.json') });
  auth.create({ name: 'boss', password: 'correct-horse' }); auth.create({ name: 'amy', role: 'editor', password: 'password-123' });
  fails(() => auth.create({ name: 'bob', role: 'root', password: 'password-123' }), /角色/);
  fails(() => auth.update('boss', { role: 'editor' }), /至少要留一個/);
  fails(() => auth.update('boss', { disabled: true }), /至少要留一個/);
  fails(() => auth.remove('boss'), /至少要留一個/);
  const t = auth.login('amy', 'password-123').token;
  auth.update('amy', { role: 'admin' });
  assert.equal(auth.verify(t), null, '改角色後要重新登入');
  auth.update('boss', { role: 'viewer' });      // 現在有兩個管理者，可以降一個
  auth.update('amy', { display: '小艾' });
  assert.deepEqual(auth.list().map(u => [u.name, u.display, u.role, u.disabled]), [['boss', 'boss', 'viewer', false], ['amy', '小艾', 'admin', false]]);
  auth.update('boss', { disabled: true });
  fails(() => auth.login('boss', 'correct-horse'), /帳號或密碼不對/, 401);
  assert.deepEqual(auth.remove('boss'), { deleted: 'boss' });
  fails(() => auth.remove('nobody'), /找不到/, 404);
  auth.audit({ user: 'amy', method: 'POST', path: '/api/parts', status: 200 }); auth.audit({ user: 'amy', action: '登入' });
  assert.deepEqual(auth.recent().map(a => a.action || a.path), ['登入', '/api/parts'], '新的在前');
}));

test('權限：唯讀只能看、一般不能管帳號與設定、管理者全部', () => {
  for (const [role, method, path, ok] of [
    ['viewer', 'GET', ['projects'], true], ['viewer', 'POST', ['projects'], false], ['viewer', 'DELETE', ['parts', '3'], false], ['viewer', 'POST', ['auth', 'password'], true], ['viewer', 'GET', ['users'], false],
    ['editor', 'POST', ['projects', 'X', 'run'], true], ['editor', 'PUT', ['settings'], false], ['editor', 'GET', ['settings'], true], ['editor', 'POST', ['users'], false],
    ['admin', 'PUT', ['settings'], true], ['admin', 'DELETE', ['users', 'amy'], true],
  ]) assert.equal(denied(role, method, path) === null, ok, `${role} ${method} /api/${path.join('/')}`);
});

test('元件編號：唯一、流水、刪掉的不重用、可以用編號查', () => {
  const db = openPartsDb(':memory:');
  const a = db.createPart({ name: '甲' }), b = db.createPart({ name: '乙', model: 'M 100' });
  assert.deepEqual([a.code, b.code], ['P-00001', 'P-00002']);
  db.deletePart(b.id);
  assert.equal(db.createPart({ name: '丙' }).code, 'P-00003', '刪掉的 P-00002 不重用');
  assert.equal(db.updatePart(a.id, { name: '甲改', code: 'P-99999' }).code, 'P-00001', '編號不能改');
  assert.equal(db.getPart('p-00003').name, '丙');
  assert.throws(() => db.getPart('P-00002'), e => e.status === 404);
  assert.equal(db.listParts({ q: 'P-00003' }).total, 1);
  assert.equal(db.findSame(' 丙 ', '').code, 'P-00003');
  assert.throws(() => db.createPart({ name: '丁', status: '亂填' }), /狀態/);
  db.close();
});

test('提案元件自動匯入：沿用既有的、新的標待確認、不重複匯入', () => temp(dir => {
  const file = join(dir, 'parts.db'), db = openPartsDb(file);
  const cam = db.createPart({ name: '工業相機', brand: 'Basler', model: 'ace 2' }), plc = db.createPart({ name: 'PLC CPU', model: 'KV-X500' });
  const items = [
    { ref: cam.code, name: '相機（名稱不同也沒關係，看編號）', qty: 2, reason: '沿用' },
    { name: 'plc cpu', model: 'kv-x500', qty: 1 },                                       // 沒寫編號，但名稱與型號相同：沿用
    { name: '環形光源', model: '示意', spec: '白光', category: '光源', unit: '組', qty: 2, reason: '甲客戶要求白光' },
    { ref: 'P-99999', name: '編號不存在的', qty: 1 }, { model: '沒有名稱' },
  ];
  const r = importPlanParts(db, 'NewLine', items, { redact: s => s.split('甲客戶').join('（用戶）') });
  assert.deepEqual([r.reused, r.created, r.invalid], [2, 2, 1]);
  const light = db.getPart(db.listParts({ q: '環形光源' }).parts[0].id);
  assert.deepEqual([light.status, light.grp, light.code, light.selection_note], [PENDING, '視覺', 'P-00003', '（用戶）要求白光']);
  assert.deepEqual(light.usages.map(u => [u.project, u.source, u.item_code, u.qty, u.note]), [['NewLine', 'parts.json', '3', 2, '新元件']]);
  assert.deepEqual(db.getPart(cam.id).usages.map(u => [u.project, u.qty]), [['NewLine', 2]]);
  assert.equal(db.getPart(cam.id).status, '', '沿用的不會變成待確認');
  assert.equal(db.getPart(plc.id).usages.length, 1);
  assert.equal(db.facets().pending, 2);
  const again = importPlanParts(db, 'NewLine', items);
  assert.deepEqual([again.reused, again.created, again.existing], [0, 0, 4]);
  assert.equal(db.stats().parts, 4);
  db.close();
  // 從專案的元件表匯入；沒有元件表就不動資料庫
  const J = projectPaths((writeJson(join(dir, 'studio-workspace.json'), {}), dir), 'Other');
  assert.equal(importFromProject(J, { file: join(dir, 'none.db') }), null);
  assert.equal(existsSync(join(dir, 'none.db')), false);
  writeJson(join(J.plan, 'parts-segment2.json'), { parts: [{ ref: 'P-00001', name: '工業相機', qty: 1 }] });
  assert.deepEqual((({ reused, created }) => [reused, created])(importFromProject(J, { file })), [1, 0]);
}));

test('core 共用模型清單：id、名稱、分類與雜湊；縮圖狀態', () => {
  const models = coreModels(join(REPO, 'core'));
  assert.ok(models.length >= 10);
  const cam = models.find(m => m.id === 'camera');
  assert.equal(cam.category, '視覺'); assert.match(cam.hash, /^[0-9a-f]{12}$/);
  assert.ok(models.some(m => m.id === 'denso-vs068'));
  assert.equal(new Set(models.map(m => m.id)).size, models.length, 'id 不重複');
  process.env.VS3D_THUMBS = join(tmpdir(), 'vs3d-no-thumbs');
  try { assert.ok(withThumbs(models).every(m => !m.thumb && m.stale)); } finally { delete process.env.VS3D_THUMBS; }
});
