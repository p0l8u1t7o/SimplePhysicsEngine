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

// ---------------------------------------------------------------- 焊道（依照片：兩道環縫＋中段縱縫；位置為假設，網頁側欄可調，待用戶給襯板排版）
// c1／c2：下／上環縫離下切線的高度；nl：中段縱縫條數（1 或 2，2 條時相隔 180°）
export const SEAM_LAYOUT = { c1: 420, c2: 870, nl: 1 };
// 環縫範圍：上限依手臂（伸入深度不同）——COBOTTA 的上臂在上環縫高於約 870 時，管束會擦到人孔頸（tools/verify.mjs 驗證過的區間）
export const SEAM_LIMITS = { min: 250, gap: 250, max: { vs068: 1000, cobotta: 870 } };
export function seamLayout(o = {}, arm = 'vs068') {
  const L = { ...SEAM_LIMITS, max: SEAM_LIMITS.max[arm] ?? 870 }, num = (v, d) => Number.isFinite(+v) && v !== '' && v != null ? +v : d;
  let c1 = Math.round(num(o.c1, SEAM_LAYOUT.c1)), c2 = Math.round(num(o.c2, SEAM_LAYOUT.c2));
  c1 = Math.min(Math.max(c1, L.min), L.max - L.gap); c2 = Math.min(Math.max(c2, c1 + L.gap), L.max);
  return { c1, c2, nl: +o.nl === 2 ? 2 : 1, limits: L };
}
export function makeSeams(o = {}, arm) {
  const { c1, c2, nl } = seamLayout(o, arm);
  const longs = Array.from({ length: nl }, (_, k) => ({ id: `L${k + 1}`, name: nl > 1 ? `縱縫 ${k + 1}` : '縱縫', kind: 'long', y0: c1, y1: c2, theta: k * Math.PI }));
  return [...longs, { id: 'C1', name: '下環縫', kind: 'circ', y: c1 }, { id: 'C2', name: '上環縫', kind: 'circ', y: c2 }];
}
export const SEAMS = makeSeams();
export const seamLength = s => s.kind === 'circ' ? 2 * Math.PI * LINER_R : s.y1 - s.y0;

// ---------------------------------------------------------------- 製程（依膠體斷面圖的順序：開 V 槽 → 焊條熔接 → 削平（Flat cut，用戶稱刮平）→ 焊帶熔接，之後兆赫波檢測）
// 開槽前先用手臂上的 3D 相機沿焊道取像定位，算出焊道中心線並規劃各工具軌跡（襯板是人工貼合，焊道位置每桶不同）。
// speed：實際行走速度 m/min（假設，以試焊決定）；demo：動畫中走一道焊道的時間倍率
export const PROCESS = [
  { key: 'scan', name: '相機定位', tool: 'cam', speed: 1.5, demo: .7, note: '3D 相機（結構光）沿焊道取像，定位焊道中心線與板邊高低差' },
  { key: 'groove', name: '開 V 槽', tool: 'groove', speed: 1.0, note: '依規劃軌跡開 V 槽到膠層上方，雷射輪廓感測器即時循縫修正' },
  { key: 'rod', name: '焊條熔接', tool: 'rod', speed: .15, hot: true, note: '熱風 250 °C＋拖嘴（約 80 mm）壓入 PFA 焊條' },
  { key: 'flat', name: '削平（刮平）', tool: 'flat', speed: 1.0, note: '斷面圖的 Flat cut：刮除凸出的焊條，與 PTFE 面齊平' },
  { key: 'belt', name: '焊帶熔接', tool: 'belt', speed: .15, hot: true, note: '熱風 250 °C＋壓輪，PFA 焊帶覆蓋整條焊道' },
  { key: 'thz', name: '兆赫波檢測', tool: 'thz', speed: .6, demo: .8, note: '反射式 THz 探頭沿焊道掃描：氣孔、未熔合、厚度' },
];
// ---------------------------------------------------------------- 兆赫波（THz）檢測（反射式時域，示意數值待探頭廠商確認）
// 原理：探頭打出 0.1～3 THz 的皮秒脈衝，PTFE／PFA 幾乎透明、SUS 全反射；每個介面（折射率改變處）反射一個回波，
// 回波時間差 Δt 換算厚度 d = c·Δt／(2n)。PFA 焊層與 PTFE 折射率幾乎相同，熔合良好時兩者交界幾乎沒有回波；
// 氣孔或未熔合是一層空氣（n = 1），會多出一道相位反轉的強回波 → 判 NG。
export const THZ = {
  c: .2998,                                       // 光速 mm/ps
  n: { pfa: 1.44, ptfe: 1.43, glue: 1.6 },
  layers: { belt: .6, ptfe: 3.0, glue: 1.0 },     // 焊帶、PTFE、膠層厚度 mm（假設）
  voidDepth: 1.4,                                 // 模擬氣孔在表面下深度 mm（焊條熔接層內）
  defect: { seam: 'C2', u: .62 },                 // 模擬氣孔位置（上環縫）
  repairHalf: 60,                                 // 補焊段：缺陷前後各 60 mm
  criteria: [
    '多餘回波：表面與膠層回波之間出現 > 表面回波 15% 的回波 → NG（氣孔／未熔合）',
    '覆蓋厚度：表面回波 → PTFE／膠層回波換算 ≥ 3.2 mm',
    '熔合：焊帶／PTFE 交界回波 < 8%（熔合良好幾乎看不到）',
  ],
};

export const HOT_AIR = { temp: 250, gun: 'Leister LHS 21S SYSTEM', drag: 80 };

// ---------------------------------------------------------------- 末端工具（快換盤以下的長度統一為 TOOL_LEN：同一組焊接姿態適用全部工具）
export const TOOL_LEN = 300;
export const TOOLS = [
  { key: 'cam', name: '3D 相機（定位）' },
  { key: 'groove', name: '開槽刀＋雷射循縫' },
  { key: 'rod', name: '焊條焊槍（LHS 21S＋拖嘴）' },
  { key: 'flat', name: '削平刀（刮刀）' },
  { key: 'belt', name: '焊帶焊槍（LHS 21S＋壓輪）' },
  { key: 'thz', name: '兆赫波探頭' },
];
// 進度欄位（每道焊道一組）：s 定位、g 開槽、r 焊條、f 削平（刮平）、b 焊帶、i 檢測
export const FIELD = { scan: 's', groove: 'g', rod: 'r', flat: 'f', belt: 'b', thz: 'i' };

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

// 方案比較表（側欄）：數值取自本站模型；投資為相對級距，待報價
export const COMPARE = [
  { k: '焊接位置', roll: '全部平焊', turntable: '環縫橫焊、縱縫立焊', cobot: '環縫橫焊、縱縫立焊' },
  { k: '設備高度', roll: '約 2.9 m（X 軸樑）', turntable: '約 5.4 m（立柱）', cobot: '約 5.4 m（門架），Z 柱升起約 6.3 m' },
  { k: '桶的擺放', roll: '放倒進迴轉架（天車）', turntable: '立放上轉台（天車或堆高機）', cobot: '原地不動' },
  { k: '環縫怎麼轉', roll: '桶轉', turntable: '轉台轉', cobot: '手臂 J1 繞 360°' },
  { k: '管線', roll: '不扭轉', turntable: '不扭轉', cobot: '需旋轉接頭' },
  { k: '手臂', roll: 'VS-068（壁掛，需原廠確認）', turntable: 'VS-068（倒吊）', cobot: 'COBOTTA PRO 900（倒吊）' },
  { k: '投資（相對）', roll: '中', turntable: '中高', cobot: '中低' },
  { k: '主要風險', roll: '迴轉架要配合桶腳', turntable: '橫焊／立焊成形、廠房淨高', cobot: '橫焊／立焊成形、門架高度與穩定' },
];

// ---------------------------------------------------------------- 動畫節奏（秒；實際工時另依 PROCESS.speed 計算）
export const DEMO = { circ: 4.5, long: 1.8, enter: 2, change: 1.1, approach: .75, plan: 2 };

// 實際工時估算（分鐘）：每道製程走完全部焊道＋每次換工具與進出 3 分鐘（假設）
export function cycleEstimate(seams = SEAMS) {
  const total = seams.reduce((a, s) => a + seamLength(s), 0) / 1000;      // m
  const rows = PROCESS.map(p => ({ key: p.key, name: p.name, min: total / p.speed + 3 }));
  return { metres: total, rows, sum: rows.reduce((a, r) => a + r.min, 0) + 20 };   // ＋20 分上下料與定位
}
