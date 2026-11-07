// 線材、軟管、氣管的 XPBD（位置式動力學）預先烘焙（core 1.17.0，2026-11-07 拍板）：
// 錨點釘在會動的位置（手臂工具端、拖鏈出口、電盤接頭），中間受重力下垂、跟著擺動，被地面、方塊、圓柱、球擋住。
// 和剛體（physics.js）同一套用法：烘焙一次、apply(t) 只取樣，可以倒著拖；不載入 Rapier。
//
//   const rope = bakeRope(spec)             固定步長模擬整段時間（同一份 spec 在瀏覽器與 Node 逐位元相同）
//   const at = ropeSampler(rope); at(t)     任一時間的節點位置 [[x, y, z], …]（相鄰兩格線性內插）
//   const view = createRopeView(rope, { color })   three.js 管子：view.root 加進場景，view.apply(t) 更新（共用 GPU 緩衝，不每格重建）
//   ropeStats(rope)                         最大伸長率（線長夠不夠）、最低點、最大下垂
//
// 單位：長度 mm、時間 s、角度度；y 朝上。spec：
//   { name, length（線長，mm）, segments = 24, radius = 5（管半徑，碰撞與顯示）, duration, dt = 1/240, substeps = 8, iterations = 4（每子步）, hz = 60,
//     gravity = 9810, damping = 2（每秒速度衰減率，空氣與內部阻尼）, stretch = 0（拉伸柔度，0 = 不可伸長）, bend = 0.1（彎曲柔度，越大越軟；氣管 0.3、粗電纜 0.02 左右）,
//     friction = 0.4, settle = 1.5（t = 0 之前先靜置幾秒，讓起始姿態是垂好的樣子）,
//     anchors:   [{ at: 0～1（沿線長的位置；0、1 是兩端）, pos: t => [x, y, z] }]，至少兩個,
//     colliders: [{ shape: 'plane', y } | { shape: 'box', size: [x, y, z], pos, rot } | { shape: 'sphere', r, pos } | { shape: 'cylinder', r, h, pos }（圓柱軸沿 y）] }
// 決定性：解算器只用加減乘除與 Math.sqrt，Float64 固定順序；錨點函式裡的 Math.sin 等在 Node 與瀏覽器都是 V8，實測相同。
import * as THREE from 'three';

const rad = d => d * Math.PI / 180;
function quatOf(rot = [0, 0, 0]) {
  const [x, y, z] = rot.map(v => rad(v) / 2), c = [Math.cos(x), Math.cos(y), Math.cos(z)], s = [Math.sin(x), Math.sin(y), Math.sin(z)];
  return [s[0] * c[1] * c[2] + c[0] * s[1] * s[2], c[0] * s[1] * c[2] - s[0] * c[1] * s[2], c[0] * c[1] * s[2] + s[0] * s[1] * c[2], c[0] * c[1] * c[2] - s[0] * s[1] * s[2]];
}
// 四元數 → 3×3 旋轉矩陣（列優先）；碰撞時把點轉進方塊的本地座標
function matOf([x, y, z, w]) {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function fnv(h, bytes) { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }

// 兩個錨點之間的起始形狀：拋物線往下垂，讓弧長大約等於這一段的線長（線比距離短時就拉直，交給解算器）
function initial(a, b, len, n) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), pts = [];
  let sag = 0;
  if (len > d) { let lo = 0, hi = len; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; (Math.sqrt(d * d + 16 / 3 * m * m) > len ? hi = m : lo = m); } sag = lo; }
  for (let i = 0; i <= n; i++) { const u = i / n; pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - 4 * sag * u * (1 - u), a[2] + (b[2] - a[2]) * u]); }
  return pts;
}

export function bakeRope(spec) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = Math.max(2, spec.segments ?? 24), N = n + 1, L = spec.length, rest = L / n, r = spec.radius ?? 5;
  const dt = spec.dt ?? 1 / 240, hzWanted = spec.hz ?? 60, duration = spec.duration ?? 10, every = Math.max(1, Math.round(1 / hzWanted / dt));
  const hz = Math.abs(1 / hzWanted / dt - every) < 1e-9 ? hzWanted : 1 / (every * dt);
  const steps = Math.round(duration / dt), frames = Math.floor(steps / every) + 1, settleSteps = Math.round((spec.settle ?? 1.5) / dt);
  // 子步比多迭代有效：實測 1/240 s × 40 次迭代仍有 5% 伸長，8 個子步 × 4 次迭代只剩 0.5%
  const sub = Math.max(1, spec.substeps ?? 8), h = dt / sub, iters = spec.iterations ?? 4, g = spec.gravity ?? 9810, damp = Math.max(0, 1 - (spec.damping ?? 2) * h), mu = spec.friction ?? 0.4;
  const aStretch = (spec.stretch ?? 0) / (h * h), aBend = (spec.bend ?? 0.1) / (h * h);
  const anchors = (spec.anchors || []).map(a => ({ i: Math.round((a.at ?? 0) * n), pos: typeof a.pos === 'function' ? a.pos : () => a.pos }))
    .sort((x, y) => x.i - y.i);
  if (anchors.length < 2) throw new Error('bakeRope：至少要兩個錨點（anchors）');
  if (!(L > 0)) throw new Error('bakeRope：要給線長 length（mm）');
  const colliders = (spec.colliders || []).map(c => c.shape === 'box' ? { ...c, half: c.size.map(v => v / 2), m: matOf(quatOf(c.rot)), p: c.pos || [0, 0, 0] } : { ...c, p: c.pos || [0, 0, 0] });

  // 起始：相鄰錨點之間各自垂成拋物線；第一個錨點之前、最後一個之後的線段從錨點往下垂
  const p = new Float64Array(N * 3), prev = new Float64Array(N * 3), v = new Float64Array(N * 3), w = new Float64Array(N).fill(1);
  const put = (i, q) => { p[i * 3] = q[0]; p[i * 3 + 1] = q[1]; p[i * 3 + 2] = q[2]; };
  const first = anchors[0], last = anchors.at(-1);
  for (let i = 0; i <= first.i; i++) { const a = first.pos(0); put(i, [a[0], a[1] - (first.i - i) * rest, a[2]]); }
  for (let k = 0; k + 1 < anchors.length; k++) { const A = anchors[k], B = anchors[k + 1], seg = initial(A.pos(0), B.pos(0), (B.i - A.i) * rest, B.i - A.i); for (let j = 0; j <= B.i - A.i; j++) put(A.i + j, seg[j]); }
  for (let i = last.i; i < N; i++) { const a = last.pos(0); put(i, [a[0], a[1] - (i - last.i) * rest, a[2]]); }
  for (const a of anchors) w[a.i] = 0;

  const lamS = new Float64Array(n), lamB = new Float64Array(Math.max(0, n - 1));
  // 距離約束（XPBD）：i、j 兩點保持 d0；alpha 是柔度 / dt²
  function distance(i, j, d0, alpha, lam, k) {
    const wi = w[i], wj = w[j], ws = wi + wj; if (ws === 0) return;
    const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-9) return;
    const C = len - d0, dl = (-C - alpha * lam[k]) / (ws + alpha); lam[k] += dl;
    const s = dl / len;
    p[i * 3] -= wi * s * dx; p[i * 3 + 1] -= wi * s * dy; p[i * 3 + 2] -= wi * s * dz;
    p[j * 3] += wj * s * dx; p[j * 3 + 1] += wj * s * dy; p[j * 3 + 2] += wj * s * dz;
  }
  let maxPen = 0;
  // 碰撞：把節點推到形狀外（加管半徑）；接觸的節點依 friction 抵消切向位移
  function collide(i, measure) {
    if (w[i] === 0) return;
    const o = i * 3;
    for (const c of colliders) {
      let nx = 0, ny = 0, nz = 0, depth = 0;
      if (c.shape === 'plane') { depth = (c.y ?? 0) + r - p[o + 1]; ny = 1; }
      else if (c.shape === 'sphere') {
        const dx = p[o] - c.p[0], dy = p[o + 1] - c.p[1], dz = p[o + 2] - c.p[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        depth = c.r + r - d; if (d > 1e-9) { nx = dx / d; ny = dy / d; nz = dz / d; } else ny = 1;
      } else if (c.shape === 'cylinder') {
        const dx = p[o] - c.p[0], dz = p[o + 2] - c.p[2], dy = p[o + 1] - c.p[1], d = Math.sqrt(dx * dx + dz * dz), hh = c.h / 2 + r;
        const side = c.r + r - d, top = hh - Math.abs(dy);
        if (side > 0 && top > 0) { if (side < top) { depth = side; if (d > 1e-9) { nx = dx / d; nz = dz / d; } else nx = 1; } else { depth = top; ny = dy >= 0 ? 1 : -1; } }
      } else if (c.shape === 'box') {
        const m = c.m, dx = p[o] - c.p[0], dy = p[o + 1] - c.p[1], dz = p[o + 2] - c.p[2];
        const lx = m[0] * dx + m[3] * dy + m[6] * dz, ly = m[1] * dx + m[4] * dy + m[7] * dz, lz = m[2] * dx + m[5] * dy + m[8] * dz;   // 轉進本地（Rᵀ）
        const ex = c.half[0] + r - Math.abs(lx), ey = c.half[1] + r - Math.abs(ly), ez = c.half[2] + r - Math.abs(lz);
        if (ex > 0 && ey > 0 && ez > 0) {
          let ax = 0, ay = 0, az = 0;
          if (ex <= ey && ex <= ez) { depth = ex; ax = lx >= 0 ? 1 : -1; } else if (ey <= ez) { depth = ey; ay = ly >= 0 ? 1 : -1; } else { depth = ez; az = lz >= 0 ? 1 : -1; }
          nx = m[0] * ax + m[1] * ay + m[2] * az; ny = m[3] * ax + m[4] * ay + m[5] * az; nz = m[6] * ax + m[7] * ay + m[8] * az;
        }
      }
      if (depth <= 0) continue;
      if (measure) { if (depth > maxPen) maxPen = depth; continue; }
      p[o] += nx * depth; p[o + 1] += ny * depth; p[o + 2] += nz * depth;
      // 摩擦：這一步的切向位移扣掉 mu 的比例
      const mx = p[o] - prev[o], my = p[o + 1] - prev[o + 1], mz = p[o + 2] - prev[o + 2], mn = mx * nx + my * ny + mz * nz;
      p[o] -= mu * (mx - mn * nx); p[o + 1] -= mu * (my - mn * ny); p[o + 2] -= mu * (mz - mn * nz);
    }
  }
  function step(t) {
    for (const a of anchors) { const q = a.pos(t); const o = a.i * 3; p[o] = q[0]; p[o + 1] = q[1]; p[o + 2] = q[2]; }
    for (let i = 0; i < N; i++) {
      const o = i * 3; prev[o] = p[o]; prev[o + 1] = p[o + 1]; prev[o + 2] = p[o + 2];
      if (w[i] === 0) continue;
      v[o] *= damp; v[o + 1] = (v[o + 1] - g * h) * damp; v[o + 2] *= damp;
      p[o] += v[o] * h; p[o + 1] += v[o + 1] * h; p[o + 2] += v[o + 2] * h;
    }
    lamS.fill(0); lamB.fill(0);
    for (let k = 0; k < iters; k++) {
      for (let i = 0; i < n; i++) distance(i, i + 1, rest, aStretch, lamS, i);
      for (let i = 0; i + 2 < N; i++) distance(i, i + 2, 2 * rest, aBend, lamB, i);   // 隔一點的距離：抗彎
    }
    for (let i = 0; i < N; i++) collide(i, false);
    for (let i = 0; i < N; i++) { const o = i * 3; v[o] = (p[o] - prev[o]) / h; v[o + 1] = (p[o + 1] - prev[o + 1]) / h; v[o + 2] = (p[o + 2] - prev[o + 2]) / h; }
  }
  // 一個記錄步 = sub 個子步；錨點的時間逐子步往前（t0 + h、t0 + 2h …）
  const advance = (t0, still = false) => { for (let k = 1; k <= sub; k++) step(still ? t0 : t0 + k * h); };

  for (let s = 0; s < settleSteps; s++) advance(0, true);              // 靜置：錨點停在 t = 0 的位置
  v.fill(0);
  const data = new Float32Array(frames * N * 3);
  let maxStretch = 0, minY = Infinity, f = 0;
  const record = () => {
    data.set(p, f * N * 3); f++;
    for (let i = 0; i < n; i++) { const o = i * 3, dx = p[o + 3] - p[o], dy = p[o + 4] - p[o + 1], dz = p[o + 5] - p[o + 2]; const e = Math.sqrt(dx * dx + dy * dy + dz * dz) / rest - 1; if (e > maxStretch) maxStretch = e; }
    for (let i = 0; i < N; i++) if (p[i * 3 + 1] < minY) minY = p[i * 3 + 1];
    for (let i = 0; i < N; i++) collide(i, true);
  };
  for (let s = 0; s < steps; s++) { if (s % every === 0) record(); advance(s * dt); }
  if (f < frames) record();
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  const hash = fnv(2166136261, new Uint8Array(data.buffer)).toString(16).padStart(8, '0');
  return { kind: 'rope', spec, dt, hz, duration, frames, nodes: N, radius: r, data,
    stats: { bodies: 1, nodes: N, steps, maxStretch: Math.round(maxStretch * 1e4) / 1e4, minY: Math.round(minY * 10) / 10,
      maxPenetration: Math.round(maxPen * 1000) / 1000, peakPenetration: Math.round(maxPen * 1000) / 1000, ms, hash } };
}

export function ropeSampler(b) {
  const N = b.nodes;
  return t => {
    const fr = Math.max(0, Math.min(b.frames - 1, t * b.hz)), i = Math.floor(fr), j = Math.min(b.frames - 1, i + 1), u = fr - i, A = i * N * 3, B = j * N * 3, out = [];
    for (let k = 0; k < N; k++) { const o = k * 3; out.push([0, 1, 2].map(c => b.data[A + o + c] * (1 - u) + b.data[B + o + c] * u)); }
    return out;
  };
}

// 最大伸長率（> 幾 % 代表線長不夠，實機會被扯）、整段時間的最低點、相對兩端連線的最大下垂
export function ropeStats(b) {
  const at = ropeSampler(b); let sag = 0;
  for (let f = 0; f < b.frames; f++) {
    const pts = at(f / b.hz), a = pts[0], z = pts.at(-1), lo = Math.min(a[1], z[1]);
    for (const q of pts) if (lo - q[1] > sag) sag = lo - q[1];
  }
  return { maxStretch: b.stats.maxStretch, minY: b.stats.minY, maxSag: Math.round(sag * 10) / 10 };
}

// 顯示：沿節點的圓管（平行移動的截面座標，避免扭轉），每格只改頂點與法線
export function createRopeView(b, { color = 0x45acb5, radial = 8, material = null, name = 'rope' } = {}) {
  const N = b.nodes, R = b.radius, at = ropeSampler(b);
  const pos = new Float32Array(N * radial * 3), nor = new Float32Array(N * radial * 3), idx = [];
  for (let i = 0; i + 1 < N; i++) for (let k = 0; k < radial; k++) { const a = i * radial + k, c = i * radial + (k + 1) % radial, d = a + radial, e = c + radial; idx.push(a, d, c, c, d, e); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material || new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .05 }));
  mesh.name = `physics:${name}`; mesh.castShadow = true; mesh.frustumCulled = false;
  Object.assign(mesh.userData, { physics: true, cable: true });
  const root = new THREE.Group(); root.name = name; root.userData.physics = true; root.add(mesh);
  const T = new THREE.Vector3(), Nn = new THREE.Vector3(), Bn = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function apply(t) {
    const pts = at(t);
    for (let i = 0; i < N; i++) {
      P.fromArray(pts[Math.min(N - 1, i + 1)]); Q.fromArray(pts[Math.max(0, i - 1)]); T.subVectors(P, Q).normalize();
      if (i === 0) { Nn.crossVectors(T, Math.abs(T.y) > .9 ? new THREE.Vector3(1, 0, 0) : up).normalize(); }
      else { Nn.sub(T.clone().multiplyScalar(Nn.dot(T))).normalize(); }        // 平行移動：把上一節的法向量投影到新的截面
      Bn.crossVectors(T, Nn);
      const c = pts[i];
      for (let k = 0; k < radial; k++) {
        const a = k / radial * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a), o = (i * radial + k) * 3;
        const nx = Nn.x * cs + Bn.x * sn, ny = Nn.y * cs + Bn.y * sn, nz = Nn.z * cs + Bn.z * sn;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; pos[o] = c[0] + nx * R; pos[o + 1] = c[1] + ny * R; pos[o + 2] = c[2] + nz * R;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.computeBoundingSphere(); geo.computeBoundingBox();
  }
  apply(0);
  return { root, mesh, apply, dispose() { geo.dispose(); if (!material) mesh.material.dispose(); } };
}
