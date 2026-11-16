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
// 環縫範圍：COBOTTA 熱風管改沿中性側後，上限保留人孔間隙；共用護線仍限制可達高度。
export const SEAM_LIMITS = { min: 250, gap: 250, max: { vs068: 1000, cobotta: 875 } };
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
  { key: 'groove', name: '開 V 槽', tool: 'groove', speed: 1.0, clean: 3.0, note: 'CNC 主軸刀頭＋靠模滑靴開 V 槽到膠層上方，雷射循縫；全罩毛刷吸屑' },
  { key: 'rod', name: '焊條熔接', tool: 'rod', speed: .15, hot: true, note: '熱風吹軟 PFA 焊條，拖嘴 5 kgf 下壓熔接；UV 線雷射即時檢測熔接狀態' },
  { key: 'flat', name: '削平（刮平）', tool: 'flat', speed: 1.0, note: '斷面圖的 Flat cut：刮除凸出的焊條，與 PTFE 面齊平' },
  { key: 'belt', name: '焊帶熔接', tool: 'belt', speed: .15, hot: true, note: '熱風＋壓輪，PFA 焊帶覆蓋整條焊道' },
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
  repairHalf: 60,                                 // 人工補修段：缺陷前後各 60 mm（刨除 → 補焊條 → 削平 → 焊帶），之後自動複檢
  criteria: [
    '多餘回波：表面與膠層回波之間出現 > 表面回波 15% 的回波 → NG（氣孔／未熔合）',
    '覆蓋厚度：表面回波 → PTFE／膠層回波換算 ≥ 3.2 mm',
    '熔合：焊帶／PTFE 交界回波 < 8%（熔合良好幾乎看不到）',
  ],
};

// 熱風 250 °C 是用戶提供的數值；PFA 熔點約 305 °C，是設定值還是出風溫度待確認（試焊決定）
export const HOT_AIR = { temp: 250, gun: 'Leister LHS 21S SYSTEM', drag: 80, tempNote: '設定值待確認' };

// ---------------------------------------------------------------- 工序 3：CNC 刀具頭與除屑（2026-11-11 客戶反饋：客戶用過 CNC 刀頭，開口面較平整）
export const CNC = {
  spindle: '高速電主軸（約 24,000 rpm、ER 夾頭，示意）', cutter: 'V 形銑刀 90°（Ø12，示意）',
  depth: '靠模滑靴貼 PTFE 表面控制切深，開到膠層上方停止（深度待確認）',
  chips: ['刀頭全罩＋毛刷裙邊，罩內負壓吸屑，切屑不落在焊道', '罩內吹氣把屑吹向吸口；刀刃吹氣冷卻、不用切削液', '每道焊道開完回程吸屑一趟（主軸停、罩貼面）', '焊條熔接前 3D 相機複掃確認槽內無屑', '切屑獨立集屑桶（PTFE 屑不與燻煙共用濾材）'],
};

// ---------------------------------------------------------------- 工序 4：5 kgf 下壓＋UV 線雷射即時檢測＋NG 切斷焊條（2026-11-11 客戶反饋）
export const ROD_WELD = {
  press: 5, pressN: 49,                           // 熱風吹軟後拖嘴下壓 5 kgf（49 N）
  float: 8,                                       // 定力浮動行程 ±8 mm（吸收襯板高低差，示意）
  uv: { wavelength: 405, rate: 1000, lag: 45 },   // UV 線雷射（405 nm 藍紫光，PTFE 次表面散射比紅光小）、取樣 1 kHz、在拖嘴後方約 45 mm（示意）
  window: { width: [8.0, 10.5], height: [2.8, 4.4] },   // 焊道寬度、凸起高度允收範圍 mm（示意，試焊決定）
};
// 模擬：下環縫焊條熔接到 30% 處 UV 線雷射判 NG → 切斷焊條、退出、通知人員 → 人員刨除不良段 30 mm → 復歸後從斷點續焊
export const ROD_NG = { seam: 'C1', u: .3, cut: 30, reason: '熔接寬度不足（疑似未熔合）' };

// ---------------------------------------------------------------- 末端工具（快換盤以下的長度統一為 TOOL_LEN：同一組焊接姿態適用全部工具）
export const TOOL_LEN = 300;
export const TOOLS = [
  { key: 'cam', name: '3D 相機（定位）' },
  { key: 'groove', name: 'CNC 刀頭＋雷射循縫' },
  { key: 'rod', name: '焊條焊槍（5 kgf 下壓＋UV 線雷射）' },
  { key: 'flat', name: '削平刀（刮刀）' },
  { key: 'belt', name: '焊帶焊槍（LHS 21S＋壓輪）' },
  { key: 'thz', name: '兆赫波探頭' },
];
// 進度欄位（每道焊道一組）：s 定位、g 開槽、r 焊條、f 削平（刮平）、b 焊帶、i 檢測
export const FIELD = { scan: 's', groove: 'g', rod: 'r', flat: 'f', belt: 'b', thz: 'i' };

// ---------------------------------------------------------------- 方案
// mount：手臂如何進桶；spin：環縫由誰轉（tank＝桶轉、j1＝手臂 J1 繞圈）；arm：手臂型號；tag：2026-11-11 會議後的定位
export const PLANS = {
  roll: {
    key: 'roll', name: 'A 臥式迴轉＋伸臂', tag: '採用', arm: 'vs068', spin: 'tank', pose: '平焊（焊點永遠在桶底）',
    method: '（2026-11-11 客戶採納）桶臥放在開合式雙環迴轉架上，懸吊 X 軸帶伸臂從人孔伸入，VS-068 裝在伸臂前端（J1 與桶軸同軸）。環縫：手臂不動、桶轉一圈；縱縫：桶把縫轉到正下方，伸臂沿軸向走。全部焊道都是平焊。',
    pros: ['全部平焊，熔融 PFA 不下垂、品質最穩', '設備高度最低（約 3.1 m）', '手臂不繞圈，熱風管與線材不扭轉'],
    cons: ['桶要放倒（天車＋吊帶），迴轉架要配合桶腳', 'VS-068 壁掛安裝需原廠確認', '焊點在桶底，切屑會落在焊道（工序 3 全罩吸屑＋回程吸屑）'],
  },
  dual: {
    key: 'dual', name: 'A2 並排雙工位＋雙臂', tag: '評估', arm: 'vs068', spin: 'tank', pose: '平焊（同 A 案）',
    method: '兩套 A 案的迴轉架與 X 軸伸臂並排（人孔朝同一邊），各一台 VS-068；一組 6 支工具放在橫向穿梭的工具架上，哪一線要換工具就移到哪一線。兩桶同時作業、錯開工序；第 2 線可以先由人員做完前段工序，再由自動線接手（接手前先重新相機定位）。',
    pros: ['同一場地同時處理 2 桶，平均每桶時間約為單臂的一半多', '只多一台手臂、迴轉架、X 軸與穿梭軸；工具與 THz 主機共用一套', '一線停下等人員處理 NG 時，另一線照常作業'],
    cons: ['兩線要用同一支工具時要等（排程錯開、工具與工具架互鎖）', '佔地加寬約 2 m（兩線中心距 2 m）', '控制軟體要做兩線排程與資源互鎖'],
  },
  turntable: {
    key: 'turntable', name: 'B 立式轉台＋升降柱', tag: '參考', arm: 'vs068', spin: 'tank', pose: '橫焊（環縫）、立焊（縱縫）',
    method: '（參考，未採用）桶立放在轉台上（定位四支腳），立柱懸臂帶 X、Z 軸，VS-068 倒吊在短柱下端從人孔垂直伸入。環縫：手臂不動、轉台轉一圈；縱縫：轉台把縫轉到手臂前方，懸臂沿 Z 軸升降。',
    pros: ['桶不必放倒，堆高機直接放上轉台', '手臂不繞圈，管線不扭轉'],
    cons: ['環縫橫焊、縱縫立焊，焊條與焊帶要靠壓力控制成形', '換工具要整支手臂升出人孔，立柱高約 5.4 m（需確認廠房淨高）'],
  },
  cobot: {
    key: 'cobot', name: 'C 移動門架＋協作臂', tag: '參考', arm: 'cobotta', spin: 'j1', pose: '橫焊（環縫）、立焊（縱縫）',
    method: '（參考，未採用）桶留在原地不動，移動式門架推到桶上方定位，COBOTTA PRO 900 倒吊從人孔伸入。環縫由手臂 J1 繞一圈（±270° 範圍內走 360°），縱縫由門架 Z 軸升降。',
    pros: ['不需迴轉設備，一台門架可輪流服務多個桶', '協作臂可與人員近距離作業，便於試焊調參'],
    cons: ['環縫時 J1 轉 360°，熱風管與焊條管要做旋轉管理', '門架高約 5.4 m、焊接位置與 B 相同（橫焊／立焊）'],
  },
};

// 方案比較表（側欄）：數值取自本站模型；投資為相對級距，待報價
export const COMPARE = [
  { k: '定位', roll: '採用', dual: '評估（產能）', turntable: '參考', cobot: '參考' },
  { k: '焊接位置', roll: '全部平焊', dual: '全部平焊', turntable: '環縫橫焊、縱縫立焊', cobot: '環縫橫焊、縱縫立焊' },
  { k: '同時處理', roll: '1 桶', dual: '2 桶（錯開工序）', turntable: '1 桶', cobot: '1 桶' },
  { k: '設備高度', roll: '約 3.1 m（X 軸樑）', dual: '約 3.1 m', turntable: '約 5.4 m（立柱）', cobot: '約 5.4 m（門架），Z 柱升起約 6.9 m' },
  { k: '桶的擺放', roll: '放倒進迴轉架（天車）', dual: '同 A（兩個迴轉架）', turntable: '立放上轉台（天車或堆高機）', cobot: '原地不動' },
  { k: '環縫怎麼轉', roll: '桶轉', dual: '桶轉', turntable: '轉台轉', cobot: '手臂 J1 繞 360°' },
  { k: '手臂', roll: 'VS-068 ×1', dual: 'VS-068 ×2', turntable: 'VS-068（倒吊）', cobot: 'COBOTTA PRO 900（倒吊）' },
  { k: '投資（相對）', roll: '中', dual: '中＋（多一台手臂與一套機構）', turntable: '中高', cobot: '中低' },
  { k: '主要風險', roll: '迴轉架要配合桶腳', dual: '搶工具時的等待、兩線排程軟體', turntable: '橫焊／立焊成形、廠房淨高', cobot: '橫焊／立焊成形、門架高度與穩定' },
];

// ---------------------------------------------------------------- 雙工位（A2）
export const DUAL = {
  lineZ: 1000,                                    // 兩線中心各離中線 1000 mm（中心距 2 m）
  // 第 2 線的接手點：all＝全部自動；rod／belt＝人員已做完前段工序，自動線從該工序接手（接手前一律先相機重新定位）
  handoffs: { all: '全部自動', rod: '人員做完開 V 槽，自動線從焊條熔接接手', belt: '人員做完削平，自動線從焊帶熔接接手' },
  handoff: 'rod',
};

// ---------------------------------------------------------------- 各工序 NG／錯誤的排除機制（2026-11-11 客戶反饋：每個工序都要有排除機制並通知人員接手）
// 共同：停止該線動作 → 安全退出（必要時切斷焊條）→ 三色燈＋蜂鳴＋HMI 顯示工序、焊道、位置與照片 → 推播通知 → 人員處理後按復歸 → 從斷點或該道焊道重來
export const NG_HANDLING = [
  { step: '上料定位', detect: '夾緊到位、迴轉架編碼器、桶腳避讓', ng: '夾緊未到位、桶軸偏心過大', auto: '不啟動迴轉，維持吊帶', human: '重新吊放、調整夾墊' },
  { step: '相機定位', detect: '3D 點雲品質、焊道中心線擬合殘差', ng: '找不到焊道、板邊高低差超出允收', auto: '重掃一次，仍失敗就退出', human: '確認襯板貼合，必要時人工標記或修板' },
  { step: '開 V 槽', detect: '雷射循縫偏差、主軸負載、靠模切深、吸屑負壓', ng: '偏差 > 1 mm、主軸過載、負壓不足', auto: '主軸停止、抬刀、退出', human: '檢查刀具與吸屑管、清理切屑後續開' },
  { step: '焊條熔接', detect: 'UV 線雷射（焊道寬度、高度、連續性）、熱風溫度、下壓力、送料', ng: '寬度或高度超出範圍、熔接中斷、溫度或壓力異常', auto: '停止送料與行走、切斷焊條、熱風轉待機、退出', human: '刨除不良段、檢查焊條與溫度，復歸後從斷點續焊' },
  { step: '削平', detect: '雷射輪廓（削平後平整度）、吸屑負壓', ng: '殘留凸起或削過頭', auto: '殘留就補削一趟；過切就停止', human: '過切處改人工補修' },
  { step: '焊帶熔接', detect: '熱風溫度、壓輪壓力、焊帶張力與剩餘量、2D 外觀', ng: '焊帶斷料、偏移、溫度異常', auto: '停止、切斷焊帶、退出', human: '換料或補焊後復歸' },
  { step: '兆赫波檢測', detect: '回波波形（多餘回波、覆蓋厚度、交界回波）', ng: '氣孔、未熔合、覆蓋不足', auto: '記錄位置與波形，整桶掃完後通知', human: '人工補修（刨除 → 補焊條 → 削平 → 焊帶），自動複檢' },
  { step: '共通', detect: '手臂力矩監視、快換盤鎖定與工具 ID、氣壓、桶內溫度、急停與光柵', ng: '碰撞、工具錯誤、氣壓或溫度異常', auto: '該線停止（熱風轉待機、不斷氣）', human: '排除後由人員確認復歸' },
];

// ---------------------------------------------------------------- 檢測方案比較（2026-11-11 客戶反饋：兆赫波保留，另評估視覺影像與雷射檢測）
export const INSPECTION = [
  { k: '兆赫波（THz，保留）', sees: '焊層內的氣孔、未熔合、覆蓋厚度（看得到內部）', misses: '光斑小，30 mm 焊帶要橫向掃；看不到表面顏色', speed: '約 0.6 m/min（假設）', cost: '400～1,000 萬（系統）', use: '內部品質：全檢或抽檢（送樣後決定）' },
  { k: '2D 視覺影像', sees: '表面焦黑變色、破孔、焊帶偏移、邊緣翹起、異物；影像存檔', misses: '內部氣孔、未熔合、厚度', speed: '快（可隨焊帶工具同步取像）', cost: '30～80 萬', use: '外觀全檢與追溯影像' },
  { k: '雷射輪廓（線雷射 3D）', sees: '焊道寬度與高度、凹陷、溢料、削平平整度、V 槽深度', misses: '內部缺陷', speed: '快（1 kHz 以上）', cost: '30～60 萬／頭', use: '在線監控（工序 3、4、5）與外形全檢；PTFE 用藍光／UV 波長' },
  { k: '火花測試（現行）', sees: '貫穿到金屬的針孔', misses: '未貫穿的氣孔、未熔合', speed: '人工', cost: '既有', use: '出貨前保留' },
];

// ---------------------------------------------------------------- 動畫節奏（秒；實際工時另依 PROCESS.speed 計算）
export const DEMO = { circ: 4.5, long: 1.8, enter: 2, change: 1.1, approach: .75, plan: 2 };

// 實際工時估算（分鐘）：每道製程走完全部焊道＋每次換工具與進出 3 分鐘（假設）
// 開 V 槽另加回程吸屑（PROCESS.clean m/min）
export function cycleEstimate(seams = SEAMS) {
  const total = seams.reduce((a, s) => a + seamLength(s), 0) / 1000;      // m
  const rows = PROCESS.map(p => ({ key: p.key, name: p.name + (p.clean ? '（含回程吸屑）' : ''), min: total / p.speed + (p.clean ? total / p.clean : 0) + 3 }));
  return { metres: total, rows, sum: rows.reduce((a, r) => a + r.min, 0) + 20 };   // ＋20 分上下料與定位
}

// 雙工位產能估算（分鐘）：兩線各自依序做完自己的工序；同一支工具同時只給一線用，工具架一次只服務一線（取、還各佔 rack 分）。
// 兩線連續生產、共 n 桶；事件式模擬：每次推進時間最早的那一線，先到先用（與動畫的排程規則相同）。
// 第 2 線依 handoff 從某工序接手時，前段由人員在線外做完、不佔自動線（接手前仍先相機定位）。回傳平均每桶時間與甘特資料。
export function dualEstimate(seams = SEAMS, { n = 8, handoff = 'all', rack = 1.5, load = 10, offset = 0 } = {}) {
  const est = cycleEstimate(seams), min = Object.fromEntries(est.rows.map(r => [r.key, r.min - 3]));
  const from = handoff === 'all' ? 0 : Math.max(0, PROCESS.findIndex(p => p.key === handoff));
  const plan = line => PROCESS.filter((p, i) => line === 0 || i === 0 || i >= from);
  const toolFree = {}, bars = [];
  let rackFree = 0, made = 0;
  const L = [0, 1].map(line => ({ line, t: line ? offset : 0, tank: line, k: -1, steps: plan(line) }));
  const held = {};                                                        // 工具在哪一線手上
  while (made < n) {
    const ready = L.filter(c => !(c.k >= 0 && c.k < c.steps.length && held[c.steps[c.k].tool] != null && held[c.steps[c.k].tool] !== c.line));
    const c = ready.reduce((a, b) => (b.t < a.t ? b : a));
    if (c.k < 0) { bars.push({ line: c.line, tank: c.tank, key: 'load', start: c.t, end: c.t + load }); c.t += load; c.k = 0; continue; }
    if (c.k >= c.steps.length) {
      bars.push({ line: c.line, tank: c.tank, key: 'unload', start: c.t, end: c.t + load }); c.t += load;
      made++; c.tank += 2; c.k = -1; continue;
    }
    const p = c.steps[c.k];
    if (!c.has) {                                                          // 取工具：等工具與工具架都空出
      const s0 = Math.max(c.t, toolFree[p.tool] ?? 0, rackFree);
      if (s0 > c.t) { c.t = s0; continue; }                               // 先讓另一線推進到這個時間
      rackFree = c.t + rack; c.t += rack; held[p.tool] = c.line; c.has = true;
      const start = c.t; c.t += min[p.key];
      bars.push({ line: c.line, tank: c.tank, key: p.key, start, end: c.t });
      continue;
    }
    const s1 = Math.max(c.t, rackFree);                                    // 還工具：等工具架空出
    if (s1 > c.t) { c.t = s1; continue; }
    rackFree = c.t + rack; c.t += rack; toolFree[p.tool] = c.t; held[p.tool] = null; c.has = false;
    c.k++;
  }
  const span = Math.max(...bars.map(b => b.end));
  return { perTank: span / n, span, n, bars, single: est.sum };
}
