// 雨、雪的畫面（closed-form）：每顆雨滴／雪花的位置只是 (t, 編號, seed) 的函數，不做模擬——可以任意跳到某個時間、倒著拖，結果都一樣。
// 天候是「畫面」，工程數字在 snow.js（積雪、滑落、發電損失）、loads.js（雪、風載重）、runoff.js（逕流、排水）。
//
//   const P = precipitation(spec)                參數整理（數量、速度、範圍）
//   precipPoints(P, t, out?)                     雪：每顆的位置（Float32Array，count × 3）
//   precipSegments(P, t, out?)                   雨：每滴的頭尾（Float32Array，count × 6；長度 = 速度 × streak）
//   const view = createPrecipView(spec)          three.js：雨用 LineSegments、雪用 Points（圓形貼圖）；view.root 加進場景，view.apply(t)
//
// 單位：長度 mm、時間 s、速度 mm/s；y 朝上。spec：
//   { kind: 'rain' | 'snow', area: { min: [x, z], max: [x, z] }, top = 6000（生成高度）, bottom = 0（落地高度）,
//     count?（顆數；沒給就用 density × 面積）, density = 雨 40／雪 25（每 m² 幾顆，示意）, intensity?（mm/h；給了就把 density 乘上 √(intensity ÷ 5)，示意）,
//     speed = 雨 6500／雪 1000（終端速度，mm/s）, jitter = 0.15（速度的隨機比例）, wind = [wx, wz]（mm/s）,
//     gust?: { amp: [ax, az], period = 6 }（陣風：風速 = wind + amp × sin(2πt／period)，位移有解析式）,
//     sway = 120（雪花左右飄的幅度，mm）, swayHz = 0.35, streak = 0.012（雨絲長度 = 速度 × streak 秒）,
//     floor?: (x, z) => y（屋頂、地形；落到下面就藏起來）, max = 40000, seed = 1 }
// 每顆的規則：起始相位 φ、速度 v 固定；第 k 次落下的水平位置由 hash(編號, k) 決定（在範圍內均勻，往上風處挪半個漂移量，平均位置落在範圍內）；
// 一次落下的時間 H ÷ v，期間隨風漂移（風速的積分）。不碰撞、不累積；積雪厚度看 snow.js。
import * as THREE from 'three';
import { dsin, dcos } from '../physics/collide.js';     // 決定性三角函數：Node 與瀏覽器逐位元相同（Math.sin 不保證）

const TAU = Math.PI * 2, HIDE = -1e7;
// 32 位元整數雜湊（lowbias32）→ [0, 1)
function hash(a, b, seed) {
  let x = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x632be5ab, 0x85ebca77) ^ Math.imul(seed, 0xc2b2ae3d)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function precipitation(spec = {}) {
  const kind = spec.kind ?? 'rain', rain = kind === 'rain';
  const area = spec.area ?? { min: [-5000, -5000], max: [5000, 5000] };
  const W = area.max[0] - area.min[0], D = area.max[1] - area.min[1], m2 = W * D / 1e6;
  const top = spec.top ?? 6000, bottom = spec.bottom ?? 0, H = top - bottom;
  let density = spec.density ?? (rain ? 40 : 25);
  if (spec.intensity != null) density *= Math.sqrt(Math.max(0, spec.intensity) / 5);
  const count = Math.min(spec.max ?? 40000, Math.max(0, Math.round(spec.count ?? density * m2)));
  const speed = spec.speed ?? (rain ? 6500 : 1000), jitter = spec.jitter ?? 0.15, seed = (spec.seed ?? 1) >>> 0;
  const wind = spec.wind ?? [0, 0], gust = spec.gust ? { amp: spec.gust.amp ?? [0, 0], period: spec.gust.period ?? 6 } : null;
  const P = { kind, rain, area, W, D, top, bottom, H, count, speed, seed, wind, gust, floor: spec.floor || null,
    sway: rain ? 0 : spec.sway ?? 120, swayHz: spec.swayHz ?? 0.35, streak: spec.streak ?? 0.012 };
  // 每顆固定的參數（只和編號、seed 有關）
  P.v = new Float64Array(count); P.phase = new Float64Array(count); P.sw = new Float64Array(count);
  for (let i = 0; i < count; i++) { P.v[i] = speed * (1 + jitter * (2 * hash(i, -1, seed) - 1)); P.phase[i] = hash(i, -2, seed); P.sw[i] = hash(i, -3, seed); }
  return P;
}
// 風的水平位移（風速對時間的積分），x、z 兩個分量
function drift(P, t, c) {
  let d = P.wind[c] * t;
  if (P.gust) { const w = TAU / P.gust.period; d += P.gust.amp[c] / w * (1 - dcos(w * t)); }
  return d;
}
const windAt = (P, t, c) => P.wind[c] + (P.gust ? P.gust.amp[c] * dsin(TAU / P.gust.period * t) : 0);

// 第 i 顆在 t 的位置寫進 o[0..2]；回傳是否看得見
function place(P, i, t, o) {
  const v = P.v[i], T = P.H / v, c = t / T + P.phase[i], k = Math.floor(c), u = c - k, ts = (k - P.phase[i]) * T;
  const meanDx = (P.wind[0]) * T / 2, meanDz = (P.wind[1]) * T / 2;      // 往上風處挪半個漂移量
  let x = P.area.min[0] + hash(i, k * 2, P.seed) * P.W - meanDx + drift(P, t, 0) - drift(P, ts, 0);
  let z = P.area.min[1] + hash(i, k * 2 + 1, P.seed) * P.D - meanDz + drift(P, t, 1) - drift(P, ts, 1);
  const y = P.top - u * P.H;
  if (P.sway) { const a = TAU * (P.swayHz * (0.7 + 0.6 * P.sw[i]) * t + P.sw[i]); x += P.sway * dsin(a); z += P.sway * 0.6 * dcos(1.3 * a); }
  o[0] = x; o[1] = y; o[2] = z;
  if (P.floor && y < P.floor(x, z)) { o[1] = HIDE; return false; }
  return true;
}

export function precipPoints(P, t, out = new Float32Array(P.count * 3)) {
  const o = [0, 0, 0];
  for (let i = 0; i < P.count; i++) { place(P, i, t, o); out[i * 3] = o[0]; out[i * 3 + 1] = o[1]; out[i * 3 + 2] = o[2]; }
  return out;
}
export function precipSegments(P, t, out = new Float32Array(P.count * 6)) {
  const o = [0, 0, 0], wx = windAt(P, t, 0), wz = windAt(P, t, 1);
  for (let i = 0; i < P.count; i++) {
    const seen = place(P, i, t, o), k = i * 6, L = P.streak;
    out[k] = o[0]; out[k + 1] = o[1]; out[k + 2] = o[2];
    if (seen) { out[k + 3] = o[0] - wx * L; out[k + 4] = o[1] + P.v[i] * L; out[k + 5] = o[2] - wz * L; }
    else { out[k + 3] = o[0]; out[k + 4] = o[1]; out[k + 5] = o[2]; }
  }
  return out;
}

// 雪花的圓形貼圖（DataTexture，不需要 canvas，Node 也能建）
function flakeTexture(n = 32) {
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const dx = (i + 0.5) / n * 2 - 1, dy = (j + 0.5) / n * 2 - 1, r = Math.sqrt(dx * dx + dy * dy), a = Math.max(0, Math.min(1, (1 - r) * 2.2)), k = (j * n + i) * 4;
    data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = Math.round(a * a * 255);
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); tex.needsUpdate = true;
  return tex;
}

export function createPrecipView(spec = {}, { color, opacity, size = 22, name } = {}) {
  const P = precipitation(spec), root = new THREE.Group();
  root.name = name ?? `weather:${P.kind}`; root.userData.weather = true;
  const geo = new THREE.BufferGeometry();
  let obj, buf, write;
  if (P.rain) {
    buf = new Float32Array(P.count * 6); write = t => precipSegments(P, t, buf);
    obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: color ?? 0xaabdd0, transparent: true, opacity: opacity ?? 0.35, depthWrite: false }));
  } else {
    buf = new Float32Array(P.count * 3); write = t => precipPoints(P, t, buf);
    obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: color ?? 0xffffff, size, sizeAttenuation: true, map: flakeTexture(), transparent: true, opacity: opacity ?? 0.9, depthWrite: false, alphaTest: 0.02 }));
  }
  const attr = new THREE.BufferAttribute(buf, 3); attr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('position', attr);
  obj.name = root.name; obj.frustumCulled = false; obj.renderOrder = 2; root.add(obj);
  function apply(t) { write(t); attr.needsUpdate = true; }
  apply(0);
  return { root, mesh: obj, params: P, apply, dispose() { geo.dispose(); obj.material.map?.dispose(); obj.material.dispose(); } };
}
