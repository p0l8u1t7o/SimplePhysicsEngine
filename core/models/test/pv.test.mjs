// 光伏模型（core/models/pv.js）：pvArray 的受光面和 core/solar 的板片 { o, a, b } 重合；變流器狀態燈
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pvArray, pvModule, stringInverter } from '../pv.js';
import { trackerArray, fixedArray } from '../../solar/layout.js';

// 實例的單位方塊 (±0.5) 上表面四角 → 世界座標，應該是 o、o+a、o+b、o+a+b（實例矩陣是 Float32，幾千 mm 處約 1e-4 mm，容差 0.01 mm）
function topCorners(mesh, i) {
  const M = new THREE.Matrix4(); mesh.getMatrixAt(i, M);
  return [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5]].map(p => new THREE.Vector3(...p).applyMatrix4(M));
}
function check(mods, label) {
  const { mesh } = pvArray(null, mods);
  mods.forEach((m, i) => {
    const want = [m.o, m.o.map((v, k) => v + m.b[k]), m.o.map((v, k) => v + m.a[k]), m.o.map((v, k) => v + m.a[k] + m.b[k])].map(p => new THREE.Vector3(...p));
    const got = topCorners(mesh, i);
    for (const w of want) assert.ok(Math.min(...got.map(g => g.distanceTo(w))) < 0.01, `${label} 第 ${i} 片角點 ${w.toArray()}`);
  });
}

test('pvArray：固定式與追日（轉 35°）的受光面都和 core/solar 的板片重合', () => {
  check(fixedArray({ rows: 2, modulesPerRow: 3, nUp: 2, tilt: 20, azimuth: 180, pitch: 7000 }).modules, '固定式');
  check(trackerArray({ rows: 2, modulesPerRow: 3, pitch: 5500 }).pose(35), '追日');
});

test('pvArray.update：追日轉角改變時實例跟著動', () => {
  const arr = trackerArray({ rows: 1, modulesPerRow: 2, pitch: 5500 }), a = pvArray(null, arr.pose(0)), M0 = new THREE.Matrix4(), M1 = new THREE.Matrix4();
  a.mesh.getMatrixAt(0, M0); a.update(arr.pose(-40)); a.mesh.getMatrixAt(0, M1);
  assert.ok(!M0.equals(M1));
  check(arr.pose(-40), '更新後');
});

test('單片板與變流器：建得起來、狀態燈切換', () => {
  assert.ok(pvModule.create({}).root.children.length >= 6);
  const inv = stringInverter.create({ kw: 100 }), lit = () => inv.root.children.filter(m => /^led/.test(m.name) && m.material.emissiveIntensity > 0).map(m => m.name);
  assert.deepEqual(lit(), ['led run']);
  inv.set({ state: 'fault' }); assert.deepEqual(lit(), ['led fault']);
  inv.set({ state: 0 }); assert.deepEqual(lit(), ['led standby']);
});
