// 鋼構斷面表（示意）：C 型鋼（輕量型鋼，有唇）、Z 型檁條、H 型鋼、方管／矩形管、圓管。
// 單位：尺寸 mm、面積 mm²、單位重 kg/m、密度 7850 kg/m³。
//
// 面積一律由尺寸用公式算（不手抄數值），ref 欄記錄型錄的單位重供測試比對：
//   - 冷彎件（C、Z、方管、矩形管）：中線長 × t，扣掉每個彎角的圓角差 (1 − π/4)(ro² − ri²)，
//     內半徑 ri = t、外半徑 ro = 2t（JIS G3350／G3466 計算斷面積的慣例）。
//   - H 型鋼：2·b·tf + (h − 2tf)·tw ＋ 4 個腹板圓角 (1 − π/4)·r²（JIS G3192 的算法）。
//   - 圓管：π·t·(D − t)。
// 來源（示意，正式選型以供應商型錄與結構計算為準）：
//   - C 型鋼 ref：JIS G3350 輕量型鋼 リップ溝形鋼 表（C-100×50×20×2.3 = 4.06 kg/m 等）
//   - 方管 ref：JIS G3466 一般構造用角形鋼管 STKR 表
//   - H 型鋼 ref：JIS G3192 熱間圧延形鋼 H 形鋼 表（H-150×150×7×10 = 31.1 kg/m 等）
//   - 圓管 ref：JIS G3444 一般構造用炭素鋼鋼管 STK 表（114.3×4.5 = 12.2 kg/m）
//   - Z 型檁條：各家光伏支架廠的常見規格，無統一標準，沒有 ref（只用公式）
export const STEEL_DENSITY = 7850;               // kg/m³
const CORNER = 1 - Math.PI / 4;                  // 一個直角圓角少掉的面積係數

// 斷面積（mm²）
export function sectionArea(p) {
  const { h, b, t } = p;
  switch (p.type) {
    case 'C': case 'Z': {
      const c = p.c ?? 0, corners = c > 0 ? 4 : 2;
      const mid = c > 0 ? h + 2 * b + 2 * c - 4 * t : h + 2 * b - 2 * t;   // 中線長
      return t * mid - corners * CORNER * ((2 * t) ** 2 - t ** 2);
    }
    case 'H': return 2 * b * p.tf + (h - 2 * p.tf) * p.tw + 4 * CORNER * (p.r ?? 0) ** 2;
    case 'SHS': case 'RHS': {
      const H = h ?? b;
      return 2 * t * (H + b - 2 * t) - 4 * CORNER * ((2 * t) ** 2 - t ** 2);
    }
    case 'CHS': return Math.PI * t * (p.D - t);
    default: throw new Error(`未知的斷面型式 ${p.type}`);
  }
}
// 單位重 kg/m
export const kgPerM = p => sectionArea(p) * 1e-6 * STEEL_DENSITY;
// 斷面外框（渲染與淨空用）：[寬 x, 高 y]
export const sectionSize = p => p.type === 'CHS' ? [p.D, p.D] : p.type === 'SHS' ? [p.b, p.b] : [p.b, p.h];

// 斷面表：id → 尺寸。ref = 型錄單位重（kg/m），只有查得到標準表的才填
const RAW = {
  // 有唇 C 型鋼（h × b × c × t）
  'C75x45x15x2.3': { type: 'C', h: 75, b: 45, c: 15, t: 2.3, ref: 3.25 },
  'C100x50x20x2.3': { type: 'C', h: 100, b: 50, c: 20, t: 2.3, ref: 4.06 },
  'C125x50x20x2.3': { type: 'C', h: 125, b: 50, c: 20, t: 2.3, ref: 4.51 },
  'C150x65x20x3.2': { type: 'C', h: 150, b: 65, c: 20, t: 3.2, ref: 7.51 },
  // Z 型檁條（光伏常見，無標準表）
  'Z120x50x20x2.0': { type: 'Z', h: 120, b: 50, c: 20, t: 2.0 },
  'Z150x60x20x2.3': { type: 'Z', h: 150, b: 60, c: 20, t: 2.3 },
  // H 型鋼（h × b × tw × tf，腹板圓角 r）
  'H100x100x6x8': { type: 'H', h: 100, b: 100, tw: 6, tf: 8, r: 8, ref: 16.9 },
  'H125x125x6.5x9': { type: 'H', h: 125, b: 125, tw: 6.5, tf: 9, r: 8, ref: 23.6 },
  'H150x150x7x10': { type: 'H', h: 150, b: 150, tw: 7, tf: 10, r: 8, ref: 31.1 },
  'H200x100x5.5x8': { type: 'H', h: 200, b: 100, tw: 5.5, tf: 8, r: 8, ref: 20.9 },
  // 方管（b × b × t）
  'SHS50x50x2.3': { type: 'SHS', b: 50, t: 2.3, ref: 3.34 },
  'SHS75x75x3.2': { type: 'SHS', b: 75, t: 3.2, ref: 7.01 },
  'SHS100x100x3.2': { type: 'SHS', b: 100, t: 3.2, ref: 9.52 },
  'SHS125x125x4.5': { type: 'SHS', b: 125, t: 4.5, ref: 16.6 },
  // 矩形管（h × b × t；h 為腹板方向）
  'RHS100x50x2.3': { type: 'RHS', h: 100, b: 50, t: 2.3 },
  // 圓管（D × t）
  'CHS114.3x4.5': { type: 'CHS', D: 114.3, t: 4.5, ref: 12.2 },
  'CHS139.8x4.5': { type: 'CHS', D: 139.8, t: 4.5, ref: 15.0 },
};

export const PROFILES = Object.fromEntries(Object.entries(RAW).map(([id, p]) => {
  const area = sectionArea(p);
  return [id, Object.freeze({ id, ...p, area, kgPerM: area * 1e-6 * STEEL_DENSITY, note: p.ref ? '示意（公式計算，ref 為型錄值）' : '示意（公式計算，無標準表）' })];
}));

// 取斷面：給 id 字串或自訂物件（{ type, h, b, … }，沒有 id 時自動命名）
export function profile(p) {
  if (typeof p === 'string') {
    const hit = PROFILES[p];
    if (!hit) throw new Error(`斷面表沒有 ${p}`);
    return hit;
  }
  const area = sectionArea(p);
  return { id: p.id ?? `${p.type}-custom`, ...p, area, kgPerM: area * 1e-6 * STEEL_DENSITY, note: '自訂斷面' };
}
