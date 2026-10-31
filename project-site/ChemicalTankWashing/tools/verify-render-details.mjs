// 補強實例的完整場景回歸：core 的一般 scene 檢查不列入 InstancedMesh，
// 因此只把本次標記 renderDetail 的實例展開成普通 Mesh，再沿完整動畫檢查。
// 完整檢查（check.mjs）會跑；單獨執行時在庫根目錄、經 cpu-cap：
// node --import ./core/tools/register.mjs project-site/ChemicalTankWashing/tools/verify-render-details.mjs
import '../../../core/verify/dom-stub.mjs';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { verifyScene } from '../../../core/verify/scene.mjs';
import { FILL } from '../web/js/layout.js';
import { verifyServices } from './verify-services.mjs';

const scene = new THREE.Scene(), project = createProject({ scene });
// 額外檢查短行程端點、倒序 seek、相同狀態快取，以及實際填裝段的重量讀值。
const stateChecks = { headSamples: 0, weightSamples: 0, agvSamples: 0, originalEnvelopes: 0, unchangedStateCache: false };
scene.traverse(o => {
  const expected = o.name === 'slotted fill carriage' ? [750, 60, 900] : o.name === 'open lance guide' ? [90, 380, 90] : null;
  if (!expected) return;
  o.geometry.computeBoundingBox();
  const size = o.geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
  assert(size.every((value, i) => Math.abs(value - expected[i]) < .01), `${o.name} 改變原外框尺寸`);
  stateChecks.originalEnvelopes++;
});
assert.equal(stateChecks.originalEnvelopes, 32);
const times = new Set([0, project.total]);
for (const [key, track] of Object.entries(project.seq.tracks)) {
  if (!/^h\d\d$/.test(key)) continue;
  for (const step of track.steps) if (step.initial.e !== step.end.e || step.initial.sx !== step.end.sx) {
    for (let i = 0; i <= 30; i++) times.add(step.start + step.dur * i / 30);
  }
}
const matrix = new THREE.Matrix4(), endpoint = new THREE.Vector3();
for (const t of [...times].sort((a, b) => b - a)) {
  const sm = project.apply(t);
  project.plant.filling.lines.forEach((line, li) => line.heads.forEach((h, pi) => {
    const state = sm.st[`h${li}${pi}`], { hose, previous } = line.hardware;
    assert.deepEqual(previous[pi], [state.e, state.sx]);
    const segments = hose.count / 4;
    hose.getMatrixAt((pi + 1) * segments - 1, matrix);
    endpoint.set(0, .5, 0).applyMatrix4(matrix);
    assert(endpoint.distanceTo(new THREE.Vector3(h.head.position.x - 224, h.lance.position.y + 1036, h.head.position.z + 200)) < .02, '供液軟管未接在隨動接頭');
    stateChecks.headSamples++;
  }));
  for (const key of ['agv', 'agv2']) {
    const { lens, zone } = project.plant[key].safety;
    assert.equal(zone.visible, sm.st[key].moving);
    assert.equal(zone.userData.fx, true);
    assert.equal(lens.rotation.y, sm.st[key].moving ? sm.time * 7 : 0);
    stateChecks.agvSamples++;
  }
  const versions = project.plant.filling.lines.map(l => l.hardware.hose.instanceMatrix.version);
  project.apply(t);
  assert.deepEqual(project.plant.filling.lines.map(l => l.hardware.hose.instanceMatrix.version), versions, '相同狀態不應更新軟管');
}
stateChecks.unchangedStateCache = true;
for (let k = 0; k < 4; k++) {
  const track = project.seq.tracks[`drum${k}`];
  const filling = track.steps.find(s => s.end.water === 200 && s.initial.water < 200);
  assert(filling, `drum${k} 缺填裝段`);
  for (const fraction of [0, .25, .5, .75, 1]) {
    const sm = project.apply(filling.start + filling.dur * fraction), drum = project.plant.drums[k].root;
    const li = FILL.lines.findIndex(x => Math.abs(drum.position.x - x) < .01);
    const pi = FILL.pos.findIndex(z => Math.abs(drum.position.z - z) < .01);
    assert(li >= 0 && pi >= 0, '填裝時桶未在填裝位');
    assert.equal(project.plant.filling.weightAtlas.values[li * 4 + pi], Math.round(sm.st[`drum${k}`].water));
    stateChecks.weightSamples++;
  }
}
project.apply(0);
assert.deepEqual(project.plant.filling.weightAtlas.values, [null, null, null, null, null, null, null, null, 120, 120, null, null, 120, null, null, null], '初始空位與背景桶讀值不符');
const instances = [], counts = { meshObjects: 0, instancedObjects: 0, drawnInstances: 0, expandedDetailParts: 0 };
scene.traverse(o => {
  if (!o.isMesh) return;
  counts.meshObjects++;
  if (o.isInstancedMesh) {
    counts.instancedObjects++; counts.drawnInstances += o.count;
    if (o.userData.renderDetail) instances.push(o);
  }
});
assert(instances.length > 0, '未找到補強實例，不能把空檢查當成通過');
const expanded = [];
for (const inst of instances) {
  const group = new THREE.Group(); group.name = inst.name;
  group.position.copy(inst.position); group.quaternion.copy(inst.quaternion); group.scale.copy(inst.scale);
  Object.assign(group.userData, inst.userData);
  for (let i = 0; i < inst.count; i++) {
    const mesh = new THREE.Mesh(inst.geometry, inst.material); inst.getMatrixAt(i, mesh.matrix);
    assert(mesh.matrix.elements.every(Number.isFinite), `${inst.name}[${i}] 矩陣不是有限數值`);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.name = `${inst.name} [${i}]`; group.add(mesh); counts.expandedDetailParts++;
  }
  inst.parent.add(group); inst.removeFromParent();
  expanded.push({ inst, group, version: inst.instanceMatrix.version });
}
// 軟管是動態實例，展開後仍逐次同步原矩陣；不可把起始姿態當成全行程驗證。
const apply = project.apply.bind(project);
const serviceChecks = verifyServices(project, scene);
project.apply = (...args) => {
  const sample = apply(...args);
  for (const record of expanded) {
    const { inst, group } = record;
    group.visible = inst.visible;
    group.position.copy(inst.position); group.quaternion.copy(inst.quaternion); group.scale.copy(inst.scale);
    if (record.version === inst.instanceMatrix.version) continue;
    record.version = inst.instanceMatrix.version;
    group.children.forEach((mesh, i) => {
      inst.getMatrixAt(i, mesh.matrix);
      assert(mesh.matrix.elements.every(Number.isFinite), `${inst.name}[${i}] 動態矩陣無效`);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    });
  }
  return sample;
};
const result = verifyScene(project, scene);
const report = { ...counts, stateChecks, serviceChecks, ...result, note: '僅展開本站新增實例，動態實例逐次同步；既有倉儲桶與其他 core 實例仍沿用原站驗證範圍。不修改 allow、skip 或門檻。' };
const out = new URL('../review/render-details-verification.json', import.meta.url);
mkdirSync(new URL('.', out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: result.ok, ...counts, stateChecks, serviceChecks, verifiedMeshes: result.meshes, dynamic: result.dynamic.length, static: result.static.length, zfight: result.zfight.length }));
if (!result.ok) console.log(JSON.stringify({ dynamic: result.dynamic, static: result.static, zfight: result.zfight }, null, 2));
process.exitCode = result.ok ? 0 : 1;
