// 照片導向的加工件與配管細節；不建立排程、不移動既有零件。
import * as THREE from 'three';
import { block, cylinder, tube, decal } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { frl, solenoidValve } from '@core/models/motion.js';
import { LAYOUT } from './spec.js';
import { stainless, polished, hoseMat, blueHose } from './finishes.js';

export function pressDetails(root, slide) {
  const P = LAYOUT.press, L = LAYOUT.lane, front = P.z + P.d / 2;
  // 冠部檢修蓋、立柱蓋板、滑塊導軌；螺帽位於蓋板外側。
  for (const s of [-1, 1]) {
    block(root, [330, 1900, 16], [P.x + s * 1140, 2350, front + 8], MAT.steelDark);
    block(root, [78, 1280, 26], [P.x + s * 872, 2060, front - 170], polished);
    for (const y of [1500, 2200, 3000]) cylinder(root, 17, 12, [P.x + s * 1140, y, front + 22], MAT.steel, 'z', 6);
  }
  block(root, [1500, 500, 16], [P.x, P.h - 330, front + 10], MAT.steelDark);
  for (const x of [-660, 660]) for (const y of [P.h - 520, P.h - 140]) cylinder(root, 18, 12, [P.x + x, y, front + 26], polished, 'z', 6);
  // 飛輪護罩及沖床側面送入的鋼帶；送帶為固定外觀，既有沖次不變。
  cylinder(root, 590, 180, [P.x - P.w / 2 - 94, 3450, P.z], MAT.steelDark, 'x', 40);
  cylinder(root, 520, 12, [P.x - P.w / 2 - 192, 3450, P.z], MAT.mesh, 'x', 40);
  block(root, [900, 3, 160], [P.x + 1851, P.bed + 245, P.z], stainless);
  for (const z of [P.z - 95, P.z + 95]) block(root, [880, 35, 20], [P.x + 1851, P.bed + 225, z], MAT.steelDark);
  // 多工程模座：上方沖頭座、下模前側分塊、回位彈簧套與接頭。
  for (let k = 0; k < 6; k++) {
    const x = P.x + (k - 2.5) * 220;
    block(root, [185, 90, 45], [x, P.bed + 90, P.z + 676], polished);
    cylinder(root, 25, 8, [x, P.bed + 90, P.z + 704], MAT.black, 'z', 16);
    block(slide, [165, 54, 100], [x, P.bed + 668, P.z + 550], MAT.steel);
    tube(slide, [[x, 2040, front - 170], [x + 35, 1860, front - 80], [x + 40, 1690, front - 100], [x, 1670, front - 346]], 6, hoseMat, 12);
  }
  decal(root, 310, 80, [P.x - 1120, 3300, front + 17], [0, 0, 0], ['CAUTION', 'PRESS AREA'], { color: '#111111', bg: '#e9b731', center: true }).userData.fx = true;
}

export function alignerDetails(aligner, part) {
  const g = aligner.root, P = LAYOUT.press, L = LAYOUT.lane;
  // 每列配管留在氣缸外側與底板下方，避開通道、擋銷與側推墊的行程。
  for (let k = 0; k < L.n; k++) {
    const x = P.x + (k - 2.5) * L.pitch, px = x + part.channel / 2 + 19;
    cylinder(g, 3, 6, [px, L.y + 28, aligner.pickZ], polished, 'y', 8);
    tube(g, [[px, L.y + 32, aligner.pickZ], [px + 8, L.y + 38, aligner.pickZ - 20], [px + 14, L.y - 24, aligner.pickZ - 28], [px + 14, L.y - 80, aligner.pickZ - 28]], 1.5, blueHose, 10);
    cylinder(g, 3, 6, [x + 15, L.y - 42, aligner.zE], polished, 'x', 8);
    tube(g, [[x + 19, L.y - 42, aligner.zE], [x + 24, L.y - 60, aligner.zE], [x + 24, L.y - 80, aligner.pickZ - 28]], 1.5, blueHose, 8);
    for (const dz of [-6, 6]) {
      const fx = x - part.channel / 2 - 8;
      tube(g, [[fx - 5, L.y + 12, aligner.pickZ + dz], [fx - 10, L.y + 5, aligner.pickZ + dz], [fx - 10, L.y - 70, aligner.pickZ + dz]], 1, hoseMat, 8);
    }
  }
  tube(g, [[P.x + 25, 1800, aligner.pickZ], [P.x + 55, 1840, 560], [P.x + 665, 1840, 560], [P.x + 665, 500, 560]], 4, hoseMat, 18);
  for (const s of [-1, 1]) {
    block(g, [8, 90, 90], [P.x + s * 665, 1800, 560], MAT.steelDark);
    for (const dx of [-36, 36]) for (const dz of [-55, 55]) cylinder(g, 6, 6, [P.x + s * 700 + dx, 27, 560 + dz], polished, 'y', 6);
  }
}

export function pitDetails(root, grate) {
  const [x0, x1, z0, z1] = LAYOUT.pit.grate;
  // 實體扁鋼交錯形成菱形開孔，逐段合併，避免每條細肋增加一次繪製。
  const pos = [], norm = [], uv = [];
  for (let z = z0 + 20, row = 0; z + 50 <= z1 - 20; z += 50, row++) {
    for (let x = x0 + 25 + row % 2 * 25; x <= x1 - 25; x += 50) for (const s of [-1, 1]) {
      if (x + s * 25 < x0 + 4 || x + s * 25 > x1 - 4) continue;
      const a = new THREE.Vector3(x, 7, z), b = new THREE.Vector3(x + s * 25, 9, z + 50), d = b.clone().sub(a);
      const geo = new THREE.BoxGeometry(5, 4, d.length()).toNonIndexed();
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
      geo.translate(...a.add(b).multiplyScalar(.5).toArray());
      pos.push(...geo.attributes.position.array); norm.push(...geo.attributes.normal.array); uv.push(...geo.attributes.uv.array); geo.dispose();
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, polished); mesh.name = 'expanded metal'; mesh.castShadow = mesh.receiveShadow = true; grate.add(mesh);
  const scraps = new THREE.InstancedMesh(new THREE.TorusGeometry(14, 3, 4, 8), polished, 96);
  scraps.name = 'scrap offcuts'; scraps.castShadow = scraps.receiveShadow = true; root.add(scraps);
  const d = new THREE.Object3D();
  for (let i = 0; i < 96; i++) {
    d.position.set(x0 + 28 + i * 137 % (x1 - x0 - 56), -850 + i % 5 * 9, z0 + 25 + i * 83 % (z1 - z0 - 50));
    d.rotation.set(Math.PI / 2 + Math.sin(i) * .3, i * .72, i * .4); d.scale.set(1 + i % 3, 1, 1); d.updateMatrix(); scraps.setMatrixAt(i, d.matrix);
  }
}

export function unloaderDetails(root, arm) {
  const U = LAYOUT.unloader, F = U.frame, S = U.scara;
  // 框架接合板、六角螺栓與焊縫外觀。
  for (const x of [F.x0 + 70, S.x, F.x1 - 70]) {
    block(root, [104, 130, 5], [x, 340, 1743], stainless);
    for (const y of [300, 380]) cylinder(root, 8, 8, [x, y, 1750], MAT.steelDark, 'z', 6);
  }
  const tray = block(root, [900, 45, 90], [S.x + 430, 470, 1100], MAT.steelDark); tray.name = 'unloader cable tray';
  tube(root, [[S.x + 820, 500, 1100], [S.x + 200, 500, 1100], [S.x, 680, 700], [S.x, 930, 620]], 12, hoseMat, 20);
  const air = frl.create(); air.root.position.set(F.x1 - 210, 420, 1550); root.add(air.root);
  const manifold = block(root, [180, 22, 64], [F.x1 - 210, 560, 1550], stainless); manifold.name = 'valve manifold';
  for (let k = 0; k < 4; k++) {
    const x = F.x1 - 275 + k * 43;
    const valve = solenoidValve.create({ w: 30, h: 26, d: 50 }); valve.root.position.set(x, 585, 1550); root.add(valve.root);
    tube(root, [[x, 585, 1578], [x, 590, 1610], [x, 510, 1630]], 3, blueHose, 8);
  }
  decal(root, 150, 40, [F.x1 - 210, 460, 1580], [0, 0, 0], ['AIR 0.5 MPa'], { color: '#182a30', bg: '#e6edef', center: true }).userData.fx = true;
  armHoses(arm);
}

export function armHoses(arm) {
  // 分段固定於各臂、沿既有服務迴路佈置；關節柔性跨接保留為工程待定。
  tube(arm.j1, [[-28, 84, 45], [-28, 116, 100], [-28, 116, 240], [-28, 86, 290]], 3, blueHose, 14);
  tube(arm.j2, [[-26, 74, 38], [-26, 108, 85], [-26, 108, 135], [-26, 74, 160]], 3, blueHose, 12);
  tube(arm.flange, [[18, -12, -18], [24, -26, -12], [20, -70, -8], [5, -91, 0]], 2, blueHose, 12);
}

export function qcDetails(root, enc, slabs) {
  // 隔振腳外側鎖環與花崗岩標牌，保留隔振高度及定位面。
  slabs.forEach(s => {
    const p = s.position, box = s.geometry.parameters;
    decal(root, Math.min(230, box.width * .5), 36, [p.x, p.y, p.z + box.depth / 2 + .8], [0, 0, 0], ['GRANITE / REF. 20°C'], { color: '#bbc7cf', center: true }).userData.fx = true;
  });
  // 透明板的墊片與鋁擠型溝槽由材質及框架固定件表現。
  const corners = enc.root.children.filter(m => m.isMesh && m.geometry.parameters?.width === 40 && m.geometry.parameters?.height > 500);
  for (const m of corners) {
    const p = m.position, height = m.geometry.parameters.height;
    block(enc.root, [6, height - 70, 2], [p.x, p.y, p.z + 21], MAT.steelDark);
    for (const dy of [-height / 2 + 80, height / 2 - 80]) cylinder(enc.root, 6, 5, [p.x + 11, p.y + dy, p.z + 23], polished, 'z', 6);
  }
}
