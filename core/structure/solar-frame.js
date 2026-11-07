// core/structure 與 core/solar 的座標對齊（core 1.20.0）。
//
// 兩邊的慣例：
//   core/solar      世界座標：X 東、Y 上、Z 南（mm）；方位角從北順時針（180 = 南）；追日轉角 θ 用 pvlib 的號誌（早上 < 0 朝東、下午 > 0 朝西）。
//   core/structure  本地座標：列沿 +X；固定式模組朝 +Z 傾（低邊在 +Z）；追日軸沿 +X，轉角 φ 繞 +X 右手定則（φ > 0 法向往 +Z 傾）。
// 對齊方式：structure 的整組（buildStructure 的 root）繞 Y 轉 yaw，再平移到 origin。
//   固定式朝 azimuth：yaw = 180° − azimuth（朝南時 yaw = 0，兩邊座標相同）。
//   追日軸沿 axisAzimuth：yaw = 90° − axisAzimuth（南北軸時 yaw = −90°：本地 +X → 南、本地 +Z → 西），
//   這時 φ = θ（下午 θ > 0，法向往本地 +Z＝西傾，和 solar 的號誌相同；test/solar-frame.test.mjs 逐片對照 trackerArray）。
// 地形：structure 的 height(x, z) 用本地座標，案場的地形（core/geo 的 DSM）用世界座標，用 localGround 轉。
//
//   const f = solarFrame({ kind: 'tracker', axisAzimuth: 180, origin: [x, y, z] });
//   const lay = layoutTracker({ ..., height: f.localGround(worldGround) });
//   const st = buildStructure(lay); f.place(st.root);                 // 3D：設 rotation.y 與 position
//   const mods = f.modules(lay, θ);                                   // solar 的板片（o、a、b），給 shadeModules／modulesToTriangles
//   st.set({ angle: f.angle(θ) });                                    // 3D 的轉角
// 純計算（不依賴 three，三角函數用 dmath）；place 只設 Object3D 的 rotation 與 position。
import { sin, cos } from '../math/dmath.js';     // 接到 core/solar 的遮陰計算，Node 與瀏覽器要逐位元相同

const D2R = Math.PI / 180;
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

// 繞任意軸（單位向量 d、通過 p）轉 deg 度：Rodrigues
function rotateAbout(v, d, deg, p = null) {
  const a = deg * D2R, c = cos(a), s = sin(a), w = p ? [v[0] - p[0], v[1] - p[1], v[2] - p[2]] : v;
  const k = cross(d, w), kd = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
  const r = [w[0] * c + k[0] * s + d[0] * kd * (1 - c), w[1] * c + k[1] * s + d[1] * kd * (1 - c), w[2] * c + k[2] * s + d[2] * kd * (1 - c)];
  return p ? [r[0] + p[0], r[1] + p[1], r[2] + p[2]] : r;
}

/**
 * @param o { kind: 'fixed' | 'tracker', azimuth = 180（固定式的朝向）, axisAzimuth = 180（追日軸）, origin = [0, 0, 0]（本地原點在世界的位置） }
 * @returns { yaw（度）, toWorld(p), toLocal(p), dirToWorld(v), localGround(worldGround), angle(θ), modules(layout, θ?), place(object3D) }
 */
export function solarFrame({ kind = 'fixed', azimuth = 180, axisAzimuth = 180, origin = [0, 0, 0] } = {}) {
  const yaw = kind === 'tracker' ? 90 - axisAzimuth : 180 - azimuth, r = yaw * D2R, c = cos(r), s = sin(r);
  // three.js 的 rotation.y：x' = x cosψ + z sinψ、z' = −x sinψ + z cosψ
  const dirToWorld = v => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const toWorld = p => { const q = dirToWorld(p); return [q[0] + origin[0], q[1] + origin[1], q[2] + origin[2]]; };
  const toLocal = p => { const x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2]; return [x * c - z * s, y, x * s + z * c]; };
  // 本地 (x, z) → 世界 (X, Z) 查地形，回傳本地的高度（相對 origin 的 Y）
  const localGround = worldGround => (x, z) => { const w = toWorld([x, 0, z]); return worldGround(w[0], w[2]) - origin[1]; };
  const angle = theta => kind === 'tracker' ? theta : 0;
  // structure 的模組（center、tx 沿列或沿軸、n 法向、size [沿 tx, 沿 tx×n, 厚]）→ solar 的板片 { o, a, b }，a × b = 受光面法向
  function modules(layout, theta = 0) {
    const phi = angle(theta);
    return layout.modules.map((m, i) => {
      let C = m.center, tx = m.tx, n = m.n;
      if (m.pivot && phi) { C = rotateAbout(C, m.pivot.d, phi, m.pivot.p); tx = rotateAbout(tx, m.pivot.d, phi); n = rotateAbout(n, m.pivot.d, phi); }
      // 受光面在模組上表面：中心往法向推半個厚度
      const top = [C[0] + n[0] * m.size[2] / 2, C[1] + n[1] * m.size[2] / 2, C[2] + n[2] * m.size[2] / 2];
      const tz = cross(tx, n), u = tx.map(v => v * m.size[0]), v = tz.map(k => k * m.size[1]);   // u × v = −n，所以 a = v、b = u
      const o = toWorld([top[0] - u[0] / 2 - v[0] / 2, top[1] - u[1] / 2 - v[1] / 2, top[2] - u[2] / 2 - v[2] / 2]);
      return { o, a: dirToWorld(v), b: dirToWorld(u), id: m.id, row: m.row ?? m.table, index: i, owner: i };
    });
  }
  function place(obj) { obj.rotation.set(0, r, 0); obj.position.set(origin[0], origin[1], origin[2]); return obj; }
  return { kind, yaw, toWorld, toLocal, dirToWorld, localGround, angle, modules, place };
}
