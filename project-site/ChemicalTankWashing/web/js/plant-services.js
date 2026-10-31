// 本站梯式線槽、安全設施與輸送附件；全部為靜態，既有排程不需新增更新工作。
import * as THREE from 'three';
import { MAT, finished } from '@core/geom/materials.js';
import { plate } from '@core/geom/shapes.js';
import { motor, sensor } from '@core/geom/hardware.js';
import { estop } from '@core/models/indicators.js';
import { FILL, STAGING, CONV, worldFootprints } from './layout.js';
import { SERVICES } from './service-layout.js';

const steel = finished(MAT.steel, 'metal');
const bowlSteel = steel.clone(); bowlSteel.side = THREE.DoubleSide;
const green = new THREE.MeshStandardMaterial({ color: 0x258f69, roughness: .5, metalness: .3 });
const box = new THREE.BoxGeometry(1, 1, 1), tube = new THREE.CylinderGeometry(1, 1, 1, 12);
const cone = new THREE.CylinderGeometry(.35, 1, 1, 20, 1, true);
const hoop = new THREE.TorusGeometry(1, .065, 6, 32);
const vec = p => new THREE.Vector3(...p);

// 同材質、同幾何合批；每個實例保留驗證標記，不依賴 core 略過 InstancedMesh。
function batch(parent, name) {
  const entries = new Map();
  function add(geometry, material, size, position, q = new THREE.Quaternion()) {
    const key = `${geometry.uuid}/${material.uuid}`;
    if (!entries.has(key)) entries.set(key, { geometry, material, matrices: [] });
    entries.get(key).matrices.push(new THREE.Matrix4().compose(vec(position), q, vec(size)));
  }
  const api = {
    box: (size, p, material = steel, q) => add(box, material, size, p, q),
    rod(a, b, r = 8, material = MAT.black) {
      const start = vec(a), end = vec(b), d = end.clone().sub(start);
      add(tube, material, [r, d.length(), r], start.add(end).multiplyScalar(.5).toArray(), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    },
    add,
    flush() {
      for (const { geometry, material, matrices } of entries.values()) {
        const m = new THREE.InstancedMesh(geometry, material, matrices.length);
        m.name = name; m.userData.renderDetail = true;
        matrices.forEach((matrix, i) => m.setMatrixAt(i, matrix));
        m.instanceMatrix.needsUpdate = true; m.receiveShadow = true;
        // 細線材不另投影，減少大場景陰影重繪成本。
        parent.add(m);
      }
    },
  };
  return api;
}

function prototypeInstances(parent, name, prototype, placements) {
  prototype.updateMatrixWorld(true);
  const b = batch(parent, name);
  prototype.traverse(o => {
    if (!o.isMesh) return;
    for (const [x, y, z, yaw = 0] of placements) {
      const m = new THREE.Matrix4().makeRotationY(yaw); m.setPosition(x, y, z); m.multiply(o.matrixWorld);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
      b.add(o.geometry, o.material, s.toArray(), p.toArray(), q);
    }
  });
  b.flush();
}

export function createPlantServices(scene) {
  const root = new THREE.Group(); root.name = 'plant services'; scene.add(root);
  const sub = name => { const g = new THREE.Group(); g.name = name; g.userData.station = name; root.add(g); return g; };
  const trayGroup = sub('service trays'), trays = batch(trayGroup, 'ladder trays and brackets');
  const cables = batch(trayGroup, 'tray power and signal cables'), routes = [];
  const { trayY: y, northZ: nz, robot: robot, trayWidth: w } = SERVICES;
  const branches = [...FILL.lines.map(x => x + 440), 22000, 23670, 25300];
  function tray(a, b, width = w, gaps = []) {
    const axis = a[0] !== b[0] ? 0 : a[2] !== b[2] ? 2 : 1;
    const cross = axis === 0 ? 2 : 0, lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    routes.push({ a, b, width, axis });
    const intervals = []; let previous = lo;
    for (const cut of [...gaps].sort((u, v) => u - v)) {
      intervals.push([previous, cut - width / 2 - 15]); previous = cut + width / 2 + 15;
    }
    intervals.push([previous, hi]);
    for (const sign of [-1, 1]) for (const [start, end] of intervals) {
      if (end <= start) continue;
      const size = [8, 60, 8], p = [...a]; size[axis] = end - start; p[axis] = (start + end) / 2; p[cross] += sign * width / 2;
      if (axis !== 1) p[1] += 26; else size[2] = 60;
      trays.box(size, p);
    }
    for (let s = lo + 100; s < hi - 40; s += 300) {
      const size = [12, 8, 12], p = [...a]; size[cross] = width; p[axis] = s;
      trays.box(size, p);
    }
    for (const offset of [-27, 0, 27]) {
      const p = [...a], q = [...b]; p[cross] += offset; q[cross] += offset;
      if (axis !== 1) { p[1] += 14; q[1] += 14; } else { p[2] += 14; q[2] += 14; }
      cables.rod(p, q, 5, offset ? MAT.black : MAT.steelBlue);
    }
    if (axis === 1) return;
    // 懸吊桿與下托架；吊點止於既有屋頂高度，不新增燈源。
    for (let s = lo + 500; s < hi - 150; s += 1800) {
      const p = [...a]; p[axis] = s;
      const size = [24, 18, 24]; size[cross] = width + 40;
      trays.box(size, [p[0], p[1] - 13, p[2]], MAT.steelDark);
      for (const sign of [-1, 1]) {
        const q = [...p]; q[cross] += sign * (width / 2 + 15);
        trays.rod([q[0], p[1] - 4, q[2]], [q[0], 4480, q[2]], 5, steel);
        trays.box([24, 16, 24], [q[0], 4488, q[2]]);
      }
    }
  }
  tray([FILL.lines[0] + 440, y, nz], [robot.eastX, y, nz], w, [...branches, robot.eastX]);
  function northBranch(x, endZ, gaps = []) {
    // T 接頭留出主槽側樑缺口，支槽從主槽外緣開始，纜線不穿過側樑。
    tray([x, y, nz + w / 2 + 4], [x, y, endZ], w, gaps);
    for (const offset of [-27, 0, 27]) cables.rod([x + offset, y + 14, nz], [x + offset, y + 14, nz + w / 2 + 4], 5, offset ? MAT.black : MAT.steelBlue);
  }
  const fp = worldFootprints();
  for (const key of ['panel', 'robotCtrl']) {
    const [x0, z0, x1, z1, top] = fp[key].r, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
    tray([x, top + 4, z], [x, y, z]); northBranch(x, z);
    for (const offset of [-27, 0, 27]) cables.rod([x + offset, y, z + 14], [x + offset, y + 14, z], 5, offset ? MAT.black : MAT.steelBlue);
  }
  northBranch(robot.eastX, robot.z);
  tray([robot.eastX, 46, robot.z], [robot.eastX, y, robot.z]);
  for (const offset of [-27, 0, 27]) cables.rod([robot.eastX + offset, y, robot.z + 14], [robot.eastX + offset, y + 14, robot.z], 5, offset ? MAT.black : MAT.steelBlue);
  // 地面護線槽由圍籬下方通過，終點在既有基座板東緣，沒有穿入底座。
  trays.box([robot.eastX - robot.endX, 36, 150], [(robot.eastX + robot.endX) / 2, 20, robot.z], MAT.steelDark);
  northBranch(22000, 6800, [6800]); tray([22000, y, 6800], [23410, y, 6800], w, [22000]);
  for (const [x, z] of [[23410, 7106], [22890, 7086]]) {
    cables.rod([x, y + 14, 6800], [x, 2780, 6800], 12);
    cables.rod([x, 2780, 6800], [x, 2780, z], 12);
  }
  FILL.lines.forEach(x => {
    northBranch(x + 440, FILL.pos[0], [4900]);
    for (const z of FILL.pos) {
      cables.rod([x + 440, y + 14, z - 420], [x + 440, 2342, z - 420], 9);
      trays.box([38, 70, 45], [x + 440, 2380, z - 420], MAT.cabinet);
    }
    // 人機線越過三色燈後沿架旁下降，用支架固定，於外殼頂面接入。
    cables.rod([x + 440, y + 14, 4900], [x - 710, y + 14, 4900], 8);
    cables.rod([x - 710, y + 14, 4900], [x - 710, 1600, 4900], 8);
    for (const h of [2000, 2500]) trays.rod([x - 710, h, 4900], [x - 600, h, 4900], 5, steel);
    cables.rod([x - 710, 1600, 4900], [x - 635, 1600, 4900], 8);
    cables.rod([x - 635, 1600, 4900], [x - 635, 1581, 4900], 8);
  });
  trays.flush(); cables.flush();

  const safety = sub('chemical safety'), s = batch(safety, 'chemical safety equipment');
  for (const [x, z] of SERVICES.showers) {
    s.box([260, 12, 260], [x, 8, z], steel);
    s.rod([x, 14, z], [x, 2300, z], 23, green);
    s.rod([x, 2300, z], [x, 2300, z + 470], 23, green);
    s.add(cone, green, [130, 110, 130], [x, 2245, z + 470]);
    s.rod([x + 95, 2200, z + 370], [x + 95, 1500, z + 370], 6, steel);
    s.box([150, 18, 38], [x + 95, 1490, z + 370], green);
    s.rod([x, 950, z], [x, 950, z + 250], 20, green);
    // 開口盆採薄錐面，雙噴頭與防塵帽，不以實心圓柱塞滿盆面。
    s.add(cone, bowlSteel, [175, 100, 175], [x, 990, z + 250], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    for (const dx of [-65, 65]) {
      s.rod([x + dx, 1035, z + 250], [x + dx, 1100, z + 250], 12, steel);
      s.add(tube, green, [22, 12, 22], [x + dx, 1106, z + 250]);
    }
    s.box([85, 8, 110], [x + 125, 140, z + 180], MAT.black);
    plate(safety, ['緊急沖淋 / 洗眼', 'EMERGENCY SHOWER'], 600, 220, [x, 2600, z + 20], 0, { bg: '#14835b', w: 768, h: 256 });
    s.rod([x, 2300, z], [x, 2490, z], 12, green);
  }
  const wallUnits = [[5200, 140, 0], [12500, 11200, -Math.PI / 2], [26200, 2200, -Math.PI / 2]];
  for (const [x, z, yaw] of wallUnits) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const p = (a, b, c) => vec([a, b, c]).applyQuaternion(q).add(vec([x, 0, z])).toArray();
    s.add(tube, MAT.red, [80, 430, 80], p(0, 1000, 60));
    s.box([110, 20, 65], p(0, 1260, 60), MAT.black, q);
    s.rod(p(0, 1215, 60), p(0, 1250, 60), 22, steel);
    s.box([180, 60, 100], p(0, 790, 10), steel, q);
    const back = yaw === 0 ? -132 : -52;
    s.box([120, 440, 12], p(0, 1000, back), steel, q);
    s.rod(p(0, 1000, back + 6), p(0, 1000, -20), 12, steel);
    s.rod(p(70, 1210, 60), p(100, 920, 60), 9);
    plate(safety, ['滅火器', 'FIRE'], 260, 300, p(0, 1620, 15), yaw, { bg: '#b92d28', w: 256, h: 256 });
  }
  for (const [x, z, yaw] of [[130, 3580, Math.PI / 2], [12440, 9000, -Math.PI / 2], [26140, 4500, -Math.PI / 2]]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const p = (a, b, c) => vec([a, b, c]).applyQuaternion(q).add(vec([x, 0, z])).toArray();
    s.box([310, 310, 30], p(0, 1350, -100), steel, q);
    s.rod(p(0, 1350, -85), p(0, 1350, 75), 30, steel);
    for (let k = 0; k < 4; k++) s.add(hoop, MAT.black, [125 + k * 23, 125 + k * 23, 125 + k * 23], p(0, 1350, 0), q);
    s.add(hoop, MAT.red, [230, 230, 230], p(0, 1350, 60), q);
    for (const angle of [0, Math.PI / 3, 2 * Math.PI / 3])
      s.rod(p(-215 * Math.cos(angle), 1350 - 215 * Math.sin(angle), 60), p(215 * Math.cos(angle), 1350 + 215 * Math.sin(angle), 60), 7, MAT.red);
    s.rod(p(180, 1350, 0), p(180, 700, 0), 13);
    s.box([36, 140, 35], p(180, 630, 0), MAT.steelDark, q);
  }
  for (const [x, z, yaw] of [[1450, 8, 0], [1250, 4692, Math.PI], [16500, 15512, Math.PI]])
    plate(safety, ['化學作業區 / PPE', '護目鏡 · 手套 · 防護衣'], 600, 300, [x, 2400, z], yaw, { bg: '#185d97', w: 768, h: 384 });
  for (const x of FILL.lines) {
    const z = FILL.pos[0] + FILL.buttonDz;
    s.box([40, 55, 40], [x + 670, 1187.5, z]);
    s.box([25, 30, 40], [x + 682.5, 1215, z]);
  }
  s.flush();
  const e = estop.create({ collarR: 35, capR: 25, box: { size: [100, 100, 40] }, segments: 16 });
  prototypeInstances(safety, 'release side emergency stops', e.root, [...FILL.lines.map(x => [x + 735, 1215, FILL.pos[0] + FILL.buttonDz, Math.PI / 2]), [STAGING.gantry.x1 + 140, 1200, STAGING.gantry.z0, Math.PI / 2]]);

  const conveyor = sub('conveyor drive details'), c = batch(conveyor, 'conveyor guides and sensor brackets');
  const drives = FILL.lines.flatMap(x => [3640, 10840].map(z => [x - 430, 260, z, -Math.PI / 2]));
  drives.push([7990, 260, FILL.distZ - 450, Math.PI], [9010, 260, FILL.collectZ + 450, 0]);
  const proto = new THREE.Group(); motor(proto, 0, 0, 0, .55);
  prototypeInstances(conveyor, 'conveyor gear motors', proto, drives);
  for (const [x, , z, yaw] of drives) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    c.box([90, 220, 24], [x, 367, z], MAT.steelDark, q);
    const d = vec([0, 0, -1]).applyQuaternion(q), mount = vec([x, CONV.top - 30, z]);
    c.rod(mount.clone().addScaledVector(d, 12).toArray(), mount.addScaledVector(d, Math.abs(d.x) > .5 ? 25 : 45).toArray(), 8, steel);
  }
  function guide(a, b, axis, sign = 1) {
    c.rod(a, b, 12, steel);
    for (let t = 0; t <= 1; t += .5) {
      const p = vec(a).lerp(vec(b), t).toArray();
      const foot = [...p]; foot[axis] += sign * 50; foot[1] = CONV.top + 5;
      c.rod(foot, [foot[0], p[1], foot[2]], 8, steel); c.rod([foot[0], p[1], foot[2]], p, 8, steel);
    }
  }
  for (const x of FILL.lines) for (const [z0, z1] of [[2350, 4300], [10850, 11850]]) for (const sign of [-1, 1])
    guide([x + sign * 330, CONV.top + 140, z0], [x + sign * 330, CONV.top + 140, z1], 0, sign);
  guide([3000, CONV.top + 140, FILL.distZ - 330], [10000, CONV.top + 140, FILL.distZ - 330], 2, -1);
  guide([0, CONV.top + 140, FILL.collectZ + 330], [10600, CONV.top + 140, FILL.collectZ + 330], 2);
  const eyes = new THREE.Group(); sensor(eyes, 0, 0, 0, Math.PI / 2);
  const eyePositions = FILL.lines.flatMap(x => [4000, 11400].map(z => [x + 345, CONV.top + 85, z]));
  prototypeInstances(conveyor, 'zone photo eyes', eyes, eyePositions);
  for (const [x, y0, z] of eyePositions) c.box([10, 50, 45], [x + 25, y0 - 55, z]);
  c.flush();
  return { root, routes, showers: SERVICES.showers };
}
