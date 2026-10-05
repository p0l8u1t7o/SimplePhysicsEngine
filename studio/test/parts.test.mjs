// 元件資料庫：資料層（新增、修改、刪除、查詢、合併）、HTTP 介面、成本表匯入。
//   node --test studio/test/parts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openPartsDb, PartsError } from '../lib/partsdb.mjs';
import { createPartsApi } from '../lib/parts-api.mjs';
import { readCostSheet, collectCostTables, seedFromCostTables, guessCategory, guessBrands, skipReason } from '../lib/parts-seed.mjs';
import { sheetXlsx } from './office-fixtures.mjs';

const xlsxFile = (file, sheet, rows) => writeFileSync(file, sheetXlsx(sheet, rows));
const sample = db => {
  const s = db.createSupplier({ name: '甲代理商', kind: '代理商', lead_time: '4 週' });
  const cam = db.createPart({ name: '工業相機', category: '相機與讀碼', brand: 'Basler', model: 'ace 2', unit: '台', attrs: { 解析度: '500 萬畫素', 介面: 'GigE' } });
  db.addPrice(cam.id, { unit_price: 20000, grade: 'b', quoted_on: '2026-09-01', supplier_id: s.id, source: 'Q-001' });
  db.addPrice(cam.id, { unit_price: 21500, quoted_on: '2026-10-01' });
  db.addUsage(cam.id, { project: 'RecycleSorter', source: 'integration-cost.xlsx', item_code: '2-01', qty: 4, reason: '兩站各一組立體對' });
  const lens = db.createPart({ name: '鏡頭 100%_測試', spec: '8 mm' });
  return { s, cam, lens };
};

test('元件、價格、使用紀錄、供應商的新增與查詢', () => {
  const db = openPartsDb(':memory:'), { s, cam, lens } = sample(db);
  const got = db.getPart(cam.id);
  assert.deepEqual(got.attrs, { 解析度: '500 萬畫素', 介面: 'GigE' });
  assert.deepEqual(got.prices.map(p => p.unit_price), [21500, 20000]);        // 新的在前
  assert.equal(got.prices[1].grade, 'B'); assert.equal(got.prices[1].supplier, '甲代理商');
  const list = db.listParts();
  assert.equal(list.total, 2);
  const row = list.parts.find(p => p.id === cam.id);
  assert.equal(row.unit_price, 21500, '清單的參考單價取最新一筆');
  assert.equal(row.price_count, 2); assert.deepEqual(row.projects, ['RecycleSorter']);
  assert.deepEqual(list.categories, [{ name: '', count: 1 }, { name: '相機與讀碼', count: 1 }]);
  // 關鍵字：每個都要符合；可以比對規格欄位、專案、編號、供應商、報價來源
  for (const [q, n] of [['basler gige', 1], ['basler 鏡頭', 0], ['recyclesorter 2-01', 1], ['甲代理', 1], ['Q-001', 1], ['100%_', 1], ['%', 1], ['_', 1], ['500 萬', 1]]) assert.equal(db.listParts({ q }).total, n, q);
  assert.equal(db.listParts({ category: '（未分類）' }).parts[0].id, lens.id);
  assert.equal(db.listParts({ project: 'RecycleSorter' }).total, 1);
  assert.equal(db.listParts({ supplier: s.id }).total, 1);
  assert.deepEqual(db.stats(), { parts: 2, prices: 2, usages: 1, suppliers: 1 });
  db.close();
});

test('修改、刪除與驗證', () => {
  const db = openPartsDb(':memory:'), { s, cam } = sample(db);
  assert.equal(db.updatePart(cam.id, { name: '工業相機', model: 'ace 2 a2A2448', attrs: { 介面: 'GigE PoE' } }).model, 'ace 2 a2A2448');
  assert.deepEqual(db.getPart(cam.id).attrs, { 介面: 'GigE PoE' });
  const [p1] = db.getPart(cam.id).prices;
  assert.equal(db.updatePrice(p1.id, { unit_price: '22000', currency: 'usd', valid_until: '2026-12-31' }).currency, 'USD');
  const bad = (fn, re) => assert.throws(fn, e => e instanceof PartsError && e.status === 400 && re.test(e.message));
  bad(() => db.createPart({ name: '  ' }), /名稱/);
  bad(() => db.addPrice(cam.id, { unit_price: 'abc' }), /數字/);
  bad(() => db.addPrice(cam.id, { unit_price: -1 }), /負數/);
  bad(() => db.addPrice(cam.id, { unit_price: 1, grade: 'D' }), /等級/);
  bad(() => db.addPrice(cam.id, { unit_price: 1, quoted_on: '2026/10/01' }), /日期/);
  bad(() => db.addUsage(cam.id, { project: '' }), /專案/);
  bad(() => db.createSupplier({ name: '甲代理商' }), /同名/);
  assert.throws(() => db.getPart(999), e => e.status === 404);
  assert.throws(() => db.addPrice(cam.id, { unit_price: 1, supplier_id: 999 }), e => e.status === 404);
  // 刪除供應商：價格紀錄留著
  db.deleteSupplier(s.id);
  assert.deepEqual(db.getPart(cam.id).prices.map(p => p.supplier_id), [null, null]);
  // 刪除元件：價格與使用紀錄一起刪
  db.deletePart(cam.id);
  assert.deepEqual(db.stats(), { parts: 1, prices: 0, usages: 0, suppliers: 0 });
  db.close();
});

test('合併重複的元件', () => {
  const db = openPartsDb(':memory:'), { cam, lens } = sample(db);
  db.addPrice(lens.id, { unit_price: 6500 });
  db.addUsage(lens.id, { project: 'MilitaryGradePC', item_code: '2-02' });
  const m = db.mergeParts(cam.id, lens.id);
  assert.equal(m.spec, '8 mm', '保留的元件空白欄位用併入的補上');
  assert.equal(m.name, '工業相機');
  assert.equal(m.prices.length, 3); assert.equal(m.usages.length, 2);
  assert.equal(db.stats().parts, 1);
  assert.throws(() => db.mergeParts(cam.id, cam.id), /自己/);
  db.close();
});

test('資料庫檔可以重新開啟；版本較新時拒絕', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-parts-')), file = join(dir, 'sub', 'parts.db');
  try {
    let db = openPartsDb(file); sample(db); db.close();
    db = openPartsDb(file); assert.equal(db.stats().parts, 2);
    db.close();
    const raw = new DatabaseSync(file); raw.exec('PRAGMA user_version = 99'); raw.close();
    assert.throws(() => openPartsDb(file), /比這個程式新/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP 介面：路由、錯誤代碼', async () => {
  const api = createPartsApi(':memory:');
  const call = (method, path, body) => { const u = new URL(path, 'http://x'); return api.handle({ method, seg: u.pathname.split('/').filter(Boolean).slice(1), query: u.searchParams, body: async () => body }); };
  let r = await call('POST', '/api/parts', { name: 'PLC CPU', brand: 'Keyence', category: '控制器與 I/O' });
  assert.equal(r.code, 200); const id = r.body.id;
  r = await call('POST', '/api/suppliers', { name: '乙經銷商' }); const sid = r.body.id;
  r = await call('POST', `/api/parts/${id}/prices`, { unit_price: 85000, supplier_id: sid }); assert.equal(r.code, 200); const pid = r.body.id;
  r = await call('POST', `/api/parts/${id}/usages`, { project: 'MilitaryGradePC', item_code: '6-01', qty: 1 }); const uid = r.body.id;
  r = await call('GET', '/api/parts?q=keyence&project=MilitaryGradePC');
  assert.equal(r.body.total, 1); assert.equal(r.body.parts[0].supplier, '乙經銷商'); assert.ok(r.body.grades.includes('A'));
  assert.equal((await call('PUT', `/api/prices/${pid}`, { unit_price: 90000, supplier_id: sid })).body.unit_price, 90000);     // PUT 是整筆取代
  assert.equal((await call('PUT', `/api/usages/${uid}`, { project: 'MilitaryGradePC', qty: 2 })).body.qty, 2);
  assert.equal((await call('PUT', `/api/parts/${id}`, { name: '' })).code, 400);
  assert.equal((await call('GET', '/api/parts/abc')).code, 404);
  assert.equal((await call('PATCH', '/api/parts')).code, 404);
  assert.equal((await call('GET', '/api/suppliers')).body.suppliers[0].part_count, 1);
  assert.equal((await call('DELETE', `/api/usages/${uid}`)).code, 200);
  assert.equal((await call('DELETE', `/api/prices/${pid}`)).code, 200);
  assert.equal((await call('DELETE', `/api/suppliers/${sid}`)).code, 200);
  assert.equal((await call('DELETE', `/api/parts/${id}`)).code, 200);
  assert.equal((await call('GET', '/api/parts')).body.total, 0);
  api.close();
});

test('成本表匯入：只匯採購品項、同品項合併、可重複執行、遮掉用戶名稱', () => {
  const repo = mkdtempSync(join(tmpdir(), 'vs3d-seed-')), docs = join(repo, 'project-site', 'Demo', 'docs');
  mkdirSync(docs, { recursive: true });
  try {
    xlsxFile(join(docs, 'cost-estimate.xlsx'), '明細', [
      ['編號', '子系統', '項目', '規格要求', '建議選型', '選型理由', '數量', '單位', '單價 NT$', '小計 NT$', '等級'],
      ['1-01', '1 手臂', 'SCARA 手臂＋控制器', '動作範圍 600 mm', 'DENSO HSR065＋RC8A', '甲客戶指定', 1, '套', 950000, '', 'B'],
      ['2-01', '2 視覺', '工業相機', '500 萬畫素', 'Basler ace 2', '', 2, '台', 20000, '', 'A'],
      ['2-02', '2 視覺', '相機支架', '鋁擠', '自製', '', 1, '式', 12000, '', 'C'],
      ['2-03', '2 視覺', '校正治具', '標定片', '自製＋玻璃標定片', '', 1, '式', 40000, '', 'B'],
      ['6-01', '6 工程', '機構設計', '', '—', '', 30, '人日', 8000, '', 'B'],
      ['6-02', '6 工程', '運輸與安裝', '', '—', '', 1, '式', 60000, '', 'C'],
      ['7-01', '7 選配', '備用相機', '同 2-01', '同 2-01', '', 0, '台', 20000, '', 'A'],
    ]);
    xlsxFile(join(docs, 'vision-items.xlsx'), '品項表', [
      ['編號', '類別', '品項', '規格', '建議選型（同級品可）', '前段站', '後段站', '兩站共用', '數量合計', '單位', '單價 NT$', '範圍', '對應成本表', '備註'],
      ['V-01', '1 取像', '工業相機（立體對）', '500 萬畫素', 'Basler ace 2 同級', 2, 2, 0, '', '台', 20000, '基本', '2-01', '四台同型號'],
      ['V-02', '1 取像', '鏡頭', '8 mm', '同級品', 2, 2, 1, '', '顆', 6500, '基本', '本表新增', ''],
    ]);
    const tables = collectCostTables(repo);
    assert.deepEqual(tables.map(t => [t.project, t.source, t.rows.length]), [['Demo', 'cost-estimate.xlsx', 7], ['Demo', 'vision-items.xlsx', 2]]);
    assert.equal(readCostSheet(join(docs, 'vision-items.xlsx'))[1].qty, 5, '數量合計沒有值時用分站數量加總');
    const db = openPartsDb(':memory:');
    const dry = seedFromCostTables(db, tables, { dryRun: true });
    assert.equal(dry.parts, 4); assert.equal(db.stats().parts, 0, '試跑不寫入');
    const r = seedFromCostTables(db, tables, { names: ['甲客戶'] });
    assert.deepEqual(r.skipped, { 純自製一式: 1, 工程人日: 1, 工程類: 1 });
    assert.equal(r.parts, 4); assert.equal(r.merged, 2); assert.equal(r.usages, 6);
    const cam = db.getPart(db.listParts({ q: '工業相機' }).parts[0].id);
    assert.equal(cam.brand, 'Basler'); assert.equal(cam.category, '相機與讀碼');
    assert.deepEqual(cam.usages.map(u => [u.source, u.item_code, u.qty, u.note]), [['cost-estimate.xlsx', '2-01', 2, ''], ['cost-estimate.xlsx', '7-01', 0, '選配'], ['vision-items.xlsx', 'V-01', 4, '']]);
    assert.equal(cam.prices.length, 1, '同專案同單價只記一筆'); assert.equal(cam.prices[0].grade, 'A'); assert.match(cam.prices[0].source, /^Demo cost-estimate\.xlsx 2-01$/);
    const arm = db.getPart(db.listParts({ q: 'SCARA' }).parts[0].id);
    assert.equal(arm.category, '機器人'); assert.equal(arm.usages[0].reason, '（用戶）指定');
    assert.equal(db.listParts({ q: '校正治具' }).parts[0].tags, '自製');
    const again = seedFromCostTables(db, tables);
    assert.equal(again.parts + again.usages + again.prices, 0); assert.equal(again.existing, 6); assert.equal(db.stats().parts, 4);
    db.close();
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('類別、廠牌與不匯入的判斷', () => {
  for (const [name, cat] of [['手臂相機鏡頭', '鏡頭與光學'], ['相機防塵罩', '機構與結構'], ['六軸手臂＋控制器＋教導器', '機器人'], ['安全控制器', '安全'], ['頻閃光源控制器', '光源'],
    ['RC8A 力覺柔順控制授權', '軟體與授權'], ['手臂可動電纜', '線材與耗材'], ['DD 中空軸馬達＋驅動器', '運動與驅動'], ['不知道是什麼', '']]) assert.equal(guessCategory(name), cat, name);
  assert.equal(guessCategory('自動上下料', 'DENSO SCARA'), '機器人');
  assert.deepEqual(guessBrands('Keyence KV-X＋SMC 閥島'), ['Keyence', 'SMC']);
  assert.deepEqual(guessBrands('ABB delta robot'), ['ABB']);
  const row = { code: '1-01', name: 'x', unit: '式', model: '自製', kind: '', subsystem: '' };
  assert.equal(skipReason(row), '純自製一式');
  assert.equal(skipReason({ ...row, model: '自製＋滑軌' }), null);
  assert.equal(skipReason({ ...row, unit: '組' }), null);
  assert.equal(skipReason({ ...row, model: 'x', kind: '工程' }), '工程類');
});
