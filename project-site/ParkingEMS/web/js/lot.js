// 場地環境：地面、停車場鋪面與標線、街道、周邊建物與植栽、入口閘門、車牌辨識、繳費機、路燈、電桿。
// 鋪面、標線、建物、植栽是背景（userData.decor，不進干涉與閃爍檢查）；閘門、車辨、繳費機、路燈是實體。
import * as THREE from 'three';
import { groundMaterial } from './surfaces.js';
import { createTrees, buildingDetails, pavingDetails } from './site-details.js';
import { block, floorText, HAS_DOM } from '@core/geom/shapes.js';
import { std } from '@core/geom/materials.js';
import { STALL, AISLE, STRIP } from './sites.js';
import { M, createBarrier, createLPR, createKiosk, createStreetLight, createUtilityPole, createFence } from './models.js';

const grp = (name, parent) => { const g = new THREE.Group(); g.name = name; parent?.add(g); return g; };
const decor = g => { g.userData.decor = true; return g; };
const plane = (parent, name, w, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), groundMaterial(mat,w,d)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; m.name = name; parent.add(m); return m; };

// 標線：一個 InstancedMesh（寬、長以縮放表示）
function stripes(parent, name, list, mat, y = 4) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 4, 1), mat, Math.max(1, list.length));
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  list.forEach(([x, z, w, d, yaw = 0], i) => im.setMatrixAt(i, _m.compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(UP, yaw), new THREE.Vector3(w, 1, d))));
  im.count = list.length; im.name = name; im.receiveShadow = true; parent.add(im); return im;
}

export function gateGeom(site) {
  const E = site.entrance, xc = (E.lane[0] + E.lane[1]) / 2, isl = E.narrow ? 600 : 1200;
  const armLen = (E.lane[1] - E.lane[0]) / 2 - isl / 2 - 300;
  return {
    xc, isl, armLen, islandLen: 6800, islandZ: E.zGate - 150,
    xIn: (xc + isl / 2 + E.lane[1]) / 2, xOut: (E.lane[0] + xc - isl / 2) / 2,
    armIn: E.zGate + 170, armOut: E.zGate - 900 - 170,
  };
}

export function createLot(scene, site) {
  const L = site.lot, E = site.entrance, root = grp('lot', scene);
  const bg = decor(grp('environment', root));
  const xMin = Math.min(L.x0, ...site.buildings.map(b => b[0] - b[2] / 2)) - 30000, xMax = Math.max(site.yard.x1, ...site.buildings.map(b => b[0] + b[2] / 2)) + 30000;
  const zMin = Math.min(L.z0, ...site.buildings.map(b => b[1] - b[3] / 2)) - 30000, zMax = Math.max(site.street.z1, ...site.buildings.map(b => b[1] + b[3] / 2)) + 30000;
  plane(bg, 'ground', xMax - xMin, zMax - zMin, (xMin + xMax) / 2, -40, (zMin + zMax) / 2, M.grass);
  // 街道與人行道（南側，沿 X）
  plane(bg, 'street', xMax - xMin, site.street.z1 - site.street.z0, (xMin + xMax) / 2, -10, (site.street.z0 + site.street.z1) / 2, M.road);
  plane(bg, 'sidewalk', xMax - xMin, 2600, (xMin + xMax) / 2, -20, site.street.z0 - 1300, M.sidewalk);
  const dash = [];
  for (let x = xMin + 2000; x < xMax - 2000; x += 6000) dash.push([x, (site.street.z0 + site.street.z1) / 2, 3000, 150]);
  stripes(bg, 'street dashes', dash, M.line, -6);
  // 停車場鋪面（含兩側交叉車道與外緣帶）
  const pave = { x0: L.x0 - STRIP, x1: Math.max(L.x1, site.yard.x1) + STRIP, z0: L.z0 - STRIP, z1: L.z1 };
  plane(bg, 'lot paving', pave.x1 - pave.x0, pave.z1 - pave.z0, (pave.x0 + pave.x1) / 2, 0, (pave.z0 + pave.z1) / 2, M.asphalt);
  // 入口車道（外緣帶到街道）
  plane(bg, 'entrance lane', E.lane[1] - E.lane[0], E.zStreet - E.zLot, (E.lane[0] + E.lane[1]) / 2, 0, (E.zLot + E.zStreet) / 2 + 1, M.asphalt);
  // 外緣植栽帶（北、東、西）與南側人行帶
  plane(bg, 'strip north', pave.x1 - pave.x0, STRIP - 400, (pave.x0 + pave.x1) / 2, 8, L.z0 - STRIP / 2 - 200, M.grass);

  // ---- 車位標線、車道箭頭
  const lines = [], removed = new Set(L.removed);
  for (const r of L.rows) {
    for (let j = 0; j <= r.n; j++) lines.push([r.x0 + j * STALL.w, r.zc, 100, STALL.d]);
    lines.push([0, r.dir > 0 ? r.z1 : r.z0, r.n * STALL.w, 100]);
  }
  stripes(bg, 'stall lines', lines, M.line);
  // 充電格綠色鋪面（擴充時增設的另成一組）
  const paint = list => list.map(c => [c.stall.x, c.stall.z, STALL.w - 160, STALL.d - 160]);
  const evPaint = stripes(grp('ev paint', root), 'ev stall paint', paint(site.chargers.filter(c => !c.expand)), M.evGreen, 2);
  const evPaintX = site.chargers.some(c => c.expand) ? stripes(grp('ev paint x', root), 'ev stall paint', paint(site.chargers.filter(c => c.expand)), M.evGreen, 2) : null;
  const arrows = [];
  for (const a of L.aisles) for (let x = -L.halfX + 6000; x < L.halfX - 3000; x += 12000) arrows.push([x, a.zc, 1600, 260], [x + 600, a.zc - 260, 700, 120, .6], [x + 600, a.zc + 260, 700, 120, -.6]);
  stripes(bg, 'aisle arrows', arrows, M.line);
  // 移除的車位改成島（旗艦型 DC 充電島）：路緣
  const islands = grp('islands', root);
  for (const key of removed) {
    const [ri, j] = key.split(',').map(Number), r = L.rows[ri];
    block(islands, [STALL.w, 150, STALL.d - 400], [r.x0 + (j + .5) * STALL.w, 75, r.zc + (r.dir > 0 ? 200 : -200)], M.curb).name = 'island curb';
  }
  // 消防通道（都會型）：車道兩側紅線與地面字
  if (site.fireLane) {
    const red = [];
    for (const a of L.aisles) red.push([0, a.z0 + 150, L.halfX * 2, 120], [0, a.z1 - 150, L.halfX * 2, 120]);
    red.push([L.west.x0 + 150, (L.z0 + L.z1) / 2, 120, L.depth], [L.west.x1 - 150, (L.z0 + L.z1) / 2, 120, L.depth]);
    red.push([E.lane[0] + 150, (E.zLot + E.zStreet) / 2, 120, E.zStreet - E.zLot], [E.lane[1] - 150, (E.zLot + E.zStreet) / 2, 120, E.zStreet - E.zLot]);
    stripes(bg, 'fire lane lines', red, M.fire, 5);
    floorText(bg, ['消防通道　保持淨空'], L.west.xc, 0, 3600, 900, { rot: Math.PI / 2, fg: '#ff8070', y: 7 });
    floorText(bg, ['消防通道'], (E.lane[0] + E.lane[1]) / 2, E.zLot + 7000, 3000, 800, { rot: Math.PI / 2, fg: '#ff8070', y: 7 });
  }

  // ---- 周邊建物（立體窗框與玻璃；夜間發光）
  const buildings = [];
  site.buildings.forEach(([x, z, w, d, h], i) => {
    const mat = std([0x8e8a83, 0x9a9184, 0x7f8790, 0xa59e92][i % 4], .85, 0);
    const b = block(bg, [w, h, d], [x, h / 2, z], mat); b.name = 'building'; buildings.push(buildingDetails(bg,[x,z,w,d,h],i));
    block(bg, [w + 200, 300, d + 200], [x, h + 150, z], std(0x5b5f63, .9, 0)).name = 'building parapet';
  });
  // 植栽（InstancedMesh）：外緣帶與街道兩側
  const trees = [];
  for (let x = pave.x0 + 3000; x < pave.x1 - 2000; x += 7000) trees.push([x, L.z0 - STRIP / 2 - 200]);
  for (let x = xMin + 8000; x < xMax - 8000; x += 9000) if (x < E.lane[0] - 3000 || x > E.lane[1] + 3000) trees.push([x, site.street.z1 + 2500]);
  createTrees(bg,trees,M);
  pavingDetails(bg,site,M);

  // ---- 入口：分島、柵欄機（進場在東半、出場在西半）、車辨、繳費機
  const G = gateGeom(site), { xc, isl, armLen } = G, gate = grp('gate', root);
  block(gate, [isl, 150, G.islandLen], [xc, 75, G.islandZ], M.curb).name = 'gate island';
  const entry = createBarrier('entry barrier', armLen); entry.root.position.set(xc + isl / 2 - 230, 150, E.zGate); gate.add(entry.root);
  const exit = createBarrier('exit barrier', armLen); exit.root.position.set(xc - isl / 2 + 230, 150, E.zGate - 900); exit.root.rotation.y = Math.PI; gate.add(exit.root);
  const lprIn = createLPR('entry lpr'); lprIn.root.position.set(xc + isl / 2 - 230, 150, E.zGate + 2200); lprIn.root.rotation.y = -.25; gate.add(lprIn.root);
  const lprOut = createLPR('exit lpr'); lprOut.root.position.set(xc - isl / 2 + 230, 150, E.zGate - 2900); lprOut.root.rotation.y = Math.PI - .25; gate.add(lprOut.root);
  const kiosk = createKiosk('pay kiosk'); kiosk.root.position.set(L.x0 - 1500, 0, Math.min(L.z1 - 4000, L.z1 - 2500)); kiosk.root.rotation.y = Math.PI / 2; gate.add(kiosk.root);
  // 入口標示牌
  const signTex = HAS_DOM ? (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 320; const g = c.getContext('2d'); g.fillStyle = '#16384a'; g.fillRect(0, 0, 256, 320); g.fillStyle = '#fff'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.fillText('P', 128, 160); g.font = 'bold 40px sans-serif'; g.fillStyle = '#5fe0b0'; g.fillText('⚡ 充電', 128, 240); g.fillStyle = '#cfe'; g.font = '28px sans-serif'; g.fillText('停車＋充電整合', 128, 290); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() : null;
  const sign = grp('entrance sign', gate); sign.position.set(E.lane[1] + 1300, 0, E.zStreet - 900);
  block(sign, [120, 2600, 120], [0, 1300, 0], M.pole).name = 'sign post';
  const face = block(sign, [1100, 1400, 80], [0, 3100, 0], signTex ? std(0xffffff, .6, 0, { map: signTex }) : M.cabinetDark); face.name = 'sign face';

  // ---- 路燈（外緣帶）、電桿（街道側）
  const lights = [];
  const lightAt = (x, z, yaw) => { const l = createStreetLight(`street light ${lights.length}`); l.root.position.set(x, 0, z); l.root.rotation.y = yaw; root.add(l.root); lights.push(l); };
  for (let x = L.x0 + 4000; x < L.x1 - 2000; x += 18000) lightAt(x, L.z0 - 1500, -Math.PI / 2);
  for (let x = L.x0 + 13000; x < L.x1 - 2000; x += 18000) lightAt(x, L.z1 + 1300, Math.PI / 2);
  const pole = createUtilityPole('utility pole'); pole.root.position.set(site.pole.x, 0, site.pole.z); root.add(pole.root);

  // ---- 能源區：永久圍籬（旗艦、住商）、隔音牆（住商）、地坪
  const Y = site.yard, yard = grp('yard', root);
  plane(bg, 'yard paving', Y.x1 - Y.x0, Y.z1 - Y.z0, (Y.x0 + Y.x1) / 2, 8, (Y.z0 + Y.z1) / 2, M.concrete);
  if (site.id === 'mixed') {
    const w1 = block(yard, [Y.x1 - Y.x0, 2400, 200], [(Y.x0 + Y.x1) / 2, 1200, Y.z0 - 100], M.noise); w1.name = 'noise wall';
    const w2 = block(yard, [200, 2400, Y.z1 - Y.z0 - 3600], [Y.x0 - 100, 1200, (Y.z0 + Y.z1) / 2 + 1800], M.noise); w2.name = 'noise wall';
  }
  if (site.id !== 'urban') {
    // 住商型北、西兩面是隔音牆，圍籬只圍東、南兩面
    const pts = site.id === 'mixed' ? [[Y.x1 - 200, Y.z0 + 200], [Y.x1 - 200, Y.z1 - 200], [Y.x0 + 3000, Y.z1 - 200]] : [[Y.x0 + 200, Y.z0], [Y.x1, Y.z0], [Y.x1, Y.z1], [Y.x0 + 200, Y.z1]];
    const f = createFence('yard fence', pts, { closed: site.id !== 'mixed', mesh: std(0x7d878e, .6, .4, { transparent: true, opacity: .45, depthWrite: false, side: THREE.DoubleSide }), foot: M.concrete, h: 1800 });
    yard.add(f.root);
  } else {
    // 都會型：設備區只用護欄與標線隔開（占地小）
    for (let z = Y.z0 + 600; z < Y.z1; z += 1500) { const b = block(yard, [140, 900, 140], [Y.x0 + 300, 450, z], M.lineYellow); b.name = 'yard bollard'; }
  }
  return { root, gate: { entry, exit, lprIn, lprOut, kiosk, xc, isl }, lights, pole, buildings, evPaint, evPaintX, pave, noise: yard.children.filter(m => m.name === 'noise wall') };
}
