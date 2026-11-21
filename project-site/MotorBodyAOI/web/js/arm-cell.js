// 手臂持件方案（R5）的機台幾何：手臂台座、DENSO VS-068＋三爪夾爪、換夾台（氣動翻轉 180°）、相機井（相機、光源、反射鏡探頭）、
// 入料輸送與 P0 置中＋定位相機、OK／NG 出料輸送、防護圍籬、三色燈與 HMI。世界座標同 arm-plan.js（Y 向上）。不碰 DOM。
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { create as createConveyor } from '@core/models/conveyor.js';
import { createVS068 } from '@core/models/robots/denso-vs068.js';
import { visionCamera } from '@core/models/vision.js';
import { signalTower, hmi } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { tagPart } from '@core/models/parts.js';
import { JAWS, FINGERS, BAND_CENTER, LOCATOR } from './optics-plan.js';
import * as OPT from './optics-plan.js';
import { CELL, GRIP_LEN, layout, partPoint, partDir } from './arm-plan.js';
import { ARM_CAMERAS } from './arm-optics.js';
import { buildCameraUnit, addMount, frustum, markFx, PART } from './optics-scene.js';

export const ARM_COLOR = { C0: 0x20c997, R1: 0x3d8bfd, R2: 0xf08c2e, R3: 0xf2c230, R4: 0xe8590c, R5: 0xd6336c };
export const ARM_PART = { arm: 'P-00151' };
const rad = d => d * Math.PI / 180;

// 夾持帶中心的世界高度：入料（開口朝下，站在凸緣頂 Z +1.5）、出料（法蘭朝下，站在止口端 Z −69）
export const PICK_BAND = CELL.table + (1.5 - BAND_CENTER);
export const OUT_BAND = CELL.table + (BAND_CENTER + 69);

// ---------------------------------------------------------------- 底座、相機井、圍籬
export function buildArmFrame(scene) {
  const g = new THREE.Group(); g.name = 'frame'; scene.add(g);
  const [ax, ay, az] = CELL.armBase;
  block(g, [220, ay - 16, 220], [ax, (ay - 16) / 2, az], MAT.steelDark);              // 手臂台座
  block(g, [300, 16, 300], [ax, ay - 8, az], MAT.steel);                               // 安裝板
  // 相機井：底櫃上板（相機立柱都鎖在這裡），前方半圈
  block(g, [1480, CELL.well - 60, 720], [0, (CELL.well + 60) / 2 - 30, 450], MAT.cabinet);
  block(g, [1500, 14, 740], [0, CELL.well - 7, 450], MAT.steelDark);
  // 圍籬：後方與兩側透明板，前方（操作側）留門口裝安全光柵；入出料輸送帶從兩側穿出
  const F = CELL.fence, glass = std(0x9fc7e6, .1, 0, { transparent: true, opacity: .12, depthWrite: false });
  for (const x of F.x) for (const z of F.z) block(g, [40, F.h, 40], [x, F.h / 2, z], MAT.frame);
  for (const z of F.z) block(g, [F.x[1] - F.x[0], 40, 40], [0, F.h - 20, z], MAT.frame);
  for (const x of F.x) block(g, [40, 40, F.z[1] - F.z[0]], [x, F.h - 20, (F.z[0] + F.z[1]) / 2], MAT.frame);
  block(g, [F.x[1] - F.x[0] - 80, F.h - 300, 4], [0, 150 + (F.h - 300) / 2, F.z[0]], glass);
  for (const x of F.x) {                                                                // 側板：輸送帶穿出處（Z −420 ~ −60）挖開
    block(g, [4, F.h - 300, F.z[1] - (-40) - 60], [x, 150 + (F.h - 300) / 2, (-40 + F.z[1]) / 2], glass);
    block(g, [4, F.h - 300, -440 - F.z[0] - 40], [x, 150 + (F.h - 300) / 2, (F.z[0] + -440) / 2], glass);
    block(g, [4, F.h - 1100, 380], [x, 1100 + (F.h - 1100) / 2 - 100, -250], glass);
  }
  for (const s of [-1, 1]) block(g, [F.x[1] - 700, F.h - 300, 4], [s * (F.x[1] - (F.x[1] - 700) / 2), 150 + (F.h - 300) / 2, F.z[1]], glass);   // 前方兩側；中間 1,400 是門口（光柵）
  return g;
}

// ---------------------------------------------------------------- 手臂＋三爪夾爪（法蘭 +Z 為前進方向）
// 夾爪：本體 Ø180×38（長行程三爪氣動夾爪）、3 爪 0/120/240°、爪柱 r 64–74、爪頭夾 Ø100 帶開口側半段（爪頭中心在法蘭面前 135.5 mm）。
//   從法蘭側夾（開口側朝相機）：TCP（夾持帶中心）在 128；從開口側夾（法蘭側朝相機）：TCP 在 143（帶中心在爪頭更前方 7.5 mm）
export const GRIPPER = { hubR: 90, hubL: 38, plate: 10, jawZ: 135.5, tcpO: 128, tcpF: 143 };
// 手臂基座轉 CELL.armYaw：讓所有工作點落在 J1 ±170° 的中間（取件、換夾台、OK／NG 出料、相機井前方半圈）
export function buildArm(scene) {
  const mount = new THREE.Group(); mount.name = 'robot'; mount.position.set(...CELL.armBase); mount.rotation.y = rad(CELL.armYaw); scene.add(mount);
  const arm = createVS068({ name: 'robot-arm' });
  mount.add(arm.root); tagPart(arm, ARM_PART.arm); mount.updateMatrixWorld(true);
  const G = GRIPPER, tool = new THREE.Group(); tool.name = 'gripper'; arm.tool.add(tool);
  cylinder(tool, 40, G.plate, [0, 0, G.plate / 2], MAT.steelDark, 'z', 24);
  cylinder(tool, G.hubR, G.hubL, [0, 0, G.plate + G.hubL / 2], MAT.alu, 'z', 40);
  const hubEnd = G.plate + G.hubL, jz0 = G.jawZ - (JAWS.z[1] - JAWS.z[0]) / 2, jz1 = G.jawZ + (JAWS.z[1] - JAWS.z[0]) / 2;
  const jaws = [];
  for (const a of JAWS.angles) {
    const j = new THREE.Group(); j.name = `grip-jaw-${a}`; j.rotation.z = rad(a); tool.add(j);
    const slide = new THREE.Group(); slide.name = 'grip-slide'; j.add(slide); jaws.push(slide);
    block(slide, [10, JAWS.width, jz0 - hubEnd + 2], [69, 0, (hubEnd - 2 + jz0) / 2], MAT.steelBlue);      // 爪柱（r 64–74）
    Object.assign(block(slide, [24, JAWS.width, jz1 - jz0], [62, 0, G.jawZ], MAT.steelBlue).userData, { contact: true });   // 爪頭（內面 r 50）
  }
  const tcpO = new THREE.Object3D(); tcpO.name = 'tcp-O'; tcpO.position.z = G.tcpO; tool.add(tcpO);
  const tcpF = new THREE.Object3D(); tcpF.name = 'tcp-F'; tcpF.position.z = G.tcpF; tool.add(tcpF);
  const setOpen = open => { for (const s of jaws) s.position.x = open * JAWS.stroke; };
  setOpen(1);
  return { arm, mount, tool, tcpO, tcpF, setOpen };
}

// ---------------------------------------------------------------- 換夾台：旋轉軸沿世界 X、通過夾持帶中心；兩夾指在工件 90/270°（軸上）夾帶法蘭側半段，
// U 形框在工件後方（翻轉後到前方），上方永遠空著讓手臂沿工件軸進出。翻轉用氣動旋轉缸（不加伺服）。
export function buildStand(scene) {
  const g = new THREE.Group(); g.name = 'stand'; scene.add(g);
  const c = new THREE.Vector3(...CELL.stand), xa = -175;      // 旋轉缸在 −X 側（離手臂遠的一側）
  block(g, [80, c.y - 50, 80], [c.x + xa - 20, (c.y - 50) / 2, c.z], MAT.steelDark);   // 立柱
  block(g, [70, 100, 100], [c.x + xa - 20, c.y, c.z], MAT.black);                       // 旋轉缸
  const rotor = new THREE.Group(); rotor.name = 'stand-rotor'; rotor.position.copy(c); g.add(rotor);
  cylinder(rotor, 10, 26, [xa + 27, 0, 0], MAT.chrome, 'x', 16);                         // 輸出軸
  // 開口朝下時夾指高度：工件 Z −44 ~ −34 → 帶中心上方 3.5 ~ 13.5
  const y0 = -(FINGERS.z[1] - BAND_CENTER), y1 = -(FINGERS.z[0] - BAND_CENTER), yc = (y0 + y1) / 2, h = y1 - y0;
  for (const s of [-1, 1]) {
    block(rotor, [40, 36, 46], [s * 140, yc, 0], MAT.alu);                               // 夾指氣缸
    block(rotor, [16, 16, 120], [s * 140, yc, -80], MAT.steelBlue);                      // U 形框側臂（往工件後方）
  }
  block(rotor, [296, 16, 16], [0, yc, -148], MAT.steelBlue);                             // U 形框橫樑
  const fingers = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Group(); f.name = 'stand-finger'; rotor.add(f); fingers.push({ f, s });
    block(f, [62, 8, FINGERS.width - 4], [s * 89, yc, 0], MAT.alu);                     // 指桿（伸進氣缸）
    Object.assign(block(f, [10, h, FINGERS.width], [s * 55, yc, 0], MAT.pu).userData, { contact: true });   // 指墊（內面 r 50）
  }
  // ang：0 開口朝下（U 形框在後）、180 開口朝上（U 形框在前）；open：0 夾、1 開（每指退 15 mm）
  const set = (ang, open) => { rotor.rotation.x = rad(ang); for (const { f, s } of fingers) f.position.x = s * open * 15; };
  set(0, 1);
  return { group: g, set, center: c };
}

// ---------------------------------------------------------------- 輸送：入料（P0 置中＋定位）、OK 出料、NG 出料（並排緩衝）
export function buildArmConveyors(scene) {
  const g = new THREE.Group(); g.name = 'conveyors'; scene.add(g);
  const [px, , pz] = CELL.pick;
  const inC = createConveyor({ length: 760, width: 160, height: CELL.table, pitch: 70, roller: 20 });
  inC.root.position.set(px - 300, 0, pz); g.add(inC.root); tagPart(inC, 'P-00260'); Object.assign(inC.root.userData, { contact: true });
  const mk = (x, z, name) => { const c = createConveyor({ length: 760, width: 160, height: CELL.table, pitch: 70, roller: 20 }); c.root.name = name; c.root.position.set(x + 300, 0, z); g.add(c.root); tagPart(c, 'P-00260'); Object.assign(c.root.userData, { contact: true }); return c; };
  const okC = mk(CELL.okOut[0], CELL.okOut[2], 'ok-conveyor'), ngC = mk(CELL.ngOut[0], CELL.ngOut[2], 'ng-conveyor');
  // P0 置中：輸送帶兩側（±Z）兩塊 V 形塊（氣動平行夾），夾 Ø100 帶法蘭側半段；來料從張開的兩塊中間通過，光電感測停帶後閉合置中，
  //   判角讀碼後退開 40 mm（大於手臂夾爪爪柱的最大半徑 88）讓手臂下來夾
  const cg = new THREE.Group(); cg.name = 'centering'; g.add(cg);
  const yv0 = PICK_BAND + (BAND_CENTER - FINGERS.z[1]) + 1, yv1 = PICK_BAND + (BAND_CENTER - FINGERS.z[0]), yc = (yv0 + yv1) / 2;
  const vs = [];
  for (const s of [-1, 1]) {
    block(cg, [90, 40, 60], [px, yc, pz + s * 180], MAT.black);                            // 氣缸本體
    block(cg, [40, yc - 20, 40], [px, (yc - 20) / 2, pz + s * 190], MAT.steelDark);        // 支架立柱（輸送帶外側）
    const v = new THREE.Group(); v.name = 'centering-v'; cg.add(v); vs.push({ v, s });
    for (const sd of [-1, 1]) {
      const m = block(v, [46, yv1 - yv0, 8], [px + sd * 26, yc, pz + s * 52], MAT.ppDark); m.rotation.y = s * sd * rad(35);
      Object.assign(m.userData, { contact: true });
    }
    block(v, [16, 10, 86], [px, yc, pz + s * 105], MAT.alu);                               // 推桿（伸進氣缸）
  }
  const setCenter = open => { for (const { v, s } of vs) v.position.z = s * open * 40; };
  setCenter(1);
  return { group: g, inC, okC, ngC, setCenter };
}

// 反射鏡探頭支柱：沿工件軸落到 R3 相機鏡頭前 60 mm，再沿支柱的徑向水平外移 150 mm 後落到相機井（避開正下方的相機與調整座）
function probeRoute(T) {
  const cam = ARM_CAMERAS.find(c => c.mirror), stem = partPoint(T, [-27, 0, -18]), axis = partPoint(T, [0, 0, -18]);
  const realY = (() => { const { realCamera, derive } = OPT; return partPoint(T, realCamera(cam, derive(cam)).pos).y; })();
  return { yBot: realY + 60, stemTop: [-27, 0, -18], out: { dir: [stem.x - axis.x, stem.z - axis.z], len: 150, yFloor: CELL.well } };
}

// ---------------------------------------------------------------- 相機井：實體相機 5 台（同一台的第二筆拍攝設定只加光源）＋反射鏡探頭＋P0 定位相機
export function buildArmOptics(scene) {
  const g = new THREE.Group(); g.name = 'optics'; scene.add(g);
  const mounts = new THREE.Group(); mounts.name = 'camera-mounts'; scene.add(mounts);
  const viz = new THREE.Group(); viz.name = 'optics-viz'; scene.add(viz);
  const L = layout(), units = {}, rigs = {};
  for (const cam of ARM_CAMERAS) {
    const T = L.segT[cam.seg], first = !rigs[cam.rig];
    const u = buildCameraUnit({
      scene, g, mounts, viz, cam, color: ARM_COLOR[cam.rig], name: first ? cam.rig : cam.id, withBody: first, withFrustum: first,
      W: p => partPoint(T, p), D: v => partDir(T, v).normalize(), mount: { yEnd: CELL.well, gap: 40 }, probe: probeRoute(T),
    });
    u.station = cam.seg; units[cam.id] = u; if (first) rigs[cam.rig] = u;
  }
  // R1 分區環形光：手臂方案工件軸傾斜，環跟著工件軸轉；加支柱落到相機井
  const ring = g.getObjectByName('ps-ring-R1-1');
  if (ring) {
    const T = L.segT.F1, axis = partDir(T, [0, 0, -1]).normalize();
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.clone().negate());
    const foot = ring.position.clone(); foot.y = CELL.well;
    const top = ring.position.clone().addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(ring.quaternion), -126);
    const post = new THREE.Mesh(new THREE.BoxGeometry(16, top.y - CELL.well, 16), MAT.frame);
    post.position.set(top.x, (top.y + CELL.well) / 2, top.z); post.castShadow = true; g.add(post);
  }
  // P0 定位相機：25 mm 鏡頭（WD 約 485）、離垂直 60°、從取件位的後左方斜看法蘭側 3 耳＋QR；離工件軸 420 mm，手臂沿工件軸上下取件不會掃到
  const lc = { ...LOCATOR, f: 25 }, lm = 7.07 / lc.fovH, lwd = lc.f * (1 + lm) / lm;
  const tgt = new THREE.Vector3(CELL.pick[0], PICK_BAND + BAND_CENTER + 69, CELL.pick[2]);     // 開口朝下：法蘭側止口端（Z −69）在最上方
  const dir = new THREE.Vector3(-Math.sin(rad(60)) * Math.SQRT1_2, Math.cos(rad(60)), -Math.sin(rad(60)) * Math.SQRT1_2), lpos = tgt.clone().addScaledVector(dir, lwd);
  const locator = visionCamera.create({ name: 'camera-C0', bodyW: 44, bodyD: 44, bodyL: 52, lensR: 19, lensL: 58, ringR: 70, fov: 2 * Math.atan(lc.fovH / 2 / lwd) * 180 / Math.PI });
  locator.root.position.copy(lpos); locator.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate()); g.add(locator.root); tagPart(locator, PART.cam5);
  addMount(mounts, 'mount-C0', lpos, dir.clone().negate(), 110, { yEnd: 0, gap: 75 });
  const lg = new THREE.Group(); lg.name = 'viz-C0'; viz.add(lg);
  const fwd = dir.clone().negate(), right = new THREE.Vector3(1, 0, -1).normalize(), up = right.clone().cross(fwd).negate();
  frustum(lg, lpos, fwd, right, up, lwd, lc.fovH * 1.2, lc.fovH, lwd + 20, ARM_COLOR.C0);
  markFx(viz);
  return { group: g, viz, cams: units, rigs, locator };
}

export function buildArmIndicators(scene) {
  const g = new THREE.Group(); g.name = 'indicators'; scene.add(g);
  const F = CELL.fence;
  const tower = signalTower.create({ poleH: 260 }); tower.root.position.set(F.x[1] - 60, F.h, F.z[0] + 60); g.add(tower.root); tagPart(tower, PART.tower);
  const panel = hmi.create({ display: true }); panel.root.position.set(F.x[1] + 160, 1350, F.z[1] - 120); panel.root.rotation.y = -Math.PI / 4; g.add(panel.root); tagPart(panel, PART.hmi);
  const curtain = lightCurtain.create({ span: 1400, height: 1300, beam: {} }); curtain.root.position.set(0, 100, F.z[1] + 30); g.add(curtain.root); tagPart(curtain, PART.curtain);
  return { group: g, tower, panel, curtain };
}
export { GRIP_LEN };
