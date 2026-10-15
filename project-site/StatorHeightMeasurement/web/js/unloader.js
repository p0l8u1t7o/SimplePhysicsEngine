// 自動下料機：可移動底座（腳輪＋防振調整腳，腳座落在廢料坑蓋板的支撐樑上；掀蓋清廢料時收腳推開）、
// DENSO HSR065 SCARA＋真空吸盤工具（定子吸齒部、轉子吸環面，換型換吸盤）、鐵盒滾筒輸送（空盒 2 格、擺盒位、滿盒 2 格）、
// 圍籬與光柵、人機與三色燈。
import * as THREE from 'three';
import { block, cylinder, rod, plate, decal } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { createHSR065 } from '@core/models/robots/denso-hsr065.js';
import { tagPart } from '@core/models/parts.js';
import { create as createConveyor } from '@core/models/conveyor.js';
import { stopper } from '@core/models/transport.js';
import { suctionCup, airCylinder, vacuumEjector } from '@core/models/motion.js';
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { LAYOUT, BOX } from './spec.js';
import { partMesh } from './parts.js';

const U = LAYOUT.unloader, F = U.frame, CV = U.conveyor;
export const TOOL = 100;                                   // 法蘭面到吸盤唇的距離
export const padOffset = part => part.key === 'rotor' ? 12.5 : 1.5;   // 吸盤中心在工件本地 +z 的偏移（避開鉚接點與孔）

// 真空吸盤工具：裝在法蘭底下（法蘭本地 −y 朝下）；carried 是吸住的工件（顯示與否由 set 決定）
export function createSuctionTool(flange, part, name = 'suction tool') {
  const g = new THREE.Group(); g.name = name; flange.add(g);
  block(g, [72, 12, 72], [0, -16, 0], MAT.alu);                              // 轉接板（法蘭盤下方）
  block(g, [34, 40, 34], [0, -42, 0], MAT.steelDark);                       // 緩衝導套
  cylinder(g, 4, 32, [0, -78, 0], MAT.chrome);                               // 緩衝桿
  const ej = vacuumEjector.create({ w: 30, h: 26, d: 52 }); ej.root.position.set(52, -14, 0); g.add(ej.root);
  const cup = suctionCup.create({ r: part.key === 'rotor' ? 7 : 4.5, h: 6, topR: 4 }); cup.root.position.y = -TOOL + 3; g.add(cup.root);
  const carried = partMesh(part, `${name} part`);
  carried.position.set(0, -TOOL - part.h, -padOffset(part)); g.add(carried);
  return { root: g, carried, set({ hold }) { carried.visible = !!hold; } };
}

export function createUnloader(scene, part) {
  const root = new THREE.Group(); root.name = 'unloader'; scene.add(root);
  const xm = (F.x0 + F.x1) / 2, zm = (F.z0 + F.z1) / 2, W = F.x1 - F.x0, D = F.z1 - F.z0;
  const paint = new THREE.MeshStandardMaterial({ color: 0x5f7f99, roughness: .55, metalness: .35 });
  // ---- 底座：方管框＋頂板；柱位對齊蓋板支撐樑（z = feetZ）
  block(root, [W, 20, D], [xm, F.top - 10, zm], MAT.steelDark);
  const posts = [F.x0 + 70, U.scara.x, F.x1 - 70];
  for (const z of F.feetZ) {
    block(root, [W, 80, 80], [xm, 200, z], paint);                     // 下層橫樑
    block(root, [W, 80, 80], [xm, F.top - 60, z], paint);              // 上層橫樑
    for (const x of posts) {
      block(root, [80, F.top - 260, 80], [x, 240 + (F.top - 260) / 2, z], paint);
      // 防振調整腳（橡膠墊）：墊底在蓋板面（y=12）
      cylinder(root, 55, 18, [x, 21, z], MAT.black, 'y', 24);
      cylinder(root, 12, 120, [x, 90, z], MAT.chrome);
      block(root, [110, 30, 110], [x, 145, z], MAT.steelDark);
      // 腳輪（收起：輪底離蓋板 8 mm；推開時把調整腳旋上）
      const cx = x + (x < xm ? 110 : -110);
      cylinder(root, 45, 34, [cx, 65, z], MAT.black, 'z', 18);
      block(root, [70, 60, 70], [cx, 140, z], MAT.steelDark);
    }
  }
  for (const x of [F.x0 + 40, F.x1 - 40]) block(root, [80, 80, F.feetZ[1] - F.feetZ[0] - 80], [x, F.top - 60, zm + (F.feetZ[0] + F.feetZ[1]) / 2 - zm], paint);
  // 底座內：SCARA 控制器與電盤
  block(root, [560, 330, 420], [U.scara.x - 520, 420, 1350], MAT.cabinet);
  block(root, [520, 20, 380], [U.scara.x - 520, 590, 1350], MAT.steelDark);
  decal(root, 220, 60, [U.scara.x - 520, 480, 1561], [0, 0, 0], ['RC8A'], { color: '#1d2a36', bold: true, center: true });

  // ---- SCARA 立座＋手臂
  const S = U.scara;
  block(root, [300, S.y - F.top - 20, 300], [S.x, F.top + (S.y - F.top - 20) / 2, S.z], paint);
  block(root, [340, 20, 340], [S.x, S.y - 10, S.z], MAT.steelDark);
  const arm = createHSR065(); arm.root.position.set(S.x, S.y, S.z); root.add(arm.root); tagPart(arm.root, 'P-00205');
  const tool = createSuctionTool(arm.flange, part, 'unloader tool');

  // ---- 鐵盒輸送：滾筒輸送線（腳改成立在底座頂板上的短座）
  const conv = createConveyor({ length: CV.x1 - CV.x0, width: BOX.size[2] + 30, height: CV.top, pitch: 90, roller: 25, legs: false, brackets: {} });
  conv.root.position.set((CV.x0 + CV.x1) / 2, 0, CV.z); root.add(conv.root);
  const railY = CV.top - 25 - 150 + 20;                                   // 側樑底
  for (const x of [CV.x0 + 120, U.scara.x - 600, U.scara.x + 600, CV.x1 - 120]) for (const s of [-1, 1]) block(root, [60, railY - F.top, 50], [x, F.top + (railY - F.top) / 2, CV.z + s * (BOX.size[2] / 2 + 15 + 25)], MAT.steelDark);
  // 側導板（盒子不偏）
  for (const s of [-1, 1]) block(root, [CV.x1 - CV.x0, 40, 6], [(CV.x0 + CV.x1) / 2, CV.top + 30, CV.z + s * (BOX.size[2] / 2 + 12)], MAT.alu);
  // 止擋：W1、擺盒位、E1 的前緣與末端
  const stops = [1, 2, 3, 4].map(i => {
    const st = stopper.create({ blade: { size: [10, 24, 120] } });
    st.root.position.set(U.slots[i] + BOX.size[0] / 2 + 10, CV.top - 25, CV.z); root.add(st.root); return st;
  });
  // 擺盒位的側推定位缸（把盒子推靠南側導板）
  const pusher = airCylinder.create({ axis: 'z', w: 40, h: 40, d: 80, stroke: 6, rodL: 30 });
  pusher.root.position.set(U.slots[U.fill], CV.top + 30, CV.z - BOX.size[2] / 2 - 70); root.add(pusher.root);

  // ---- 圍籬（手臂區兩側）與南側光柵；北側是滑道
  // 每側：北段整片網、輸送線上方的隧道頂網（盒子從底下穿過）、南端立柱；頂部橫桿
  const fenceMat = MAT.mesh, fx = [U.scara.x - 780, U.scara.x + 780];
  for (const x of fx) {
    for (const z of [560, 1080, 1640]) block(root, [40, 1500, 40], [x, F.top + 750, z], MAT.yellow);
    block(root, [10, 1300, 480], [x, F.top + 850, 820], fenceMat);
    block(root, [10, 1040, 520], [x, 1620, 1360], fenceMat);
    block(root, [40, 40, 1040], [x, F.top + 1480, 1100], MAT.yellow);
  }
  const lc = lightCurtain.create({ span: fx[1] - fx[0] - 120, height: 900, beam: {} });
  lc.root.position.set(U.scara.x, F.top, 1600); root.add(lc.root);
  // ---- 操作盒：人機、三色燈、急停（東側立柱）
  const opX = F.x1 - 120, opZ = F.z1 - 40;
  block(root, [60, 1500 - F.top, 60], [opX, F.top + (1500 - F.top) / 2, opZ], MAT.steelDark);
  const panel = hmi.create({ display: true, w: 320, h: 240 }); panel.root.position.set(opX, 1360, opZ + 60); root.add(panel.root);
  const tower = signalTower.create({ poleH: 220 }); tower.root.position.set(opX, 1500, opZ); root.add(tower.root);
  const es = estop.create(); es.root.position.set(opX + 120, 1200, opZ + 32); root.add(es.root);
  block(root, [200, 100, 60], [opX + 130, 1200, opZ], MAT.yellow);
  plate(root, ['自動下料機（SCARA 擺盒）'], 700, 110, [U.scara.x, F.top + 1400, 1662], 0, { font: 'bold 40px "Noto Sans TC","Microsoft JhengHei",sans-serif' });
  block(root, [fx[1] - fx[0] + 40, 160, 40], [U.scara.x, F.top + 1400, 1640], MAT.yellow);

  return { root, arm, tool, conv, stops, pusher, lc, panel, tower };
}
