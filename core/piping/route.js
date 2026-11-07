// 配管路徑：折線（3D 點，mm）→ 直管段＋彎（每個轉角以半徑 R 的圓弧倒角）。純計算，不依賴 three。
//
// 每個轉角：入射方向 a、出射方向 b、轉角 θ = acos(a·b)；切線長 T = R·tan(θ/2)，弧長 = R·θ。
//   彎的起點 = 轉角點 − a·T，終點 = 轉角點 + b·T，圓心 = 起點 + u·R（u 為平面內垂直 a、朝 b 的單位向量）。
//   90° 彎：T = R，L 形兩邊 L1、L2 的展開長度 = L1 + L2 − 2R + πR/2。
// 相鄰兩彎的切線長加起來超過中間那段時，兩彎等比例縮小（R 變小、記在 bend.fit = false），由檢查列報出。
//
// 種類：
//   pipe    鋼管＋對焊彎頭（bendType 'elbow-lr'｜'elbow-sr'）或冷彎（'pipe-bend'）；彎頭依角度分 90°／45°／非標準（切角）
//   conduit 導線管：整段連續、現場彎管；兩拉線點之間彎曲合計 ≤ 360°（NEC 358.26 類規定，示意）
//   tray    電纜槽：彎通依水平／垂直上／垂直下分類
import { size, minBendRadius } from './sizes.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r1 = v => Math.round(v * 10) / 10, r3 = p => p.map(r1);
const DEG = 180 / Math.PI;

export function routePipe(points, opt = {}) {
  const S = opt.size != null ? size(opt.size) : null;
  const kind = opt.kind ?? S?.kind ?? 'pipe';
  const bendType = opt.bendType ?? (kind === 'pipe' ? 'elbow-lr' : kind === 'conduit' ? 'conduit' : kind === 'tray' ? 'tray' : undefined);
  const minR = opt.minR ?? (S ? minBendRadius(S, S.kind === 'cable' ? undefined : bendType) : 0);
  const R = Math.max(opt.R ?? minR, 0), stock = opt.stock ?? 6000;
  // 去掉重複點
  const P = [];
  for (const p of points) if (!P.length || len(sub(p, P.at(-1))) > 1e-6) P.push(p);
  if (P.length < 2) throw new Error('路徑至少要兩個不同的點');
  const segs = P.slice(1).map((b, i) => { const d = sub(b, P[i]), L = len(d); return { a: P[i], b, L, dir: mul(d, 1 / L) }; });

  // 轉角與希望的切線長
  const bends = [];
  const want = new Array(P.length).fill(0), theta = new Array(P.length).fill(0);
  for (let i = 1; i < P.length - 1; i++) {
    const c = Math.max(-1, Math.min(1, dot(segs[i - 1].dir, segs[i].dir))), th = Math.acos(c);
    if (th > Math.PI - 1e-6) throw new Error(`第 ${i} 點折返 180°，無法倒角`);
    theta[i] = th; want[i] = th < 1e-6 ? 0 : R * Math.tan(th / 2);
  }
  // 空間不夠時等比例縮小
  const scale = new Array(P.length).fill(1);
  segs.forEach((s, j) => { const need = want[j] + want[j + 1]; if (need > s.L) { const k = s.L / need; scale[j] = Math.min(scale[j], k); scale[j + 1] = Math.min(scale[j + 1], k); } });
  const T = want.map((t, i) => t * scale[i]);
  for (let i = 1; i < P.length - 1; i++) {
    if (theta[i] < 1e-6) continue;
    const a = segs[i - 1].dir, b = segs[i].dir, th = theta[i], Ri = T[i] / Math.tan(th / 2);
    const start = add(P[i], mul(a, -T[i])), end = add(P[i], mul(b, T[i]));
    const u = norm(sub(b, mul(a, dot(a, b)))), center = add(start, mul(u, Ri)), n = norm(cross(a, b));
    const plane = Math.abs(n[1]) > .999 ? 'horizontal' : Math.abs(n[1]) < .001 ? (b[1] > a[1] ? 'vertical-up' : 'vertical-down') : 'rolled';
    bends.push({ at: i, angle: th * DEG, R: Ri, Rwant: R, fit: scale[i] >= 1 - 1e-9, T: T[i], arc: Ri * th, start, end, center, normal: n, a, b, plane });
  }
  // 直管段（彎與彎之間）
  const bendAt = new Map(bends.map(b => [b.at, b]));
  const straights = segs.map((s, j) => {
    const from = bendAt.get(j)?.end ?? s.a, to = bendAt.get(j + 1)?.start ?? s.b, L = len(sub(to, from));
    const dy = s.b[1] - s.a[1], hz = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]);
    return { seg: j, from, to, length: L, dir: s.dir, slope: hz < 1e-9 ? (dy > 0 ? Infinity : -Infinity) : dy / hz, vertical: hz < 1e-9 };
  });
  const developed = straights.reduce((t, s) => t + s.length, 0) + bends.reduce((t, b) => t + b.arc, 0);

  // 切長與配件
  const fittings = {}, inc = (k, n = 1) => { fittings[k] = (fittings[k] ?? 0) + n; };
  const cuts = [];
  const isElbow = kind === 'pipe' && bendType !== 'pipe-bend';
  if (isElbow || kind === 'tray') {
    // 直管各自切料（彎頭／彎通是配件）；超過庫存長度的用整支＋餘料，接頭數 = 支數 − 1
    for (const s of straights) {
      const full = Math.floor(s.length / stock + 1e-9), rest = s.length - full * stock;
      for (let k = 0; k < full; k++) cuts.push({ seg: s.seg, length: stock });
      if (rest > .5) cuts.push({ seg: s.seg, length: r1(rest) });
      const n = full + (rest > .5 ? 1 : 0); if (n > 1) inc(kind === 'tray' ? 'splicePlate' : 'coupling', n - 1);
    }
    const tol = opt.angleTol ?? 1;
    for (const b of bends) {
      if (kind === 'tray') inc(`tray-${b.plane}-${Math.round(b.angle)}`);
      else if (Math.abs(b.angle - 90) <= tol) inc('elbow90');
      else if (Math.abs(b.angle - 45) <= tol) inc('elbow45');
      else { inc('elbowCut'); b.nonStandard = true; }
    }
  } else {
    // 連續彎管：整段展開長度依庫存長度分支，彎在管上成形
    const full = Math.floor(developed / stock + 1e-9), rest = developed - full * stock;
    for (let k = 0; k < full; k++) cuts.push({ seg: null, length: stock });
    if (rest > .5) cuts.push({ seg: null, length: r1(rest) });
    if (cuts.length > 1) inc('coupling', cuts.length - 1);
    for (const b of bends) inc(`bend${Math.round(b.angle)}`);
  }
  const cutList = [...cuts.reduce((m, c) => m.set(c.length, (m.get(c.length) ?? 0) + 1), new Map())].map(([length, count]) => ({ length, count })).sort((a, b) => b.length - a.length);

  // 坡度：flow 'down' 時沿點的順序只能往下（垂直段允許）；minSlope 只套非垂直段
  const slopes = straights.map(s => {
    const abs = Math.abs(s.slope), ok = s.vertical || ((opt.minSlope == null || abs >= opt.minSlope - 1e-12) && (opt.maxSlope == null || abs <= opt.maxSlope + 1e-12));
    const dirOk = opt.flow === 'down' ? s.slope <= 1e-12 : opt.flow === 'up' ? s.slope >= -1e-12 : true;
    return { seg: s.seg, slope: s.slope, vertical: s.vertical, ok: ok && dirOk };
  });
  return {
    kind, size: S?.id ?? null, od: opt.od ?? S?.od ?? 0, bendType, R, minR, stock, points: P,
    segments: segs.map(s => ({ a: s.a, b: s.b, length: r1(s.L) })),
    bends,   // 幾何欄位不進位（建模用）；報表自行進位
    straights, developed, totalBend: Math.round(bends.reduce((t, b) => t + b.angle, 0) * 100) / 100,
    cuts, cutList, fittings, slopes,
  };
}

// 沿實際路徑（直管＋圓弧）取樣：step 為直管上的間距 mm，arcStep 為弧上每段的最大角度（度）
export function pathPoints(route, { step = 250, arcStep = 7.5 } = {}) {
  const out = [], push = p => { if (!out.length || len(sub(p, out.at(-1))) > 1e-6) out.push(p); };
  const bendAt = new Map(route.bends.map(b => [b.at, b]));
  route.straights.forEach((s, j) => {
    const n = Math.max(1, Math.ceil(s.length / step));
    for (let k = 0; k <= n; k++) push(add(s.from, mul(sub(s.to, s.from), k / n)));
    const b = bendAt.get(j + 1);
    if (b) for (const p of arcPoints(b, arcStep)) push(p);
  });
  return out;
}
// 一個彎的圓弧點（含起終點）
export function arcPoints(b, arcStep = 7.5) {
  const th = b.angle / DEG, n = Math.max(2, Math.ceil(b.angle / arcStep)), x = norm(sub(b.start, b.center)), y = b.a, out = [];
  for (let k = 0; k <= n; k++) { const t = th * k / n; out.push(add(b.center, add(mul(x, b.R * Math.cos(t)), mul(y, b.R * Math.sin(t))))); }
  return out;
}

// 路徑對地形的淨空：管底（中心 − od/2）減地面；負值＝埋在地下，cover＝地面 − 管頂
export function groundClearance(route, height, { step = 250, od = route.od } = {}) {
  let min = Infinity, at = null, maxCoverNeg = Infinity;
  for (const p of pathPoints(route, { step })) {
    const g = height(p[0], p[2]), c = p[1] - od / 2 - g;
    if (c < min) { min = c; at = p; }
    maxCoverNeg = Math.min(maxCoverNeg, g - (p[1] + od / 2));
  }
  return { min: r1(min), at: at && r3(at), buried: min < 0, minCover: r1(maxCoverNeg) };
}

// 管網水力用：路徑換成 1D 管段資料（長度 m、彎頭 K 清單）
export function routeToLink(route, { D, eps, kBendFn = null } = {}) {
  const S = route.size ? size(route.size) : null, Dm = D ?? (S?.ID ? S.ID / 1000 : null);
  return {
    L: route.developed / 1000, D: Dm, eps: eps ?? (S?.roughness != null ? S.roughness / 1000 : 4.5e-5),
    bends: route.bends.map(b => ({ angle: b.angle, rOverD: Dm ? b.R / 1000 / Dm : null, K: kBendFn ? kBendFn(b) : undefined })),
  };
}
