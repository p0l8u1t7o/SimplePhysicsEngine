// 參數與假設：所有可調參數集中在這裡，每一項標出來源。網頁、統一檢查、tools/verify.mjs 都從這裡讀。
//
// 來源分四種：客戶提供／型錄／展示假設／待確認。目前客戶只提供晶圓表面照片與「應用於 AI 伺服器」的背景，
// 晶圓尺寸、厚度、die 尺寸、最小缺陷、節拍、允收規格都沒有；為了能播放先用 300 mm 晶圓與合理的展示值，
// 畫面上一律標「展示假設」，不得寫成客戶規格。值是 null 的參數代表「待確認」，計算結果顯示「待確認」，不當成 0。
//
// 單位：長度 mm（像素尺寸 µm）、時間 s（曝光 ms）、速度 mm/s、加速度 mm/s²、角度度。

export const SOURCE = { customer: '客戶提供', catalog: '型錄', demo: '展示假設', tbd: '待確認', config: '本版配置' };

// group：參數面板分組；min／max：合法範圍（非法時不執行掃描，見 resolveParams）；options：下拉選單
export const PARAMS = {
  // ---- 晶圓
  waferD: { group: '晶圓', label: '晶圓直徑', unit: 'mm', value: 300, src: 'demo', min: 50, max: 300, note: '客戶未提供；為可播放先用 300 mm' },
  waferT: { group: '晶圓', label: '晶圓厚度', unit: 'mm', value: 0.775, src: 'demo', min: 0.05, max: 2, note: '取 300 mm 晶圓常見厚度作示意' },
  edgeExcl: { group: '晶圓', label: '邊緣排除區', unit: 'mm', value: 3, src: 'demo', min: 0, max: 20, note: '排除區內不檢測' },
  dieW: { group: '晶圓', label: 'die 寬（示意圖樣）', unit: 'mm', value: 10, src: 'demo', min: 1, max: 40, note: '照片沒有尺度，die 尺寸未知' },
  dieH: { group: '晶圓', label: 'die 高（示意圖樣）', unit: 'mm', value: 10, src: 'demo', min: 1, max: 40, note: '照片沒有尺度，die 尺寸未知' },
  flatness: { group: '晶圓', label: '晶圓翹曲＋吸附後平面度', unit: 'mm', value: 0.08, src: 'demo', min: 0, max: 2, note: '待實測；決定景深與對焦策略' },
  // ---- 相機（沿用元件庫 P-00035 的型錄值）
  camPx: { group: '相機', label: '像素尺寸', unit: 'µm', value: 2.4, src: 'catalog', min: 0.5, max: 20, note: 'P-00035（20MP、1"）' },
  camH: { group: '相機', label: '水平像素數', unit: 'px', value: 5536, src: 'catalog', min: 256, max: 20000, int: true, note: 'P-00035' },
  camV: { group: '相機', label: '垂直像素數', unit: 'px', value: 3692, src: 'catalog', min: 256, max: 20000, int: true, note: 'P-00035' },
  camBits: { group: '相機', label: '輸出位元深度', unit: 'bit', value: 8, src: 'demo', min: 8, max: 16, int: true, note: '' },
  camIf: { group: '相機', label: '相機介面', unit: '', value: 'GigE', src: 'catalog', options: ['GigE', '2.5GigE', '5GigE', '10GigE', 'CoaXPress'], note: '可用頻寬取 core/optics 的常見實測值' },
  camFps: { group: '相機', label: '感光元件最高幀率', unit: 'fps', value: null, src: 'tbd', min: 1, max: 1000, note: '型錄待確認；未填時只用介面頻寬估算' },
  camBuffer: { group: '相機', label: '相機內部緩衝', unit: '張', value: 2, src: 'demo', min: 1, max: 64, int: true, note: '超過時要等影像傳完才能再曝光' },
  // ---- 鏡頭與照明
  mag: { group: '鏡頭與照明', label: '鏡頭倍率', unit: '×', value: 1, src: 'demo', min: 0.1, max: 20, note: '固定倍率（遠心或顯微）鏡頭，選型待確認' },
  fNum: { group: '鏡頭與照明', label: '有效光圈值', unit: 'F', value: 8, src: 'demo', min: 1, max: 64, note: '算景深用' },
  wd: { group: '鏡頭與照明', label: '工作距離 WD', unit: 'mm', value: 65, src: 'demo', min: 20, max: 300, note: '鏡頭前緣到晶圓表面' },
  dfRingD: { group: '鏡頭與照明', label: '暗場環形光直徑', unit: 'mm', value: 100, src: 'demo', min: 40, max: 300, note: '' },
  dfHeight: { group: '鏡頭與照明', label: '暗場環形光離晶圓高度', unit: 'mm', value: 12, src: 'demo', min: 4, max: 60, note: '低角度；和晶圓、吸盤的間隙要 ≥ 5 mm' },
  // ---- 檢測目標
  defect: { group: '檢測目標', label: '目標最小缺陷', unit: 'mm', value: 0.01, src: 'demo', min: 0.0005, max: 1, note: '客戶未提供；10 µm 為展示值' },
  pxPerDefect: { group: '檢測目標', label: '缺陷需要的像素數', unit: 'px', value: 3, src: 'demo', min: 1, max: 20, note: '幾何取樣條件，不等於保證檢出' },
  taktTarget: { group: '檢測目標', label: '目標整片週期', unit: 's', value: null, src: 'tbd', min: 1, max: 36000, note: '客戶未提供節拍' },
  // ---- 掃描與節拍
  overlap: { group: '掃描與節拍', label: '視野重疊率', unit: '', value: 0.1, src: 'demo', min: 0, max: 0.5, note: '0.1 = 10%' },
  vMax: { group: '掃描與節拍', label: '平台最高速度', unit: 'mm/s', value: 300, src: 'demo', min: 10, max: 2000, note: '' },
  aMax: { group: '掃描與節拍', label: '平台加速度', unit: 'mm/s²', value: 3000, src: 'demo', min: 100, max: 30000, note: '' },
  settle: { group: '掃描與節拍', label: '停穩時間', unit: 's', value: 0.08, src: 'demo', min: 0, max: 2, note: '待實測（平台、吸盤與基座剛性）' },
  expBF: { group: '掃描與節拍', label: '明場曝光', unit: 'ms', value: 0.5, src: 'demo', min: 0.01, max: 500, note: '' },
  expDF: { group: '掃描與節拍', label: '暗場曝光', unit: 'ms', value: 5, src: 'demo', min: 0.01, max: 500, note: '暗場光量低，曝光較長' },
  lightSwitch: { group: '掃描與節拍', label: '明暗場切換', unit: 'ms', value: 1, src: 'demo', min: 0, max: 100, note: '頻閃控制器切換' },
  procImg: { group: '掃描與節拍', label: '演算處理（每張）', unit: 's', value: 0.05, src: 'demo', min: 0.001, max: 10, note: '假設值；與取像並行' },
  procThreads: { group: '掃描與節拍', label: '處理並行數', unit: '', value: 2, src: 'demo', min: 1, max: 32, int: true, note: '' },
  afPoints: { group: '掃描與節拍', label: '對焦點數', unit: '點', value: 5, src: 'demo', min: 3, max: 25, int: true, note: '建立對焦平面' },
  afTime: { group: '掃描與節拍', label: '每點對焦時間', unit: 's', value: 0.6, src: 'demo', min: 0.05, max: 10, note: 'Z 掃描找最清楚的位置' },
  reviewImgs: { group: '掃描與節拍', label: '複檢每處取像張數', unit: '張', value: 3, src: 'demo', min: 1, max: 20, int: true, note: '明場、暗場、Z 偏移各一張' },
  compactRows: { group: '掃描與節拍', label: '精簡模式掃描列數', unit: '列', value: 3, src: 'config', min: 1, max: 20, int: true, note: '只掃中央幾列；其餘標「展示略過」' },
};
export const IMAGES_PER_POS = 2;      // 每個位置明場、暗場各一張（本版配置）

// 情境：缺陷是固定資料（不用亂數），每次播放相同。A 真值只在這裡；演算法（inspection-sim.js 的 detect）只拿得到影像。
// 座標是晶圓座標（mm，中心為原點，x 向右、y 向上＝世界 −Z），長度 mm。寬度、半徑是「真值」；模擬影像會依示意放大到看得見。
export const SCENARIOS = {
  clean: { label: '無注入缺陷', note: '只有正常圖樣與雜訊；演算法不應產生候選', defects: [] },
  line: {
    label: '線狀表面異常', note: '對應照片中的疑似暗線：只稱「疑似線狀表面異常」，不判定為裂紋',
    defects: [
      { id: 'A1', kind: 'line', a: [-41.0, 2.5], b: [-12.5, 9.8], width: 0.006, bf: 0.5, df: 0.5, beads: 29, note: '斜穿區塊的細暗線，線上斷續暗點（示意）' },
      { id: 'A2', kind: 'line', a: [55.25, -0.3], b: [56.35, -1.4], width: 0.004, bf: 0.6, df: 0.4, beads: 5, note: '栗紅墊片內的細暗斜線（示意）' },
      { id: 'A3', kind: 'particle', at: [55.45, -1.1], r: 0.018, bf: 0.5, df: 0.55, note: '暗線旁的小暗點（示意）' },
    ],
  },
  particle: {
    label: '顆粒／污染示意', note: '五顆示意顆粒，其中一顆低對比（用來示範漏檢）',
    defects: [
      { id: 'A1', kind: 'particle', at: [-18.0, 6.5], r: 0.02, bf: 0.45, df: 0.7 },
      { id: 'A2', kind: 'particle', at: [31.0, -3.5], r: 0.015, bf: 0.55, df: 0.6 },
      { id: 'A3', kind: 'particle', at: [-77.0, 8.5], r: 0.03, bf: 0.4, df: 0.8 },
      { id: 'A4', kind: 'particle', at: [96.0, 9.0], r: 0.012, bf: 0.6, df: 0.5 },
      { id: 'A5', kind: 'particle', at: [4.0, -10.5], r: 0.008, bf: 0.95, df: 0.06, note: '低對比，示範 SIM 漏檢' },
    ],
  },
  defocus: {
    label: '失焦／照明不足', note: '局部翹曲超出景深、局部反光偏暗：影像品質不足的位置判「待複檢」，不判良品',
    defects: [
      { id: 'A1', kind: 'warp', at: [-60.0, 6.0], r: 22, h: 0.32, note: '局部翹曲 0.32 mm（對焦平面沒取到）' },
      { id: 'A2', kind: 'dim', at: [70.0, 2.0], r: 14, gain: 0.65, banded: true, note: '客戶拍攝條件示意：上方暗帶、下緣漸暗；非預設同軸光結果' },
      { id: 'A3', kind: 'drop', at: [20.0, -4.0], ch: ['DF'], note: '一張暗場影格傳輸逾時（缺圖示意）' },
    ],
  },
};

// 本機參考照片的人工標記（C）：客戶照片裡的紅色箭頭是人畫的，不是演算法結果。位置是照片像素座標的大約位置。
export const PHOTO_NOTES = [
  { file: 'messageImage_1793703272665.jpg', size: [1904, 937], marks: [{ at: [575, 345], text: '客戶紅色箭頭：疑似線狀異常（人工標記）' }] },
  { file: 'messageImage_1793703638600.jpg', size: [1068, 926], marks: [{ at: [720, 265], text: '客戶紅色箭頭：疑似斜向暗線（人工標記）' }] },
];

// ---------------------------------------------------------------- 機台配置（mm；X 往東、Y 往上、Z 往南＝操作側）
// 晶圓座標 (x, y) 對世界：x → +X、y → −Z。光軸固定在世界 (0, ·, 0)；平台把晶圓上的 (x, y) 移到光軸下時，晶圓中心在世界 (−x, ·, +y)。
export const LAYOUT = {
  frame: { w: 1300, d: 1100, h: 760 },                  // 鋼構機架（含下方電控櫃）
  iso: { h: 60 },                                      // 被動避震墊
  granite: { w: 1100, d: 1000, h: 150 },               // 花崗岩平台（元件庫 P-00195）
  yStage: { len: 900, w: 560, h: 60, carL: 480, carH: 30 },   // Y 軸（沿世界 Z）
  xStage: { len: 760, w: 380, h: 45, carL: 400, carH: 30 },   // X 軸（沿世界 X），裝在 Y 滑座上
  theta: { r: 160, h: 35 },                            // θ 微調台
  chuck: { r: 155, h: 20 },                            // 真空吸盤（多孔陶瓷＋鋁環）
  load: { z: 210 },                                    // 取放片位：平台把晶圓中心送到世界 z = +210（靠操作側）
  bridge: { x: 480, z: -190, colW: 110, colD: 130, top: 1660, beamH: 150 },   // 固定龍門：柱在 x = ±480（避開 X 軸底座的行程）
  hood: { x: 600, z0: -520, z1: 540, top: 1830 },       // 遮光外罩
  travel: { x: 175, zMin: -175, zMax: 225 },           // 平台行程（晶圓座標 → 平台位移的範圍）
};
export const Y = (() => {                               // 各層高度
  const L = LAYOUT, g = L.frame.h + L.iso.h, gTop = g + L.granite.h;
  const yTop = gTop + L.yStage.h + 4 + L.yStage.carH, xTop = yTop + L.xStage.h + 4 + L.xStage.carH;   // core linearAxis：滑座離底座 4 mm
  const thTop = xTop + L.theta.h, chuckTop = thTop + L.chuck.h;
  return { graniteBottom: g, graniteTop: gTop, yTop, xTop, thetaTop: thTop, chuckTop, waferTop: chuckTop };   // waferTop：晶圓底面（＝吸盤頂面）
})();

// ---------------------------------------------------------------- 參數解析與檢核
const num = v => v === null || v === undefined || v === '' ? null : Number(v);
// over：{ 參數名: 值 }（網址參數或測試傳入）。回傳 { p, src, errors, notes }：
//   errors 非空時是「非法參數」：不執行掃描，估算結果全部顯示待確認（project.plan.valid = false）。
export function resolveParams(over = {}) {
  const p = {}, src = {}, errors = [];
  for (const [k, d] of Object.entries(PARAMS)) {
    const given = Object.prototype.hasOwnProperty.call(over, k);
    let v = given ? over[k] : d.value;
    src[k] = given ? 'user' : d.src;
    if (d.options) {
      if (!d.options.includes(v)) { errors.push(`${d.label}：「${v}」不是可選的值`); v = d.value; }
      p[k] = v; continue;
    }
    v = num(v);
    if (v === null) { p[k] = null; continue; }      // 待確認：保留 null
    if (!Number.isFinite(v)) { errors.push(`${d.label}：不是數字`); p[k] = null; continue; }
    if (v < d.min || v > d.max) errors.push(`${d.label}：${v} ${d.unit} 超出合理範圍 ${d.min}～${d.max}`);
    if (d.int && !Number.isInteger(v)) errors.push(`${d.label}：要整數`);
    p[k] = v;
  }
  // 交叉檢核
  if (p.waferD != null && p.edgeExcl != null && p.edgeExcl * 2 >= p.waferD) errors.push('邊緣排除區太大：沒有可檢測區域');
  if (p.dfHeight != null && p.wd != null && p.dfHeight >= p.wd - 5) errors.push('暗場環形光高度要低於鏡頭前緣（WD）至少 5 mm');
  return { p, src, errors };
}
export const srcLabel = s => s === 'user' ? '使用者修改' : SOURCE[s] || s;
// 計算需要的參數缺值（null）時回傳缺少的項目名稱
export const missingOf = (p, keys) => keys.filter(k => p[k] == null).map(k => PARAMS[k].label);
