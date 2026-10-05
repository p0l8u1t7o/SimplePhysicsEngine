import {robotController,controllerLeads} from '@core/electrical/electrical-components.js';
// 壓合站設備：上游／本站／下游 SMT 雙邊輸送（後軌固定為基準邊、前軌依配方調寬）、止擋、頂升支撐、
// 固定全局相機、機台底櫃、手臂座、外罩、三色燈、HMI。
// 座標：x 沿流向（上游 −x → 下游 +x）、y 向上、z 橫向（手臂在 −z 後側，作業員在 +z 前側）。單位 mm。
import * as THREE from 'three';
import {cabinetShell,controlPanel,entryGland,panelFeed} from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, support, CABLE } from '@core/electrical/cable-routing.js';
import { block, cylinder, decal, screw } from '@core/geom/shapes.js';
import { MAT, finished } from '@core/geom/materials.js';
import { floor } from '@core/geom/environment.js';
// 市購小件用 core 共用模型（core 1.9.0）：三色燈、HMI、急停、盒型感測器、條形光
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { boxSensor } from '@core/models/sensors.js';
import { barLight } from '@core/models/lights.js';

export const LAYOUT = {
  conveyorTop: 900,                   // SMT 輸送面（載盤底面）
  rearInner: -101,                    // 後軌內側面（固定基準邊）
  segments: [[-1600, -620], [-600, 600], [620, 1600]], // 上游、本站模組、下游
  stopFace: 156,                      // 止擋面：載盤前緣停在這裡（各機種共用）
  flowGap: 1000,                      // 上下游等待位置與本站的距離
  liftStroke: 3,                      // 頂升後載盤貼住軌道壓邊
  entrySensorX: -430, posSensorX: 120,
  robot: [0, 820, -430],              // 手臂座面中心
  encl: { x: 600, z0: -760, z1: 420, h: 2050 },
  globalCam: [10, 1700, 20],          // 全局相機鏡頭位置（朝下）
};
/** 依配方算出載盤在本站的中心位置與前軌內側面 */
export function palletPlacement(recipe) {
  const { w, d } = recipe.pallet;
  return { x: LAYOUT.stopFace - w / 2, z: LAYOUT.rearInner + d / 2, frontInner: LAYOUT.rearInner + d + 2 };
}

// 常用材質取共用表（core/geom/materials.js）；綠色輸送皮帶、PC 外罩為本站外觀，留在這裡（深色地坪與格線用 core/geom/environment.js 的 floor）
const matFrame = MAT.frame;       // 鋁擠型框架、橫樑、立柱
const matDark  = MAT.black;       // 黑色件（氣缸、感測器座、相機本體）
const matCab   = MAT.cabinet;     // 機台底櫃烤漆
const matBlue  = MAT.steelBlue;   // 藍色烤漆（皮帶驅動、感測器）
const matYellow= MAT.yellow;      // 地面標線、按鈕座
const matAlu   = finished(MAT.alu, 'metal');   // 拉絲鋁：軌道、壓邊、頂升支撐板
const matBelt  = new THREE.MeshStandardMaterial({ color: 0x2e7d56, roughness: 0.75 });
const matPin   = MAT.chrome;      // 拋光銷：橫向導桿、止擋銷
const matPC    = new THREE.MeshPhysicalMaterial({ color: 0xcfe3ff, roughness: 0.1, transmission: 0.3, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });

export function createCell(scene, recipe) {
  const g = new THREE.Group(); g.name = 'cell'; scene.add(g);
  const { conveyorTop: top, rearInner } = LAYOUT, place = palletPlacement(recipe), frontInner = place.frontInner, keepout = [];
  const ko = (m, name) => { m.name = name; keepout.push(m); return m; };

  floor(g, { size: [9000, 6000], cell: 200 });   // 9 × 6 m 深色地坪＋200 mm 格線（GridHelper 9000／45 格，y = 0.5）
  for (const z of [900, -1100]) block(g, [4200, 1, 40], [0, 1, z], matYellow);

  // ---- 輸送段：後軌固定、前軌依配方寬度；平皮帶、壓邊、端輪、腳架 ----
  const beltMarks = [];
  const railZ = { rear: { rail: rearInner - 10, lip: rearInner + 3, belt: rearInner + 4 }, front: { rail: frontInner + 10, lip: frontInner - 3, belt: frontInner - 4 } };
  LAYOUT.segments.forEach(([x0, x1], si) => {
    const len = x1 - x0, cx = (x0 + x1) / 2, station = si === 1;
    for (const side of ['rear', 'front']) {
      const z = railZ[side];
      const rail = block(g, [len, 50, 20], [cx, top - 13, z.rail], matAlu);
      const lip = block(g, [len, 3, 6], [cx, top + LAYOUT.liftStroke + 7.5, z.lip], matAlu);
      for(let x=x0+65;x<x1-25;x+=130) screw(g,[x,top+12.3,z.rail],3.2);
      block(g,[len-4,1.4,1],[cx,top-7,z.rail+(side==='front'?10.5:-10.5)],matDark);   // 外側面距軌面 1 mm，避免重合面閃爍
      block(g, [len - 30, 2, 8], [cx, top - 1, z.belt], matBelt);
      for (const x of [x0 + 15, x1 - 15]) cylinder(g, 14, 10, [x, top - 15, z.belt], matDark, 'z');
      if (station) { ko(rail, side === 'rear' ? '後軌' : '前軌'); ko(lip, side === 'rear' ? '後軌壓邊' : '前軌壓邊'); }
      for (const x of [x0 + 40, x1 - 40]) { block(g, [40, top - 38, 40], [x, (top - 38) / 2, z.rail], matFrame); block(g, [90, 10, 70], [x, 5, z.rail], matDark); }
    }
    for (const x of [x0 + 40, x1 - 40]) block(g, [30, 30, frontInner - rearInner + 40], [x, top - 60, (rearInner + frontInner) / 2], matFrame);
    block(g, [120, 90, 80], [x1 - 120, top - 95, rearInner - 70], matBlue);            // 皮帶驅動
    const marks = new THREE.Group(); g.add(marks); beltMarks.push(marks);
    for (let x = x0 + 30; x < x1 - 30; x += 60) for (const side of ['rear', 'front']) block(marks, [3, 0.6, 7], [x, top + 0.3, railZ[side].belt], matAlu);
    decal(g, 150, 22, [cx, top - 20, frontInner + 21.2], [0, 0, 0], si === 0 ? '上游 · 前站放置 USB' : si === 1 ? 'USB 壓合＋檢查站' : '下游 · 迴焊爐', { bg: '#122d3c', color: '#9fd8ff', center: true });
  });
  // 寬度調整：伺服＋滾珠螺桿（依配方自動調寬）
  for (const x of [-450, 450]) { cylinder(g, 8, frontInner - rearInner + 80, [x, top - 55, (rearInner + frontInner) / 2 + 10], matPin, 'z', 12); block(g, [50, 50, 60], [x, top - 55, frontInner + 70], matBlue); }
  decal(g, 120, 16, [450, top - 20, frontInner + 101], [0, 0, 0], `軌寬 ${recipe.pallet.d} mm`, { bg: '#102635', color: '#9fd8ff', center: true });

  // ---- 本站：止擋（前緣定位）、頂升支撐板（無定位銷，後軌為基準邊）、感測器 ----
  block(g, [30, 40, 30], [LAYOUT.stopFace + 12, top - 40, place.z], matDark);
  const stopPin = new THREE.Group(); g.add(stopPin);
  ko(cylinder(stopPin, 6, 26, [LAYOUT.stopFace + 6, top - 1, place.z], matPin, 'y', 16), '止擋');
  const lift = new THREE.Group(); g.add(lift);
  block(lift, [240, 8, 155], [10, top - 8, rearInner + 87.5], matAlu);               // 支撐板：取最小載盤可涵蓋的範圍；後緣離後皮帶 2 mm，頂升時不穿過皮帶
  for (const x of [-80, 100]) block(g, [40, 60, 40], [x, top - 50, rearInner + 85], matDark);  // 頂升氣缸
  const sensors = [];
  for (const [x, name] of [[LAYOUT.entrySensorX, '入口'], [LAYOUT.posSensorX, '到位']]) {
    const s = boxSensor.create(); s.root.position.set(x, top + 22, rearInner - 14); g.add(s.root);   // 盒型光電＋頂面動作指示燈
    sensors.push({ x, name, led: s.led });
  }

  // ---- 機台底櫃（RC8A、PLC、IPC）＋手臂座 ----
  const [rx, ry, rz] = LAYOUT.robot, { x: ex, z0, z1, h } = LAYOUT.encl;
  const cabZ=(z0-240)/2,cabTop=ry-20;
  const cabinetEntries=[{x:0,z:-610-cabZ,hole:15,wire:7,sourceY:ry},...[-430,120,520].map(x=>({x,z:-280-cabZ,hole:10,wire:x===520?3:2,sourceY:820}))];
  const cabinet=cabinetShell(g,'機台底櫃',{center:[0,cabTop/2,cabZ],size:[2*ex,cabTop,-240-z0],entries:cabinetEntries,thickness:20,material:matCab});
  for(const m of cabinet.solids)keepout.push(m);
  const panel=controlPanel(g,'CTRL / PLC and drive panel',{center:[0,400,z0+45],width:970,height:600,backZ:z0+3,profile:'ssd'});
  const controller=robotController(g,{at:[230,63,-630],floor:4});controllerLeads(g,controller,panel);
  for(const [i,e] of cabinetEntries.entries()){
    const z=e.z+cabZ;entryGland(g,'CTRL / roof gland '+i,{at:[e.x,cabTop,z],hole:e.hole,wire:e.wire,thickness:20});
    panelFeed(g,'CTRL / roof to terminal '+i,[[e.x,e.sourceY,z],[e.x,cabTop-50,z],[e.x,650,z0+90],[panel.ports[i*3][0],650,z0+90],panel.ports[i*3]],{radius:e.wire,color:i?CABLE.signal:CABLE.power});
  }
  block(g, [300, 20, 280], [rx, ry - 10, rz - 10], matDark);   // 手臂座：前緣退到 z=-300，讓出底櫃頂的感測器線材格蘭頭（z=-280）
  decal(g,520,90,[0,560,-238],[0,0,0],['RC8A 手臂控制器 · KV-X PLC · 視覺 IPC','SIMULATION'],{bg:'#102635',color:'#65d7b8'}).userData.electricalCover=true;

  // ---- 固定全局相機：20MP＋20 mm 鏡頭，距輸送面約 800 mm，視野約 530 × 355 mm ----
  const [gx, gy, gz] = LAYOUT.globalCam;
  ko(block(g, [40, 40, z1 - z0], [gx, h - 60, (z0 + z1) / 2], matFrame), '全局相機橫樑');
  ko(block(g, [30, h - 80 - (gy + 90), 30], [gx, (h - 80 + gy + 90) / 2, gz], matFrame), '全局相機吊桿');
  const gcam = new THREE.Group(); gcam.position.set(gx, gy, gz); g.add(gcam);
  ko(block(gcam, [44, 47, 34], [0, 60, 0], matDark), '全局相機');
  ko(cylinder(gcam, 16, 36, [0, 18, 0], MAT.black, 'y', 20), '全局相機鏡頭');
  const gLightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.05 });
  for (const s of [-1, 1]) {
    // 條形光 ×2（只有發光條，兩支共用材質一起亮暗）；keepout 登記的是發光條網格
    const bar = barLight.create({ axis: 'x', housing: false, length: 260, lensT: 12, lensW: 30, lensMaterial: gLightMat });
    bar.root.position.set(0, 20, s * 70); gcam.add(bar.root); ko(bar.lens, '全局光源');
  }
  const gFlash = new THREE.SpotLight(0xffffff, 0, 1400, 0.45, 0.5, 1); gFlash.target.position.set(0, -800, 0); gcam.add(gFlash, gFlash.target);
  const globalCam = new THREE.PerspectiveCamera(2 * Math.atan(8.8 / 2 / 20) * 180 / Math.PI, 1.5, 50, 3000);
  globalCam.position.set(gx, gy, gz); globalCam.up.set(0, 0, -1); globalCam.lookAt(gx, top, gz); g.add(globalCam);

  // ---- 外罩：鋁擠型框＋壓克力（可隱藏）、前門互鎖、三色燈、HMI、急停 ----
  const occ = new THREE.Group(); occ.name = 'occluders'; g.add(occ);
  for (const x of [-ex, ex]) for (const z of [z0, z1]) ko(block(occ, [40, h, 40], [x, h / 2, z], matFrame), '外罩立柱');
  for (const z of [z0, z1]) ko(block(occ, [2 * ex, 40, 40], [0, h - 20, z], matFrame), '外罩橫樑');
  for (const x of [-ex, ex]) ko(block(occ, [40, 40, z1 - z0], [x, h - 20, (z0 + z1) / 2], matFrame), '外罩橫樑');
  block(occ, [2 * ex, 2, z1 - z0], [0, h, (z0 + z1) / 2], matPC);
  block(occ, [2 * ex, h - 800, 2], [0, 800 + (h - 800) / 2, z0], matPC);
  block(occ, [2 * ex, h - 1000, 2], [0, 1000 + (h - 1000) / 2, z1], matPC);
  block(occ, [2 * ex, 40, 30], [0, 1000, z1], matFrame);
  block(occ, [2 * ex, 900, 2], [0, 510, z1], matPC);
  for (const x of [-ex, ex]) { block(occ, [2, h - 980, z1 - z0], [x, 980 + (h - 980) / 2, (z0 + z1) / 2], matPC); block(occ, [2, 780, z1 - z0], [x, 450, (z0 + z1) / 2], matPC); }
  block(occ, [60, 22, 30], [ex - 120, 1520, z1 + 18], matDark); decal(occ, 70, 14, [ex - 120, 1545, z1 + 34], [0, 0, 0], '前門互鎖', { center: true });
  // HMI：整塊螢幕色機身＋固定文字貼紙（貼紙在機身前面 1 mm）
  const hmiPanel = hmi.create({ w: 210, h: 150, d: 16, bevel: 0, bodyMaterial: MAT.screen, panel: false,
    text: { lines: ['USB 壓合站', recipe.short, 'SIMULATION'], w: 190, h: 125, options: { bg: '#102635', color: '#65d7b8' } } });
  hmiPanel.root.position.set(ex - 150, 1300, z1 + 12); g.add(hmiPanel.root);
  // 急停：root 在外罩前緣面（z1），底座環與按鈕頭往 +Z 凸出
  const stopButton = estop.create({ collarZ: 10, capZ: 20 }); stopButton.root.position.set(ex - 150, 1150, z1); g.add(stopButton.root);
  // 三色燈：燈桿中心在 root（y 0，長 80），燈節由上而下紅、黃、綠（y 110／75／40），燈罩不投影
  const tower = signalTower.create({ base: 40, colors: { red: 0xff3b3b, yellow: 0xffb020, green: 0x3dd68c }, lens: { opacity: .85 }, pole: { y: 0 }, shadow: { lamps: false } });
  tower.root.position.set(ex - 80, h + 40, z0 + 80); g.add(tower.root);

  cableTray(g,'CTRL / separate power-data trough',[-520,740,-210],[520,740,-210]);
  for(const x of [-450,0,450])support(g,'CTRL / trough cabinet bracket',[x,731,-240],[x,731,-210],5);
  cable(g,'CAM / fixed overhead data',[[520,820,-280],[550,860,-210],[550,920,-690],[550,1940,-690],[gx+35,1940,-600],[gx+35,1900,gz],[gx+35,gy+60,gz],[gx+25.5,gy+60,gz]],{radius:3,color:CABLE.signal,clips:12,backing:{offset:[15,0,0],feet:[[1,[550,800,-250]],[2,[580,920,-740]],[3,[580,1940,-740]],[4,[gx+20,1970,-600]],[5,[gx+15,1900,gz]]]}});
  for(const side of [-1,1])cable(gcam,'CAM / bar-light power '+side,[[22,60,0],[46,58,side*22],[55,40,side*60],[55,26,side*70]],{radius:1.8,color:CABLE.power});
  for(const sensor of sensors)cable(g,'I-O / '+sensor.name,[[sensor.x,top+22,rearInner-26],[sensor.x,top-15,rearInner-50],[sensor.x,860,-190],[sensor.x,860,-280],[sensor.x,820,-280]],{radius:2,color:CABLE.signal,clips:3});

  return {
    group: g, occluders: occ, keepout, sensors, globalCam, place,
    tower: { set(k) { tower.set(k); } },   // 亮 1.6、暗 0.08（模型預設值）
    setStop(v) { stopPin.position.y = (v - 1) * 24; },
    setLift(v) { lift.position.y = v * (LAYOUT.liftStroke + 4); },
    setGlobalFlash(on) { gFlash.intensity = on ? 1800 : 0; gLightMat.emissiveIntensity = on ? 1.2 : 0.05; },
    updateTransport(x, sensorOn) {
      for (const marks of beltMarks) marks.position.x = ((x % 60) + 60) % 60;
      for (const s of sensors) s.led.material.emissiveIntensity = sensorOn(s) ? 1.4 : 0;
    },
  };
}
