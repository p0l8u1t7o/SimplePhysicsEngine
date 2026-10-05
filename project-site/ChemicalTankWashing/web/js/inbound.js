// 散桶入庫區：西牆捲門、入庫棧板座、懸臂吊（夾桶具）、油桶台車與作業員。
// 懸臂吊方位 a（度）：手臂方向 (cos a, −sin a)，與 AGV 方位同一定義；r 為吊點半徑，y 為桶中心高度。
import * as THREE from 'three';
import { INBOUND, DRUM, ROOM } from './layout.js';
import { D2R, block, cylinder, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { dolly as dollyModel, jibCrane } from '@core/models/transport-handling.js';

export const DOLLY_H = 120;
// 懸臂吊吊點對應的桶中心
export const jibPoint = (a, r, y) => new THREE.Vector3(INBOUND.jib.x + r * Math.cos(a * D2R), y, INBOUND.jib.z - r * Math.sin(a * D2R));
// 由桶中心反推懸臂吊方位與半徑
export function jibTarget(x, z) { const dx = x - INBOUND.jib.x, dz = z - INBOUND.jib.z; return { a: Math.atan2(-dz, dx) / D2R, r: Math.hypot(dx, dz) }; }

function person(parent, color = 0x2f6fb5) {
  const g = new THREE.Group(); parent.add(g);
  const suit = new THREE.MeshStandardMaterial({ color, roughness: .8 });
  for (const s of [-1, 1]) block(g, [140, 820, 160], [0, 410, s * 110], suit);
  cylinder(g, 190, 640, [0, 1150, 0], suit, 'y', 14);
  cylinder(g, 110, 220, [0, 1580, 0], new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: .7 }), 'y', 14);
  cylinder(g, 125, 90, [0, 1700, 0], MAT.yellow, 'y', 16);
  for (const s of [-1, 1]) { const arm = block(g, [110, 560, 110], [200, 1180, s * 230], suit); arm.rotation.z = -.9; }
  return g;
}

export function createInbound(scene) {
  const group = new THREE.Group(); group.name = 'inbound'; scene.add(group);
  const ib = INBOUND, [d0, d1] = ib.door;
  // 西牆捲門：門框＋捲門箱（開口）
  for (const z of [d0 + 60, d1 - 60]) block(group, [260, 2600, 120], [-60, 1300, z], MAT.yellow);   // 側導軌在開口內，不埋進牆
  block(group, [300, 380, d1 - d0 + 240], [152, 2680, (d0 + d1) / 2], MAT.steelDark);   // 捲門箱裝在牆內面、門楣上方；深 300 讓開懸臂吊台車（取桶時台車 x 359 起），頂面低於手臂底面
  for (let z = d0 + 150; z < d1; z += 300) block(group, [20, 60, 150], [152, 2460, z], MAT.black);
  plate(group, ['散桶入庫門'], 900, 160, [60, 3200, (d0 + d1) / 2], Math.PI / 2, { w: 640, h: 110 });
  // 入庫棧板座
  block(group, [1260, ib.stand, 1260], [ib.x, ib.stand / 2, ib.z], MAT.steelDark);   // 不碰到東側貨架腳座
  for (const [dx, dz] of [[-660, 300], [-660, -300], [300, -660], [-300, -660]]) block(group, [Math.abs(dx) === 660 ? 40 : 300, 40, Math.abs(dx) === 660 ? 300 : 40], [ib.x + dx, ib.stand + 20, ib.z + dz], MAT.yellow);   // 定位擋條在棧板外、高 40：AGV 叉起棧板（離台 60 mm）弧線駛出時從上方通過
  // 懸臂吊：core 的懸臂吊模型（立柱、手臂、台車、吊鏈、夾桶具）；方位、半徑、夾具高度與開合交給模型的 set()
  const j = ib.jib;
  const jib = jibCrane.create({ armY: j.armY, reach: j.reach, gripR: DRUM.R - 10 }); jib.root.position.set(j.x, 0, j.z); group.add(jib.root);
  // 油桶台車（四輪平台）：core 的平台台車模型，推著走就是移動 root；＋作業員
  const dolly = dollyModel.create({ height: DOLLY_H }).root; group.add(dolly);
  const worker = person(group);
  plate(group, ['入庫棧板（AGV 取走）'], 900, 140, [ib.x, 450, ib.z + 660], 0, { w: 640, h: 100 });
  return {
    group,
    set({ dollyX, a, r, y, clamp: c, workerX = dollyX - 800, workerZ = ib.dolly.z }) {
      dolly.position.set(dollyX, 0, ib.dolly.z);
      worker.position.set(workerX, 0, workerZ);
      jib.set({ a, r, y: y + DRUM.H / 2 + 40, grip: c });   // 夾具在桶頂 L 環上方
    },
  };
}
