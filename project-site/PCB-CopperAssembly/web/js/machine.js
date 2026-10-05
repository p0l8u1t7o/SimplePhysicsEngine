// 機台：底座、邊軌輸送線（S1–S3 頂升真空台）、S0／S4 料倉與上下料、S1／S3 相機龍門、
// S2 雙龍門（4 吸嘴頭，Z＋θ）、柔性供料盤、仰視相機、外罩與三色燈。座標同 layout.js。
// 市購品用 core 共用模型（core 1.10.0）：相機 visionCamera、邊軌輸送 edgeBeltConveyor、止擋 stopper、頂升氣缸 airCylinder、
// 柔性供料盤 flexFeeder、線性軸 linearAxis（上下料樑與升降柱、S1／S3 的 Z 軌與 X 樑、S2 的 Y 軌與龍門樑）、吸盤 suctionCup、
// Z-θ 主軸 zThetaSpindle、三色燈 signalTower、HMI hmi。加工件（頂升塊、吸盤架、導向座、吸嘴座、吸嘴尖端、支架、立柱）與工件留在站內。
// 會動的機構保留站自己的群組（car、zAxis、beam、head、spindle…），模型的 root 或可動子群組加進去，sim.js 每格改的物件不變。
import * as THREE from 'three';
import {cabinetShell,controlPanel,entryGland,panelFeed} from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, carrier, support, CABLE } from '@core/electrical/cable-routing.js';
import { perforated } from '@core/geom/perforated.js';
import { block, decal } from '@core/geom/shapes.js';
import { floor } from '@core/geom/environment.js';
import { MAT, finished } from '@core/geom/materials.js';
import { signalTower, hmi } from '@core/models/indicators.js';
import { visionCamera } from '@core/models/vision.js';
import { airCylinder, linearAxis, suctionCup, zThetaSpindle } from '@core/models/motion.js';
import { edgeBeltConveyor, stopper, flexFeeder } from '@core/models/transport.js';
import { LAYOUT, PRODUCT, HOLES, BOARD_TOP } from './layout.js';
import { createCoin } from './board.js';

// 常見材質取自共用材質表 MAT（鋁擠型框、鋁、黑件、烤漆、藍色烤漆鋼、黃色件）；框、鋁件與底座烤漆用 finished() 的帶細紋快取複本，不改動共用材質。
// 本機專屬的外觀留在這裡：花崗岩台、綠色皮帶、PC 透明外罩、背光供料盤。
const matFrame = finished(MAT.frame, 'metal', .012);
const matAlu = finished(MAT.alu, 'metal', .008);
const matDark = MAT.black;
const matBase = finished(MAT.cabinet, 'polymer', .025);
const matGranite = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.85 });
const matBlue = MAT.steelBlue;
const matBelt = new THREE.MeshStandardMaterial({ color: 0x2e7d56, roughness: 0.75 });
const matYellow = MAT.yellow;
const matPC = new THREE.MeshPhysicalMaterial({ color: 0xcfe3ff, roughness: 0.1, transmission: 0.3, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
const matFeeder = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.7, emissive: 0x9fb8c8, emissiveIntensity: 0.25 });
const top = LAYOUT.conveyorTop, ST = LAYOUT.stations, G = LAYOUT.gantry;
function annulus(parent, outer, inner, y, material) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), material);
  mesh.rotation.x = Math.PI / 2; mesh.position.y = y; parent.add(mesh); return mesh;
}

/** 相機外形（朝向 dir：'down' 或 'up'），回傳 { group, ring, cam（視角） } */
function camera(parent, pos, dir, { fov = 20, ringR = 34, power = 600, leadSide = 0 } = {}) {
  const s = dir === 'down' ? 1 : -1;
  // 相機本體是 core 的 visionCamera（機身、鏡頭、三道調焦環、保護玻璃、環形光、閃光燈、虛擬相機）；原點在鏡頭前緣。
  // 保護玻璃退到原點後方 1 mm，不會擋到自己的畫面；閃光燈位置 −s 是原本 SpotLight 的預設位置 (0, 1, 0)。
  const c = visionCamera.create({
    axis: dir === 'down' ? '-y' : '+y', material: matDark,
    body: { at: -60 }, lens: { segments: 20 },
    bands: { ats: [-7, -13, -25], r: 15.5, length: 1.4, material: matAlu },
    glass: { r: 11, length: .5, at: -1, segments: 40, material: new THREE.MeshPhysicalMaterial({ color: 0x203b50, metalness: .3, roughness: .09 }), shadow: { cast: false } },
    ringR, spot: { at: -s, power }, view: { fov, at: 0, name: '' },   // 虛擬相機原本沒有名稱，維持不命名
  });
  const g = c.root; g.position.set(...pos); parent.add(g);
  // 兩條線材（資料線、環形光電源線）是站內的走線，加在相機 root 上
  const data=leadSide?[[leadSide*22,s*68,0],[leadSide*40,s*70,0],[leadSide*46,s*110,0],[leadSide*46,s*125,0]]:[[0,s*68,-17],[0,s*70,-35],[0,s*(dir==='up'?85:110),-42],[0,s*125,-42]];
  const lightRoute=leadSide?[[leadSide*22,s*63,0],[leadSide*(ringR+12),s*60,0],[leadSide*(ringR+12),s*22,0],[leadSide*ringR,s*5,0]]:[[0,s*63,17],[0,s*60,ringR+12],[0,s*22,ringR+12],[0,s*5,ringR]];
  cable(g,'CAM / data connector',data,{radius:2.4,color:CABLE.signal,clips:1});
  cable(g,'CAM / ring-light lead',lightRoute,{radius:1.5,color:CABLE.power,clips:1});
  return { group: g, cam: c.camera, flash: c.set };   // flash(布林)：環形光 1.4／0.05、閃光燈 power／0
}

export function createMachine(scene) {
  const g = new THREE.Group(); g.name = 'machine'; scene.add(g);
  const keepout = [], ko = (m, n) => { m.name = n; keepout.push(m); return m; };
  const routingUpdates=[];
  const ground = floor(g, { size: [9000, 6000], cell: 200 });   // 9 × 6 m 深色地坪＋9 m 見方、200 mm 格線（core 預設配色）

  // ---- 底座（S2 花崗岩平台）與輸送線 ----
  const baseEntries=[{x:-620,z:LAYOUT.feeder.A.z-42,hole:9,sourceY:784},{x:620,z:LAYOUT.feeder.B.z-42,hole:9,sourceY:784},...['A','B'].map(H=>({x:LAYOUT.upCam[H].x,z:LAYOUT.upCam[H].z-42,hole:9,sourceY:755}))];
  const baseCabinet=cabinetShell(g,'BASE / electrical cabinet',{center:[0,390,0],size:[3500,780,1000],entries:baseEntries,thickness:16,material:matBase});
  const basePanel=controlPanel(g,'BASE / motion and vision control',{center:[0,400,-440],width:3200,height:590,backZ:-497,profile:'pcb'});
  for(const [i,e] of baseEntries.entries()){
    entryGland(g,'BASE / camera gland '+i,{at:[e.x,780,e.z],hole:e.hole,wire:2.4,thickness:16});
    panelFeed(g,'BASE / camera to terminal '+i,[[e.x,e.sourceY,e.z],[e.x,720,e.z],[e.x,675,-390],[basePanel.ports[i*3][0],675,-390],basePanel.ports[i*3]],{radius:2.4});
  }
  // 花崗岩底面嵌入電控箱頂板 1 mm、前後內縮 2 mm：與頂板、進線固定頭、仰視相機座都不同平面
  perforated(g,[1200,61,996],[0,809.5,0],Object.values(LAYOUT.upCam).filter(u=>typeof u==='object').map(u=>[u.x,u.z,60]),matGranite).name='granite-camera-service-bores';
  // 邊軌輸送（core edgeBeltConveyor）：兩支 40×16 邊軌（每 140 mm 一顆圓柱頭螺栓）、綠色皮帶、皮帶刻線、六對支腳；
  // root 留在原點，模型裡的 X 就是機台座標。刻線群組 conv.marks 由 sim.js 每格位移（shift % 60）。
  const conv = edgeBeltConveyor.create({ span: [-1700, 1700], width: 2 * LAYOUT.railInner, top,
    rail: { h: 40, w: 16, y: top - 12, material: matAlu }, belt: { inset: 10, material: matBelt },
    lip: false, pulleys: false, cross: false, drive: false,
    fasteners: { type: 'bolt', x: { from: -1640, to: 1640, pitch: 140, closed: true }, y: top + 9, material: matAlu, socketMaterial: matDark },
    marks: { x: { from: -1680, to: 1680, pitch: 60 }, material: matAlu },
    legs: { x: [-1600, -1000, -300, 300, 1000, 1600], size: [40, top - 820, 40], y: (top + 820) / 2 - 20, material: matFrame, foot: false } });
  g.add(conv.root); const beltMarks = conv.marks;
  // 頂升真空台（S1、S2、S3）：頂升塊是加工件（留站內，sim.js 每格升降），四角的頂升氣缸是 core airCylinder（只畫本體）
  const lifts = [1, 2, 3].map(i => {
    const l = new THREE.Group(); l.position.x = ST[i]; g.add(l); block(l, [330, 10, 330], [0, top - 7, 0], matAlu);
    for (const [x, z] of [[-120, -120], [120, -120], [-120, 120], [120, 120]]) { const c = airCylinder.create({ rod: false, bodyMaterial: matDark }); c.root.position.set(ST[i] + x, top - 60, z); g.add(c.root); }
    return l;
  });
  // 止擋（core stopper，只有圓銷、不畫氣缸本體）：回傳升降群組 slide，sim.js 每格設 position.y = (lift − 1) × 24
  const stops = [1, 2, 3].map(i => { const s = stopper.create({ pin: { r: 6, h: 24, y: -2, segments: 20, material: matAlu }, body: false });
    s.root.position.set(ST[i] + 181, top, 0); g.add(s.root); return s.slide; });

  // ---- S0／S4 料倉＋上下料 ----
  const stacks = {}, loaders = {};
  for (const [key, x, label] of [['S0', ST[0], '上料料倉'], ['S4', ST[4], '收料料倉']]) {
    const sg = new THREE.Group(); sg.position.set(x, 0, LAYOUT.stackZ); g.add(sg);
    block(sg, [420, 820, 420], [0, 410, 0], matBase);
    for (const [px, pz] of [[-190, -190], [190, -190], [-190, 190], [190, 190]]) block(sg, [20, 500, 20], [px, 1070, pz], matAlu);
    const liftPlate = block(sg, [360, 10, 360], [0, 825, 0], matDark);
    const stack = new THREE.Mesh(new THREE.BoxGeometry(350, 1, 350), new THREE.MeshStandardMaterial({ color: 0xb87250, roughness: 0.5, metalness: 0.7 }));
    stack.position.y = 830; sg.add(stack); stacks[key] = { stack, liftPlate };
    decal(g, 160, 26, [x, 720, LAYOUT.stackZ + 211], [0, 0, 0], label, { bg: '#122d3c', color: '#9fd8ff', center: true });
    // 上下料：z 向橫移＋升降＋真空吸盤架
    for (const dx of [-230, 230]) block(g, [40, 1500 - 820, 40], [x + dx, (1500 + 820) / 2, LAYOUT.stackZ + 230], matFrame);
    ko(block(g, [40, 40, LAYOUT.stackZ + 300], [x - 230, 1500, (LAYOUT.stackZ - 60) / 2], matFrame), label + '橫樑');
    ko(block(g, [40, 40, LAYOUT.stackZ + 300], [x + 230, 1500, (LAYOUT.stackZ - 60) / 2], matFrame), label + '橫樑');
    const car = new THREE.Group(); g.add(car); car.position.x = x;
    // 橫移樑與升降柱是 core linearAxis（只畫本體；移動由站的 car／zAxis 群組帶動），吸盤 ×9 是 core suctionCup
    car.add(linearAxis.create({ axis: 'z', base: { size: [494, 46, 80], at: [0, 1500, 0], material: matAlu }, rails: false, carriage: false, guide: false }).root);   // 兩端縮進固定橫樑外側 3 mm、上下各高出 3 mm：不與橫樑同平面，也不碰拖鏈軌支撐
    const zAxis = new THREE.Group(); car.add(zAxis);
    zAxis.add(linearAxis.create({ axis: 'y', base: { size: [60, 290, 60], at: [0, 155, 0], material: matDark }, rails: false, carriage: false, guide: false }).root);   // 升降柱底在吸盤架之上，不碰基板
    const frame = new THREE.Group(); frame.position.y = 7; zAxis.add(frame);   // 吸盤底面＝zAxis 原點（cupY），吸盤不再陷入基板
    block(frame, [330, 12, 20], [0, 6, 0], matAlu); block(frame, [20, 12, 330], [0, 6, 0], matAlu);   // 吸盤架（加工件）
    frame.add(suctionCup.create({ r: 12, h: 10, topR: 12, material: matDark, cupName: '', at: [-140, 0, 140].flatMap(cx => [-140, 0, 140].map(cz => [cx, -2, cz])) }).root);
    loaders[key] = { car, zAxis };
    const feed=carrier(g,key+' / horizontal carrier',{origin:[x+280,1540,0],axis:[0,0,1],fixed:280,min:0,max:LAYOUT.stackZ,radius:40,width:28});
    const vertical=carrier(car,key+' / lift carrier',{origin:[65,1500,60],axis:[0,1,0],rise:[1,0,0],min:-410,max:0,radius:35,width:24});
    cable(car,key+' / axis junction',[[280,1620,0],[290,1660,0],[65,1640,60],[65,1500,60]],{radius:4,color:CABLE.sleeve,backing:{offset:[0,0,18],feet:[[0,[240,1520,0]],[3,[65,1500,40]]]}});
    cable(zAxis,key+' / vacuum frame feed',[[135,280,60],[140,245,60],[110,230,60],[33.5,230,0]],{radius:3,color:CABLE.air});
    for(const z of [300,560])support(g,key+' / carrier rail support',[x+250,1500,z],[x+280,1529,z],6);
    support(car,key+' / lift carrier fixed mount',[54,1500,40],[54,1500,60],6);
    support(zAxis,key+' / lift moving anchor',[30,280,0],[135,280,60],5);
    routingUpdates.push(()=>{feed.set(car.position.z);vertical.set(zAxis.position.y+280-1500);});
  }

  // ---- S1／S3 相機龍門（XY） ----
  const scanners = {};
  for (const [key, i] of [['S1', 1], ['S3', 3]]) {
    const x0 = ST[i];
    // 完全懸臂：兩根 Z 軌與立柱都在外側（離 S2 較遠的一側），橫樑從外側伸到板面上方；
    // 相機車掃描 x0 ± 131、外側原點 ±175（車體 ±35），都不跨過任何 Z 軌，內側也沒有立柱擋到 S2 雙龍門。
    const out=key==='S1'?-1:1, RAILS=[230,300], ZC=330;   // Z 軌與 Z 向拖鏈離站中心的距離
    for (const d of RAILS) { const x=x0+out*d; ko(block(g,[40,600,40],[x,1120,-260],matFrame),key+'立柱');ko(block(g,[40,600,40],[x,1120,260],matFrame),key+'立柱'); }
    // 兩支 Z 軌＋橫樑在 Z 軌上的兩個滑塊（core linearAxis）：滑塊群組改掛到站的 beam 群組，跟著橫樑走
    const zAx = linearAxis.create({ axis: 'z', base: false, rails: { size: [30, 30, 550], at: RAILS.map(d => [x0 + out * d, 1420, 0]), material: matAlu },
      carriage: { size: [34, 16, 70], at: RAILS.map(d => [x0 + out * d, 1430, 0]), material: matDark }, guide: false });
    g.add(zAx.root);
    const beam = new THREE.Group(); g.add(beam);
    // X 樑＋相機車本體（core linearAxis）：樑外端 x0∓320 越過外側 Z 軌，內端 x0±270；相機車本體改掛到站的 car 群組
    const xAx = linearAxis.create({ axis: 'x', base: { size: [590, 40, 50], at: [x0 + out * 25, 1450, 0], material: matAlu }, rails: false,
      carriage: { size: [70, 90, 70], at: [0, 1410, 0], material: matDark }, guide: false });
    beam.add(xAx.root);
    beam.add(zAx.carriage);
    const car = new THREE.Group(); beam.add(car);
    car.add(xAx.carriage);
    block(car,[20,140,20],[0,1300,0],matAlu);   // 相機吊桿（加工件）
    const cam = camera(car,[0,1150,0],'down',{fov:2*Math.atan(8.8/2/23.5)*180/Math.PI,ringR:45}); // WD 約 198 mm，保留約 111 × 74 mm 視野
    decal(g,150,24,[x0,1525,0],[0,0,0],key==='S1'?'S1 基板視覺定位':'S3 放置後檢查',{bg:'#122d3c',color:'#9fd8ff',center:true});
    scanners[key] = { beam, car, cam, x0 };
    const scanX=carrier(beam,key+' / camera X carrier',{origin:[x0,1488,0],min:-180,max:180,radius:35,width:24,pitch:14});
    const scanZ=carrier(g,key+' / camera Z carrier',{origin:[x0+out*ZC,1600,0],axis:[0,0,1],min:-180,max:180,radius:35,width:24,pitch:14});
    cable(car,key+' / camera vertical lead',[[0,1558,0],[0,1575,-55],[0,1500,-60],[0,1400,-60],[0,1275,-42]],{radius:3,color:CABLE.signal,clips:4,backing:{offset:[out*18,0,0],feet:[[2,[out*18,1455,-35]],[4,[out*10,1275,-10]]]}});
    for(const dx of [-120,160])support(beam,key+' / carrier standoff',[x0+dx,1470,0],[x0+dx,1477,0]);
    // 進線在拖鏈側邊（z +30）下降，再橫向接入固定端：相機車在固定端另一側時，上層鏈節與活動端不會掃過線材
    cable(beam,key+' / axis junction',[[x0+out*ZC,1670,0],[x0+out*40,1685,0],[x0,1685,30],[x0,1488,30],[x0,1488,0]],{radius:3,color:CABLE.signal,backing:{path:[[x0+out*ZC,1670,18],[x0+out*40,1685,18],[x0,1685,48],[x0,1488,48]],feet:[[0,[x0+out*300,1470,0]],[3,[x0,1470,18]]]}});
    for(const z of [40,190]){support(g,key+' / fixed scan guide foot',[x0+out*315,1420,z],[x0+out*ZC,1420,z],6);support(g,key+' / fixed scan guide mount',[x0+out*ZC,1420,z],[x0+out*ZC,1589,z],6);}
    routingUpdates.push(()=>{scanX.set(car.position.x-x0);scanZ.set(beam.position.z);});
  }

  // ---- S2 雙龍門放置 ----
  // 兩支 Y 軌是 core linearAxis（只有導軌）；名稱與 keepout 順序照舊（verify-clearance.mjs 用名稱 'S2 Y 軌'）
  const yAx = linearAxis.create({ axis: 'z', base: false, rails: { size: [50, 60, 1010], at: [-1, 1].map(s => [s * G.railX, G.beamY - 20, 0]), material: matAlu }, carriage: false, guide: false });
  g.add(yAx.root);
  for (const s of [-1, 1]) {
    for (const z of [-470, 470]) ko(block(g, [70, G.beamY - 850, 70], [s * G.railX, (G.beamY + 850) / 2 - 50, z], matFrame), 'S2 立柱');   // 立柱頂＝Y 軌底
    ko(yAx.rails[s < 0 ? 0 : 1], 'S2 Y 軌');   // 50 寬（中心線不變）：S1／S3 相機拍最內側一欄時留出間隙
  }
  const heads = {};
  for (const H of ['A', 'B']) {
    const side = H === 'A' ? 1 : -1;
    const beam = new THREE.Group(); g.add(beam);
    // 龍門樑是 core linearAxis（只畫本體）；名稱 moving-gantry-beam 保留（verify-clearance.mjs 用它放行樑與 Y 軌的滑動接觸）
    beam.add(linearAxis.create({ axis: 'x', base: { size: [2*G.railX+70,80,G.beamDepth], at: [0,G.beamY+50,0], material: H==='A'?matBlue:matAlu, name: 'moving-gantry-beam' }, rails: false, carriage: false, guide: false }).root);
    decal(beam, 160, 30, [0, G.beamY + 40, side * (G.beamDepth / 2 + 1)], [0, side < 0 ? Math.PI : 0, 0], `龍門 ${H}`, { bg: '#102635', color: '#65d7b8', center: true });
    const head = new THREE.Group(); beam.add(head);
    const bodyZ=-side*(G.beamDepth/2+10),bracketZ=-side*(G.overhang+32)/2;
    const guide=perforated(head,[120,180,60],[0,G.beamY-50,bodyZ],G.nozzleDX.map(x=>[x,-side*G.overhang-bodyZ,6]),matDark);guide.name='spindle-guide';
    const bracket=perforated(head,[110,40,G.overhang-8],[0,G.beamY-160,bracketZ],G.nozzleDX.map(x=>[x,-side*G.overhang-bracketZ,10.3]),matAlu);bracket.name='spindle-bracket';
    // 主軸（含 θ 馬達）在吸嘴座與導向座的鏜孔內上下滑動：以 core 導軌標記（guide／on）宣告，孔內穿過不算干涉
    guide.userData.guide=bracket.userData.guide=H+' spindle bores';
    // Side mount keeps both lenses out of the shared corridor between the heads.
    const camZ=-side*(G.overhang-G.downCamOut);
    block(head,[70,12,36],[side*77.5,1121.5,camZ],matAlu).name='camera-side-mount';   // 頂面高於鏡筒端面、前後各寬出相機本體 1 mm
    const downCam = camera(head, [side*G.downCamDX,1090,camZ], 'down', { fov: 22, ringR: 16, leadSide:side });
    const nozzles = G.nozzleDX.map(dx => {
      const n = new THREE.Group(); n.position.set(dx, 0, -side * G.overhang); head.add(n);
      const spindle = new THREE.Group(); spindle.userData.on = H + ' spindle bores'; n.add(spindle);
      // Z-θ 主軸模組（core zThetaSpindle）：主軸桿從 y=6 起（讓細吸嘴露出）、三道套環、θ 馬達。
      // 第一道套環蓋住主軸端面、底面低 1 mm（仰視相機看到深色背景，不與端面互搶深度）；
      // θ 馬達在安全高度時頂面低於吸嘴座頂面／導向座底面 1 mm（不同平面、不頂到 Ø12 導孔）。升降與旋轉由站的 spindle 群組帶動。
      spindle.add(zThetaSpindle.create({ shaft: { material: matAlu } }).root);
      // 吸嘴尖端與環面是自製件，留在站內
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(PRODUCT.nozzleR, PRODUCT.nozzleR, 6, 40, 1, true), matDark);
      tip.position.y = 3; tip.castShadow = true; spindle.add(tip);
      annulus(spindle, PRODUCT.nozzleR, PRODUCT.nozzleR * .43, 0, matDark);
      const coin = createCoin(); coin.position.y = -PRODUCT.coin.t; coin.visible = false; spindle.add(coin);
      return { n, spindle, coin };
    });
    heads[H] = { beam, head, nozzles, downCam, side };
    // Carriers sit above the fixed feeder camera bridges, on the outside of each beam.
    const routeX=carrier(beam,H+' / gantry X carrier',{origin:[0,1620,side*80],min:-430,max:430,radius:38,width:26,pitch:18});
    const routeZ=carrier(g,H+' / gantry Y carrier',{origin:[side*585,1680,0],axis:[0,0,1],min:-510,max:510,radius:40,width:24,pitch:18});
    // 進線在 X 拖鏈外側（z ±110）下降，再橫向接入固定端：吸嘴頭在固定端另一側時，上層鏈節與活動端不會掃過線材
    cable(beam,H+' / beam feed',[[side*585,1760,0],[side*585,1800,side*80],[side*60,1795,side*80],[0,1790,side*110],[0,1620,side*110],[0,1620,side*80]],{radius:4.5,color:CABLE.sleeve,clips:5,backing:{path:[[side*585,1760,side*20],[side*585,1800,side*100],[side*60,1795,side*100],[0,1790,side*130],[0,1630,side*130]],feet:[[0,[side*180,1740,side*20]],[4,[0,1340,side*50]]],radius:8}});
    support(beam,H+' / feed mast',[side*180,1340,side*20],[side*180,1740,side*20],8);
    cable(head,H+' / moving head service',[[0,1696,side*80],[70*side,1630,side*82],[80*side,1400,side*82],[73*side,1290,side*82],[73*side,1258,side*82]],{radius:4,color:CABLE.sleeve,clips:4,backing:{offset:[18*side,0,0],feet:[[2,[side*98,1200,side*82]],[4,[side*84,1252,side*82]]]}});
    support(head,H+' / head rail foot',[side*60,1200,bodyZ],[side*98,1200,bodyZ],6);
    support(head,H+' / head rail outrigger',[side*98,1200,bodyZ],[side*98,1200,side*82],6);
    cable(head,H+' / camera branch',[[86.5*side,1240,side*82],[145*side,1250,side*70],[145*side,1240,camZ],[side*(G.downCamDX+46),1215,camZ]],{radius:2.2,color:CABLE.signal});
    // Four spindle feeds continue inside the bored head from this manifold.
    // Do not leave unsupported tube ends above the moving spindles.
    block(head,[22,28,30],[side*73,1240,side*82],matBlue).name='head-service-manifold';
    for(const x of [-180,180])support(beam,H+' / overhead carrier bracket',[x,1340,side*50],[x,1609,side*80],7);
    for(const z of [380,440])support(g,H+' / outer carrier support',[side*585,840,z],[side*585,1669,z],14);
    routingUpdates.push(()=>{routeX.set(head.position.x);routeZ.set(beam.position.z);});
  }
  // 柔性供料盤＋供料相機、仰視相機、拋料盒
  const feeders = {}, upCams = {};
  for (const H of ['A', 'B']) {
    const f = LAYOUT.feeder[H], u = LAYOUT.upCam[H];
    // 柔性供料盤（core flexFeeder）：機身、背光盤面、補料斗；機身底在花崗岩台面（y 840）
    const fd = flexFeeder.create({ w: LAYOUT.feeder.w, d: LAYOUT.feeder.d, top: LAYOUT.feeder.top, baseY: 845, bodyMaterial: matDark, plateMaterial: matFeeder, hopper: { material: matAlu } });
    const fg = fd.root, plate = fd.plate; fg.position.set(f.x, 0, f.z); g.add(fg);
    decal(g, 140, 22, [f.x, LAYOUT.feeder.top - 60, f.z + (H === 'A' ? 76 : -76)], [0, H === 'A' ? 0 : Math.PI, 0], `柔性供料 ${H}`, { bg: '#122d3c', color: '#9fd8ff', center: true });
    // The former 1220 mm lens sat inside the moving head. Mount above its swept volume.
    const postX=H==='A'?-620:620,camY=1460,mountY=1555;
    ko(block(g,[30,mountY-850,30],[postX,(mountY+850)/2,f.z],matFrame),'供料相機支架 '+H);
    ko(block(g,[Math.abs(postX-f.x)+30,24,40],[(postX+f.x)/2,mountY,f.z],matFrame),'供料相機懸臂 '+H);
    const fcam = camera(g,[f.x,camY,f.z],'down',{fov:2*Math.atan(8.8/2/32)*180/Math.PI,ringR:40});
    cable(g,'FEED '+H+' / fixed camera to cabinet',[[f.x,camY+125,f.z-42],[postX,camY+125,f.z-42],[postX,870,f.z-42],[postX,784,f.z-42]],{radius:2.4,color:CABLE.signal,clips:7});
    const coins = Array.from({ length: 40 }, () => { const c = createCoin(); c.visible = false; g.add(c); return c; });
    const backs = Array.from({ length: 40 }, () => { const c = createCoin(true); c.visible = false; g.add(c); return c; });
    feeders[H] = { group: fg, plate, cam: fcam, coins, backs };
    // Body bottom = lens datum - 60 - 47/2. Seat it on the cabinet deck,
    // inside the actual granite opening, instead of embedding it in granite.
    const camBottom=LAYOUT.upCam.lensY-83.5;
    block(g,[50,camBottom-780,50],[u.x,(camBottom+780)/2,u.z],matDark).name='up-camera-support';
    upCams[H] = camera(g, [u.x, LAYOUT.upCam.lensY, u.z], 'up', { fov: 2 * Math.atan(8.8 / 2 / 35) * 180 / Math.PI, ringR: 30, power: 25 });
    block(g, [60, 40, 60], [u.x + (H === 'A' ? 90 : -90), 900, u.z], matYellow);     // 拋料盒
  }

  // ---- 外罩、三色燈、HMI ----
  const occ = new THREE.Group(); occ.name = 'occluders'; g.add(occ);
  // Rear gantry beam extends beyond its nozzle row; keep enclosure posts and
  // the rear panel outside the full beam stroke, not just the working area.
  const EX = 1760, Z0 = -680, Z1 = 840, H1 = 2000;
  for (const x of [-EX, -350, 350, EX]) for (const z of [Z0, Z1]) block(occ, [40, H1 - 780, 40], [x, (H1 + 780) / 2, z], matFrame);
  for (const z of [Z0, Z1]) block(occ, [2 * EX, 40, 40], [0, H1, z], matFrame);
  block(occ, [2 * EX, H1 - 780, 2], [0, (H1 + 780) / 2, Z0], matPC);
  block(occ, [2 * EX, H1 - 1100, 2], [0, (H1 + 1100) / 2, Z1], matPC);
  // 三色燈（core 模型）：不裝燈桿，紅／黃／綠由上而下，最下面燈節中心在安裝點上方 40；亮暗由 tower.set(k) 控制
  const tower = signalTower.create({ pole: false, base: 40, shadow: false });
  tower.root.position.set(EX - 100, H1 + 50, Z0 + 60); g.add(tower.root);
  // HMI（core 模型）：整塊螢幕材質的方塊機身，正面貼固定文字
  const panel = hmi.create({ w: 260, h: 170, d: 16, bevel: 0, bodyMaterial: MAT.screen, panel: false,
    text: { lines: ['散熱銅片植入機', `${PRODUCT.short} · ${HOLES.length} 顆／片`, 'SIMULATION'], w: 240, h: 150, options: { bg: '#102635', color: '#65d7b8' } } });
  panel.root.position.set(0, 1250, Z1 + 12); g.add(panel.root);

  cableTray(g,'BASE / segregated distribution',[-1650,740,-530],[1650,740,-530]);
  // Remove unused risers ending in mid-air. Distribution terminates in the
  // cabinet; axis feeds enter through the fixed carrier connectors.
  for(const x of [-1500,-750,0,750,1500])support(g,'BASE / trough wall bracket',[x,731,-500],[x,731,-530],5);

  return {
    updateRouting(){for(const update of routingUpdates)update();},
    group: g, floor: ground.mesh, occluders: occ, keepout, lifts, stops, beltMarks, stacks, loaders, scanners, heads, feeders, upCams,
    tower,                                                 // core signalTower：tower.set('green'｜'yellow'｜'red'｜null)
  };
}
export const BOARD_SURFACE = BOARD_TOP;
