import {robotController,controllerLeads} from '@core/electrical/electrical-components.js';
// 線體：地面、載具式輸送線（5 站）、載具（定位銷＋側夾＋堆疊柱）、進／出料升降堆料架、S1 頂視相機、S3 翻轉夾持治具、圍籬、三色燈
import * as THREE from 'three';
import {cabinetShell,controlPanel,entryGland,panelFeed} from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, carrier, support, CABLE } from '@core/electrical/cable-routing.js';
import { NB } from './notebook.js';
import { block, cylinder, decal, tube } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { floor } from '@core/geom/environment.js';
// 市購小件用 core 共用模型（core 1.9.0）：三色燈、HMI、急停、盒型感測器、安全光柵、穹頂光；參數對照見 core/MIGRATION.md
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { boxSensor, lightCurtain } from '@core/models/sensors.js';
import { domeLight } from '@core/models/lights.js';
// 市購品第二批（core 1.10.0）：雙帶輸送線與止擋、推／拉料氣缸、堆料架升降模組、S1 Z 向滑台、FRL、S1 頂視相機、S0 讀碼器；
// 參數對照見 core/migrations/1.10.0-*.md。載具、托叉、平台、立柱、吊臂等加工件留在本檔
import { edgeBeltConveyor, stopper } from '@core/models/transport.js';
import { airCylinder, linearAxis, frl } from '@core/models/motion.js';
import { visionCamera, codeReader } from '@core/models/vision.js';

export const LAYOUT = {
  // S3 在 x=1150：S2 右側護蓋作業時手腕在 x≤約 680，翻轉治具左端（x≥695）不在手腕範圍內
  stationX: [-2000, -1000, 0, 1150, 2000],   // S0 進料（堆料架）、S1 閉合外觀、S2 側邊護蓋、S3 翻面檢測、S4 出料（堆料架）
  stackerInX: -2000, stackerOutX: 2000,
  conveyorTop: 760,
  palletH: 40,
  padH: 14,
  palletPitch: 110,                          // 堆疊間距（載具 40 + 機台 36 + 淨空）
  railZ: -560,
  flipLift: 210,
  cradlePark: 100,                           // 翻轉治具待命高度：輸送期間停在上方 100 mm，讓出載具與筆電通道
  footOffset: 3.25,
  // S1 頂視取像頭：前側懸臂上的 Z 向滑軌；移入時穹頂光底緣在產品上方 80 mm，退出後讓手臂巡拍四側
  // 立柱在 z=1050（1010～1090）：取像頭退到 780 時滑座（≤850）與穹頂光外緣（≤990）都在立柱前方
  s1PostZ: 1050, s1HeadOut: 780, s1DomeGap: 80, s1DomeR: 200, s1BeamY: 2000,
};

// 常見材質用共用材質表 MAT（鋁擠型結構框、鋁、皮帶、鋼、黑件、警示黃、PU、藍色烤漆、螢幕、拋光銷）；
// 本站專屬外觀留在這裡：相機外殼、穹頂光擴散罩（地面用共用的 floor()）
const matFrame = MAT.frame;
const matAlu = MAT.alu, matBelt = MAT.belt, matPallet = MAT.steel, matDark = MAT.black;
const matCam   = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.4, metalness: 0.5 });
const matDome  = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.9, side: THREE.DoubleSide });
const matYellow = MAT.yellow, matPU = MAT.pu, matBlue = MAT.steelBlue;
const matPin   = MAT.chrome;

function box(w, h, d, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; m.receiveShadow = true; return m; }
function cyl(r, h, mat, seg = 24) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.castShadow = true; m.receiveShadow = true; return m; }

/** 載具：鋁框鏤空、PU 承載墊、定位銷×3、側夾×2、四角堆疊柱（可疊放入堆料架） */
export function createPallet(withClamps = true) {
  const pallet = new THREE.Group(); pallet.name = 'pallet';
  const pw = 440, pd = 330, ph = LAYOUT.palletH;
  for (const [w, h, d, x, z] of [[pw, ph, 55, 0, pd / 2 - 27], [pw, ph, 55, 0, -pd / 2 + 27], [70, ph, pd, pw / 2 - 35, 0], [70, ph, pd, -pw / 2 + 35, 0]]) {
    const m = box(w, h, d, matPallet); m.position.set(x, ph / 2, z); pallet.add(m);
  }
  for (const [x, z] of [[-150, -95], [150, -95], [-150, 95], [150, 95]]) { const p = box(40, LAYOUT.padH, 40, matPU); p.position.set(x, ph + LAYOUT.padH/2, z); pallet.add(p); }
  for (const [x, z] of [[-170, 127], [170, 127], [-170, -127]]) { const p = cyl(4, 30, matPin, 12);p.name='pallet-guide-pin'; p.position.set(x, ph + 15, z); pallet.add(p); }
  // 堆疊柱（四角，高度 = 堆疊間距）；內縮到 z=±125，讓出堆料架托叉（z=±140～164）的通道，推出／拉入時柱子不穿過托叉
  for (const [x, z] of [[-pw / 2 + 20, -pd / 2 + 40], [pw / 2 - 20, -pd / 2 + 40], [-pw / 2 + 20, pd / 2 - 40], [pw / 2 - 20, pd / 2 - 40]]) {
    const post = box(24, LAYOUT.palletPitch - ph, 24, matAlu); post.position.set(x, ph + (LAYOUT.palletPitch - ph) / 2, z); pallet.add(post);
  }
  const clamps = [];
  if (withClamps) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cg = new THREE.Group(); cg.position.set(sx * 207.5, ph + 18 + LAYOUT.padH + LAYOUT.footOffset, sz * 82); pallet.add(cg);
    // 氣缸本體放低（離載具框 2 mm、頂面低於護蓋下緣），以連接片帶動推桿：手臂在側門作業時工具不碰氣缸
    const cylBody = box(32, 12, 20, matDark); cylBody.position.set(sx * 9, -27, 0); cg.add(cylBody);
    const rod = new THREE.Group(); cg.add(rod);
    const rodM = cyl(4, 40, matPin, 10); rodM.rotation.z = Math.PI / 2; rodM.position.x = -sx * 30; rod.add(rodM);
    block(rod, [6, 26, 8], [-sx * 12, -14, 0], matDark);
    const pad = box(8, 18, 8, matPU); pad.name = 'pallet clamp pad'; pad.position.x = -sx * 52; rod.add(pad);
    clamps.push({ rod, sx });
  }
  decal(pallet,110,22,[0,ph/2,pd/2+1.2],[0,0,0],'QC • P001',{bg:'#1b3139',center:true});
  for (const sx of [-1,1]) for (const sz of [-1,1]) cylinder(pallet,3,1,[sx*200,ph+1,sz*125],matDark);
  return { group: pallet, setClamp(v) { for (const c of clamps) c.rod.position.x = -c.sx * (v * 25 - 25); } };
}

/** 升降式堆料架：立柱框架、升降平台（伺服＋皮帶）、推／拉載具的氣缸 */
function createStacker(x, dir) {
  const g = new THREE.Group(); g.position.set(x, 0, 0);
  const top = LAYOUT.conveyorTop;
  const W = 560, D = 460, H = 1750;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = box(40, H, 40, matFrame); p.position.set(sx * W / 2, H / 2, sz * D / 2); g.add(p); }
  for (const y of [40, H - 20]) for (const sz of [-1, 1]) { const r = box(W, 30, 30, matFrame); r.position.set(0, y, sz * D / 2); g.add(r); }
  // 升降模組（共用模型，直立）：後側立柱 80×H×60、導桿 ×4（12 見方）、螺桿 ø26、伺服馬達；平台與托架是加工件，留在下面的 lift 群組
  g.add(linearAxis.create({ axis: 'y', base: { size: [80, H, 60], at: [0, H / 2, -D / 2 - 40], material: matDark },
    rails: { size: [12, 1400, 12], at: [-1, 1].flatMap(sz => [-1, 1].map(sx => [sx * 235, 850, sz * 218])), material: matPin },
    screw: { r: 13, length: 1450, at: [0, 850, -D / 2 - 78], material: matPin }, motor: { size: [100, 110, 90], at: [0, 150, -D / 2 - 78], material: matBlue },
    carriage: false, guide: false }).root);
  const lift = new THREE.Group(); g.add(lift);
  // 平台 430×270：z 方向窄於托叉（z=±140～164）、x 方向避開推／拉料鞋，升降時不穿過托叉與料鞋
  const platform = box(430, 20, 270, matAlu); platform.position.y = 10; lift.add(platform);
  // 平台托架在平台下方接到後側升降立柱，上升到托叉高度時不碰托叉
  const bracket = box(120, 59.2, 110, matDark); bracket.position.set(0, -30.4, -185); lift.add(bracket);
  // 推料氣缸（在輸送線高度，把最底層載具推出／拉入）
  // 氣缸用共用模型：本體 70×40×60，活塞桿 ø12 由缸頭（離中心 35）長出，行程 0 時露出 80 mm。
  // 推板（PU）是加工件，裝在模型的桿端群組（tip，位置＝dir×(115＋行程)，就是原本推板的位置）；全場檢查的關節數因此和原本相同（桿＋桿端）
  const pusher = airCylinder.create({ axis: 'x', dir, w: 70, h: 40, d: 60, bodyMaterial: matDark, rod: { r: 6, length: 200, segments: 12, material: matPin, grow: { from: 35, min: 80 } } });
  pusher.root.position.set(-dir * (W / 2 + 60), top + 30, 0); g.add(pusher.root);
  const rod = pusher.rod;
  const plate = box(10, 40, 120, matPU); pusher.tip.add(plate);
  // 操作面板
  const opPanel = hmi.create({ w: 160, h: 110, d: 14, bevel: 0, bodyMaterial: MAT.screen, panel: false }); opPanel.root.position.set(0, 1500, D / 2 + 10); g.add(opPanel.root);
  const forks=[];
  for(const sz of [-1,1]){
    // 托叉 24 mm 寬、z=±140～164：承托載具前後框，與堆疊柱（z=±113～137）錯開
    const fork=block(g,[440,12,24],[0,top+6+LAYOUT.palletPitch-6,sz*152],matBlue);forks.push({fork,sz});
  }
  decal(g,140,70,[0,1500,D/2+18],[0,0,0],[dir===1?'INFEED':'OUTFEED','SERVO LIFT','6 PALLETS'],{bg:'#122d3c',center:true});
  return { group:g,lift,rod,dir,forks,setForks(v){for(const {fork,sz} of forks)fork.position.z=sz*(152+(1-v)*85);},setPush(mm){
    // Pusher shoe remains on the pallet edge; rod grows from the cylinder head.
    pusher.setStroke(mm);
  }};
}

/** 翻轉夾持治具（S3）：龍門立柱、升降滑台、旋轉軸（±X 兩端夾臂，PU 壓塊夾機台橡膠護角）。龍門在輸送線前側，後側留給手臂底部取像。 */
function createFlipCradle(x) {
  const g = new THREE.Group(); g.position.set(x, 0, 0);
  const top = LAYOUT.conveyorTop;
  const keepout = [];
  // 龍門立柱 z=225～285：讓出輸送線前側線槽（z=291～349）
  for (const sx of [-1, 1]) { const post = box(60, 1800, 60, matFrame); post.position.set(sx * 380, 900, 255); g.add(post); post.name = sx < 0 ? 'S3 左立柱' : 'S3 右立柱'; keepout.push(post); block(g,[18,900,15],[sx*380,1050,216],matPin); }
  const beam = box(840, 60, 60, matFrame); beam.position.set(0, 1800, 255); g.add(beam); beam.name = 'S3 橫樑'; keepout.push(beam);
  // 升降滑台（兩側），帶動旋轉軸
  const lift = new THREE.Group(); g.add(lift);
  for (const sx of [-1, 1]) {
    const slide = box(90, 120, 70, matDark); slide.position.set(sx * 380, 0, 225); lift.add(slide);
    block(lift,[60,60,225],[sx*380,0,112.5],matAlu);
    const motor = cyl(38, 90, matBlue); motor.rotation.z = Math.PI / 2; motor.position.set(sx * 410, 0, 0); lift.add(motor);
  }
  // 旋轉框：兩支夾臂沿 X 伸向機台兩端，夾墊在 z=±85（避開側邊護蓋）
  const rot = new THREE.Group(); lift.add(rot);
  const arms = [];
  for (const sx of [-1, 1]) {
    const shaft = cyl(18, 180, matAlu); shaft.rotation.z = Math.PI / 2; shaft.position.set(sx * 300, 0, 0); rot.add(shaft);
    const arm = new THREE.Group(); arm.position.set(sx * 235, 0, 0); rot.add(arm);
    // 夾臂橫樑外移 46 mm（夾緊時 x≥235.5），避開載具四角側夾的氣缸本體（x≤232.5、z=±72～92）；指桿在 z=±95～103
    const yoke = box(30, 40, 240, matDark); yoke.position.x = sx * 46; arm.add(yoke);
    for (const sz of [-1, 1]) { const finger = box(85, 22, 8, matDark); finger.position.set(-sx * 2.5, 0, sz * 99); arm.add(finger); const pad = box(10, 20.6, 8.6, matPU); pad.name = 'cradle clamp pad'; pad.position.set(-sx * 48, 0, sz * 98); arm.add(pad); }
    arms.push({ arm, sx });
  }
  return { group: g, lift, rot, arms, keepout, setClamp(v) { for (const a of arms) a.arm.position.x = a.sx * (235 - v * 30.5); } };
}

export function createCell(scene) {
  const g = new THREE.Group(); g.name = 'cell'; scene.add(g);
  const { stationX, conveyorTop: top, railZ } = LAYOUT;

  // 地面：11 × 7 m 深色地坪＋11 m 正方形格線（200 mm 一格，共 55 格，y = 0.5）
  floor(g, { size: [11000, 7000], cell: 200 });
  for (const z of [1150, -1150]) { const l = box(6000, 1, 40, matYellow); l.position.set(0, 1, z); g.add(l); }

  // ---- 載具式輸送線（S0 堆料架出口 → S4 堆料架入口）----
  // 雙帶輸送線（共用模型）：root 在原點，零件用本站的絕對座標。兩支樑 80×60（z=±170）、皮帶 6×30、支腳 50 見方＋腳座、橫撐、
  // 端輪 ø60、樑外側槽孔、皮帶刻線（每 110 mm，conv.set 循環位移）。支腳與腳座的名稱是模型預設的 conveyor leg／conveyor foot（verify-clearance 用）
  const x0 = stationX[0] + 300, x1 = stationX[4] - 300;
  const conv = edgeBeltConveyor.create({ span: [x0, x1], top, width: 280,
    rail: { h: 80, w: 60, y: top - 40 }, belt: { h: 6, w: 30, inset: 10, y: top + 3, z: 170, material: matBelt },
    lip: false, fasteners: false,
    strip: { size: [42, 3, 1], x: { from: x0 + 30, to: x1, pitch: 120 }, y: top - 30, z: 201 },
    pulleys: { r: 30, w: 38, x: [x0 + 30, x1 - 30], y: top - 28, segments: 24 },
    legs: { x: { from: x0 + 100, to: x1 - 100, pitch: 600, closed: true }, size: [50, top - 80, 50], foot: { size: [120, 12, 90] } },
    cross: { size: [40, 40, 400], y: top - 100 },
    // 驅動馬達在輸送線末端外側，夾在 S3 右立柱與收料堆料架立柱之間（空位 140 mm，本體 120 mm，兩側各留 10 mm）
    drive: { size: [120, 120, 100], pos: [x1 - 70, top - 90, 265] },
    marks: { size: [3, 1.4, 28], x: { from: x0 + 30, to: x1 - 100, pitch: 110 }, y: top + 6 } });
  g.add(conv.root);
  const stops=[];
  for (const x of [-1450,...stationX.slice(1,4),1450]) {
    // 止擋（共用模型）：原點在輸送面高度；氣缸本體 45×70×70 在下方，黃色擋板 10×24×68 降下時頂面與輸送面齊平、升起 28 mm
    const stop=stopper.create({stroke:28,up:0,blade:{size:[10,24,68],y:14},body:{size:[45,70,70],pos:[0,-35,0]}});
    stop.root.position.set(x+225,top,0);g.add(stop.root);
    // 到位感測器（盒型光電＋動作指示燈）：指示燈中心在機身中心上方 11 mm
    const sensor=boxSensor.create({ledY:11});sensor.root.position.set(x,top+12,210);g.add(sensor.root);
    stops.push({x,stop,led:sensor.led});
  }

  // ---- 主載具（隨機台移動）----
  const pallet = createPallet(true);
  pallet.group.position.set(stationX[0], top + 6, 0); g.add(pallet.group);
  const palletApi = { group: pallet.group, setClamp: pallet.setClamp, topY: top + 6 + LAYOUT.palletH + LAYOUT.padH };

  // ---- 進／出料升降堆料架 ----
  const stackerIn = createStacker(LAYOUT.stackerInX, +1);
  const stackerOut = createStacker(LAYOUT.stackerOutX, -1);
  g.add(stackerIn.group, stackerOut.group);

  // ---- S0：底視 SN 條碼讀取器（穿過載具鏤空）----
  // 讀碼器用共用模型（光軸朝上，原點在機身中心）：機身 70×60×70、鏡頭 ø36、紅色讀碼閃光（強度由 project.js 設定）；不畫示意光束。立柱是加工件，加在讀碼器的 root 上
  const reader = codeReader.create({ axis: '+y', body: { size: [70, 70], length: 60, material: matCam }, lens: { r: 18, length: 40, at: 50, segments: 24, material: matDark },
    beam: false, fan: false, spot: { color: 0xff3030, distance: 700, angle: .5, penumbra: .6, at: 60, target: 400, power: 800 } });
  const snReader = reader.root; snReader.position.set(stationX[0] + 300 + 250, 420, 0); g.add(snReader);
  const srStand = box(60, 400, 60, matFrame); srStand.position.y = -230; snReader.add(srStand);
  const snFlash = reader.light;

  // ---- S1：前側懸臂＋頂視取像頭（相機＋穹頂光同一組，沿 Z 滑軌移入／退出）----
  // 舊版門型架的後立柱落在手臂滑軌通道上，改為單邊懸臂；取像頭退到前側，手臂巡拍時不干涉。
  const s1x = stationX[1], productTop = top + 6 + LAYOUT.palletH + LAYOUT.padH + LAYOUT.footOffset + NB.H;
  const domeRim = productTop + LAYOUT.s1DomeGap, beamY = LAYOUT.s1BeamY, keepout = [];
  const s1 = new THREE.Group(); s1.position.set(s1x, 0, 0); g.add(s1);
  const s1Post = box(80, beamY + 60, 80, matFrame); s1Post.position.set(0, (beamY + 60) / 2, LAYOUT.s1PostZ); s1.add(s1Post); s1Post.name = 'S1 懸臂立柱'; keepout.push(s1Post);
  const s1Beam = box(80, 60, LAYOUT.s1PostZ + 140, matFrame); s1Beam.position.set(0, beamY + 30, (LAYOUT.s1PostZ - 100) / 2); s1.add(s1Beam); s1Beam.name = 'S1 懸臂橫樑'; keepout.push(s1Beam);
  // Z 向滑台（共用模型）：滑軌 30×12 貼在橫樑底面，滑座 120×50×140；滑座群組改掛到本站的 head 群組，跟著取像頭移動
  const slide = linearAxis.create({ axis: 'z', base: false, rails: { size: [30, 12, LAYOUT.s1PostZ + 100], at: [[0, beamY - 6, (LAYOUT.s1PostZ - 100) / 2]], material: matPin },
    carriage: { size: [120, 50, 140], at: [0, beamY - 37, 0], material: matDark, name: 'S1 取像頭滑座' }, guide: false });
  s1.add(slide.root);
  const head = new THREE.Group(); s1.add(head);
  head.add(slide.carriage); const headCar = slide.carriageBody; keepout.push(headCar);   // keepout 放滑座網格
  const hanger = box(40, beamY - 62 - (domeRim + 405), 40, matFrame); hanger.position.y = (beamY - 62 + domeRim + 405) / 2; head.add(hanger); hanger.name = 'S1 取像頭吊臂'; keepout.push(hanger);
  // 頂視相機（共用模型，光軸朝下，原點在機身中心）：機身 80×90×80、鏡頭 ø56×70；只當外形用，不裝玻璃、環形光、閃光與虛擬相機
  const topCam = visionCamera.create({ body: { size: [80, 80], length: 90, at: 0, material: matCam }, lens: { r: 28, length: 70, at: 80, segments: 24, material: matDark }, glass: false, ring: false, spot: false, view: false });
  topCam.root.position.y = domeRim + 360; head.add(topCam.root);
  const camBody = topCam.body; camBody.name = 'S1 頂視相機'; keepout.push(camBody);
  const tcLens = topCam.lens; tcLens.name = 'S1 頂視鏡頭'; keepout.push(tcLens);
  // 穹頂光（共用模型）：原點在底緣中心；聚光燈在底緣上方 250、照向底緣下方 180（＝產品頂面下 100，s1DomeGap 80）
  const dome = domeLight.create({ radius: LAYOUT.s1DomeR, material: matDome }); dome.root.position.y = domeRim; head.add(dome.root);
  dome.dome.name = 'S1 穹頂光'; keepout.push(dome.dome);   // keepout 放擴散罩網格（不是 root）
  const topFlash = dome.light;
  const cameraHarness=carrier(s1,'S1 / retracting camera carrier',{origin:[85,beamY+90,0],axis:[0,0,1],fixed:390,min:0,max:780,radius:55,width:34,pitch:20});
  for(const z of [50,420,750])support(s1,'S1 / fixed guide mount',[40,beamY+45,z],[85,beamY+79,z],6);
  cable(head,'S1 / moving camera drop',[[85,beamY+200,0],[90,beamY+110,20],[65,beamY-30,30],[55,domeRim+410,30],[55,domeRim+365,0],[43.5,domeRim+365,0]],{radius:3,color:CABLE.signal,clips:5,backing:{offset:[18,0,0],feet:[[0,[60,beamY-12,0]],[3,[20,domeRim+430,0]]]}});
  cable(head,'S1 / dome-light lead',[[43.5,domeRim+365,0],[90,domeRim+340,0],[220,domeRim+240,0],[225,domeRim+60,0],[211,domeRim+4,0]],{radius:2.5,color:CABLE.power,clips:3});
  const setHead = v => { head.position.z = (1 - v) * LAYOUT.s1HeadOut; cameraHarness.set(head.position.z); };
  setHead(0);
  // ---- S3：翻轉夾持治具 ----
  const cradle = createFlipCradle(stationX[3]);
  g.add(cradle.group);

  // ---- 三色燈、圍籬（後側與兩端）、前側光柵 ----
  const occ = new THREE.Group(); occ.name = 'occluders'; g.add(occ);   // 錄製時可隱藏的遮擋物
  // 三色燈（共用模型）：原點在燈桿頂，燈桿往下 300；燈節由上而下 red／yellow／green（y = 90／50／10），tower.set(鍵名) 切換
  const tower = signalTower.create({ height: 36, base: 10, pitch: 40, colors: { red: 0xff3b3b, yellow: 0xffb020, green: 0x3dd68c }, lens: { opacity: .85 },
    pole: { r: 8, h: 300, y: -150, segments: 24 }, shadow: { lamps: false } });
  tower.root.position.set(stationX[4] - 450, top + 320, -300); g.add(tower.root);
  // 後圍籬：手臂待命／PTP 時肘部最遠到 z≈-996，圍籬放在 railZ-500，保留約 60 mm
  const backZ = railZ - 500, endX = 2700;
  for (let x = -endX; x <= endX; x += 675) { const p = box(40, 1400, 40, matFrame); p.position.set(x, 700, backZ); occ.add(p); }
  for (const y of [500, 1380]) { const r = box(endX * 2, 14, 14, y > 1000 ? matYellow : matFrame); r.position.set(0, y, backZ); occ.add(r); }
  for (const x of [-endX, endX]) {
    const post = box(40, 1400, 40, matFrame); post.position.set(x, 700, 700); occ.add(post);
    for (const y of [500, 1380]) { const r = box(14, 14, 700 - backZ, y > 1000 ? matYellow : matFrame); r.position.set(x, y, (700 + backZ) / 2); occ.add(r); }
  }
  // 前側安全光柵（共用模型）：兩支在 x=±endX、z=900，機身 30×900×30
  const curtain = lightCurtain.create({ span: 2 * endX, height: 900, w: 30, d: 30, material: matYellow, window: false, beam: false }); curtain.root.position.set(0, 0, 900); occ.add(curtain.root);
  const cab = box(600, 1800, 500, matDark); cab.position.set(-3300, 900, -300); occ.add(cab);
  // 電控櫃 HMI（共用模型）：整塊是螢幕，畫面文字是固定貼紙（在機身中心前方 12 mm）
  const screen = hmi.create({ w: 500, h: 300, d: 20, bevel: 0, bodyMaterial: MAT.screen, panel: false,
    text: { lines: ['QC CELL / AUTO','WORK ORDER : RMK12608372','VISION + FORCE CONTROL','SIMULATION'], w: 390, h: 220, z: 12, options: { bg: '#102635', color: '#65d7b8' } } });
  screen.root.position.set(-3300, 1350, -40); occ.add(screen.root);

  // Frame fasteners, levelling feet, pneumatic service unit and electrical panel details.
  for(let x=x0+100;x<x1;x+=600)for(const z of [-170,170]){cylinder(g,8,35,[x,25,z],matPin);cylinder(g,27,8,[x,7,z],matDark);}
  // FRL 三點組（共用模型）：一體式本體 160×100×80、三顆杯 ø28×65、壓力表 ø44；壓力貼紙與氣管留在本檔
  const frlUnit=frl.create({pitch:50,bowlR:14,bowlH:65,head:false,body:{size:[160,100,80],at:[0,0,0],material:matAlu},bowl:{y:-80,z:10,segments:20,material:matDome},gauge:{r:22,t:10,at:[0,20,47],segments:20,material:matDark}});
  frlUnit.root.position.set(430,570,240);g.add(frlUnit.root);
  decal(g,28,28,[430,590,293],[0,0,0],'0.5 MPa',{center:true});
  tube(g,[[430,500,220],[430,400,190],[600,400,190],[650,720,190]],5,matBlue);
  for(let i=0;i<9;i++)block(occ,[180,3,3],[-3300,350+i*12,-48],matFrame);
  // 急停（共用模型）：底座環中心在安裝點、按鈕頭往前 10 mm
  const stopButton=estop.create({collarR:24,capH:20,collarZ:0,capZ:10});stopButton.root.position.set(-3120,1080,-40);occ.add(stopButton.root);
  const columns=[];g.traverse(m=>{const p=m.geometry?.parameters;if(m.material===matFrame&&p?.height>500&&p.width<=80&&p.depth<=80)columns.push(m);});
  for(const column of columns){
    const p=column.geometry.parameters;
    for(const side of [-1,1]){
      block(column,[3,p.height-55,.6],[side*p.width*.2,0,p.depth/2+.4],matDark);
      for(const y of [-p.height/2+25,p.height/2-25])cylinder(column,3,2,[side*p.width*.27,y,p.depth/2+1],matPin,'z',6);
    }
  }
  cableTray(g,'CELL / segregated field wiring',[-2530,400,320],[2500,400,320],{width:58});
  for(let x=x0+100;x<=x1-100;x+=600)if([LAYOUT.stationX[3]-380,LAYOUT.stationX[3]+380].every(px=>Math.abs(x-px)>60))support(g,'CELL / trough leg bracket',[x,389,195],[x,389,320],6);
  cable(g,'S1 / rear-of-post feed',[[s1x,400,335],[s1x+240,600,LAYOUT.s1PostZ+60],[s1x+240,1900,LAYOUT.s1PostZ+60],[s1x+85,2090,LAYOUT.s1PostZ-100],[s1x+85,2090,390]],{radius:6,color:CABLE.sleeve,clips:9,backing:{offset:[20,0,0],feet:[[1,[s1x+40,600,LAYOUT.s1PostZ]],[2,[s1x+40,1900,LAYOUT.s1PostZ]],[4,[s1x+40,beamY+45,390]]],radius:8}});
  // 滑軌供電：從前側線槽下到地面，沿滑軌前方地面繞過滑軌端部（x=-1460），再從後方接到拖鏈固定端；
  // 不橫越滑座行程（舊路徑斜穿滑軌，滑座經過 x≈-180 時會撞線）
  cable(g,'RAIL / fixed supply',[[0,400,300],[0,10,300],[0,10,railZ+180],[-1460,10,railZ+180],[-1460,10,railZ-290],[0,10,railZ-290],[0,30,railZ-246]],{radius:8,color:CABLE.sleeve,clips:0});
  const cabinet=cabinetShell(g,'CTRL / under-conveyor cabinet',{center:[-700,300,20],size:[460,600,440],entries:[{x:-150,z:180,hole:14},{x:150,z:180,hole:16},{x:0,z:180,hole:10}],thickness:12});
  const panel=controlPanel(g,'CTRL / drive and vision IO',{center:[-700,300,-150],width:410,height:460,backZ:-197,profile:'military'});
  const controller=robotController(g,{at:[-700,63,-145],floor:4});controllerLeads(g,controller,panel);
  const motionCabinet=cabinetShell(g,'CTRL / peripheral drive cabinet',{center:[-1300,300,20],size:[460,600,440],entries:[{x:0,z:180,hole:10}],thickness:12});
  const motionPanel=controlPanel(g,'CTRL / peripheral drives',{center:[-1300,300,-150],width:410,height:460,backZ:-197,profile:'military-motion'});
  for(const x of [-700,-1300])entryGland(g,'CTRL / inter-cabinet service '+x,{at:[x,600,200],hole:10,wire:4,thickness:12});
  panelFeed(g,'CTRL / inter-cabinet bus',[panel.ports[11],[-700,500,-100],[-700,540,200],[-700,660,200],[-700,680,250],[-1300,680,250],[-1300,660,200],[-1300,540,200],[-1300,500,-100],motionPanel.ports[0]],{radius:4});
  for(const [x,hole,wire] of [[-850,14,6],[-550,16,8]])entryGland(g,'CTRL / roof entry '+x,{at:[x,600,200],hole,wire,thickness:12});
  panelFeed(g,'CTRL / S1 to panel',[[s1x,400,335],[s1x,660,335],[-850,660,335],[-850,660,200],[-850,540,200],[-850,505,-100],panel.ports[3]],{radius:6});
  panelFeed(g,'CTRL / rail power to panel',[[0,400,300],[-140,400,320],[-140,660,320],[-550,660,200],[-550,540,200],[-550,505,-100],panel.ports[9]],{radius:8,color:CABLE.power});
  // keepout：手臂不得進入的固定結構（S1 懸臂與取像頭、S3 龍門），供驗證做碰撞檢查
  return { group:g,occluders:occ,pallet:palletApi,stackerIn,stackerOut,cradle,topFlash,snFlash,tower,stops,setHead,keepout:[...keepout,...cradle.keepout,...cabinet.solids,...motionCabinet.solids],
    updateTransport(x,located){conv.set({s:x});for(const s of stops){const hit=Math.abs(x-s.x)<2;s.stop.set(hit&&located?1:0);s.led.material.emissiveIntensity=hit?1.4:0;}},
    get topCamPos(){return topCam.root.getWorldPosition(new THREE.Vector3());},snReaderPos:snReader.position.clone() };
}
