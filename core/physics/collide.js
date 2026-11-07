// XPBD 布料（cloth.js）與 PBF 流體（fluid.js）共用的碰撞形狀與小工具（不載入 Rapier，也不 import three）。
// 數學和 rope.js 的 collide() 相同（方塊轉進本地座標、取最淺的面推出），另外多了：
//   - 會動的碰撞體：pos 可以是 t => [x, y, z]（每個子步更新，摩擦扣掉碰撞體自己的位移，所以被移動的板子帶著走）
//   - 開口朝上的方槽 tank（5 塊方塊）與圓桶 drum（底板＋環形桶壁），流體裝填用
//
// 單位：長度 mm、角度度；y 朝上。形狀：
//   { shape: 'plane', y }                                     水平地面（法向 +y）
//   { shape: 'box', size: [x, y, z], pos, rot }               方塊（rot 是 XYZ 歐拉角，度）
//   { shape: 'sphere', r, pos }                               球
//   { shape: 'cylinder', r, h, pos }                          實心直立圓柱（軸沿 y，pos 是中心）
//   { shape: 'tank', size: [內寬 x, 內高 y, 內深 z], wall = 10, pos, rot }   開口朝上的方槽；pos 是內底面中心
//   { shape: 'drum', r（內半徑）, h（內高）, wall = 5, pos }   開口朝上的圓桶（軸沿 y）；pos 是內底面中心
// 決定性：只用加減乘除與 Math.sqrt；三角函數用 dmath（只在準備階段算旋轉矩陣）。

// 決定性的三角函數與指數：Node 與 Chrome 的 Math.sin／cos／exp 在部分輸入差 1 ulp，改用 core/math/dmath.js（fdlibm 移植；2026-11-07 由這裡自帶的版本統一過去）。
// 站裡寫的 pos(t)／move(t)／風速函式也請用這三個（從這裡或 dmath 匯入都可以）。
import { sin as dsin, cos as dcos, exp as dexp } from '../math/dmath.js';
export { dsin, dcos, dexp };
const rad = d => d * Math.PI / 180;
export function quatOf(rot = [0, 0, 0]) {
  const [x, y, z] = rot.map(v => rad(v) / 2), c = [dcos(x), dcos(y), dcos(z)], s = [dsin(x), dsin(y), dsin(z)];
  return [s[0] * c[1] * c[2] + c[0] * s[1] * s[2], c[0] * s[1] * c[2] - s[0] * c[1] * s[2], c[0] * c[1] * s[2] + s[0] * s[1] * c[2], c[0] * c[1] * c[2] - s[0] * s[1] * s[2]];
}
// 四元數 → 3×3 旋轉矩陣（列優先）；world = M · local，local = Mᵀ · world
export function matOf([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
export function fnv(h, bytes) { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
// 決定性亂數（mulberry32，和 physics.js 的 rng 相同；這裡另抄一份，免得載入 Rapier）
export function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

// 規格 → 內部形狀（tank 拆成 5 塊方塊、drum 拆成底板圓柱＋環形桶壁）。回傳的每個形狀有 p（目前位置）、d（這一子步的位移）、move（函式或 null）
export function prepColliders(list = []) {
  const out = [];
  const add = (c, base, local = [0, 0, 0], m = null) => {
    const off = m ? mv(m, local) : local, f = typeof base === 'function' ? base : null, b0 = f ? f(0) : (base || [0, 0, 0]);
    const at = t => { const b = f ? f(t) : b0; return [b[0] + off[0], b[1] + off[1], b[2] + off[2]]; };
    const p0 = at(0);
    out.push({ ...c, p: [p0[0], p0[1], p0[2]], d: [0, 0, 0], move: f ? at : null });
  };
  for (const c of list) {
    if (c.shape === 'box') add({ shape: 'box', half: c.size.map(v => v / 2), m: matOf(quatOf(c.rot)) }, c.pos);
    else if (c.shape === 'tank') {
      const [w, h, d] = c.size, t = c.wall ?? 10, m = matOf(quatOf(c.rot)), box = (size, local) => add({ shape: 'box', half: size.map(v => v / 2), m }, c.pos, local, m);
      box([w + 2 * t, t, d + 2 * t], [0, -t / 2, 0]);
      box([t, h, d + 2 * t], [-w / 2 - t / 2, h / 2, 0]); box([t, h, d + 2 * t], [w / 2 + t / 2, h / 2, 0]);
      box([w, h, t], [0, h / 2, d / 2 + t / 2]); box([w, h, t], [0, h / 2, -d / 2 - t / 2]);
    } else if (c.shape === 'drum') {
      const t = c.wall ?? 5;
      add({ shape: 'cylinder', r: c.r + t, h: t }, c.pos, [0, -t / 2, 0]);
      add({ shape: 'annulus', r: c.r, t, h: c.h }, c.pos, [0, 0, 0]);
    } else if (c.shape === 'plane') add({ shape: 'plane', y: c.y ?? 0 }, [0, 0, 0]);
    else if (c.shape === 'sphere' || c.shape === 'cylinder') add({ shape: c.shape, r: c.r, h: c.h }, c.pos);
    else throw new Error(`碰撞形狀不支援：${c.shape}`);
  }
  return out;
}
// 子步開始時更新會動的碰撞體；d 記下這一子步的位移（摩擦用）
export function moveColliders(cs, t) {
  for (const c of cs) {
    if (!c.move) continue;
    const q = c.move(t);
    c.d[0] = q[0] - c.p[0]; c.d[1] = q[1] - c.p[1]; c.d[2] = q[2] - c.p[2];
    c.p[0] = q[0]; c.p[1] = q[1]; c.p[2] = q[2];
  }
}
export function resetColliderMotion(cs) { for (const c of cs) c.d[0] = c.d[1] = c.d[2] = 0; }

// 點 (x, y, z)（半徑 r）和形狀 c 的穿透深度；> 0 時 n[0..2] 是推出方向（單位向量）。沒有接觸回傳 ≤ 0。
// prev（[x, y, z]，上一子步的位置，可省略）：方塊、圓柱、桶壁優先從「上一步在外面的那一側」推出，快的粒子撞進薄牆時不會從背面被推出去
export function contact(c, x, y, z, r, n, prev = null) {
  n[0] = 0; n[1] = 0; n[2] = 0;
  if (c.shape === 'plane') { n[1] = 1; return c.y + r - y; }
  const dx = x - c.p[0], dy = y - c.p[1], dz = z - c.p[2];
  if (c.shape === 'sphere') {
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-9) { n[0] = dx / d; n[1] = dy / d; n[2] = dz / d; } else n[1] = 1;
    return c.r + r - d;
  }
  if (c.shape === 'cylinder') {
    const d = Math.sqrt(dx * dx + dz * dz), hh = c.h / 2 + r, side = c.r + r - d, top = hh - Math.abs(dy);
    if (!(side > 0 && top > 0)) return 0;
    const capFirst = prev && Math.abs(prev[1] - c.p[1]) >= hh && Math.sqrt((prev[0] - c.p[0]) ** 2 + (prev[2] - c.p[2]) ** 2) < c.r + r;
    if (!capFirst && side < top) { if (d > 1e-9) { n[0] = dx / d; n[2] = dz / d; } else n[0] = 1; return side; }
    n[1] = dy >= 0 ? 1 : -1; return top;
  }
  if (c.shape === 'annulus') {
    // 環形桶壁：內半徑 c.r、厚 c.t、從 p.y 到 p.y + h。靠內側往內推、靠外側往外推，壁頂往上推
    if (dy < -r || dy > c.h + r) return 0;
    const d = Math.sqrt(dx * dx + dz * dz), mid = c.r + c.t / 2;
    const dPrev = prev ? Math.sqrt((prev[0] - c.p[0]) ** 2 + (prev[2] - c.p[2]) ** 2) : d, inner = (prev && (d < c.r + c.t + r) && (d > c.r - r)) ? dPrev < mid : d < mid;
    const radial = inner ? d - (c.r - r) : c.r + c.t + r - d, top = c.h + r - dy;
    if (!(radial > 0)) return 0;
    if (top < radial || (prev && prev[1] - c.p[1] >= c.h + r)) { n[1] = 1; return top; }
    if (d > 1e-9) { const s = inner ? -1 / d : 1 / d; n[0] = dx * s; n[2] = dz * s; } else n[0] = 1;
    return radial;
  }
  if (c.shape === 'box') {
    const m = c.m;
    const lx = m[0] * dx + m[3] * dy + m[6] * dz, ly = m[1] * dx + m[4] * dy + m[7] * dz, lz = m[2] * dx + m[5] * dy + m[8] * dz;   // 轉進本地（Rᵀ）
    const ex = c.half[0] + r - Math.abs(lx), ey = c.half[1] + r - Math.abs(ly), ez = c.half[2] + r - Math.abs(lz);
    if (!(ex > 0 && ey > 0 && ez > 0)) {
      if (!prev) return 0;
      // 連續碰撞（CCD）：這一步整個穿過薄板時，用線段和加厚方塊的 slab 測試找進入的面，推回那一面外
      const qx = prev[0] - c.p[0], qy = prev[1] - c.p[1], qz = prev[2] - c.p[2];
      const P = [m[0] * qx + m[3] * qy + m[6] * qz, m[1] * qx + m[4] * qy + m[7] * qz, m[2] * qx + m[5] * qy + m[8] * qz], Lc = [lx, ly, lz];
      let tin = -Infinity, tout = Infinity, axis = -1;
      for (let a = 0; a < 3; a++) {
        const e = c.half[a] + r, d = Lc[a] - P[a];
        if (Math.abs(d) < 1e-12) { if (Math.abs(P[a]) >= e) return 0; continue; }
        let t1 = (-e - P[a]) / d, t2 = (e - P[a]) / d; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
        if (t1 > tin) { tin = t1; axis = a; } if (t2 < tout) tout = t2;
        if (tin > tout) return 0;
      }
      if (axis < 0 || tin < -1e-9 || tin > 1) return 0;          // 上一步就在裡面（tin < 0），或這一步還沒碰到
      const side = P[axis] >= 0 ? 1 : -1, depth = c.half[axis] + r - side * Lc[axis];
      n[0] = m[axis] * side; n[1] = m[3 + axis] * side; n[2] = m[6 + axis] * side;
      return depth;
    }
    // 沒有 prev（或上一步就在裡面）：取最淺的面，和 rope.js 相同。
    // 有 prev 且上一步在某幾軸的外面：只在那幾軸裡挑，往上一步所在的那一側推（穿過一半以上時深度 = 半寬 + r + |l|）
    let sx = lx >= 0 ? 1 : -1, sy = ly >= 0 ? 1 : -1, sz = lz >= 0 ? 1 : -1, cx = ex, cy = ey, cz = ez;
    if (prev) {
      const qx = prev[0] - c.p[0], qy = prev[1] - c.p[1], qz = prev[2] - c.p[2];
      const px = m[0] * qx + m[3] * qy + m[6] * qz, py = m[1] * qx + m[4] * qy + m[7] * qz, pz = m[2] * qx + m[5] * qy + m[8] * qz;
      const ox = Math.abs(px) >= c.half[0] + r, oy = Math.abs(py) >= c.half[1] + r, oz = Math.abs(pz) >= c.half[2] + r;
      if (ox || oy || oz) {
        const BIG = 1e30;
        if (ox) { sx = px >= 0 ? 1 : -1; cx = c.half[0] + r - sx * lx; } else cx = BIG;
        if (oy) { sy = py >= 0 ? 1 : -1; cy = c.half[1] + r - sy * ly; } else cy = BIG;
        if (oz) { sz = pz >= 0 ? 1 : -1; cz = c.half[2] + r - sz * lz; } else cz = BIG;
      }
    }
    let ax = 0, ay = 0, az = 0, depth;
    if (cx <= cy && cx <= cz) { depth = cx; ax = sx; } else if (cy <= cz) { depth = cy; ay = sy; } else { depth = cz; az = sz; }
    n[0] = m[0] * ax + m[1] * ay + m[2] * az; n[1] = m[3] * ax + m[4] * ay + m[5] * az; n[2] = m[6] * ax + m[7] * ay + m[8] * az;
    return depth;
  }
  return 0;
}

// 把第 i 個點推出所有形狀；prev 是子步開始時的位置（摩擦用：切向位移扣掉 mu 的比例，扣之前先減掉碰撞體自己的位移）。
// measure = true 時只量最大穿透（記錄用，不改位置）。回傳這個點的最大穿透
const N3 = new Float64Array(3), PV = [0, 0, 0];
export function pushOut(cs, p, prev, i, r, mu, measure = false) {
  const o = i * 3; let worst = 0;
  if (prev) { PV[0] = prev[o]; PV[1] = prev[o + 1]; PV[2] = prev[o + 2]; }
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k];
    // 上一步的位置要扣掉碰撞體這一步的位移（會動的板子推過來時，以板子為參考）
    let pv = null; if (prev) { pv = PV; pv[0] = prev[o] + c.d[0]; pv[1] = prev[o + 1] + c.d[1]; pv[2] = prev[o + 2] + c.d[2]; }
    const depth = contact(c, p[o], p[o + 1], p[o + 2], r, N3, pv);
    if (!(depth > 0)) continue;
    if (measure) { if (depth > worst) worst = depth; continue; }
    const nx = N3[0], ny = N3[1], nz = N3[2];
    p[o] += nx * depth; p[o + 1] += ny * depth; p[o + 2] += nz * depth;
    if (mu > 0 && prev) {
      const mx = p[o] - prev[o] - c.d[0], my = p[o + 1] - prev[o + 1] - c.d[1], mz = p[o + 2] - prev[o + 2] - c.d[2], mn = mx * nx + my * ny + mz * nz;
      const f = mu > 1 ? 1 : mu;
      p[o] -= f * (mx - mn * nx); p[o + 1] -= f * (my - mn * ny); p[o + 2] -= f * (mz - mn * nz);
    }
  }
  return worst;
}

// 碰撞形狀的顯示用清單（tank、drum 展開後的方塊與圓柱），給範例頁畫固定物：[{ shape, size | r/h, pos, rot }]
export function colliderParts(list = [], t = 0) {
  return prepColliders(list).map(c => {
    if (c.move) { const q = c.move(t); c.p = q; }
    if (c.shape === 'box') return { shape: 'box', size: c.half.map(v => v * 2), pos: c.p, m: c.m };
    if (c.shape === 'annulus') return { shape: 'tube', r: c.r, t: c.t, h: c.h, pos: c.p };
    return { shape: c.shape, r: c.r, h: c.h, y: c.y, pos: c.p };
  });
}
