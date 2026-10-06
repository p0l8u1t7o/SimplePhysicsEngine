// 光學計算（core/optics）與 AOI 方案（評估平台 Q4）。
//   node --test studio/test/optics.test.mjs
// 對照的已知值：杯體量測站的線掃描（4K × 7 µm、1.5× 遠心 → 視野 19.1 mm，站的成本表與設計文件的數字）、
// 快門站的上視相機（5MP 2448 × 2048、3.45 µm、0.35× 遠心）、一般教科書的薄透鏡與景深公式。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, sensorOf, magnification, depthOfField, angularFov, pinholeFov, fromAttrs } from '../../core/optics/optics.js';
import { openPartsDb } from '../lib/partsdb.mjs';

const near = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tol, `${a} ≈ ${b}`);
const res = (r, k) => r.results.find(x => x.key === k);

test('公式：感光元件、倍率（薄透鏡／遠心）、景深、針孔視角（相機模型沿用的舊公式）', () => {
  const s = sensorOf({ pixel: 3.45, hPx: 2448, vPx: 2048 });
  near(s.w, 8.4456); near(s.h, 7.0656); near(s.diag, 11.011);
  near(magnification({ focal: 25 }, 300), 25 / 275);
  assert.equal(magnification({ type: '遠心', magnification: 0.35 }, 999), 0.35);
  assert.equal(magnification({ focal: 25 }, 20), null, '工作距離比焦距短');
  near(depthOfField(8, 0.0069, 0.35), 2 * 8 * 0.0069 * 1.35 / 0.1225);
  near(angularFov(6.6, 25), 2 * Math.atan(6.6 / 50) * 180 / Math.PI);
  assert.deepEqual(pinholeFov(8.8, 6.6, 25, 300), [105.6, 79.2]);
});

test('已知配置：杯體量測站的線掃描、快門站的上視相機', () => {
  const line = evaluate({ camera: { pixel: 7, hPx: 4096, vPx: 1, lineScan: true, lineRate: 26 }, lens: { type: '遠心', magnification: 1.5, fNumber: 8 }, scene: { speed: 100, target: { w: 19 } } });
  near(line.derived.fov[0], 19.115); assert.equal(res(line, 'fov').status, 'ok');
  near(line.derived.lineRate, 21428.6); assert.equal(res(line, 'lineRate').status, 'ok');
  const top = evaluate({ camera: { pixel: 3.45, hPx: 2448, vPx: 2048, fps: 23, interface: 'GigE', mount: 'C' }, lens: { type: '遠心', magnification: 0.35, fNumber: 8, mount: 'C', wd: 110 },
    scene: { defect: 0.05, target: { w: 20, h: 18, heightRange: 1 } } });
  near(top.derived.fov[0], 24.13); near(top.derived.fov[1], 20.19); near(top.derived.mmPerPx, 0.009857);
  near(top.derived.defectPx, 5.072); assert.equal(res(top, 'defect').status, 'ok');
  assert.equal(res(top, 'dof').status, 'ok');
});

test('判定：視野不夠、缺陷太小、景深不足、運動模糊、頻寬、接口、像圈、最近對焦距離、打光角度', () => {
  const r = evaluate({ camera: { sensorW: 8.8, sensorH: 6.6, pixel: 3.45, hPx: 2448, vPx: 2048, fps: 60, interface: 'GigE', mount: 'C' }, lens: { focal: 25, fNumber: 2.8, mount: 'CS', imageCircle: 8, mod: 400 },
    light: { type: '環形', size: 200, distance: 40, beamAngle: 30 }, scene: { wd: 300, target: { w: 120, h: 60, heightRange: 10 }, defect: 0.05, speed: 500, exposureUs: 1000, imagesPerCycle: 4, taktS: 0.1 } });
  for (const k of ['fov', 'defect', 'dof', 'blur', 'mount', 'imageCircle', 'mod', 'acquire']) assert.equal(res(r, k).status, 'fail', k);
  assert.equal(res(r, 'bandwidth').status, 'warn');
  assert.match(res(r, 'light').value, /暗場/);
  near(r.derived.maxExposureUs, 1 * 0.03795 / 500 * 1e6, 0.01);
  assert.equal(r.status, 'fail');
  assert.equal(res(evaluate({ camera: { mount: 'CS' }, lens: { mount: 'C' } }), 'mount').status, 'warn', 'C 鏡頭裝 CS 相機要轉接環');
  assert.match(res(evaluate({ camera: { pixel: 3.45, hPx: 100, vPx: 100 }, lens: { type: '遠心' } }), 'magnification').note, /缺倍率/);
});

test('元件的規格欄位 → 參數；AOI 方案：引用元件補參數、成本、儲存、選用加進 BOM', () => {
  assert.deepEqual(fromAttrs('lens', { 鏡頭類型: '遠心', 倍率: '0.35', 鏡頭接口: 'C' }).magnification, 0.35);
  assert.equal(fromAttrs('light', { 發光尺寸: 'Φ120 mm' }).size, 120);
  const db = openPartsDb(':memory:'), vis = db.tree().nodes.find(n => n.name === '視覺').children, cat = n => vis.find(c => c.name === n).id;
  const cam = db.createPart({ name: '5MP 相機', category_id: cat('相機與讀碼'), attrs: { 像素尺寸: '3.45', 水平像素: '2448', 垂直像素: '2048', 鏡頭接口: 'C' } });
  db.addPrice(cam.id, { unit_price: 20000 });
  const lens = db.createPart({ name: '0.35× 遠心', category_id: cat('鏡頭與光學'), attrs: { 鏡頭類型: '遠心', 倍率: '0.35', 鏡頭接口: 'C', 最小光圈: '8' } });
  db.addPrice(lens.id, { unit_price: 50000 });
  const data = { camera: { part: cam.code }, lens: { part: lens.code, fNumber: 11 }, scene: { defect: 0.05 }, quantity: { camera: 2, lens: 2 } };
  const r = db.aoi.evaluate(data);
  assert.equal(r.setup.lens.fNumber, 11, '方案自己填的值優先');
  assert.equal(r.setup.camera.pixel, 3.45, '沒填的用元件的規格欄位');
  assert.equal(r.cost, 140000, '成本：單價 × 數量');
  const a = db.aoi.save('Demo', { name: '甲案', data }), b = db.aoi.save('Demo', { name: '乙案', data: { ...data, quantity: {} } });
  assert.equal(db.aoi.list('Demo').length, 2);
  assert.equal(db.aoi.save('Demo', { name: '甲案改', data }, a.id).name, '甲案改');
  const ch = db.aoi.choose('Demo', a.id);
  assert.deepEqual(ch.added, [cam.code, lens.code]);
  assert.deepEqual(db.bom.get('Demo').lines.map(l => [l.line, l.qty, l.section]), [['V-01', 2, 'AOI 視覺'], ['V-02', 2, 'AOI 視覺']]);
  assert.deepEqual(db.aoi.choose('Demo', b.id).added, [], '元件已經在 BOM 就不重複加');
  assert.deepEqual(db.aoi.list('Demo').map(s => s.status).sort(), ['chosen', 'draft']);
  assert.throws(() => db.aoi.evaluate({ camera: { part: 'P-99999' } }), /找不到/);
  assert.throws(() => db.aoi.save('Other', { name: 'x', data }, a.id), /不是這個專案/);
  db.close();
});
