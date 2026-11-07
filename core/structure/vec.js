// 純數學的 3D 向量小工具（陣列 [x, y, z]），讓版面計算不依賴 three，可以直接在 Node 測試。
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a); return l > 0 ? mul(a, 1 / l) : [0, 0, 0]; };
export const dist = (a, b) => len(sub(a, b));
export const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
// 從水平面量起的角度（度）
export const elevationDeg = d => Math.asin(Math.max(-1, Math.min(1, norm(d)[1]))) * 180 / Math.PI;
export const round = (v, k = 1) => Math.round(v / k) * k;
export const round3 = p => p.map(v => Math.round(v * 10) / 10);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 最小平方直線 y = a + b·x
export function fitLine(xs, ys) {
  const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const d = n * sxx - sx * sx;
  const b = Math.abs(d) < 1e-12 ? 0 : (n * sxy - sx * sy) / d;
  return { a: (sy - b * sx) / n, b };
}
