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
