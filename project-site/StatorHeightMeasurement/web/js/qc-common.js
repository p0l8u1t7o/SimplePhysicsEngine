// 品檢區共用：隔間（低振動、遠離沖壓機）、機台鋼架＋被動隔振腳＋花崗岩、門型安全外框、操作電腦。
import * as THREE from 'three';
import { block, cylinder, plate, floorText } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { hmi, signalTower, estop } from '@core/models/indicators.js';
import { LAYOUT } from './spec.js';

export const graniteMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: .5, metalness: .05 });
export const tableMat = new THREE.MeshStandardMaterial({ color: 0x8b99a6, roughness: .55, metalness: .35 });
export const polyMat = new THREE.MeshStandardMaterial({ color: 0xcfe3f2, roughness: .1, metalness: 0, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide });
const isoMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: .8 });

// 品檢隔間：半高隔板＋透明上段、西側門口
export function createQcRoom(scene) {
  const Q = LAYOUT.qc, root = new THREE.Group(); root.name = 'qc room'; root.userData.noBom = '廠房隔間（土建）'; scene.add(root);
  const H = 2400, t = 60, wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(z1 - z0) < 1;
    block(root, alongX ? [len, 1100, t] : [t, 1100, len], [(x0 + x1) / 2, 550, (z0 + z1) / 2], MAT.wallBase);
    block(root, alongX ? [len, H - 1100, 10] : [10, H - 1100, len], [(x0 + x1) / 2, 1100 + (H - 1100) / 2, (z0 + z1) / 2], polyMat);
    block(root, alongX ? [len, 50, t] : [t, 50, len], [(x0 + x1) / 2, H + 25, (z0 + z1) / 2], MAT.frame);
  };
  wall(Q.x0, Q.z0, Q.x1, Q.z0); wall(Q.x1, Q.z0, Q.x1, Q.z1); wall(Q.x0, Q.z1, Q.x1, Q.z1);
  wall(Q.x0, Q.z0, Q.x0, Q.door[0]); wall(Q.x0, Q.door[1], Q.x0, Q.z1);
  for (const z of Q.door) block(root, [t + 20, H + 50, 60], [Q.x0, (H + 50) / 2, z], MAT.frame);
  block(root, [t + 20, 80, Q.door[1] - Q.door[0] + 60], [Q.x0, H + 10, (Q.door[0] + Q.door[1]) / 2], MAT.frame);
  plate(root, ['品檢區（低振動・低噪音）'], 1000, 140, [Q.x0 - 36, H - 200, (Q.door[0] + Q.door[1]) / 2], -Math.PI / 2);
  floorText(root, ['品檢區：離沖壓機約 10 m，不在廢料坑蓋板上'], (Q.x0 + Q.x1) / 2, Q.z1 - 260, 2600, 220);
  return { root };
}

// 機台：鋼架（桌面 top）＋隔振腳＋花崗岩塊（每塊 { x0,x1,z0,z1 }）。回傳 root（站本地座標）
export function createBase(parent, { table, top = 700, iso = 80, granite = [], graniteTop = 900 }) {
  const [x0, x1, z0, z1] = table, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
  block(parent, [x1 - x0, 30, z1 - z0], [xm, top - 15, zm], tableMat);
  for (const x of [x0 + 50, x1 - 50]) for (const z of [z0 + 50, z1 - 50]) {
    block(parent, [70, top - 110, 70], [x, 80 + (top - 110) / 2, z], tableMat);
    cylinder(parent, 45, 20, [x, 10, z], MAT.black, 'y', 20);
    cylinder(parent, 12, 60, [x, 50, z], MAT.chrome);
  }
  for (const z of [z0 + 50, z1 - 50]) block(parent, [x1 - x0 - 100, 60, 60], [xm, 180, z], tableMat);
  for (const x of [x0 + 50, x1 - 50]) block(parent, [60, 60, z1 - z0 - 100], [x, 180, zm], tableMat);
  const slabs = granite.map(g => {
    const gx = (g.x0 + g.x1) / 2, gz = (g.z0 + g.z1) / 2, gy0 = top + iso;
    const s = block(parent, [g.x1 - g.x0, graniteTop - gy0, g.z1 - g.z0], [gx, (gy0 + graniteTop) / 2, gz], graniteMat); s.name = 'granite';
    // 被動隔振腳（橡膠＋空氣彈簧外形）：花崗岩四角
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = gx + sx * ((g.x1 - g.x0) / 2 - 60), pz = gz + sz * ((g.z1 - g.z0) / 2 - 60);
      cylinder(parent, 42, iso - 10, [px, top + (iso - 10) / 2, pz], isoMat, 'y', 24);
      cylinder(parent, 30, 10, [px, top + iso - 5, pz], MAT.steelDark, 'y', 20);
    }
    return s;
  });
  return { slabs };
}

// 外框：四角立柱＋頂框＋三面透明板（正面留開口裝光柵），操作盒在東南角
export function createEnclosure(parent, { x0, x1, z0, z1, top = 700, h = 2100, name = 'enclosure', sides = true }) {
  const g = new THREE.Group(); g.name = name; parent.add(g);
  for (const x of [x0, x1]) for (const z of [z0, z1]) block(g, [40, h - top, 40], [x, top + (h - top) / 2, z], MAT.frame);
  for (const z of [z0, z1]) block(g, [x1 - x0 + 40, 40, 40], [(x0 + x1) / 2, h, z], MAT.frame);
  for (const x of [x0, x1]) block(g, [40, 40, z1 - z0], [x, h, (z0 + z1) / 2], MAT.frame);
  block(g, [x1 - x0 - 40, h - top - 360, 6], [(x0 + x1) / 2, top + 300 + (h - top - 360) / 2, z0], polyMat);
  if (sides) for (const x of [x0, x1]) block(g, [6, h - top - 360, z1 - z0 - 40], [x, top + 300 + (h - top - 360) / 2, (z0 + z1) / 2], polyMat);
  const panel = hmi.create({ display: true, w: 340, h: 250 }); panel.root.position.set(x1 + 230, 1350, z1 + 10); g.add(panel.root);
  block(g, [60, 1450, 60], [x1 + 230, 725, z1 - 45], MAT.steelDark);
  block(g, [220, 12, 220], [x1 + 230, 6, z1 - 45], MAT.steelDark);
  const tower = signalTower.create({ poleH: 260 }); tower.root.position.set(x0, h + 20, z1); g.add(tower.root);
  const es = estop.create(); es.root.position.set(x1 + 230, 1170, z1 + 36); g.add(es.root);
  block(g, [120, 120, 60], [x1 + 230, 1170, z1], MAT.yellow);
  return { root: g, panel, tower };
}
