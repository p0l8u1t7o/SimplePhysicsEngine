// scene 干涉檢查的略過規則：core 標的 nonSolid（流體、布料、天候、CFD）略過；站裡同名的 userData.fluid 物件不能被略過
// （酸鹼滴定的瓶子群組 userData.fluid 是液面物件，2026-11-07 曾因為用 fluid 判斷而把瓶子漏出干涉檢查）
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { verifyScene } from '../../verify/scene.mjs';

function sceneWith(tag) {
  const scene = new THREE.Scene(), box = (x, name) => { const m = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial()); m.position.x = x; m.name = name; return m; };
  const a = box(0, 'a'), g = new THREE.Group(); g.add(box(50, 'b')); Object.assign(g.userData, tag);   // a 和 b 重疊 50 mm
  scene.add(a, g); scene.updateMatrixWorld(true);
  return { scene, project: { total: 1, apply() {}, verify: {} } };
}

test('nonSolid 略過；站裡的 userData.fluid 物件照常檢查', () => {
  const run = tag => { const { scene, project } = sceneWith(tag); return verifyScene(project, scene, { probes: 2, zfightTimes: 1 }); };
  assert.equal(run({ nonSolid: '粒子流體' }).meshes, 1, 'nonSolid 的網格不算');
  const kept = run({ fluid: { surface: null }, kind: 'beaker' });
  assert.equal(kept.meshes, 2, '站的 userData.fluid 物件要留在檢查裡');
  assert.ok(kept.static.length > 0, '重疊的兩個方塊要被抓到');
});

// 曲面件複核（2026-11-08）：細長方塊整支穿過圓柱，方塊的 8 個角都在圓柱外、圓柱的頂點也不在方塊內——只看頂點會漏報
test('曲面件複核：方塊穿過圓柱、兩邊都沒有頂點在對方體內，也要抓到', () => {
  const scene = new THREE.Scene();
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 500, 24), new THREE.MeshBasicMaterial()); bin.position.set(0, 250, 0); bin.name = 'bin';
  const beam = new THREE.Mesh(new THREE.BoxGeometry(50, 150, 2000), new THREE.MeshBasicMaterial()); beam.position.set(0, 300, 0); beam.name = 'beam';
  const g1 = new THREE.Group(); g1.add(bin); const g2 = new THREE.Group(); g2.add(beam); scene.add(g1, g2); scene.updateMatrixWorld(true);
  const r = verifyScene({ total: 1, apply() {}, verify: { moduleOf: m => m.name } }, scene, { probes: 2, zfightTimes: 1 });
  assert.ok(r.static.some(s => [s.a, s.b].join() .includes('beam') && [s.a, s.b].join().includes('bin')), `應該抓到側樑穿過收集桶：${JSON.stringify(r.static)}`);
});

// 純縮放的關節（液面、視管）只對直接父群組（同一個模型實例）放行（2026-11-08）
test('純縮放的視管插進鄰槽要抓到；自己的液面在自己槽內照樣放行', () => {
  const scene = new THREE.Scene(), area = new THREE.Group(); area.name = 'tank-area'; scene.add(area);
  const mat = () => new THREE.MeshBasicMaterial();
  const tank = (x, name) => {
    const root = new THREE.Group(); root.name = name; root.userData.coreModel = 'pe-tank'; root.position.x = x; area.add(root);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(500, 500, 1000, 24), mat()); shell.position.y = 500; shell.name = `${name} shell`; root.add(shell);
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(470, 470, 1, 24), mat()); liquid.name = `${name} liquid`; liquid.position.y = 10; root.add(liquid);
    const sight = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 1, 10), mat()); sight.name = `${name} sight`; sight.position.set(520, 10, 0); root.add(sight);
    return { root, liquid, sight };
  };
  const A = tank(0, 'TK-A'), B = tank(1000, 'TK-B');                                       // A 的視管（x 508～532）插進 B 槽（x 500 起）24 mm
  const project = { total: 1, verify: { moduleOf: () => 'tanks' },
    apply(t) { const h = 200 + 600 * t; for (const k of [A, B]) for (const m of [k.liquid, k.sight]) { m.scale.y = h; m.position.y = 10 + h / 2; } } };
  scene.updateMatrixWorld(true);
  const r = verifyScene(project, scene, { probes: 6, zfightTimes: 1 });
  const hits = [...r.dynamic, ...r.static].map(d => `${d.a} ${d.b}`).join('\n');
  assert.match(hits, /TK-A sight[\s\S]*TK-B shell|TK-B shell[\s\S]*TK-A sight/, `A 的視管插進 B 槽要抓到：\n${hits}`);
  assert.doesNotMatch(hits, /TK-A liquid/, '自己的液面在自己槽內要放行');
});

test('compareFixed：同模組的固定件預設不比，宣告後照比', () => {
  const run = compare => {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g);
    for (const x of [0, 80]) { const m = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial()); m.position.x = x; m.name = `box${x}`; g.add(m); }
    scene.updateMatrixWorld(true);
    return verifyScene({ total: 1, apply() {}, verify: { moduleOf: () => 'same', ...(compare ? { compareFixed: () => true } : {}) } }, scene, { probes: 2, zfightTimes: 1 }).static.length;
  };
  assert.equal(run(false), 0);
  assert.equal(run(true), 1);
});
