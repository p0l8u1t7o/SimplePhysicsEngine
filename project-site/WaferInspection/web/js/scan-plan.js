// 掃描規劃：依視野與重疊率在圓形晶圓上排出取像位置（蛇形順序），並計算覆蓋、排除區與 die 數。
// 覆蓋不是面積相除：逐點檢查有效圓（晶圓半徑 − 邊緣排除區）內的取樣點有沒有落在某個取像位置的視野內。
// 晶圓座標 (x, y)：mm，中心為原點，x 向右、y 向上（俯視，y 對應世界 −Z）。

// 矩形（中心 cx, cy、半寬 hw、半高 hh）和圓（半徑 R、圓心原點）有沒有交集
const rectHitsCircle = (cx, cy, hw, hh, R) => {
  const dx = Math.max(Math.abs(cx) - hw, 0), dy = Math.max(Math.abs(cy) - hh, 0);
  return dx * dx + dy * dy < R * R;
};
const rectInsideCircle = (cx, cy, hw, hh, R) => Math.hypot(Math.abs(cx) + hw, Math.abs(cy) + hh) <= R;

// p：resolveParams 的值；fov：[寬, 高] mm（budget.js 的 opticsOf）。缺值時回傳 { valid: false, reason }
export function scanPlan(p, fov) {
  if (!fov || !(fov[0] > 0) || !(fov[1] > 0)) return { valid: false, reason: '視野無法計算（缺相機或鏡頭參數）', positions: [] };
  const R = p.waferD / 2, Rv = R - p.edgeExcl, [fw, fh] = fov, sx = fw * (1 - p.overlap), sy = fh * (1 - p.overlap);
  if (!(Rv > 0)) return { valid: false, reason: '沒有可檢測區域', positions: [] };
  const nx = Math.max(1, Math.ceil((2 * Rv - fw) / sx) + 1), ny = Math.max(1, Math.ceil((2 * Rv - fh) / sy) + 1);
  if (nx * ny > 40000) return { valid: false, reason: `取像位置超過 40000（${nx}×${ny}），請放大視野或降低倍率`, positions: [] };
  const grid = new Map(), positions = [], rows = [];
  for (let j = 0; j < ny; j++) {
    const y = ((ny - 1) / 2 - j) * sy, cols = [];
    for (let i = 0; i < nx; i++) {
      const x = (i - (nx - 1) / 2) * sx;
      if (rectHitsCircle(x, y, fw / 2, fh / 2, Rv)) cols.push({ i, x });
    }
    if (!cols.length) continue;
    const row = rows.length, ordered = row % 2 ? cols.reverse() : cols;   // 蛇形：偶數列由左到右，奇數列由右到左
    const list = [];
    for (const c of ordered) {
      const k = positions.length, edge = !rectInsideCircle(c.x, y, fw / 2, fh / 2, Rv);
      const pos = { k, i: c.i, j, row, x: c.x, y, edge };
      positions.push(pos); grid.set(c.i + ',' + j, pos); list.push(k);
    }
    rows.push({ row, j, y, list });
  }
  const cellOf = (x, y) => [Math.round(x / sx + (nx - 1) / 2), Math.round((ny - 1) / 2 - y / sy)];
  // 點 (x, y) 被哪些位置的視野涵蓋（只看鄰近 3×3 格）；set 是要算的位置集合（null = 全部）
  function covers(x, y, set = null) {
    const [ci, cj] = cellOf(x, y);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const q = grid.get((ci + di) + ',' + (cj + dj));
      if (q && (!set || set.has(q.k)) && Math.abs(x - q.x) <= fw / 2 + 1e-9 && Math.abs(y - q.y) <= fh / 2 + 1e-9) return q;
    }
    return null;
  }
  return { valid: true, R, Rv, fov, step: [sx, sy], nx, ny, positions, rows, covers, cellOf };
}

// 有效圓內取樣點的覆蓋率：方格取樣（間距 g mm）＋邊界一圈。set = null 算全部位置
export function coverage(plan, set = null, g = 1) {
  if (!plan.valid) return { ratio: null, missed: [] };
  const { Rv } = plan, missed = []; let n = 0, hit = 0;
  const test = (x, y) => { n++; if (plan.covers(x, y, set)) hit++; else if (missed.length < 20) missed.push([x, y]); };
  for (let y = -Rv + g / 2; y < Rv; y += g) for (let x = -Rv + g / 2; x < Rv; x += g) if (x * x + y * y <= Rv * Rv) test(x, y);
  for (let a = 0; a < 720; a++) { const t = a / 720 * Math.PI * 2; test(Rv * Math.cos(t) * (1 - 1e-9), Rv * Math.sin(t) * (1 - 1e-9)); }
  return { ratio: hit / n, samples: n, missed };
}

// 視野落在有效圓外的面積（排除區與晶圓外，不算檢測面積）：每個位置 12×8 點取樣
export function wastedArea(plan) {
  if (!plan.valid) return null;
  const [fw, fh] = plan.fov; let out = 0;
  for (const q of plan.positions) {
    if (!q.edge) continue;
    let o = 0; for (let a = 0; a < 12; a++) for (let b = 0; b < 8; b++) { const x = q.x - fw / 2 + (a + .5) * fw / 12, y = q.y - fh / 2 + (b + .5) * fh / 8; if (x * x + y * y > plan.Rv * plan.Rv) o++; }
    out += o / 96 * fw * fh;
  }
  return out;
}

// die：以晶圓中心為 die 格線的交點；完整落在有效圓內的才算完整 die
export function dieCount(p) {
  const Rv = p.waferD / 2 - p.edgeExcl, W = p.dieW, H = p.dieH, n = Math.ceil(p.waferD / 2 / Math.min(W, H)) + 1;
  let full = 0, partial = 0;
  for (let a = -n; a < n; a++) for (let b = -n; b < n; b++) {
    const xs = [a * W, (a + 1) * W], ys = [b * H, (b + 1) * H];
    const inside = xs.every(x => ys.every(y => x * x + y * y <= Rv * Rv));
    const touch = rectHitsCircle((xs[0] + xs[1]) / 2, (ys[0] + ys[1]) / 2, W / 2, H / 2, Rv);
    if (inside) full++; else if (touch) partial++;
  }
  return { full, partial };
}

// 精簡展示模式：只掃中央 rows 列，其餘位置標「展示略過」（不得算成已取像）
export function compactList(plan, rows) {
  if (!plan.valid) return [];
  const mid = (plan.rows.length - 1) / 2, n = Math.min(rows, plan.rows.length);
  const first = Math.round(mid - (n - 1) / 2);
  return plan.rows.slice(first, first + n).flatMap(r => r.list);
}
