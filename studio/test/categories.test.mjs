// 元件的分類樹、欄位範本、關聯件與模組（評估平台 Q2）。
//   node --test studio/test/categories.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPartsDb, PartsError } from '../lib/partsdb.mjs';

const bad = (fn, re, status = 400) => assert.throws(fn, e => e instanceof PartsError && e.status === status && re.test(e.message), re);

test('分類：新增、同層不重名、最多 4 層、改名與搬家會同步元件的文字欄位、刪除的條件', () => {
  const db = openPartsDb(':memory:'), C = db.categories;
  const vision = db.tree().nodes.find(n => n.name === '視覺');
  const lens = vision.children.find(n => n.name === '鏡頭與光學');
  const tele = C.createCategory({ parent_id: lens.id, name: '遠心鏡頭' });
  assert.deepEqual(tele.path, ['視覺', '鏡頭與光學', '遠心鏡頭']);
  bad(() => C.createCategory({ parent_id: lens.id, name: '遠心鏡頭' }), /同一層/);
  bad(() => C.createCategory({ parent_id: lens.id, name: ' ' }), /名稱/);
  const l4 = C.createCategory({ parent_id: tele.id, name: '雙遠心' });
  bad(() => C.createCategory({ parent_id: l4.id, name: '第五層' }), /最多 4 層/);
  const p = db.createPart({ name: '0.35× 遠心鏡頭', category_id: l4.id });
  assert.deepEqual([p.grp, p.category, p.category_path.length], ['視覺', '雙遠心', 4], '文字欄位是最上層與最下層');
  // 改名、搬家：文字欄位跟著變；不能搬到自己底下、不能超過層數
  C.updateCategory(tele.id, { name: '遠心' });
  assert.deepEqual(db.getPart(p.id).category_path, ['視覺', '鏡頭與光學', '遠心', '雙遠心']);
  bad(() => C.updateCategory(lens.id, { parent_id: l4.id }), /自己/);
  const second = C.createCategory({ parent_id: C.createCategory({ name: '頂層' }).id, name: '第二層' });
  C.updateCategory(tele.id, { parent_id: second.id });                       // 遠心（含子分類）搬到第 3 層：子分類在第 4 層，剛好可以
  const third = C.createCategory({ parent_id: second.id, name: '第三層' });
  bad(() => C.updateCategory(tele.id, { parent_id: third.id }), /超過 4 層/);   // 再往下一層，子分類會到第 5 層
  C.updateCategory(tele.id, { parent_id: null });
  assert.equal(db.getPart(p.id).grp, '遠心', '搬到最上層之後群組變成它');
  // 刪除：有子分類或元件時拒絕
  bad(() => C.deleteCategory(tele.id), /子分類/);
  bad(() => C.deleteCategory(l4.id), /1 個元件/);
  db.updatePart(p.id, { name: p.name, category_id: null });
  assert.equal(db.getPart(p.id).grp, '', '改成未分類');
  C.deleteCategory(l4.id); C.deleteCategory(tele.id);
  bad(() => C.getCategory(tele.id), /找不到/, 404);
  bad(() => db.createPart({ name: 'x', category_id: 99999 }), /找不到分類/, 404);
  db.close();
});

test('欄位範本：預設的光學欄位、子分類繼承、不能重複、數字與是否的檢查只看有改動的值、必填', () => {
  const db = openPartsDb(':memory:'), C = db.categories;
  const cam = db.tree().nodes.find(n => n.name === '視覺').children.find(n => n.name === '相機與讀碼');
  assert.ok(C.fieldsOf(cam.id).some(f => f.key === '像素尺寸' && f.type === 'number' && f.unit === 'µm'), '相機的預設欄位');
  const area = C.createCategory({ parent_id: cam.id, name: '面掃描相機' });
  C.setFields(area.id, [{ key: '曝光時間下限', type: 'number', unit: 'µs', required: true }, { key: '觸發', type: 'bool' }]);
  const fields = C.fieldsOf(area.id);
  assert.equal(fields[0].from, '相機與讀碼', '上層的欄位在前'); assert.equal(fields.at(-1).key, '觸發');
  bad(() => C.setFields(area.id, [{ key: '像素尺寸' }]), /重複/);
  bad(() => C.setFields(cam.id, [...C.getCategory(cam.id).fields, { key: '觸發', type: 'bool' }]), /子分類/);
  bad(() => C.setFields(area.id, [{ key: '介面2', type: 'select', options: '' }]), /至少一個選項/);
  bad(() => C.setFields(area.id, [{ key: 'x', type: 'color' }]), /型別/);
  bad(() => db.createPart({ name: '相機', category_id: area.id, attrs: { 像素尺寸: '3.45 µm' } }), /像素尺寸.*數字.*µm/);
  bad(() => db.createPart({ name: '相機', category_id: area.id, attrs: { 觸發: 'yes' } }), /是.*否/);
  const p = db.createPart({ name: '相機', category_id: area.id, attrs: { 像素尺寸: '3.45', 介面: 'GigE PoE' } });
  assert.equal(p.attrs.介面, 'GigE PoE', '選項只是建議，可以填別的值');
  assert.deepEqual(p.missing, ['曝光時間下限'], '必填但沒填');
  assert.equal(p.fields.length, fields.length);
  // 舊資料：不是數字的值沒改動就存得回去；改了才檢查
  db.categories.setFields(area.id, [{ key: '曝光時間下限', type: 'number' }, { key: '觸發', type: 'bool' }, { key: '鏡頭', type: 'number' }]);
  const raw = db.createPart({ name: '舊相機', attrs: { 鏡頭: 'C 接口' } });
  db.updatePart(raw.id, { name: '舊相機', category_id: area.id, attrs: { 鏡頭: 'C 接口' } });
  bad(() => db.updatePart(raw.id, { name: '舊相機', category_id: area.id, attrs: { 鏡頭: 'CS 接口' } }), /鏡頭.*數字/);
  db.close();
});

test('模組與關聯件：子件、循環檢查、子件加總單價、雙向的替代與相容、種類切換的限制', () => {
  const db = openPartsDb(':memory:'), L = db.links;
  const cam = db.createPart({ name: '工業相機' }), lens = db.createPart({ name: '遠心鏡頭' }), light = db.createPart({ name: '同軸光' }), cable = db.createPart({ name: '線材' });
  db.addPrice(cam.id, { unit_price: 30000 }); db.addPrice(lens.id, { unit_price: 50000 }); db.addPrice(cable.id, { unit_price: 800 }); db.addPrice(light.id, { unit_price: 300, currency: 'USD' });
  const mod = db.createPart({ name: '上視相機組', kind: 'module', price_mode: 'sum' });
  bad(() => L.addLink(cam.id, { related: lens.id, rel: 'component' }), /只有「模組」/);
  for (const [r, qty] of [[cam, 1], [lens, 1], [cable, 2]]) L.addLink(mod.id, { related: r.code, rel: 'component', qty });
  bad(() => L.addLink(mod.id, { related: cam.id, rel: 'component' }), /已經有/);
  bad(() => L.addLink(mod.id, { related: mod.id, rel: 'component' }), /自己/);
  bad(() => L.addLink(mod.id, { related: cable.id, rel: 'component', qty: 0 }), /已經有|大於 0/);
  assert.deepEqual(L.sumPrice(mod.id), { total: 81600, currency: 'TWD', missing: [], foreign: [] });
  L.addLink(mod.id, { related: light.id, rel: 'component' });
  assert.deepEqual(L.sumPrice(mod.id).foreign, [light.code], '外幣的子件標出來、不加進去');
  const row = db.listParts().parts.find(p => p.id === mod.id);
  assert.deepEqual([row.unit_price, row.price_source, row.component_count], [81600, '子件加總', 4], '清單的參考單價換成子件加總');
  // 多層模組與循環
  const station = db.createPart({ name: '視覺站', kind: 'module', price_mode: 'sum' });
  L.addLink(station.id, { related: mod.id, rel: 'component', qty: 2 });
  assert.equal(L.sumPrice(station.id).total, 163200);
  bad(() => L.addLink(mod.id, { related: station.id, rel: 'component' }), /循環/);
  // 雙向的替代：反過來加也算重複
  const alt = db.createPart({ name: '另一款相機' });
  L.addLink(cam.id, { related: alt.id, rel: 'alternative', note: '交期短' });
  bad(() => L.addLink(alt.id, { related: cam.id, rel: 'alternative' }), /已經有/);
  assert.equal(db.getPart(alt.id).links.alternatives[0].code, cam.code, '從另一端也看得到');
  assert.deepEqual(db.getPart(cam.id).links.usedIn.map(x => x.code), [mod.code], '子件看得到用在哪些模組');
  L.addLink(cam.id, { related: cable.id, rel: 'accessory', qty: 2 });
  assert.equal(db.getPart(cable.id).links.accessoryOf[0].code, cam.code);
  bad(() => L.addLink(cam.id, { related: cable.id, rel: '朋友' }), /關係只能是/);
  // 種類：模組還有子件時不能改回一般；一般元件的單價算法固定是自己的報價
  bad(() => db.updatePart(mod.id, { name: '上視相機組', kind: 'part' }), /先移除子件/);
  assert.equal(db.updatePart(cam.id, { name: '工業相機', price_mode: 'sum' }).price_mode, 'own');
  // 更新與刪除關聯；刪除子件時關聯跟著刪
  const link = db.getPart(mod.id).links.components.find(c => c.code === cable.code);
  assert.equal(L.updateLink(link.id, { qty: 3 }).qty, 3);
  db.deletePart(cable.id);
  assert.equal(db.getPart(mod.id).links.components.length, 3);
  L.deleteLink(db.getPart(mod.id).links.components.find(c => c.code === light.code).id);
  assert.equal(db.getPart(mod.id).sum.total, 80000);
  db.close();
});

test('代理提案帶進來的類別不自動建分類：找得到就放、找不到放群組底下或未分類', () => {
  const db = openPartsDb(':memory:');
  const a = db.createPart({ name: 'x', category: '相機與讀碼' }, { createCategory: false });
  const b = db.createPart({ name: 'y', category: '不存在的類別' }, { createCategory: false });
  const c = db.createPart({ name: 'z', grp: '視覺', category: '新的類別' }, { createCategory: false });
  assert.deepEqual([a.category_path, b.category_path, c.category_path], [['視覺', '相機與讀碼'], [], ['視覺']]);
  assert.ok(!db.tree().nodes.some(n => n.name === '其他'), '沒有因此建立新分類');
  db.close();
});

test('HTTP 介面：分類、欄位範本、關聯件的路由；分類只有管理者能改', async () => {
  const { createPartsApi } = await import('../lib/parts-api.mjs'), { denied } = await import('../lib/auth.mjs');
  const api = createPartsApi(':memory:');
  const call = (method, path, body) => { const u = new URL(path, 'http://x'); return api.handle({ method, seg: u.pathname.split('/').filter(Boolean).slice(1), query: u.searchParams, body: async () => body }); };
  const tree = (await call('GET', '/api/categories')).body;
  assert.ok(tree.nodes.length >= 6 && tree.fieldTypes.number === '數字');
  const c = (await call('POST', '/api/categories', { name: '自訂群組' })).body;
  assert.equal((await call('PUT', `/api/categories/${c.id}/fields`, { fields: [{ key: '行程', type: 'number', unit: 'mm' }] })).body.fields[0].unit, 'mm');
  assert.equal((await call('PUT', `/api/categories/${c.id}`, { name: '改名的群組' })).body.name, '改名的群組');
  assert.equal((await call('POST', '/api/categories', { name: '改名的群組' })).code, 400);
  const m = (await call('POST', '/api/parts', { name: '模組', kind: 'module', category_id: c.id })).body, x = (await call('POST', '/api/parts', { name: '子件' })).body;
  const l = (await call('POST', `/api/parts/${m.id}/links`, { related: x.code, rel: 'component', qty: 2 })).body;
  assert.equal((await call('PUT', `/api/links/${l.id}`, { qty: 3 })).body.qty, 3);
  assert.equal((await call('GET', `/api/parts/${m.id}`)).body.links.components[0].qty, 3);
  assert.equal((await call('DELETE', `/api/links/${l.id}`)).code, 200);
  assert.equal((await call('GET', '/api/parts')).body.linkRels.component, '組成');
  assert.equal((await call('DELETE', `/api/categories/${c.id}`)).code, 400, '還有元件時不能刪');
  api.close();
  assert.match(denied('editor', 'POST', ['categories']), /管理者/);
  assert.equal(denied('editor', 'GET', ['categories']), null);
  assert.equal(denied('editor', 'POST', ['links']), null, '關聯件一般帳號可以改');
});
