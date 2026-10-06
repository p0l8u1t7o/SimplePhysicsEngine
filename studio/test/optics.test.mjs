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

// ---- L2 打光幾何、模擬影像、光學代理（評估平台 Q7） ----
import { lighting, simulateImage, lightSamples, MATERIALS } from '../../core/optics/lighting.js';
const mirror = { camera: { pixel: 3.45, hPx: 2448, vPx: 2048 }, lens: { type: '遠心', magnification: 0.35, fNumber: 8, wd: 110 }, scene: { wd: 110, target: { w: 20, h: 16 }, defect: 0.05, material: '鏡面金屬' } };
const withLight = (light, scene = {}) => ({ ...mirror, light, scene: { ...mirror.scene, ...scene } });
const L2 = s => lighting(s, evaluate(s).derived), dc = (L, k) => L.defects.find(x => x.kind === k);

test('L2 明暗場：同軸光照鏡面是明場、低角度環形光是暗場、穹頂是漫射；刮傷在明場變暗、在暗場變亮', () => {
  const coax = L2(withLight({ type: '同軸', size: 40 })), ring = L2(withLight({ type: '環形', size: 120, distance: 15 })), dome = L2(withLight({ type: '穹頂', size: 200, distance: 100 }));
  assert.equal(coax.field, 'bright'); assert.equal(coax.brightRatio, 1);
  assert.equal(ring.field, 'dark'); assert.equal(ring.brightRatio, 0);
  assert.equal(dome.field, 'diffuse');
  assert.equal(dc(coax, '刮傷').polarity, '暗'); assert.ok(dc(coax, '刮傷').contrast > 0.3);
  assert.equal(dc(ring, '刮傷').polarity, '亮'); assert.ok(dc(ring, '刮傷').contrast > 0.4, '暗場凸顯刮傷');
  assert.ok(dc(ring, '凹痕').contrast < 0.05, '平滑的凹痕在低角度環形光下幾乎看不到');
  assert.ok(dc(coax, '凹痕').contrast > 0.3, '凹痕在同軸光下看得到');
  // 一般鏡頭、高角度環形光（光源半徑小、距離遠）照鏡面：看得到光環的反射（模糊的亮環），低角度大環形光完全看不到
  const high = L2({ camera: mirror.camera, lens: { focal: 25, fNumber: 4 }, scene: { wd: 300, target: { w: 60, h: 45 }, material: '鏡面金屬' }, light: { type: '環形', size: 40, distance: 280 } });
  const low = L2({ ...withLight({ type: '環形', size: 200, distance: 20 }), lens: { focal: 25, fNumber: 4 }, scene: { wd: 300, target: { w: 60, h: 45 }, material: '鏡面金屬' } });
  assert.ok(Math.max(...high.map.spec) > 0.2 && Math.max(...low.map.spec) < 0.01, '高角度看得到光環的反射、低角度看不到');
  // 穹頂：遠心鏡頭看鏡面只看到相機孔（暗），一般鏡頭只有中心一塊暗（相機孔的反射）
  const teleDome = L2(withLight({ type: '穹頂', size: 200, distance: 100 })), stdDome = L2({ ...withLight({ type: '穹頂', size: 200, distance: 100 }), lens: { focal: 25, fNumber: 4 }, scene: { wd: 300, target: { w: 60, h: 45 }, material: '鏡面金屬' } });
  assert.ok(teleDome.map.spec.reduce((a, v) => a + v, 0) / teleDome.map.spec.length < 0.05, '遠心＋穹頂看鏡面是相機孔的暗區');
  const m = stdDome.map, mid = m.spec[Math.floor(m.ny / 2) * m.nx + Math.floor(m.nx / 2)], corner = m.spec[0];
  assert.ok(mid < 0.1 && corner > 0.9, `一般鏡頭：中心暗（${mid}）、角落亮（${corner}）`);
  assert.equal(lightSamples({ type: '環形', size: 100, distance: 50 }).reduce((a, s) => a + s.w, 0).toFixed(6), '1.000000');
  assert.ok(Object.keys(MATERIALS).includes('PCB 綠漆'));
});

test('L2 遮擋、陰影與要檢出的缺陷：治具擋住相機與光；defectKinds 列的種類才判定符合與否', () => {
  const blocked = L2(withLight({ type: '環形', size: 120, distance: 15 }, { obstacles: [{ x: 9, y: 0, w: 6, d: 30, h: 60 }] }));
  assert.ok(blocked.hiddenRatio > 0.05 && blocked.hiddenRatio < 0.5, `相機被擋住 ${blocked.hiddenRatio}`);
  assert.ok(blocked.shadowRatio > 0, '有陰影');
  const judged = evaluate(withLight({ type: '環形', size: 120, distance: 15 }, { defectKinds: ['刮傷', '凹痕'] })), res = k => judged.results.find(x => x.key === k);
  assert.equal(res('defect-刮傷').status, 'ok'); assert.equal(res('defect-凹痕').status, 'fail'); assert.equal(res('defect-髒污').status, 'info');
  assert.equal(judged.status, 'fail');
  assert.equal(res('field').value.startsWith('暗場'), true);
  assert.ok(judged.derived.lighting && !('map' in judged.derived.lighting), '存進資料庫的結果不含取樣陣列');
  assert.equal(evaluate(mirror).results.some(x => x.key === 'field'), false, '沒有光源時不算 L2');
});

test('L2 模擬影像：明場亮、暗場暗、缺陷特寫是原解析度、景深不足時模糊、每次結果相同', () => {
  const s1 = withLight({ type: '同軸', size: 40 }), s2 = withLight({ type: '環形', size: 120, distance: 15 });
  const a = simulateImage(s1, evaluate(s1).derived), b = simulateImage(s2, evaluate(s2).derived);
  const mean = x => x.data.reduce((p, v) => p + v, 0) / x.data.length, center = x => x.data[Math.floor(x.height / 2) * x.width + Math.floor(x.width / 2)];
  assert.equal(a.full.width, 480); assert.equal(a.crops.length, 4); assert.equal(a.crops[0].width, 64);
  assert.ok(center(a.full) > 150 && center(b.full) < 40, `明場中心 ${center(a.full)}、暗場中心 ${center(b.full)}`);
  const scratchA = a.crops.find(c => c.kind === '刮傷'), scratchB = b.crops.find(c => c.kind === '刮傷');
  assert.ok(center(scratchA) < mean(scratchA), '明場下刮傷比周圍暗'); assert.ok(center(scratchB) > mean(scratchB), '暗場下刮傷比周圍亮');
  assert.deepEqual(simulateImage(s1, evaluate(s1).derived).full.data, a.full.data, '決定性');
  const deep = withLight({ type: '同軸', size: 40 }, { target: { w: 20, h: 16, heightRange: 6 } }), sharp = a.crops.find(c => c.kind === '缺件'), soft = simulateImage(deep, evaluate(deep).derived).crops.find(c => c.kind === '缺件');
  const edge = x => { let e = 0; for (let k = 1; k < x.data.length; k++) e += Math.abs(x.data[k] - x.data[k - 1]); return e; };
  assert.ok(edge(soft) < edge(sharp), '景深不足時邊緣變軟');
  assert.equal(simulateImage({ camera: {}, lens: {}, scene: {} }, {}), null);
});
