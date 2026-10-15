// 規格與配置（單位 mm、秒；X 往東、Y 往上、Z 往南）。不依賴 three，網頁、檢查與 tools/verify.mjs 共用。
// 資料來源：docs/ 的現場照片（工件卡尺量測、高低規、出料滑道、廢料坑蓋板）與使用者的需求說明。

// ---------------------------------------------------------------- 節拍
export const RATE = { perMin: 18, cycle: 60 / 18 };          // 沖壓機出料約 1 分鐘 18 顆 → 每顆 3.33 s

// ---------------------------------------------------------------- 工件（規格種類會換：配方切換夾爪指與擺盒格位）
// stator：分割式定子齒（T 形，軛寬 22、齒靴寬 17、全長 22；疊高 45.5 +0.6/−0.4，高低規 GO 46.0／NO-GO 45.2）
// rotor：轉子 Ø42（現場樣品量得高 45.78）；公差待使用者提供，先用 ±0.3 示意
export const PARTS = {
  stator: {
    key: 'stator', name: '分割式定子（31XX）', h: 45.5, tolP: .6, tolN: .4,
    yoke: [22, 5], stem: [9, 13], tip: [17, 4], len: 22, mass: .075,
    grid: { rows: 7, cols: 20, pitch: 20, rowPitch: 30, alt: true },   // 交錯 180° 擺放：軛與齒靴錯開、同列間隙 0.5 mm
    lanePitch: 22.5, fingerGap: 22, open: 34,
  },
  rotor: {
    key: 'rotor', name: '轉子（Ø42）', h: 45.8, tolP: .3, tolN: .3, d: 42, bore: 15, mass: .42,
    grid: { rows: 5, cols: 9, pitch: 46, rowPitch: 46, alt: false },
    lanePitch: 42.5, fingerGap: 42, open: 54,
  },
};
export const capacity = p => p.grid.rows * p.grid.cols;

// 擺盒格位（鐵盒內底面中心為原點；列沿 X、各列沿 Z 排）：{ r, c, x, z, rot }
export function slot(p, i) {
  const g = p.grid, r = Math.floor(i / g.cols), c = i % g.cols;
  return { r, c, x: (c - (g.cols - 1) / 2) * g.pitch, z: (r - (g.rows - 1) / 2) * g.rowPitch, rot: g.alt && c % 2 ? Math.PI : 0 };
}

// 量測值（示意）：每顆的高度由編號決定；固定幾顆超出公差當 NG 示範
const NG = { stator: { 37: .68, 102: -.47 }, rotor: { 12: .41, 31: -.36 } };
export function heightOf(p, i) {
  if (NG[p.key][i] != null) return +(p.h + NG[p.key][i]).toFixed(3);
  const u = Math.sin(i * 12.9898 + (p.key === 'rotor' ? 3.1 : 0)) * 43758.5453, v = Math.sin(i * 78.233 + 1.7) * 12543.13;
  const a = u - Math.floor(u), b = v - Math.floor(v);
  return +(p.h + .08 + (a + b - 1) * .22).toFixed(3);      // 平均偏上 0.08、分布約 ±0.22
}
export const isNG = (p, h) => h > p.h + p.tolP || h < p.h - p.tolN;
export const ngList = p => Array.from({ length: capacity(p) }, (_, i) => i).filter(i => isNG(p, heightOf(p, i)));

// ---------------------------------------------------------------- 量測方案
export const PLANS = {
  'box-laser': {
    key: 'box-laser', mode: 'box', sensor: 'laser', name: '整盒・線雷射',
    short: '整盒翻轉到研磨基準板，懸臂龍門帶線雷射逐列掃描',
    method: '翻盒後工件頂面朝下落在研磨基準板上；線雷射（藍光、Z 重複性 0.4 µm）每趟同時看到工件底面與兩側基準板面，高度＝工件面－基準面',
  },
  'box-vision': {
    key: 'box-vision', mode: 'box', sensor: 'vision', name: '整盒・遠心視覺',
    short: '翻盒到分條基準軌，逐列頂升，遠心相機＋背光側拍輪廓',
    method: '每列工件落在一條研磨基準軌上；該列頂升 60 mm 高出其他列，遠心相機與平行背光沿列掃拍，軌面與工件頂緣在同一張影像裡相減',
  },
  'piece-laser': {
    key: 'piece-laser', mode: 'piece', sensor: 'laser', name: '逐顆・雷射位移',
    short: 'SCARA 逐顆放上量測砧，雙點雷射量頂面、第三點量砧面',
    method: '工件放在研磨碳化鎢砧上；量測頭滑入，兩點量工件頂面、一點量砧面，差值即高度；開班以 45.000 塊規自動校正',
  },
  'piece-vision': {
    key: 'piece-vision', mode: 'piece', sensor: 'vision', name: '逐顆・遠心視覺',
    short: 'SCARA 逐顆放上量測砧，兩組正交遠心相機背光量輪廓高度',
    method: '工件放在砧上，兩組正交的雙遠心相機＋平行背光拍側面輪廓，砧面與工件頂緣在同一張影像中次像素擬合相減',
  },
};

// ---------------------------------------------------------------- 鐵盒（沿用現有不鏽鋼盒；尺寸依照片估計，待現場量測）
export const BOX = { size: [440, 110, 280], wall: 1.2, bottom: 1.5 };

// ---------------------------------------------------------------- 配置
export const LAYOUT = {
  // 沖壓區（現場既有）：沖壓機正面朝南，6 列出料滑道往南伸出
  press: { x: -5200, z: -1400, w: 2800, d: 2000, front: -400, bed: 900, h: 4300 },
  lane: { n: 6, pitch: 80, y: 950, z0: -400, z1: 500, wall: 35 },
  // 廢料坑：沖壓機前方地板下的空洞，上面是可掀的鋼蓋板（接縫下有支撐樑）與一塊落料網格
  pit: { x0: -7200, x1: -3200, z0: -400, z1: 2400, joints: [300, 1000, 1700], seams: [-6200, -5200, -4200], grate: [-6900, -6300, -100, 250] },
  // 自動下料機：可移動底座（腳輪＋調整腳）跨在蓋板支撐樑上，掀蓋清廢料時整台推開
  unloader: {
    scara: { x: -5200, y: 900, z: 900 },
    frame: { x0: -6460, x1: -3940, z0: 780, z1: 1780, top: 640, feetZ: [1000, 1700] },
    conveyor: { z: 1330, top: 848.5, x0: -6420, x1: -3980 },
    slots: [-6160, -5680, -5200, -4720, -4240],       // 空盒 W2、W1、擺盒位、滿盒 E1、E2
    fill: 2,
  },
  // 品檢區（獨立、離沖壓機約 10 m、不在蓋板上）：花崗岩平台＋被動隔振腳
  qc: { x0: 2600, x1: 7800, z0: -2200, z1: 2400, door: [600, 2000], station: { x: 5000, z: 0 }, granite: 900 },
  cart: { deck: 780, size: [700, 480] },
};

// 品檢區流程時間（展示用；整盒方案以真實速度播放，逐顆方案前幾顆真實速度、其餘快轉）
export const CYCLE = {
  unloader: { move: .42, down: .12, grip: .1, place: .1 },
  piece: { laser: 2.6, vision: 2.4 },
};
