// 流場的衍生量與顯示用的幾何（純 JS，瀏覽器與 Node 都能用，決定性）：
//   magnitude、pressureCoefficient、robustRange（百分位範圍）、colormap（turbo、viridis、coolwarm）、
//   resampleSlice（把切面的三角網格重新取樣成規則格點）、arrowSegments（箭頭線段）、traceStreamlines（切面內流線）。

export function magnitude(vec, n = vec.length / 3) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.hypot(vec[3 * i], vec[3 * i + 1], vec[3 * i + 2]);
  return out;
}

// Cp = (p - pRef) / (½ ρ Uref²)；p 單位 Pa
export function pressureCoefficient(pPa, { rho, Uref, pRef = 0 }) {
  const q = 0.5 * rho * Uref * Uref;
  const out = new Float32Array(pPa.length);
  for (let i = 0; i < pPa.length; i++) out[i] = (pPa[i] - pRef) / q;
  return out;
}

// 範圍：min／max 與 2%～98% 百分位（忽略 NaN）。百分位用排序後的索引，決定性
export function robustRange(values, lo = 0.02, hi = 0.98) {
  const a = Float64Array.from(values).filter(Number.isFinite).sort();
  if (!a.length) return { min: 0, max: 0, lo: 0, hi: 0 };
  const at = q => a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
  return { min: a[0], max: a[a.length - 1], lo: at(lo), hi: at(hi) };
}

// ---------------------------------------------------------------- 色表

// turbo 用 Google 公開的多項式近似（Mikhailov 2019）；viridis 取 matplotlib 9 個等距取樣；coolwarm 為 Moreland 發散色表的近似取樣
const MAPS = {
  viridis: [[0.267, 0.005, 0.329], [0.279, 0.176, 0.483], [0.231, 0.322, 0.546], [0.173, 0.448, 0.557], [0.129, 0.567, 0.551], [0.157, 0.682, 0.502], [0.369, 0.789, 0.383], [0.678, 0.863, 0.188], [0.993, 0.906, 0.144]],
  coolwarm: [[0.230, 0.299, 0.754], [0.348, 0.466, 0.888], [0.483, 0.622, 0.975], [0.619, 0.744, 0.999], [0.865, 0.865, 0.865], [0.958, 0.769, 0.678], [0.969, 0.623, 0.502], [0.889, 0.411, 0.326], [0.706, 0.016, 0.150]],
};
const turbo = t => [
  0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943)))),
  0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604)))),
  0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973)))),
].map(v => Math.min(1, Math.max(0, v)));
export const COLORMAPS = ['turbo', ...Object.keys(MAPS)];

export function colormap(name, t) {
  if (!Number.isFinite(t)) return [0.5, 0.5, 0.5];
  if (!MAPS[name]) return turbo(Math.min(1, Math.max(0, t)));
  const m = MAPS[name];
  const x = Math.min(1, Math.max(0, t)) * (m.length - 1);
  const i = Math.min(m.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map(k => m[i][k] + (m[i + 1][k] - m[i][k]) * f);
}

export function colormapStops(name, n = 9) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), c = colormap(name, t);
    return { t, color: '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') };
  });
}

// 刻度：1、2、5 × 10^n
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9 * step; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

// ---------------------------------------------------------------- 切面重新取樣

// 切面平面座標：法向用三角形法向加權平均，接近座標軸時對齊座標軸（讓格點整齊）
export function slicePlane(positions, indices) {
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
  const P = i => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  for (let t = 0; t < indices.length; t += 3) {
    const a = P(indices[t]), b = P(indices[t + 1]), c = P(indices[t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    // 方向一致：和第一個累積的法向同側
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0) n = n.map(x => -x);
    nx += n[0]; ny += n[1]; nz += n[2];
  }
  for (let i = 0; i < positions.length / 3; i++) { cx += positions[3 * i]; cy += positions[3 * i + 1]; cz += positions[3 * i + 2]; }
  const np = positions.length / 3 || 1;
  let n = [nx, ny, nz];
  const L = Math.hypot(...n) || 1; n = n.map(x => x / L);
  const k = n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs)));
  if (Math.abs(n[k]) > 0.999) n = [0, 0, 0].map((_, i) => (i === k ? Math.sign(n[k]) : 0));
  // 平面內兩軸：先選和法向最不平行的座標軸
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  // u = ref × n，v = n × u（讓「上」方向盡量是 ref）
  let u = [ref[1] * n[2] - ref[2] * n[1], ref[2] * n[0] - ref[0] * n[2], ref[0] * n[1] - ref[1] * n[0]];
  const Lu = Math.hypot(...u); u = u.map(x => x / Lu);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { normal: n, u, v, origin: [cx / np, cy / np, cz / np] };
}

// 把三角網格上的點資料（components 1 或 3）用重心座標光柵化到規則格點。格距 cell（場景單位）；
// 回傳 { plane, x0, y0, cell, nx, ny, values, mask }，沒有覆蓋到的格點 mask = 0
export function resampleSlice({ positions, indices }, values, components, { cell, maxCells = 400 * 400 } = {}) {
  const plane = slicePlane(positions, indices);
  const n = positions.length / 3;
  const pu = new Float64Array(n), pv = new Float64Array(n);
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = [positions[3 * i] - plane.origin[0], positions[3 * i + 1] - plane.origin[1], positions[3 * i + 2] - plane.origin[2]];
    pu[i] = d[0] * plane.u[0] + d[1] * plane.u[1] + d[2] * plane.u[2];
    pv[i] = d[0] * plane.v[0] + d[1] * plane.v[1] + d[2] * plane.v[2];
    umin = Math.min(umin, pu[i]); umax = Math.max(umax, pu[i]); vmin = Math.min(vmin, pv[i]); vmax = Math.max(vmax, pv[i]);
  }
  if (!cell) cell = Math.max(umax - umin, vmax - vmin) / 100;
  while (((umax - umin) / cell + 1) * ((vmax - vmin) / cell + 1) > maxCells) cell *= 1.25;
  const nx = Math.floor((umax - umin) / cell) + 1, ny = Math.floor((vmax - vmin) / cell) + 1;
  const out = new Float32Array(nx * ny * components).fill(NaN), mask = new Uint8Array(nx * ny);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const x0 = Math.min(pu[a], pu[b], pu[c]), x1 = Math.max(pu[a], pu[b], pu[c]);
    const y0 = Math.min(pv[a], pv[b], pv[c]), y1 = Math.max(pv[a], pv[b], pv[c]);
    const det = (pv[b] - pv[c]) * (pu[a] - pu[c]) + (pu[c] - pu[b]) * (pv[a] - pv[c]);
    if (Math.abs(det) < 1e-12) continue;
    for (let j = Math.max(0, Math.ceil((y0 - vmin) / cell)); j <= Math.min(ny - 1, Math.floor((y1 - vmin) / cell)); j++) {
      const y = vmin + j * cell;
      for (let i = Math.max(0, Math.ceil((x0 - umin) / cell)); i <= Math.min(nx - 1, Math.floor((x1 - umin) / cell)); i++) {
        const x = umin + i * cell;
        const l1 = ((pv[b] - pv[c]) * (x - pu[c]) + (pu[c] - pu[b]) * (y - pv[c])) / det;
        const l2 = ((pv[c] - pv[a]) * (x - pu[c]) + (pu[a] - pu[c]) * (y - pv[c])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const g = j * nx + i;
        if (mask[g]) continue; // 共用邊上的格點：先到先得（三角形順序固定，決定性）
        mask[g] = 1;
        for (let k = 0; k < components; k++) out[g * components + k] = l1 * values[a * components + k] + l2 * values[b * components + k] + l3 * values[c * components + k];
      }
    }
  }
  return { plane, x0: umin, y0: vmin, cell, nx, ny, components, values: out, mask };
}

const gridPoint = (g, x, y) => [0, 1, 2].map(k => g.plane.origin[k] + x * g.plane.u[k] + y * g.plane.v[k]);

// 格點上的雙線性內插（向量取平面內分量 [vu, vv] 與完整向量）。四個角有任何一個不在網格內就回傳 null
function sampleGrid(g, x, y) {
  const fx = (x - g.x0) / g.cell, fy = (y - g.y0) / g.cell;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return null;
  const s = fx - i, t = fy - j, C = g.components;
  const ids = [j * g.nx + i, j * g.nx + i + 1, (j + 1) * g.nx + i, (j + 1) * g.nx + i + 1];
  if (ids.some(k => !g.mask[k])) return null;
  const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t];
  const v = new Array(C).fill(0);
  for (let q = 0; q < 4; q++) for (let k = 0; k < C; k++) v[k] += w[q] * g.values[ids[q] * C + k];
  return v;
}

// 箭頭：每隔 stride 個格點一支，長度 = |U| × scale（場景單位／(m/s)）；scale 省略時讓最長的箭頭約等於 stride 格距。
// 回傳 { positions: Float32Array（LineSegments，每支 3 段：桿＋兩個箭頭翼），magnitudes: Float32Array（每個頂點），count }
export function arrowSegments(g, { stride = 4, scale, inPlane = true, head = 0.3 } = {}) {
  if (g.components !== 3) throw new Error('箭頭需要向量場');
  const pts = [], mags = [];
  let vmax = 0;
  for (let k = 0; k < g.nx * g.ny; k++) if (g.mask[k]) vmax = Math.max(vmax, Math.hypot(g.values[3 * k], g.values[3 * k + 1], g.values[3 * k + 2]));
  const sc = scale ?? (vmax > 0 ? (stride * g.cell * 0.9) / vmax : 1);
  const n = g.plane.normal;
  for (let j = Math.floor(stride / 2); j < g.ny; j += stride) {
    for (let i = Math.floor(stride / 2); i < g.nx; i += stride) {
      const k = j * g.nx + i;
      if (!g.mask[k]) continue;
      let U = [g.values[3 * k], g.values[3 * k + 1], g.values[3 * k + 2]];
      const mag = Math.hypot(...U);
      if (inPlane) { const d = U[0] * n[0] + U[1] * n[1] + U[2] * n[2]; U = U.map((x, q) => x - d * n[q]); }
      const L = Math.hypot(...U);
      if (L < 1e-9) continue;
      const p = gridPoint(g, g.x0 + i * g.cell, g.y0 + j * g.cell);
      const tip = p.map((x, q) => x + U[q] * sc);
      const dir = U.map(x => x / L), side = [dir[1] * n[2] - dir[2] * n[1], dir[2] * n[0] - dir[0] * n[2], dir[0] * n[1] - dir[1] * n[0]];
      const h = L * sc * head;
      const w1 = tip.map((x, q) => x - dir[q] * h + side[q] * h * 0.5), w2 = tip.map((x, q) => x - dir[q] * h - side[q] * h * 0.5);
      pts.push(...p, ...tip, ...tip, ...w1, ...tip, ...w2);
      for (let q = 0; q < 6; q++) mags.push(mag);
    }
  }
  return { positions: Float32Array.from(pts), magnitudes: Float32Array.from(mags), count: mags.length / 6, scale: sc };
}

// 切面內流線（平面內速度分量，RK2 中點法）。seeds 為平面座標 [x, y]；省略時沿上游邊（平面內平均流向的反方向那一側）等距放 count 個。
// 回傳 { positions: Float32Array（LineSegments 端點對）、magnitudes、lines（每條的頂點數）}
export function traceStreamlines(g, { seeds, count = 20, step, maxSteps = 2000 } = {}) {
  if (g.components !== 3) throw new Error('流線需要向量場');
  const h = step ?? g.cell * 0.5;
  const inplane = (x, y) => {
    const v = sampleGrid(g, x, y);
    if (!v) return null;
    return { du: v[0] * g.plane.u[0] + v[1] * g.plane.u[1] + v[2] * g.plane.u[2], dv: v[0] * g.plane.v[0] + v[1] * g.plane.v[1] + v[2] * g.plane.v[2], mag: Math.hypot(v[0], v[1], v[2]) };
  };
  if (!seeds) {
    // 平均流向
    let su = 0, sv = 0;
    for (let k = 0; k < g.nx * g.ny; k++) if (g.mask[k]) {
      const V = [g.values[3 * k], g.values[3 * k + 1], g.values[3 * k + 2]];
      su += V[0] * g.plane.u[0] + V[1] * g.plane.u[1] + V[2] * g.plane.u[2]; sv += V[0] * g.plane.v[0] + V[1] * g.plane.v[1] + V[2] * g.plane.v[2];
    }
    const W = g.x0 + (g.nx - 1) * g.cell, Ht = g.y0 + (g.ny - 1) * g.cell, e = g.cell * 1.01;
    seeds = [];
    for (let s = 0; s < count; s++) {
      const f = (s + 0.5) / count;
      if (Math.abs(su) >= Math.abs(sv)) seeds.push([su >= 0 ? g.x0 + e : W - e, g.y0 + f * (Ht - g.y0)]);
      else seeds.push([g.x0 + f * (W - g.x0), sv >= 0 ? g.y0 + e : Ht - e]);
    }
  }
  const pts = [], mags = [], lines = [];
  for (const [sx, sy] of seeds) {
    let x = sx, y = sy, nv = 0;
    let a = inplane(x, y);
    if (!a) { lines.push(0); continue; }
    let prev = gridPoint(g, x, y), prevMag = a.mag;
    for (let k = 0; k < maxSteps; k++) {
      const sp = Math.hypot(a.du, a.dv);
      if (sp < 1e-6) break;
      const mx = x + 0.5 * h * a.du / sp, my = y + 0.5 * h * a.dv / sp;
      const m = inplane(mx, my);
      if (!m) break;
      const sm = Math.hypot(m.du, m.dv);
      if (sm < 1e-6) break;
      x += h * m.du / sm; y += h * m.dv / sm;
      const b = inplane(x, y);
      if (!b) break;
      const p = gridPoint(g, x, y);
      pts.push(...prev, ...p); mags.push(prevMag, b.mag); nv++;
      prev = p; prevMag = b.mag; a = b;
    }
    lines.push(nv);
  }
  return { positions: Float32Array.from(pts), magnitudes: Float32Array.from(mags), lines };
}
