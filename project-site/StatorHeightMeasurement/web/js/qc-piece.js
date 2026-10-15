// 逐顆量測站：作業員把整盒放上入料座、空盒放上出料座；SCARA 逐顆吸起 → 放上研磨碳化鎢量測砧 → 量測 → 吸起放進出料盒同一格（NG 丟進不良品滑槽）。
//   laser：量測頭滑台從南側滑入，兩點量工件頂面、第三點量砧面（差值＝高度），量完退回再讓手臂取件；開班以 45.000 塊規自動校正。
//   vision：兩組正交雙遠心相機＋平行背光拍側面輪廓，砧面與工件頂緣在同一張影像裡次像素擬合。
// 站本地座標：原點在站中心地面；SCARA 在北側，作業員在南側（+z）。
import * as THREE from 'three';
import { block, cylinder, decal } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { createHSR065 } from '@core/models/robots/denso-hsr065.js';
import { tagPart } from '@core/models/parts.js';
import { visionCamera } from '@core/models/vision.js';
import { LAYOUT, BOX } from './spec.js';
import { partMesh } from './parts.js';
import { createSuctionTool } from './unloader.js';
import { createBase, createEnclosure } from './qc-common.js';

export const QP = {
  // 取放點都在 SCARA 半徑 330～620 mm 的環帶內（J2 不進 >120° 的本體干涉區）
  scara: { x: 0, y: 960, z: -400 },
  inBox: { x: -450, z: -340 }, outBox: { x: 450, z: -340 }, boxYaw: Math.PI / 2, nestTop: 920,
  anvil: { x: -110, z: 30, top: 940 }, ng: { x: 120, z: 30, y: 1040 },
  table: [-760, 760, -740, 700], granite: { x0: -640, x1: 640, z0: -600, z1: 380 },
  heads: { measure: 330, park: 560, arm: 300, y: 1036, wait: 1125 },   // 量測頭滑台：滑座 z（量測／退回），臂長，頭底面高度
  cam: { y: 963, wd: 120 },
};
const steel = new THREE.MeshStandardMaterial({ color: 0x8c96a0, roughness: .35, metalness: .8 });
const carbide = new THREE.MeshStandardMaterial({ color: 0x9fa6ad, roughness: .12, metalness: .95 });
const glow = () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfefff, emissiveIntensity: 1.1, roughness: .3 });

export function createPieceStation(scene, part, plan) {
  const S = LAYOUT.qc.station, vision = plan.sensor === 'vision';
  const root = new THREE.Group(); root.name = 'qc station'; root.position.set(S.x, 0, S.z); scene.add(root);
  const { slabs } = createBase(root, { table: QP.table, granite: [QP.granite] });
  const G = 900;
  // ---- 入料座、出料座（盒子長邊沿 z）
  for (const b of [QP.inBox, QP.outBox]) {
    block(root, [320, 20, 480], [b.x, G + 10, b.z], MAT.steelDark);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(root, [40, 36, 16], [b.x + sx * 130, QP.nestTop + 18, b.z + sz * 232], MAT.yellow);
  }
  // 盒壁量測：每個盒座外側、南側各一支雷射位移計，量盒子實際位置（取放座標以此修正）
  const wallBeams = [], beamMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: .85 });
  for (const b of [QP.inBox, QP.outBox]) {
    const sx = Math.sign(b.x), y = QP.nestTop + 15;
    for (const [x, z, ax, to] of [[b.x + sx * (BOX.size[2] / 2 + 35), b.z, 'x', b.x + sx * BOX.size[2] / 2], [b.x, b.z + BOX.size[0] / 2 + 35, 'z', b.z + BOX.size[0] / 2]]) {
      block(root, ax === 'x' ? [30, 20, 40] : [40, 20, 30], [x, y, z], MAT.black).name = 'box wall sensor';
      const from = ax === 'x' ? x - sx * 15 : z - 15, len = Math.abs(from - to);
      const bm = cylinder(root, .8, len, ax === 'x' ? [(from + to) / 2, y, z] : [x, y, (from + to) / 2], beamMat, ax);
      bm.userData.fx = true; bm.name = 'wall sensor beam'; bm.visible = false; wallBeams.push(bm);
    }
  }
  decal(root, 120, 40, [QP.inBox.x, G + 21, QP.inBox.z + 300], [-Math.PI / 2, 0, 0], ['IN'], { color: '#1d2a36', bg: '#f2c230', center: true, bold: true });
  decal(root, 120, 40, [QP.outBox.x, G + 21, QP.outBox.z + 300], [-Math.PI / 2, 0, 0], ['OK OUT'], { color: '#e8eef3', bg: '#2a8a4a', center: true, bold: true });
  // ---- 量測砧（研磨碳化鎢）
  block(root, [120, 20, 120], [QP.anvil.x, G + 10, QP.anvil.z], steel);
  block(root, [100, QP.anvil.top - G - 20, 100], [QP.anvil.x, G + 20 + (QP.anvil.top - G - 20) / 2, QP.anvil.z], carbide).name = 'anvil';
  // 塊規座（開班自動校正用）
  block(root, [40, 45, 30], [QP.anvil.x - 130, G + 22.5, QP.anvil.z + 60], MAT.chrome).name = 'gauge block 45.000';
  // ---- NG 滑槽＋不良品盒（往南下滑到桌邊）
  const chute = new THREE.Group(); chute.name = 'ng chute'; root.add(chute);
  const a = new THREE.Vector3(QP.ng.x, 980, QP.ng.z + 20), b = new THREE.Vector3(QP.ng.x, 800, 560), mid = a.clone().add(b).multiplyScalar(.5);
  const len = a.distanceTo(b), ch = block(chute, [80, 4, len], [mid.x, mid.y, mid.z], MAT.red);
  ch.lookAt(b.x, b.y, b.z);
  for (const s of [-1, 1]) { const w = block(chute, [4, 40, len], [mid.x + s * 40, mid.y + 20, mid.z], MAT.red); w.quaternion.copy(ch.quaternion); }
  block(chute, [30, 70, 30], [QP.ng.x, G + 35, QP.ng.z], MAT.steelDark);
  const bin = new THREE.Group(); bin.name = 'ng bin'; root.add(bin);
  block(bin, [200, 4, 160], [QP.ng.x, 702, 640], MAT.red);
  for (const s of [-1, 1]) { block(bin, [200, 120, 4], [QP.ng.x, 760, 640 + s * 78], MAT.red); block(bin, [4, 120, 152], [QP.ng.x + s * 98, 760, 640], MAT.red); }
  const binParts = [0, 1, 2].map(k => { const m = partMesh(part, 'ng bin part'); m.rotation.z = Math.PI / 2; m.position.set(QP.ng.x - 40 + k * 40, 704 + 11, 640); m.visible = false; bin.add(m); return m; });
  // ---- 量測件（放在砧上的那一顆）
  const onAnvil = partMesh(part, 'part on anvil'); onAnvil.position.set(QP.anvil.x, QP.anvil.top, QP.anvil.z); root.add(onAnvil);

  // ---- SCARA
  const A = QP.scara;
  block(root, [280, A.y - G - 10, 280], [A.x, G + (A.y - G - 10) / 2, A.z], MAT.steelDark);
  block(root, [320, 10, 320], [A.x, A.y - 5, A.z], MAT.alu);
  const arm = createHSR065(); arm.root.position.set(A.x, A.y, A.z); root.add(arm.root); tagPart(arm.root, 'P-00205');
  const tool = createSuctionTool(arm.flange, part, 'qc tool');

  // ---- 量測：雷射位移頭滑台／遠心相機
  let heads = null, beams = [], cams = [], lights = [];
  if (!vision) {
    // 滑軌樑（南側，立柱撐在桌面）；滑座在樑頂、臂往北伸，量測頭吊在臂端。整組頂端 1110，低於手臂等待時的吸盤（1150）
    const H = QP.heads, ax = QP.anvil, beamZ = [ax.z + H.arm - 40, ax.z + H.arm + 320];
    block(root, [60, 40, beamZ[1] - beamZ[0]], [ax.x, 1060, (beamZ[0] + beamZ[1]) / 2], MAT.alu).name = 'head slide rail';
    block(root, [60, 1040 - 700, 60], [ax.x, 700 + (1040 - 700) / 2, beamZ[1] - 60], MAT.steelDark);
    heads = new THREE.Group(); heads.name = 'laser heads'; root.add(heads);
    block(heads, [70, 30, 90], [0, 1095, 0], MAT.steelDark);                       // 滑座
    block(heads, [40, 14, H.arm], [0, 1102, -H.arm / 2], MAT.alu);                  // 水平臂
    block(heads, [70, 8, 40], [17, 1100, -H.arm], MAT.alu);                         // 頭座
    for (const [dx, top] of [[0, true], [35, false]]) {                            // 工件頂面（砧中心）、砧面（偏 35 mm）
      const hd = cylinder(heads, 10, 60, [dx, H.y + 30, -H.arm], top ? MAT.black : MAT.steelBlue, 'y', 24); hd.name = 'confocal head';
      const beam = cylinder(heads, .8, 1, [dx, 0, -H.arm], new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: .85 }));
      beam.userData.fx = true; beam.name = 'measuring beam'; beams.push({ m: beam, dx, top });
    }
  } else {
    const C = QP.cam, ax = QP.anvil;
    // A：從西側看（光軸 +x），背光在東側；B：從南側看（光軸 −z），背光在北側
    const camA = visionCamera.create({ spot: false, axis: '+z', bodyW: 50, bodyD: 50, bodyL: 60, lensR: 38, lensL: 220, ringR: 0, fov: 12, bands: { ats: [-30, -170], r: 40, length: 8 } });
    camA.root.position.set(ax.x - 21 - C.wd, C.y, ax.z); camA.root.rotation.y = Math.PI / 2; root.add(camA.root);
    const camB = visionCamera.create({ spot: false, axis: '+z', bodyW: 50, bodyD: 50, bodyL: 60, lensR: 38, lensL: 220, ringR: 0, fov: 12, bands: { ats: [-30, -170], r: 40, length: 8 } });
    camB.root.position.set(ax.x, C.y, ax.z + 21 + C.wd); camB.root.rotation.y = Math.PI; root.add(camB.root);
    cams = [camA, camB];
    for (const [x, z, w] of [[ax.x - 21 - C.wd - 160, ax.z, 'x'], [ax.x, ax.z + 21 + C.wd + 160, 'z']]) block(root, w === 'x' ? [120, C.y - 38 - G, 60] : [60, C.y - 38 - G, 120], [x, G + (C.y - 38 - G) / 2, z], MAT.steelDark);
    const la = new THREE.Group(); la.name = 'backlight A'; root.add(la);
    block(la, [24, 100, 100], [ax.x + 82, C.y, ax.z], MAT.alu); block(la, [2, 90, 90], [ax.x + 69, C.y, ax.z], glow());
    block(la, [40, C.y - 50 - G, 40], [ax.x + 87, G + (C.y - 50 - G) / 2, ax.z], MAT.steelDark);
    const lb = new THREE.Group(); lb.name = 'backlight B'; root.add(lb);
    block(lb, [100, 100, 24], [ax.x, C.y, ax.z - 82], MAT.alu); block(lb, [90, 90, 2], [ax.x, C.y, ax.z - 69], glow());
    block(lb, [40, C.y - 50 - G, 40], [ax.x, G + (C.y - 50 - G) / 2, ax.z - 87], MAT.steelDark);
    lights = [la, lb];
  }
  const enc = createEnclosure(root, { x0: QP.table[0] - 20, x1: QP.table[1] + 20, z0: QP.table[2] - 20, z1: QP.table[3] + 20, sides: false });
  return { root, wallBeams, arm, tool, onAnvil, heads, beams, cams, lights, binParts, enc, slabs };
}
