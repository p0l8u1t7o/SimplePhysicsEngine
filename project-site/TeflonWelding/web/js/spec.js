// 規格與假設（單位 mm、秒）。資料來源：docs/ 的 1000L 桶 STEP、切半展示品照片（焊道標記）、膠體斷面圖、對談紀錄（2026-11-03）。
// 標「假設」的數值待用戶確認，清單在根目錄 PENDING.md「TeflonWelding」。

// ---------------------------------------------------------------- 1000L 桶（STEP 量得）
// 桶的局部座標：原點在下切線（直筒下緣）中心，+Y 沿桶軸朝人孔（立放時朝上）。
export const TANK = {
  ri: 500, wall: 4,                // SUS304 內徑 1000、壁厚 4
  straight: 1290,                  // 直筒長（下切線 0 → 上切線 1290）
  crown: 1004, knuckle: 96.8,      // 碟形封頭（內面）：球面半徑 1004、轉角半徑 96.8
  glue: 1, ptfe: 3,                // 膠層 1、PTFE 板 3（假設：照片看不出厚度）
  manway: { ri: 229.5, ro: 262.5, flangeR: 352.5, flangeT: 24, top: 1598 },   // 人孔頸 內徑 459、外徑 525；法蘭外徑 705，頂面 y = 1598
  outlet: { ri: 78.6, ro: 82.6, flangeR: 190, flangeT: 22, bottom: -298 },   // 底部出口頸 Ø165、法蘭 Ø380
  legs: { n: 4, r: 38, topR: 430, topY: -40, footR: 640, footY: -711, plate: 160 },  // 假設：四支外撇管腳，底面 y = −711（STEP 的底座環高度）
};
export const LINER_R = TANK.ri - TANK.glue - TANK.ptfe;      // PTFE 內表面半徑 496
export const NECK_CLEAR = TANK.manway.ri - TANK.ptfe;        // 人孔襯裡後的通過半徑 226.5（內徑 453）

// 碟形封頭剖面（內面偏移 o：正值往外、負值往內）：直筒半徑、轉角圓心、球面圓心
export function headGeometry(o = 0) {
  const kx = TANK.ri - TANK.knuckle;                                       // 轉角圓心半徑 403.2
  const cy = -Math.sqrt((TANK.crown - TANK.knuckle) ** 2 - kx * kx);       // 球面圓心在切線下 812.7
  const beta = Math.atan2(-cy, kx);                                        // 轉角與球面相切的角度
  return { R: TANK.ri + o, k: TANK.knuckle + o, c: TANK.crown + o, kx, cy, beta };
}
// 封頭在半徑 r 處離切線的高度（r ≤ 直筒半徑）
export function headHeight(r, o = 0) {
  const h = headGeometry(o);
  const rk = h.kx + h.k * Math.cos(h.beta);                                // 轉角／球面分界半徑
  if (r <= rk) return h.cy + Math.sqrt(Math.max(0, h.c * h.c - r * r));
  return Math.sqrt(Math.max(0, h.k * h.k - (r - h.kx) ** 2));
}

// ---------------------------------------------------------------- 焊道（依照片：兩道環縫＋中段一道縱縫；位置為假設，待用戶給襯板排版）
export const SEAMS = [
  { id: 'L1', name: '縱縫', kind: 'long', y0: 420, y1: 870, theta: 0 },   // 中段板捲成圓筒的對接縫
  { id: 'C1', name: '下環縫', kind: 'circ', y: 420 },                      // 下封頭件與中段的對接縫
  { id: 'C2', name: '上環縫', kind: 'circ', y: 870 },                      // 上封頭件與中段的對接縫
];
export const seamLength = s => s.kind === 'circ' ? 2 * Math.PI * LINER_R : s.y1 - s.y0;

// ---------------------------------------------------------------- 製程（依膠體斷面圖：開 V 槽 → 焊條熔接 → 削平 → 焊帶熔接 → 刮平，之後兆赫波檢測）
// 開槽前先用手臂上的 3D 相機沿焊道取像定位，算出焊道中心線並規劃各工具軌跡（襯板是人工貼合，焊道位置每桶不同）。
// speed：實際行走速度 m/min（假設，以試焊決定）；demo：動畫中走一道焊道的時間倍率
export const PROCESS = [
  { key: 'scan', name: '相機定位', tool: 'cam', speed: 1.5, demo: .7, note: '3D 相機（結構光）沿焊道取像，定位焊道中心線與板邊高低差' },
  { key: 'groove', name: '開 V 槽', tool: 'groove', speed: 1.0, note: '依規劃軌跡開 V 槽到膠層上方，雷射輪廓感測器即時循縫修正' },
  { key: 'rod', name: '焊條熔接', tool: 'rod', speed: .15, hot: true, note: '熱風 250 °C＋拖嘴（約 80 mm）壓入 PFA 焊條' },
  { key: 'flat', name: '削平', tool: 'flat', speed: 1.0, note: '削除凸出的焊條，與 PTFE 面齊平' },
  { key: 'belt', name: '焊帶熔接', tool: 'belt', speed: .15, hot: true, note: '熱風 250 °C＋壓輪，PFA 焊帶覆蓋整條焊道' },
  { key: 'scrape', name: '刮平', tool: 'scrape', speed: .8, note: '焊帶冷卻後以刮刀刮平表面與兩側邊緣' },
  { key: 'thz', name: '兆赫波檢測', tool: 'thz', speed: .6, demo: .8, note: '反射式 THz 探頭沿焊道掃描：氣孔、未熔合、厚度' },
];
export const HOT_AIR = { temp: 250, gun: 'Leister LHS 21S SYSTEM', drag: 80 };

// ---------------------------------------------------------------- 末端工具（快換盤以下的長度統一為 TOOL_LEN：同一組焊接姿態適用全部工具）
export const TOOL_LEN = 300;
export const TOOLS = [
  { key: 'cam', name: '3D 相機（定位）' },
  { key: 'groove', name: '開槽刀＋雷射循縫' },
  { key: 'rod', name: '焊條焊槍（LHS 21S＋拖嘴）' },
  { key: 'flat', name: '削平刀' },
  { key: 'belt', name: '焊帶焊槍（LHS 21S＋壓輪）' },
  { key: 'scrape', name: '刮刀' },
  { key: 'thz', name: '兆赫波探頭' },
];
// 進度欄位（每道焊道一組）：s 定位、g 開槽、r 焊條、f 削平、b 焊帶、k 刮平、i 檢測
export const FIELD = { scan: 's', groove: 'g', rod: 'r', flat: 'f', belt: 'b', scrape: 'k', thz: 'i' };

// ---------------------------------------------------------------- 方案
// mount：手臂如何進桶；spin：環縫由誰轉（tank＝桶轉、j1＝手臂 J1 繞圈）；arm：手臂型號
export const PLANS = {
  roll: {
    key: 'roll', name: 'A 臥式迴轉＋伸臂', arm: 'vs068', spin: 'tank', pose: '平焊（焊點永遠在桶底）',
    method: '桶臥放在開合式雙環迴轉架上，懸吊 X 軸帶伸臂從人孔伸入，VS-068 裝在伸臂前端（J1 與桶軸同軸）。環縫：手臂不動、桶轉一圈；縱縫：桶把縫轉到正下方，伸臂沿軸向走。全部焊道都是平焊。',
    pros: ['全部平焊，熔融 PFA 不下垂、品質最穩', '設備高度最低（約 2.7 m）', '手臂不繞圈，熱風管與線材不扭轉'],
    cons: ['桶要放倒（天車＋吊帶），迴轉架要配合桶腳', 'VS-068 壁掛安裝需原廠確認'],
  },
  turntable: {
    key: 'turntable', name: 'B 立式轉台＋升降柱', arm: 'vs068', spin: 'tank', pose: '橫焊（環縫）、立焊（縱縫）',
    method: '桶立放在轉台上（定位四支腳），立柱懸臂帶 X、Z 軸，VS-068 倒吊在短柱下端從人孔垂直伸入。環縫：手臂不動、轉台轉一圈；縱縫：轉台把縫轉到手臂前方，懸臂沿 Z 軸升降。',
    pros: ['桶不必放倒，堆高機直接放上轉台', '手臂不繞圈，管線不扭轉'],
    cons: ['環縫橫焊、縱縫立焊，焊條與焊帶要靠壓力控制成形', '換工具要整支手臂升出人孔，立柱高約 5 m（需確認廠房淨高）'],
  },
  cobot: {
    key: 'cobot', name: 'C 移動門架＋協作臂', arm: 'cobotta', spin: 'j1', pose: '橫焊（環縫）、立焊（縱縫）',
    method: '桶留在原地不動，移動式門架推到桶上方定位，COBOTTA PRO 900 倒吊從人孔伸入。環縫由手臂 J1 繞一圈（±270° 範圍內走 360°），縱縫由門架 Z 軸升降。',
    pros: ['投資最低、不需迴轉設備，一台門架可輪流服務多個桶', '協作臂可與人員近距離作業，便於試焊調參'],
    cons: ['環縫時 J1 轉 360°，熱風管與焊條管要做旋轉管理', '門架高約 5 m、焊接位置與 B 相同（橫焊／立焊）'],
  },
};

// ---------------------------------------------------------------- 動畫節奏（秒；實際工時另依 PROCESS.speed 計算）
export const DEMO = { circ: 4.5, long: 1.8, enter: 2, change: 1.1, approach: .75, plan: 2 };

// 實際工時估算（分鐘）：每道製程走完全部焊道＋每次換工具與進出 3 分鐘（假設）
export function cycleEstimate() {
  const total = SEAMS.reduce((a, s) => a + seamLength(s), 0) / 1000;      // m
  const rows = PROCESS.map(p => ({ key: p.key, name: p.name, min: total / p.speed + 3 }));
  return { metres: total, rows, sum: rows.reduce((a, r) => a + r.min, 0) + 20 };   // ＋20 分上下料與定位
}
