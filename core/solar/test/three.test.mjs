// three.js 整合：Mesh／InstancedMesh 的世界座標三角形與手算一致（只用長期穩定的 API）
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as S from '../index.js';

const THREE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core', 'vendor', 'three.module.js');

test('three.js：Mesh 與 InstancedMesh 轉成遮擋三角形', { skip: !existsSync(THREE_PATH) && '找不到 core/vendor/three.module.js' }, async () => {
  const THREE = await import(pathToFileURL(THREE_PATH).href);
  const scene = new THREE.Scene();
  // 一片 2000 × 1000 的板（PlaneGeometry 在 XY 平面），轉成水平、抬高 3000
  const g = new THREE.PlaneGeometry(2000, 1000);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, 3000, 0); scene.add(mesh);
  // 兩個實例：x = ±5000
  const inst = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial(), 2);
  const m = new THREE.Matrix4();
  [-5000, 5000].forEach((x, i) => { m.makeRotationX(-Math.PI / 2).setPosition(x, 3000, 0); inst.setMatrixAt(i, m); });
  scene.add(inst);
  scene.updateMatrixWorld(true);
  const L = S.createTriangleList();
  L.addObject(scene, { owner: (o, k) => (o.isInstancedMesh ? 10 + k : 1) });
  assert.equal(L.count, 6);
  const bvh = S.buildBVH(L.positions, L.owners);
  // 從地面往上：三片板正下方都被擋，板與板之間不擋
  for (const x of [-5000, 0, 5000]) assert.equal(bvh.anyHit(x, 0, 0, 0, 1, 0), true, `x=${x}`);
  assert.equal(bvh.anyHit(2500, 0, 0, 0, 1, 0), false);
  const hit = bvh.raycast(5000, 0, 200, 0, 1, 0);
  assert.equal(hit.owner, 11); assert.ok(Math.abs(hit.t - 3000) < 1e-6);
  // 略過自己（owner）時不擋
  assert.equal(bvh.anyHit(0, 0, 0, 0, 1, 0, Infinity, 1), false);
});
