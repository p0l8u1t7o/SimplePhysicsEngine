// 管徑、導線管、電纜槽、線材尺寸表（示意）。單位 mm；正式選型以供應商型錄與適用規範為準。
//
// 鋼管 SCH40（PIPE_SCH40）：OD、壁厚取 ASME B36.10M（NPS ½"～6"）。
//   彎頭半徑：長半徑彎頭 R = 1.5 × NPS（ASME B16.9 90° LR 中心到端面 A，½" 例外為 38 mm、¾" 為 29 mm）；
//   短半徑 R = 1.0 × NPS；冷彎管 R ≥ 3 × OD（示意，常見彎管機 3D～5D）。
// 導線管（CONDUIT_EMT）：外徑、壁厚取 ANSI C80.3（EMT）；最小彎曲半徑取 NEC Chapter 9 Table 2「其他彎曲」欄（中心線半徑）。
// 電纜槽（TRAY）：常見寬高級距；彎曲半徑由槽內最粗線材的最小彎曲半徑決定（minBendR = k × 線徑）。
// 光伏線（CABLE_PV）：H1Z2Z2-K／PV1-F 類的外徑（各廠不同，取中間值）；最小彎曲半徑 4 × 外徑（固定敷設，廠商型錄常見值）。
//   導體電阻（20 °C，Ω/km）：IEC 60228 第 5 類（軟絞線）鍍錫銅的最大值。
export const INCH = 25.4;

// DN、NPS（吋）、OD、壁厚、LR 彎頭中心到端面（90°）
const SCH40 = [
  ['DN15', .5, 21.3, 2.77, 38], ['DN20', .75, 26.7, 2.87, 29], ['DN25', 1, 33.4, 3.38, 38], ['DN32', 1.25, 42.2, 3.56, 48],
  ['DN40', 1.5, 48.3, 3.68, 57], ['DN50', 2, 60.3, 3.91, 76], ['DN65', 2.5, 73.0, 5.16, 95], ['DN80', 3, 88.9, 5.49, 114],
  ['DN100', 4, 114.3, 6.02, 152], ['DN150', 6, 168.3, 7.11, 229],
];
export const PIPE_SCH40 = Object.fromEntries(SCH40.map(([dn, nps, od, wall, lr]) => [dn, Object.freeze({
  id: dn, kind: 'pipe', nps, od, wall, ID: od - 2 * wall,
  bend: { 'elbow-lr': lr, 'elbow-sr': nps * INCH, 'pipe-bend': 3 * od },
  roughness: .045,                        // mm，商用鋼管（示意；鍍鋅 0.15、PVC／HDPE 0.0015）
  source: 'ASME B36.10M（OD、壁厚）、ASME B16.9（LR 彎頭）—示意',
})]));

// EMT 導線管：商用尺寸（吋）、OD、壁厚、最小彎曲半徑（NEC Ch.9 Table 2 其他彎曲）
const EMT = [
  ['EMT-1/2', .5, 17.9, 1.07, 4 * INCH], ['EMT-3/4', .75, 23.4, 1.24, 5 * INCH], ['EMT-1', 1, 29.5, 1.45, 6 * INCH],
  ['EMT-1-1/4', 1.25, 38.4, 1.65, 8 * INCH], ['EMT-1-1/2', 1.5, 44.2, 1.65, 10 * INCH], ['EMT-2', 2, 55.8, 1.65, 12 * INCH],
];
export const CONDUIT_EMT = Object.fromEntries(EMT.map(([id, size, od, wall, r]) => [id, Object.freeze({
  id, kind: 'conduit', size, od, wall, ID: od - 2 * wall, bend: { conduit: r }, maxBendPerPull: 360,
  source: 'ANSI C80.3（EMT 尺寸）、NEC Chapter 9 Table 2（彎曲半徑）、NEC 358.26（兩拉線點之間彎曲合計 ≤ 360°）—示意',
})]));

// 電纜槽（寬 × 高）
export const TRAY = Object.fromEntries([[100, 50], [150, 50], [200, 75], [300, 100], [400, 100], [600, 150]].map(([w, h]) => [`TRAY-${w}x${h}`, Object.freeze({
  id: `TRAY-${w}x${h}`, kind: 'tray', width: w, height: h, od: Math.max(w, h), bend: { tray: 300 },   // 標準彎通常 300 mm 內半徑級距（示意）
  source: '常見梯架／槽架規格（示意）',
})]));

// 光伏直流線（導體截面 mm² → 外徑、20 °C 導體電阻 Ω/km）
export const CABLE_PV = Object.fromEntries([[2.5, 5.0, 8.21], [4, 5.6, 5.09], [6, 6.3, 3.39], [10, 7.4, 1.95], [16, 8.8, 1.24]].map(([a, od, r20]) => [`PV-${a}`, Object.freeze({
  id: `PV-${a}`, kind: 'cable', area: a, od, r20, minBendR: 4 * od, material: 'Cu',
  source: 'IEC 60228 第 5 類鍍錫銅最大導體電阻；外徑為常見 H1Z2Z2-K 型錄中間值；彎曲半徑 4D（型錄常見值）—示意',
})]));

// 依 id 取尺寸（鋼管、導線管、電纜槽、線材共用一個查表）
export function size(id) {
  if (typeof id === 'object') return id;
  const hit = PIPE_SCH40[id] ?? CONDUIT_EMT[id] ?? TRAY[id] ?? CABLE_PV[id];
  if (!hit) throw new Error(`尺寸表沒有 ${id}`);
  return hit;
}
// 最小彎曲半徑：bendType 沒給時取該類的預設（鋼管＝LR 彎頭）
export function minBendRadius(s, bendType) {
  const S = size(s);
  if (S.kind === 'cable') return S.minBendR;
  const t = bendType ?? Object.keys(S.bend)[0];
  if (!(t in S.bend)) throw new Error(`${S.id} 沒有 ${t} 的彎曲半徑`);
  return S.bend[t];
}
