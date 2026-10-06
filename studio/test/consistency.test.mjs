// 一致性工具（評估平台 Q9）：手臂可達、節拍分析、場景 ↔ BOM、fromPart／tagPart、元件模型清單。
//   node --test studio/test/consistency.test.mjs
// core 的模組引用 three：先註冊 core 的 loader，再用動態 import（node --test 直接跑也可以）
import '../../core/tools/register.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPartsDb } from '../lib/partsdb.mjs';
import { writePartsModels } from '../lib/parts-catalog.mjs';
await import('../../core/verify/dom-stub.mjs');
const THREE = await import('three');
const { createVS068 } = await import('../../core/models/robots/denso-vs068.js');
const { reachByIK, reachByEnvelope } = await import('../../core/robot/reach.js');
const { cycleReport } = await import('../../core/anim/cycle.js');
const { createTimeline } = await import('../../core/anim/track.js');
const { sceneInventory, compareBom } = await import('../../core/verify/bom.mjs');
const { registerParts, fromPart, tagPart, partInfo } = await import('../../core/models/parts.js');

test('手臂可達：6 軸用 IK（到得了的誤差 ≈ 0、太遠太高的列出差多少）、SCARA 用包絡；檢查完關節角恢復', () => {
  const arm = createVS068(), tcp = new THREE.Object3D(); arm.tool.add(tcp); tcp.position.z = 60;
  const before = { ...arm.q };
  const rows = reachByIK(arm, tcp, [{ name: '取料', pos: [400, 250, 0] }, { name: '放料', pos: [0, 200, -450] }, { name: '太遠', pos: [1200, 100, 0] }]);
  assert.deepEqual(rows.map(r => r.ok), [true, true, false]);
  assert.match(rows[2].value, /^差 \d+/);
  assert.deepEqual(arm.q, before, '關節角恢復');
  const env = reachByEnvelope({ base: [0, 0, 0], rMin: 150, rMax: 650, yMin: 0, yMax: 400 }, [{ name: 'A', pos: [300, 100, 200] }, { name: 'B', pos: [700, 100, 0] }, { name: 'C', pos: [100, 100, 0] }]);
  assert.deepEqual(env.map(r => r.ok), [true, false, false]);
});

test('節拍分析：各站佔用取聯集、稼動率、瓶頸；cycleTime 優先', () => {
  const tl = createTimeline(), a = tl.track('arm', { x: 0 }), c = tl.track('conv', { s: 0 });
  a.add(2, { x: 1 }, { action: '取', station: 0 }); a.add(1, { x: 2 }, { action: '放', station: 0 }); c.add(1.5, { s: 1 }, { action: '送', station: 1 }); c.add(0.5, { s: 2 }, { action: '停', station: 1, at: 1 });
  const r = cycleReport({ timeline: { events: tl.events.map(s => ({ time: s.start, dur: s.dur, station: s.station })) }, total: tl.total });
  assert.equal(r.bottleneck, '0'); assert.equal(r.stations[0].busy, 3); assert.equal(r.stations[1].busy, 1.5 + 0.5 - 0.5 + 0.5);
  assert.equal(r.cycle, 3);
  assert.equal(cycleReport({ events: [], total: 10, cycleTime: 4.2 }).cycle, 4.2);
});

test('場景 ↔ BOM：partRef 優先、模型 id 次之；noBom、noScene 不算；巢狀模型只算外層', () => {
  const scene = new THREE.Scene(), mk = (model, extra = {}) => { const g = new THREE.Group(); g.name = model; Object.assign(g.userData, { coreModel: model, ...extra }); return g; };
  const cam = mk('camera', { partRef: 'P-00132' }); cam.add(mk('lens'));
  const site = mk('abb-irb360'); const old = new THREE.Group(); old.userData.noBom = '現場既有'; old.add(site);
  scene.add(cam, mk('belt-conveyor'), mk('signal-tower'), old);
  const inv = sceneInventory(scene);
  assert.deepEqual(inv.map(x => x.model).sort(), ['belt-conveyor', 'camera', 'signal-tower']);
  const r = compareBom(inv, [{ line: '1', code: 'P-00132', model_id: 'camera' }, { line: '2', code: 'P-00200', model_id: 'belt-conveyor' }, { line: '3', code: 'P-00300', model_id: 'hmi' },
    { line: '4', code: 'P-00400', model_id: 'estop', no_scene: true }, { line: '5', code: '', name: '工程' }]);
  assert.equal(r.matched, 2);
  assert.deepEqual(r.sceneOnly.map(s => s.model), ['signal-tower']);
  assert.deepEqual(r.bomOnly.map(b => b.line), ['3']);
});

test('fromPart／tagPart 與元件模型清單（studio 寫進專案的 web/js/parts-models.js）', async () => {
  registerParts({ 'P-00132': { model: 'camera', params: { focal: 16 }, name: '相機' } });
  const c = fromPart('p-00132');
  assert.equal(c.root.userData.partRef, 'P-00132'); assert.equal(c.root.userData.coreModel, 'camera');
  assert.throws(() => fromPart('P-99999'), /不在清單/);
  assert.equal(tagPart(new THREE.Group(), 'p-1').userData.partRef, 'P-1');
  assert.equal(partInfo('P-00132').name, '相機');
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-pm-')), dbFile = join(dir, 'studio.db');
  try {
    const db = openPartsDb(dbFile); db.createPart({ name: '工業相機', model_id: 'camera', model_params: { focal: 25 } }); db.createPart({ name: '沒有模型的元件' }); db.close();
    const J = { dir: join(dir, 'Demo'), repo: false }; mkdirSync(join(J.dir, 'web', 'js'), { recursive: true });
    assert.equal(writePartsModels(J, { file: dbFile }), 1);
    const mod = await import(`file:///${join(J.dir, 'web', 'js', 'parts-models.js').replace(/\\/g, '/')}?v=1`);
    assert.deepEqual(mod.default['P-00001'], { model: 'camera', params: { focal: 25 }, name: '工業相機' });
    assert.equal(writePartsModels({ ...J, repo: true }, { file: dbFile }), 0, '本庫的站不寫');
    assert.match(readFileSync(join(J.dir, 'web', 'js', 'parts-models.js'), 'utf8'), /不要手改/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
