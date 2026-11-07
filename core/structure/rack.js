// 固定傾角光伏支架（依地形逐支計算）：純計算，回傳構件清單、模組位置與 BOM；3D 由 build.js 產生。
//
// 座標（和框架相同）：mm，Y 朝上。列沿 +X；模組朝 +Z 傾斜（低邊在 +Z、往 −Z 升高），
// 也就是 +Z 為受光方向（北半球案場把 root 轉到 +Z 朝南）。第 r 列的低邊在 z = origin[1] − r·pitch。
// 地形：height(x, z) → 地面高度 y（mm）。地形只決定高度，構件的平面位置照參數排列。
//
// 每張桌（table）是一個剛性平面：
//   - 沿列方向的坡度 gx 由桌下地面的最小平方直線決定，限制在 ±maxRowSlope（跟著地形走，但不扭曲）；
//   - 整張桌的高度取「所有取樣點的模組下緣離地 ≥ clearance」的最小值；
//   - 基樁頂跟著支架平面，地面跟著地形，所以每支樁的外露高度不同：
//       pile.embed 有給 → 埋深固定，樁長 = 外露 + 埋深；pile.length 有給 → 樁長固定，埋深 = 樁長 − 外露（檢查 ≥ minEmbed）。
import { add, mul, cross, norm, clamp, fitLine, round3 } from './vec.js';
import { profile, sectionSize } from './profiles.js';
import { member, bom, splitStock } from './members.js';

export const RACK_DEFAULTS = Object.freeze({
  module: { L: 2278, W: 1134, T: 35, kg: 28, wp: 580 },   // 示意：常見 72 片半片 182 mm 電池的尺寸級距
  orientation: 'portrait',   // portrait：長邊沿坡向；landscape：長邊沿列向
  up: 2,                     // 坡向幾片（2P）
  across: 20,                // 每張桌沿列向幾片
  gap: 20,                   // 模組間隙 mm
  tilt: 20,                  // 傾角（度）
  clearance: 600,            // 模組下緣最小離地 mm
  rows: 3, tablesPerRow: 1,
  pitch: 7500,               // 列距（水平，低邊到低邊）mm
  tableGap: 500,             // 同列相鄰兩桌間距 mm
  origin: [0, 0],            // 第一張桌低邊左端的 [x, z]
  pileSpacing: 4000,         // 框架（斜樑）間距上限 mm（沿列）
  overhang: 800,             // 桌端到第一個框架 mm
  posts: 2,                  // 每個框架 1 或 2 支樁
  postAt: null,              // 樁在斜長上的位置比例（2 支預設 [0.15, 0.8]，1 支預設 [0.5]）
  purlinAt: [0.25, 0.75],    // 每片模組（坡向）上檁條的位置比例
  purlinStock: 6000,         // 檁條庫存長度 mm（超過就分段，接頭靠到斜樑）
  rafterExt: 60,             // 斜樑超出模組上下緣 mm
  maxRowSlope: 0.1,          // 桌沿列向坡度上限（10 %）
  braceFoot: 300,            // 斜撐下端離地 mm
  rowBraces: 'ends',         // 'ends'：兩端跨各一支縱向斜撐；'none'；'all'
  pile: { embed: 1500, length: null, minEmbed: 1200, maxReveal: 3000 },
  profiles: { pile: 'H150x150x7x10', rafter: 'C150x65x20x3.2', purlin: 'Z150x60x20x2.3', brace: 'C100x50x20x2.3' },
  height: () => 0,
});

const DEG = Math.PI / 180;

export function layoutFixedRack(params = {}) {
  const P = { ...RACK_DEFAULTS, ...params, module: { ...RACK_DEFAULTS.module, ...params.module }, pile: { ...RACK_DEFAULTS.pile, ...params.pile }, profiles: { ...RACK_DEFAULTS.profiles, ...params.profiles } };
  const H = P.height, M = P.module, th = P.tilt * DEG;
  const portrait = P.orientation === 'portrait';
  const Ls = portrait ? M.L : M.W, Wr = portrait ? M.W : M.L;
  const S = P.up * Ls + (P.up - 1) * P.gap;                 // 斜長（坡向）
  const Lt = P.across * Wr + (P.across - 1) * P.gap;         // 桌長（沿列，順著桌面量）
  const hp = sectionSize(profile(P.profiles.purlin))[1], hr = sectionSize(profile(P.profiles.rafter))[1];
  const postAt = P.postAt ?? (P.posts === 1 ? [.5] : [.15, .8]);
  const ov = Math.min(P.overhang, Lt / 4);
  const nf = Math.max(2, Math.ceil((Lt - 2 * ov) / P.pileSpacing - 1e-9) + 1), sp = (Lt - 2 * ov) / (nf - 1);
  const frameU = Array.from({ length: nf }, (_, k) => ov + k * sp);
  const members = [], modules = [], tables = [];

  for (let r = 0; r < P.rows; r++) for (let k = 0; k < P.tablesPerRow; k++) {
    const x0 = P.origin[0] + k * (Lt + P.tableGap), z0 = P.origin[1] - r * P.pitch, tid = `R${r + 1}T${k + 1}`;
    // 1. 沿列坡度：桌中線（斜長一半處）在各框架與兩端的地面高度做直線擬合
    const zMid = z0 - S / 2 * Math.cos(th), us = [0, ...frameU, Lt];
    const fit = fitLine(us.map(u => x0 + u), us.map(u => H(x0 + u, zMid)));
    const gx = clamp(fit.b, -P.maxRowSlope, P.maxRowSlope);
    // 2. 桌面座標：tx 沿列（順著 gx）、ts 往上坡（留在 YZ 鉛直面內，同一框架的前後樁在同一條 x 線上）、n 桌面法向（朝上、朝 +Z）
    //    gx ≠ 0 時 tx 與 ts 不完全垂直（差 gx·sinθ，5 % 坡、20° 時約 1°），模組在檁條上的排列照 tx、ts 走
    const tx = norm([1, gx, 0]), ts = [0, Math.sin(th), -Math.cos(th)], n = norm(cross(tx, ts));
    const at = (u, s, c) => add([x0, c, z0], add(mul(tx, u), mul(ts, s)));   // 模組下緣面上的點
    // 3. 高度：所有取樣點的模組下緣離地 ≥ clearance
    const ss = [0, S / 4, S / 2, 3 * S / 4, S];
    let c = -Infinity;
    for (const u of us) for (const s of ss) { const p = at(u, s, 0); c = Math.max(c, H(p[0], p[2]) + P.clearance - p[1]); }
    let clearMin = Infinity, steelClear = Infinity;
    for (const u of us) for (const s of ss) { const p = at(u, s, c); clearMin = Math.min(clearMin, p[1] - H(p[0], p[2])); }

    // 模組
    for (let j = 0; j < P.up; j++) for (let i = 0; i < P.across; i++) {
      const u = i * (Wr + P.gap) + Wr / 2, s = j * (Ls + P.gap) + Ls / 2;
      modules.push({ id: `${tid}-M${j + 1}.${i + 1}`, center: round3(add(at(u, s, c), mul(n, M.T / 2))), tx, ts, n, size: [Wr, Ls, M.T], table: tid });
    }
    // 檁條：每片模組 purlinAt 位置各一支，沿列跨整張桌；接頭靠到斜樑
    const purlinOff = mul(n, -hp / 2), pieces = splitStock(Lt, P.purlinStock, frameU);
    let pi = 0;
    for (let j = 0; j < P.up; j++) for (const f of P.purlinAt) {
      const s = j * (Ls + P.gap) + f * Ls; pi++;
      pieces.forEach(([u0, u1], q) => members.push(member('purlin', P.profiles.purlin, add(at(u0, s, c), purlinOff), add(at(u1, s, c), purlinOff), n,
        { id: `${tid}-P${pi}.${q + 1}`, row: r, table: tid, splice: pieces.length > 1 })));
    }
    // 框架：斜樑、樁、斜撐
    const rafterOff = mul(n, -(hp + hr / 2)), under = mul(n, -(hp + hr));
    const rearPiles = [];
    frameU.forEach((u, f) => {
      const fid = `${tid}-F${f + 1}`;
      const ra = add(at(u, -P.rafterExt, c), rafterOff), rb = add(at(u, S + P.rafterExt, c), rafterOff);
      members.push(member('rafter', P.profiles.rafter, ra, rb, n, { id: `${fid}-rafter`, row: r, table: tid, frame: f }));
      steelClear = Math.min(steelClear, ra[1] - hr / 2 - H(ra[0], ra[2]));
      const piles = postAt.map((fr, q) => {
        const top = add(at(u, fr * S, c), under), g = H(top[0], top[2]), reveal = top[1] - g;
        const embed = P.pile.length != null ? P.pile.length - reveal : P.pile.embed;
        const bottom = [top[0], g - embed, top[2]];
        const name = postAt.length === 1 ? 'pile' : q === 0 ? 'pileFront' : 'pileRear';
        const m = member('pile', P.profiles.pile, bottom, top, [0, 0, 1], { id: `${fid}-${name}`, row: r, table: tid, frame: f,
          ground: Math.round(g * 10) / 10, top: Math.round(top[1] * 10) / 10, reveal: Math.round(reveal * 10) / 10, embed: Math.round(embed * 10) / 10 });
        members.push(m); return { top, g, m };
      });
      if (piles.length === 2) {
        // 框架面內一支斜撐：前樁頂下 150 → 後樁離地 braceFoot
        const [fp, rp] = piles, hi = add(fp.top, [0, -150, 0]), lo = [rp.top[0], rp.g + P.braceFoot, rp.top[2]];
        if (rp.top[1] - lo[1] > 300) members.push(member('brace', P.profiles.brace, lo, hi, [1, 0, 0], { id: `${fid}-brace`, row: r, table: tid, frame: f }));
        rearPiles.push(rp);
      } else {
        // 單柱：樁頂下 braceDrop 斜向斜樑前後各一支
        const pp = piles[0], drop = Math.min(800, (pp.top[1] - pp.g) * .6), lo = add(pp.top, [0, -drop, 0]);
        for (const [q, fr] of [[1, .5 - .3], [2, .5 + .3]]) members.push(member('brace', P.profiles.brace, lo, add(at(u, fr * S, c), under), [1, 0, 0], { id: `${fid}-brace${q}`, row: r, table: tid, frame: f }));
        rearPiles.push(pp);
      }
    });
    // 縱向斜撐（後樁之間）
    const bays = P.rowBraces === 'all' ? frameU.slice(1).map((_, i) => i) : P.rowBraces === 'ends' ? [...new Set([0, nf - 2])] : [];
    for (const b of bays) {
      const A = rearPiles[b], B = rearPiles[b + 1];
      const hi = add(A.top, [0, -150, 0]), lo = [B.top[0], B.g + P.braceFoot, B.top[2]];
      if (hi[1] - lo[1] > 300) members.push(member('brace', P.profiles.brace, lo, hi, [0, 0, 1], { id: `${tid}-B${b + 1}`, row: r, table: tid, bay: b }));
    }
    tables.push({ id: tid, row: r, x0, z0, gx: Math.round(gx * 1e5) / 1e5, groundSlope: Math.round(fit.b * 1e5) / 1e5, c: Math.round(c * 10) / 10,
      frames: frameU.length, frameSpacing: Math.round(sp * 10) / 10, clearMin: Math.round(clearMin * 10) / 10, steelClear: Math.round(steelClear * 10) / 10,
      corners: [at(0, 0, c), at(Lt, 0, c), at(Lt, S, c), at(0, S, c)].map(round3), tx, ts, n });
  }
  const depth = S * Math.cos(th);
  return {
    kind: 'fixed', params: P, members, modules, tables,
    summary: {
      modules: modules.length, kWp: Math.round(modules.length * (M.wp ?? 0) / 10) / 100,
      slopeLength: S, tableLength: Lt, depth: Math.round(depth * 10) / 10, gcr: Math.round(depth / P.pitch * 1000) / 1000,
      rowGap: Math.round((P.pitch - depth) * 10) / 10, frameSpacing: Math.round(sp * 10) / 10, framesPerTable: nf,
    },
    bom: bom(members),
  };
}

// 模組下緣（桌面）上任一點，給外部（例如遮陰、走線）用：table 是 layout.tables 的一筆
export function tablePoint(table, u, s) {
  const o = table.corners[0];
  return add(o, add(mul(table.tx, u), mul(table.ts, s)));
}

