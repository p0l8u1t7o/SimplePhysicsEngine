// 設備：機架與電控櫃、避震墊、花崗岩平台、XY 平台（core linear-axis）、θ 微調台、真空吸盤、固定龍門、
// Z 調焦軸（core linear-axis）＋相機（core vision-camera）＋同軸遠心鏡頭＋同軸光＋低角度環形光、遮光外罩、拖鏈與真空管路、
// 真空控制（core 真空發生器、電磁閥）、HMI 與三色燈（core）。
// 市購品沒有 core 模型的（θ 台、吸盤、同軸光、低角度環形光、龍門、外罩）在站內畫包絡並標「示意／待選型」，不是原廠 CAD。
// 每個設備用 tagPart 標元件編號（成本表 .studio/plan/bom.json）。
import * as THREE from 'three';
import { block, cylinder, rod, D2R } from '@core/geom/shapes.js';
import { MAT, finished } from '@core/geom/materials.js';
import { linearAxis, vacuumEjector, solenoidValve, frl } from '@core/models/motion.js';
import { visionCamera } from '@core/models/vision.js';
import { signalTower, hmi } from '@core/models/indicators.js';
import { tagPart } from '@core/models/parts.js';
import { carrier, cable, CABLE } from '@core/electrical/cable-routing.js';
import { LAYOUT, Y } from './spec.js';

export const PART = {
  granite: 'P-00195', frame: 'P-00242', bridge: 'P-00243', hood: 'P-00244', xy: 'P-00245', theta: 'P-00246', z: 'P-00247',
  chuck: 'P-00248', carriers: 'P-00249', camera: 'P-00035', lens: 'P-00250', coax: 'P-00251', ring: 'P-00252', vacuum: 'P-00253', hmi: 'P-00199',
};
const grp = (parent, name) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
const named = (m, n) => { m.name = n; return m; };
// 環形（中空圓柱）：內徑 ri、外徑 ro、高 h，底面在 y = 0
function annulus(ri, ro, h, material, seg = 64) {
  const s = new THREE.Shape(); s.absarc(0, 0, ro, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, ri, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg }); g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, material); m.castShadow = m.receiveShadow = true; return m;
}
const glowMat = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .05, roughness: .4 });

export function createMachine(scene, p, { waferGroup }) {
  const L = LAYOUT, root = grp(scene, 'machine');
  const metal = finished(MAT.alu, 'metal'), dark = MAT.steelDark;

  // ---------------------------------------------------------------- 基座：機架（含下方電控櫃）、避震墊、花崗岩
  const base = grp(scene, 'base');
  const frame = tagPart(grp(base, 'frame'), PART.frame);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cylinder(frame, 28, 60, [x * (L.frame.w / 2 - 70), 30, z * (L.frame.d / 2 - 70)], MAT.steel, 'y', 20);   // 調整腳
  named(block(frame, [L.frame.w, L.frame.h - 60, L.frame.d], [0, 60 + (L.frame.h - 60) / 2, 0], MAT.cabinet), 'frame cabinet');
  for (const x of [-1, 1]) named(block(frame, [L.frame.w / 2 - 40, L.frame.h - 160, 4], [x * L.frame.w / 4, 60 + (L.frame.h - 60) / 2, L.frame.d / 2 + 3], MAT.door), 'cabinet door');
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) named(cylinder(base, 45, L.iso.h, [x * 430, L.frame.h + L.iso.h / 2, z * 380], MAT.black, 'y', 24), 'isolator');
  const granite = tagPart(grp(base, 'granite'), PART.granite);
  named(block(granite, [L.granite.w, L.granite.h, L.granite.d], [0, Y.graniteBottom + L.granite.h / 2, 0], new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: .55, metalness: .05 })), 'granite');

  // ---------------------------------------------------------------- 固定龍門（相機橋架）
  const B = L.bridge, beamY0 = B.top - B.beamH;
  const bridge = tagPart(grp(base, 'bridge'), PART.bridge);
  for (const s of [-1, 1]) named(block(bridge, [B.colW, beamY0 - Y.graniteTop, B.colD], [s * B.x, (Y.graniteTop + beamY0) / 2, B.z], dark), 'bridge column');
  named(block(bridge, [2 * B.x + B.colW, B.beamH, B.colD], [0, beamY0 + B.beamH / 2, B.z], dark), 'bridge beam');
  const beamFront = B.z + B.colD / 2;

  // ---------------------------------------------------------------- XY 平台（core linear-axis，示意規格 P-00245）
  const stage = grp(scene, 'stage');
  const yZ0 = 25;                                                    // Y 軸中心 z：行程 −175～+225 對稱放在底座上
  const yAxis = linearAxis.create({ axis: 'z', length: L.yStage.len, width: L.yStage.w, height: L.yStage.h, carL: L.yStage.carL, carH: L.yStage.carH, name: 'Y axis' });
  yAxis.root.position.set(0, Y.graniteTop, yZ0); stage.add(yAxis.root); tagPart(yAxis, PART.xy);
  const yCar = yAxis.carriage; yCar.userData.cableHost = false;
  const yCarTop = L.yStage.h + 4 + L.yStage.carH;
  const xAxis = linearAxis.create({ axis: 'x', length: L.xStage.len, width: L.xStage.w, height: L.xStage.h, carL: L.xStage.carL, carH: L.xStage.carH, name: 'X axis' });
  xAxis.root.position.set(0, yCarTop, 0); yCar.add(xAxis.root); tagPart(xAxis, PART.xy);
  const xCar = xAxis.carriage; xCar.userData.cableHost = false;
  const xCarTop = L.xStage.h + 4 + L.xStage.carH;

  // ---- θ 微調台（示意 P-00246）與真空吸盤（示意 P-00248）
  const theta = tagPart(grp(xCar, 'theta stage'), PART.theta);
  named(cylinder(theta, L.theta.r, 22, [0, xCarTop + 11, 0], dark, 'y', 64), 'theta base');
  named(block(theta, [70, 22, 90], [L.theta.r + 30, xCarTop + 11, 0], MAT.steelBlue), 'theta drive');
  const rotor = grp(theta, 'theta rotor'); rotor.userData.cableHost = false;
  named(cylinder(rotor, L.theta.r - 8, L.theta.h - 22, [0, xCarTop + 22 + (L.theta.h - 22) / 2, 0], metal, 'y', 64), 'theta table');
  const chuck = tagPart(grp(rotor, 'vacuum chuck'), PART.chuck), cy0 = xCarTop + L.theta.h;
  const ring = named(annulus(151, L.chuck.r, L.chuck.h - 1.5, metal), 'chuck rim');   // 鋁環頂面比陶瓷低 1.5 mm（晶圓只壓在陶瓷上） ring.position.y = cy0; chuck.add(ring);
  named(cylinder(chuck, 149, L.chuck.h - 2, [0, cy0 + 2 + (L.chuck.h - 2) / 2, 0], new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: .9 }), 'y', 96), 'porous ceramic');   // 底面比鋁環高 2 mm（避免底面重合）
  // 晶圓放在吸盤上（晶圓群組由 project.js 建立，這裡掛到 θ 轉子上，跟著 θ 修正一起轉）
  waferGroup.position.y = cy0 + L.chuck.h; rotor.add(waferGroup);
  // 真空接頭（在不轉的 θ 底座側面）
  const fitting = named(cylinder(theta, 5, 16, [0, xCarTop + 11, -L.theta.r - 8], MAT.chrome, 'z', 16), 'vacuum fitting');

  // ---- 拖鏈與真空管路（P-00249）：X 軸拖鏈在 Y 滑座上，Y 軸拖鏈在花崗岩上；管路不穿越運動區
  const services = tagPart(grp(stage, 'stage services'), PART.carriers);
  const xChainZ = -225, xChain = carrier(yCar, 'X axis carrier / vacuum hose', { origin: [0, yCarTop + 15, xChainZ], axis: [1, 0, 0], rise: [0, 1, 0], fixed: 0, min: -L.travel.x, max: L.travel.x, radius: 30, width: 30, pitch: 14, colors: [CABLE.air, CABLE.signal, CABLE.power] });
  // 拖鏈移動端（Y 滑座座標 y = yCarTop + 15 + 2r，z = xChainZ）用支架接到 X 滑座側面（X 滑座座標 = Y 滑座座標 − yCarTop）
  named(block(xCar, [24, 10, 7], [0, 73, -(L.xStage.w + 20) / 2 - 3.5], dark), 'X carrier bracket');   // X 滑座側面 z = −200 到拖鏈端子 z = −207
  cable(xCar, 'chuck vacuum hose', [[0, xCarTop + 11, -L.theta.r - 17], [0, xCarTop + 11, -L.theta.r - 50], [0, 84, xChainZ]], { radius: 3, color: CABLE.air, clips: 0 });
  const yChainX = -L.yStage.w / 2 - 70, yChain = carrier(granite, 'Y axis carrier / vacuum hose', { origin: [yChainX, Y.graniteTop + 15, yZ0], axis: [0, 0, 1], rise: [0, 1, 0], fixed: 0, min: L.travel.zMin - yZ0, max: L.travel.zMax - yZ0, radius: 35, width: 30, pitch: 14, colors: [CABLE.air, CABLE.signal, CABLE.power] });
  // Y 拖鏈移動端（花崗岩上 y = 15 + 2r、x = yChainX）用支架接到 Y 滑座側面（x = −w/2 − 10）
  { const x0 = yChainX + 17, x1 = -L.yStage.w / 2 - 10 + 1; named(block(yCar, [x1 - x0, 14, 20], [(x0 + x1) / 2, 85, 0], dark), 'Y carrier bracket'); }
  services.userData.chains = { xChain, yChain };

  // ---- 真空控制（P-00253：電磁閥＋真空發生器＋壓力開關），放在花崗岩左前角
  const vac = tagPart(grp(base, 'vacuum unit'), PART.vacuum);
  const valve = solenoidValve.create({ name: 'vacuum valve' }); valve.root.position.set(-470, Y.graniteTop + 17, 330); vac.add(valve.root); tagPart(valve, PART.vacuum);
  const ejector = vacuumEjector.create({ name: 'vacuum ejector' }); ejector.root.position.set(-470, Y.graniteTop + 22, 420); vac.add(ejector.root); tagPart(ejector, PART.vacuum);
  const gaugeBox = named(block(vac, [34, 34, 30], [-470, Y.graniteTop + 17, 250], MAT.black), 'vacuum pressure switch');
  const gaugeLamp = named(block(vac, [20, 8, 2], [-470, Y.graniteTop + 24, 266], glowMat(0x3dd68c)), 'pressure switch display');
  cable(granite, 'vacuum supply hose', [[yChainX, Y.graniteTop + 15, yZ0 - 6], [yChainX, Y.graniteTop + 4, yZ0 - 40], [-470, Y.graniteTop + 4, yZ0 - 40], [-470, Y.graniteTop + 4, 233]], { radius: 3, color: CABLE.air, clips: 0 });

  // ---------------------------------------------------------------- 光學頭：Z 調焦軸（P-00247）＋相機（P-00035）＋鏡頭（P-00250）＋同軸光（P-00251）＋低角度環形光（P-00252）
  const optics = grp(scene, 'optics');
  const surf = Y.waferTop + p.waferT, lensFront = surf + p.wd, lensL = 190, zMid = lensFront + lensL / 2 + 40;
  const zAxis = linearAxis.create({ axis: 'y', length: 240, width: 130, height: 40, carL: 140, carH: 30, name: 'Z focus axis', motor: { size: [70, 70, 60], at: [0, 155, 35] } });
  zAxis.root.position.set(0, zMid, beamFront); optics.add(zAxis.root); tagPart(zAxis, PART.z);
  // Z 滑座改掛到站的移動群組（core README「站可以把可動子群組改掛到自己的移動群組」）：相機與光源掛在這個群組，才不會被當成 Z 軸模型的一部分
  const zMove = grp(optics, 'optical head carriage'); zMove.position.copy(zAxis.root.position); zMove.userData.cableHost = false;
  const zCar = zAxis.carriage; zMove.add(zCar);
  const toCar = (x, y, z) => [x, y - zMid, z - beamFront];             // 世界座標 → Z 滑座座標
  const head = grp(zMove, 'optical head');
  const carFront = 40 + 4 + 30;                                       // 滑座前面（root 座標 z）
  named(block(head, [96, 110, -beamFront - 30 - carFront + 2], [0, lensFront + 120 - zMid, (carFront + (-beamFront - 30)) / 2 + 1], dark), 'lens bracket');
  const cam = visionCamera.create({ name: 'camera', lensR: 30, lensL, bodyW: 62, bodyD: 62, bodyL: 72, ringR: 0, spot: false, view: false, material: MAT.black,
    lens: { material: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: .35, metalness: .5 }) },
    bands: { ats: [-40, -150], r: 31.5, length: 8, material: MAT.alu } });
  cam.root.position.set(...toCar(0, lensFront, 0)); head.add(cam.root); tagPart(cam, PART.camera);
  const lensTag = grp(head, 'telecentric lens tag'); tagPart(lensTag, PART.lens);
  // 同軸光（明場）：鏡頭側面的光源盒
  const coax = tagPart(grp(head, 'coaxial light'), PART.coax);
  named(block(coax, [64, 58, 52], toCar(30 + 32, lensFront + 120, 0), MAT.black), 'coax housing');
  const coaxFace = named(block(coax, [4, 40, 40], toCar(30 + 64 + 2, lensFront + 120, 0), glowMat(0xfff2c8)), 'coax emitter');
  // 低角度環形光（暗場）：用鏡頭上的夾環與兩支吊桿固定，離晶圓 dfHeight
  const rg = tagPart(grp(head, 'darkfield ring light'), PART.ring);
  const rIn = Math.max(36, p.dfRingD / 2 - 12), rOut = p.dfRingD / 2 + 10, ringY = surf + p.dfHeight - 5;
  const ringBody = named(annulus(rIn, rOut, 10, MAT.black), 'ring light housing'); ringBody.position.set(...toCar(0, ringY, 0)); rg.add(ringBody);
  const ringGlow = named(new THREE.Mesh(new THREE.TorusGeometry(rIn - 0.8, 2, 8, 64), glowMat(0xd6ecff)), 'ring light emitter');   // 發光面在內緣下側（照向晶圓）
  ringGlow.rotation.x = Math.PI / 2; ringGlow.position.set(...toCar(0, ringY + 3, 0)); rg.add(ringGlow);
  const collarY = lensFront + 6;
  const collar = named(annulus(30, 38, 8, dark), 'ring light collar'); collar.position.set(...toCar(0, collarY, 0)); rg.add(collar);
  for (const s of [-1, 1]) {
    named(block(rg, [rOut - 38 - 4 + 6, 8, 12], toCar(s * (38 + (rOut - 38 - 4) / 2), collarY + 4, 0), dark), 'ring hanger arm');
    named(rod(rg, toCar(s * (rOut - 6), ringY + 10, 0), toCar(s * (rOut - 6), collarY, 0), 3, MAT.chrome), 'ring hanger rod');
  }
  cable(bridge, 'camera cable', [[-20, lensFront + lensL + 72 - 2, 0], [-20, B.top + 5, 0], [-20, B.top + 5, B.z]], { radius: 4, color: CABLE.signal, clips: 0 });

  // ---- 光束示意（非實體）：明場是鏡頭下的光柱，暗場是環形光的光暈
  const beamBF = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, p.wd - 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide }));
  beamBF.position.set(0, surf + (p.wd - 1) / 2 + .5, 0); beamBF.userData.fx = true; beamBF.name = 'brightfield beam'; root.add(beamBF);
  const beamDF = new THREE.Mesh(new THREE.CylinderGeometry(rIn + 2, rIn + 8, p.dfHeight - 6, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide }));
  beamDF.position.set(0, surf + (p.dfHeight - 6) / 2 + 0.6, 0); beamDF.userData.fx = true; beamDF.name = 'darkfield glow'; root.add(beamDF);

  // ---------------------------------------------------------------- 遮光外罩（示意 P-00244）：可切實體／透明／隱藏
  const H = L.hood, hood = tagPart(grp(scene, 'hood'), PART.hood), hy0 = L.frame.h, hh = H.top - hy0, t = 6;
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: .7, metalness: .2, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: .1, metalness: 0, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide });
  const panel = (size, pos, m = hoodMat, n = 'hood panel') => named(block(hood, size, pos, m), n);
  panel([t, hh, H.z1 - H.z0], [-H.x, hy0 + hh / 2, (H.z0 + H.z1) / 2]);
  panel([t, hh, H.z1 - H.z0], [H.x, hy0 + hh / 2, (H.z0 + H.z1) / 2]);
  panel([2 * H.x - t, hh, t], [0, hy0 + hh / 2, H.z0]);
  panel([2 * H.x + t, t, H.z1 - H.z0 + t], [0, H.top + t / 2, (H.z0 + H.z1) / 2], hoodMat, 'hood roof');
  const doorY0 = Y.graniteTop + 40, doorY1 = 1560, doorX = 340;
  panel([2 * H.x - t, doorY0 - hy0, t], [0, (hy0 + doorY0) / 2, H.z1]);
  panel([2 * H.x - t, H.top - doorY1, t], [0, (doorY1 + H.top) / 2, H.z1]);
  for (const s of [-1, 1]) panel([H.x - doorX - t / 2, doorY1 - doorY0, t], [s * (doorX + (H.x - doorX - t / 2) / 2), (doorY0 + doorY1) / 2, H.z1]);
  named(block(hood, [2 * doorX + 20, doorY1 - doorY0 + 20, 3], [0, (doorY0 + doorY1) / 2, H.z1 + 4.5], winMat), 'hood door window');
  const hoodMats = [hoodMat, winMat];

  // ---------------------------------------------------------------- HMI 與三色燈（core，P-00199）
  const ops = grp(scene, 'operator');
  named(cylinder(ops, 22, 1228, [-800, 12 + 614, 620], MAT.steel, 'y', 20), 'hmi stand');   // 操作側左前方（不擋全機視角）
  named(block(ops, [260, 12, 260], [-800, 6, 620], dark), 'hmi stand base');
  // 氣源處理（P-00072，core FRL）：機架左側面
  const air = frl.create({ name: 'FRL' }); air.root.position.set(-L.frame.w / 2 - 24, 520, 200); air.root.rotation.y = -Math.PI / 2; ops.add(air.root); tagPart(air, 'P-00072');
  const panelHmi = hmi.create({ w: 340, h: 240, d: 46, display: true, name: 'HMI' }); panelHmi.root.position.set(-800, 1360, 620 + 23 + 22); panelHmi.root.rotation.y = 0.35; ops.add(panelHmi.root); tagPart(panelHmi, PART.hmi);
  const tower = signalTower.create({ poleH: 300, name: 'signal tower' }); tower.root.position.set(L.frame.w / 2 - 24, L.frame.h, L.frame.d / 2 - 30); ops.add(tower.root); tagPart(tower, PART.hmi);

  return {
    root, base, bridge, stage, optics, hood, ops, yAxis, xAxis, zAxis, yCar, xCar, theta, rotor, chuck, cam, coaxFace, ringGlow, beamBF, beamDF, hoodMats, panelHmi, tower, gaugeLamp,
    xChain, yChain, yZ0, surf, lensFront, ringY, rIn, rOut, fitting,
    // 平台位置：晶圓座標 (sx, sy) 對到光軸 → X 滑座 −sx、Y 滑座 sy − yZ0；θ 轉子角度（度）；Z 調焦（mm）
    setStage(sx, sy, th, z) {
      xAxis.set({ pos: -sx }); yAxis.set({ pos: sy - yZ0 }); rotor.rotation.y = th * D2R; zMove.position.y = zMid + z;
      xChain.set(-sx); yChain.set(sy - yZ0);
    },
    setLight(light, vac) {
      coaxFace.material.emissiveIntensity = light === 'BF' ? 2.2 : .05; ringGlow.material.emissiveIntensity = light === 'DF' ? 2.4 : .05;
      beamBF.visible = light === 'BF'; beamDF.visible = light === 'DF';
      gaugeLamp.material.emissive.set(vac === 2 ? 0x3dd68c : vac === 1 ? 0xffb020 : 0x445058); gaugeLamp.material.emissiveIntensity = vac ? 1.2 : .2;
    },
    setHood(mode) {
      hood.visible = mode !== 'off';
      hoodMats[0].opacity = mode === 'solid' ? 1 : .2; hoodMats[0].transparent = mode !== 'solid'; hoodMats[0].depthWrite = mode === 'solid'; hoodMats[0].needsUpdate = true;
    },
  };
}
