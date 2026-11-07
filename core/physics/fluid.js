// 粒子流體（Position-Based Fluids，Macklin & Müller 2013）CPU 預先烘焙：烘焙一次、apply(t) 只取樣，可以倒著拖；不載入 Rapier。
// 用途是「畫面」：噴嘴注入、桶槽裝填、溢流、噴灑落點。工程數字（管路壓降、流量）用 1D 管網水力，流場用外部 CFD（2026-11-07 拍板）。
//
//   const fluid = bakeFluid(spec)               固定步長模擬整段時間（同一份 spec 在瀏覽器與 Node 逐位元相同）
//   const at = fluidSampler(fluid); at(t)       任一時間的 { count, positions: Float32Array（緊密排列 count × 3）, ids }
//   const view = createFluidView(fluid, { color, mode: 'points' | 'spheres' })   three.js：view.root 加進場景，view.apply(t) 更新
//   fluidStats(fluid, t, { region, area })      region 內的粒子數、體積（L）、等效液位（體積 ÷ 面積）、表面高度（95 百分位）
//
// 單位：長度 mm、時間 s；y 朝上。一顆粒子代表 spacing³ 的液體（spacing 10 mm → 1 mL）。spec：
//   { name, spacing = 10（粒徑，mm）, kernel = 2 × spacing（核半徑）, duration, dt = 1/120, substeps = 1, iterations = 3, hz = 30, gravity = 9810, seed = 1,
//     max = 5000（同時存在的粒子上限，到了就停止注入，stats.capped = true）, viscosity = 0.02（XSPH，0～0.5）, vorticity = 0（渦度補償強度，mm/s 量級，50～500；0 = 關）,
//     relax = 0.05（密度約束的鬆弛比例：越大越軟、越穩）, clamp = 0.2（每輪位置修正上限，× spacing；防止衝擊時彈射）, wallDensity = true（碰撞面補上牆後的密度，粒子不會擠向牆）, friction = 0.1（碰撞面的切向摩擦）, damping = 0（每秒速度衰減率）,
//     emitters: [{ type: 'nozzle', pos, dir, speed（mm/s）, radius?（噴嘴半徑 mm）| rate?（粒子／s）| flow?（L/min）, start = 0, stop = ∞, count? }
//              | { type: 'fill', min: [x, y, z], max: [x, y, z], start = 0 }],          fill：在方塊範圍內排滿粒子（初始液體）
//     colliders: collide.js 的形狀（plane、box、sphere、cylinder、tank、drum；pos 可以是 t => [x, y, z]）,
//     kill: [{ min, max }]（粒子中心進入就移除：排水口、掉出畫面）, bounds?: { min, max }（離開就移除）,
//     sleep?: { speed = 15（mm/s）, fraction = 0.01, after = 0.5（s） }（休眠，預設關：注入都結束、碰撞面都不動，而且比 speed 快的粒子不超過 fraction 連續 after 秒，
//             （PBF 靜置後表面的少數粒子會一直以 10～20 mm/s 微動，所以不要求每一顆都慢）
//             就停止模擬，之後的格沿用最後的狀態；stats.sleptAt 記停下的時間。碰撞面的 pos 是函式時不會休眠） }
// 解算：每子步 預測位置 → 空間雜湊找鄰居（固定順序）→ iterations 次密度約束（Poly6 密度、Spiky 梯度，只在壓縮時推開：單向約束，不會黏成團）
//       ＋碰撞 → 更新速度 → XSPH 黏滯 →（選用）渦度補償。
// 決定性：只用加減乘除與 Math.sqrt，Float64 固定順序；鄰居清單依格子順序與粒子編號排列；噴嘴的位置抖動用 seed 的 mulberry32。
import * as THREE from 'three';
import { prepColliders, moveColliders, pushOut, contact, fnv, rng, now } from './collide.js';

const PI = Math.PI;

// 噴嘴截面的格點（垂直 dir 的圓盤，間距 s）
function discLattice(dir, radius, s) {
  const l = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2), d = dir.map(x => x / l);
  const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]; const ul = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]); u = u.map(x => x / ul);   // 不用 Math.hypot（Node 與 Chrome 在部分輸入差 1 ulp）
  const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const pts = [], n = Math.ceil(radius / s);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = i * s, y = j * s; if (x * x + y * y > radius * radius + 1e-9) continue;
    pts.push([u[0] * x + w[0] * y, u[1] * x + w[1] * y, u[2] * x + w[2] * y]);
  }
  if (!pts.length) pts.push([0, 0, 0]);
  return { d, pts };
}

export function bakeFluid(spec) {
  const t0 = now();
  const s = spec.spacing ?? 10, H = spec.kernel ?? 2 * s, H2 = H * H, pr = s / 2;
  const dt = spec.dt ?? 1 / 120, hzWanted = spec.hz ?? 30, duration = spec.duration ?? 5, every = Math.max(1, Math.round(1 / hzWanted / dt));
  const hz = Math.abs(1 / hzWanted / dt - every) < 1e-9 ? hzWanted : 1 / (every * dt);
  const steps = Math.round(duration / dt), frames = Math.floor(steps / every) + 1;
  const sub = Math.max(1, spec.substeps ?? 1), h = dt / sub, iters = spec.iterations ?? 3, g = spec.gravity ?? 9810;
  const CAP = spec.max ?? 5000, xsph = spec.viscosity ?? 0.02, vort = spec.vorticity ?? 0, mu = spec.friction ?? 0.1, damp = Math.max(0, 1 - (spec.damping ?? 0) * h);
  const random = rng(spec.seed ?? 1), colliders = prepColliders(spec.colliders);
  const kills = (spec.kill || []).map(k => ({ min: k.min, max: k.max })), bounds = spec.bounds || null;
  const SLEEP = spec.sleep ? { speed2: (spec.sleep.speed ?? 15) ** 2, fraction: spec.sleep.fraction ?? 0.01, after: spec.sleep.after ?? 0.5 } : null;

  // 核函數：Poly6（密度）與 Spiky 梯度；先用完全被包圍的立方格點算靜止密度 rho0，再把常數除掉（密度以 rho0 為 1）
  let rho0 = 0, gsum = 0, gref = 0;
  const K6 = 315 / (64 * PI * H2 * H2 * H2 * H2 * H), KS = 45 / (PI * H2 * H2 * H2);
  { const n = Math.ceil(H / s); let gx = 0;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
      const r2 = (i * i + j * j + k * k) * s * s; if (r2 >= H2) continue;
      const q = H2 - r2; rho0 += K6 * q * q * q;
      if (r2 > 0) { const r = Math.sqrt(r2), m = KS * (H - r) * (H - r); gsum += m * m; gx += m * Math.abs(i * s / r); }
    }
    void gx; }
  const W6 = K6 / rho0, WS = KS / rho0;                 // 正規化：Σ W6·(h²−r²)³ 在靜止格點 = 1
  gref = gsum * WS * WS;                                // 靜止格點上 Σ|∇C|²（不含自己那一項，當鬆弛的尺度）
  const eps = (spec.relax ?? 0.05) * gref, maxDp = (spec.clamp ?? 0.2) * s, maxDp2 = maxDp * maxDp;
  // 牆面密度（wallDensity，預設開）：靠近碰撞面的粒子少了牆那一側的鄰居，密度偏低就會擠向牆、液位變矮。
  // 把牆後當成半空間的虛擬粒子（第一層在牆後 s/2），先算好「到牆面距離 → 密度貢獻」的表，碰撞面當成局部平面查表；梯度用表的差分。
  const WALL = spec.wallDensity ?? true, TB = 64, wtab = new Float64Array(TB + 2);
  if (WALL) {
    const n = Math.ceil(H / s) + 1;
    for (let q = 0; q <= TB + 1; q++) {
      const dist = q / TB * H; let sum = 0;
      for (let k = 0; k <= n; k++) { const z = dist + s / 2 + k * s; if (z >= H) break;
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const r2 = (i * i + j * j) * s * s + z * z; if (r2 < H2) { const w2 = H2 - r2; sum += W6 * w2 * w2 * w2; } } }
      wtab[q] = sum;
    }
  }
  const N3 = new Float64Array(3), wg = WALL ? new Float64Array(CAP * 3) : null;
  // 第 a 顆的牆面密度；梯度（對粒子位置）寫進 wg
  function wallRho(a) {
    const k = a * 3; let rho = 0, gx = 0, gy = 0, gz = 0;
    for (let c = 0; c < colliders.length; c++) {
      const d = contact(colliders[c], xp[k], xp[k + 1], xp[k + 2], H, N3);
      if (!(d > 0)) continue;
      let u = (H - d) / H * TB; if (u < 0) u = 0; if (u >= TB) continue;
      const i = Math.floor(u), f = u - i, w = wtab[i] + (wtab[i + 1] - wtab[i]) * f, slope = (wtab[i + 1] - wtab[i]) * TB / H;   // 沿法向（離牆）的變化率，< 0
      rho += w; gx += slope * N3[0]; gy += slope * N3[1]; gz += slope * N3[2];
    }
    wg[k] = gx; wg[k + 1] = gy; wg[k + 2] = gz;
    return rho;
  }

  // 狀態（依粒子編號排列；移除時壓緊、保持順序）
  const x = new Float64Array(CAP * 3), xp = new Float64Array(CAP * 3), v = new Float64Array(CAP * 3), lam = new Float64Array(CAP), dp = new Float64Array(CAP * 3);
  const om = vort ? new Float64Array(CAP * 3) : null, dv = new Float64Array(CAP * 3), ids = new Int32Array(CAP);
  let n = 0, nextId = 0, capped = false;
  const MAXN = 96, nb = new Int32Array(CAP * MAXN), nbc = new Int32Array(CAP);
  let overflow = 0;
  const add = (px, py, pz, vx, vy, vz) => {
    if (n >= CAP) { capped = true; return false; }
    const k = n * 3; x[k] = px; x[k + 1] = py; x[k + 2] = pz; v[k] = vx; v[k + 1] = vy; v[k + 2] = vz; ids[n] = nextId++; n++; return true;
  };

  // 注入：fill 在 start 時排滿；nozzle 依速度累積行程，每走一個層距（約 spacing，依流量微調）放一層圓盤（加一點抖動打破對稱）
  const emitters = (spec.emitters || []).map(e => {
    if (e.type === 'fill') return { ...e, done: false, start: e.start ?? 0 };
    const speed = e.speed ?? 1000;
    // 給了 rate 或 flow：半徑取「每層間距約 s」的大小，層與層的間距再微調成剛好符合流量（格點數是整數，只靠半徑會差到 10～20%）
    const want = e.rate ?? (e.flow != null ? e.flow * 1e6 / 60 / (s * s * s) : null);       // 粒子／s
    const radius = e.radius ?? Math.sqrt((want ?? 2000) * s * s * s / speed / PI);
    const L = discLattice(e.dir ?? [0, -1, 0], radius, s), gap = want ? L.pts.length * speed / want : s;
    return { ...e, type: 'nozzle', speed, radius, L, gap, acc: 0, emitted: 0, start: e.start ?? 0, stop: e.stop ?? Infinity, count: e.count ?? Infinity,
      rate: L.pts.length * speed / gap };
  });
  function emit(t) {
    for (const e of emitters) {
      if (e.type === 'fill') {
        if (e.done || t < e.start) continue; e.done = true;
        for (let yy = e.min[1] + pr; yy <= e.max[1] - pr + 1e-9; yy += s) for (let zz = e.min[2] + pr; zz <= e.max[2] - pr + 1e-9; zz += s) for (let xx = e.min[0] + pr; xx <= e.max[0] - pr + 1e-9; xx += s)
          add(xx + (random() - 0.5) * 0.02 * s, yy, zz + (random() - 0.5) * 0.02 * s, 0, 0, 0);
        continue;
      }
      if (t < e.start || t >= e.stop || e.emitted >= e.count) continue;
      e.acc += e.speed * h;
      while (e.acc >= e.gap && e.emitted < e.count) {
        e.acc -= e.gap;
        const back = e.acc, { d, pts } = e.L;        // 這一層已經往前走了 back
        for (const q of pts) {
          if (e.emitted >= e.count) break;
          const j = (random() - 0.5) * 0.1 * s;
          if (!add(e.pos[0] + q[0] + d[0] * (back + j), e.pos[1] + q[1] + d[1] * (back + j), e.pos[2] + q[2] + d[2] * (back + j), d[0] * e.speed, d[1] * e.speed, d[2] * e.speed)) break;
          e.emitted++;
        }
      }
    }
  }

  // 鄰居搜尋：格子邊長 = 核半徑的一半（查 ±2 格，候選比 ±1 格的大格子少約 40%），計數排序（同一格內依粒子編號，順序固定）。
  // 粒子範圍的格子數 ≤ 2²¹ 時用密集格子（同一列相鄰五格在排序後是連續區段，每顆只查 25 段）；範圍太大（噴灑到很遠）才退回空間雜湊（查 125 格，格子座標不符的雜湊撞號跳過）
  const TBL = 1 << 15, MASK = TBL - 1, DENSE = 1 << 21, sorted = new Int32Array(CAP), cell = new Int32Array(CAP * 3), key = new Int32Array(CAP);
  let start = new Int32Array(TBL + 1), fillp = new Int32Array(TBL);
  const inv = 2 / H, hsh = (i, j, k) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) & MASK;
  function neighbors() {
    let i0 = Infinity, j0 = Infinity, k0 = Infinity, i1 = -Infinity, j1 = -Infinity, k1 = -Infinity;
    for (let a = 0; a < n; a++) {
      const i = Math.floor(xp[a * 3] * inv), j = Math.floor(xp[a * 3 + 1] * inv), k = Math.floor(xp[a * 3 + 2] * inv);
      cell[a * 3] = i; cell[a * 3 + 1] = j; cell[a * 3 + 2] = k;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
    }
    overflow = 0;
    if (!n) return;
    const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1, cells = nx * ny * nz, dense = cells <= DENSE, T = dense ? cells : TBL;
    if (start.length < T + 1) { start = new Int32Array(T + 1); fillp = new Int32Array(T); }
    start.fill(0, 0, T + 1);
    for (let a = 0; a < n; a++) {
      const i = cell[a * 3], j = cell[a * 3 + 1], k = cell[a * 3 + 2];
      key[a] = dense ? (i - i0) + nx * ((j - j0) + ny * (k - k0)) : hsh(i, j, k); start[key[a] + 1]++;
    }
    for (let b = 0; b < T; b++) start[b + 1] += start[b];
    fillp.set(start.subarray(0, T));
    for (let a = 0; a < n; a++) sorted[fillp[key[a]]++] = a;
    for (let a = 0; a < n; a++) {
      const ci = cell[a * 3], cj = cell[a * 3 + 1], ck = cell[a * 3 + 2], ax = xp[a * 3], ay = xp[a * 3 + 1], az = xp[a * 3 + 2], base = a * MAXN;
      let c = 0;
      if (dense) {
        const il = (ci - 2 > i0 ? ci - 2 : i0) - i0, ih = (ci + 2 < i1 ? ci + 2 : i1) - i0;
        for (let K = ck - 2; K <= ck + 2; K++) { if (K < k0 || K > k1) continue;
          for (let J = cj - 2; J <= cj + 2; J++) { if (J < j0 || J > j1) continue;
            const row = nx * ((J - j0) + ny * (K - k0));
            for (let q = start[row + il], e = start[row + ih + 1]; q < e; q++) {
              const o = sorted[q]; if (o === a) continue;
              const dx = ax - xp[o * 3], dy = ay - xp[o * 3 + 1], dz = az - xp[o * 3 + 2];
              if (dx * dx + dy * dy + dz * dz >= H2) continue;
              if (c < MAXN) nb[base + c++] = o; else overflow++;
            }
          }
        }
      } else {
        for (let dk = -2; dk <= 2; dk++) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const I = ci + di, J = cj + dj, K = ck + dk, b = hsh(I, J, K);
          for (let q = start[b], e = start[b + 1]; q < e; q++) {
            const o = sorted[q]; if (o === a) continue;
            if (cell[o * 3] !== I || cell[o * 3 + 1] !== J || cell[o * 3 + 2] !== K) continue;
            const dx = ax - xp[o * 3], dy = ay - xp[o * 3 + 1], dz = az - xp[o * 3 + 2];
            if (dx * dx + dy * dy + dz * dz >= H2) continue;
            if (c < MAXN) nb[base + c++] = o; else overflow++;
          }
        }
      }
      nbc[a] = c;
    }
  }

  let errSum = 0, errCount = 0, errMax = 0, maxPen = 0;
  function substep(t) {
    moveColliders(colliders, t);
    emit(t);
    // 預測
    for (let a = 0; a < n; a++) {
      const k = a * 3;
      v[k] *= damp; v[k + 1] = (v[k + 1] - g * h) * damp; v[k + 2] *= damp;
      xp[k] = x[k] + v[k] * h; xp[k + 1] = x[k + 1] + v[k + 1] * h; xp[k + 2] = x[k + 2] + v[k + 2] * h;
    }
    neighbors();
    for (let it = 0; it < iters; it++) {
      const last = it === iters - 1;
      // λ：C = ρ − 1（只在壓縮時 > 0），λ = −C ／ (Σ|∇C|² + ε)
      for (let a = 0; a < n; a++) {
        const k = a * 3, base = a * MAXN, c = nbc[a];
        let rho = W6 * H2 * H2 * H2, gx = 0, gy = 0, gz = 0, g2 = 0;
        if (WALL) { rho += wallRho(a); gx -= wg[k]; gy -= wg[k + 1]; gz -= wg[k + 2]; }      // g 累計的是 −∇_i C
        for (let q = 0; q < c; q++) {
          const o = nb[base + q] * 3, dx = xp[k] - xp[o], dy = xp[k + 1] - xp[o + 1], dz = xp[k + 2] - xp[o + 2], r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= H2) continue;
          const w2 = H2 - r2; rho += W6 * w2 * w2 * w2;
          const r = Math.sqrt(r2); if (r < 1e-9) continue;
          const m = WS * (H - r) * (H - r) / r, ex = m * dx, ey = m * dy, ez = m * dz;
          gx += ex; gy += ey; gz += ez; g2 += ex * ex + ey * ey + ez * ez;
        }
        const C = rho - 1;
        if (last) { const e = C > 0 ? C : 0; errSum += e; errCount++; if (e > errMax) errMax = e; }
        lam[a] = C > 0 ? -C / (g2 + gx * gx + gy * gy + gz * gz + eps) : 0;
      }
      // Δp = Σ (λi + λj) ∇W
      for (let a = 0; a < n; a++) {
        const k = a * 3, base = a * MAXN, c = nbc[a], la = lam[a];
        let px = 0, py = 0, pz = 0;
        for (let q = 0; q < c; q++) {
          const b = nb[base + q], sl = la + lam[b]; if (sl === 0) continue;
          const o = b * 3, dx = xp[k] - xp[o], dy = xp[k + 1] - xp[o + 1], dz = xp[k + 2] - xp[o + 2], r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= H2) continue;
          const r = Math.sqrt(r2); if (r < 1e-9) continue;
          const m = sl * WS * (H - r) * (H - r) / r;          // ∇_i W = −WS (H − r)² d / r；λ < 0（壓縮）時往遠離鄰居的方向推
          px -= m * dx; py -= m * dy; pz -= m * dz;
        }
        if (WALL && la !== 0) { px += la * wg[k]; py += la * wg[k + 1]; pz += la * wg[k + 2]; }   // 牆不動：只有 λ_i ∇ρ_wall
        // 一輪的修正量上限（clamp × spacing）：衝擊時的大修正會變成速度（v = Δx／h），像彈回去一樣濺很高；限制後濺起的高度比較像水
        const dl2 = px * px + py * py + pz * pz;
        if (dl2 > maxDp2) { const f = maxDp / Math.sqrt(dl2); px *= f; py *= f; pz *= f; }
        dp[k] = px; dp[k + 1] = py; dp[k + 2] = pz;
      }
      for (let a = 0; a < n; a++) {
        const k = a * 3; xp[k] += dp[k]; xp[k + 1] += dp[k + 1]; xp[k + 2] += dp[k + 2];
        pushOut(colliders, xp, x, a, pr, last ? mu : 0);     // x 是子步開始的位置：選推出面用；摩擦只在最後一輪
      }
    }
    // 速度、XSPH 黏滯（Jacobi：先算完再一起加）、渦度補償
    for (let a = 0; a < n; a++) { const k = a * 3; v[k] = (xp[k] - x[k]) / h; v[k + 1] = (xp[k + 1] - x[k + 1]) / h; v[k + 2] = (xp[k + 2] - x[k + 2]) / h; }
    if (xsph > 0 || vort > 0) {
      for (let a = 0; a < n; a++) {
        const k = a * 3, base = a * MAXN, c = nbc[a];
        let sx = 0, sy = 0, sz = 0, wx = 0, wy = 0, wz = 0;
        for (let q = 0; q < c; q++) {
          const o = nb[base + q] * 3, dx = xp[k] - xp[o], dy = xp[k + 1] - xp[o + 1], dz = xp[k + 2] - xp[o + 2], r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= H2) continue;
          const ux = v[o] - v[k], uy = v[o + 1] - v[k + 1], uz = v[o + 2] - v[k + 2], w2 = H2 - r2, W = W6 * w2 * w2 * w2;
          sx += ux * W; sy += uy * W; sz += uz * W;
          if (vort) {
            const r = Math.sqrt(r2); if (r < 1e-9) continue;
            const m = WS * (H - r) * (H - r) / r, gx = m * dx, gy = m * dy, gz = m * dz;    // ∇_j W（對 j 微分 = −∇_i W）
            wx += uy * gz - uz * gy; wy += uz * gx - ux * gz; wz += ux * gy - uy * gx;
          }
        }
        dv[k] = xsph * sx; dv[k + 1] = xsph * sy; dv[k + 2] = xsph * sz;
        if (vort) { om[k] = wx; om[k + 1] = wy; om[k + 2] = wz; }
      }
      if (vort) {
        for (let a = 0; a < n; a++) {
          const k = a * 3, base = a * MAXN, c = nbc[a], wa = Math.sqrt(om[k] ** 2 + om[k + 1] ** 2 + om[k + 2] ** 2);
          let nx = 0, ny = 0, nz = 0;
          for (let q = 0; q < c; q++) {
            const o = nb[base + q] * 3, dx = xp[k] - xp[o], dy = xp[k + 1] - xp[o + 1], dz = xp[k + 2] - xp[o + 2], r2 = dx * dx + dy * dy + dz * dz;
            if (r2 >= H2) continue;
            const r = Math.sqrt(r2); if (r < 1e-9) continue;
            const wb = Math.sqrt(om[o] ** 2 + om[o + 1] ** 2 + om[o + 2] ** 2), m = (wb - wa) * WS * (H - r) * (H - r) / r;
            nx -= m * dx; ny -= m * dy; nz -= m * dz;                                      // η = ∇|ω|（往渦度大的方向）
          }
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); if (nl < 1e-12) continue;
          nx /= nl; ny /= nl; nz /= nl;
          dv[k] += vort * h * (ny * om[k + 2] - nz * om[k + 1]); dv[k + 1] += vort * h * (nz * om[k] - nx * om[k + 2]); dv[k + 2] += vort * h * (nx * om[k + 1] - ny * om[k]);
        }
      }
      for (let a = 0; a < 3 * n; a++) v[a] += dv[a];
    }
    for (let a = 0; a < 3 * n; a++) x[a] = xp[a];
    // 移除：進入 kill 方塊或離開 bounds 的粒子（壓緊時保持編號順序）
    if (kills.length || bounds) {
      let m = 0;
      for (let a = 0; a < n; a++) {
        const k = a * 3, px = x[k], py = x[k + 1], pz = x[k + 2];
        let dead = bounds && (px < bounds.min[0] || py < bounds.min[1] || pz < bounds.min[2] || px > bounds.max[0] || py > bounds.max[1] || pz > bounds.max[2]);
        for (const z of kills) if (!dead && px >= z.min[0] && py >= z.min[1] && pz >= z.min[2] && px <= z.max[0] && py <= z.max[1] && pz <= z.max[2]) dead = true;
        if (dead) { killed++; continue; }
        if (m !== a) { const j = m * 3; x[j] = x[k]; x[j + 1] = x[k + 1]; x[j + 2] = x[k + 2]; v[j] = v[k]; v[j + 1] = v[k + 1]; v[j + 2] = v[k + 2]; ids[m] = ids[a]; }
        m++;
      }
      n = m;
    }
  }
  let killed = 0;

  // 記錄：每格存 [lo, hi) 編號區段的位置（中間已移除的填 NaN）；offsets 是每格在 data 裡的起點（以粒子計）
  const chunks = [], lo = new Int32Array(frames), offsets = new Int32Array(frames + 1);
  let total = 0, f = 0, peak = 0;
  const record = () => {
    const a = n ? ids[0] : nextId, b = n ? ids[n - 1] + 1 : nextId, len = b - a, buf = new Float32Array(len * 3).fill(NaN);
    for (let q = 0; q < n; q++) { const o = (ids[q] - a) * 3, k = q * 3; buf[o] = x[k]; buf[o + 1] = x[k + 1]; buf[o + 2] = x[k + 2]; }
    for (let q = 0; q < n; q++) { const d = pushOut(colliders, x, null, q, pr, 0, true); if (d > maxPen) maxPen = d; }
    chunks.push(buf); lo[f] = a; offsets[f] = total; total += len; f++; offsets[f] = total;
    if (n > peak) peak = n;
  };
  // 休眠：還會注入（fill 沒放、噴嘴還沒停）或有會動的碰撞面時不睡。速度用相鄰兩個記錄格的位移 ÷ 格距（畫面上看得到的動作）；
  // 子步的 v 含約束修正的雜訊，靜置後還是有幾十 mm/s，不能拿來判斷。兩格之間有粒子移除時這一格不算靜止。
  const restless = t => colliders.some(c => c.move) || emitters.some(e => e.type === 'fill' ? !e.done : e.emitted < e.count && e.stop > t);
  const snap = SLEEP ? new Float64Array(CAP * 3) : null, frameDt = every * dt;
  let calm = 0, sleptAt = null, snapN = -1, snapId = -1;
  for (let st = 0; st < steps; st++) {
    if (st % every === 0) record();
    if (sleptAt != null) continue;
    for (let k = 0; k < sub; k++) substep(st * dt + k * h);
    if (SLEEP && (st + 1) % every === 0) {
      let still = snapN === n && n > 0 && snapId === ids[0] && !restless((st + 1) * dt), fast = 0;
      const allow = Math.floor(n * SLEEP.fraction), lim = SLEEP.speed2 * frameDt * frameDt;
      for (let k = 0; still && k < 3 * n; k += 3) {
        const dx = x[k] - snap[k], dy = x[k + 1] - snap[k + 1], dz = x[k + 2] - snap[k + 2];
        if (dx * dx + dy * dy + dz * dz > lim && ++fast > allow) still = false;
      }
      calm = still ? calm + 1 : 0;
      if (calm * frameDt >= SLEEP.after - 1e-9) sleptAt = (st + 1) * dt;
      snap.set(x.subarray(0, 3 * n)); snapN = n; snapId = n ? ids[0] : -1;
    }
  }
  if (f < frames) record();
  const data = new Float32Array(total * 3); let off = 0; for (const c of chunks) { data.set(c, off); off += c.length; }
  const ms = Math.round(now() - t0);
  let hsum = fnv(2166136261, new Uint8Array(data.buffer)); hsum = fnv(hsum, new Uint8Array(lo.buffer)); hsum = fnv(hsum, new Uint8Array(offsets.buffer));
  const hash = hsum.toString(16).padStart(8, '0');
  const rates = emitters.filter(e => e.type === 'nozzle').map(e => ({ radius: Math.round(e.radius * 10) / 10, perLayer: e.L.pts.length, rate: Math.round(e.rate), flowLmin: Math.round(e.rate * s * s * s / 1e6 * 60 * 100) / 100 }));
  return { kind: 'fluid', spec, dt, hz, duration, frames, spacing: s, kernel: H, radius: pr, data, lo, offsets, emitted: nextId,
    stats: { bodies: 0, particles: nextId, alive: n, peak, killed, capped, steps: steps * sub, iterations: iters, neighborOverflow: overflow,
      avgDensityError: Math.round((errCount ? errSum / errCount : 0) * 1e4) / 1e4, maxDensityError: Math.round(errMax * 1e4) / 1e4,
      maxPenetration: Math.round(maxPen * 1000) / 1000, peakPenetration: Math.round(maxPen * 1000) / 1000, emitters: rates, ms, hash,
      ...(SLEEP ? { sleptAt: sleptAt == null ? null : Math.round(sleptAt * 1000) / 1000 } : {}) } };
}

// 取樣：t 落在第 i、j 格之間；兩格都有的粒子線性內插，只在一格的（剛生成、剛移除）取離 t 較近那格的狀態
export function fluidSampler(b) {
  let cap = 0; for (let f = 0; f < b.frames; f++) cap = Math.max(cap, b.offsets[f + 1] - b.offsets[f]);
  const positions = new Float32Array(cap * 3 * 2), idsOut = new Int32Array(cap * 2);
  return t => {
    const fr = Math.max(0, Math.min(b.frames - 1, t * b.hz)), i = Math.floor(fr), j = Math.min(b.frames - 1, i + 1), u = fr - i;
    const loA = b.lo[i], nA = b.offsets[i + 1] - b.offsets[i], A = b.offsets[i] * 3, loB = b.lo[j], nB = b.offsets[j + 1] - b.offsets[j], B = b.offsets[j] * 3;
    const first = Math.min(loA, loB), end = Math.max(loA + nA, loB + nB), D = b.data;
    let c = 0;
    for (let id = first; id < end; id++) {
      const ia = id - loA, ib = id - loB, inA = ia >= 0 && ia < nA && D[A + ia * 3] === D[A + ia * 3], inB = ib >= 0 && ib < nB && D[B + ib * 3] === D[B + ib * 3];
      let px, py, pz;
      if (inA && inB) { const a = A + ia * 3, bb = B + ib * 3; px = D[a] + (D[bb] - D[a]) * u; py = D[a + 1] + (D[bb + 1] - D[a + 1]) * u; pz = D[a + 2] + (D[bb + 2] - D[a + 2]) * u; }
      else if (inA && u < 0.5) { const a = A + ia * 3; px = D[a]; py = D[a + 1]; pz = D[a + 2]; }
      else if (inB && u >= 0.5) { const bb = B + ib * 3; px = D[bb]; py = D[bb + 1]; pz = D[bb + 2]; }
      else continue;
      positions[c * 3] = px; positions[c * 3 + 1] = py; positions[c * 3 + 2] = pz; idsOut[c] = id; c++;
    }
    return { count: c, positions, ids: idsOut };
  };
}

// region（{ min, max }）內的粒子數、體積（L）、等效液位（體積 ÷ area，mm²；沒給 area 用 region 的 x × z 面積）、表面高度（95 百分位的 y）
export function fluidStats(b, t, { region, area } = {}) {
  const { count, positions } = fluidSampler(b)(t), ys = [];
  for (let q = 0; q < count; q++) {
    const px = positions[q * 3], py = positions[q * 3 + 1], pz = positions[q * 3 + 2];
    if (region && !(px >= region.min[0] && py >= region.min[1] && pz >= region.min[2] && px <= region.max[0] && py <= region.max[1] && pz <= region.max[2])) continue;
    ys.push(py);
  }
  ys.sort((a, c) => a - c);
  const vol = ys.length * b.spacing ** 3, A = area ?? (region ? (region.max[0] - region.min[0]) * (region.max[2] - region.min[2]) : NaN);
  return { total: count, count: ys.length, outside: count - ys.length, volumeL: vol / 1e6, level: vol / A, surface: ys.length ? ys[Math.floor(0.95 * (ys.length - 1))] : NaN };
}

// 顯示：mode 'points'（預設，最省；點大小用世界單位）或 'spheres'（InstancedMesh 小球，有光影）。緩衝依最多粒子數一次配好，每格只改內容與數量
export function createFluidView(b, { color = 0x3d8fd6, mode = 'points', size = b.spacing * 1.1, opacity = 0.9, name = b.spec?.name || 'fluid', segments = 8 } = {}) {
  const at = fluidSampler(b);
  let cap = 0; for (let f = 0; f < b.frames; f++) cap = Math.max(cap, b.offsets[f + 1] - b.offsets[f]);
  cap = Math.max(1, cap);
  const root = new THREE.Group(); root.name = name; root.userData.physics = true;
  let obj, update;
  if (mode === 'spheres') {
    const geo = new THREE.SphereGeometry(size / 2, segments, Math.max(4, segments / 2 | 0)), mat = new THREE.MeshStandardMaterial({ color, roughness: .15, metalness: 0, transparent: opacity < 1, opacity });
    obj = new THREE.InstancedMesh(geo, mat, cap); obj.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const M = new THREE.Matrix4();
    update = (count, P) => { for (let q = 0; q < count; q++) { M.makeTranslation(P[q * 3], P[q * 3 + 1], P[q * 3 + 2]); obj.setMatrixAt(q, M); } obj.count = count; obj.instanceMatrix.needsUpdate = true; };
  } else {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(cap * 3), attr = new THREE.BufferAttribute(pos, 3);
    attr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('position', attr);
    obj = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
    update = (count, P) => { pos.set(P.subarray(0, count * 3)); geo.setDrawRange(0, count); attr.needsUpdate = true; };
  }
  obj.name = `physics:${name}`; obj.frustumCulled = false; Object.assign(obj.userData, { physics: true, fluid: true, nonSolid: '粒子流體' });
  root.add(obj);
  function apply(t) { const { count, positions } = at(t); update(count, positions); }
  apply(0);
  return { root, mesh: obj, apply, dispose() { obj.geometry.dispose(); obj.material.dispose(); } };
}
