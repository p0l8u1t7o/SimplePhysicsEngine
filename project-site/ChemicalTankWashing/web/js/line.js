// 產線設備：棧板站、三軸龍門＋翻轉夾爪、橫躺輸送、貼標讀碼站、翻桶機、立放直線輸送（開蓋→清洗→裝填區）、圍籬與控制櫃。
import * as THREE from 'three';
import { PALLET_STATION, PALLET, GANTRY, LYING, LABEL, UPENDER, UPRIGHT, DECAP, DRUM, FENCE, FENCE_GATES, GANTRY_FENCE, FOOTPRINTS, ROOM, WEIGH } from './layout.js';
import { D2R, block, blockBetween, cylinder, plate, rod } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { drumJaws } from './drum.js';
import { bolts, foot, motor, sensor, cabinetDetails } from '@core/geom/hardware.js';
import { signalTower, hmi as hmiModel } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { visionCamera } from '@core/models/vision.js';
import { barLight as barLightModel } from '@core/models/lights.js';
import { loadCell, airCylinder, linearAxis, nutrunner } from '@core/models/motion.js';
import { labeler, upender, weighIndicator } from '@core/models/equipment-process.js';
import { vRollerConveyor, ballTurntable } from '@core/models/transport.js';
import { create as conveyor } from '@core/models/conveyor.js';

export function createLine(scene) {
  const group = new THREE.Group(); group.name = 'line'; scene.add(group);
  // 工位標記：每段建立的零件記下所屬工位（userData.station），統一檢查依此判斷「不同工位的架設相撞」
  const sections = [];
  const section = name => sections.push([group.children.length, name]);
  const fences = new THREE.Group(); group.add(fences);

  section('pallet');
  // ---------------------------------------------------------------- 棧板站
  const ps = PALLET_STATION;
  block(group, [1300, ps.stand, 1300], [ps.x, ps.stand / 2, ps.z], MAT.steelDark);
  for (const [dx, dz] of [[-660, 300], [660, 300], [-660, -300], [660, -300]]) block(group, [40, 200, 300], [ps.x + dx, ps.stand + 100, ps.z + dz], MAT.yellow);
  block(group, [260, 30, 30], [ps.x, ps.stand + 17, ps.z + PALLET.W / 2 + 20], MAT.steelOrange);   // 後止擋：橫跨棧板中樑，距棧板南端 5 mm

  section('gantry');
  // ---------------------------------------------------------------- 龍門（雙 X 樑 → 橫樑沿 X → 台車沿 Z → 兩段伸縮 Z → 翻轉軸 → 夾爪）
  const g = GANTRY, [p0, p1, p2] = g.posts;
  for (const [x, z] of g.posts) block(group, [200, g.beamY + 100, 200], [x, (g.beamY + 100) / 2, z], MAT.steelBlue);
  for (const z of [p0[1], p2[1]]) block(group, [p1[0] - p0[0] + 200, 220, 200], [(p0[0] + p1[0]) / 2, g.beamY + 210, z], MAT.steelBlue);
  for (const z of [p0[1], p2[1]]) block(group, [p1[0] - p0[0], 40, 60], [(p0[0] + p1[0]) / 2, g.beamY + 340, z], MAT.steel);
  // 橫樑為雙樑（中心距 400，間隙 300），Z 軸伸縮管從兩樑之間穿下
  const bridge = new THREE.Group(); group.add(bridge);
  for (const s of [-1, 1]) block(bridge, [100, 200, p2[1] - p0[1] + 200], [s * 200, g.beamY + 460, (p0[1] + p2[1]) / 2], MAT.steelOrange);
  const trolley = new THREE.Group(); bridge.add(trolley);
  block(trolley, [560, 60, 360], [0, g.beamY + 590, 0], MAT.steelDark);                         // 跨在雙樑上的台車板
  for (const s of [-1, 1]) block(trolley, [30, 210, 300], [s * 130, g.beamY + 455, 0], MAT.steelDark);   // 穿過間隙的吊板
  block(trolley, [420, 300, 360], [0, g.beamY + 200, 0], MAT.steelDark);                       // 樑下導向座
  block(trolley, [240, 300, 240], [0, g.beamY + 770, -300], MAT.black);                        // Z 軸馬達（避開伸縮管）
  const z1 = new THREE.Group(), z2 = new THREE.Group(); trolley.add(z1); trolley.add(z2); z2.userData.nested = z1;   // 兩段伸縮：內管套在外管內
  block(z1, [220, 1300, 220], [0, 650, 0], MAT.alu);
  block(z2, [160, 1300, 160], [0, 800, 0], MAT.steel);
  const tilt = new THREE.Group(); z2.add(tilt);                                          // 翻轉軸（世界 Z 向）
  cylinder(z2, 140, 360, [0, -40, 0], MAT.black, 'z', 28);
  block(z2, [260, 120, 300], [0, 40, 0], MAT.steelDark);
  block(tilt, [420, 60, 760], [0, -100, 0], MAT.steelDark);
  for (const s of [-1, 1]) block(tilt, [60, 250, 60], [0, -235, s * 360], MAT.steelDark);   // 吊板止於夾爪頂端之上 10 mm，夾爪全開時背板不會撞到
  const jawFrame = new THREE.Group(); jawFrame.position.y = -g.hang; jawFrame.rotation.y = Math.PI / 2; tilt.add(jawFrame);   // 爪在 ±Z（局部 ±X）
  const gJaws = drumJaws(jawFrame, null, g.jawOpen);
  const gantryPivot = new THREE.Object3D(); tilt.add(gantryPivot);
  // 拖鏈
  block(group, [p1[0] - p0[0], 80, 160], [(p0[0] + p1[0]) / 2, g.beamY + 420, p0[1] - 220], MAT.black);

  section('lying');
  // ---------------------------------------------------------------- 橫躺輸送：水平沙漏形（V 槽）滾輪，滾輪軸橫跨輸送方向
  // 桶身落在 V 槽兩側斜面（半角 LYING.vee）；切點 z = R·sinα，由此反推滾輪軸高
  const rollers = [], ly = LYING, va = ly.vee * D2R, r0 = 40, halfL = 260;
  const axisY = ly.y - DRUM.envelopeR * Math.cos(va) - (DRUM.envelopeR * Math.sin(va)) * Math.tan(va) - r0;
  // V 槽滾輪線：core 的 V 槽滾輪輸送線模型（V 輥＋短軸、側樑、支腳）；root 只移到中心線（Z），本地 X 就是站的座標。
  // 第一支避開龍門翻轉頂板（放料時翻轉軸在 X 5283）；標籤站那一段（skip）改用旋轉輥
  const vr = vRollerConveyor.create({ span: [ly.x0, ly.x1], axisY, vee: ly.vee, waist: r0, halfL, rollers: { from: ly.x0 + 200, to: ly.x1 - 170, skip: [[LABEL.x, 620]] } });
  vr.root.position.z = ly.z; group.add(vr.root);
  vr.rollers.forEach((mesh, i) => rollers.push({ mesh, axis: 'z', radius: 100, along: vr.positions[i] }));
  block(group, [ly.x1 - ly.x0, 18, 120], [(ly.x0 + ly.x1) / 2, axisY - 100, ly.z + halfL + 160], MAT.yellow);
  // 標籤站旋轉輥（取代該段 V 輥，兩支主動輥平行於桶軸）
  const lab = LABEL;
  const rotRollers = [];
  for (const s of [-1, 1]) { const r = cylinder(group, 70, 1100, [lab.x, ly.y - Math.sqrt((DRUM.envelopeR + 70) ** 2 - 220 ** 2), ly.z + s * 220], MAT.belt, 'x', 20); rotRollers.push(r); }
  block(group, [1200, 120, 700], [lab.x, ly.y - DRUM.R - 140, ly.z], MAT.steelDark);

  section('label');
  // ---------------------------------------------------------------- 貼標機（印字貼標頭，南側推出貼附）＋讀碼相機
  // 貼標機：core 的貼標機模型（機櫃、印字引擎、標籤捲、導軌、貼標頭），原點在機台基準點
  const lbl = labeler.create({ applyY: ly.y, stroke: lab.standZ - LYING.z - DRUM.R - 135 });
  lbl.root.position.set(lab.x, 0, lab.standZ); group.add(lbl.root);
  const padLabel = lbl.padLabel;
  // 讀碼／定位相機：桶頂端西側斜上方，同一張影像看到兩個桶塞（定位）與桶身上方的標籤（貼後檢查）
  // core 的工業相機模型：原點在機身中心、光軸 +Z（lookAt 之後朝向目標）；閃光燈在機身中心，
  // 虛擬相機放在鏡頭前緣（機身中心往目標 150 mm），否則子畫面會拍到自己的鏡筒
  const [cx, cy, cz] = lab.cam.pos, camTarget = new THREE.Vector3(...lab.cam.target);
  const camL = visionCamera.create({
    axis: '+z', body: { size: [90, 90], length: 140, at: 0 }, lens: { r: 30, length: 70, at: 100, segments: 28, material: MAT.steelDark }, glass: false, ring: false,
    spot: { distance: 3000, angle: .7, at: 0, target: new THREE.Vector3(cx, cy, cz).distanceTo(camTarget), power: 900 },
    view: { fov: lab.cam.fov, near: 50, far: 6000, at: 150, name: '' },
  });
  const camLabel = camL.root; camLabel.position.set(cx, cy, cz); camLabel.lookAt(camTarget); group.add(camLabel);
  // 側打條形光，避免標籤反光：core 的條形光模型（只有發光條，不畫外殼）
  const bar = barLightModel.create({ axis: 'x', housing: false, length: 520, lensT: 40, lensW: 80, lensMaterial: MAT.cap });
  bar.root.position.set(0, -110, 60); camLabel.add(bar.root);
  const barLight = bar.lens, labelCam = camL.camera, labelFlash = camL.light;
  // 支架立在龍門圍籬外（X > 6700），避開龍門東側立柱與翻桶擺動範圍
  rod(group, [cx + 100, 0, cz - 520], [cx + 100, cy + 150, cz - 520], 45, MAT.alu);
  blockBetween(group, [cx + 60, cy + 110, cz - 520], [cx + 140, cy + 170, cz], MAT.alu);
  rod(group, [cx + 100, cy + 140, cz], [cx, cy, cz], 25, MAT.alu);

  section('upender');
  // ---------------------------------------------------------------- 翻桶機
  // core 的翻桶機模型（機座、軸承座、L 形搖籃、托墊、夾板、側置液壓缸），原點在翻轉軸正下方的地面
  const [ux, uy, uz] = UPENDER.pivot;
  const upd = upender.create({ pivotY: uy, drumR: DRUM.R, envelopeR: DRUM.envelopeR });
  upd.root.position.set(ux, 0, uz); group.add(upd.root);
  const { cradle, actuator, piston } = upd, upClamp = upd.clamps;

  section('upright');
  // ---------------------------------------------------------------- 立放輸送：一路往南，取桶位與放回位不設側導引
  const up = UPRIGHT;
  const frame0 = up.z0 + 500, roll0 = up.z0 + 570;                                       // 輸送架從翻桶機南側軸承座之後開始
  // core 的滾筒輸送線模型（滾筒＋軸承座、側樑、支腳）；開蓋站那一段（skip）是旋轉台。
  // root 只移 X：滾筒的本地 y／z 就是站的座標（tools/verify-detail.mjs 直接讀）
  const uc = conveyor({ axis: 'z', span: [frame0, up.z1], width: 700, height: up.top, roller: 30,
    rollers: { from: roll0, to: up.z1, pitch: 120, skip: [[DECAP.z, 370]] },
    brackets: { size: [26, 68, 70], offset: 357, y: up.top - 36 }, frame: { offset: 380, y: up.top - 70 },
    legs: { positions: { from: up.z0 + 600, to: up.z1, pitch: 900 }, size: [60, up.top - 140, 60], foot: false } });
  uc.root.position.x = up.x; group.add(uc.root);
  const uprightRollers = uc.rollers;
  uc.rollers.forEach((mesh, i) => rollers.push({ mesh, axis: 'x', radius: 30, along: uc.positions[i] }));
  for (const [z0, z1] of [[frame0, up.pick - 350], [up.pick + 350, up.place - 350], [up.place + 350, up.z1]])
    for (const s of [-1, 1]) block(group, [30, 120, z1 - z0], [up.x + s * 340, up.top + 160, (z0 + z1) / 2], MAT.yellow);
  for (const z of [up.pick + DRUM.R + 20, up.place + DRUM.R + 20]) block(group, [120, 60, 40], [up.x + 300, up.top + 40, z], MAT.steelOrange);   // 定位擋塊
  // 放回位頂升秤台：梳齒在滾筒縫隙間，平時低於滾筒面；氣缸頂升時把桶托離滾筒，荷重元只承受秤台＋桶
  const weigher = new THREE.Group(); group.add(weigher);
  const gaps = []; for (let z = roll0 + 60; z < up.z1; z += 120) if (Math.abs(z - up.place) < 300) gaps.push(z);
  for (const z of gaps) {
    block(weigher, [560, 40, 26], [up.x, up.top - 15 - 20, z], MAT.pu);                    // 梳齒（頂面平時低於滾筒面 15 mm）
    block(weigher, [30, 120, 22], [up.x, up.top - 95, z], MAT.steelDark);
  }
  block(weigher, [600, 30, gaps.at(-1) - gaps[0] + 60], [up.x, up.top - 165, (gaps[0] + gaps.at(-1)) / 2], MAT.steelDark);
  for (const [dx, dz] of [[-240, -180], [240, -180], [-240, 180], [240, 180]]) {   // 荷重元：core 的荷重元模型（不畫受力鈕）
    const lc = loadCell.create({ button: false }); lc.root.position.set(up.x + dx, up.top - 205, up.place + dz); weigher.add(lc.root);
  }
  block(group, [640, 30, 520], [up.x, up.top - 245, up.place], MAT.steel);                    // 頂升板
  // 頂升氣缸：core 的氣缸模型（只畫圓柱本體），原點在本體中心
  const liftCyl = airCylinder.create({ body: { shape: 'cyl', r: 55, length: up.top - 280, segments: 28, material: MAT.alu }, rod: false });
  liftCyl.root.position.set(up.x, (up.top - 280) / 2, up.place); group.add(liftCyl.root);
  // 秤重顯示器：core 的立柱式秤重顯示器模型，原點在立柱底面中心
  const ind = weighIndicator.create(); ind.root.position.set(up.x + 520, 0, up.place); group.add(ind.root);
  block(group, [700, 40, 40], [up.x, up.top + 40, up.z1 - 20], MAT.steelOrange);
  // 站名牌貼在輸送架西側下方：夾爪兩側導軌在桶身高度會掃過 up.x ± 420，牌子不能放在那裡
  plate(group, ['取桶位'], 420, 110, [up.x - 420, up.top - 230, up.pick], -Math.PI / 2, { w: 512, h: 130 });
  plate(group, ['放回位＋頂升秤台'], 560, 110, [up.x - 420, up.top - 230, up.place], -Math.PI / 2, { w: 512, h: 110 });
  plate(group, ['→ 裝填區（下一站）'], 900, 160, [up.x - 420, 1150, up.handoff - 200], -Math.PI / 2, { w: 640, h: 110 });

  section('decap');
  // ---------------------------------------------------------------- 自動開蓋站（相機定位 → 旋轉台對位 → 伺服鎖付軸反轉拆蓋）
  const dc = DECAP;
  for (const [dx, dz] of [[-650, -400], [650, -400], [-650, 400], [650, 400]]) block(group, [100, 2600, 100], [up.x + dx, 1300, dc.z + dz], MAT.steelBlue);
  for (const dz of [-400, 400]) block(group, [1400, 120, 100], [up.x, 2560, dc.z + dz], MAT.steelBlue);
  // 旋轉台：core 的萬向球旋轉台模型（盤面、球座、萬向球、迴轉支承、伺服馬達）；轉盤群組留在模型的 root 裡
  const tt = ballTurntable.create({ top: up.top }); tt.root.position.set(up.x, 0, dc.z); group.add(tt.root);
  const turntable = tt.table, tableRollers = tt.balls;
  for (const s of [-1, 1]) block(group, [40, 120, 500], [up.x + s * (DRUM.R + 110), up.top + 300, dc.z], MAT.yellow);
  const dcClamp = [];
  for (const s of [-1, 1]) { const c = cylinder(group, 20, 160, [up.x + s * (DRUM.R + 70), up.top + 302, dc.z], MAT.pu, 'y', 28); dcClamp.push({ c, s }); }
  // XY 模組：Z 向導軌在框架兩側，橫樑偏在台車北側，Z 軸立柱不穿過橫樑
  // 三軸都用 core 的線性模組模型；站的移動群組（dBridge、dCar、dZ）留著，模型的零件加進去，關節與每格改位置的程式不變
  // Y 軌 ×2：只畫導軌，導軌標 guide 'decap-y'（橫樑群組 on 'decap-y'，全場檢查視為滑動配合）
  const yAx = linearAxis.create({ axis: 'z', base: false, rails: { size: [60, 40, 900], at: [-1, 1].map(s => [up.x + s * dc.rail, 2510, dc.z]), material: MAT.steel }, carriage: false, guide: 'decap-y' });
  group.add(yAx.root);
  const dBridge = new THREE.Group(); dBridge.userData.on = 'decap-y'; group.add(dBridge);
  // X 橫樑（底座）＋台車（滑座）：滑座群組改掛到站的 dCar
  const xAx = linearAxis.create({ axis: 'x', base: { size: [dc.rail * 2 + 60, 100, 160], at: [up.x, 2440, -150], material: MAT.alu }, rails: false, carriage: { size: [260, 220, 220], at: [0, 2440, 0], material: MAT.steelDark }, guide: false });
  dBridge.add(xAx.root);
  const dCar = new THREE.Group(); dBridge.add(dCar);
  dCar.add(xAx.carriage);
  const dZ = new THREE.Group(); dCar.add(dZ);
  dZ.add(linearAxis.create({ axis: 'y', base: { size: [120, 898, 120], at: [0, 451, 0], material: MAT.alu }, rails: false, carriage: false, guide: false }).root);   // Z 軸立柱
  const spindles = {};
  for (const [k, dx, r] of [['big', -90, DRUM.big.r + 8], ['small', 90, DRUM.small.r + 8]]) {
    // 伺服鎖付軸：core 的模型（本體＋套筒＋撥爪）。站的 sock 群組留著當旋轉關節，模型的套筒群組加進去
    //（套筒撥爪與 Z 軸立柱的既有重疊靠「直接相連」放行，關節的父群組要維持是 dZ）
    const n = nutrunner.create({ socketR: r }); n.root.position.set(dx, 0, 0); dZ.add(n.root);
    const sock = new THREE.Group(); sock.position.set(dx, 0, 0); dZ.add(sock);
    sock.add(n.socket);
    spindles[k] = sock;
  }
  // 頂視相機：吊在框架北側橫樑外，斜拍桶頂，完全避開 XY 模組行程（橫樑 Z 範圍約 dc.z −430～+130）
  const camPos = new THREE.Vector3(up.x, 2150, dc.z - 600), camAim = new THREE.Vector3(up.x, up.top + DRUM.H, dc.z);
  block(group, [80, 60, 200], [up.x, 2650, dc.z - 510], MAT.alu);
  rod(group, [up.x, 2620, dc.z - 600], [up.x, 2230, dc.z - 600], 22, MAT.alu);
  // core 的工業相機模型：機身＋環形光（不畫鏡頭），原點在機身中心、光軸 +Z；虛擬相機與閃光燈都在機身中心。
  // 環形光用共用材質 MAT.cap（閃光時由 setDecap 換成 MAT.green），glow: false 讓模型不去改它的亮度
  const camD = visionCamera.create({
    axis: '+z', body: { size: [90, 90], length: 140, at: 0 }, lens: false, glass: false,
    ring: { r: 70, tube: 14, at: 90, segments: [8, 30], material: MAT.cap, glow: false },
    spot: { distance: 2500, angle: .5, at: 0, target: camPos.distanceTo(camAim), power: 900 },
    view: { fov: 36, near: 50, far: 6000, at: 0, name: '' },
  });
  const camDecap = camD.root; camDecap.position.copy(camPos); camDecap.lookAt(camAim); group.add(camDecap);
  const ringLight = camD.ring, decapCam = camD.camera, decapFlash = camD.light;
  // 桶蓋收集桶（斜槽）
  const bin = new THREE.Group(); bin.position.set(dc.bin.x, 0, dc.bin.z); group.add(bin);
  // 桶高 560：桶口低於立放輸送側導引（底面 y 607）
  cylinder(bin, 230, 560, [0, 280, 0], MAT.ppSolid, 'y', 24, 200);
  cylinder(bin, 210, 10, [0, 562, 0], MAT.hole, 'y', 28);
  const capPile = []; for (let i = 0; i < 8; i++) { const c = cylinder(bin, i % 2 ? 18 : 36, 16, [(i % 3 - 1) * 70, 500 + Math.floor(i / 3) * 18, ((i * 7) % 5 - 2) * 40], MAT.cap, 'y', 28); c.visible = false; capPile.push(c); }
  plate(group, ['桶蓋收集'], 380, 110, [dc.bin.x, 460, dc.bin.z + 222], 0, { w: 512, h: 150 });

  section('fence');
  // ---------------------------------------------------------------- 圍籬
  // 圍籬：gaps 為 [x, z, 開口寬]，在所在邊上精確切出開口（寬度依通過的設備與光柵決定），其餘每段約 1.5 m 一片網
  const posts = new Set();
  const post = (x, z) => { const k = Math.round(x) + ',' + Math.round(z); if (posts.has(k)) return; posts.add(k); block(fences, [60, 2000, 60], [x, 1000, z], MAT.fence); };
  const fencePath = (pts, closed, gaps = []) => {
    const list = closed ? [...pts, pts[0]] : pts;
    for (let i = 1; i < list.length; i++) {
      const [ax, az] = list[i - 1], [bx, bz] = list[i], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      // 這條邊上的開口（沿邊距離區間）
      const cuts = gaps.map(([gx, gz, w]) => { const t = (gx - ax) * ux + (gz - az) * uz, off = Math.abs((gx - ax) * uz - (gz - az) * ux); return off < 1 && t > 0 && t < L ? [t - w / 2, t + w / 2] : null; }).filter(Boolean).sort((p, q) => p[0] - q[0]);
      const pieces = []; let t = 0;
      for (const [c0, c1] of cuts) { if (c0 > t) pieces.push([t, c0]); t = Math.max(t, c1); }
      if (t < L) pieces.push([t, L]);
      for (const [p0, p1] of pieces) {
        const n = Math.max(1, Math.round((p1 - p0) / 1500));
        for (let k = 0; k < n; k++) {
          const s0 = p0 + (p1 - p0) * k / n, s1 = p0 + (p1 - p0) * (k + 1) / n, seg = s1 - s0, mid = (s0 + s1) / 2;
          const mx = ax + ux * mid, mz = az + uz * mid, yaw = Math.atan2(-uz, ux);
          if (seg > 80) {
            const panel = new THREE.Mesh(new THREE.PlaneGeometry(seg - 60, 1800), MAT.mesh); panel.position.set(mx, 1000, mz); panel.rotation.y = yaw; fences.add(panel);
            const frame = block(fences, [seg - 60, 30, 30], [mx, 1900, mz], MAT.fence); frame.rotation.y = yaw;
          }
          post(ax + ux * s0, az + uz * s0); post(ax + ux * s1, az + uz * s1);
        }
      }
    }
  };
  // 開口寬：立放輸送架 ±405、光柵 ±450 → 1060；龍門北側 AGV 送棧板（1200 寬）、光柵 ±700 → 1520；
  // 龍門東側橫躺輸送（含南側底板到 +480）、光柵 ±550 → 1220
  fencePath(FENCE, false, [[...FENCE_GATES.in, 1060], [...FENCE_GATES.out, 1060]]);
  fencePath(GANTRY_FENCE, true, [[PALLET_STATION.x, 8950, 1520], [6700, LYING.z, 1220]]);
  // 光柵（入口）：core 的安全光柵模型，一對投／受光器，原點在兩支中間的地面；只畫機身（不畫透光面與光幕面）
  for (const [x, z, w, ax] of [[PALLET_STATION.x, 8950, 1400, 'x'], [...FENCE_GATES.in, 900, 'x'], [...FENCE_GATES.out, 900, 'x'], [6700, LYING.z, 1100, 'z']]) {
    const lc = lightCurtain.create({ span: w, axis: ax, height: 1700, w: 50, d: 50, window: false, beam: false });
    lc.root.position.set(x, 0, z); fences.add(lc.root);
  }

  section('cabinet');
  // ---------------------------------------------------------------- 控制櫃與人機
  const cab = (key, color, name) => { const [x0, z0, x1, z1, h] = FOOTPRINTS[key]; block(group, [x1 - x0, h, z1 - z0], [(x0 + x1) / 2, h / 2, (z0 + z1) / 2], color); plate(group, name, Math.min(700, x1 - x0 - 60), 160, [(x0 + x1) / 2, h - 150, z0 - 2], Math.PI, { w: 512, h: 120 }); };
  cab('robotCtrl', MAT.cabinet, ['R-30iB Plus']);
  cab('panel', MAT.cabinet, ['主控盤 PLC']);
  const [hx0, hz0, hx1, hz1] = FOOTPRINTS.hmi;
  block(group, [150, 1100, 150], [(hx0 + hx1) / 2, 550, (hz0 + hz1) / 2], MAT.steelDark);
  // 人機：core 的 HMI 模型，整塊機身就是螢幕（不另裝面板），原點在機身中心，往後仰
  const hmiPanel = hmiModel.create({ w: 380, h: 280, d: 50, bevel: 0, bodyMaterial: MAT.screen, panel: false });
  hmiPanel.root.position.set((hx0 + hx1) / 2, 1250, (hz0 + hz1) / 2); hmiPanel.root.rotation.x = -.35; group.add(hmiPanel.root);
  // 三色燈：core 的三色燈模型，原點在離地 2000 的安裝點，燈桿（由地面到 1950）包含在模型裡；燈節由上而下是故障、等待、運轉
  const tower = signalTower.create({
    radius: 45, height: 90, segments: 28, base: 10, pitch: 95, on: 1.2, off: .05,
    lamps: [{ key: 'fault', material: 'red' }, { key: 'wait', material: 'amber' }, { key: 'run', material: 'green' }],
    pole: { r: 25, h: 1950, y: -1025, segments: 12, material: MAT.steel },
  });
  tower.root.position.set(FENCE[1][0] + 100, 2000, FENCE[1][1] + 100); group.add(tower.root);

  // 緊固、驅動、光電、櫃門、導軌與軸承細節均在既有設備範圍內。
  section('gantry');
  for (const [x, z] of g.posts) foot(group, x, z, 280);
  section('decap');
  for (const [dx, dz] of [[-650, -400], [650, -400], [-650, 400], [650, 400]]) foot(group, up.x + dx, dc.z + dz, 160);
  section('cabinet');
  for (const key of ['panel', 'robotCtrl']) cabinetDetails(group, ...FOOTPRINTS[key]);
  section('lying');
  motor(group, ly.x0 + 380, axisY - 100, ly.z + 475, .65);
  section('upright');
  motor(group, up.x + 520, 220, up.z1 - 500, .7, Math.PI / 2);
  motor(bridge, 0, g.beamY + 480, p0[1], .65);
  section('upright');
  for (const z of [up.decap - 410, up.pick - 260, up.place + 300, up.z1 - 300]) sensor(group, up.x + 340, up.top + 90, z, Math.PI / 2);
  section('lying');
  for (const x of [ly.place, ly.label, ly.buffer]) sensor(group, x, axisY + 40, ly.z + 330);   // 低於夾爪下緣，避開龍門張開的夾爪
  for (const s of [-1, 1]) { block(z1, [20, 1240, 12], [s * 85, 650, 117], MAT.steelDark); block(trolley, [32, 220, 32], [s * 130, g.beamY + 150, 160], MAT.steel); }
  bolts(bridge, [-1, 1].flatMap(s => [-1, 1].map(k => [s * 200, g.beamY + 565, (p0[1] + p2[1]) / 2 + k * 600])), 14);
  sections.push([group.children.length, null]);
  for (let i = 0; i + 1 < sections.length; i++) for (const c of group.children.slice(sections[i][0], sections[i + 1][0])) c.userData.station ??= sections[i][1];
  return {
    animate(time, st) {
      // 分段滾輪只在相鄰桶輸送時轉動；角度由桶位移決定，重播完全一致。
      for (const r of rollers) {
        const key = r.axis === 'z' ? 'lx' : 'uz', mode = r.axis === 'z' ? 'lying' : 'upright';
        const d = [st.drum0, st.drum1, st.drum2, st.drum3].find(d => d.mode === mode && Math.abs(d[key] - r.along) < 650);
        r.mesh.rotation[r.axis === 'z' ? 'y' : 'x'] = d ? -d[key] / r.radius : 0;
      }
    },
    mechanical: { rotRollers, uprightRollers, tableRollers, turntable, weigher, cradle, actuator, piston, upClamp, dcClamp },
    group, fences, labelCam, decapCam, gantryPivot, cradle, padLabel,
    setGantry({ x, z, y, tilt: t, jaw }) {
      bridge.position.x = x; trolley.position.z = z;
      // 兩段伸縮：內管原點即翻轉軸；外管底端隨行程移動，兩端都保持與內管、台車重疊
      z2.position.y = y;
      // 外管下緣保持在翻轉台擺動範圍（半徑約 250）之上
      z1.position.y = Math.max(2050 + (y - g.placeY) * 250 / (g.safeY - g.placeY), y + 300);
      tilt.rotation.z = t * Math.PI / 2;
      gJaws.set(jaw);
    },
    setLabeler({ pad: p, print, spin, flash }) {
      lbl.set({ pad: p, print });
      for (const r of rotRollers) r.rotation.x = -spin * Math.PI / 2 * DRUM.envelopeR / 70;
      labelFlash.intensity = flash ? 900 : 0; barLight.material = flash ? MAT.green : MAT.cap;
    },
    setUpender({ tilt: t, clamp }) { upd.set({ tilt: t, clamp }); },
    setDecap({ hx, hz, hy, spinBig, spinSmall, flash, clamp, table, caps }) {
      dBridge.position.z = DECAP.z + hz; dCar.position.x = up.x + hx; dZ.position.y = hy;
      spindles.big.rotation.y = spinBig * Math.PI * 2 * 2.5; spindles.small.rotation.y = spinSmall * Math.PI * 2 * 2.5;
      decapFlash.intensity = flash ? 900 : 0; ringLight.material = flash ? MAT.green : MAT.cap;
      for (const { c, s } of dcClamp) c.position.x = up.x + s * (DRUM.envelopeR + 20 + (1 - clamp) * 110);
      turntable.rotation.y = table * D2R;
      tableRollers.forEach(r => { r.rotation.x = 0; });
      capPile.forEach((c, i) => { c.visible = i < caps; });
    },
    setScale({ on, lift }) { ind.set({ on }); weigher.position.y = lift * WEIGH.stroke; },
    setTower(state) { tower.set(state); },
    socket: k => spindles[k],
  };
}
