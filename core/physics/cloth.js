// 布料、薄膜、軟墊的 XPBD（位置式動力學）預先烘焙，和 rope.js 同一套用法：烘焙一次、apply(t) 只取樣，可以倒著拖；不載入 Rapier。
// 用途：篷布與防塵罩蓋上設備或棧板、軟性夾爪墊片被壓、包材薄膜（拉伸膜、袋子）垂掛與被拉開。
//
//   const cloth = bakeCloth(spec)               固定步長模擬整段時間（同一份 spec 在瀏覽器與 Node 逐位元相同）
//   const at = clothSampler(cloth); at(t, out?) 任一時間的節點位置（Float32Array，nu+1 × nv+1 個節點 × 3；相鄰兩格線性內插）
//   const view = createClothView(cloth, { color })   three.js 網格：view.root 加進場景，view.apply(t) 更新（共用 GPU 緩衝，每格重算法線）
//   clothStats(cloth, { region })               最大伸長率、最低點、結束時的外框、region 內的節點比例
//
// 單位：長度 mm、時間 s、角度度；y 朝上。spec：
//   { name, size: [寬 U, 長 V]（mm）, segments: [nu, nv] = [20, 20], origin: [x, y, z]（布的中心）, axes = 'xz'（水平；'xy' 直立）或 { u: [..], v: [..] }（單位向量）,
//     thickness = 3（碰撞半厚，mm）, duration, dt = 1/240, substeps = 8, iterations = 2（每子步）, hz = 60, gravity = 9810,
//     damping = 1（每秒速度衰減率）, stretch = 0（拉伸柔度，0 = 不可伸長）, shear = 0.001（剪切柔度）, bend = 1（彎曲柔度：布 1～10、軟墊 0.01）,
//     friction = 0.5, settle = 0（t = 0 之前先靜置幾秒）,
//     pins: [{ node: [i, j] | nodes: [[i, j], …] | edge: 'u0'|'u1'|'v0'|'v1' | corners: true,
//              pos?: [x, y, z] | t => [x, y, z]（只能配單一節點：絕對位置）, move?: t => [dx, dy, dz]（相對起始位置的位移，整組一起動）, until?: 放開的時間（s） }],
//     colliders: collide.js 的形狀（plane、box、sphere、cylinder、tank、drum；pos 可以是 t => [x, y, z]）,
//     wind?: { velocity: [x, y, z] | t => [x, y, z]（mm/s）, drag = 2（1/s，法向相對風速的拖曳率） } }
// 節點編號：(i, j) → j * (nu + 1) + i；i 沿 u（寬）、j 沿 v（長）。
// 決定性：解算器只用加減乘除與 Math.sqrt，Float64 固定順序；pins、colliders、wind 的函式在 Node 與瀏覽器都是 V8。
import * as THREE from 'three';
import { prepColliders, moveColliders, resetColliderMotion, pushOut, fnv, now } from './collide.js';

const AXES = { xz: { u: [1, 0, 0], v: [0, 0, 1] }, xy: { u: [1, 0, 0], v: [0, -1, 0] }, zy: { u: [0, 0, 1], v: [0, -1, 0] } };

function pinNodes(pin, nu, nv) {
  const id = (i, j) => j * (nu + 1) + i, out = [];
  if (pin.node) out.push(id(...pin.node));
  for (const q of pin.nodes || []) out.push(id(...q));
  if (pin.corners) out.push(id(0, 0), id(nu, 0), id(0, nv), id(nu, nv));
  if (pin.edge === 'u0') for (let j = 0; j <= nv; j++) out.push(id(0, j));
  if (pin.edge === 'u1') for (let j = 0; j <= nv; j++) out.push(id(nu, j));
  if (pin.edge === 'v0') for (let i = 0; i <= nu; i++) out.push(id(i, 0));
  if (pin.edge === 'v1') for (let i = 0; i <= nu; i++) out.push(id(i, nv));
  return out;
}

export function bakeCloth(spec) {
  const t0 = now();
  const [nu, nv] = (spec.segments ?? [20, 20]).map(v => Math.max(1, Math.round(v))), NU = nu + 1, N = NU * (nv + 1);
  const [W, H] = spec.size ?? [1000, 1000], r = spec.thickness ?? 3;
  const ax = typeof spec.axes === 'object' ? spec.axes : AXES[spec.axes ?? 'xz'];
  if (!ax) throw new Error(`bakeCloth：axes 不支援 ${spec.axes}`);
  const o = spec.origin ?? [0, 0, 0];
  const dt = spec.dt ?? 1 / 240, hzWanted = spec.hz ?? 60, duration = spec.duration ?? 5, every = Math.max(1, Math.round(1 / hzWanted / dt));
  const hz = Math.abs(1 / hzWanted / dt - every) < 1e-9 ? hzWanted : 1 / (every * dt);
  const steps = Math.round(duration / dt), frames = Math.floor(steps / every) + 1, settleSteps = Math.round((spec.settle ?? 0) / dt);
  const sub = Math.max(1, spec.substeps ?? 8), h = dt / sub, iters = spec.iterations ?? 2, g = spec.gravity ?? 9810;
  const damp = Math.max(0, 1 - (spec.damping ?? 1) * h), mu = spec.friction ?? 0.5;
  const colliders = prepColliders(spec.colliders);

  // 起始：平面網格
  const p = new Float64Array(N * 3), prev = new Float64Array(N * 3), v = new Float64Array(N * 3), w = new Float64Array(N).fill(1), rest0 = new Float64Array(N * 3);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const a = (i / nu - 0.5) * W, b = (j / nv - 0.5) * H, k = (j * NU + i) * 3;
    for (let c = 0; c < 3; c++) p[k + c] = rest0[k + c] = o[c] + ax.u[c] * a + ax.v[c] * b;
  }
  // 釘住的節點：每組一個驅動（絕對位置或相對位移），until 之後放開（質量倒數改回 1）
  const pins = (spec.pins || []).map(pin => {
    const nodes = pinNodes(pin, nu, nv);
    if (!nodes.length) throw new Error('bakeCloth：pin 沒有指定節點（node、nodes、edge、corners）');
    if (pin.pos != null && nodes.length !== 1) throw new Error('bakeCloth：pin.pos 只能配單一節點；整組移動用 move: t => [dx, dy, dz]');
    const pos = typeof pin.pos === 'function' ? pin.pos : pin.pos ? () => pin.pos : null, move = typeof pin.move === 'function' ? pin.move : pin.move ? () => pin.move : null;
    return { nodes, pos, move, until: pin.until ?? Infinity, on: true };
  });
  for (const pin of pins) for (const i of pin.nodes) w[i] = 0;
  const place = (pin, t) => {
    if (!pin.on) return;
    if (pin.pos) { const q = pin.pos(t), k = pin.nodes[0] * 3; p[k] = q[0]; p[k + 1] = q[1]; p[k + 2] = q[2]; return; }
    const d = pin.move ? pin.move(t) : [0, 0, 0];
    for (const i of pin.nodes) { const k = i * 3; p[k] = rest0[k] + d[0]; p[k + 1] = rest0[k + 1] + d[1]; p[k + 2] = rest0[k + 2] + d[2]; }
  };
  for (const pin of pins) place(pin, 0);

  // 約束：結構（相鄰）、剪切（對角）、彎曲（隔一點）。每條 [i, j, 靜止長度]，依種類分三組（各自的柔度）
  const id = (i, j) => j * NU + i;
  const lists = { stretch: [], shear: [], bend: [] };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    if (i < nu) lists.stretch.push(id(i, j), id(i + 1, j)); if (j < nv) lists.stretch.push(id(i, j), id(i, j + 1));
    if (i < nu && j < nv) lists.shear.push(id(i, j), id(i + 1, j + 1), id(i + 1, j), id(i, j + 1));
    if (i + 2 <= nu) lists.bend.push(id(i, j), id(i + 2, j)); if (j + 2 <= nv) lists.bend.push(id(i, j), id(i, j + 2));
  }
  const group = (pairs, compliance) => {
    const ij = Int32Array.from(pairs), n = ij.length / 2, d0 = new Float64Array(n);
    for (let k = 0; k < n; k++) { const a = ij[2 * k] * 3, b = ij[2 * k + 1] * 3; d0[k] = Math.sqrt((rest0[b] - rest0[a]) ** 2 + (rest0[b + 1] - rest0[a + 1]) ** 2 + (rest0[b + 2] - rest0[a + 2]) ** 2); }
    return { ij, d0, n, alpha: compliance / (h * h), lam: new Float64Array(n) };
  };
  const G = [group(lists.stretch, spec.stretch ?? 0), group(lists.shear, spec.shear ?? 0.001), group(lists.bend, spec.bend ?? 1)];
  const structural = G[0];

  function solve(gr) {
    const { ij, d0, n, alpha, lam } = gr;
    for (let k = 0; k < n; k++) {
      const i = ij[2 * k], j = ij[2 * k + 1], wi = w[i], wj = w[j], ws = wi + wj; if (ws === 0) continue;
      const a = i * 3, b = j * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) continue;
      const C = len - d0[k], dl = (-C - alpha * lam[k]) / (ws + alpha); lam[k] += dl;
      const s = dl / len;
      p[a] -= wi * s * dx; p[a + 1] -= wi * s * dy; p[a + 2] -= wi * s * dz;
      p[b] += wj * s * dx; p[b + 1] += wj * s * dy; p[b + 2] += wj * s * dz;
    }
  }
  // 風：每個節點的法向（相鄰四格的面積加權），加速度 = drag × ((風速 − 節點速度) · n) n
  const wind = spec.wind ? { vel: typeof spec.wind.velocity === 'function' ? spec.wind.velocity : () => spec.wind.velocity ?? [0, 0, 0], drag: spec.wind.drag ?? 2 } : null;
  const nrm = wind ? new Float64Array(N * 3) : null;
  function normals() {
    nrm.fill(0);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = id(i, j) * 3, b = id(i + 1, j) * 3, c = id(i + 1, j + 1) * 3, d = id(i, j + 1) * 3;
      const ex = p[c] - p[a], ey = p[c + 1] - p[a + 1], ez = p[c + 2] - p[a + 2], fx = p[d] - p[b], fy = p[d + 1] - p[b + 1], fz = p[d + 2] - p[b + 2];
      const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
      for (const k of [a, b, c, d]) { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; }
    }
  }

  let maxPen = 0;
  function step(t) {
    moveColliders(colliders, t);
    for (const pin of pins) if (pin.on && t >= pin.until) { pin.on = false; for (const i of pin.nodes) w[i] = 1; }
    for (const pin of pins) place(pin, t);
    let wv = null;
    if (wind) { normals(); wv = wind.vel(t); }
    for (let i = 0; i < N; i++) {
      const k = i * 3; prev[k] = p[k]; prev[k + 1] = p[k + 1]; prev[k + 2] = p[k + 2];
      if (w[i] === 0) continue;
      if (wind) {
        const nx = nrm[k], ny = nrm[k + 1], nz = nrm[k + 2], nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nl > 1e-12) {
          const ux = nx / nl, uy = ny / nl, uz = nz / nl, rel = (wv[0] - v[k]) * ux + (wv[1] - v[k + 1]) * uy + (wv[2] - v[k + 2]) * uz, a = wind.drag * rel * h;
          v[k] += a * ux; v[k + 1] += a * uy; v[k + 2] += a * uz;
        }
      }
      v[k] *= damp; v[k + 1] = (v[k + 1] - g * h) * damp; v[k + 2] *= damp;
      p[k] += v[k] * h; p[k + 1] += v[k + 1] * h; p[k + 2] += v[k + 2] * h;
    }
    for (const gr of G) gr.lam.fill(0);
    for (let it = 0; it < iters; it++) for (const gr of G) solve(gr);
    for (let i = 0; i < N; i++) if (w[i] !== 0) pushOut(colliders, p, prev, i, r, mu);
    for (let i = 0; i < N; i++) { const k = i * 3; v[k] = (p[k] - prev[k]) / h; v[k + 1] = (p[k + 1] - prev[k + 1]) / h; v[k + 2] = (p[k + 2] - prev[k + 2]) / h; }
  }
  const advance = (ts, still = false) => { for (let k = 1; k <= sub; k++) step(still ? ts : ts + k * h); };

  for (let s = 0; s < settleSteps; s++) advance(0, true);
  if (settleSteps) { v.fill(0); resetColliderMotion(colliders); }
  const data = new Float32Array(frames * N * 3);
  let maxStretch = 0, minY = Infinity, f = 0;
  const record = () => {
    data.set(p, f * N * 3); f++;
    const { ij, d0, n } = structural;
    for (let k = 0; k < n; k++) {
      const a = ij[2 * k] * 3, b = ij[2 * k + 1] * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
      const e = Math.sqrt(dx * dx + dy * dy + dz * dz) / d0[k] - 1; if (e > maxStretch) maxStretch = e;
    }
    for (let i = 0; i < N; i++) {
      if (p[i * 3 + 1] < minY) minY = p[i * 3 + 1];
      if (w[i] !== 0) { const d = pushOut(colliders, p, null, i, r, 0, true); if (d > maxPen) maxPen = d; }
    }
  };
  for (let s = 0; s < steps; s++) { if (s % every === 0) record(); advance(s * dt); }
  if (f < frames) record();
  const ms = Math.round(now() - t0);
  const hash = fnv(2166136261, new Uint8Array(data.buffer)).toString(16).padStart(8, '0');
  const constraints = G.reduce((a, gr) => a + gr.n, 0);
  return { kind: 'cloth', spec, dt, hz, duration, frames, nodes: N, segments: [nu, nv], thickness: r, data,
    stats: { bodies: 1, nodes: N, constraints, steps, maxStretch: Math.round(maxStretch * 1e4) / 1e4, minY: Math.round(minY * 10) / 10,
      maxPenetration: Math.round(maxPen * 1000) / 1000, peakPenetration: Math.round(maxPen * 1000) / 1000, ms, hash } };
}

export function clothSampler(b) {
  const L = b.nodes * 3;
  return (t, out = new Float32Array(L)) => {
    const fr = Math.max(0, Math.min(b.frames - 1, t * b.hz)), i = Math.floor(fr), j = Math.min(b.frames - 1, i + 1), u = fr - i, A = i * L, B = j * L;
    for (let k = 0; k < L; k++) out[k] = b.data[A + k] * (1 - u) + b.data[B + k] * u;
    return out;
  };
}

// 最大伸長率、整段最低點、結束時的外框；region（{ min, max }）給了就算結束時落在裡面的節點比例（例如蓋住頂面的比例）
export function clothStats(b, { region, t = b.duration } = {}) {
  const pts = clothSampler(b)(t), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let inside = 0;
  for (let k = 0; k < b.nodes; k++) {
    for (let c = 0; c < 3; c++) { const x = pts[k * 3 + c]; if (x < min[c]) min[c] = x; if (x > max[c]) max[c] = x; }
    if (region && [0, 1, 2].every(c => pts[k * 3 + c] >= region.min[c] && pts[k * 3 + c] <= region.max[c])) inside++;
  }
  return { maxStretch: b.stats.maxStretch, minY: b.stats.minY, maxPenetration: b.stats.maxPenetration, box: { min, max }, ...(region ? { inside: inside / b.nodes } : {}) };
}

// 顯示：網格索引固定，位置緩衝每格覆寫、法線重算（computeVertexNormals 沿用同一個 normal 緩衝）
export function createClothView(b, { color = 0x3f7fbf, material = null, name = b.spec?.name || 'cloth', side = THREE.DoubleSide, opacity = 1 } = {}) {
  const [nu, nv] = b.segments, NU = nu + 1, at = clothSampler(b);
  const pos = new Float32Array(b.nodes * 3), uv = new Float32Array(b.nodes * 2), idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const k = j * NU + i; uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv; }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * NU + i, c = a + 1, d = a + NU, e = d + 1; idx.push(a, d, c, c, d, e); }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3); attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material || new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: 0, side, transparent: opacity < 1, opacity }));
  mesh.name = `physics:${name}`; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  Object.assign(mesh.userData, { physics: true, cloth: true });
  const root = new THREE.Group(); root.name = name; root.userData.physics = true; root.add(mesh);
  function apply(t) {
    at(t, pos);
    attr.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); geo.computeBoundingBox();
  }
  apply(0);
  return { root, mesh, apply, dispose() { geo.dispose(); if (!material) mesh.material.dispose(); } };
}
