// structure ↔ solar 的座標對齊（core/structure/solar-frame.js）：法向、轉角號誌、3D 擺放、地形查詢、遮陰接得起來
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layoutFixedRack } from '../rack.js';
import { layoutTracker } from '../tracker.js';
import { buildStructure } from '../build.js';
import { solarFrame } from '../solar-frame.js';
import * as S from '../../solar/index.js';

const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const nOf = m => unit([m.a[1] * m.b[2] - m.a[2] * m.b[1], m.a[2] * m.b[0] - m.a[0] * m.b[2], m.a[0] * m.b[1] - m.a[1] * m.b[0]]);
const close = (a, b, tol, msg) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= tol, `${msg ?? ''} [${a.map(v => v.toFixed(5))}] ≠ [${b.map(v => v.toFixed(5))}]`));

test('固定式：朝南時 yaw 0，法向和 fixedArray 相同；朝東時法向朝 +X', () => {
  const lay = layoutFixedRack({ rows: 1, across: 4, up: 2, tilt: 20 });
  const south = solarFrame({ kind: 'fixed', azimuth: 180 });
  assert.equal(south.yaw, 0);
  const ref = S.fixedArray({ rows: 1, modulesPerRow: 4, nUp: 2, tilt: 20, azimuth: 180, pitch: 7000 }).normal;
  for (const m of south.modules(lay)) close(nOf(m), ref, 1e-9, '朝南');
  const east = solarFrame({ kind: 'fixed', azimuth: 90 });
  const s20 = Math.sin(20 * Math.PI / 180), c20 = Math.cos(20 * Math.PI / 180);
  for (const m of east.modules(lay)) close(nOf(m), [s20, c20, 0], 1e-9, '朝東');
});

test('追日：南北軸時本地 +X → 南，轉角 φ = θ，逐片法向和 trackerArray／trackerNormal 相同', () => {
  const lay = layoutTracker({ rows: 2, across: 6, pitch: 5500 });
  const f = solarFrame({ kind: 'tracker', axisAzimuth: 180, origin: [1000, 0, -2000] });
  close(f.dirToWorld([1, 0, 0]), [0, 0, 1], 1e-12, '軸沿 +Z（南）');
  close(f.dirToWorld([0, 0, 1]), [-1, 0, 0], 1e-12, '本地 +Z → 西');
  for (const th of [-50, -20, 0, 15, 45]) {
    const ref = S.trackerNormal(th, 0, 180), arr = S.trackerArray({ rows: 1, modulesPerRow: 1, pitch: 5000 }).pose(th)[0];
    close(nOf(arr), ref, 1e-12, 'trackerArray 自己');
    for (const m of f.modules(lay, th)) close(nOf(m), ref, 1e-9, `θ = ${th}`);
  }
  // 下午（太陽在西）θ > 0，板面應該朝西：法向 x 分量 < 0
  assert.ok(f.modules(lay, 30)[0].a && nOf(f.modules(lay, 30)[0])[0] < 0);
});

test('3D：place＋set({ angle }) 後的模組實例，世界法向和 modules() 相同', () => {
  const lay = layoutTracker({ rows: 1, across: 3, pitch: 5500 });
  const f = solarFrame({ kind: 'tracker', axisAzimuth: 170, origin: [500, 200, 800] }), st = buildStructure(lay);
  f.place(st.root); st.set({ angle: f.angle(35) }); st.root.updateMatrixWorld(true);
  const mesh = st.meshes.module, M = new THREE.Matrix4(), mods = f.modules(lay, 35);
  for (let i = 0; i < mods.length; i++) {
    mesh.getMatrixAt(i, M); M.premultiply(mesh.matrixWorld);
    const e = M.elements, n = unit([e[4], e[5], e[6]]), c = new THREE.Vector3().setFromMatrixPosition(M);   // 實例的 Y 軸＝模組法向
    close(n, nOf(mods[i]), 1e-6, `第 ${i} 片法向`);
    const m = mods[i], mid = [m.o[0] + (m.a[0] + m.b[0]) / 2, m.o[1] + (m.a[1] + m.b[1]) / 2, m.o[2] + (m.a[2] + m.b[2]) / 2];
    const half = lay.modules[i].size[2] / 2;
    close([c.x + n[0] * half, c.y + n[1] * half, c.z + n[2] * half], mid, 1e-3, `第 ${i} 片受光面中心`);
  }
});

test('地形：localGround 把本地 (x, z) 轉到世界查高度', () => {
  const f = solarFrame({ kind: 'tracker', axisAzimuth: 180, origin: [100, 50, 200] });
  const world = (X, Z) => X * 0.01 + Z * 0.02;               // 世界的斜面
  const g = f.localGround(world);
  for (const [x, z] of [[0, 0], [3000, 0], [0, -4000], [1234, 567]]) {
    const w = f.toWorld([x, 0, z]);
    assert.ok(Math.abs(g(x, z) - (world(w[0], w[2]) - 50)) < 1e-9);
  }
  close(f.toLocal(f.toWorld([123, 45, -678])), [123, 45, -678], 1e-9, 'toLocal∘toWorld');
});

test('遮陰：structure 的追日陣列接 core/solar，冬至早上不回溯會遮、回溯不遮', () => {
  const lay = layoutTracker({ rows: 3, across: 8, pitch: 2278 / 0.4 });
  const f = solarFrame({ kind: 'tracker', axisAzimuth: 180 });
  const sp = S.solarPosition(S.unixFromLocal(2026, 12, 21, 8, 0, 0, 8), { lat: 23, lon: 120.2, elevation: 0, deltaT: 69.2 });
  const shade = backtrack => {
    const th = S.singleAxis(sp.apparentZenith, sp.azimuth, { axisAzimuth: 180, maxAngle: 60, gcr: 0.4, backtrack }).theta;
    const mods = f.modules(lay, th), L = S.createTriangleList(); S.modulesToTriangles(mods, L);
    const r = S.shadeModules(S.buildBVH(L.positions, L.owners), mods.map(m => S.moduleLayout({ ...m, samples: [8, 2] })), S.sunVector(sp.apparentZenith, sp.azimuth));
    return Math.max(...r.area);
  };
  assert.ok(shade(false) > 0.05, `不回溯 ${shade(false)}`);
  assert.ok(shade(true) < 0.01, `回溯 ${shade(true)}`);
});
