// 交接台（附置中氣缸與有板感測）＋懸臂移載機（＝進料滑台）。
// 手臂只在交接台上方取放；移載機把板在交接台 ⇄ 拆框機之間水平送進、取出（拆框機長邊兩側有頂樑，只能從入料口側進）。
// 移載機：Z 向導軌在機台西側（x = LOADER.railX），台車掛在導軌東側面、立柱往下、升降座帶懸臂沿 +X 伸到板中心。
//   set({ z, y, center })：z＝吸盤面中心的 Z、y＝吸盤面高度（TCP）、center＝交接台置中氣缸伸出量 0～1
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { suctionCup } from '@core/models/motion.js';
import { boxSensor } from '@core/models/sensors.js';
import { TABLE, LOADER as L, PANEL, MACHINE } from './layout.js';

const yellow = new THREE.MeshStandardMaterial({ color: 0xf0b416, roughness: .5, metalness: .15 });

export function createTransfer(scene) {
  const P = PANEL, ty = MACHINE.tableY, glass = ty + P.T - P.lip, tz = TABLE.z;

  // ================================================================ 交接台：鋁框落在兩支長邊托條上，層壓板落在兩支內托條上（避開接線盒）
  const table = new THREE.Group(); table.name = 'transfer table'; scene.add(table);
  for (const x of [-600, 600]) for (const s of [-1, 1]) block(table, [60, 800, 60], [x, 400, tz + s * 480], MAT.steelBlue).name = 'table leg';
  for (const x of [-600, 0, 600]) block(table, [60, 60, 1020], [x, 830, tz], MAT.steelBlue).name = 'table beam';
  for (const s of [-1, 1]) block(table, [1560, 40, 40], [0, ty - 20, tz + s * (P.W / 2 - P.edge / 2)], MAT.steel).name = 'table ledge';
  const padTop = glass - P.lam;
  for (const s of [-1, 1]) {
    block(table, [1200, 50, 80], [150, padTop - 25, tz + s * 250], yellow).name = 'table pad';                 // x −450～750，避開接線盒（x −600）
    for (const x of [0, 600]) block(table, [60, padTop - 50 - 860, 60], [x, (860 + padTop - 50) / 2, tz + s * 250], MAT.steelBlue).name = 'table spacer';
  }
  // 北側固定定位塊（板被南側推缸推靠過來）；移載機送出時板底高過它
  for (const x of [-600, 600]) block(table, [120, 30, 20], [x, ty + 12, tz - P.W / 2 - 14.5], MAT.black).name = 'table stop';
  for (const x of [-600, 600]) block(table, [40, ty - 3 - 860, 20], [x, (860 + ty - 3) / 2, tz - P.W / 2 - 14.5], MAT.steelBlue).name = 'table stop post';
  // 置中氣缸：東西兩端（推板端面）＋南側（推板靠北側定位塊）；缸體坐在落地支架上，推頭隨 center 伸出
  const pushers = [];
  const pusher = (axis, sign, at, along) => {
    const g = new THREE.Group(); g.name = 'centering pusher'; table.add(g);
    const head = axis === 'x' ? [20, 30, 160] : [160, 30, 20], body = axis === 'x' ? [180, 40, 40] : [40, 40, 180];
    const contact = axis === 'x' ? P.L / 2 : P.W / 2, hy = ty + 12;
    const headC = contact + .5 + 10 + TABLE.centering, bodyC = headC + 10 + 30 + 90;           // 推頭內面離板邊 centering＋0.5
    const pos = (n, y) => axis === 'x' ? [sign * n, y, tz + along] : [along, y, tz + sign * n];
    const h = block(g, head, pos(headC, hy), MAT.black); h.name = 'pusher head';
    block(g, axis === 'x' ? [30, 12, 12] : [12, 12, 30], pos(headC + 25, hy), MAT.chrome).name = 'pusher rod';
    block(table, body, pos(bodyC, hy), MAT.steelBlue).name = 'pusher cylinder';
    block(table, axis === 'x' ? [60, hy - 20, 60] : [60, hy - 20, 60], pos(bodyC + 120, (hy - 20) / 2), MAT.steelBlue).name = 'pusher post';
    block(table, axis === 'x' ? [90, 20, 50] : [50, 20, 90], pos(bodyC + 60, hy - 30), MAT.steelBlue).name = 'pusher bracket';
    pushers.push({ g, dir: new THREE.Vector3(...(axis === 'x' ? [-sign, 0, 0] : [0, 0, -sign])) });
  };
  pusher('x', -1, 0, 300); pusher('x', 1, 0, 300); pusher('z', 1, 0, 0);          // 東西推缸偏南 300 mm，讓開移載機立柱
  // 有板感測（交接台南側托條下方，向北照）
  const sensor = boxSensor.create?.({}) ?? null;
  if (sensor) { sensor.root.position.set(700, 840, tz + 520); table.add(sensor.root); }

  // ================================================================ 懸臂移載機
  const loader = new THREE.Group(); loader.name = 'loader'; scene.add(loader);
  const [z0, z1] = L.railZ, railLen = z1 - z0, railC = (z0 + z1) / 2, ry = L.railY + L.railH / 2;
  block(loader, [70, L.railH, railLen], [L.railX, ry, railC], MAT.steelDark).name = 'loader rail';
  const guide = block(loader, [20, 30, railLen], [L.railX + 45, ry, railC], MAT.chrome); guide.name = 'loader guide'; guide.userData.guide = 'loader-rail';   // 導軌東側面的線軌
  // 機外兩支落地柱＋托架；機內吊桿接到機台前上樑
  for (const z of [1100, 1650]) {
    block(loader, [80, L.railY + L.railH, 80], [L.railX - 115, (L.railY + L.railH) / 2, z], MAT.steelBlue).name = 'loader post';
    block(loader, [40, 40, 80], [L.railX - 55, L.railY + L.railH - 20, z], MAT.steelBlue).name = 'loader bracket';
  }
  const hang = MACHINE.top - 100 - (L.railY + L.railH);
  cylinder(loader, 15, hang, [L.railX, L.railY + L.railH + hang / 2, MACHINE.z + MACHINE.W / 2 - 50], MAT.steelBlue, 'y', 12).name = 'loader hanger';
  cylinder(loader, 15, hang, [L.railX, L.railY + L.railH + hang / 2, -200], MAT.steelBlue, 'y', 12).name = 'loader hanger';
  block(loader, [130, 40, 40], [L.railX - 50, MACHINE.top - 120, -200], MAT.steelBlue).name = 'loader hanger arm';   // 托在西端頂短樑下

  const carriage = new THREE.Group(); carriage.name = 'loader carriage'; loader.add(carriage);
  const car = block(carriage, [70, 120, 300], [L.railX + 90, ry, 0], yellow); car.name = 'loader carriage'; car.userData.on = 'loader-rail';
  block(carriage, [60, 400, 60], [L.columnX, 1200, 0], yellow).name = 'loader column';
  cylinder(carriage, 40, 120, [L.columnX, ry + 120, 0], MAT.steelDark, 'y', 20).name = 'loader z motor';
  // 升降座＋懸臂＋吸盤框（y 由 set 決定；局部原點＝吸盤面中心）
  const head = new THREE.Group(); head.name = 'loader head'; carriage.add(head);
  const cupH = 60, rail0 = cupH + 4, cross0 = rail0 + 50, boom0 = cross0 + 40;
  block(head, [60, 120, 100], [L.columnX + 60, boom0 + 16, 0], yellow).name = 'loader slider';
  block(head, [-L.columnX - 90, 80, 80], [(L.columnX + 90) / 2, boom0 + 40, 0], MAT.frame).name = 'loader boom';
  block(head, [80, 40, 580], [0, cross0 + 20, 0], MAT.frame).name = 'loader cross beam';
  for (const z of [-250, 250]) block(head, [1300, 50, 60], [0, rail0 + 25, z], MAT.frame).name = 'loader frame rail';
  for (const [x, z] of L.cups) block(head, [56, 4, 56], [x, cupH + 2, z], MAT.steelDark).name = 'cup mount';
  const cups = suctionCup.create({ r: 40, h: cupH, topR: 22, at: L.cups.map(([x, z]) => [x, cupH / 2, z]) }); head.add(cups.root);

  function set({ z = L.zPark, y = L.yPark, center = 0 } = {}) {
    carriage.position.z = z;
    head.position.y = y;
    for (const p of pushers) p.g.position.copy(p.dir).multiplyScalar(TABLE.centering * center);
  }
  set();
  return { table, loader, carriage, head, set, tcp: () => new THREE.Vector3(0, head.position.y, carriage.position.z) };
}
