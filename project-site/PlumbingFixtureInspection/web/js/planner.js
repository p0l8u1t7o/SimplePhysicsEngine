// 產品檔自動規劃（免教導的核心，計畫書 4.2、4.3）：輸入產品網格（CAD 轉出或 3D 掃描），輸出 A/B 面、設計特徵遮罩、
// 視角集合與拍攝順序。純計算、決定性，Node（tools/import-cad.mjs）與瀏覽器共用；可達性與移動時間由呼叫端以回呼提供（手臂 IK）。
//
// 產品座標：+Y 為安裝軸（夾持端在 y = 0、往 +Y 伸出），單位 mm。
// 流程：
//   1. classify：每個三角形從 98 個方向做正交深度圖，算「開放度」（被看得到的方向佔的比例，依入射角加權）。
//      開放度低（內孔、深溝）→ 不檢；夾持端 mountBand 以內 → B 面；其餘 → A 面。
//   2. featureMask：依 B-rep 面（CAD 匯入時保留）找小半徑倒角／凸環（稜線）、銳邊、小平面（標誌／銘牌面）、小孔與螺牙，標成遮罩。
//   3. planViews：候選視角＝錨點（產品上要送到甜蜜點的點）× 產品軸傾角 × 方位 × 自轉；排除會撞到條紋屏、相機、LED 陣列的姿態；
//      每個候選用透視深度圖找看得到、而且「可量測」的三角形：入射角 ≤ 上限、在景深與視野內、
//      鏡面（偏折術）時相機視線經表面反射要打到條紋屏。以貪婪集合覆蓋挑最少姿態，挑中的才問手臂可不可達。
//   4. orderViews：最近鄰＋2-opt，以關節移動時間排拍攝順序（類 TSP）。
import * as THREE from 'three';
import { createRaster } from './raster.js';
import { OPTICS, MEASURE, TABLE_Y, MACHINE, screenRects } from './layout.js';

const D2R = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- 網格前處理
// positions：Float32Array（mm）；index：三角形索引；face：每個三角形的 B-rep 面編號（沒有時全部 0）
export function prepareMesh({ positions, index, face = null }) {
  const nt = index.length / 3, nv = positions.length / 3;
  const cen = new Float32Array(nt * 3), nor = new Float32Array(nt * 3), area = new Float32Array(nt);
  const min = V(Infinity, Infinity, Infinity), max = V(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < nv; i++) { const p = V(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]); min.min(p); max.max(p); }
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const e1x = positions[b] - positions[a], e1y = positions[b + 1] - positions[a + 1], e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a], e2y = positions[c + 1] - positions[a + 1], e2z = positions[c + 2] - positions[a + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const L = Math.hypot(nx, ny, nz); area[t] = L / 2;
    if (L > 0) { nx /= L; ny /= L; nz /= L; }
    nor.set([nx, ny, nz], t * 3);
    cen.set([(positions[a] + positions[b] + positions[c]) / 3, (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3], t * 3);
  }
  const center = min.clone().add(max).multiplyScalar(.5);
  return { positions, index, face: face || new Uint16Array(nt), nt, nv, cen, nor, area, min, max, center, radius: max.distanceTo(min) / 2 };
}

const sum = (m, pick) => { let s = 0; for (let t = 0; t < m.nt; t++) if (pick(t)) s += m.area[t]; return s; };

// 均勻分布的方向（Fibonacci 球面），決定性
export function sphereDirs(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + .5) / n, r = Math.sqrt(1 - y * y); out.push(V(Math.cos(g * i) * r, y, Math.sin(g * i) * r)); }
  return out;
}
function basis(d) {
  const u = Math.abs(d.y) < .9 ? V(0, 1, 0).cross(d).normalize() : V(1, 0, 0).cross(d).normalize();
  return [u, d.clone().cross(u).normalize()];
}

// ---------------------------------------------------------------- 1. A／B／不檢
export const CLASS = { A: 0, B: 1, NONE: 2 };
export function classify(m, { mountBand = 6, openThreshold = .4, dirs = 98 } = {}) {
  const D = sphereDirs(dirs), vis = new Float32Array(m.nt), tot = new Float32Array(m.nt);
  const px = Math.max(.2, m.radius * 2 / 420), W = Math.ceil(m.radius * 2 / px) + 6, r = createRaster(W, W), P = m.positions, c = m.center;
  const sx = new Float32Array(m.nv), sy = new Float32Array(m.nv), sz = new Float32Array(m.nv);
  for (const d of D) {                                    // d：從產品指向觀看者
    const [u, v] = basis(d);
    for (let i = 0; i < m.nv; i++) {
      const x = P[i * 3] - c.x, y = P[i * 3 + 1] - c.y, z = P[i * 3 + 2] - c.z;
      sx[i] = (x * u.x + y * u.y + z * u.z) / px + W / 2; sy[i] = (x * v.x + y * v.y + z * v.z) / px + W / 2; sz[i] = -(x * d.x + y * d.y + z * d.z);
    }
    r.clear();
    for (let t = 0; t < m.nt; t++) { const a = m.index[t * 3], b = m.index[t * 3 + 1], e = m.index[t * 3 + 2]; r.tri(sx[a], sy[a], sz[a], sx[b], sy[b], sz[b], sx[e], sy[e], sz[e]); }
    for (let t = 0; t < m.nt; t++) {
      const k = t * 3, cosA = m.nor[k] * d.x + m.nor[k + 1] * d.y + m.nor[k + 2] * d.z;
      if (cosA <= .05) continue;
      tot[t] += cosA;
      const x = m.cen[k] - c.x, y = m.cen[k + 1] - c.y, z = m.cen[k + 2] - c.z;
      const X = (x * u.x + y * u.y + z * u.z) / px + W / 2, Y = (x * v.x + y * v.y + z * v.z) / px + W / 2, Z = -(x * d.x + y * d.y + z * d.z);
      if (Z <= r.depthAt(X, Y) + px * 1.5) vis[t] += cosA;
    }
  }
  const open = new Float32Array(m.nt), cls = new Uint8Array(m.nt);
  for (let t = 0; t < m.nt; t++) {
    open[t] = tot[t] > 0 ? vis[t] / tot[t] : 0;
    cls[t] = open[t] < openThreshold ? CLASS.NONE : m.cen[t * 3 + 1] < m.min.y + mountBand ? CLASS.B : CLASS.A;
  }
  return { cls, open };
}

// ---------------------------------------------------------------- 2. 設計特徵遮罩
export const MASK = { NONE: 0, EDGE: 1, LOGO: 2, HOLE: 3 };
export const MASK_NAMES = ['', '稜線／倒角', '標誌／銘牌面', '孔／螺牙'];
// 頂點焊接（CAD 轉出的網格在 B-rep 面交界是重複頂點）→ 邊 → 相鄰三角形
function adjacency(m) {
  const key = new Map(), weld = new Int32Array(m.nv), P = m.positions;
  for (let i = 0; i < m.nv; i++) {
    const k = `${Math.round(P[i * 3] * 200)},${Math.round(P[i * 3 + 1] * 200)},${Math.round(P[i * 3 + 2] * 200)}`;
    if (!key.has(k)) key.set(k, i); weld[i] = key.get(k);
  }
  const edges = new Map();
  for (let t = 0; t < m.nt; t++) for (let e = 0; e < 3; e++) {
    const a = weld[m.index[t * 3 + e]], b = weld[m.index[t * 3 + (e + 1) % 3]], k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const l = edges.get(k); if (l) l.push(t); else edges.set(k, [t]);
  }
  return edges;
}
export function featureMask(m, cls, { filletR = 1.3, sharp = 35, logoArea = 900, holeR = 4, faceKinds = null } = {}) {
  const mask = new Uint8Array(m.nt), edges = adjacency(m);
  const nf = Math.max(...m.face) + 1, kappa = Array.from({ length: nf }, () => []), farea = new Float64Array(nf), fn = Array.from({ length: nf }, () => V());
  const dot = (a, b) => m.nor[a * 3] * m.nor[b * 3] + m.nor[a * 3 + 1] * m.nor[b * 3 + 1] + m.nor[a * 3 + 2] * m.nor[b * 3 + 2];
  const dist = (a, b) => Math.hypot(m.cen[a * 3] - m.cen[b * 3], m.cen[a * 3 + 1] - m.cen[b * 3 + 1], m.cen[a * 3 + 2] - m.cen[b * 3 + 2]);
  const fc = Array.from({ length: nf }, () => V());
  for (let t = 0; t < m.nt; t++) {
    const f = m.face[t]; farea[f] += m.area[t];
    fn[f].add(V(m.nor[t * 3], m.nor[t * 3 + 1], m.nor[t * 3 + 2]).multiplyScalar(m.area[t]));
    fc[f].add(V(m.cen[t * 3], m.cen[t * 3 + 1], m.cen[t * 3 + 2]).multiplyScalar(m.area[t]));
  }
  // 凹度：法向量指向面重心的程度（小孔、螺牙為正；整圈凸環、倒角為負）
  const concave = new Float64Array(nf);
  for (let f = 0; f < nf; f++) fc[f].divideScalar(farea[f] || 1);
  for (let t = 0; t < m.nt; t++) {
    const f = m.face[t], d = fc[f].clone().sub(V(m.cen[t * 3], m.cen[t * 3 + 1], m.cen[t * 3 + 2]));
    if (d.lengthSq() > 1e-9) concave[f] += m.area[t] * d.normalize().dot(V(m.nor[t * 3], m.nor[t * 3 + 1], m.nor[t * 3 + 2]));
  }
  for (const tris of edges.values()) {
    if (tris.length !== 2) continue;
    const [a, b] = tris, ang = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
    if (m.face[a] === m.face[b]) { const d = dist(a, b); if (d > 1e-6) kappa[m.face[a]].push(ang / d); }
    else if (ang > sharp * D2R) { mask[a] = mask[b] = MASK.EDGE; }       // 面與面交界的銳邊
  }
  const faces = [];
  for (let f = 0; f < nf; f++) {
    const k = kappa[f].sort((x, y) => x - y), k90 = k.length ? k[Math.floor(k.length * .9)] : 0, flat = k90 < .01;
    const n = fn[f].clone().divideScalar(farea[f] || 1), planar = flat && n.length() > .98;
    let kind = faceKinds?.[f] ?? MASK.NONE;
    if (faceKinds?.[f] == null) {
      const cv = concave[f] / (farea[f] || 1);
      if (!flat && k90 >= 1 / holeR && n.length() < .3 && cv > .5) kind = MASK.HOLE;               // 小圓孔、螺牙（法向量互相抵銷且朝內）
      else if (k90 >= 1 / filletR && farea[f] < .06 * sum(m, () => true)) kind = MASK.EDGE;         // 小半徑倒角
      else if (planar && farea[f] < logoArea && Math.abs(n.normalize().y) < .9) kind = MASK.LOGO;   // 側面的小平面＝標誌／銘牌
    }
    faces.push({ area: +farea[f].toFixed(1), r: k90 ? +(1 / k90).toFixed(2) : null, kind });
  }
  for (let t = 0; t < m.nt; t++) { const k = faces[m.face[t]].kind; if (k && !mask[t]) mask[t] = k; if (cls[t] === CLASS.NONE) mask[t] = 0; }
  return { mask, faces };
}

// ---------------------------------------------------------------- 3. 視角規劃
// 姿態：產品旋轉 quat（產品 +Y → 世界方向 axis，再繞自身軸 spin），平移使錨點落在甜蜜點 S
export function poseOf(anchor, axis, spin) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin));
  const S = V(...OPTICS.S), pos = S.clone().sub(anchor.clone().applyQuaternion(q));
  return { quat: q, pos };
}
// 錨點：A／B 面三角形重心做最遠點取樣＋Lloyd，數量依產品長度與視野決定（大件分段送到甜蜜點）
function anchorsOf(m, w) {
  const pts = []; for (let t = 0; t < m.nt; t++) if (w[t] > 0) pts.push(t);
  const span = m.max.clone().sub(m.min), len = Math.max(span.x, span.y, span.z), k = Math.max(1, Math.ceil(len / (.42 * Math.min(...MEASURE.fov))));
  const P = t => V(m.cen[t * 3], m.cen[t * 3 + 1], m.cen[t * 3 + 2]);
  let best = pts[0], bd = -1; for (const t of pts) { const d = P(t).distanceTo(m.center); if (d > bd) { bd = d; best = t; } }
  const seeds = [P(best)];
  while (seeds.length < k) { let far = null, fd = -1; for (const t of pts) { const p = P(t), d = Math.min(...seeds.map(s => s.distanceTo(p))); if (d > fd) { fd = d; far = p; } } seeds.push(far); }
  for (let it = 0; it < 8; it++) {
    const acc = seeds.map(() => [V(), 0]);
    for (const t of pts) { const p = P(t); let j = 0, jd = Infinity; seeds.forEach((s, i) => { const d = s.distanceTo(p); if (d < jd) { jd = d; j = i; } }); acc[j][0].addScaledVector(p, m.area[t]); acc[j][1] += m.area[t]; }
    acc.forEach(([s, a], i) => { if (a > 0) seeds[i] = s.divideScalar(a); });
  }
  return seeds;
}

// 光學艙幾何：主相機、三片條紋屏、LED 環、手臂側遮擋（快換器＋轉接頭＋手腕，沿 −axis 的圓柱）
const SCREENS = screenRects().map(s => ({ ...s, c: V(...s.c), n: V(...s.n), u: V(...s.u), v: V(0, 1, 0) }));
const CAM = V(OPTICS.S[0], OPTICS.S[1] + OPTICS.wd, OPTICS.S[2]);
const TOOL = { r: 52, len: 280 };                 // 快換器＋轉接頭＋J6 法蘭與 J5 外殼（約 132＋150 mm）
function hitsScreen(p, r) {
  for (const s of SCREENS) {
    const den = r.dot(s.n); if (den >= -1e-6) continue;
    const t = s.c.clone().sub(p).dot(s.n) / den; if (t <= 0) continue;
    const q = p.clone().addScaledVector(r, t).sub(s.c);
    if (Math.abs(q.dot(s.u)) <= s.hw && Math.abs(q.dot(s.v)) <= s.hh) return true;
  }
  return false;
}
// 點（含半徑）會不會撞到條紋屏、相機、LED 環或台面；clear：額外間隙
export function blocked(p, rad = 0, clear = 15) {
  for (const s of SCREENS) {
    const q = p.clone().sub(s.c), d = q.dot(s.n);
    if (d < clear + rad && d > -(OPTICS.screen.depth + rad) && Math.abs(q.dot(s.u)) <= s.hw + 30 + rad && Math.abs(q.dot(s.v)) <= s.hh + 30 + rad) return true;
  }
  const S = OPTICS.S, hr = Math.hypot(p.x - S[0], p.z - S[2]);
  if (p.y + rad > CAM.y - 20 - clear && hr < 75 + rad) return true;                                         // 相機鏡頭
  if (p.y + rad > S[1] + OPTICS.ledY - 25 - clear && hr > OPTICS.ledR[0] - rad - 20 && hr < OPTICS.ledR[1] + rad + 20) return true;   // LED 環
  if (p.x - rad < MACHINE.x[0] + 40 || p.x + rad > MACHINE.x[1] - 40 || p.z - rad < MACHINE.z[0] + 40 || p.y + rad > MACHINE.h - 40) return true;   // 艙壁、艙頂
  return p.y - rad < TABLE_Y + 60;
}
// 產品頂點取樣（約 1500 點，產品座標）
export function sampleVerts(m, n = 1500) { const step = Math.max(1, Math.floor(m.nv / n)), out = []; for (let i = 0; i < m.nv; i += step) out.push(V(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2])); return out; }
function collides(m, pose, axis) {
  const step = Math.max(1, Math.floor(m.nv / 1500)), p = V();
  for (let i = 0; i < m.nv; i += step) { p.set(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]).applyQuaternion(pose.quat).add(pose.pos); if (blocked(p, 0)) return true; }
  for (let s = 0; s <= TOOL.len; s += 20) if (blocked(pose.pos.clone().addScaledVector(axis, -s), TOOL.r)) return true;
  return false;
}
// 手臂側遮擋物：沿 −axis 的 12 邊形圓柱（三角形清單，世界座標）
function toolOccluder(pose, axis) {
  const [u, v] = basis(axis), out = [], n = 12, O = pose.pos, E = O.clone().addScaledVector(axis, -TOOL.len);
  const ring = (c, k) => c.clone().addScaledVector(u, Math.cos(k / n * 2 * Math.PI) * TOOL.r).addScaledVector(v, Math.sin(k / n * 2 * Math.PI) * TOOL.r);
  for (let k = 0; k < n; k++) { const a = ring(O, k), b = ring(O, k + 1), c = ring(E, k), d = ring(E, k + 1); out.push([a, b, c], [b, d, c], [O, a, b]); }
  return out;
}

// 一個候選姿態看得到、而且可量測的三角形（回傳三角形編號）
function measurable(m, pose, axis, w, { finish, raster, px, F }) {
  const W = raster.w, H = raster.h, cosMax = Math.cos(MEASURE.maxIncidence * D2R), half = MEASURE.dof / 2, S = OPTICS.S;
  const sx = new Float32Array(m.nv), sy = new Float32Array(m.nv), sz = new Float32Array(m.nv), p = V();
  const proj = (q, out) => { const dep = CAM.y - q.y; out[0] = (q.x - CAM.x) * F / dep + W / 2; out[1] = (q.z - CAM.z) * F / dep + H / 2; out[2] = dep; return out; };
  const o = [0, 0, 0];
  for (let i = 0; i < m.nv; i++) { p.set(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]).applyQuaternion(pose.quat).add(pose.pos); proj(p, o); sx[i] = o[0]; sy[i] = o[1]; sz[i] = o[2]; }
  raster.clear();
  for (let t = 0; t < m.nt; t++) { const a = m.index[t * 3], b = m.index[t * 3 + 1], c = m.index[t * 3 + 2]; raster.tri(sx[a], sy[a], sz[a], sx[b], sy[b], sz[b], sx[c], sy[c], sz[c]); }
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  for (const [a, b, c] of toolOccluder(pose, axis)) { proj(a, A); proj(b, B); proj(c, C); raster.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]); }
  const out = [], n = V(), d = V(), r = V();
  for (let t = 0; t < m.nt; t++) {
    if (!w[t]) continue;
    const k = t * 3;
    p.set(m.cen[k], m.cen[k + 1], m.cen[k + 2]).applyQuaternion(pose.quat).add(pose.pos);
    if (Math.abs(p.y - S[1]) > half) continue;                                        // 景深
    n.set(m.nor[k], m.nor[k + 1], m.nor[k + 2]).applyQuaternion(pose.quat);
    d.copy(p).sub(CAM).normalize();
    const cosI = -d.dot(n); if (cosI < cosMax) continue;                               // 入射角
    proj(p, o); if (o[0] < W * .03 || o[0] > W * .97 || o[1] < H * .03 || o[1] > H * .97) continue;   // 視野（留 3% 邊）
    if (o[2] > raster.depthAt(o[0], o[1]) + px * 2) continue;                          // 遮擋（產品自身、手臂側）
    if (finish !== 'brushed') { r.copy(d).addScaledVector(n, -2 * d.dot(n)); if (!hitsScreen(p, r)) continue; }   // 偏折術：反射要打到條紋屏
    out.push(t);
  }
  return Int32Array.from(out);
}

// reach(pose) → { ok, q, err }：手臂能不能把產品送到這個姿態（由呼叫端用 IK 算）
export function planViews(m, cls, { finish = 'chrome', reach = () => ({ ok: true }), tilts = [0, 30, 50, 70, 90, 110, 130], azimuths = [150, 165, 180, 195, 210], spins = 12,
  maxViews = 36, minGain = .002, goal = .995, log = () => { } } = {}) {
  const w = new Uint8Array(m.nt); for (let t = 0; t < m.nt; t++) w[t] = cls[t] === CLASS.NONE ? 0 : 1;
  const total = sum(m, t => w[t]);
  const anchors = anchorsOf(m, w);
  const px = .5, W = Math.ceil(MEASURE.fov[0] / px), H = Math.ceil(MEASURE.fov[1] / px), F = OPTICS.wd / px, raster = createRaster(W, H);
  const cands = [], rejected = { collision: 0, unreachable: 0 };
  anchors.forEach((anchor, ai) => {
    for (const tilt of tilts) for (const az of tilt === 0 ? [180] : azimuths) {
      const axis = V(Math.sin(tilt * D2R) * Math.cos(az * D2R), Math.cos(tilt * D2R), Math.sin(tilt * D2R) * Math.sin(az * D2R)).normalize();
      for (let s = 0; s < spins; s++) {
        const spin = s / spins * 2 * Math.PI, pose = poseOf(anchor, axis, spin);
        if (collides(m, pose, axis)) { rejected.collision++; continue; }
        const tris = measurable(m, pose, axis, w, { finish, raster, px, F });
        if (tris.length) cands.push({ anchor: ai, tilt, az, spin, axis, pose, tris });
      }
    }
  });
  log(`候選 ${cands.length}（錨點 ${anchors.length}、撞到光學艙排除 ${rejected.collision}）`);
  // 可量測上限：所有候選聯集
  const any = new Uint8Array(m.nt); for (const c of cands) for (const t of c.tris) any[t] = 1;
  const reachable = sum(m, t => any[t]);
  // 貪婪集合覆蓋：每次挑新增面積最大的候選；挑中的才算 IK，不可達就丟掉重挑
  const covered = new Uint8Array(m.nt), views = [];
  let got = 0;
  const gain = c => { let g = 0; for (const t of c.tris) if (!covered[t]) g += m.area[t]; return g; };
  while (views.length < maxViews) {
    let best = null, bg = 0;
    for (const c of cands) { if (c.dead) continue; const g = gain(c); if (g > bg + 1e-9) { bg = g; best = c; } }
    if (!best || bg < minGain * total) break;
    const rr = reach(best.pose);
    if (!rr.ok) { best.dead = true; rejected.unreachable++; continue; }
    best.dead = true;
    for (const t of best.tris) covered[t] = 1;
    got += bg;
    views.push({ ...best, q: rr.q, gain: bg, newCount: best.tris.length });
    if (got >= goal * reachable) break;
  }
  return { views, covered, anchors, total, reachable, coveredArea: got, rejected, candidates: cands.length };
}

// ---------------------------------------------------------------- 4. 拍攝順序（最近鄰＋2-opt；cost(a, b) 為移動時間，a = null 表示起點）
export function orderViews(views, cost) {
  const n = views.length, left = new Set(views.keys()), order = [];
  let cur = null;
  while (left.size) { let best = -1, bc = Infinity; for (const i of left) { const c = cost(cur, views[i]); if (c < bc) { bc = c; best = i; } } order.push(best); left.delete(best); cur = views[best]; }
  const len = o => o.reduce((s, i, k) => s + cost(k ? views[o[k - 1]] : null, views[i]), 0);
  let improved = true, cur2 = len(order);
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const o = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)], l = len(o);
      if (l < cur2 - 1e-6) { order.splice(0, n, ...o); cur2 = l; improved = true; }
    }
  }
  return { order, time: cur2 };
}

// 統計：面積（mm²）與覆蓋率
export function stats(m, cls, mask, covered) {
  const a = k => sum(m, t => cls[t] === k), c = k => sum(m, t => cls[t] === k && covered[t]);
  const A = a(CLASS.A), B = a(CLASS.B);
  return {
    area: { A: Math.round(A), B: Math.round(B), none: Math.round(a(CLASS.NONE)) },
    mask: Object.fromEntries([1, 2, 3].map(k => [MASK_NAMES[k], Math.round(sum(m, t => mask[t] === k))])),
    coverage: { A: +(c(CLASS.A) / (A || 1)).toFixed(4), B: +(c(CLASS.B) / (B || 1)).toFixed(4) },
  };
}
