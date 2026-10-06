// 元件版本、BOM 與成本表（評估平台 Q3）。
//   node --test studio/test/bom.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPartsDb, PartsError } from '../lib/partsdb.mjs';
import { diffSnapshots } from '../lib/versions.mjs';

const bad = (fn, re, status = 400) => assert.throws(fn, e => e instanceof PartsError && e.status === status && re.test(e.message), re);

test('元件版本：影響選型或成本的欄位才升版；記下改了什麼、誰改的；模組的子件出新版時可以更新模組', () => {
  const db = openPartsDb(':memory:');
  const cam = db.withActor('amy', () => db.createPart({ name: '相機', spec: '5MP', attrs: { 像素尺寸: '3.45' } }));
  assert.equal(cam.version, 1); assert.equal(cam.versions[0].by, 'amy');
  db.updatePart(cam.id, { ...cam, note: '只改備註', tags: '常用', selection_note: 'x' });
  assert.equal(db.getPart(cam.id).version, 1, '備註、標籤、選型備註不升版');
  db.addUsage(cam.id, { project: 'Demo' });
  assert.equal(db.getPart(cam.id).version, 1, '使用紀錄不升版');
  db.withActor('bob', () => db.updatePart(cam.id, { ...cam, spec: '12MP', attrs: { 像素尺寸: '2.4' } }));
  let p = db.getPart(cam.id);
  assert.deepEqual([p.version, p.versions[0].by, p.versions[0].changed], [2, 'bob', ['spec', 'attrs.像素尺寸']]);
  db.addPrice(cam.id, { unit_price: 30000, grade: 'B' });
  p = db.getPart(cam.id);
  assert.deepEqual([p.version, p.versions[0].changed], [3, ['price']]);
  assert.deepEqual(db.versions.compare(cam.id, 1, 3).map(d => d.key), ['spec', 'attrs.像素尺寸', 'price']);
  // 模組：加子件升版；子件出新版時模組標出來，按「更新模組」才升
  const mod = db.createPart({ name: '相機組', kind: 'module', price_mode: 'sum' });
  db.links.addLink(mod.id, { related: cam.id, rel: 'component', qty: 2 });
  assert.equal(db.getPart(mod.id).version, 2);
  assert.equal(db.versions.get(mod.id, 2).snapshot.price.unit_price, 60000, '子件加總寫進快照');
  db.addPrice(cam.id, { unit_price: 32000 });
  assert.deepEqual(db.getPart(mod.id).childUpdates, [{ code: cam.code, from: 4 - 1, to: 4 }]);
  assert.equal(db.getPart(mod.id).version, 2, '子件改了，模組不會自己升版');
  assert.equal(db.refreshModule(mod.id).version, 3);
  assert.deepEqual(db.getPart(mod.id).childUpdates, []);
  bad(() => db.refreshModule(cam.id), /只有模組/);
  assert.deepEqual(diffSnapshots({ attrs: { a: '1' } }, { attrs: { a: '1', b: '2' } }).map(d => d.key), ['attrs.b']);
  db.close();
});

test('成本表：設備、工程人日、客製件、選配；等級幅度、預備費、稅；外幣匯率；分部；提醒', () => {
  const db = openPartsDb(':memory:'), B = db.bom;
  const cam = db.createPart({ name: '工業相機', unit: '台' }); db.addPrice(cam.id, { unit_price: 20000, grade: 'B' });
  const lens = db.createPart({ name: '遠心鏡頭' }); db.addPrice(lens.id, { unit_price: 1000, currency: 'USD', grade: 'A', valid_until: '2020-01-01' });
  const pend = db.createPart({ name: '新光源', status: '待確認' });
  assert.equal(B.get('Demo'), null, '還沒有 BOM');
  B.addItem('Demo', { part: cam.code, qty: 2, line: '1-01', section: '1 視覺', grp: '第 1 部分' });
  B.addItem('Demo', { part: lens.id, qty: 1, line: '1-02', section: '1 視覺', grp: '第 2 部分' });
  B.addItem('Demo', { part: pend.code, qty: 1, line: '1-03' });
  B.addItem('Demo', { line: '2-01', section: '2 治具', name: '組裝治具', unit_price: 90000, grade: 'C', qty: 2, unit: '套' });
  B.addItem('Demo', { line: '6-01', section: '6 工程', name: '機構設計', labor: 'eng', qty: 30 });
  B.addItem('Demo', { line: '6-02', section: '6 工程', name: '組立配線', labor: 'tech', qty: 10, grade: 'B' });
  B.addItem('Demo', { line: '7-01', section: '7 選配', name: '雙吸嘴', nature: 'option', unit_price: 70000, grade: 'C', qty: 0 });
  bad(() => B.addItem('Demo', { qty: 1 }), /客製件要寫名稱/);
  bad(() => B.addItem('Demo', { part: 'P-99999' }), /找不到元件/, 404);
  bad(() => B.addItem('Demo', { name: 'x', grade: 'D' }), /等級/);
  let g = B.get('Demo');
  const L = Object.fromEntries(g.lines.map(l => [l.line, l]));
  assert.deepEqual([L['1-01'].unit_twd, L['1-01'].subtotal, L['1-01'].low, L['1-01'].high, L['1-01'].unit], [20000, 40000, 32000, 48000, '台'], '單價取鎖定版本的參考單價；單位沿用元件');
  assert.ok(L['1-02'].flags.includes('noFx') && L['1-02'].subtotal === 0, '外幣沒有匯率：不算進去並標出來');
  assert.ok(L['1-02'].flags.includes('expired'), '報價過期');
  assert.ok(L['1-03'].flags.includes('noPrice') && L['1-03'].flags.includes('pending'), '沒有單價、待確認');
  assert.deepEqual([L['6-01'].unit_twd, L['6-01'].unit, L['6-02'].unit_twd], [8000, '人日', 5500], '人日單價取費率');
  db.bom.setFx({ currency: 'usd', rate: 32, date: '2026-01-01' });
  db.bom.setFx({ currency: 'USD', rate: 30, date: '2026-12-31' });
  bad(() => db.bom.setFx({ currency: 'TWD', rate: 1 }), /新台幣/);
  B.updateSettings('Demo', { fxDate: '2026-10-06', contingency: 0.1 });
  g = B.get('Demo');
  const lensLine = g.lines.find(l => l.line === '1-02');
  assert.deepEqual([lensLine.fx, lensLine.unit_twd, lensLine.grade], [32, 32000, 'A'], '用匯率日期以前最近的一筆');
  const s = g.summary;
  assert.deepEqual([s.equipment, s.labor, s.option], [40000 + 32000 + 180000, 240000 + 55000, 0]);
  assert.equal(s.subtotal, 547000); assert.equal(s.total, 601700); assert.equal(s.taxed, 631785);
  assert.equal(s.laborDays, 40);
  assert.equal(s.low, Math.round((32000 + 28800 + 126000 + 192000 + 44000) * 1.1 * 100) / 100, '下限：逐行幅度加總 ×（1＋預備費）');
  assert.deepEqual(s.groups.map(x => [x.grp, x.subtotal]), [['第 1 部分', 40000], ['第 2 部分', 32000]], '分部各算一份');
  assert.deepEqual([s.flags.estimate, s.flags.pending, s.flags.noPrice], [3, 1, 1], 'C 級（含沒有等級的）、待確認、沒單價');
  bad(() => B.updateSettings('Demo', { tax: 2 }), /稅率/);
  db.close();
});

test('新版不影響成本：差異比較、逐行或全部升級（先自動快照）、快照凍結、比較、刪除與合併的保護', () => {
  const db = openPartsDb(':memory:'), B = db.bom;
  const a = db.createPart({ name: '相機' }); db.addPrice(a.id, { unit_price: 20000, grade: 'B' });
  const b = db.createPart({ name: '光源' }); db.addPrice(b.id, { unit_price: 5000, grade: 'B' });
  const ia = B.addItem('Demo', { part: a.code, qty: 2, line: '1-01' }), ib = B.addItem('Demo', { part: b.code, qty: 1, line: '1-02' });
  assert.equal(ia.part_version, 2);
  db.addPrice(a.id, { unit_price: 25000, grade: 'A', quoted_on: '2026-10-06' });
  db.updatePart(b.id, { name: '光源', spec: '紅光' });
  assert.equal(B.get('Demo').summary.subtotal, 45000, '元件改了，專案的成本不變');
  assert.deepEqual(db.bom.newerByProject(), { Demo: 2 });
  const nv = B.newVersions('Demo');
  assert.deepEqual(nv.map(n => [n.line, n.from, n.to, n.delta]), [['1-01', 2, 3, 10000], ['1-02', 2, 3, 0]]);
  assert.deepEqual(nv[1].diff.map(d => d.key), ['spec']);
  // 只升第一行：先自動留快照
  const up = db.withActor('amy', () => B.upgrade('Demo', [ia.id]));
  assert.equal(up.upgraded, 1);
  let g = B.get('Demo');
  assert.equal(g.summary.subtotal, 55000);
  assert.deepEqual(g.upgrades.map(u => [u.line, u.from_version, u.to_version, u.from_price, u.to_price, u.by]), [['1-01', 2, 3, 20000, 25000, 'amy']]);
  assert.deepEqual(g.snapshots.map(s => s.name), ['R1 升級前']);
  const snap = B.getSnapshot(up.snapshot.id);
  assert.equal(snap.summary.subtotal, 45000, '快照凍結當時的結果');
  const cmp = B.compare('Demo', up.snapshot.id);
  assert.deepEqual([cmp.rows.map(r => [r.line, r.change, r.delta]), cmp.totals.subtotal], [[['1-01', 'changed', 10000]], 10000]);
  const snapItem = db.bom.current('Demo') && snap.lines[0].id;
  bad(() => B.updateItem(snapItem, { qty: 9 }), /快照不能修改/);
  // 改數量、刪行、手動快照
  B.updateItem(ib.id, { qty: 3 }); assert.equal(B.get('Demo').summary.subtotal, 65000);
  B.snapshot('Demo', { name: '報價給客戶' });
  B.deleteItem(ib.id); assert.equal(B.get('Demo').lines.length, 1);
  assert.equal(B.get('Demo').snapshots[0].name, '報價給客戶');
  bad(() => B.upgrade('Demo'), /沒有可以升級/, 400);       // 剩下的那行已經是最新版
  // 刪除與合併的保護：快照也算引用
  bad(() => db.deletePart(b.id), /BOM 引用/);
  const c = db.createPart({ name: '光源 2' });
  bad(() => db.mergeParts(c.id, b.id), /不能併掉/);
  assert.equal(db.mergeParts(b.id, c.id).id, b.id, '併到被引用的元件身上可以');
  // 整份換掉
  B.replaceItems('Demo', [{ part: a.code, qty: 1, line: 'A' }, { name: '客製', unit_price: 100, line: 'B' }]);
  assert.deepEqual(B.get('Demo').lines.map(l => [l.line, l.subtotal]), [['A', 25000], ['B', 100]]);
  db.close();
});
