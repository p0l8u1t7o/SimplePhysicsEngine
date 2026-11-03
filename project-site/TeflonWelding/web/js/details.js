// 本站加工件與管線細節。尺寸為展示配置，正式選型仍須確認負載、排氣量與彎曲半徑。
import * as THREE from 'three';
import { MAT, finished } from '@core/geom/materials.js';
import { block, cylinder, decal } from '@core/geom/shapes.js';
import { motor } from '@core/models/hardware.js';
import { hotAirBlower } from '@core/models/equipment-process.js';
import { cable, cableTray, carrier, CABLE } from '@core/electrical/cable-routing.js';
import { TANK } from './spec.js';

const steel = MAT.alu;   // 細節件不貼拉絲法線貼圖（手機幀率）
const box = (p, size, at, mat = steel) => block(p, size, at, mat);
const group = p => { const g = new THREE.Group(); p.add(g); return g; };
function drive(parent, at, scale = .65) {
  const m = motor.create({ scale }); m.root.position.set(...at); parent.add(m.root); return m.root;
}
function ring(parent, r, tube, at, axis = 'y', mat = steel) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, 48), mat); m.position.set(...at);
  if (axis === 'y') m.rotation.x = Math.PI / 2; if (axis === 'x') m.rotation.y = Math.PI / 2;
  parent.add(m); return m;
}
// 重複齒、螺絲及護網只建立一次幾何，降低手機 draw calls。
function repeat(parent, geometry, material, poses) {
  const m = new THREE.InstancedMesh(geometry, material, poses.length), tmp = new THREE.Object3D();
  poses.forEach((p, i) => { tmp.position.set(...p.pos); tmp.rotation.set(...(p.rot || [0, 0, 0])); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
  m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}
function fence(scene, x0, x1, z) {
  const p = group(scene); p.userData.module = 'safety';
  const count = Math.ceil((x1 - x0) / 1200), span = (x1 - x0) / count;
  for (let i = 0; i <= count; i++) { box(p, [55, 1800, 55], [x0 + i * span, 900, z], MAT.yellow); box(p, [140, 12, 140], [x0 + i * span, 6, z], MAT.steelDark); }
  for (const y of [120, 1740]) box(p, [x1 - x0, 28, 24], [(x0 + x1) / 2, y, z], MAT.steelDark);
  const rods = [];
  for (let x = x0 + 80; x < x1 - 25; x += 95) rods.push({ pos: [x, 930, z] });
  repeat(p, new THREE.BoxGeometry(3, 1580, 3), MAT.steelDark, rods);
  repeat(p, new THREE.BoxGeometry(x1 - x0 - 55, 3, 3), MAT.steelDark, Array.from({ length: 16 }, (_, i) => ({ pos: [(x0 + x1) / 2, 180 + 95 * i, z - 3] })));
  decal(p, 400, 170, [(x0 + x1) / 2, 1430, z + 17], [0, 0, 0], ['自動焊接區', '運轉時禁止進入'], { center: true, bg: '#f3c943', color: '#202b34' });
  mergeStatic(p);
}

// 靜態細節依材質合併成一個網格（手機 draw call：主畫面、相機視窗、總覽各畫一次）。
// 共用模型（會變色、會動的三色燈、HMI 等）、效果、貼圖件與標 userData.keep 的件不合併。
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), byMat = new Map();
  root.traverse(m => {
    if (!m.isMesh || m.isInstancedMesh || Array.isArray(m.material) || m.material.map) return;
    for (let q = m; q && q !== root; q = q.parent) if (q.userData.coreModel || q.userData.fx || q.userData.keep) return;
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(m);
  });
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    // 轉成無索引、只留位置與法線，串接成一個幾何（vendor 沒有 BufferGeometryUtils）
    const geoms = list.map(m => (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
    const n = geoms.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    for (const g of geoms) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    const merged = new THREE.Mesh(mg, mat);
    merged.name = `${root.name || 'detail'}-merged`; merged.receiveShadow = true; root.add(merged);
    for (const m of list) m.parent.remove(m);
  }
}

export function addPeripheryDetails(scene, per, key) {
  const p = per.group;
  const blower = hotAirBlower.create({ size: [380, 260, 330], fins: false, material: MAT.steelBlue });
  blower.root.position.set(800, 1315, -40); p.add(blower.root);
  decal(p, 400, 95, [800, 1110, 251], [0, 0, 0], ['LEISTER  /  AIR SUPPLY', 'LHS 21S  ·  250 °C'], { center: true, bg: '#e8eceb', color: '#26353e' });
  decal(p, 380, 80, [1500, 720, 251], [0, 0, 0], ['THz  /  FIBER', '反射式掃描・示意'], { center: true, bg: '#d5dfe4', color: '#26353e' });
  cable(p, 'blower-supply', [[800, 1575, -40], [1090, 1575, -40], [1090, 380, -320], [350, 380, -320]], { radius: 17, color: CABLE.air, clips: 2 });
  cableTray(p, 'utility-tray', [-380, 180, -700], [1800, 180, -700], { width: 90, height: 35 });
  for (const [x, h] of [[0, 1900], [800, 1300], [1500, 900]]) {
    box(p, [8, h - 80, 8], [x - 215, h / 2, 255], MAT.steelDark);
    box(p, [16, 130, 22], [x + 210, h * .52, 262], MAT.black);
  }
  fence(scene, key === 'roll' ? -5700 : -4300, key === 'cobot' ? 6400 : 1900, -2100);
  mergeStatic(p);
  let last = '';
  return st => {
    const status = ['L1', 'C1', 'C2'].map(id => {
      const s = st['seam-' + id], q = v => Math.floor(v * 10) * 10; return `${id}  V ${q(s.g)}%   PFA ${q(s.b)}%   THz ${q(s.i)}%`;   // 10% 一階：HMI 貼圖不必每格重畫上傳
    });
    const text = [st.tool.held || '待命', st.tool.fx, ...status].join('|');
    if (text === last) return; last = text;
    per.panel.drawText(['襯裡焊接 / 製程示意', st.tool.fx ? '加工中・抽氣運轉' : '定位／換工具', ...status, st['seam-C2'].i >= .62 ? 'C2 疑似氣孔：模擬標記' : 'THz：示意結果']);
    per.tower.set(st.tool.fx ? 'green' : 'yellow');
  };
}

export function addRollDetails({ pos, rings, carriage, gx, beamY, Hc }) {
  for (const { ring: r, hinge, clamps } of rings) {
    cylinder(hinge, 33, 155, [0, 0, 0], steel, 'x', 20);
    box(r, [120, 65, 100], [0, -20, -704], MAT.steelDark);
    cylinder(r, 14, 160, [0, 40, -704], steel, 'x', 12);
    // 下半環齒圈與上半環一起開合；避免用完整實心環擋住上料。
    for (const [host, top] of [[r, false], [hinge, true]]) {
      const teeth = [];
      for (let i = 0; i < 36; i++) { const a = (i + .5) * Math.PI / 36 + (top ? 0 : Math.PI); teeth.push({ pos: [65, 768 * Math.sin(a), 768 * Math.cos(a) - (top ? 700 : 0)], rot: [Math.PI / 2 - a, 0, 0] }); }
      repeat(host, new THREE.BoxGeometry(18, 16, 26), steel, teeth);
    }
    for (const { c } of clamps) {
      ring(c, 38, 6, [0, 670, 0]); cylinder(c, 12, 45, [0, 656, 0], steel, 'y', 12);
      box(c, [72, 7, 7], [0, 670, 0], MAT.black);
    }
    drive(pos, [r.position.x + 260, 370, -480], .65);
    ring(pos, 70, 12, [r.position.x + 65, 500, -610], 'x');
    for (const z of [-482, 482]) for (const dx of [-65, 65]) box(pos, [18, 130, 170], [r.position.x + dx, 375, z], steel);
  }
  const chain = carrier(gx, 'X supply chain', { origin: [0, beamY + 210, -300], fixed: -5400, min: -5400, max: -1200, radius: 90, width: 70, pitch: 38 });
  drive(carriage, [0, beamY - 330, -330], .65);
  cable(carriage, 'boom-services', [[0, beamY + 390, -300], [0, beamY - 470, -230], [0, Hc, -140], [950, Hc, -140]], { radius: 12, color: CABLE.sleeve, clips: 4 });
  return () => chain.set(carriage.position.x);
}

export function addTurntableDetails({ pos, table, col, boom, slide, y0 }) {
  ring(pos, 710, 13, [0, 210, 0]);
  repeat(table, new THREE.BoxGeometry(18, 35, 20), steel, Array.from({ length: 72 }, (_, i) => { const a = i * Math.PI / 36; return { pos: [874 * Math.cos(a), 251, 874 * Math.sin(a)], rot: [0, -a, 0] }; }));
  drive(pos, [-900, 270, 700], .85);
  for (const x of [-3630, -3370]) box(col, [32, 4950, 30], [x, 2700, -421], steel);
  repeat(col, new THREE.BoxGeometry(60, 12, 20), steel, Array.from({ length: 100 }, (_, i) => ({ pos: [-3500, 300 + i * 48, -390] })));
  box(slide, [280, 470, 340], [-3480, -380, 0], MAT.steelDark);
  drive(boom, [-3430, -100, -280], .6);
  drive(slide, [-350, 140, 0], .6);
  const vertical = carrier(col, 'column supply chain', { origin: [-3800, 0, -650], axis: [0, 1, 0], rise: [-1, 0, 0], fixed: 700, min: 1900, max: 5000, radius: 100, width: 75, pitch: 40 });
  cable(boom, 'column-chain-outlet', [[-4000, 0, -650], [-3800, 0, -650], [-3800, 0, -150], [-3740, 0, -150]], { radius: 12, color: CABLE.sleeve, clips: 0 });
  const horizontal = carrier(boom, 'boom supply chain', { origin: [0, 220, 250], fixed: -3100, min: -2700, max: 0, radius: 70, width: 65, pitch: 38 });
  cable(slide, 'mast-services', [[0, 360, 250], [160, 220, 180], [160, -700, 0], [125, -850, 0]], { radius: 12, color: CABLE.sleeve, clips: 3 });
  return () => { vertical.set(boom.position.y); horizontal.set(slide.position.x); };
}

export function addGantryDetails({ gantry, cross, ram, H, xs, zs }) {
  for (const x of xs) for (const z of zs) {
    box(gantry, [120, 20, 120], [x, 125, z], steel);
    for (const dz of [-35, 35]) box(gantry, [90, 75, 8], [x, 75, z + (z > 0 ? -60 : 60) + dz], steel);
    box(gantry, [90, 14, 45], [x + 65, 100, z], MAT.yellow);
    cylinder(gantry, 18, 170, [x + (x > 0 ? -150 : 150), 210, z], steel, 'y', 12);
  }
  for (const z of [-105, 105]) box(ram, [32, 2200, 12], [0, 1170, z], steel);
  drive(cross, [230, H + 300, 0], .8);
  drive(cross, [0, H + 600, -1200], .65);
  const chain = carrier(gantry, 'gantry supply chain', { origin: [0, H + 450, -1420], fixed: -2700, min: -2700, max: 0, radius: 100, width: 75, pitch: 40 });
  const zChain = carrier(cross, 'ram supply chain', { origin: [-290, 2200, 300], axis: [0, 1, 0], rise: [-1, 0, 0], fixed: H + 280 - 2200, min: 1800, max: 4700, radius: 90, width: 65, pitch: 40 });
  // 橫向接管留在伸縮柱頂部；穿人孔的垂直段緊貼柱側，不橫跨法蘭。
  cable(ram, 'ram-air-fiber', [[-470, 2220, 300], [-180, 2220, 300], [-150, 2220, 140], [-120, 2220, 0], [-120, 20, 0]], { radius: 11, color: CABLE.sleeve, clips: 2 });
  return () => { chain.set(cross.position.x); zChain.set(ram.position.y); };
}

export function addArmServices(arm, compact = false) {
  const j = arm.j, L = arm.L;
  const shoulderZ = compact ? 72 : 118, elbowZ = compact ? 55 : 80, foreZ = compact ? 65 : 100;
  // 關節內部以接頭表示；外部固定段跟著各連桿，沒有跨關節拉直的假軟管。
  cable(j.j2, 'hot-air upper', [[-22, 20, shoulderZ - 13], [-22, 70, shoulderZ], [-22, L.upper - 50, shoulderZ], [-22, L.upper - 10, elbowZ]], { radius: 8, color: CABLE.air, clips: 2 });
  cable(j.j3, 'hot-air forearm', [[20, L.foreOffset, foreZ - 15], [55, L.foreOffset, foreZ], [L.fore - L.wrist1 - 20, L.foreOffset, foreZ]], { radius: 8, color: CABLE.air, clips: 2 });
  // 電源與光纖沿同一束管外側配置，接頭處保留關節活動餘量。
  for (const [name, offset, radius, color] of [['power', 14, 3, CABLE.power], ['fiber', 23, 2.6, 0x9a72c4]]) {
    cable(j.j2, name + '-upper', [[-22 + offset, 20, shoulderZ - 13], [-22 + offset, 70, shoulderZ], [-22 + offset, L.upper - 50, shoulderZ], [-22 + offset, L.upper - 10, elbowZ]], { radius, color, clips: 0 });
    cable(j.j3, name + '-forearm', [[20, L.foreOffset + offset, foreZ - 15], [55, L.foreOffset + offset, foreZ], [L.fore - L.wrist1 - 20, L.foreOffset + offset, foreZ]], { radius, color, clips: 0 });
  }
  cable(arm.tool || arm.mount, 'wrist service', [[-55, 35, -30], [-55, 50, 10], [-30, 50, 30]], { radius: 6, color: CABLE.sleeve, clips: 1 });
  ring(arm.root, 108, 9, [0, 70, 0]);
  const union = new THREE.Mesh(new THREE.LatheGeometry([[89, 48], [116, 48], [116, 63], [89, 63], [89, 48]].map(p => new THREE.Vector2(...p)), 32), steel);
  union.name = 'rotary-service-union'; arm.root.add(union);
  cable(arm.root, 'base service', [[-120, 0, 0], [-120, 40, 0], [-108, 70, 0]], { radius: 9, color: CABLE.air, clips: 1 });
}

export function addExtraction(scene, plan) {
  // 側吸罩在法蘭外緣，留下原人孔通過範圍；上料時沿後側退開。
  const mount = group(scene); mount.userData.module = 'extraction'; mount.position.copy(plan.frameW.pos); mount.quaternion.copy(plan.frameW.quat);
  const hood = group(mount), y = TANK.manway.top + 85;
  box(hood, [230, 22, 90], [0, y, -310], steel);
  box(hood, [230, 70, 8], [0, y + 35, -355], steel);
  for (const x of [-111, 111]) box(hood, [8, 70, 90], [x, y + 35, -310], steel);
  // A 案先朝桶側跨過門架立柱的 X 位置，再向後引出；B/C 留在人孔後側。
  const elbowY = plan.key === 'roll' ? 1430 : y + 35;
  const outletX = plan.key === 'roll' ? 1150 : 0;
  const hoodRoute = [[0, y + 35, -360], [0, elbowY, -520], [0, elbowY, -1600]];
  if (outletX) hoodRoute.push([outletX, elbowY, -1600]);
  cable(hood, 'fume-duct', hoodRoute, { radius: 45, color: 0x727c82, clips: 0 });
  const unit = group(scene); unit.userData.module = 'extraction'; unit.position.set(plan.key === 'roll' ? -1600 : 1800, 0, -2900);
  box(unit, [650, 900, 600], [0, 450, 0], MAT.cabinet);
  cylinder(unit, 190, 120, [0, 1080, 0], steel, 'z', 32); drive(unit, [0, 930, -180], .8);
  // 接回集氣機，跨越圍籬的管段高於護網；側吸罩退開時伸縮軟管仍連接。
  const outlet = new THREE.Vector3(outletX, elbowY, -1600).applyQuaternion(plan.frameW.quat).add(plan.frameW.pos);
  const duct = group(scene); duct.userData.module = 'extraction';
  const flex = cylinder(duct, 45, 1, [outlet.x, outlet.y, 0], MAT.steelDark, 'z', 16); flex.name = 'extraction-flex'; flex.userData.keep = true;
  cable(duct, 'extractor-return', [[outlet.x, outlet.y, -2500], [unit.position.x, outlet.y, -2650], [unit.position.x, 1080, -2700], [unit.position.x, 1080, -2835]], { radius: 45, color: 0x727c82, clips: 0 });
  decal(unit, 500, 160, [0, 610, 301], [0, 0, 0], ['局部排氣', '風量／處理方式待設計'], { center: true, bg: '#d7e4df', color: '#263b37' });
  for (const g of [unit, duct]) mergeStatic(g);   // 吸罩不合併：伸縮軟管套在吸罩出口管上（套筒關係）
  return k => {
    // 在桶升起到吸罩高度前完成後退；只驅動新增吸罩，不改上料時序。
    hood.position.z = -Math.min(1, k * 32) * 650;
    const end = outlet.z + hood.position.z;
    flex.position.z = (end - 2500) / 2; flex.scale.y = end + 2500;
  };
}
