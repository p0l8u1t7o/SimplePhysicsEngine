// 整盒量測站（翻盒到基準板）：鐵盒底部不平，所以不在盒內量。
//   1. 基準板座（研磨基準板＋支柱＋框架）倒掛在翻轉臂上，基準板下降壓到工件頂面；側夾夾住鐵盒。
//   2. 繞水平軸翻 180°：工件頂面朝下落在基準板上，基準板座的框架落到花崗岩定位座上、解鎖留下。
//   3. 鐵盒上移離開工件、翻回入料位；工件全部站在同一個研磨基準面上（盒底不平與此無關）。
//   4. 量測：laser＝懸臂龍門帶藍光線雷射逐列掃描（每趟同時看到工件面與兩側基準板面）；
//            vision＝基準板是一列一條的研磨軌，花崗岩上的頂升銷逐列頂起 80 mm，遠心相機＋平行背光沿列側拍。
//   5. NG 由龍門吸盤剔到不良品盒；鐵盒翻回罩住工件、基準板座上鎖、整組翻回，工件落回盒底，基準板座上升。
// 站本地座標：原點在站中心地面；入料位在 +z（作業員側），量測區在 −z，翻轉軸沿 X、在 z=0。
import * as THREE from 'three';
import { block, cylinder, decal } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { tagPart } from '@core/models/parts.js';
import { linearAxis, airCylinder, suctionCup } from '@core/models/motion.js';
import { laserProfiler, visionCamera } from '@core/models/vision.js';
import { LAYOUT, BOX, slot } from './spec.js';
import { createLoad, partMesh } from './parts.js';
import { createBase, createEnclosure } from './qc-common.js';

export const QB = {
  nest: { z: 350, top: 980 }, hinge: 1020, meas: -350, arm: 330, post: 390,
  park: 110, boxLift: -110, rowLift: 80,
  granite: { x0: -290, x1: 290, z0: -560, z1: -180 }, north: { x0: -700, x1: 900, z0: -1040, z1: -580 },
  table: [-800, 1000, -1060, 700],
  gantry: { z: -960, park: 650, beam: [-1010, -240], y: 1440 },
  bin: { x: 640, z: -380, top: 880 },
  window: 1160,                 // 線雷射窗口高度（掃描時）
  camY: 1116,                   // 相機光軸高度（頂升後的列中心）
};
const flipMat = new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: .5, metalness: .35 });
const lapped = new THREE.MeshStandardMaterial({ color: 0xd4d9de, roughness: .18, metalness: .95 });

export function createBoxStation(scene, part, plan) {
  const S = LAYOUT.qc.station, vision = plan.sensor === 'vision';
  const root = new THREE.Group(); root.name = 'qc station'; root.position.set(S.x, 0, S.z); scene.add(root);
  const { slabs } = createBase(root, { table: QB.table, granite: [QB.granite, QB.north] });
  // 花崗岩定位座（基準板座框架落在這四塊硬化墊上）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(root, 20, 5, [sx * 250, 902.5, QB.meas + sz * 140], MAT.chrome, 'y', 20);

  // ---- 入料定位座
  block(root, [300, 250, 200], [0, 700 + 125, QB.nest.z], flipMat);
  block(root, [460, 30, 300], [0, QB.nest.top - 15, QB.nest.z], MAT.steelDark);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(root, [16, 24, 40], [sx * 232, QB.nest.top + 12, QB.nest.z + sz * 130], MAT.yellow);

  // ---- 翻轉軸：兩側立柱、軸承座、伺服＋減速機
  for (const s of [-1, 1]) {
    block(root, [60, QB.hinge + 50 - 700, 80], [s * QB.post, 700 + (QB.hinge + 50 - 700) / 2, 0], flipMat);
    cylinder(root, 70, 80, [s * QB.post, QB.hinge, 0], MAT.steelDark, 'x', 32);
  }
  cylinder(root, 60, 100, [QB.post + 90, QB.hinge, 0], MAT.black, 'x', 28);
  const mot = block(root, [120, 120, 120], [QB.post + 200, QB.hinge, 0], MAT.steelBlue); mot.name = 'flip servo';
  decal(root, 100, 40, [QB.post + 261, QB.hinge, 0], [0, Math.PI / 2, 0], ['SERVO'], { color: '#e8eef3', center: true });

  // ---- 翻轉臂（flip：繞 X 軸，原點在軸心）
  const flip = new THREE.Group(); flip.name = 'flip arm'; flip.position.set(0, QB.hinge, 0); root.add(flip);
  flip.userData.cableHost = false;
  for (const s of [-1, 1]) {
    // 鏤空臂架：上下橫桿＋軸端與外端立桿＋中段導軌立板（夾盒滑座與基準板座鎖銷沿它滑動）
    for (const y of [-170, 180]) block(flip, [20, 40, 560], [s * QB.arm, y, 240], flipMat);
    for (const z of [0, 500]) block(flip, [20, 390, 40], [s * QB.arm, 5, z], flipMat);
    block(flip, [20, 390, 120], [s * QB.arm, 5, QB.nest.z], flipMat);
    cylinder(flip, 58, 20, [s * (QB.post - 30 - 10), 0, 0], MAT.steelDark, 'x', 28);      // 軸頭（接立柱軸承）
  }
  // 鐵盒夾持滑座（bl：沿臂的 y 方向；翻轉後往上＝把盒子抬離工件）
  const boxCarrier = new THREE.Group(); boxCarrier.name = 'box carrier'; flip.add(boxCarrier);
  const pads = [];
  for (const s of [-1, 1]) {
    block(boxCarrier, [12, 140, 160], [s * 314, -25, QB.nest.z], MAT.steelDark);
    const cyl = airCylinder.create({ axis: 'x', dir: -s, w: 60, h: 50, d: 60, stroke: 15, rodL: 20 });
    cyl.root.position.set(s * 278, 15, QB.nest.z); boxCarrier.add(cyl.root);
    const pad = new THREE.Group(); pad.name = 'clamp pad'; boxCarrier.add(pad);
    block(pad, [10, 50, 120], [0, 0, 0], MAT.black); pads.push({ g: pad, s });
  }
  // 基準板座（holder；pl：沿臂上移量。latch 時跟著翻轉臂，否則留在花崗岩上）
  const holder = new THREE.Group(); holder.name = 'reference holder'; root.add(holder);
  const rails = [];
  if (vision) {
    // 一列一條研磨軌（可單獨頂起），下面兩支橫樑承托
    for (let r = 0; r < part.grid.rows; r++) {
      const rg = new THREE.Group(); rg.name = `reference rail ${r + 1}`; rg.position.z = slot(part, r * part.grid.cols).z; holder.add(rg);
      block(rg, [424, 25, part.grid.rowPitch - 6], [0, 12.5, 0], lapped); rails.push(rg);
    }
    for (const s of [-1, 1]) block(holder, [30, 20, 264], [s * 170, 35, 0], MAT.steelDark);
  } else {
    const p = block(holder, [424, 25, 264], [0, 12.5, 0], lapped); p.name = 'reference plate';
  }
  const neck0 = vision ? 45 : 25;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(holder, [40, 78 - neck0, 40], [sx * 190, (neck0 + 78) / 2, sz * 115], MAT.steelDark);
  for (const sz of [-1, 1]) block(holder, [600, 30, 20], [0, 93, sz * 140], flipMat);
  for (const sx of [-1, 1]) {
    block(holder, [20, 30, 260], [sx * 290, 93, 0], flipMat);
    block(holder, [18, 30, 60], [sx * 309, 93, 0], MAT.yellow);                           // 鎖銷座
  }
  const holderLoad = createLoad(part, { name: 'holder load', ngMark: true }); holderLoad.group.position.y = -part.h; holder.add(holderLoad.group);
  holderLoad.set({ to: 0 });

  // ---- 懸臂龍門（北側花崗岩條上）：X 軸、立柱、Y 樑（沿 z）、Z 軸、工具
  const G = QB.gantry;
  const xAxis = linearAxis.create({ length: 1500, width: 220, height: 60, carL: 260, carH: 40 });
  xAxis.root.position.set(100, 900, G.z); root.add(xAxis.root);
  const col = new THREE.Group(); col.name = 'gantry column'; col.position.set(G.park, 900, G.z); root.add(col);
  block(col, [120, 420, 120], [0, 104 + 210, 0], MAT.frame);
  const beamLen = G.beam[1] - G.beam[0];
  block(col, [80, 70, beamLen], [0, G.y - 900, (G.beam[0] + G.beam[1]) / 2 - G.z], MAT.frame);
  const yCar = new THREE.Group(); yCar.name = 'gantry y'; col.add(yCar);
  block(yCar, [120, 50, 120], [0, G.y - 900 - 65, 0], MAT.steelDark);
  block(yCar, [56, 260, 40], [0, G.y - 900 - 220, -44], MAT.steelDark);                 // Z 軸本體
  const zCar = new THREE.Group(); zCar.name = 'gantry z'; yCar.add(zCar);
  const tool = new THREE.Group(); tool.name = 'gantry tool'; zCar.add(tool);
  let laser = null, cam = null;
  if (vision) {
    block(tool, [50, 120, 30], [0, 100, -60], MAT.steelDark);
    cam = visionCamera.create({ axis: '+z', bodyW: 56, bodyD: 56, bodyL: 70, lensR: 45, lensL: 250, ringR: 0, fov: 10, bands: { ats: [-40, -200], r: 47, length: 8 } });
    cam.root.position.set(0, 0, 0); tool.add(cam.root);
  } else {
    block(tool, [50, 60, 30], [0, 140, -44], MAT.steelDark);
    laser = laserProfiler.create({ axis: '-y', w: 70, h: 50, length: 110, fanW: 34, range: 110 });
    laser.root.position.set(0, 56, 0); tool.add(laser.root); tagPart(laser.root, 'P-00047');
  }
  // NG 剔除吸盤（工具側邊，小氣缸下壓 40 mm）
  const pick = new THREE.Group(); pick.name = 'ng picker'; tool.add(pick);
  block(tool, [30, 90, 30], [90, 75, 0], MAT.black);
  cylinder(pick, 5, 70, [90, -5, 0], MAT.chrome);
  const cup = suctionCup.create({ r: 5, h: 6, topR: 4 }); cup.root.position.set(90, -43, 0); pick.add(cup.root);
  const ngPart = partMesh(part, 'ng carried'); ngPart.rotation.x = Math.PI; ngPart.position.set(90, -46, 0); ngPart.visible = false; pick.add(ngPart);

  // ---- 視覺：平行背光（量測時升起、翻轉時降下避開）、花崗岩上的頂升銷
  let back = null; const pins = [];
  if (vision) {
    const bl = airCylinder.create({ axis: 'y', w: 60, h: 120, d: 50, stroke: 140, rodL: 160, rodR: 10 });
    bl.root.position.set(0, 790, QB.granite.z1 + 45); root.add(bl.root);
    back = new THREE.Group(); back.name = 'backlight'; root.add(back);
    block(back, [470, 100, 26], [0, 0, 0], MAT.alu);
    const face = block(back, [450, 88, 2], [0, 0, -14], new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfefff, emissiveIntensity: 1.1, roughness: .3 })); face.name = 'backlight face';
    block(back, [40, 180, 30], [0, -140, 20], MAT.steelDark);
    back.userData.slide = bl;
    for (let r = 0; r < part.grid.rows; r++) {
      const c = airCylinder.create({ axis: 'y', w: 30, h: 50, d: 30, stroke: QB.rowLift, rodL: 36, rodR: 6 });
      c.root.position.set(0, 925, QB.meas - slot(part, r * part.grid.cols).z); root.add(c.root); pins.push(c);
    }
  }
  // ---- 不良品盒
  block(root, [60, 30, 60], [QB.bin.x, 715, QB.bin.z], MAT.steelDark);
  const binG = new THREE.Group(); binG.name = 'ng bin'; root.add(binG);
  block(binG, [200, 4, 160], [QB.bin.x, QB.bin.top - 148, QB.bin.z], MAT.red);
  for (const s of [-1, 1]) { block(binG, [200, 150, 4], [QB.bin.x, QB.bin.top - 75, QB.bin.z + s * 78], MAT.red); block(binG, [4, 150, 152], [QB.bin.x + s * 98, QB.bin.top - 75, QB.bin.z], MAT.red); }
  const binParts = [0, 1, 2].map(k => { const m = partMesh(part, 'ng bin part'); m.rotation.z = Math.PI / 2; m.position.set(QB.bin.x - 40 + k * 40, QB.bin.top - 146 + 11, QB.bin.z); m.visible = false; binG.add(m); return m; });

  const enc = createEnclosure(root, { x0: QB.table[0] - 20, x1: QB.table[1] + 20, z0: QB.table[2] - 20, z1: QB.table[3] + 20 });
  return { root, flip, boxCarrier, pads, holder, holderLoad, rails, xAxis, col, yCar, zCar, tool, pick, ngPart, laser, cam, back, pins, binParts, enc, slabs };
}
