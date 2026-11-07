// 單軸追日支架（水平單軸，軸沿 +X）：純計算，回傳構件清單、模組位置、可動件的轉軸與 BOM。
//
// 座標：mm，Y 朝上；第 r 列的轉軸在 z = origin[1] − r·pitch，從 x = origin[0] 開始沿 +X。
// 轉角 φ（度）：繞 +X 右手定則，φ > 0 時模組法向往 +Z 傾（+Z 側的模組邊往下）。
// 軸的高度有兩種：
//   follow: 'line'    每列一直線（坡度＝地面擬合，限制在 ±maxRowSlope），高度取「最大轉角時模組下緣離地 ≥ clearance」的最小值；
//   follow: 'terrain' 跟著地形（每支樁外露相同），樁之間是直線段，在軸承處轉折；回報每跨坡度與轉折角給檢查用。
// 模組下緣在轉軸上方 pivot（預設＝扭力管半高＋模組檁條高）。最低點（轉 maxAngle 時）＝軸高 + pivot·cosφ − S/2·sinφ，
// 水平位置＝軸 ± (pivot·sinφ + S/2·cosφ)，在那裡取地面高度。
import { add, sub, mul, cross, norm, clamp, fitLine, round3 } from './vec.js';
import { profile, sectionSize } from './profiles.js';
import { member, bom } from './members.js';

export const TRACKER_DEFAULTS = Object.freeze({
  module: { L: 2278, W: 1134, T: 35, kg: 28, wp: 580 },
  orientation: 'portrait',   // 1P 直放：長邊垂直於轉軸
  up: 1,                     // 垂直轉軸方向幾片（1P／2P）
  across: 60,                // 沿轉軸幾片
  gap: 20,
  rows: 3, pitch: 5500,      // 軸距（水平）mm
  origin: [0, 0],
  pileSpacing: 7000,         // 樁距上限 mm
  overhang: 1500,            // 軸端到第一支樁 mm
  maxAngle: 60,              // 最大轉角（度）
  clearance: 500,            // 最大轉角時模組下緣最小離地 mm
  pivot: null,               // 轉軸到模組下緣 mm（預設＝扭力管半高＋檁條高）
  bearingDrop: 120,          // 轉軸到樁頂 mm（軸承座高度，示意）
  follow: 'line',            // 'line'｜'terrain'
  maxRowSlope: 0.1,          // 'line' 的列坡度上限
  railsPerModule: 2,
  railExt: 30,
  pile: { embed: 1800, length: null, minEmbed: 1500, maxReveal: 3000 },
  profiles: { pile: 'H150x150x7x10', tube: 'SHS125x125x4.5', rail: 'C75x45x15x2.3' },
  height: () => 0,
});

const DEG = Math.PI / 180;

export function layoutTracker(params = {}) {
  const P = { ...TRACKER_DEFAULTS, ...params, module: { ...TRACKER_DEFAULTS.module, ...params.module }, pile: { ...TRACKER_DEFAULTS.pile, ...params.pile }, profiles: { ...TRACKER_DEFAULTS.profiles, ...params.profiles } };
  const H = P.height, M = P.module, portrait = P.orientation === 'portrait';
  const Ls = portrait ? M.L : M.W, Wr = portrait ? M.W : M.L;
  const S = P.up * Ls + (P.up - 1) * P.gap, Lt = P.across * Wr + (P.across - 1) * P.gap;
  const tubeH = sectionSize(profile(P.profiles.tube))[1], railH = sectionSize(profile(P.profiles.rail))[1];
  const e = P.pivot ?? tubeH / 2 + railH, phi = P.maxAngle * DEG;
  const drop = e * Math.cos(phi) - S / 2 * Math.sin(phi), side = e * Math.sin(phi) + S / 2 * Math.cos(phi);   // 最大轉角時下緣相對轉軸
  const ov = Math.min(P.overhang, Lt / 4);
  const nf = Math.max(2, Math.ceil((Lt - 2 * ov) / P.pileSpacing - 1e-9) + 1), sp = (Lt - 2 * ov) / (nf - 1);
  const members = [], modules = [], rows = [];
  // 某個 x 的最大轉角時兩側下緣，要求的最低軸高
  const needAxis = (x, z) => Math.max(H(x, z - side), H(x, z + side)) + P.clearance - drop;

  for (let r = 0; r < P.rows; r++) {
    const x0 = P.origin[0], z = P.origin[1] - r * P.pitch, rid = `R${r + 1}`;
    const px = Array.from({ length: nf }, (_, k) => x0 + ov + k * sp);
    // 淨空取樣：兩端、每支樁、每片模組的兩側邊（樁之間地面隆起也要顧到）
    const samples = [...new Set([x0, ...px, ...Array.from({ length: P.across }, (_, i) => [x0 + i * (Wr + P.gap), x0 + i * (Wr + P.gap) + Wr]).flat(), x0 + Lt])].sort((a, b) => a - b);
    let axisY;                                  // 樁 k 處的軸高
    let gx = 0;
    if (P.follow === 'terrain') {
      // 每支樁外露相同：軸高 = 樁位地面 + 常數；常數取所有樁位（含兩端外推）都滿足淨空的最小值
      const ground = px.map(x => H(x, z));
      let k0 = -Infinity;
      for (let k = 0; k < nf; k++) k0 = Math.max(k0, needAxis(px[k], z) - ground[k]);
      // 樁之間是直線：在所有取樣點補足不夠的部分（軸高對 k0 是線性的，一次補齊）
      const lin = (x, k) => { const t = (x - px[k]) / (px[k + 1] - px[k]); return ground[k] + (ground[k + 1] - ground[k]) * t + k0; };
      const segOf = x => { let k = 0; while (k < nf - 2 && x > px[k + 1]) k++; return k; };
      let short = 0;
      for (const x of samples) short = Math.max(short, needAxis(x, z) - lin(x, segOf(x)));
      axisY = ground.map(g => g + k0 + short);
    } else {
      const fit = fitLine(samples, samples.map(x => H(x, z)));
      gx = clamp(fit.b, -P.maxRowSlope, P.maxRowSlope);
      let c = -Infinity;
      for (const x of samples) c = Math.max(c, needAxis(x, z) - gx * (x - x0));
      axisY = px.map(x => c + gx * (x - x0));
    }
    // 軸線：樁之間直線，兩端外推
    const seg = x => { let k = 0; while (k < nf - 2 && x > px[k + 1]) k++; return k; };
    const axisAt = x => { const k = seg(x), t = (x - px[k]) / (px[k + 1] - px[k]); return [x, axisY[k] + (axisY[k + 1] - axisY[k]) * t, z]; };
    const segDir = k => norm([px[k + 1] - px[k], axisY[k + 1] - axisY[k], 0]);
    const slopes = px.slice(1).map((x, k) => (axisY[k + 1] - axisY[k]) / (x - px[k]));
    const kinks = slopes.slice(1).map((s, k) => Math.abs(Math.atan(s) - Math.atan(slopes[k])) / DEG);

    // 樁（固定）
    px.forEach((x, k) => {
      const top = [x, axisY[k] - P.bearingDrop, z], g = H(x, z), reveal = top[1] - g;
      const embed = P.pile.length != null ? P.pile.length - reveal : P.pile.embed;
      members.push(member('pile', P.profiles.pile, [x, g - embed, z], top, [0, 0, 1], { id: `${rid}-K${k + 1}-pile`, row: r, frame: k,
        ground: Math.round(g * 10) / 10, top: Math.round(top[1] * 10) / 10, reveal: Math.round(reveal * 10) / 10, embed: Math.round(embed * 10) / 10 }));
    });
    // 扭力管：在中間的樁（軸承）處分段；第一段與最後一段包含軸端外伸
    const bounds = [x0, ...px.slice(1, -1), x0 + Lt];
    for (let k = 0; k < bounds.length - 1; k++) {
      const a = axisAt(bounds[k]), b = axisAt(bounds[k + 1]), d = segDir(Math.min(k, nf - 2));
      // 端段用所在跨的方向外推（axisAt 已經是直線外推）
      members.push(member('tube', P.profiles.tube, a, b, [0, 1, 0], { id: `${rid}-T${k + 1}`, row: r, pivot: { p: round3(a), d } }));
    }
    // 模組與檁條（可動；轉軸＝所在跨的軸線）
    for (let i = 0; i < P.across; i++) {
      const xc = x0 + i * (Wr + P.gap) + Wr / 2, k = seg(xc), d = segDir(k), A = axisAt(xc);
      const n0 = norm(cross(d, [0, 0, -1])), ts = [0, 0, -1];   // φ = 0 時法向朝上
      const pivot = { p: round3(A), d };
      for (let j = 0; j < P.up; j++) {
        const s = j * (Ls + P.gap) + Ls / 2 - S / 2;
        modules.push({ id: `${rid}-M${j + 1}.${i + 1}`, center: round3(add(add(A, mul(n0, e + M.T / 2)), mul(ts, s))), tx: d, ts, n: n0, size: [Wr, Ls, M.T], row: rid, pivot });
      }
      for (let q = 0; q < P.railsPerModule; q++) {
        const off = P.railsPerModule === 1 ? 0 : (q / (P.railsPerModule - 1) - .5) * Wr * .6;
        const base = add(axisAt(xc + off), mul(n0, e - railH / 2));
        const a = add(base, mul(ts, -(S / 2 + P.railExt))), b = add(base, mul(ts, S / 2 + P.railExt));
        members.push(member('rail', P.profiles.rail, a, b, n0, { id: `${rid}-M${i + 1}-rail${q + 1}`, row: r, pivot: { p: round3(axisAt(xc + off)), d: segDir(seg(xc + off)) } }));
      }
    }
    // 最大轉角時的實際最小淨空（兩側、每個取樣點）
    let clearMin = Infinity;
    for (const x of samples) { const A = axisAt(x); clearMin = Math.min(clearMin, A[1] + drop - Math.max(H(x, z - side), H(x, z + side))); }
    rows.push({ id: rid, z, x0, piles: px.map(x => Math.round(x * 10) / 10), axisY: axisY.map(y => Math.round(y * 10) / 10),
      gx: Math.round(gx * 1e5) / 1e5, slopes: slopes.map(s => Math.round(s * 1e5) / 1e5), kinks: kinks.map(k => Math.round(k * 1000) / 1000),
      clearMin: Math.round(clearMin * 10) / 10, axisLength: Math.round(Lt) });
  }
  const width = S;   // 0° 時的受光寬度
  return {
    kind: 'tracker', params: P, members, modules, rows,
    hardware: { bearings: nf * P.rows, drives: P.rows },
    summary: {
      modules: modules.length, kWp: Math.round(modules.length * (M.wp ?? 0) / 10) / 100,
      chord: S, axisLength: Lt, gcr: Math.round(width / P.pitch * 1000) / 1000, pileSpacing: Math.round(sp * 10) / 10, pilesPerRow: nf,
      pivot: e, lowEdgeAtMax: Math.round(drop * 10) / 10,
    },
    bom: bom(members),
  };
}

// 可動件在轉角 φ（度）的位置：繞 pivot.d 通過 pivot.p 旋轉。給沒有 three 的計算（例如淨空檢查）用
export function rotatePoint(pt, pivot, angleDeg) {
  const a = angleDeg * DEG, k = pivot.d, v = sub(pt, pivot.p), c = Math.cos(a), s = Math.sin(a);
  const kv = cross(k, v), kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return add(pivot.p, add(add(mul(v, c), mul(kv, s)), mul(k, kd * (1 - c))));
}
