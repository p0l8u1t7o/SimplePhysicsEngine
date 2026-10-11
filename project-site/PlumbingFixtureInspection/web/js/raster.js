// 軟體光柵化（深度緩衝）：產品檔規劃的可視性計算用。Node 與瀏覽器共用、結果決定性（不靠 GPU）。
// 用法：r.clear() → r.tri(…) 畫所有三角形（含遮擋物）→ r.depthAt(x, y) 查某像素最近的深度。
// 可視判定用「三角形重心的深度 ≤ 該像素深度＋容差」，比數 ID 像素穩：小於一個像素的三角形也判得到。
export function createRaster(w, h) {
  const depth = new Float32Array(w * h);
  function clear() { depth.fill(Infinity); }
  // 螢幕座標（像素，原點左上）＋深度（越小越近）；兩種繞向都畫（不剔除背面，遮擋物要算進去）
  function tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    let y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) return;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const inv = 1 / area;
    for (let y = y0; y <= y1; y++) {
      const py = y + .5;
      for (let x = x0; x <= x1; x++) {
        const px = x + .5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * az + w1 * bz + w2 * cz, k = y * w + x;
        if (z < depth[k]) depth[k] = z;
      }
    }
  }
  // 像素深度：取 3×3 鄰域最遠者（重心落在輪廓邊緣時不被旁邊的背景誤判為遮擋）
  function depthAt(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return -Infinity;
    let d = depth[iy * w + ix];
    if (!Number.isFinite(d)) return Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = ix + dx, Y = iy + dy;
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const v = depth[Y * w + X];
      if (Number.isFinite(v) && v > d) d = v;
    }
    return d;
  }
  return { w, h, depth, clear, tri, depthAt };
}
