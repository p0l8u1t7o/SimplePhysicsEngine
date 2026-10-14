// 車輛路徑：圓角折線、三次貝茲；以弧長取樣位置與朝向（XZ 平面，朝向給 rotation.y：本地 +X 是車頭）。
// 倒車的腿段：車沿路徑往前移動，但車頭朝向相反。

export const yawOf = (dx, dz) => Math.atan2(-dz, dx);
export const smoothstep = u => u * u * (3 - 2 * u);
export const easeInOut = u => u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;

// 折線（[[x, z], …]）在轉折點以半徑 R 圓角，回傳密集取樣點
export function rounded(points, R = 4000, step = 150) {
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], [cx, cz] = points[i + 1];
    const l1 = Math.hypot(bx - ax, bz - az), l2 = Math.hypot(cx - bx, cz - bz);
    const u1 = [(bx - ax) / l1, (bz - az) / l1], u2 = [(cx - bx) / l2, (cz - bz) / l2];
    const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])), turn = Math.acos(cos);
    if (turn < 1e-3) { out.push(points[i]); continue; }
    const t = Math.min(R * Math.tan(turn / 2), l1 * .5, l2 * .5), r = t / Math.tan(turn / 2);
    const p1 = [bx - u1[0] * t, bz - u1[1] * t], p2 = [bx + u2[0] * t, bz + u2[1] * t];
    const cross = u1[0] * u2[1] - u1[1] * u2[0], n = [-u1[1] * Math.sign(cross), u1[0] * Math.sign(cross)];
    const c = [p1[0] + n[0] * r, p1[1] + n[1] * r], a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]), a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    out.push(p1);
    const k = Math.max(2, Math.ceil(Math.abs(da) * r / step));
    for (let j = 1; j < k; j++) { const a = a0 + da * j / k; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
    out.push(p2);
  }
  out.push(points.at(-1));
  return out;
}
export function bezier(p0, p1, p2, p3, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
  });
}
// 以弧長取樣：at(s) → { x, z, yaw }（reverse：倒車，車頭朝向與移動方向相反）
export function makePath(pts, { reverse = false } = {}) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum.at(-1);
  function at(s) {
    s = Math.max(0, Math.min(length, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1, u = (s - cum[lo]) / seg, a = pts[lo], b = pts[hi];
    // 朝向用前後各一小段的平均，轉角處較平順
    const i0 = Math.max(0, lo - 1), i1 = Math.min(pts.length - 1, hi + 1);
    const dx = pts[i1][0] - pts[i0][0], dz = pts[i1][1] - pts[i0][1];
    return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, yaw: yawOf(dx, dz) + (reverse ? Math.PI : 0) };
  }
  // 第一個 z（或 x）越過 v 的弧長
  function crossing(axis, v) {
    const k = axis === 'x' ? 0 : 1;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1][k] - v, b = pts[i][k] - v; if (a === 0) return cum[i - 1]; if (a * b < 0) return cum[i - 1] + (cum[i] - cum[i - 1]) * a / (a - b); }
    return null;
  }
  return { pts, length, at, crossing, reverse };
}
// 腿段排程：legs = [{ path, t0, t1, ease, s0?, s1? }]；回傳時刻 t 的 { x, z, yaw, moving, leg }（不在任何腿段時停在最近一段的端點）
export function legsAt(legs, t) {
  let last = null;
  for (const g of legs) {
    if (t < g.t0) break;
    last = g;
    if (t <= g.t1) {
      const u = g.t1 > g.t0 ? (t - g.t0) / (g.t1 - g.t0) : 1, e = (g.ease || easeInOut)(u);
      const s0 = g.s0 ?? 0, s1 = g.s1 ?? g.path.length;
      return { ...g.path.at(s0 + (s1 - s0) * e), moving: u > 0 && u < 1, leg: g };
    }
  }
  if (!last) { const g = legs[0]; return { ...g.path.at(g.s0 ?? 0), moving: false, leg: null, before: true }; }
  return { ...last.path.at(last.s1 ?? last.path.length), moving: false, leg: last };
}
