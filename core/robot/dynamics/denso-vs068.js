// DENSO VS-068 的動力學參數（core/robot/dynamics.js 用；2026-11-07 由原型 TEMP/mujoco-proto 移入）。
// 座標與關節定義和 core/models/robots/denso-vs068.js 完全相同：局部 +Y 朝上、原點在基座底面中心，長度 mm；
// j1 繞 Y、j2／j3／j5 繞 Z、j4／j6 繞 X；arm.q（rad）直接就是 MuJoCo 的 qpos（零點、正向都相同）。
//
// 質量與慣量：DENSO 未公開各連桿質量。以下用外觀幾何（與 3D 模型同尺寸的方塊／圓柱）配上估計質量，
// 由 MuJoCo 依幾何算質心與慣量 —— 全部是「示意」值，只適合做相對比較與量級評估，正式評估要換成廠商提供的值。
// 本體總重取約 46 kg（固定基座 15 kg＋可動 30.9 kg），示意；請以 DENSO 型錄核對本體質量。

// 一塊幾何：box size 是全長 [x, y, z]（mm）；cyl 是 { r, h, axis: 'x'|'y'|'z' }；pos（mm，相對該連桿座標）；mass（kg，示意）
export const VS068_DYNAMICS = Object.freeze({
  id: 'denso-vs068',
  joints: ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'],
  base: [   // 固定基座（不影響關節扭矩，只為完整；示意 15 kg）
    { cyl: { r: 100, h: 200, axis: 'y' }, pos: [0, 100, 0], mass: 15 },
  ],
  links: [
    { joint: 'j1', axis: [0, 1, 0], pos: [0, 200, 0], geoms: [            // 旋轉座：外殼＋J2 馬達與減速機（示意 12 kg）
      { box: [150, 150, 170], pos: [0, 70, 0], mass: 9 },
      { cyl: { r: 72, h: 190, axis: 'z' }, pos: [0, 145, 0], mass: 3 },
    ] },
    { joint: 'j2', axis: [0, 0, 1], pos: [0, 145, 0], geoms: [            // 上臂：臂身＋肘部 J3 馬達（示意 9 kg）
      { box: [100, 340, 110], pos: [0, 170, 0], mass: 7 },
      { cyl: { r: 58, h: 112, axis: 'z' }, pos: [0, 340, 0], mass: 2 },
    ] },
    { joint: 'j3', axis: [0, 0, 1], pos: [0, 340, 0], geoms: [            // 前臂：J3 輪轂＋前臂殼（含 J4 馬達；示意 6 kg）
      { cyl: { r: 55, h: 150, axis: 'z' }, pos: [0, 0, 0], mass: 1.5 },
      { box: [250, 80, 90], pos: [95, 0, 0], mass: 4.5 },
    ] },
    { joint: 'j4', axis: [1, 0, 0], pos: [220, 0, 0], geoms: [            // 手腕 1：內含 J5／J6 馬達（示意 2.5 kg）
      { cyl: { r: 42, h: 120, axis: 'x' }, pos: [60, 0, 0], mass: 2.5 },
    ] },
    { joint: 'j5', axis: [0, 0, 1], pos: [120, 0, 0], geoms: [            // 手腕 2（示意 1.2 kg）
      { cyl: { r: 38, h: 96, axis: 'z' }, pos: [0, 0, 0], mass: 0.6 },
      { box: [70, 62, 62], pos: [35, 0, 0], mass: 0.6 },
    ] },
    { joint: 'j6', axis: [1, 0, 0], pos: [70, 0, 0], geoms: [             // 法蘭（示意 0.15 kg）
      { cyl: { r: 32, h: 10, axis: 'x' }, pos: [5, 0, 0], mass: 0.15 },
    ] },
  ],
  // 工具安裝座（arm.tool）：j6 座標 x = 10 mm，繞 Y 轉 +90°（工具 +Z = j6 +X、工具 +X = j6 −Z、工具 +Y = j6 +Y）
  tool: { pos: [10, 0, 0], quat: [Math.SQRT1_2, 0, Math.SQRT1_2, 0] },
  // 馬達轉子慣量折算到關節側（armature，kg·m²）：轉子慣量 × 減速比²，示意值（典型 AC 伺服＋諧波減速機的量級）
  armature: { j1: 0.4, j2: 0.4, j3: 0.2, j4: 0.05, j5: 0.05, j6: 0.02 },
  rating: {
    // 型錄：最大可搬重量 7 kg（VS-068 型錄值；需核對）
    payload: 7,
    // 型錄：手腕容許力矩（N·m）與容許慣性力矩（kg·m²），DENSO VS 系列 VS-068／087 型錄值（記憶值，需以型錄核對）
    moment: { j4: 16.6, j5: 16.6, j6: 9.4 },
    inertia: { j4: 0.47, j5: 0.47, j6: 0.15 },
    // 關節側最大扭矩（N·m）：廠商未公開，以下為估計 —— J1～J3 取同級（7 kg 級）手臂常用諧波減速機的重複峰值扭矩量級，
    // J4～J6 取手腕容許力矩 ×2.5（動態峰值餘量）。只當「量級」門檻，超過 80% 就該向廠商確認。
    torque: { j1: 200, j2: 280, j3: 140, j4: 40, j5: 40, j6: 24 },
    // 型錄最高速度（rad/s）：J1 356、J2 303、J3 379、J4 475、J5 475、J6 760 °/s（與 denso-vs068.js 的註解相同）
    speed: { j1: 6.21, j2: 5.29, j3: 6.61, j4: 8.29, j5: 8.29, j6: 13.26 },
  },
  sources: [
    '連桿長度、關節軸、限位、速度：core/models/robots/denso-vs068.js（DENSO VS-068 型錄）',
    '最大可搬重量、手腕容許力矩與慣量：DENSO VS 系列型錄（需核對）',
    '連桿質量、慣量、armature、J1～J6 扭矩上限：估計（示意）',
  ],
});
