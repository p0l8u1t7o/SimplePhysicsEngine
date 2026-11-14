// 檢測示意：示意圖樣、模擬影像（相機模擬）、演算法（候選區）、複檢清單。全部是 SIM，不是實拍影像辨識。
//
// 三類資料嚴格分開：
//   A. 模擬缺陷真值：spec.js 的 SCENARIOS（只有「相機模擬」renderTile 與事後評分 scoreAgainstTruth 讀得到）
//   B. 演算法候選區：detect() 只拿到影像陣列與取像幾何（不傳入缺陷清單），在影像上找差異，輸出候選
//   C. 人工註記／待確認：複檢完成後交給人工確認的位置（reviewNotes），以及參考照片上的人工標記（spec.js 的 PHOTO_NOTES）
//
// 模擬影像是 0.12 mm／像素的示意取樣（不是相機像素）：缺陷寬度依「示意放大」畫到看得見，明暗場的亮度是示意值，
// 晶圓薄膜干涉、細密圖案繞射與真實缺陷散射都沒有模擬，不能代表實機檢出能力（打光要 POC）。
// 決定性：雜訊用座標雜湊，不用 Math.random。

export const SIM_RES = 0.12;                 // 模擬影像每像素 mm（示意取樣）
export const DISPLAY_RES = 0.02;             // 影像面板顯示用，仍非相機原始解析度
const NOISE = 0.02, THR_K = 6, THR_MIN = 0.1, MIN_AREA = 3;
const SHARP_MIN = 0.7, BRIGHT_MIN = 0.6;     // 影像品質門檻：清晰度、亮度相對參考影像

// ---------------------------------------------------------------- 決定性雜湊與雜訊
function hash2(a, b, s = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const noise = (ix, iy, seed) => (hash2(ix, iy, seed) + hash2(iy + 7, ix + 3, seed + 11) - 1) * NOISE * 1.7;

import { pattern } from './wafer-pattern.js';
export { pattern };

// 全片碗形翹曲＋局部翹曲；只供相機模擬與對焦平面量測，不傳入 detect。
export function surfaceZ(x, y, p, defects = []) {
  const R = p.waferD / 2; let z = (p.flatness || 0) * (x * x + y * y) / (R * R);
  for (const d of defects) if (d.kind === 'warp') { const r = Math.hypot(x - d.at[0], y - d.at[1]); if (r < d.r) z += d.h * 0.5 * (1 + Math.cos(Math.PI * r / d.r)); }
  return z;
}
// 對焦點：中心＋一圈（0.6 Rv）；回傳點與最小平方平面 z = a + bx + cy
export function focusPoints(p) {
  const Rv = p.waferD / 2 - p.edgeExcl, n = Math.max(3, p.afPoints | 0), pts = [[0, 0]];
  for (let i = 0; i < n - 1; i++) { const t = Math.PI / 4 + i * 2 * Math.PI / (n - 1); pts.push([0.6 * Rv * Math.cos(t), 0.6 * Rv * Math.sin(t)]); }
  return pts;
}
export function fitPlane(pts, zs) {
  let n = pts.length, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  pts.forEach(([x, y], i) => { const z = zs[i]; sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; });
  // 正規方程 3×3（Cramer）
  const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], r = [sz, sxz, syz];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-12) return { a: sz / n, b: 0, c: 0 };
  const col = k => M.map((row, i) => row.map((v, j) => j === k ? r[i] : v));
  return { a: det(col(0)) / D, b: det(col(1)) / D, c: det(col(2)) / D };
}

// ---------------------------------------------------------------- 相機模擬（讀 A 真值）：一個取像位置的明場＋暗場影像
// opt：{ defects（A 真值）, seed, res, focusErr（mm）, dof（mm）, drop: ['BF'|'DF'] 遺失的影格, ref: true 另外產生參考影像 }
// 參考影像（黃金樣本）：同一圖樣、不含任何注入缺陷、失焦與照明變化，雜訊種子不同；它只用到圖樣，不讀真值。
// bf／df 是 Float32Array(H×W)；rgb 是三個平面 [R,G,B]（各 H×W），範圍 0～1。
// color:false 只省略 RGB 儲存，bf 仍由同一 RGB 圖樣的亮度計算，演算法路徑不變。
export function renderTile(cx, cy, fov, p, { defects = [], seed = 1, res = SIM_RES, focusErr = 0, dof = Infinity, drop = [], ref = false, color = true } = {}) {
  const [fw, fh] = fov, w = Math.max(8, Math.round(fw / res)), h = Math.max(8, Math.round(fh / res));
  const rx = fw / w, ry = fh / h, bf = new Float32Array(w * h), df = new Float32Array(w * h), pv = [0, 0, 0, 0, 0];
  const rgb = color ? Array.from({ length: 3 }, () => new Float32Array(w * h)) : null;
  const rbf = ref ? new Float32Array(w * h) : null, rdf = ref ? new Float32Array(w * h) : null;
  const x0 = cx - fw / 2, y0 = cy + fh / 2;
  // 只裁掉完全不進視野的注入物；每個位置仍產生影像並完整執行 detect。
  const lines = defects.filter(d => d.kind === 'line' && Math.max(d.a[0], d.b[0]) >= x0 - res * 3 && Math.min(d.a[0], d.b[0]) <= x0 + fw + res * 3 && Math.max(d.a[1], d.b[1]) >= y0 - fh - res * 3 && Math.min(d.a[1], d.b[1]) <= y0 + res * 3);
  const parts = defects.filter(d => d.kind === 'particle' && Math.abs(d.at[0] - cx) < fw / 2 + Math.max(d.r, res * 3) && Math.abs(d.at[1] - cy) < fh / 2 + Math.max(d.r, res * 3));
  const dims = defects.filter(d => d.kind === 'dim');
  const minW = 1.4 * Math.max(rx, ry);                                 // 示意放大：細線至少畫成 1.4 個模擬像素寬
  for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
    const x = x0 + (ix + .5) * rx, y = y0 - (iy + .5) * ry;
    pattern(x, y, p.dieW, p.dieH, pv);
    let b = pv[0], d = pv[1];
    if (ref) { rbf[iy * w + ix] = b; rdf[iy * w + ix] = d; }
    for (const L of lines) {
      const [ax, ay] = L.a, [bx, by] = L.b, vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
      const dist = Math.hypot(x - ax - t * vx, y - ay - t * vy), half = Math.max(L.width, minW) / 2;
      const bead = L.beads && Math.abs((t * L.beads) % 1 - .5) < .13;
      const radius = half * (bead ? 1.65 : 1);
      if (dist < radius) { const s = (1 - dist / radius * .45) * (bead ? 1 : .85); b *= 1 - (1 - L.bf) * s; d += L.df * s; }
    }
    for (const P of parts) {
      const dist = Math.hypot(x - P.at[0], y - P.at[1]), rr = Math.max(P.r, minW);
      if (dist < rr) { const s = 1 - dist / rr * .3; b *= 1 - (1 - P.bf) * s; d += P.df * s; }
    }
    for (const D of dims) {
      const r = Math.hypot(x - D.at[0], y - D.at[1]);
      if (r < D.r) {
        const weight = .5 * (1 + Math.cos(Math.PI * r / D.r));
        const band = D.banded ? .10 + .9 * Math.min(1, Math.max(0, (iy / h - .21) / .10)) * Math.min(1, Math.max(0, (1 - iy / h) / .15)) : 1;
        const gain = 1 - (1 - D.gain * band) * weight; b *= gain; d *= gain;
      }
    }
    bf[iy * w + ix] = b; df[iy * w + ix] = d;
    if (rgb) { const gain = b / pv[0]; for (let c = 0; c < 3; c++) rgb[c][iy * w + ix] = pv[c + 2] * gain; }
  }
  // 小幅點擴散：參考與拍攝影像同樣套用，不靠門檻掩蓋成像差異。
  for (const a of [bf, df, rbf, rdf, ...(rgb || [])]) if (a) soften(a, w, h);
  // 失焦：超出半個景深就依超出量做盒式模糊（示意）
  const over = Math.abs(focusErr) - dof / 2;
  if (over > 0) { const r = Math.min(12, Math.max(1, Math.round(SIM_RES / res * (1 + over / Math.max(dof / 2, 1e-3) * 2)))); for (const a of [bf, df, ...(rgb || [])]) blur(a, w, h, r); }
  const gx = Math.round(x0 / rx), gy = Math.round(y0 / ry);
  for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
    const k = iy * w + ix;
    const n = noise(gx + ix, gy - iy, seed);
    bf[k] = Math.min(1, Math.max(0, bf[k] + n));
    if (rgb) for (let c = 0; c < 3; c++) rgb[c][k] = Math.min(1, Math.max(0, rgb[c][k] + n));
    df[k] = Math.min(1, Math.max(0, df[k] + noise(gx + ix, gy - iy, seed + 101)));
    if (ref) { rbf[k] = Math.min(1, Math.max(0, rbf[k] + noise(gx + ix, gy - iy, seed + 5003))); rdf[k] = Math.min(1, Math.max(0, rdf[k] + noise(gx + ix, gy - iy, seed + 5104))); }
  }
  const out = { w, h, rx, ry, x0, y0, rgb: drop.includes('BF') ? null : rgb, bf: drop.includes('BF') ? null : bf, df: drop.includes('DF') ? null : df };
  if (ref) out.ref = { w, h, rx, ry, x0, y0, bf: rbf, df: rdf };
  return out;
}
function soften(a, w, h) {
  const src = a.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x; a[k] = src[k] * .84 + .04 * (src[k - 1] + src[k + 1] + src[k - w] + src[k + w]);
  }
}
function blur(a, w, h, r) {
  const t = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; n++; } } t[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += t[yy * w + x]; n++; } } a[y * w + x] = s / n; }
}

// ---------------------------------------------------------------- 演算法（B）：只看影像，不讀真值
// img、ref：renderTile 的結果（ref 是黃金樣本：同一圖樣、沒有注入缺陷、不同雜訊）。步驟：
//   1. 缺圖檢查：任一通道沒有影像 → 缺圖，待複檢
//   2. 影像品質：清晰度（梯度能量）與亮度相對參考影像低於門檻 → 失焦／照明不足，待複檢（不判良品，也不找缺陷）
//   3. 差異比對：|影像 − 參考|，用中位數絕對偏差估雜訊，門檻 max(6σ, 0.1)
//   4. 連通區域（4 鄰），面積 ≥ 3 像素 → 候選區（晶圓座標的外框）
export function detect(img, ref) {
  if (!img.bf || !img.df) return { status: 'missing', reasons: [`缺圖（${!img.bf ? '明場' : ''}${!img.bf && !img.df ? '、' : ''}${!img.df ? '暗場' : ''}影像未收到）`], blobs: [] };
  const { w, h } = img, BX = 8, BY = 6, bw = w / BX, bh = h / BY, gain = new Float32Array(BX * BY);
  // 分區品質：整張與每一區的清晰度、亮度相對參考影像（局部失焦或局部偏暗都要抓到）
  const sharp = gradEnergy(img.bf, w, h, 0, 0, w, h) / Math.max(1e-9, gradEnergy(ref.bf, w, h, 0, 0, w, h));
  let bright = Infinity, sharpMin = Infinity;
  for (let j = 0; j < BY; j++) for (let i = 0; i < BX; i++) {
    const x0 = Math.round(i * bw), x1 = Math.round((i + 1) * bw), y0 = Math.round(j * bh), y1 = Math.round((j + 1) * bh);
    const mi = meanBox(img.bf, w, x0, y0, x1, y1), mr = meanBox(ref.bf, w, x0, y0, x1, y1);
    gain[j * BX + i] = mr / Math.max(1e-6, mi); bright = Math.min(bright, mi / Math.max(1e-6, mr));
    sharpMin = Math.min(sharpMin, gradEnergy(img.bf, w, h, x0, y0, x1, y1) / Math.max(1e-9, gradEnergy(ref.bf, w, h, x0, y0, x1, y1)));
  }
  const reasons = [];
  if (sharp < SHARP_MIN || sharpMin < SHARP_MIN * 0.75) reasons.push(`失焦：清晰度 ${(sharp * 100).toFixed(0)}%（最低區 ${(sharpMin * 100).toFixed(0)}%）`);
  if (bright < BRIGHT_MIN) reasons.push(`照明不足：最暗區亮度 ${(bright * 100).toFixed(0)}%（門檻 ${BRIGHT_MIN * 100}%）`);
  if (reasons.length) return { status: 'recheck', reasons, blobs: [], sharp, bright };
  // 明暗補正（shading correction）：每區乘上和參考影像的亮度比，再做差異比對
  const blobs = [];
  for (const ch of ['bf', 'df']) {
    const a = img[ch], r = ref[ch], n = a.length, diff = new Float32Array(n);
    for (let k = 0; k < n; k++) { const x = k % w, y = (k - x) / w, g = gain[Math.min(BY - 1, Math.floor(y / bh)) * BX + Math.min(BX - 1, Math.floor(x / bw))]; diff[k] = Math.abs(a[k] * g - r[k]); }
    const thr = Math.max(THR_K * 1.4826 * median(diff), THR_MIN);
    for (const c of components(diff, w, h, thr)) if (c.n >= MIN_AREA) {
      blobs.push({ ch: ch === 'bf' ? 'BF' : 'DF', area: c.n, peak: c.peak,
        box: [img.x0 + c.x0 * img.rx, img.y0 - (c.y1 + 1) * img.ry, img.x0 + (c.x1 + 1) * img.rx, img.y0 - c.y0 * img.ry] });   // [xmin, ymin, xmax, ymax]
    }
  }
  return { status: blobs.length ? 'candidate' : 'ok', reasons: [], blobs, sharp, bright };
}
const meanBox = (a, w, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += a[y * w + x]; n++; } return s / Math.max(1, n); };
const mean = a => { let s = 0; for (const v of a) s += v; return s / a.length; };
function gradEnergy(a, w, h, x0 = 0, y0 = 0, x1 = w, y1 = h) { let s = 0, n = 0; for (let y = y0; y < Math.min(y1, h - 1); y++) for (let x = x0; x < Math.min(x1, w - 1); x++) { const k = y * w + x; s += Math.abs(a[k + 1] - a[k]) + Math.abs(a[k + w] - a[k]); n++; } return s / Math.max(1, n); }
function median(a) { const H = new Uint32Array(512); for (const v of a) H[Math.min(511, Math.floor(v * 1024))]++; let c = 0; for (let i = 0; i < 512; i++) { c += H[i]; if (c >= a.length / 2) return (i + .5) / 1024; } return .5; }
function components(diff, w, h, thr) {
  const seen = new Uint8Array(w * h), out = [], stack = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || diff[s] < thr) continue;
    const c = { n: 0, x0: w, y0: h, x1: 0, y1: 0, peak: 0 }; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k - x) / w;
      c.n++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y); c.peak = Math.max(c.peak, diff[k]);
      for (const q of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) if (q >= 0 && !seen[q] && diff[q] >= thr) { seen[q] = 1; stack.push(q); }
    }
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- 整片模擬：每個取像位置的影像 → 演算法結果
// 回傳 per[k]：{ status, reasons, blobs, focusErr }（只含演算法輸出與量測得到的對焦誤差）。
// scenario 的缺陷只傳給相機模擬（renderTile）與 surfaceZ（物理上的晶圓表面），不傳給 detect。
export function inspectAll(plan, p, scenario, dof) {
  if (!plan.valid) return { per: [], plane: null, afPts: [] };
  const defects = scenario.defects, afPts = focusPoints(p), plane = fitPlane(afPts, afPts.map(([x, y]) => surfaceZ(x, y, p, defects)));
  const drops = defects.filter(d => d.kind === 'drop');
  const per = plan.positions.map(q => {
    const focusErr = surfaceZ(q.x, q.y, p, defects) - (plane.a + plane.b * q.x + plane.c * q.y);
    const drop = drops.filter(d => Math.abs(d.at[0] - q.x) <= plan.fov[0] / 2 && Math.abs(d.at[1] - q.y) <= plan.fov[1] / 2).flatMap(d => d.ch);
    const img = renderTile(q.x, q.y, plan.fov, p, { defects, seed: 1 + q.k * 3, focusErr, dof, drop, ref: true, color: false });
    const { ref, ...shot } = img;
    return { ...detect(shot, ref), focusErr };
  });
  return { per, plane, afPts };
}

// 候選區合併（B）：依取像順序，外框（外擴 1.2 mm，接起斷續暗點）相交的併成同一個候選；list 是這次實際取像的位置（精簡模式只有一部分）
export function mergeCandidates(per, list) {
  const out = [], grow = 1.2, hit = (a, b) => a[0] - grow <= b[2] && b[0] - grow <= a[2] && a[1] - grow <= b[3] && b[1] - grow <= a[3];
  for (const k of list) for (const b of per[k]?.blobs || []) {
    let c = out.find(c => c.parts.some(x => hit(x.box, b.box)));
    if (!c) { c = { id: 'B' + (out.length + 1), parts: [], channels: new Set() }; out.push(c); }
    c.parts.push({ k, box: b.box, ch: b.ch, area: b.area }); c.channels.add(b.ch);
  }
  for (const c of out) {
    c.box = c.parts.reduce((a, x) => [Math.min(a[0], x.box[0]), Math.min(a[1], x.box[1]), Math.max(a[2], x.box[2]), Math.max(a[3], x.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    c.channels = [...c.channels].sort(); c.k = c.parts[0].k;
    const big = c.parts.reduce((a, x) => x.area > a.area ? x : a, c.parts[0]);
    c.at = [(big.box[0] + big.box[2]) / 2, (big.box[1] + big.box[3]) / 2];
    const len = Math.hypot(c.box[2] - c.box[0], c.box[3] - c.box[1]);
    c.shape = len > 2 ? '線狀候選' : '點狀候選';
  }
  return out;
}

// 複檢清單：演算法候選（B）＋影像品質不足或缺圖的位置；從 start 開始用最近鄰排序（減少移動）
export function reviewList(plan, per, list, candidates, start = [0, 0]) {
  const items = candidates.map(c => ({ type: 'candidate', ref: c.id, at: c.at, k: c.k, note: `${c.shape}（${c.channels.join('／')}）` }));
  for (const k of list) if (per[k] && (per[k].status === 'recheck' || per[k].status === 'missing')) {
    const q = plan.positions[k]; items.push({ type: per[k].status, ref: 'P' + (k + 1), at: [q.x, q.y], k, note: per[k].reasons.join('；') });
  }
  const out = []; let cur = start; const left = [...items];
  while (left.length) {
    let best = 0, bd = Infinity;
    left.forEach((it, i) => { const d = Math.hypot(it.at[0] - cur[0], it.at[1] - cur[1]); if (d < bd - 1e-9) { bd = d; best = i; } });
    const it = left.splice(best, 1)[0]; out.push({ ...it, n: out.length + 1 }); cur = it.at;
  }
  return out;
}

// 事後評分（SIM 驗證用，不是檢測流程的一部分）：A 真值對 B 候選。只在這裡同時讀兩者
export function scoreAgainstTruth(scenario, candidates, per, list, plan) {
  const near = (c, d) => {
    const pad = 0.5, [x0, y0, x1, y1] = [c.box[0] - pad, c.box[1] - pad, c.box[2] + pad, c.box[3] + pad];
    const pts = d.kind === 'line' ? Array.from({ length: 21 }, (_, i) => [d.a[0] + (d.b[0] - d.a[0]) * i / 20, d.a[1] + (d.b[1] - d.a[1]) * i / 20]) : [d.at];
    return pts.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  };
  const scanned = new Set(list), imaged = d => {
    const pts = d.kind === 'line' ? [d.a, d.b] : [d.at];
    return pts.some(([x, y]) => [...scanned].some(k => { const q = plan.positions[k]; return Math.abs(x - q.x) <= plan.fov[0] / 2 && Math.abs(y - q.y) <= plan.fov[1] / 2; }));
  };
  const rows = [];
  for (const d of scenario.defects) {
    if (d.kind === 'line' || d.kind === 'particle') {
      const hits = candidates.filter(c => near(c, d)).map(c => c.id);
      rows.push({ id: d.id, kind: d.kind === 'line' ? '線狀' : '顆粒', imaged: imaged(d), found: hits, result: !imaged(d) ? '未取像（不評）' : hits.length ? '有候選' : 'SIM 漏檢' });
    } else {
      const affected = list.filter(k => per[k] && per[k].status !== 'ok' && per[k].status !== 'candidate' && Math.hypot(plan.positions[k].x - d.at[0], plan.positions[k].y - d.at[1]) < (d.r || 10) + Math.hypot(...plan.fov) / 2);
      rows.push({ id: d.id, kind: d.kind === 'warp' ? '局部翹曲' : d.kind === 'dim' ? '照明不足' : '缺圖', imaged: imaged(d), found: affected.map(k => 'P' + (k + 1)), result: !imaged(d) ? '未取像（不評）' : affected.length ? `${affected.length} 個位置判待複檢` : '未觸發待複檢' });
    }
  }
  const matched = new Set(rows.flatMap(r => r.kind === '線狀' || r.kind === '顆粒' ? r.found : []));
  const extra = candidates.filter(c => !matched.has(c.id)).map(c => c.id);
  return { rows, extra };
}
