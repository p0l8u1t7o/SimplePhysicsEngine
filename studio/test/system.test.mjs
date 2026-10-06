// 系統設定與附件（評估平台 Q1）：資料庫第 4 版升級（舊附件搬家、自動備份、舊檔名改名）、附件的類型與大小上限、
// 同內容只存一份、報價單連價格紀錄、封面圖、系統設定的驗證與權限。
//   node --test studio/test/system.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openPartsDb, PartsError, fileType } from '../lib/partsdb.mjs';
import { createPartsApi } from '../lib/parts-api.mjs';
import { readSystem, cleanSystem, attachmentRule, systemDefaults } from '../lib/settings.mjs';
import { denied } from '../lib/auth.mjs';

const temp = fn => { const dir = mkdtempSync(join(tmpdir(), 'vs3d-sys-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const sha = b => createHash('sha256').update(b).digest('hex');

// 第 3 版的結構（附件存在 parts-files/<id>-<檔名>）
const V3_DDL = `
CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, kind TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', lead_time TEXT NOT NULL DEFAULT '', payment_terms TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE parts (id INTEGER PRIMARY KEY, category TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', attrs TEXT NOT NULL DEFAULT '{}', unit TEXT NOT NULL DEFAULT '', selection_note TEXT NOT NULL DEFAULT '', alternatives TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL DEFAULT '');
CREATE TABLE prices (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL, quoted_on TEXT NOT NULL DEFAULT '', unit_price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'TWD', grade TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', valid_until TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE usages (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, project TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', item_code TEXT NOT NULL DEFAULT '', subsystem TEXT NOT NULL DEFAULT '', qty REAL, reason TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE files (id INTEGER PRIMARY KEY, part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', added_at TEXT NOT NULL);
CREATE UNIQUE INDEX parts_code ON parts(code);
CREATE VIEW part_latest AS SELECT p.*, pr.id AS price_id, pr.unit_price, pr.currency, pr.grade, pr.quoted_on, pr.valid_until, pr.source AS price_source, pr.supplier_id, s.name AS supplier FROM parts p LEFT JOIN prices pr ON pr.id = (SELECT id FROM prices WHERE part_id = p.id ORDER BY quoted_on DESC, id DESC LIMIT 1) LEFT JOIN suppliers s ON s.id = pr.supplier_id;
INSERT INTO meta VALUES ('code_seq', 1);
INSERT INTO parts (id, code, category, grp, name, created_at, updated_at) VALUES (1, 'P-00001', '相機與讀碼', '視覺', '工業相機', 't', 't');
INSERT INTO prices (part_id, unit_price, created_at) VALUES (1, 20000, 't');
INSERT INTO files (id, part_id, name, size, added_at) VALUES (1, 1, '支架.step', 4, 't'), (2, 1, '照片.jpg', 3, 't');
PRAGMA user_version = 3;`;

test('第 3 版升級：舊檔名改名、先備份、附件搬到 files/<SHA-256>、封面圖欄位', () => temp(dir => {
  const old = join(dir, 'parts.db'), raw = new DatabaseSync(old); raw.exec(V3_DDL); raw.close();
  mkdirSync(join(dir, 'parts-files'));
  writeFileSync(join(dir, 'parts-files', '1-支架.step'), 'STEP'); writeFileSync(join(dir, 'parts-files', '2-照片.jpg'), 'JPG');
  const db = openPartsDb(join(dir, 'studio.db'));
  assert.ok(existsSync(join(dir, 'studio.db')) && !existsSync(old), '舊檔名 parts.db 改成 studio.db');
  assert.ok(existsSync(join(dir, 'studio.db.bak-v3')), '升級前自動備份');
  assert.ok(!existsSync(join(dir, 'parts-files')), '舊的附件資料夾搬空後移除');
  const p = db.getPart(1);
  assert.deepEqual(p.files.map(f => [f.name, f.kind, f.sha256]), [['支架.step', 'cad', sha('STEP')], ['照片.jpg', 'image', sha('JPG')]]);
  assert.equal(readFileSync(db.fileOf(1).path, 'utf8'), 'STEP');
  assert.equal(db.listParts().parts[0].cover_file_id, null, '檢視表看得到新欄位');
  assert.equal(db.updatePart(1, { ...p, cover_file_id: 2 }).cover_file_id, 2);
  db.close();
  const again = openPartsDb(join(dir, 'studio.db')); assert.equal(again.getPart(1).files.length, 2); again.close();
  assert.equal(readdirSync(dir).filter(f => f.includes('.bak-')).length, 1, '升級只做一次，不重複備份');
}));

test('附件：同內容只存一份、報價單連價格紀錄、封面圖只能是自己的圖片', () => temp(dir => {
  const db = openPartsDb(join(dir, 'studio.db'));
  const a = db.createPart({ name: '鏡頭' }), b = db.createPart({ name: '光源' });
  const price = db.addPrice(a.id, { unit_price: 12000 }), other = db.addPrice(b.id, { unit_price: 1 });
  const q = db.addFile(a.id, { name: '報價單.pdf', data: Buffer.from('PDF'), kind: 'quote', priceId: price.id, by: 'amy' });
  assert.deepEqual([q.kind, q.price_id, q.uploaded_by, q.mime], ['quote', price.id, 'amy', 'application/pdf']);
  const img = db.addFile(a.id, { name: 'a.png', data: Buffer.from('PNG') }), dup = db.addFile(b.id, { name: 'b.png', data: Buffer.from('PNG') });
  assert.equal(img.kind, 'image', '沒指定用途就依副檔名猜');
  assert.equal(readdirSync(join(dir, 'files')).length, 2, '內容相同的兩個附件只存一份');
  assert.throws(() => db.addFile(a.id, { name: 'x.pdf', data: Buffer.from('1'), kind: '亂寫' }), /附件類型/);
  assert.throws(() => db.updateFile(q.id, { price_id: other.id }), /這個元件的/);
  assert.equal(db.updateFile(q.id, { kind: 'datasheet', note: '型錄' }).price_id, price.id, '沒給的欄位不變');
  assert.throws(() => db.updatePart(a.id, { name: '鏡頭', cover_file_id: q.id }), /圖片/);
  assert.throws(() => db.updatePart(a.id, { name: '鏡頭', cover_file_id: dup.id }), /這個元件/);
  assert.equal(db.updatePart(a.id, { name: '鏡頭', cover_file_id: img.id }).cover_file_id, img.id);
  db.deleteFile(img.id);
  assert.equal(db.getPart(a.id).cover_file_id, null, '封面圖的附件刪掉後清空');
  assert.ok(existsSync(db.fileOf(dup.id).path), '另一個元件還在用同樣的內容，檔案留著');
  db.deletePrice(price.id);
  assert.equal(db.getPart(a.id).files[0].price_id, null, '價格紀錄刪掉後附件留著、不再連過去');
  db.deletePart(b.id);
  assert.equal(readdirSync(join(dir, 'files')).length, 1, '沒人用的內容跟著刪掉');
  db.close();
}));

test('系統設定：預設值、驗證、寫入後讀得到；附件規則依類型給上限', () => {
  const db = openPartsDb(':memory:');
  assert.deepEqual(readSystem(db), systemDefaults());
  assert.equal(readSystem(db)['attachment.maxMB'], 20); assert.equal(readSystem(db)['attachment.cadMaxMB'], 300);
  assert.throws(() => cleanSystem({ 'attachment.maxMB': 0 }), /1～2048/);
  assert.throws(() => cleanSystem({ 'attachment.types': ['exe'] }), /只能從/);
  assert.throws(() => cleanSystem({ 'cost.gradeRange': { A: 0.1, B: 2, C: 0.3 } }), /B/);
  assert.throws(() => cleanSystem({ 不存在: 1 }), /不認得/);
  db.writeSettings(cleanSystem({ 'attachment.maxMB': '5', 'attachment.types': ['image', 'pdf'] }), 'boss');
  const s = readSystem(db);
  assert.equal(s['attachment.maxMB'], 5); assert.deepEqual(s['attachment.types'], ['image', 'pdf']);
  assert.deepEqual(attachmentRule(s, fileType('照片.JPG')), { type: 'image', limit: 5 * 1048576, mb: 5 });
  assert.throws(() => attachmentRule(s, fileType('支架.step')), /不接受/, '類型被關掉就不能上傳');
  assert.throws(() => attachmentRule(s, fileType('setup.exe')), /不接受/);
  assert.equal(attachmentRule(systemDefaults(), 'cad').mb, 300);
  db.close();
});

test('HTTP 介面：上傳依上限擋下、inline 只給圖片與 PDF、系統設定；只有管理者能改系統設定', async () => temp(async dir => {
  const api = createPartsApi(join(dir, 'studio.db'));
  const call = (method, path, { body, data, user } = {}) => {
    const u = new URL(path, 'http://x');
    const raw = async limit => { if (data.length > limit) throw Object.assign(new Error('too large'), { code: 'TOO_LARGE' }); return data; };
    return api.handle({ method, seg: u.pathname.split('/').filter(Boolean).slice(1), query: u.searchParams, body: async () => body, raw, user });
  };
  const id = (await call('POST', '/api/parts', { body: { name: '相機' } })).body.id;
  assert.equal((await call('PUT', '/api/system', { body: { 'attachment.maxMB': 1 }, user: { name: 'boss' } })).body.values['attachment.maxMB'], 1);
  let r = await call('POST', `/api/parts/${id}/files?name=big.pdf`, { data: Buffer.alloc(1048577) });
  assert.equal(r.code, 413); assert.match(r.body.error, /1 MB/);
  r = await call('POST', `/api/parts/${id}/files?name=big.step`, { data: Buffer.alloc(1048577) });
  assert.equal(r.code, 200, 'CAD 檔用自己的上限（300 MB）');
  assert.equal((await call('POST', `/api/parts/${id}/files?name=run.exe`, { data: Buffer.from('MZ') })).code, 400);
  r = await call('POST', `/api/parts/${id}/files?name=p.png&kind=image`, { data: Buffer.from('PNG'), user: { name: 'amy' } });
  assert.equal(r.body.uploaded_by, 'amy');
  const png = await call('GET', `/api/parts/${id}/files/${r.body.id}?inline=1`), step = await call('GET', `/api/parts/${id}/files/1?inline=1`);
  assert.deepEqual([png.file.inline, png.file.mime], [true, 'image/png']);
  assert.equal(step.file.inline, false, 'CAD 檔一律下載');
  assert.equal((await call('PUT', `/api/files/${r.body.id}`, { body: { kind: 'other' } })).body.kind, 'other');
  assert.equal((await call('PUT', '/api/system', { body: { 'attachment.maxMB': 'x' } })).code, 400);
  assert.ok((await call('GET', '/api/system')).body.fileTypes.cad.ext.includes('step'));
  api.close();
  assert.match(denied('editor', 'PUT', ['system']), /管理者/);
  assert.equal(denied('editor', 'GET', ['system']), null);
  assert.equal(denied('admin', 'PUT', ['system']), null);
}));

test('記憶體資料庫不能存附件', () => {
  const db = openPartsDb(':memory:'), p = db.createPart({ name: 'x' });
  assert.throws(() => db.addFile(p.id, { name: 'a.pdf', data: Buffer.from('1') }), e => e instanceof PartsError && /記憶體/.test(e.message));
  db.close();
});
