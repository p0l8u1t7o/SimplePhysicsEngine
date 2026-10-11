// 水五金外觀 AOI 檢測機的配置與尺寸（單位 mm；X 往東、Y 往上、Z 往南＝機台正面，作業員在 +Z 側）。
// 機台：下層機櫃（工控 PC＋GPU、手臂控制器、PLC）＋上層封閉遮光艙（兼安全圍籬）；艙內手臂在中後方，
// 光學艙（U 形條紋屏＋LED 陣列＋相機吊臂）在西側、開口朝東對著手臂；雙工位上料窗在正面東側；3D 掃描器在光學艙開口前方上方。
// 標「假設」的數值待 Phase 0／1 實測或與客戶確認後修正（清單在根目錄 PENDING.md「各站待確認」）。
import { evaluate } from '@core/optics/optics.js';

// ---------------------------------------------------------------- 機台外殼（計畫書附錄 A.1：2400 × 2000 × 2200，示意值）
export const MACHINE = {
  x: [-1200, 1200], z: [-1000, 1000], h: 2250,
  baseH: 800,              // 下層機櫃高（工控 PC、手臂控制器、電控）
  table: 820,              // 艙內工作台面高（台板 20 mm）
  sheet: 2,                // 鈑金厚（示意，畫成 20 mm 板）
};
export const TABLE_Y = MACHINE.table;

// ---------------------------------------------------------------- 手臂（DENSO VM-60B1，13 kg、動作半徑約 1300 mm；使用者 2026-10-11 指定）
// 底座鎖在台面的 16 mm 墊板上，轉 180°（J1 零度朝 −X＝光學艙）：光學艙約 J1 −10°、掃描位約 45°、上料窗約 100～120°，
// 都在 ±170° 內（底座不轉時光學艙正好在 J1 −170° 限位上）。速度：核心模型 JOINT_SPEED 1.8 rad/s。
export const ROBOT = { x: 250, z: -330, y: TABLE_Y + 16, yaw: Math.PI };

// ---------------------------------------------------------------- 光學艙（甜蜜點 S：手臂把受檢區送到這裡）
// 3 片 43 吋直立螢幕（可視區 527 × 937，外框 547 × 957 × 55）排成 U 形，開口朝東；U 上方一圈 8 扇區 LED 陣列；
// 主相機（12 MP＋25 mm，對焦在工件上）在 S 正上方 WD 處朝下，彩色相機在旁邊；全部吊在艙頂的吊臂上。
export const OPTICS = {
  S: [-640, 1320, -170],                  // 甜蜜點（焦平面中心）
  half: 340,                              // U 形內半寬（螢幕可視面到 S 的水平距離；手腕從開口進出要讓開側屏）
  screen: { w: 527, h: 937, bezel: 10, depth: 55, bottom: -390 },   // 可視區；bottom：可視區下緣相對 S.y
  wd: 500,                                // 主相機工作距離（保護玻璃到焦平面）
  ledY: 600,                              // LED 陣列環高度（相對 S.y）
  ledR: [250, 330],                       // LED 環內外半徑
  settle: .3,                             // 每姿態穩定時間（s，計畫書 4.3）
  entry: 330,                             // 進出 U 形屏：在開口外（S 東側 entry mm）對好姿態，沿 +X 直線送入／退出
  capture: { fringe: .075, steps: 8, white: .15 },   // 相移 4 張 × 兩方向（每張 75 ms），再一張擴散白光彩色
};
// 三片條紋屏的可視面（世界座標）：c 中心、n 法向量（朝 S）、u 水平軸、v 向上、hw／hh 半寬半高。
// 背屏在 S 西側 half 處；南北兩片側屏從背屏的角往東（開口側）延伸。cell.js 擺螢幕、planner.js 判斷反射光線打不打得到屏，用同一份。
export function screenRects() {
  const [sx, sy, sz] = OPTICS.S, h = OPTICS.half, { w, h: sh, bottom } = OPTICS.screen, cy = sy + bottom + sh / 2;
  const side = sx - h + 40 + w / 2;                                         // 側屏從背屏前 40 mm 起（讓出背屏外框）
  return [
    { name: 'west', c: [sx - h, cy, sz], n: [1, 0, 0], u: [0, 0, 1], hw: w / 2, hh: sh / 2 },
    { name: 'north', c: [side, cy, sz - h], n: [0, 0, 1], u: [1, 0, 0], hw: w / 2, hh: sh / 2 },
    { name: 'south', c: [side, cy, sz + h], n: [0, 0, -1], u: [1, 0, 0], hw: w / 2, hh: sh / 2 },
  ];
}
// 主相機選型（假設：12 MP 1.1" 3.45 µm、25 mm 鏡頭、F11）→ core/optics 計算視野、每像素、最小缺陷、景深；規劃器用景深與視野
export const CAMERA_SETUP = {
  camera: { sensorW: 14.13, sensorH: 10.35, pixel: 3.45, hPx: 4096, vPx: 3000, fps: 30, interface: '10GigE', mount: 'C', bits: 10 },
  lens: { type: '定焦', focal: 25, fNumber: 11, fMin: 2, fMax: 16, imageCircle: 17.6, mount: 'C' },
  scene: { wd: OPTICS.wd + 25, target: { w: 80, h: 80, heightRange: 30 }, defect: .3, pxPerDefect: 3, cocPx: 2, taktS: 120, imagesPerCycle: 270 },
};
export const CAMERA_EVAL = evaluate(CAMERA_SETUP);
const D = CAMERA_EVAL.derived;
// 規劃器用的量測條件：視野（mm，取整）、景深（±半景深）、入射角上限
export const MEASURE = {
  fov: D.fov.map(v => Math.floor(v)),
  dof: Math.floor(D.dof),
  mmPerPx: D.mmPerPx,
  maxIncidence: 65,                         // 視線與表面法向量夾角上限（度）
};

// ---------------------------------------------------------------- 3D 結構光掃描器（料號辨識＋ICP 對位）：光學艙開口東南側上方，斜向下看掃描位
// 掃描時產品軸往西傾 tilt（法蘭朝上會超過 J5 限位；傾 80° 時 J5 約 84～95°，兩個自轉角都可達，見空間檢核）
export const SCAN = {
  spot: [-300, 1350, 200],                 // 掃描位（產品錨點）
  head: [-120, 1840, 560],                 // 掃描頭（投影機＋雙相機）中心
  tilt: 80,                                // 產品軸傾角（度，往 −X）
};

// ---------------------------------------------------------------- 雙工位上料窗（正面東側，抽屜沿 Z 拉出；左＝西側 L、右＝東側 R）
// 抽屜內側（推入）時定位座中心 z＝nestIn；拉出到機外 z＝nestOut。轉接頭水平躺在 V 形定位座上：快換盤朝 −Z（手臂側），
// 工件往 +Z（作業員側）伸出。上料窗中心離地約 960（計畫書：離地 900）。
export const DRAWER = {
  xs: { L: 360, R: 780 },
  w: 380, len: 620, travel: 640,
  nestIn: 500, nestOffset: -180,           // 定位座在抽屜台板上的位置（相對抽屜中心，往手臂側）
  axisY: TABLE_Y + 150,                    // 轉接頭軸心高
  window: { x: [150, 990], y: [TABLE_Y, 1150] },   // 下緣齊台面，抽屜滑軌與台板從這裡進出
};
export const nestZ = ext => DRAWER.nestIn + ext * DRAWER.travel;

// ---------------------------------------------------------------- 機台外的作業區（作業員、NG 料架、OK 料箱、重工站；示意位置）
export const OPERATOR = { x: 570, z: 1650 };
export const NG_RACK = { x: 1650, z: 1350 };
export const OK_BIN = { x: 1650, z: 1900 };
export const REWORK = { x: 2700, z: 600 };
export const HMI_POS = { x: 570, y: 1430 };         // 操作螢幕（上料窗正上方）

// ---------------------------------------------------------------- 數位空間（產品檔、判定、統計的示意區；不是實體，全部 userData.fx）
export const TWIN = { center: [-2950, 1150, 150], height: 950 };

// ---------------------------------------------------------------- 快換器與轉接頭（尺寸示意；轉接頭依夾持介面分 3～4 種，不依料號）
// 由法蘭往前：快換器主側 Ø90×42 → 轉接頭工具盤 Ø90×16 → 本體 Ø64 → 夾持頭。mount：工件原點（安裝端面中心）在轉接頭座標的 Z。
export const QC = { r: 45, master: 42, plate: 16 };
export const ADAPTERS = {
  mandrel: { name: '內撐式', body: [32, 70], nose: [10.1, 30], mount: 42 + 16 + 70 + 4, kg: 1.4 },     // nose：心軸 Ø20.2、伸入底環上方
  collet: { name: '筒夾式', body: [32, 60], nose: [24, 42], mount: 42 + 16 + 60 + 42 - 30, kg: 1.7 },   // 出水管接管端插入筒夾 30 mm
  pin: { name: '插銷式', body: [32, 60], nose: [8, 25], mount: 42 + 16 + 60 + 2, kg: 1.2 },
};
export const PAYLOAD = { qc: .9, limit: 13 };

// 節拍預算（計畫書：單日 200 件、一班 8 小時、稼動率 85% → 每件約 120 s）
export const TAKT = 120;
