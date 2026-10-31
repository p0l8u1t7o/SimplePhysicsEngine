// 場地與設備配置的唯一資料來源：模型、動畫、空間檢核與 tools/verify.mjs 共用。
// 座標單位 mm；X 向東、Y 向上、Z 向南；原點為填裝區（原洗桶區）西北角內牆面。
// 填裝區尺寸取自 docs/場地圖.jpg 的標註（1256、455＋540＋557 cm）；未標註的位置（柱、門、更衣室）
// 依圖面比例量測，誤差約 ±300 mm，施工前須現場丈量。清洗區、道路、倉庫依 2026-10-30 手稿推估（無廠域圖）。
//
// 清洗線沿用原本已驗證的「邏輯座標」（原洗桶區內的配置），再用三個框架放到清洗區：
//  · front：棧板站、龍門、橫躺輸送、貼標、翻桶機，整段平移
//  · cell ：立放輸送、開蓋、清洗手臂、沖洗站、秤重、圍籬，整段旋轉 180° 後平移（流向由往南改成往北）
//  · util ：廢液槽、泵與防溢堤，整段平移到清洗區東北角
// 手臂軌跡、夾持與局部干涉檢查都在 cell 的邏輯座標內做，結果與搬移前相同。

// 200 L 閉口 HDPE 桶（雙 L 環），2" 與 3/4" 螺塞在桶頂同一直徑兩端
import { DRUM } from '@core/models/drum-200l.js';   // 200 L 桶規格與模型在共用模型庫
export { DRUM };

// ================================================================ 框架
export const FRAME = {
  front: { x: 10160, z: 3050, rot: false },
  cell: { x: 32740, z: 22450, rot: true },    // 世界 = (x − 邏輯 x, z − 邏輯 z)
  util: { x: 19000, z: -9050, rot: false },
};
export const toWorld = (f, x, z) => { const F = FRAME[f]; return F.rot ? [F.x - x, F.z - z] : [x + F.x, z + F.z]; };
export const fromWorld = (f, x, z) => { const F = FRAME[f]; return F.rot ? [F.x - x, F.z - z] : [x - F.x, z - F.z]; };
export const frameYaw = f => FRAME[f].rot ? 180 : 0;
// 矩形 [x0, z0, x1, z1, …] 換到世界座標（其餘欄位照抄）
export const rectToWorld = (f, r) => { const [ax, az] = toWorld(f, r[0], r[1]), [bx, bz] = toWorld(f, r[2], r[3]); return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), ...r.slice(4)]; };

// ================================================================ 填裝區（原洗桶區）
export const ROOM = { W: 12560, D: 15520, H: 4500, wall: 200 };

// 內牆輪廓（俯視）：更衣室由西側凸入，西南角向西延伸。
export const OUTLINE = [
  [0, 0], [12560, 0], [12560, 15520], [-2480, 15520], [-2480, 11190],
  [620, 11190], [620, 8520], [1770, 8520], [1770, 4700], [0, 4700],
];

// 門：swing 為門扇開啟掃過的區域（不得放設備）
export const DOORS = [
  { id: 'D3', x0: 1860, x1: 2830, z: 0, dir: 1, note: '北牆門，往填裝區內開' },
  { id: 'D2', x0: 230, x1: 1030, z: 4700, dir: -1, note: '更衣室門，往填裝區開' },
];
export const doorSwing = d => [d.x0, Math.min(d.z, d.z + d.dir * (d.x1 - d.x0)), d.x1, Math.max(d.z, d.z + d.dir * (d.x1 - d.x0))];

// 結構柱（圖面量測，800 mm 見方）
export const COLUMN = { x: 8300, z: 5200, size: 800 };
export const columnRect = () => [COLUMN.x - COLUMN.size / 2, COLUMN.z - COLUMN.size / 2, COLUMN.x + COLUMN.size / 2, COLUMN.z + COLUMN.size / 2];

// ================================================================ 清洗區、道路、倉庫（世界座標）
// 清洗區緊鄰填裝區東牆（共用牆厚 200）；寬 13.5 m 放得下整條清洗線與手臂圍籬
export const CLEAN = { x0: 12760, x1: 26260, z0: 0, z1: 15520, H: 4500 };
export const CLEAN_OUTLINE = [[CLEAN.x0, CLEAN.z0], [CLEAN.x1, CLEAN.z0], [CLEAN.x1, CLEAN.z1], [CLEAN.x0, CLEAN.z1]];
export const ROAD3 = { z0: 16520, z1: 19520, x0: -9000, x1: 58000 };   // 東西向 3 m 道路（手稿）
ROAD3.zc = (ROAD3.z0 + ROAD3.z1) / 2;
export const ROAD5 = { x0: 27260, x1: 32260, z0: -4000, z1: 21500 };   // 南北向 5 m 道路（手稿「馬路」），往南接倉庫門
ROAD5.xc = (ROAD5.x0 + ROAD5.x1) / 2;
export const WAREHOUSE = { x0: 24000, x1: 54000, z0: 21500, z1: 41500, H: 5000, door: [27760, 31760] };   // W 30 × L 20 × H 5 m
// 牆面開口（z 為牆內面；y1 為開口頂）：填裝區南牆兩樘捲門、清洗區南牆 AGV 捲門、共用牆輸送口
export const OPENINGS = {
  fillA: { wall: 'fillS', x0: -2150, x1: 2200, y1: 2800, name: '填裝區南牆捲門（A～C 組板位）' },
  fillB: { wall: 'fillS', x0: 2300, x1: 5200, y1: 2800, name: '填裝區南牆捲門（D 組板位、空棧板位）' },
  clean: { wall: 'cleanS', x0: 12960, x1: 15960, y1: 2800, name: '清洗區南牆 AGV 捲門' },
  conveyor: { wall: 'shared', z0: 1170, z1: 2270, y1: 1500, name: '共用牆輸送口' },
};

// ================================================================ 桶、棧板、AGV
export const PALLET = {
  W: 1200, H: 150,
  // 2×2 擺放（棧板局部座標）
  slots: [[-300, 300], [-300, -300], [300, 300], [300, -300]],
};
// 待洗棧板在棧板站朝向 0°（AGV 由南駛入）；依此順序先取東側兩桶，西側兩桶取料時不必越過其他桶
export const DIRTY_ORDER = [3, 2, 1, 0];

// 平衡重式堆高 AGV（局部座標：+X 前進，原點為前輪軸中心，迴轉中心）
// 方位 yaw（度）：前進方向 (cos yaw, −sin yaw)；0 朝東、90 朝北、180 朝西、270 朝南
export const AGV = {
  rear: 1550, halfW: 500, mast: [220, 350], fork: [350, 1500], forkHalf: 350, palletX: 950,
  travel: 300, mastLowered: 2100, backrest: 1100,
  speed: 1200, slow: 300, turn: 35, lift: 250,
  // 倉庫內充電位（地面接觸式充電板）
  charger: { x: 26600, z: 23400, yaw: 0 },
};
// 迴轉掃掠半徑：取車身後角與棧板前角的最大值
export const agvSweep = loaded => Math.max(Math.hypot(AGV.rear, AGV.halfW), loaded ? Math.hypot(AGV.palletX + PALLET.W / 2, PALLET.W / 2) : Math.hypot(AGV.fork[1], AGV.forkHalf));
// 叉面高度：插入（低於上板 50）／抬起（棧板離地 60）；棧板底 = 叉面 − 120
export const FORK = { entry: 70, lifted: 180, deck: 120 };

// ================================================================ 清洗線（邏輯座標，見檔頭）
// 棧板站＋三軸龍門＋翻轉夾爪（front）；AGV 由南側光柵入口送棧板
export const PALLET_STATION = { x: 3900, z: 9750, stand: 100 };
export const GANTRY = {
  posts: [[3000, 9050], [6600, 9050], [3000, 10350], [6600, 10350]], beamY: 3000,
  hang: 150 + DRUM.H / 2,      // 翻轉軸到桶中心
  safeY: 2200, placeY: 800, home: { x: 4600, z: 9700 },
  jawOpen: 90,                 // 夾爪單側張開行程（mm）
};
GANTRY.pickY = PALLET_STATION.stand + PALLET.H + DRUM.H + 150;

// 橫躺輸送：桶軸沿 X，桶頂朝西、桶底朝東（供翻轉機使用）；水平沙漏形（V 槽）滾輪
export const LYING = { z: 9700, y: 800, x0: 5400, x1: 10000, place: 5900, label: 7700, buffer: 9000, speed: 400, vee: 25 };
LYING.upender = 11000 - DRUM.H / 2;
// 側標貼標站：同一支相機斜拍桶頂端面與桶身上方，先辨識 2" 桶塞方位、轉到定位再貼，貼後讀碼並量標籤相對桶塞的角度。
// angle：標籤中心相對 2" 桶塞的方位（0 = 對齊 2" 桶塞）；tol：允收偏差
export const LABEL = {
  x: LYING.label, standZ: 10560, size: [100, 150], angle: 0, tol: 2,
  cam: { pos: [6750, 1450, 9700], target: [7500, 850, 9700], fov: 50 },   // 西側斜上方約俯 39°，避開龍門翻桶擺動範圍
  rotSpeed: 60,                                                          // 旋轉輥帶桶轉速 °/s
};
// 翻桶機：L 形搖籃以桶底下緣為軸翻 90°
export const UPENDER = { pivot: [11000, LYING.y - DRUM.R, LYING.z] };
// 立放輸送（cell）：翻桶後在邏輯座標往南（世界往北）；手臂在取桶位取下、洗完放回同一條線的下游
export const UPRIGHT = { x: 11000 + DRUM.R, top: LYING.y - DRUM.R, z0: LYING.z, decap: 10800, pick: 12400, place: 13400, handoff: 15000, z1: 15350, speed: 300 };
export const DECAP = { z: UPRIGHT.decap, camY: 2500, safeY: 1750, bin: { x: 11780, z: UPRIGHT.decap }, rail: 760 };   // rail：XY 模組 Z 向導軌距中心線

// 清洗手臂與沖洗站（cell）
export const ROBOT = { x: 9400, z: 12000, name: 'FANUC R-2000iC/165F', grip: 250 + DRUM.R };
export const BOOTH = {
  x0: 8750, x1: 10050, z0: 14050, z1: 15420, h: 2600,
  opening: [8850, 9950, 300, 2450],          // 開口 X0, X1, Y0, Y1（邏輯北面，朝手臂）
  drum: [9400, 1300, 14700], entryZ: 13700,   // entryZ：進站前桶中心，桶身仍在隔間外
  lance: [9600, 14700], lance2: [9200, 14700], lanceUp: 2050, lanceDown: 1620,   // 2" 旋轉噴頭、3/4" 直噴
  funnel: { x0: 8900, x1: 9950, z0: 14150, z1: 15250, y: 650 },
  // 流量（L/min）：2" 旋轉噴頭 60、3/4" 直噴 30；倒液時 3/4" 朝上當通氣口
  flow: { big: 60, small: 30 }, pourS: 3.5, pourNoVentS: 7,
  // 末道倒液後負壓抽乾：2" 噴槍長行程伸到桶底低角（吸口距桶底約 15 mm）；桶身朝 2" 側傾 3°，傾 6° 時直管會碰到桶壁
  suckExt: 2.76, suckTilt: 3, vacS: 6, residualL: .4,
  // 內壁附著水：3/4" 噴槍切換熱風（HB-1，約 70°C 乾燥空氣，低於 HDPE 軟化溫度），2" 吸管在桶底持續負壓，
  // 空氣由 3/4" 進、2" 出，帶走水膜與水氣
  dryS: 30, hotAirC: 70, filmG: 120,
};
// 乾燥驗收：放回位為秤重段，殘水 = 秤重 − 該桶號建檔的空桶重；同型號空桶重差約 ±100 g，故需逐桶建檔
// 頂升秤台：梳齒從滾筒縫隙頂起，把桶托離滾筒後才秤，秤上只有秤台本身（約 10 kg），4 顆 20 kg 荷重元，解析度約 10–15 g
export const WEIGH = { limitG: 100, sec: 1.5, lift: 12, stroke: 27, liftS: .8, resolutionG: 10 };
// 風刀：沖洗站開口兩側，手臂帶桶退出時吹掉桶外表水珠，避免外表水被算進秤重
export const AIR_KNIFE = { sec: 2.6 };

// 手臂負載（R-2000iC/165F）：額定與手腕容許值取型錄等級概略值，採購前以 FANUC 型錄核對
export const PAYLOAD = {
  rated: 165, moment: { j5: 921, j6: 461 }, inertia: { j5: 78.4, j6: 40.2 },
  gripper: { kg: 60, cog: 200 },       // 夾爪估重與重心（距法蘭面 mm）
  residueKg: 2, flangeToJ5: 215,
};
const G = 9.81;
// 依桶內水量估算手腕負載（靜態最不利：法蘭軸水平）
export function payloadAt(waterL, holding = true) {
  const gk = PAYLOAD.gripper.kg, lg = (PAYLOAD.flangeToJ5 + PAYLOAD.gripper.cog) / 1000, ld = (PAYLOAD.flangeToJ5 + ROBOT.grip) / 1000;
  const md = holding ? DRUM.kg + PAYLOAD.residueKg + waterL : 0;
  const h = waterL * 1e6 / (Math.PI * 284 * 284), off = holding && waterL > 0 ? (DRUM.H / 2 - h / 2) / 1000 : 0;   // 水的重心偏離 J6 軸
  const own = md * (3 * (DRUM.R / 1000) ** 2 + (DRUM.H / 1000) ** 2) / 12;
  return {
    kg: gk + md, j5: G * (gk * lg + md * ld), j6: G * (holding ? waterL : 0) * off,
    i5: gk * (lg * lg + .01) + md * ld * ld + own, i6: gk * .03 + own,
  };
}
// 依 J5 力矩、J6 力矩與額定重量反推最大可裝水量
export function maxWaterL() {
  let L = 0; while (L < 200) { const p = payloadAt(L + 1); if (p.kg > PAYLOAD.rated || p.j5 > PAYLOAD.moment.j5 || p.j6 > PAYLOAD.moment.j6 || p.i5 > PAYLOAD.inertia.j5) break; L++; }
  return L;
}

// 手臂圍籬（cell，手臂以 DCS 限制在圍籬內）；原本靠南牆收尾，搬到清洗區後在沖洗站背面（邏輯 Z 15650）補一段封閉
// 北側在 X 8200–10300 往北凸到 Z 10800：手臂朝南時前臂後方馬達組往北擺
export const FENCE = [[7000, 15650], [7000, 11300], [8200, 11300], [8200, 10800], [10300, 10800], [10300, 11300], [11700, 11300], [11700, 13850], [10200, 13850], [10200, 15650], [7000, 15650]];
export const FENCE_GATES = { in: [11000 + DRUM.R, 11300], out: [11000 + DRUM.R, 13850] };   // 立放輸送進出手臂區的開口
export const GANTRY_FENCE = [[2900, 8950], [6700, 8950], [6700, 10550], [2900, 10550]];
export const GANTRY_GATE = [PALLET_STATION.x, 10550];   // AGV 送棧板的入口（邏輯南側，世界也是南側）

// 廢液回收（util）：防溢堤內四槽與兩台泵；酸、鹼殘液依讀到的桶號分流到兩個廢液槽
export const WASTE = {
  bund: [3300, 13950, 7000, 15420], wall: 30,
  tanks: {
    WA: { x: 3950, z: 14690, r: 550, h: 1800, cap: 1600, init: 520, name: 'TK-WA 酸性廢液槽' },
    WB: { x: 5150, z: 14690, r: 550, h: 1800, cap: 1600, init: 380, name: 'TK-WB 鹼性廢液槽' },
    R: { x: 6200, z: 14400, r: 400, h: 1600, cap: 800, init: 380, name: 'TK-R 回收沖洗水槽' },
    F: { x: 6200, z: 15100, r: 280, h: 1500, cap: 350, init: 260, name: 'TK-F 清水暫存槽' },
  },
  pumpRinse: [6830, 14300], pumpDrain: [6830, 14950], rinseL: 20,
};
// 沖洗站與泵之間的跨框架配管接點（cell 邏輯座標，在圍籬外的沖洗站背面上方）
export const PIPE_JOINT = { supply: [9600, 2800, 15800], sump: [8600, 2300, 15800] };

// 清洗線各設備俯視外框（各自框架的邏輯座標）[x0, z0, x1, z1, 高度]
export const CELL_FOOTPRINTS = {
  front: {
    gantry: [2900, 8950, 6700, 10550, 3200],
    lying: [5400, 9300, 10000, 10100, 1100],
    labeler: [7000, 10120, 8000, 10900, 1800],
    upender: [10000, 9250, 11650, 10150, 1500],
  },
  cell: {
    hmi: [8250, 10350, 8650, 10750, 1500],
    upright: [10900, 10150, 11690, UPRIGHT.z1, 700],
    decap: [10600, 10350, 12100, 11250, 2700],
    robot: [8900, 11500, 9900, 12500, 1200],
    booth: [BOOTH.x0, BOOTH.z0, BOOTH.x1, BOOTH.z1, BOOTH.h],
  },
  util: { bund: [...WASTE.bund, 1900] },
};

// ================================================================ 清洗區出口 → 填裝區（世界座標）
// 所有輸送線頂面同高；立放輸送出 cell 後繼續往北，到北側轉角往西穿過共用牆進填裝區
export const CONV = { top: UPRIGHT.top, width: 700, speed: 300 };
const [OUT_X] = toWorld('cell', UPRIGHT.x, 0);
export const OUTFEED = {
  x: OUT_X,                                  // 北段中心線（= 立放輸送中心線）
  z0: toWorld('cell', 0, UPRIGHT.z1)[1],     // 接立放輸送尾端
  corner: 1720,                              // 北側轉角（直角移載）中心 Z
  topLabel: 4800,                            // 頂面貼標站（旋蓋面 3 張）
  topRead: 3500,                             // 貼後讀碼（頂面 2 碼）
};
// 填裝區：分線輸送（沿北側往西）→ 4 條線（往南）→ 集貨輸送（沿南側往西）→ 暫存區組板
export const FILL = {
  distZ: OUTFEED.corner, distX0: 2650,
  lines: [3000, 5200, 7200, 10300], liquids: ['A', 'B', 'C', 'D'],
  // 填裝位：索引 0 為最下游（最南）；桶距 1,450，桶間留約 850 mm 給擦拭人員
  pos: [9950, 8500, 7050, 5600], frame: [4900, 10650], frameHalf: 550, frameY: 2500,
  wipers: [4100, 6200, 8600, 11400],          // 每線 1 人巡迴的走道中心 X
  wipeDx: 760,                                // 擦拭時站到桶旁（線中心 + 760），擦完退回走道
  collectZ: 12450, buttonDz: 500,             // 集貨輸送中心 Z；放行確認鈕在填裝位下游側（人員擦拭時手臂不會掃到）
  reader: 11900,                              // 三碼比對站 X（分線輸送上，進填裝區第一站）
  ng: { x: 10950, z0: 300, box: [10400, 150, 11350, 1250] },   // NG 剔除口在比對站下游，往北推入（可存 1 桶，人工取出重貼）
  fillS: 180, capS: 9, wipeS: 30, lanceS: 3,  // 填裝 3 分鐘／桶（手稿）；鎖蓋扭力每蓋約 4 s
  torque: { big: '2" 桶蓋 扭力達標（模擬）', small: '3/4" 桶蓋 扭力達標（模擬）' },
  tank: [150, 1100, 1600, 3300],              // 料倉（4 種液體供液）[x0, z0, x1, z1]
  pipeZ: 4750, pipeY: 3200,
};
// 暫存區：集貨輸送末端由龍門夾桶，同液體同板（田字型 2×2）；A～D 組板位＋空棧板位，AGV 由南牆捲門進出
export const STAGING = {
  z: 14300, pallets: { A: -1500, B: 0, C: 1500, D: 3000, E: 4500 },
  pick: [-1500, FILL.collectZ],
  gantry: { x0: -2300, x1: 6000, z0: 11800, z1: 15000, beamY: 3300, safeY: 2000 },   // 南側立柱讓開捲門箱
  preload: { A: 1, B: 1, C: 3, D: 2 },        // 動畫開始時各組板位已有的成品桶（先前生產）
};
// 倉庫分區
export const WH_ZONES = {
  dirty: [24500, 25500, 33500, 41000], finished: { A: [34500, 25500, 38500, 41000], B: [39000, 25500, 43000, 41000], C: [43500, 25500, 47500, 41000], D: [48000, 25500, 53500, 41000] },
  aisleZ: 23500,
  drop: { A: { x: 36600, z: 26100 } },        // 成品 A 的卸板點（棧板中心）
  pickDirty: { x: ROAD5.xc, z: 23900 },       // 動畫開始時 AGV 已叉起待洗棧板的位置
};

// 倉庫靜態儲位（建築與 AGV 檢查共用）：回傳 [{ x, z, n }]（n 為桶數）；動畫卸板位留空
export function warehouseStore() {
  const W = WH_ZONES, rows = [26100, 27500, 32500, 33900, 38900, 40300], out = [];
  const cols = (x0, x1) => { const c = []; for (let x = x0 + 700; x + 600 <= x1; x += 1400) c.push(x); return c; };
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (const z of rows) for (const x of cols(W.dirty[0], W.dirty[2])) if (rnd() > .12) out.push({ x, z, n: 4 });
  for (const [k, r] of Object.entries(W.finished)) for (const z of rows) for (const x of cols(r[0], r[2])) {
    if (k === 'A' && Math.abs(x - W.drop.A.x) < 10 && Math.abs(z - W.drop.A.z) < 10) continue;
    if (rnd() > .35) out.push({ x, z, n: 4 });
  }
  return out;
}

// ================================================================ 幾何工具
export function pointInPolygon([x, z], poly = OUTLINE) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export const rectsOverlap = (a, b, gap = 0) => a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap;
export function rectInside(r, poly = OUTLINE) {
  const corners = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  if (!corners.every(p => pointInPolygon(p, poly))) return false;
  return !poly.some(([x, z]) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
}
export function circleRectGap(cx, cz, r, rect) {
  const dx = Math.max(rect[0] - cx, 0, cx - rect[2]), dz = Math.max(rect[1] - cz, 0, cz - rect[3]);
  return Math.hypot(dx, dz) - r;
}
// AGV 車身與前端（棧板或貨叉）的俯視多邊形
export function agvPolygons(x, z, yaw, loaded) {
  const c = Math.cos(yaw * Math.PI / 180), s = Math.sin(yaw * Math.PI / 180);
  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
  return [rect(-AGV.rear, -AGV.halfW, AGV.mast[1], AGV.halfW),
    loaded ? rect(AGV.palletX - PALLET.W / 2, -PALLET.W / 2, AGV.palletX + PALLET.W / 2, PALLET.W / 2) : rect(AGV.fork[0], -AGV.forkHalf, AGV.fork[1], AGV.forkHalf)];
}
// 凸四邊形 vs 軸向矩形（分離軸）
export function polyRectOverlap(poly, r) {
  const axes = [[1, 0], [0, 1]]; for (let i = 0; i < 4; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % 4]; axes.push([-(bz - az), bx - ax]); }
  const rp = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
  return axes.every(([nx, nz]) => { const pa = poly.map(([x, z]) => x * nx + z * nz), pb = rp.map(([x, z]) => x * nx + z * nz); return Math.max(...pa) > Math.min(...pb) + 1e-6 && Math.max(...pb) > Math.min(...pa) + 1e-6; });
}

// 牆（俯視矩形，世界座標，厚 ROOM.wall，開口處斷開）：AGV 動線檢查與建築共用
export function wallRects() {
  const t = ROOM.wall, out = [];
  const run = (name, horiz, at, from, to, gaps = []) => {   // 沿牆切掉開口
    let p = from;
    for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) { if (g0 > p) out.push([name, horiz ? [p, at, g0, at + t] : [at, p, at + t, g0]]); p = g1; }
    if (p < to) out.push([name, horiz ? [p, at, to, at + t] : [at, p, at + t, to]]);
  };
  const fillDoors = Object.values(OPENINGS).filter(o => o.wall === 'fillS').map(o => [o.x0, o.x1]);
  run('填裝區南牆', true, ROOM.D, -2480 - t, ROOM.W, fillDoors);
  run('清洗區南牆', true, CLEAN.z1, CLEAN.x0, CLEAN.x1 + t, [[OPENINGS.clean.x0, OPENINGS.clean.x1]]);
  run('清洗區東牆', false, CLEAN.x1, CLEAN.z0 - t, CLEAN.z1 + t);
  run('填裝區西南牆', false, -2480 - t, 11190, ROOM.D + t);
  run('共用牆', false, ROOM.W, 0, ROOM.D);
  const W = WAREHOUSE;
  run('倉庫北牆', true, W.z0 - t, W.x0 - t, W.x1 + t, [W.door]);
  run('倉庫西牆', false, W.x0 - t, W.z0, W.z1);
  run('倉庫東牆', false, W.x1, W.z0, W.z1);
  run('倉庫南牆', true, W.z1, W.x0 - t, W.x1 + t);
  return out;
}

// 清洗線設備換到世界座標（框架名＋外框）
export function worldFootprints() {
  const out = {};
  for (const [f, list] of Object.entries(CELL_FOOTPRINTS)) for (const [k, r] of Object.entries(list)) out[k] = { room: 'clean', r: rectToWorld(f, r) };
  const c = CONV.width / 2, g = STAGING.gantry;
  Object.assign(out, {
    // 主控盤與手臂控制器在防溢堤北側；酸、鹼清運管（X 22950、24150）由兩者之間往北牆穿過
    panel: { room: 'clean', r: [24700, 3000, 25900, 3600, 2000] },
    robotCtrl: { room: 'clean', r: [23300, 3000, 24040, 3550, 1200] },
    outfeed: { room: 'clean', r: [OUTFEED.x - c, OUTFEED.corner - c, OUTFEED.x + c, OUTFEED.z0, 700] },
    topLabeler: { room: 'clean', r: [OUTFEED.x - 1450, OUTFEED.topLabel - 450, OUTFEED.x + 750, OUTFEED.topLabel + 450, 2300] },
    fillTank: { room: 'fill', r: [...FILL.tank, 2200] },
    reader: { room: 'fill', r: [FILL.reader - 500, FILL.distZ - 650, FILL.reader + 500, FILL.distZ + 650, 1800] },
    ngBox: { room: 'fill', r: [...FILL.ng.box, 900] },
    staging: { room: 'fill', r: [g.x0 - 100, g.z0 - 100, g.x1 + 100, g.z1 + 100, g.beamY + 300] },
  });
  FILL.lines.forEach((x, i) => { out['line' + (i + 1)] = { room: 'fill', r: [x - FILL.frameHalf - 50, FILL.frame[0] - 50, x + FILL.frameHalf + 50, FILL.frame[1] + 50, FILL.frameY + 300] }; });
  return out;
}
// 設計上相接或包含的組合（不算干涉）
export const ALLOWED = [['gantry', 'lying'], ['lying', 'upender'], ['upender', 'upright'], ['upright', 'decap'], ['upright', 'outfeed'], ['outfeed', 'topLabeler']];

// AGV 原地迴轉點（動畫實際使用）
export const AGV_TURNS = [
  { x: ROAD5.xc, z: ROAD3.zc, loaded: true, note: '道路交叉口' },
  { x: 14060, z: ROAD3.zc, loaded: true, note: '清洗區門前' },
  { x: STAGING.pallets.A, z: ROAD3.zc, loaded: true, note: '填裝區 A 組板位門前' },
  { x: STAGING.pallets.E, z: ROAD3.zc, loaded: true, note: '填裝區空棧板位門前' },
  { x: ROAD5.xc, z: WH_ZONES.aisleZ, loaded: true, note: '倉庫主通道' },
];

// ---------------------------------------------------------------- 空間檢核（網頁面板與驗證共用）
export function layoutChecks() {
  const out = [];
  const add = (group, name, ok, value, note = '') => out.push({ group, name, ok, value, note });
  // 場地
  const fp = worldFootprints();
  const rooms = { fill: OUTLINE, clean: CLEAN_OUTLINE };
  const outside = Object.entries(fp).filter(([, f]) => !rectInside(f.r, rooms[f.room])).map(([n]) => n);
  add('配置', '設備都在牆內', !outside.length, outside.length ? outside.join('、') : `${Object.keys(fp).length} 項（清洗區、填裝區）`);
  const keys = Object.keys(fp), clash = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j];
    if (ALLOWED.some(p => p.includes(a) && p.includes(b))) continue;
    if (rectsOverlap(fp[a].r, fp[b].r)) clash.push(`${a}/${b}`);
  }
  for (const [k, f] of Object.entries(fp)) if (rectsOverlap(columnRect(), f.r, 0)) clash.push(`柱/${k}`);
  add('配置', '設備外框互不重疊（含結構柱）', !clash.length, clash.length ? clash.join('、') : '通過');
  for (const d of DOORS) {
    const s = doorSwing(d), hit = Object.entries(fp).find(([, f]) => rectsOverlap(f.r, s, 100));
    add('動線', `${d.id} 門開啟範圍`, !hit, hit ? `與 ${hit[0]} 干涉` : '淨空 ≥ 100 mm');
  }
  const zTop = GANTRY.safeY + 250 + 1300;
  add('配置', '清洗區龍門伸縮 Z 軸頂端', zTop <= CLEAN.H - 300, `${zTop} mm（兩段伸縮）`);
  const sg = STAGING.gantry.beamY + 400;
  add('配置', '暫存區組板龍門頂端', sg <= ROOM.H - 300, `${sg} mm（樓高 ${ROOM.H}）`);
  // 填裝區
  const L = FILL.lines, gaps = L.slice(1).map((x, i) => x - L[i] - 2 * FILL.frameHalf - 100);
  add('填裝', '相鄰兩線填裝架之間的走道', Math.min(...gaps) >= 800, `最窄 ${Math.min(...gaps)} mm（擦拭人員巡迴 ≥ 800）`);
  const pitch = FILL.pos[0] - FILL.pos[1], between = pitch - 2 * DRUM.envelopeR;
  add('填裝', '桶間擦拭站位', between >= 800, `桶距 ${pitch}、桶間淨空 ${between} mm`);
  const stg = Object.values(STAGING.pallets).sort((a, b) => a - b), sgap = Math.min(...stg.slice(1).map((x, i) => x - stg[i] - PALLET.W));
  add('暫存', '組板位間距（AGV 叉取）', sgap >= 250, `相鄰棧板淨距 ${sgap} mm`);
  for (const [k, x] of Object.entries(STAGING.pallets)) {
    const door = Object.values(OPENINGS).find(o => o.wall === 'fillS' && x - PALLET.W / 2 >= o.x0 + 50 && x + PALLET.W / 2 <= o.x1 - 50);
    add('暫存', `${k === 'E' ? '空棧板位' : `${k} 組板位`} 對準南牆捲門`, !!door, door ? `${door.name}（${door.x1 - door.x0} mm）` : '棧板不在任一捲門範圍內');
  }
  // AGV 動線
  const swing = agvSweep(true);
  add('AGV', '3 m 道路上原地迴轉', ROAD3.z1 - ROAD3.z0 >= 2 * swing - 400, `迴轉直徑 ${(2 * swing).toFixed(0)} mm，道路 ${ROAD3.z1 - ROAD3.z0} mm（路肩各外擴約 ${(swing - 1500).toFixed(0)} mm，無障礙物）`);
  const walls = wallRects();
  const pathClear = (pts, loaded) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az, ay] = pts[i - 1], [bx, bz] = pts[i], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 100);
      for (let k = 0; k <= n; k++) for (const poly of agvPolygons(ax + (bx - ax) * k / n, az + (bz - az) * k / n, ay, loaded)) for (const [nm, r] of walls) if (polyRectOverlap(poly, r)) return nm;
    }
    return null;
  };
  const yN = 90, yS = 270;
  for (const [name, pts] of [
    ['清洗區棧板站（載待洗棧板）', [[14060, ROAD3.zc, yN], [14060, toWorld('front', PALLET_STATION.x, PALLET_STATION.z)[1] + AGV.palletX, yN]]],
    ['填裝區 A 組板位（載滿板）', [[STAGING.pallets.A, ROAD3.zc, yN], [STAGING.pallets.A, STAGING.z + AGV.palletX, yN]]],
    ['填裝區空棧板位（載空板）', [[STAGING.pallets.E, ROAD3.zc, yN], [STAGING.pallets.E, STAGING.z + AGV.palletX, yN]]],
    ['倉庫門（載板）', [[ROAD5.xc, ROAD3.zc, yS], [ROAD5.xc, WH_ZONES.aisleZ, yS]]],
  ]) { const hit = pathClear(pts, true); add('AGV', name, !hit, hit ? `碰到${hit}` : '車身與棧板不碰牆、門框'); }
  const [sx] = toWorld('front', PALLET_STATION.x, 0), door = OPENINGS.clean;
  add('AGV', '清洗區捲門寬 vs 棧板', sx - PALLET.W / 2 - door.x0 >= 300 && door.x1 - sx - PALLET.W / 2 >= 300, `門 ${door.x1 - door.x0} mm，棧板兩側各 ${(sx - PALLET.W / 2 - door.x0).toFixed(0)}／${(door.x1 - sx - PALLET.W / 2).toFixed(0)} mm`);
  // 倉庫
  const W = WAREHOUSE, area = (W.x1 - W.x0) * (W.z1 - W.z0) / 1e6;
  const tiers = Math.floor((W.H - 500) / (PALLET.H + DRUM.H + 100));
  add('倉庫', '樓高與堆疊', tiers >= 2, `W 30 × L 20 × H ${W.H / 1000} m（${area} m²）；滿桶棧板可疊 ${tiers} 層（需確認桶與棧板承重）`);
  // 清洗
  const reachDist = (x, z) => Math.hypot(x - ROBOT.x, z - ROBOT.z);
  const far = Math.max(reachDist(UPRIGHT.x - ROBOT.grip, UPRIGHT.pick), reachDist(BOOTH.drum[0], BOOTH.drum[2] - ROBOT.grip), reachDist(UPRIGHT.x - ROBOT.grip, UPRIGHT.place));
  add('清洗', '手臂取放點水平距離', far < 2655 - 215, `最遠 ${far.toFixed(0)} mm（型錄伸展 2655）`);
  const [rx, rz] = toWorld('cell', ROBOT.x, ROBOT.z);
  add('清洗', '手臂伸展範圍在清洗區內', rx + 2655 <= CLEAN.x1 && rz + 2655 <= CLEAN.z1, `東側餘 ${(CLEAN.x1 - rx - 2655).toFixed(0)} mm（DCS 另限制在圍籬內）`);
  const p = payloadAt(WASTE.rinseL), mw = maxWaterL();
  add('清洗', `手臂負載（桶＋${WASTE.rinseL} L 水）`, p.kg <= PAYLOAD.rated && p.j5 <= PAYLOAD.moment.j5 && p.j6 <= PAYLOAD.moment.j6 && p.i5 <= PAYLOAD.inertia.j5,
    `${p.kg.toFixed(0)}/${PAYLOAD.rated} kg、J5 ${p.j5.toFixed(0)}/${PAYLOAD.moment.j5} N·m、J6 ${p.j6.toFixed(0)}/${PAYLOAD.moment.j6} N·m；最多可裝約 ${mw} L`);
  return out;
}
