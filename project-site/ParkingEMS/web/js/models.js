// 本站的設備與車輛模型（core 沒有的先在站內暫代，已登記 core/REQUESTS.md）：
// 電動車、AC 壁掛／立柱充電樁、DC 快充樁、儲能櫃、低壓配電盤、受電變壓器、EMS 櫃、PV 逆變器、
// 柵欄機、車牌辨識相機、繳費機、路燈、電桿、施工圍籬、車載吊車、光電車棚。
// 原點一律在設備底面中心、正面朝 +Z（車輛朝 +X）；尺寸是常見規格的示意，不是特定廠牌。
import * as THREE from 'three';
import { block, cylinder, rod, bevelBox } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { liveScreen } from '@core/models/equipment.js';
import { CAR } from './sites.js';

const grp = (name, parent) => { const g = new THREE.Group(); g.name = name; parent?.add(g); return g; };
const put = (m, name, pos) => { m.name = name; if (pos) m.position.set(...pos); return m; };
const box = (parent, name, size, pos, mat) => put(block(parent, size, pos, mat), name);

export const M = {
  asphalt: std(0x2a2f35, .95, 0), asphaltDark: std(0x22272c, .95, 0), concrete: std(0x9a9e9f, .9, 0), curb: std(0xb9bcbc, .85, 0),
  line: std(0xe9edf0, .7, 0), lineYellow: std(0xf0c040, .7, 0), evGreen: std(0x2f8f5b, .85, 0), fire: std(0xd94040, .7, 0),
  grass: std(0x2f4a33, .95, 0), sidewalk: std(0x6f7579, .9, 0), road: std(0x1f2327, .95, 0),
  cabinet: std(0xe6eaec, .45, .2), cabinetDark: std(0x3a4652, .5, .3), bess: std(0xdfe5e8, .4, .25), accent: std(0x1aa58a, .4, .1),
  steel: std(0x8d969e, .45, .65), galv: std(0xa8b0b5, .4, .7), column: std(0x7d868d, .5, .55),
  pv: std(0x1d3a66, .22, .35, { emissive: 0x0a1a33, emissiveIntensity: .25 }), pvFrame: std(0xb8c0c6, .35, .7),
  glass: std(0x1a2733, .12, .2), tire: std(0x16191c, .85, 0), rim: std(0x9aa3ab, .35, .7),
  head: std(0xf7f3df, .3, 0, { emissive: 0xfff3c8, emissiveIntensity: .25 }), tail: std(0xb01818, .4, 0, { emissive: 0xff2020, emissiveIntensity: .3 }),
  lamp: std(0xfff2d0, .3, 0, { emissive: 0xffe2a8, emissiveIntensity: 0 }), cableBlack: std(0x15181b, .6, .1),
  fenceOrange: std(0xe8742a, .6, .1), fenceMesh: std(0xdfe3e6, .6, .2, { transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide }),
  crane: std(0xe7b416, .45, .25), craneDark: std(0x2d3238, .55, .35), hook: std(0xd8a21a, .4, .4),
  wood: std(0x6b5236, .85, 0), pole: std(0x8e959a, .7, .2), stake: std(0xff6a1a, .6, 0, { emissive: 0xff5a10, emissiveIntensity: .35 }),
  ledGreen: std(0x37d68b, .4, 0, { emissive: 0x37d68b, emissiveIntensity: 1 }), ledBlue: std(0x3aa8ff, .4, 0, { emissive: 0x3aa8ff, emissiveIntensity: 1.2 }),
  ledAmber: std(0xffb020, .4, 0, { emissive: 0xffb020, emissiveIntensity: 1 }), ledOff: std(0x34404a, .5, 0),
  barrier: std(0xf2f4f5, .45, .1), barrierRed: std(0xd83a3a, .45, .1),
  wall: std(0x8d9396, .9, 0), noise: std(0x5d7a73, .7, .2),
};

// ---------------------------------------------------------------- 電動車（原點：車底中心；車頭朝 +X）
export const CAR_COLORS = [0xe9ecef, 0x2b2f35, 0x8b96a1, 0x9b1d22, 0x1f4f8f, 0xc9ccd0, 0x3c4a3d, 0x50565c];
export function createCar(name, color = 0xe9ecef) {
  const root = grp(name), L = CAR.len, W = CAR.w, r = CAR.wheelR, paint = std(color, .35, .45);
  const body = bevelBox(L, 620, W, paint, 120); put(body, 'car body', [0, 180 + 310, 0]); root.add(body);
  const cabin = bevelBox(2550, 560, W - 160, M.glass, 160); put(cabin, 'car cabin', [-180, 800 + 280, 0]); root.add(cabin);
  box(root, 'car roof', [2100, 50, W - 260], [-220, 1385, 0], paint);
  const wheels = [], headMat = M.head.clone(), tailMat = M.tail.clone(), reverseMat = M.head.clone();
  for (const [x, z] of [[1400, 1], [1400, -1], [-1400, 1], [-1400, -1]]) {
    const wh = cylinder(root, r, 230, [x, r, z * (W / 2 - 120)], M.tire, 'z', 20); wh.name = 'car wheel';
    const hub = grp('car wheel rotation', root); hub.position.set(x, r, z * (W / 2 + 3));
    cylinder(hub, 185, 12, [0, 0, 0], M.rim, 'z', 14).name = 'wheel rim';
    for (let j = 0; j < 3; j++) { const spoke = box(hub, 'wheel spoke', [310, 30, 6], [0, 0, z * 10], M.cabinetDark); spoke.rotation.z = j * Math.PI / 3; }
    wheels.push(hub);
  }
  for (const s of [1, -1]) {
    box(root, 'car headlight', [40, 90, 420], [L / 2 - 10, 560, s * (W / 2 - 300)], headMat);
    box(root, 'car taillight', [40, 80, 380], [-L / 2 + 10, 640, s * (W / 2 - 280)], tailMat);
    box(root, 'car reverse light', [30, 65, 170], [-L / 2 - 6, 500, s * 580], reverseMat);
  }
  const plate = liveScreen(520, 130, 384, 96); plate.mesh.rotation.y = Math.PI / 2;
  put(plate.mesh, 'hero front plate', [L / 2 + 16, 390, 0]); root.add(plate.mesh);
  plate.draw(name, (c, w, h) => { c.fillStyle = '#f5f3de'; c.fillRect(0, 0, w, h); c.fillStyle = '#18232d'; c.font = 'bold 65px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name.startsWith('hero') ? 'EVA-0588' : 'EV', w / 2, h / 2); });
  // 充電口（左前、右前葉子板各一，用離充電樁近的那一側）與充電狀態燈
  const ports = [1, -1].map(s => { const p = box(root, 'car port', [220, 160, 12], [L / 2 - 650, 760, s * (W / 2 + 4)], M.ledOff); p.userData.side = s; return p; });
  const lids = ports.map(p => { const g = grp('charge port lid hinge', root); g.position.copy(p.position).add(new THREE.Vector3(-115, 0, p.userData.side * 18)); box(g, 'charge port lid', [225, 170, 10], [115, 0, 0], paint); return g; });
  return {
    root, ports, wheels, lids, headMat, tailMat, reverseMat, plate: plate.mesh,
    setDetail({ distance = 0, night = 0, moving = false, reverse = false, brake = false, side = 0, open = false } = {}) {
      for (const w of wheels) w.rotation.z = -distance / r;
      headMat.emissiveIntensity = moving ? .25 + night * 3 : .05;
      tailMat.emissiveIntensity = brake ? 3 : moving ? .3 + night : .05;
      reverseMat.emissiveIntensity = reverse && moving ? 3 : 0;
      lids.forEach((l, i) => { l.rotation.y = open && ports[i].userData.side === side ? -side * 1.35 : 0; });
      Object.assign(root.userData, { wheelDistance: distance, headlights: moving && night > .5, reversing: reverse && moving, braking: brake });
    },
    portWorld(side) { const p = ports[side > 0 ? 0 : 1]; return p.getWorldPosition(new THREE.Vector3()); },
    setCharging(side, state) { ports.forEach(p => { p.material = p.userData.side === side ? (state === 'charging' ? M.ledBlue : state === 'done' ? M.ledGreen : state === 'wait' ? M.ledAmber : M.ledOff) : M.ledOff; }); },
  };
}

// 背景停放車輛：InstancedMesh（不進干涉檢查），每格依時間決定有沒有車
export function createParkedFleet(name, count) {
  const root = grp(name), L = CAR.len, W = CAR.w;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(L, 620, W), std(0xffffff, .4, .4), count);
  const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(2500, 540, W - 180), M.glass, count);
  const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(CAR.wheelR, CAR.wheelR, W - 20, 14).rotateX(Math.PI / 2), M.tire, count * 2);
  for (const m of [body, cabin, wheels]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; root.add(m); }
  body.name = 'fleet body'; cabin.name = 'fleet cabin'; wheels.name = 'fleet wheels';
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) body.setColorAt(i, c.setHex(CAR_COLORS[(i * 7 + 3) % CAR_COLORS.length]));
  const _m = new THREE.Matrix4(), _p = new THREE.Matrix4(), _q = new THREE.Quaternion(), Z = new THREE.Matrix4().makeScale(0, 0, 0), UP = new THREE.Vector3(0, 1, 0);
  return {
    root,
    // slots：[{ x, z, yaw, on }]
    set(slots) {
      slots.forEach((s, i) => {
        if (!s.on) { body.setMatrixAt(i, Z); cabin.setMatrixAt(i, Z); wheels.setMatrixAt(2 * i, Z); wheels.setMatrixAt(2 * i + 1, Z); return; }
        _q.setFromAxisAngle(UP, s.yaw); _m.compose(new THREE.Vector3(s.x, 0, s.z), _q, new THREE.Vector3(1, 1, 1));
        body.setMatrixAt(i, _p.makeTranslation(0, 490, 0).premultiply(_m));
        cabin.setMatrixAt(i, _p.makeTranslation(-180, 1070, 0).premultiply(_m));
        wheels.setMatrixAt(2 * i, _p.makeTranslation(1400, CAR.wheelR, 0).premultiply(_m));
        wheels.setMatrixAt(2 * i + 1, _p.makeTranslation(-1400, CAR.wheelR, 0).premultiply(_m));
      });
      body.instanceMatrix.needsUpdate = cabin.instanceMatrix.needsUpdate = wheels.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- 充電樁
// 狀態燈：idle 綠、charging 藍、wait 琥珀、off 灰；畫面用 liveScreen（Node 端是深色平面）
function statusOf(g, leds) {
  return state => { const m = state === 'charging' ? M.ledBlue : state === 'wait' || state === 'limit' ? M.ledAmber : state === 'off' ? M.ledOff : M.ledGreen; for (const l of leds) l.material = m; g.userData.state = state; };
}
// AC 7 kW：mount 'post'（立柱，底面原點）或 'column'（掛在車棚立柱上，原點在柱面、高 0）
export function createACCharger(name, { mount = 'post' } = {}) {
  const root = grp(name);
  if (mount === 'post') {
    box(root, 'ac post base', [300, 30, 300], [0, 15, 0], M.concrete);
    box(root, 'ac post', [140, 1150, 120], [0, 30 + 575, -10], M.cabinetDark);
  }
  const y = 1250, z = mount === 'post' ? 60 : 72;
  const shell = bevelBox(320, 420, 140, M.cabinet, 24); put(shell, 'ac shell', [0, y, z]); root.add(shell);
  const led = box(root, 'ac led', [220, 18, 6], [0, y + 160, z + 73], M.ledGreen);
  const scr = liveScreen(150, 90, 192, 112); put(scr.mesh, 'ac screen', [0, y + 55, z + 71.5]); root.add(scr.mesh);
  const holster = box(root, 'ac holster', [90, 120, 60], [0, y - 120, z + 100], M.cabinetDark);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(130, 14, 8, 24), M.cableBlack); put(coil, 'ac cable coil', [0, y - 330, z + 90]); coil.castShadow = true; root.add(coil);
  return { root, kind: 'AC', screen: scr, set: statusOf(root, [led]), outlet: new THREE.Vector3(0, y - 120, z + 130), coil, holster };
}
// DC 快充：機櫃＋兩支槍座＋防撞桿（原點：基座底面中心）
export function createDCCharger(name, { kw = 60 } = {}) {
  const root = grp(name), h = kw >= 60 ? 1900 : 1750;
  box(root, 'dc plinth', [1000, 150, 800], [0, 75, 0], M.concrete);
  const cab = bevelBox(720, h, 560, M.cabinet, 30); put(cab, 'dc cabinet', [0, 150 + h / 2, 0]); root.add(cab);
  box(root, 'dc front panel', [600, h - 300, 10], [0, 150 + h / 2 - 40, 285], M.cabinetDark);
  const led = box(root, 'dc led', [700, 30, 540], [0, 150 + h + 16, 0], M.ledGreen);
  const scr = liveScreen(420, 260, 448, 280); put(scr.mesh, 'dc screen', [0, 150 + h - 480, 291]); root.add(scr.mesh);
  for (const s of [-1, 1]) {
    box(root, 'dc holster', [120, 200, 80], [s * 410, 150 + 1050, 120], M.cabinetDark);
    const gun = new THREE.Mesh(new THREE.TorusGeometry(170, 18, 8, 22, Math.PI * 1.4), M.cableBlack); put(gun, 'dc cable loop', [s * 420, 150 + 820, 90]); gun.rotation.z = Math.PI * .8; gun.castShadow = true; root.add(gun);
  }
  for (const x of [-560, 560]) { const b = cylinder(root, 60, 900, [x, 150 + 450, 520], M.lineYellow, 'y', 14); b.name = 'dc bollard'; }
  return { root, kind: 'DC', screen: scr, set: statusOf(root, [led]), outlet: new THREE.Vector3(410, 150 + 1050, 200), height: 150 + h };
}

// ---------------------------------------------------------------- 儲能櫃（室外型液冷櫃，含空調、門縫、偵煙、警示貼）
export function createBESS(name, { size = [1700, 2400, 1400], kw = 100, kwh = 215 } = {}) {
  const root = grp(name), [w, h, d] = size;
  box(root, 'bess pad', [w + 900, 200, d + 900], [0, 100, 0], M.concrete);
  const body = bevelBox(w, h, d, M.bess, 40); put(body, 'bess body', [0, 200 + h / 2, 0]); root.add(body);
  box(root, 'bess hvac', [w * .55, h * .32, 260], [w * .1, 200 + h * .55, -d / 2 - 130], M.cabinet);
  for (const x of [-w / 4, w / 4]) box(root, 'bess door seam', [8, h - 160, 6], [x, 200 + h / 2, d / 2 + 3], M.cabinetDark);
  box(root, 'bess band', [w + 4, 70, d + 4], [0, 200 + h - 160, 0], M.accent);
  const led = box(root, 'bess led', [160, 50, 8], [-w / 2 + 220, 200 + h - 300, d / 2 + 6], M.ledGreen);
  box(root, 'bess vent', [w * .4, 120, 10], [0, 200 + h - 420, d / 2 + 5], M.cabinetDark);
  const scr = liveScreen(w * .5, 300, 384, 230); put(scr.mesh, 'bess label', [0, 200 + h * .52, d / 2 + 7]); root.add(scr.mesh);
  scr.draw('static', (c, W, H) => { c.fillStyle = '#e8eef0'; c.fillRect(0, 0, W, H); c.fillStyle = '#16323a'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.fillText('儲能系統', W / 2, 74); c.font = '38px sans-serif'; c.fillText(`${kw} kW／${kwh} kWh`, W / 2, 140); c.fillStyle = '#c0392b'; c.font = 'bold 30px sans-serif'; c.fillText('⚠ 高壓電池 · 熱失控偵測', W / 2, 200); });
  cabinetDetails(root, w, h, d, 200);
  return { root, set: statusOf(root, [led]), size, top: 200 + h };
}
export function createCabinet(name, { size = [2400, 2000, 800], label = '', screen = false, mat = M.cabinet } = {}) {
  const root = grp(name), [w, h, d] = size;
  box(root, 'cabinet plinth', [w + 200, 150, d + 200], [0, 75, 0], M.concrete);
  const body = bevelBox(w, h, d, mat, 20); put(body, 'cabinet body', [0, 150 + h / 2, 0]); root.add(body);
  const doors = Math.max(1, Math.round(w / 800));
  for (let i = 1; i < doors; i++) box(root, 'cabinet seam', [8, h - 80, 6], [-w / 2 + i * w / doors, 150 + h / 2, d / 2 + 3], M.cabinetDark);
  box(root, 'cabinet roof', [w + 80, 50, d + 120], [0, 150 + h + 25, 0], M.cabinetDark);
  let scr = null;
  if (screen) { scr = liveScreen(Math.min(420, w * .7), 260, 420, 260); put(scr.mesh, 'cabinet screen', [0, 150 + h * .62, d / 2 + 5]); root.add(scr.mesh); }
  if (label) { const tag = liveScreen(Math.min(w * .8, 900), 160, 450, 80); put(tag.mesh, 'cabinet label', [0, 150 + h - 180, d / 2 + 9]); root.add(tag.mesh); tag.draw(label, (c, W, H) => { c.fillStyle = '#1e2a33'; c.fillRect(0, 0, W, H); c.fillStyle = '#e8eef0'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, W / 2, H / 2); }); }
  const led = box(root, 'cabinet led', [60, 60, 8], [w / 2 - 120, 150 + h - 120, d / 2 + 6], M.ledGreen);
  cabinetDetails(root, w, h, d, 150);
  return { root, screen: scr, set: statusOf(root, [led]), top: 150 + h };
}
// 櫃外附件與警示示意；未建立櫃內電控與實際消防迴路。
function cabinetDetails(root, w, h, d, base) {
  box(root, 'door handle', [35, 230, 35], [w * .37, base + h * .48, d / 2 + 24], M.galv);
  for (let j = 0; j < 5; j++) box(root, 'vent louver', [w * .42, 14, 20], [-w * .1, base + 190 + j * 44, d / 2 + 16], M.cabinetDark);
  cylinder(root, 48, 32, [-w * .36, base + h * .68, d / 2 + 22], M.lineYellow, 'z', 16).name = 'estop collar';
  cylinder(root, 30, 35, [-w * .36, base + h * .68, d / 2 + 58], M.barrierRed, 'z', 16).name = 'estop button';
  cylinder(root, 42, 35, [w * .34, base + h - 340, d / 2 + 22], M.cabinet, 'z', 12).name = 'fire detector';
  cylinder(root, 15, 26, [w / 2 + 18, base + 100, d * .25], M.galv, 'x', 8).name = 'earth terminal';
  const tag = liveScreen(150, 100, 180, 120); tag.mesh.position.set(-w * .33, base + h * .39, d / 2 + 12); tag.mesh.name = 'electrical warning'; root.add(tag.mesh);
  tag.draw('warning', (c, W, H) => { c.fillStyle = '#f5ce45'; c.fillRect(0, 0, W, H); c.fillStyle = '#241d0f'; c.textAlign = 'center'; c.font = 'bold 32px sans-serif'; c.fillText('⚠ 高壓', W / 2, 48); c.font = '22px sans-serif'; c.fillText('PE 接地', W / 2, 90); });
}
export function createTransformer(name, { size = [1900, 1800, 1500] } = {}) {
  const root = grp(name), [w, h, d] = size;
  box(root, 'tr pad', [w + 600, 200, d + 600], [0, 100, 0], M.concrete);
  box(root, 'tr body', [w, h, d], [0, 200 + h / 2, 0], std(0x6f8a7e, .55, .3));
  for (let i = 0; i < 6; i++) box(root, 'tr fin', [w * .12, h * .7, 60], [-w * .38 + i * w * .152, 200 + h * .45, d / 2 + 30], std(0x5f7a6f, .55, .3));
  box(root, 'tr roof', [w + 100, 60, d + 100], [0, 200 + h + 30, 0], std(0x55695f, .6, .3));
  return { root, top: 260 + h };
}
export function createInverter(name) {
  const root = grp(name);
  const b = bevelBox(600, 700, 240, M.cabinet, 20); put(b, 'inverter body', [0, 0, 120]); root.add(b);
  for (let i = 0; i < 5; i++) box(root, 'inverter fin', [520, 20, 30], [0, -200 + i * 100, 255], M.cabinetDark);
  const led = box(root, 'inverter led', [80, 20, 6], [0, 300, 243], M.ledGreen);
  return { root, set: statusOf(root, [led]) };
}

// ---------------------------------------------------------------- 入口設施
// 柵欄機：機箱＋閘桿（樞軸 y 900，閘桿沿 +X 伸出，set(開度 0～1)）
export function createBarrier(name, length = 3000) {
  const root = grp(name);
  box(root, 'barrier housing', [340, 1050, 300], [0, 525, 0], M.cabinet);
  box(root, 'barrier stripe', [344, 60, 304], [0, 900, 0], M.barrierRed);
  const pivot = grp('barrier pivot', root); pivot.position.set(0, 930, 170); pivot.userData.cableHost = false;
  const arm = box(pivot, 'barrier arm', [length, 70, 50], [length / 2, 0, 0], M.barrier);
  for (let i = 0; i < 4; i++) box(pivot, 'barrier arm stripe', [length / 8, 72, 52], [length * (.2 + i * .22), 0, 0], M.barrierRed);
  return { root, arm, set(open) { pivot.rotation.z = open * Math.PI / 2 * .98; } };
}
// 車牌辨識相機（立柱＋相機＋補光），facing：相機朝向（root 旋轉）
export function createLPR(name) {
  const root = grp(name);
  box(root, 'lpr post', [100, 1600, 100], [0, 800, 0], M.cabinetDark);
  box(root, 'lpr camera', [160, 140, 380], [0, 1660, 150], M.cabinet);
  const lens = cylinder(root, 45, 30, [0, 1660, 345], M.glass, 'z', 16); lens.name = 'lpr lens';
  const ir = box(root, 'lpr flash', [150, 50, 20], [0, 1760, 330], M.ledOff);
  return { root, flash(on) { ir.material = on ? M.lamp : M.ledOff; } };
}
export function createKiosk(name) {
  const root = grp(name);
  box(root, 'kiosk base', [800, 120, 560], [0, 60, 0], M.concrete);
  const b = bevelBox(700, 1650, 460, M.cabinetDark, 30); put(b, 'kiosk body', [0, 120 + 825, 0]); root.add(b);
  box(root, 'kiosk canopy', [900, 60, 700], [0, 120 + 1720, 60], M.accent);
  const scr = liveScreen(440, 300, 440, 300); put(scr.mesh, 'kiosk screen', [0, 120 + 1180, 232]); root.add(scr.mesh);
  box(root, 'kiosk card slot', [300, 60, 20], [0, 120 + 860, 236], M.cabinet);
  return { root, screen: scr };
}
export function createStreetLight(name, h = 7000) {
  const root = grp(name);
  cylinder(root, 90, h, [0, h / 2, 0], M.pole, 'y', 12).name = 'light pole';
  box(root, 'light arm', [1200, 80, 80], [500, h - 40, 0], M.pole);
  const head = box(root, 'light head', [600, 90, 260], [1000, h - 110, 0], M.lamp);
  return { root, head };
}
export function createUtilityPole(name, h = 11000) {
  const root = grp(name);
  cylinder(root, 170, h, [0, h / 2, 0], M.concrete, 'y', 14, 130).name = 'utility pole';
  box(root, 'pole crossarm', [2200, 120, 120], [0, h - 600, 0], M.galv);
  for (const x of [-800, 0, 800]) cylinder(root, 50, 160, [x, h - 460, 0], M.cabinet, 'y', 8).name = 'pole insulator';
  for (const x of [-260, 260]) cylinder(root, 230, 900, [x, h - 2000, 260], std(0x8e9aa0, .5, .4), 'y', 14).name = 'pole transformer';
  return { root, top: new THREE.Vector3(0, h - 380, 0) };
}

// ---------------------------------------------------------------- 施工
// 施工圍籬：一列 InstancedMesh（不進干涉檢查），points 是封閉多邊形
export function createFence(name, points, { mesh = M.fenceMesh, foot = M.fenceOrange, h = 1600, closed = true } = {}) {
  const root = grp(name), segs = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 2200));
    for (let k = 0; k < n; k++) segs.push({ x: a[0] + (b[0] - a[0]) * (k + .5) / n, z: a[1] + (b[1] - a[1]) * (k + .5) / n, w: len / n, yaw: -Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  const panel = new THREE.InstancedMesh(new THREE.BoxGeometry(1, h, 30), mesh, segs.length);
  const feet = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 220, 300), foot, segs.length);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  segs.forEach((s, i) => {
    _q.setFromAxisAngle(UP, s.yaw);
    panel.setMatrixAt(i, _m.compose(new THREE.Vector3(s.x, 220 + h / 2, s.z), _q, new THREE.Vector3(s.w - 60, 1, 1)));
    feet.setMatrixAt(i, _m.compose(new THREE.Vector3(s.x, 110, s.z), _q, new THREE.Vector3(s.w - 60, 1, 1)));
  });
  panel.name = 'fence panels'; feet.name = 'fence feet'; feet.castShadow = true; root.add(panel, feet);
  return { root };
}
// 車載伸臂吊車：車體＋外伸撐腳＋旋轉台＋伸臂（仰角、伸長）＋吊鉤
// aim(hookWorld)：轉台朝向吊鉤、依水平距離算仰角，鋼索長度補到吊鉤；超出範圍時回傳 false
export function createCrane(name, { boom = 30000, pivotY = 3200, scale = 1 } = {}) {
  const root = grp(name); root.userData.cableHost = false;
  const k = scale;
  box(root, 'crane carrier', [9000 * k, 1300 * k, 2500 * k], [0, 1150 * k, 0], M.craneDark);
  box(root, 'crane cab', [1800 * k, 1400 * k, 2400 * k], [3900 * k, 2350 * k, 0], M.crane);
  for (const x of [-3800, -1400, 2300, 3800]) for (const s of [-1, 1]) { const w = cylinder(root, 520 * k, 400 * k, [x * k, 520 * k, s * 1090 * k], M.tire, 'z', 16); w.name = 'crane wheel'; }
  for (const x of [-3600, 2800]) for (const s of [-1, 1]) {
    box(root, 'crane outrigger', [300 * k, 260 * k, 2200 * k], [x * k, 900 * k, s * 2350 * k], M.crane);
    box(root, 'crane outrigger pad', [700 * k, 120 * k, 700 * k], [x * k, 60 * k, s * 3400 * k], M.craneDark);
    box(root, 'crane outrigger jack', [220 * k, 760 * k, 220 * k], [x * k, 500 * k, s * 3400 * k], M.crane);
  }
  const turret = grp('crane turret', root); turret.position.set(-1800 * k, 1800 * k, 0); turret.userData.cableHost = false;
  box(turret, 'crane house', [3600 * k, 1300 * k, 2300 * k], [-600 * k, 650 * k, 0], M.crane);
  box(turret, 'crane counterweight', [1200 * k, 1000 * k, 2400 * k], [-2700 * k, 560 * k, 0], M.craneDark);
  const luff = grp('crane boom', turret); luff.position.set(800 * k, pivotY - 1800 * k, 0); luff.userData.cableHost = false;
  // 伸縮臂：基本節固定，伸縮節依需要的臂長伸出（仰角盡量維持 55°，最長 boom）
  const Lmin = 10000 * k, Lb = Lmin * .62, Lmax = boom;
  box(luff, 'crane boom base', [Lb, 700 * k, 600 * k], [Lb / 2, 0, 0], M.crane);
  const tele = grp('crane boom tele', luff); tele.userData.cableHost = false; tele.userData.nested = luff;   // 伸縮節套在基本節內
  box(tele, 'crane boom tele section', [Lmin * .7, 520 * k, 440 * k], [-Lmin * .35, 0, 0], M.crane).userData.nested = luff;   // 伸縮節網格本身會伸長（是關節），標在網格上
  const head = box(tele, 'crane boom head', [600 * k, 800 * k, 500 * k], [-200 * k, -150 * k, 0], M.craneDark);
  const cable = cylinder(null, 20 * k, 1, [0, -.5, 0], M.cableBlack, 'y', 6); cable.name = 'crane wire';
  const hook = grp('crane hook', root); hook.userData.cableHost = false;
  box(hook, 'crane hook block', [500 * k, 700 * k, 300 * k], [0, 350 * k, 0], M.hook);
  hook.add(cable);
  const tip = new THREE.Vector3();
  const pivotLocal = () => new THREE.Vector3(-1800 * k + 800 * k, pivotY, 0);   // 轉台旋轉前的樞軸（root 座標）
  const COS = Math.cos(55 * Math.PI / 180);
  let L = Lmin;
  return {
    root, turret, luff, hook, boom: Lmax,
    // hookLocal：吊鉤底（掛點）在 root 座標的位置
    aim(hookLocal) {
      const tx = hookLocal.x - (-1800 * k), tz = hookLocal.z;
      const yaw = Math.atan2(-tz, tx); turret.rotation.y = yaw;
      const r = Math.max(0, Math.hypot(tx, tz) - 800 * k);
      // 臂頭至少高出吊鉤 2.5 m：先用 55° 算臂長，不夠高再伸長
      const need = hookLocal.y + 700 * k + 2500 * k - pivotY;
      L = Math.min(Lmax, Math.max(Lmin, r / COS, Math.hypot(r, Math.max(0, need))));
      const a = Math.acos(Math.max(-1, Math.min(1, r / L)));
      luff.rotation.z = a;
      tele.position.x = L; tele.scale.x = 1;
      const teleLen = L - Lb + Lmin * .08;
      tele.children[0].scale.x = teleLen / (Lmin * .7); tele.children[0].position.x = -teleLen / 2;
      tip.set(-1800 * k + Math.cos(yaw) * (800 * k + L * Math.cos(a)), pivotY + L * Math.sin(a) - 150 * k, -Math.sin(yaw) * (800 * k + L * Math.cos(a)));
      hook.position.set(tip.x, hookLocal.y, tip.z);
      const len = Math.max(10, tip.y - 650 * k - (hookLocal.y + 700 * k));   // 鋼索從臂頭滑輪下緣垂下
      cable.scale.y = len; cable.position.y = 700 * k + len / 2;
      return { ok: r <= Lmax && hookLocal.y + 700 * k < tip.y - 600 * k, angle: a, radius: r, length: L };
    },
    tipLocal: () => tip.clone(), pivotLocal,
  };
}

// ---------------------------------------------------------------- 光電車棚（T 型雙懸臂，沿 X 延伸）
// 回傳 { foundations[], columns[], beams[], bays[]（每跨的檁條＋模組群組）, inverter }
export function createCarport(name, cp) {
  const root = grp(name), tilt = cp.tiltDeg * Math.PI / 180;
  const roofY = z => cp.colH + 505 + Math.tan(tilt) * (cp.zLine - z);   // 北高南低：往 −Z 越高（模組朝南）；柱頂＋樑高＋檁條＝505
  const foundations = [], columns = [], beams = [], bays = [];
  for (const [i, x] of cp.cols.entries()) {
    const f = grp(`carport footing ${i}`, root); f.position.set(x, 0, cp.zLine);
    box(f, 'carport pedestal', [600, 300, 600], [0, 150, 0], M.concrete); foundations.push(f);
    const c = grp(`carport column ${i}`, root); c.position.set(x, 300, cp.zLine);
    box(c, 'carport column', [300, cp.colH - 340, 300], [0, 30 + (cp.colH - 340) / 2, 0], M.column);   // 柱頂比樑底低 10 mm（樑傾斜 3°，避免柱角穿進樑）
    box(c, 'carport base plate', [440, 30, 440], [0, 15, 0], M.galv); columns.push(c);
    // T 型懸臂樑：頂面沿屋面斜度，兩端到屋面邊
    const b = grp(`carport beam ${i}`, root); b.position.set(x, 0, cp.zLine);
    const z0 = cp.z0 - 150, z1 = cp.z1 + 150, len = z1 - z0;
    const beam = box(b, 'carport beam', [240, 360, len / Math.cos(tilt)], [0, 0, 0], M.steel);
    beam.position.set(0, (roofY(z0) + roofY(z1)) / 2 - 325, (z0 + z1) / 2 - cp.zLine); beam.rotation.x = tilt;   // 樑頂＝檁條底、樑底＝柱頂
    beams.push(b);
  }
  // 每跨：檁條 4 支＋模組 6×4（最後一跨補足剩下的模組）
  const per = Math.ceil(cp.nx / cp.bays), pitch = cp.mod.w + cp.mod.gap;
  for (let k = 0; k < cp.bays; k++) {
    const i0 = k * per, i1 = Math.min(cp.nx, i0 + per);
    const bx0 = cp.x0 + i0 * pitch, bx1 = cp.x0 + i1 * pitch - cp.mod.gap, bxc = (bx0 + bx1) / 2;
    const bay = grp(`carport bay ${k}`, root); bay.position.set(bxc, 0, 0);
    for (let j = 0; j < cp.ny; j++) {
      const zc = cp.z0 + (j + .5) * (cp.mod.l + cp.mod.gap) - cp.mod.gap / 2;
      const pur = box(bay, 'carport purlin', [bx1 - bx0, 120, 80], [0, roofY(zc) - 85, zc], M.galv); pur.rotation.x = tilt;
      for (let i = i0; i < i1; i++) {
        const mx = cp.x0 + i * pitch + cp.mod.w / 2 - bxc;
        const m = box(bay, 'pv module', [cp.mod.w, 35, cp.mod.l], [mx, roofY(zc) - 5, zc], M.pv); m.rotation.x = tilt;
      }
    }
    bay.userData.range = [bx0, bx1]; bays.push(bay);
  }
  return { root, foundations, columns, beams, bays, roofY };
}
