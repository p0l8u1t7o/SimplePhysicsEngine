// 機台幾何：機架與潔淨外罩（FFU）、邊皮帶輸送與載台定位、Tray 抽屜與上面檢查橋、SCARA 周邊的上視站（3D 輪廓儀、上視相機、
// 離子風刀、IPA 擦拭、吹乾槽、NG 盒）、背側的鎖附模組（X 軸＋壓持爪＋隨行取釘＋伺服起子）。
// 世界座標（mm）：X 沿產線往東（載台由西進、東出）、Y 向上、Z 向前（操作側）；輸送中心 Z = 0，組裝位 X = 0。不碰 DOM。
import * as THREE from 'three';
import { block, cylinder, plate, decal, screw } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { carrier as dragChain } from '@core/electrical/cable-routing.js';
import { edgeBeltConveyor, stopper } from '@core/models/transport.js';
import { linearAxis, slideTable, nutrunner, airCylinder } from '@core/models/motion.js';
import { visionCamera, laserProfiler } from '@core/models/vision.js';
import { barLight } from '@core/models/lights.js';
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { boxSensor } from '@core/models/sensors.js';
import { ionizer } from '@core/models/equipment.js';
import { tagPart } from '@core/models/parts.js';
import { CARRIER, PCB, TRAY, MOD, SOC, INT, STACK, SCREW, createTray } from './parts.js';
import { REF } from './refs.js';

// ---------------------------------------------------------------- 配置
export const LAY = {
  table: 760,                                  // 台面（下方電控櫃）
  x0: -760, x1: 760, z0: -560, z1: 900, top: 2050,   // 外罩（含 FFU 下緣）
  conv: { top: 900, width: 300, len: 1760 },    // 邊皮帶輸送：輸送面高 900（SMT 標準）、軌內間距 300
  work: 0,                                     // 組裝位：載台中心 X
  robot: { x: 0, z: 400, y: 840 },             // SCARA 底座底面中心
  lane: { I: -560, S: 560 },                   // Tray 抽屜中心 X（西：interposer、東：SOCAMM）
  tray: { pick: 420, scan: 645, load: 740 },   // Tray 中心 Z：取料位、上面檢查橋、裝盤位（前門）
  trayBottom: 900,
  st: {                                        // SCARA 周邊的上視站（X, Z）
    // SCARA 半徑 ≥ 330 mm（J2 ≤ 120°，避開基座柱干涉區）、Z ≥ 210（輸送前軌在 170）
    prof: [-345, 215], camI: [-350, 300], blow: [370, 215], camS: [350, 300], wipe: [230, 700], dry: [190, 815],
    ngI: [-230, 690], ngS: [310, 560],
  },
  locker: { z: -300, beamY: 1000, park: -530 },  // 鎖附 X 軸（背側）、待機位
};
export const CARRIER_D = LAY.conv.width - 14;                    // 載台寬（跨在兩條邊皮帶上，避開上方壓邊）
export const LIFT = .9;                                          // 定位頂升：載台上推 0.9 mm 靠上壓邊
export const pcbTopAt = lift => LAY.conv.top + lift + CARRIER.t + CARRIER.standoff + PCB.t;
export const PCB_TOP = pcbTopAt(LIFT);
export const INT_Y = PCB_TOP + STACK.intGap;                     // interposer 底面（入位）
export const SOC_Y = press => INT_Y + INT.t + (STACK.socFree + (STACK.socPressed - STACK.socFree) * press);   // SOCAMM 底面（press 0 自由、1 壓持）
export const SOC_TOP = press => SOC_Y(press) + SOC.t;            // SOCAMM PCB 頂面（螺絲頭座面）

const glassMat = std(0xa9cfe8, .08, 0, { transparent: true, opacity: .11, depthWrite: false, side: THREE.DoubleSide });
const ffuMat = std(0xe7eaec, .55, .2);
const esdMat = std(0x2a6f97, .6, .05);
const puMat = std(0xe0b04a, .9, 0);
const air = (opacity = .22) => new THREE.MeshBasicMaterial({ color: 0xc6ecff, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
const group = (parent, name) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
const fx = o => { o.userData.fx = true; return o; };

// ---------------------------------------------------------------- 機架、下方電控櫃、潔淨外罩（FFU、透明門、側邊載台通道）
export function buildFrame(scene) {
  const g = group(scene, 'frame'), L = LAY, T = L.table, W = L.x1 - L.x0, D = L.z1 - L.z0, cz = (L.z0 + L.z1) / 2;
  // 下方電控櫃（腳座＋櫃體＋前門＋散熱孔）與台面
  for (const x of [L.x0 + 60, L.x1 - 60]) for (const z of [L.z0 + 60, L.z1 - 60]) { cylinder(g, 28, 40, [x, 20, z], MAT.black, 'y', 16); cylinder(g, 10, 30, [x, 55, z], MAT.chrome, 'y', 12); }
  block(g, [W - 20, T - 100, D - 20], [0, 70 + (T - 100) / 2, cz], MAT.cabinet);
  block(g, [W, 20, D], [0, T - 10, cz], MAT.steelDark);
  for (const [x0, x1] of [[L.x0 + 30, -10], [10, L.x1 - 30]]) {
    block(g, [x1 - x0 - 10, T - 180, 3], [(x0 + x1) / 2, 110 + (T - 180) / 2, L.z1 - 9], std(0xcfd4d8, .45, .25));
    block(g, [14, 120, 12], [x1 - 40, 420, L.z1 - 2], MAT.black);                                          // 門把
    for (let i = 0; i < 6; i++) block(g, [120, 4, 2], [(x0 + x1) / 2 - 60, 200 + i * 14, L.z1 - 7], MAT.steelDark);   // 散熱孔
  }
  plate(g, ['電控櫃（PLC、伺服驅動、視覺工控機）'], 360, 50, [L.x0 + 260, 300, L.z1 - 6], 0);
  // 上框（鋁擠型 40 × 40）：四柱、頂框、中間橫樑
  const H = L.top - 250;                                                                                   // FFU 下緣
  for (const x of [L.x0 + 20, L.x1 - 20]) for (const z of [L.z0 + 20, L.z1 - 20]) block(g, [40, H - T, 40], [x, (H + T) / 2, z], MAT.frame);
  for (const z of [L.z0 + 20, L.z1 - 20]) block(g, [W, 40, 40], [0, H - 20, z], MAT.frame);
  for (const x of [L.x0 + 20, L.x1 - 20]) block(g, [40, 40, D - 80], [x, H - 20, cz], MAT.frame);
  for (const z of [L.z0 + 20, L.z1 - 20]) block(g, [W - 80, 40, 40], [0, T + 20, z], MAT.frame);           // 台面上的下框
  // FFU（風機過濾單元，一萬級潔淨）：箱體＋HEPA 格柵＋風機蓋
  const ffu = group(g, 'ffu');
  block(ffu, [W, 230, D], [0, L.top - 115, cz], ffuMat);
  for (let i = 0; i < 14; i++) block(ffu, [W - 120, 3, 4], [0, H - 1.5, L.z0 + 60 + i * (D - 120) / 13], MAT.steel);
  for (const x of [-360, 360]) { cylinder(ffu, 150, 30, [x, L.top + 15, cz], MAT.steelDark, 'y', 32); cylinder(ffu, 60, 32, [x, L.top + 17, cz], MAT.black, 'y', 20); }
  plate(ffu, ['FFU（HEPA，ISO 7／一萬級，示意）'], 520, 60, [200, L.top - 110, L.z1 + 2], 0);
  // 透明防護：背面、兩側（留載台通道）、前門兩扇（把手、門開關）
  const GH = H - 40 - T - 40, gy = T + 40 + GH / 2;
  block(g, [W - 80, GH, 4], [0, gy, L.z0 + 20], glassMat);
  const tunnel = { y0: LAY.conv.top - 70, y1: LAY.conv.top + 80, z0: -LAY.conv.width / 2 - 60, z1: LAY.conv.width / 2 + 60 };
  for (const x of [L.x0 + 20, L.x1 - 20]) {
    const pz = [[L.z0 + 40, tunnel.z0], [tunnel.z1, L.z1 - 40]];
    for (const [a, b] of pz) block(g, [4, GH, b - a], [x, gy, (a + b) / 2], glassMat);
    block(g, [4, H - 40 - tunnel.y1, tunnel.z1 - tunnel.z0], [x, (H - 40 + tunnel.y1) / 2, 0], glassMat);
    block(g, [4, tunnel.y0 - T - 40, tunnel.z1 - tunnel.z0], [x, (tunnel.y0 + T + 40) / 2, 0], glassMat);
    // 通道框（防止手伸入，示意）
    for (const y of [tunnel.y0, tunnel.y1]) block(g, [30, 8, tunnel.z1 - tunnel.z0 + 16], [x, y, 0], MAT.alu);
  }
  for (const [x0, x1] of [[L.x0 + 40, -2], [2, L.x1 - 40]]) {
    block(g, [x1 - x0 - 4, GH, 4], [(x0 + x1) / 2, gy, L.z1 - 20], glassMat);
    block(g, [12, 160, 18], [x0 < 0 ? x1 - 40 : x0 + 40, 1300, L.z1 - 2], MAT.alu);              // 門把
  }
  block(g, [30, 40, 20], [0, 1700, L.z1 - 10], MAT.yellow);                                         // 門互鎖開關（示意）
  // 前方取放 Tray 的小窗（抽屜開口）
  for (const x of [LAY.lane.I, LAY.lane.S]) block(g, [180, 6, 30], [x, LAY.trayBottom + 60, L.z1 - 20], MAT.alu);
  return g;
}

// 三色燈、HMI、急停、標牌（現場作業員看得到的位置）
export function buildIndicators(scene) {
  const g = group(scene, 'indicators'), L = LAY;
  const tower = signalTower.create({ poleH: 160 }); tower.root.position.set(L.x1 - 70, L.top, L.z1 - 70); g.add(tower.root); tagPart(tower, REF.tower);
  const panel = hmi.create({ display: true }); panel.root.position.set(L.x1 + 40, 1380, L.z1 - 200); panel.root.rotation.y = Math.PI / 2; g.add(panel.root); tagPart(panel, REF.hmi);
  block(g, [30, 30, 260], [L.x1 + 10, 1380, L.z1 - 200], MAT.frame);                                 // HMI 懸臂
  const e = estop.create(); e.root.position.set(L.x1 - 160, 1000, L.z1 + 2); g.add(e.root); Object.assign(e.root.userData, { noBom: '電控櫃配電材料（電控盤一式）內含' });
  plate(g, ['SOCAMM 檢測組裝機（示意）'], 420, 70, [-480, L.top - 110, L.z1 + 2], 0);
  return { group: g, tower, panel };
}

// ---------------------------------------------------------------- 邊皮帶輸送、載台定位（頂升＋定位銷、不推靠邊）、止擋、到位感測
export function buildConveyor(scene) {
  const g = group(scene, 'conveyor'), C = LAY.conv;
  const conv = edgeBeltConveyor.create({ length: C.len, width: C.width, top: C.top, legs: false, cross: false, drive: { pos: [540, C.top - 95, -C.width / 2 - 70] },
    pulleys: {}, lip: {}, marks: {}, adjust: { x: [-500, 500] } });
  g.add(conv.root); tagPart(conv, REF.conveyor);
  // 台面上的支撐座（取代落地支腳）
  for (const x of [-620, -250, 250, 620]) for (const s of [-1, 1]) block(g, [40, C.top - 38 - LAY.table, 40], [x, (C.top - 38 + LAY.table) / 2, s * (C.width / 2 + 10)], MAT.frame);
  // 止擋（組裝位東端）
  const stop = stopper.create({ stroke: 14 }); stop.root.position.set(LAY.work + CARRIER.w / 2 + 6, C.top, 0); g.add(stop.root); tagPart(stop, REF.stopper);
  // 定位單元：氣缸＋頂升板（隨活塞桿）＋2 支定位銷（對角）＋PEEK 支撐條；載台上推 0.9 mm 靠上壓邊（夾持），不從側邊推
  const cyl = airCylinder.create({ w: 32, h: 40, d: 32, rodR: 6, rodL: 30, stroke: 7.9 });
  cyl.root.position.set(LAY.work, C.top - 79, 0); g.add(cyl.root); tagPart(cyl, REF.cylinder);
  block(g, [60, C.top - 99 - LAY.table, 60], [LAY.work, (C.top - 99 + LAY.table) / 2, 0], MAT.steelDark);
  const lift = group(cyl.tip, 'locate-lift'); Object.assign(lift.userData, { cableHost: false });
  block(lift, [CARRIER.w - 20, 6, 150], [0, 3, 0], MAT.alu);
  for (const [x, z] of [[-CARRIER.w / 2 + 20, -CARRIER_D / 2 + 20], [CARRIER.w / 2 - 20, CARRIER_D / 2 - 20]]) {
    block(lift, [24, 6, Math.abs(z) - 60], [x, 3, z / 2 + Math.sign(z) * 30], MAT.alu);   // 銷座臂
    cylinder(lift, 6, 10, [x, 11, z], MAT.steelDark, 'y', 16);
    cylinder(lift, 3.6, 14, [x, 23, z], MAT.chrome, 'y', 16);                                     // 定位銷（插入載台襯套孔）
  }
  for (const z of [-80, 80]) block(lift, [CARRIER.w - 60, 20, 12], [0, 16, z], MAT.ppDark);     // 支撐條（PEEK），頂到載台底面
  const sensors = [];
  for (const x of [-560, LAY.work - 120, LAY.work + 150, 560]) {
    const s = boxSensor.create(); s.root.position.set(x, C.top + 20, -C.width / 2 - 34); s.root.rotation.y = Math.PI / 2; g.add(s.root);
    Object.assign(s.root.userData, { noBom: '輸送段附屬（邊皮帶輸送模組內含）' }); sensors.push(s);
  }
  // lift 0～1：頂升板（0 下、1 上：定位銷插入、載台上推 LIFT）
  const set = ({ s = 0, stopUp = 1, up = 0 }) => { conv.set({ s }); stop.set(stopUp); cyl.set({ ext: up }); };
  set({});
  return { group: g, conv, set, sensors };
}

// ---------------------------------------------------------------- Tray 抽屜（伺服滑台沿 Z）＋上面檢查橋
// 上面檢查：interposer 道＝下視 3D 線雷射（頂面 PIN 尖端與平整度）＋2D 相機（鍍金接點外觀）；SOCAMM 道＝2D 相機＋雙側條形光（正面外觀）
export function buildTrayLane(scene, key) {
  const g = group(scene, key === 'I' ? 'tray-interposer' : 'tray-socamm'), x = LAY.lane[key], T = LAY.tray;
  const axis = linearAxis.create({ axis: 'z', length: 520, width: 110, height: 40, carL: 160, carH: 30 });
  const ax0 = (T.pick + T.load) / 2 - 20;
  axis.root.position.set(x, LAY.table + 30, ax0); g.add(axis.root); tagPart(axis, REF.trayAxis);
  block(g, [150, 30, 560], [x, LAY.table + 15, ax0], MAT.steelDark);                                         // 底座
  // 抽屜台（隨滑座）：載盤板、靠邊塊、真空吸附口
  const nest = group(axis.carriage, 'tray-nest'); Object.assign(nest.userData, { cableHost: false });
  const carTop = 40 + 4 + 30, nestH = LAY.trayBottom - (LAY.table + 30) - carTop;
  block(nest, [60, nestH - 6, 60], [0, carTop + (nestH - 6) / 2, 0], MAT.alu);
  block(nest, [TRAY.w + 20, 6, TRAY.d + 20], [0, carTop + nestH - 3, 0], MAT.alu);
  for (const s of [-1, 1]) block(nest, [6, 10, 40], [s * (TRAY.w / 2 + 4), carTop + nestH + 5, -TRAY.d / 2 + 30], MAT.steelBlue);
  block(nest, [40, 10, 6], [0, carTop + nestH + 5, -TRAY.d / 2 - 4], MAT.steelBlue);
  const tray = createTray(key === 'I' ? 'tray-I' : 'tray-S', key === 'I' ? 'INTERPOSER TRAY' : 'SOCAMM TRAY');
  tray.position.set(0, carTop + nestH + .05, 0); nest.add(tray);
  const chain = dragChain(g, key + ' tray drag chain', { origin: [x + Math.sign(x) * 100, LAY.table + 16, ax0], axis: [0, 0, 1], rise: [0, 1, 0], fixed: -150, min: -160, max: 200, radius: 30, width: 26, pitch: 14 });
  // 上面檢查橋
  // 檢查橋做成懸臂：立柱只在外側（靠機台側板），橫樑伸到 Tray 內側邊，讓出 SCARA 在機台中段的移動空間
  // 橫樑頂面 1078：低於 SCARA 第二臂 Z 軸拖鏈固定座的底面（約 1082），手臂從上方掠過
  const bz = T.scan, beamY = 1042, so = Math.sign(x), bx0 = x + so * 160, bx1 = x - so * 95;
  block(g, [40, beamY - LAY.table, 60], [x + so * 140, (beamY + LAY.table) / 2, bz], MAT.frame);
  block(g, [Math.abs(bx0 - bx1), 36, 60], [(bx0 + bx1) / 2, beamY + 18, bz], MAT.frame);
  block(g, [12, 120, 50], [x + so * 114, beamY - 60, bz], MAT.alu);                                   // 斜撐板（示意）
  const top = LAY.trayBottom + TRAY.floor + 2 + (key === 'I' ? INT.t + INT.pin : SOC.t + SOC.pkgH);
  const out = { group: g, axis, nest, tray, chain, x, z0: ax0 };
  if (key === 'I') {
    const prof = laserProfiler.create({ axis: '-y', fanW: 100, range: 50, w: 70, h: 44, length: 90 });
    prof.root.position.set(x, top + 47.5 + 45 + 3, bz - 20); prof.root.rotation.y = 0; g.add(prof.root); tagPart(prof, REF.profilerTop);
    block(g, [80, beamY - (top + 47.5 + 90 + 3), 10], [x, (beamY + top + 47.5 + 90 + 3) / 2, bz - 20 - 27], MAT.alu);
    const cam = visionCamera.create({ axis: '-y', ringR: 26, fov: 42, view: { fov: 42, aspect: 1.6, near: 5, far: 800 }, lensL: 30 });
    cam.root.position.set(x, top + 150, bz + 30); g.add(cam.root); tagPart(cam, REF.camTop);
    block(g, [50, beamY - (top + 150 + 30 + 47), 10], [x, (beamY + top + 150 + 77) / 2, bz + 30 - 27], MAT.alu);
    Object.assign(out, { prof, cam });
  } else {
    const cam = visionCamera.create({ axis: '-y', ringR: 0, fov: 42, view: { fov: 42, aspect: 1.6, near: 5, far: 800 }, lensL: 30 });
    cam.root.position.set(x, top + 170, bz); g.add(cam.root); tagPart(cam, REF.camTop);
    block(g, [50, beamY - (top + 170 + 77), 10], [x, (beamY + top + 170 + 77) / 2, bz - 27], MAT.alu);
    const bars = [];
    for (const s of [-1, 1]) {
      const b = barLight.create({ length: 160, w: 24, h: 20, lensW: 18, lensT: 4, axis: 'x' });
      b.root.position.set(x, top + 50, bz + s * 70); b.root.rotation.x = s * .9; g.add(b.root); tagPart(b, REF.bar); bars.push(b);
      block(g, [12, beamY - (top + 50) - 10, 12], [x + 90, (beamY + top + 50) / 2 - 5, bz + s * 70], MAT.alu);
      block(g, [100, 10, 12], [x + 45, top + 50, bz + s * 70], MAT.alu);
    }
    Object.assign(out, { cam, bars });
  }
  // z：Tray 中心的世界 Z；laser／flash：檢查橋
  out.set = ({ z = T.pick, laser = 0, flash = 0 }) => {
    axis.set({ pos: z - ax0 });
    chain.set(z - ax0);
    out.prof?.set({ laser }); out.cam.set(flash); out.bars?.forEach(b => b.set({ light: flash }));
  };
  out.trayTop = () => LAY.trayBottom;
  return out;
}

// ---------------------------------------------------------------- SCARA 周邊的上視站
export function buildStations(scene) {
  const g = group(scene, 'stations'), S = LAY.st, T = LAY.table, out = { group: g };
  // 1. 上視 3D 線雷射（interposer 底面 PIN 與平整度）：雷射線沿 Z（零件寬向），零件沿 X 飛越掃描
  {
    const [x, z] = S.prof, win = 905;
    const p = laserProfiler.create({ axis: '+y', fanW: 30, range: 60, w: 70, h: 44, length: 90 });
    p.root.position.set(x, win - 45 - 3, z); p.root.rotation.y = Math.PI / 2; g.add(p.root); tagPart(p, REF.profiler);
    block(g, [60, win - 97 - T, 60], [x, T + (win - 97 - T) / 2, z], MAT.steelDark);
    block(g, [120, 4, 60], [x, win - 95, z], MAT.alu);
    out.prof = p; out.profWin = win;
  }
  // 2. 上視 2D 相機（同軸＋環形光）：取起後覆拍修正位置＋底面外觀（interposer 道、SOCAMM 道各一台）
  out.camUp = {}; out.camFront = 868;
  for (const k of ['I', 'S']) {
    const [x, z] = S[k === 'I' ? 'camI' : 'camS'], front = out.camFront;
    const c = visionCamera.create({ axis: '+y', ringR: 40, lensR: 16, lensL: 50, bodyL: 50, fov: 58, view: { fov: 58, aspect: 1.5, near: 5, far: 2500 }, spot: { power: 300, distance: 400 } });
    c.root.position.set(x, front, z); g.add(c.root); tagPart(c, REF.camUp);
    block(g, [60, front - 100 - T, 60], [x, T + (front - 100 - T) / 2, z], MAT.steelDark);
    out.camUp[k] = c;
  }
  // 3. 離子風刀（朝上，SOCAMM 底面焊墊吹淨）
  {
    const [x, z] = S.blow, y = 890;   // 風刀沿 X，零件沿 X 掠過
    block(g, [140, 14, 18], [x, y - 7, z], MAT.steel);                                                  // 風刀本體
    block(g, [120, 2, 3], [x, y + 1, z], MAT.black);                                                    // 出風縫
    block(g, [40, y - 14 - T, 40], [x, T + (y - 14 - T) / 2, z], MAT.steelDark);
    const ion = ionizer.create({ h: 50 }); ion.root.position.set(x + 50, T, z + 40); g.add(ion.root); tagPart(ion, REF.ionizer);
    const jet = fx(new THREE.Mesh(new THREE.PlaneGeometry(120, 70), air(.25))); jet.position.set(x, y + 36, z); jet.visible = false; g.add(jet);
    out.blowJet = jet; out.blowY = y;
  }
  // 4. IPA 擦拭單元：無塵擦拭帶（供帶輪→擦拭墊→收帶輪）、IPA 定量滴下、擦拭墊微升降
  {
    const [x, z] = S.wipe, padTop = 900;
    const base = block(g, [150, 26, 90], [x, padTop - 70, z], MAT.cabinet);
    block(g, [50, padTop - 83 - T, 50], [x, T + (padTop - 83 - T) / 2, z], MAT.steelDark);
    const reels = [];
    for (const s of [-1, 1]) { const r = cylinder(g, 16, 36, [x + s * 52, padTop - 30, z], std(0xf2f2f0, .9, 0), 'z', 24); reels.push(r); cylinder(g, 5, 46, [x + s * 52, padTop - 30, z], MAT.steelDark, 'z', 12); }
    block(g, [6, 40, 70], [x - 75, padTop - 40, z], MAT.alu); block(g, [6, 40, 70], [x + 75, padTop - 40, z], MAT.alu);
    const pad = group(g, 'wipe-pad'); Object.assign(pad.userData, { cableHost: false });
    block(pad, [100, 10, 22], [x, padTop - 6.6, z], puMat);                                             // 擦拭墊（軟質）
    block(pad, [104, .8, 26], [x, padTop - 1.1, z], std(0xffffff, .95, 0));                            // 擦拭帶
    block(pad, [30, 40, 22], [x, padTop - 32, z], MAT.steelBlue);
    const tank = cylinder(g, 18, 70, [x + 40, T + 35, z + 70], std(0xeaf6ff, .2, 0, { transparent: true, opacity: .75 }), 'y', 20);
    cylinder(g, 2, 16, [x - 40, padTop - 14, z + 18], MAT.steel, 'y', 10);                               // IPA 含浸嘴（擦拭帶進入擦拭墊前）
    const drop = fx(new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), std(0xbfe4ff, .1, 0, { transparent: true, opacity: .8 }))); drop.position.set(x - 40, padTop - 24, z + 18); drop.visible = false; g.add(drop);
    out.wipe = { pad, reels, drop, padTop, base, tank };
  }
  // 5. 吹乾槽：低矮的開口槽，兩側離子暖風噴嘴對著零件底面吹（約 10 s），排氣到下方
  {
    const [x, z] = S.dry, y0 = 880, wallTop = 906;
    for (const s of [-1, 1]) block(g, [130, wallTop - y0, 6], [x, (y0 + wallTop) / 2, z + s * 30], MAT.alu);
    for (const s of [-1, 1]) block(g, [6, wallTop - y0, 54], [x + s * 62, (y0 + wallTop) / 2, z], MAT.alu);
    block(g, [130, 6, 66], [x, y0 - 3, z], MAT.steelDark);
    for (let i = 0; i < 5; i++) block(g, [110, 1, 3], [x, y0 + .5, z - 20 + i * 10], MAT.black);                   // 排氣格柵
    block(g, [50, y0 - 6 - T, 50], [x, T + (y0 - 6 - T) / 2, z], MAT.steelDark);
    const jets = [];
    for (const s of [-1, 1]) for (const k of [-36, 0, 36]) {
      cylinder(g, 2.5, 8, [x + k, y0 + 10, z + s * 23], MAT.black, 'z', 10);
      const j = fx(new THREE.Mesh(new THREE.ConeGeometry(7, 18, 12, 1, true), air(.2))); j.rotation.x = s * Math.PI / 2; j.position.set(x + k, y0 + 12, z + s * 10); j.visible = false; g.add(j); jets.push(j);
    }
    const ion = ionizer.create({ h: 50 }); ion.root.position.set(x + 90, T, z); g.add(ion.root); tagPart(ion, REF.ionizer);
    out.dry = { jets, y0, partY: 899 };
  }
  // 6. NG 盒（interposer、SOCAMM 各一，抽屜式，滿料感測）
  out.ng = {};
  for (const k of ['I', 'S']) {
    const [x, z] = S[k === 'I' ? 'ngI' : 'ngS'], y = 880;
    block(g, [116, 4, 60], [x, y - 2, z], MAT.red);
    for (const s of [-1, 1]) { block(g, [116, 20, 4], [x, y + 10, z + s * 28], MAT.red); block(g, [4, 20, 52], [x + s * 56, y + 10, z], MAT.red); }
    block(g, [50, y - 4 - T, 50], [x, T + (y - 4 - T) / 2, z], MAT.steelDark);
    out.ng[k] = { x, z, y };
  }
  out.set = ({ prof = 0, cam = 0, blow = 0, wipeUp = 0, tape = 0, drop = 0, dry = 0 }) => {
    out.prof.set({ laser: prof }); out.camUp.I.set(cam === 1 ? 1 : 0); out.camUp.S.set(cam === 2 ? 1 : 0); out.blowJet.visible = blow > .5;
    out.wipe.pad.position.y = wipeUp * 1.5;
    for (const r of out.wipe.reels) r.rotation.z = tape * 6;
    out.wipe.drop.visible = drop > .5; out.dry.jets.forEach(j => j.visible = dry > .5);
  };
  out.set({});
  return out;
}

// ---------------------------------------------------------------- 鎖附模組（背側 X 軸，懸臂伸到組裝位上方）
// 懸臂頭：壓持爪（氣動滑台＋4 爪壓在 DRAM 上，從側邊伸入、不擋螺絲孔）、隨行取釘座（吹送供料、真空吸釘）、
// 沿 Z 的小滑台（起子在三孔與取釘座之間移動）、起子 Z 伺服、伺服起子（扭力／角度／轉數紀錄）、3 支間距雷射。
export const LOCK = { feedZ: -70, upY: 40, armY: 1100 };
export function buildLocker(scene) {
  const g = group(scene, 'locker'), L = LAY.locker, Lz = L.z;
  for (const s of [-1, 1]) block(g, [50, L.beamY - LAY.table, 50], [s * 580, (L.beamY + LAY.table) / 2, Lz], MAT.frame);
  block(g, [1220, 40, 60], [0, L.beamY + 20 - 40, Lz], MAT.frame);
  const xAxis = linearAxis.create({ length: 1160, width: 90, height: 30, carL: 130, carH: 26 });
  xAxis.root.position.set(0, L.beamY, Lz); g.add(xAxis.root); tagPart(xAxis, REF.lockX);
  const chain = dragChain(g, 'locker drag chain', { origin: [0, L.beamY + 20, Lz - 80], axis: [1, 0, 0], rise: [0, 1, 0], fixed: 0, min: -560, max: 480, radius: 28, width: 30, pitch: 14 });
  // 懸臂（從滑座往 +Z 伸到組裝位）
  const head = group(xAxis.carriage, 'lock-head'); Object.assign(head.userData, { cableHost: false });
  const y0 = L.beamY + 30 + 4 + 26;                                                         // 滑座頂（世界 Y）
  const toLocal = y => y - L.beamY;                                                          // 世界 Y → 滑座本地 Y（root 在 beamY）
  const armLen = -Lz + 60;
  block(head, [40, 30, armLen], [-60, toLocal(y0 + 15), armLen / 2 - 50], MAT.alu);             // 懸臂（偏西，讓出起子上方空間）
  block(head, [70, 40, 60], [-45, toLocal(y0 - 20), -20], MAT.steelDark);                       // 滑座連接塊
  // 隨行螺絲供料器（料斗＋直進軌，吹送到取釘座）：懸臂上、靠滑座側
  block(head, [70, 70, 90], [-60, toLocal(y0 + 30 + 35), 60], std(0x3b6e8f, .5, .3));
  block(head, [40, 30, 40], [-60, toLocal(y0 + 30 + 70 + 15), 60], std(0x8fa3b0, .5, .3));
  decal(head, 60, 20, [-60, toLocal(y0 + 65), 60 + 46.2], [0, 0, 0], ['SCREW', 'FEEDER'], { color: '#e9eef2', bg: null, center: true });
  // 頭部垂直板（在槽位背側、Z = −90）
  const hz = -Lz;                                                                             // 世界 Z = 0 在 head 本地的 z
  const plateTop = y0, plateBot = PCB_TOP + 26;
  block(head, [70, plateTop - plateBot, 10], [0, toLocal((plateTop + plateBot) / 2), hz - 95], MAT.alu);
  // 取釘座（固定在頭部，世界 Z = feedZ）：吹送管出口、真空檢知
  const feedTop = PCB_TOP + 22;
  block(head, [24, 12, 24], [0, toLocal(feedTop - 6), hz + LOCK.feedZ], MAT.steelDark);
  block(head, [10, 20, 18], [0, toLocal(feedTop + 4), hz + LOCK.feedZ - 18], MAT.steelDark);
  block(head, [10, 14, 6], [0, toLocal(feedTop - 2), hz - 90 + 1], MAT.steelDark);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, toLocal(feedTop + 8), hz + LOCK.feedZ - 24), new THREE.Vector3(0, toLocal(feedTop + 40), hz - 110), new THREE.Vector3(0, toLocal(y0 + 30), hz - 160), new THREE.Vector3(-60, toLocal(y0 + 30 + 20), 60 - 45)]), 24, 2.2, 8),
    std(0xd8eef8, .2, 0, { transparent: true, opacity: .7 }));
  tube.name = 'screw feed tube'; tube.userData.routingHardware = 'route'; head.add(tube);
  // 沿 Z 的小滑台（頭板上方，起子在三孔與取釘座之間移動）
  const zr0 = hz - 55, zr1 = hz + 55;
  block(head, [16, 14, zr1 - zr0 + 40], [-34, toLocal(plateTop - 7), (zr0 + zr1) / 2], MAT.steel);
  const zCar = group(head, 'lock-z'); Object.assign(zCar.userData, { cableHost: false });
  block(zCar, [26, 16, 50], [-36, toLocal(plateTop - 23), 0], MAT.steelDark);
  block(zCar, [12, plateTop - 23 - 1010, 46], [-28, toLocal((plateTop - 23 + 1010) / 2), 0], MAT.alu);   // 起子立板
  // 起子 Z 伺服（立板上的導軌＋滑塊）＋伺服起子
  block(zCar, [8, 120, 16], [-20, toLocal(1050), 0], MAT.steel);
  const yCar = group(zCar, 'lock-y'); Object.assign(yCar.userData, { cableHost: false });
  const tipSeat = SOC_TOP(1) + SCREW.headH;                                                  // 螺絲鎖到底時的頭頂（起子尖端）
  block(yCar, [14, 40, 30], [-10, toLocal(tipSeat + 100), 0], MAT.steelDark);
  const nr = nutrunner.create({ bodyR: 13, bodyL: 78, socketR: 1.6, socketH: 30, bodyY: 30 + 39, lugs: false, segments: 24 });
  nr.root.position.set(0, toLocal(tipSeat), 0); yCar.add(nr.root); tagPart(nr, REF.nutrunner);
  cylinder(yCar, 3.2, 6, [0, toLocal(tipSeat + 6), 0], MAT.chrome, 'y', 16);                    // 吸釘嘴（真空套管）
  cylinder(yCar, 9, 16, [0, toLocal(tipSeat + 30 + 78 + 8), 0], MAT.steelDark, 'y', 16);         // 扭力感測器＋編碼器
  // 壓持爪（槽位東側伸入，4 爪壓在 DRAM 頂面；PU 墊）
  const press = slideTable.create({ w: 30, h: 50, d: 40, stroke: 24, table: false, bodyMaterial: MAT.steelBlue });
  const pressTopFree = SOC_TOP(1) + SOC.pkgH;                                                // 壓到位時爪墊底面
  press.root.position.set(30, toLocal(pressTopFree + 24 + 60), hz); head.add(press.root); tagPart(press, REF.slide);
  block(head, [20, 60, 40], [30, toLocal(pressTopFree + 24 + 60 + 30), hz], MAT.alu);
  const fingers = group(press.table, 'press-fingers');
  // fingers 在 press.table（原點：root）：table 下移 24 時，爪墊底 = pressTopFree
  const fy = y => y - (pressTopFree + 24 + 60);
  block(fingers, [6, 50, 100], [-13, fy(pressTopFree + 24 + 25), 0], MAT.alu);               // 側板（沿 Z）
  for (const zx of [-28.5, -14.2, 17.2, 30.2]) {
    const wz = -zx;                                                                          // 零件本地 X → 世界 −Z
    block(fingers, [26, 3, 6], [-27, fy(pressTopFree + 24 + 2.5), wz], MAT.alu);
    Object.assign(block(fingers, [14, 1, 6], [-35, fy(pressTopFree + 24 + .5), wz], puMat).userData, { contact: true });
  }
  // 3 支間距雷射（量測三孔附近的板間距離；頭板上）
  const gaps = [];
  for (const wz of [-41, -4.5, 41]) {
    const s = block(head, [12, 18, 10], [-22, toLocal(pressTopFree + 30), hz + wz + (wz > 0 ? -9 : 9)], MAT.black);
    gaps.push(s);
  }
  const beams = [];
  for (const wz of [-41, -4.5, 41]) { const b = fx(new THREE.Mesh(new THREE.CylinderGeometry(.4, .4, 21, 6), std(0xff3030, .3, 0, { emissive: 0xff2020, emissiveIntensity: 2 }))); b.position.set(-22, toLocal(pressTopFree + 10.5), hz + wz + (wz > 0 ? -9 : 9)); b.visible = false; head.add(b); beams.push(b); }
  // 狀態：x 滑座世界 X；press 0～1；nz 起子世界 Z（相對組裝位）；ny 0～1（1＝下到鎖附高度＋下降量 dy）；turns；beam
  const NY = LOCK.upY;
  const set = ({ x = L.park, press: pr = 0, nz = LOCK.feedZ, ny = 0, dy = 0, turns = 0, beam = 0 }) => {
    xAxis.set({ pos: x }); chain.set(x);
    press.set({ ext: pr });
    zCar.position.z = hz + nz;
    yCar.position.y = (1 - ny) * NY + dy;
    nr.set({ turns });
    for (const b of beams) b.visible = beam > .5;
  };
  set({});
  // 起子尖端的世界位置（螺絲吸在尖端）
  const tip = new THREE.Vector3();
  const bitTip = () => nr.root.getWorldPosition(tip);
  return { group: g, set, bitTip, nutrunner: nr, head, feedTop, tipSeat };
}
