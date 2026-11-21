// 機台幾何：機架、入料與出料輸送、讀碼、ST1／ST2 旋轉夾頭、翻轉模組、步進移載（前方側入夾叉）、相機與光源、視錐與照射範圍。
// 世界座標（mm）：X 沿產線往東（入料 → 出料）、Y 向上、Z 向前（操作側）；產線中心 Z = 0。
// 工件在站上的姿態由 orientQ()／partToWorld() 決定：工件座標（optics-plan.js）→ 世界。不碰 DOM。
import * as THREE from 'three';
import { block, cylinder, plate } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { create as createConveyor } from '@core/models/conveyor.js';
import { linearAxis } from '@core/models/motion.js';
import { tagPart } from '@core/models/parts.js';
import { JAWS, FINGERS, FLIP_FINGERS, BAND_CENTER } from './optics-plan.js';
import { PITCH } from './sequence.js';

export const LINE = {
  band: 1000,                                  // 夾持帶中心（工件 Z −30.5）的世界高度，所有位置相同
  x: [-900, -450, 0, 450, 900],                // P0 入料讀碼、P1 ST1、P2 翻轉、P3 ST2、P4 分料
  table: 850, len: 1600, depth: 1250, frameH: 1950,                // 機台只涵蓋 ST1～ST2；入料、出料輸送帶與分料落地在兩側
  forkIn: 0, forkOut: 140,                     // 夾叉退出行程（Z 方向）
};
export const POCKET = { x0: -650, x1: -250, z0: -200, z1: 200, floor: 300 };   // ST1 下方挖空範圍
export const POS_NAMES = ['入料讀碼', 'ST1 法蘭面朝上', '翻轉 180°', 'ST2 開口朝上', '分料 OK／NG'];
const rad = d => d * Math.PI / 180;

// 工件姿態：ST2（開口朝上）＝ 先繞工件 Z 轉 −90°（工件 90° 朝世界 +X），再繞世界 X 轉 −90°（工件 +Z → 世界 +Y）；
// ST1（法蘭面朝上）＝ ST2 再繞世界 X 轉 180°。翻轉模組就是繞世界 X 轉。
const Q_ST2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(-90), 0, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(-90)));
const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
export const orientQ = (pose, flipDeg = 0) => {
  if (pose === 'ST2') return Q_ST2.clone();
  // ST1 → 翻轉 flipDeg 度（繞世界 X）→ 180° 時與 ST2 相同
  const q1 = Q_FLIP.clone().multiply(Q_ST2);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(flipDeg)).multiply(q1);
};
// 工件座標點 → 世界（帶中心放在 center）
export function partToWorld(p, pose, center, spinDeg = 0) {
  const v = new THREE.Vector3(p[0], p[1], p[2] - BAND_CENTER).applyAxisAngle(new THREE.Vector3(0, 0, 1), rad(spinDeg));
  return v.applyQuaternion(orientQ(pose)).add(center);
}
export const stationCenter = i => new THREE.Vector3(LINE.x[i], LINE.band, 0);
// 某姿態下，工件 Z 範圍 [z0, z1] 對應的世界高度範圍（相對帶中心）
export const worldBand = (pose, [z0, z1]) => pose === 'ST2' ? [z0 - BAND_CENTER, z1 - BAND_CENTER] : [BAND_CENTER - z1, BAND_CENTER - z0];

// 工件群組：holder（位置）→ orient（姿態）→ spin（繞工件軸）→ 網格（往上移 −BAND_CENTER，讓帶中心在原點）
export function createPartInstance(geometry, material, name) {
  const holder = new THREE.Group(); holder.name = name;
  const orient = new THREE.Group(), spin = new THREE.Group(), mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -BAND_CENTER; mesh.castShadow = true; mesh.receiveShadow = true;
  holder.add(orient); orient.add(spin); spin.add(mesh);
  return { holder, orient, spin, mesh, set(pos, q, spinDeg) { holder.position.copy(pos); orient.quaternion.copy(q); spin.rotation.z = rad(spinDeg); } };
}

// 沿 Y 的中空圓管（內半徑 rIn、外半徑 rOut、高 h、中心 pos）
export function tubeY(parent, rIn, rOut, h, pos, material) {
  const pts = [new THREE.Vector2(rIn, -h / 2), new THREE.Vector2(rOut, -h / 2), new THREE.Vector2(rOut, h / 2), new THREE.Vector2(rIn, h / 2), new THREE.Vector2(rIn, -h / 2)];
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), material); m.position.set(...pos); m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

// ---------------------------------------------------------------- 機架與輸送
export function buildFrame(scene) {
  const g = new THREE.Group(); g.name = 'frame'; scene.add(g);
  const L = LINE, hx = L.len / 2, hz = L.depth / 2;
  // 下方機櫃與台面，ST1 正下方挖空 400 × 400（放反射鏡探頭的相機與支柱，2026-11-21）
  const P = POCKET, z0 = -hz - 60, z1 = hz - 60, span = (x0, x1, y0, y1, za, zb, m) => block(g, [x1 - x0, y1 - y0, zb - za], [(x0 + x1) / 2, (y0 + y1) / 2, (za + zb) / 2], m);
  for (const [y0, y1, m, e] of [[60, L.table - 60, MAT.cabinet, 0], [L.table - 20, L.table, MAT.steelDark, 10]]) {
    span(-hx - e, P.x0, y0, y1, z0 - e, z1 + e, m); span(P.x1, hx + e, y0, y1, z0 - e, z1 + e, m);
    span(P.x0, P.x1, y0, y1, z0 - e, P.z0, m); span(P.x0, P.x1, y0, y1, P.z1, z1 + e, m);
  }
  span(P.x0, P.x1, 60, P.floor, P.z0, P.z1, MAT.cabinet);            // 挖空區的底
  // 上框（鋁擠型）：四柱＋頂框，前側開放給移載
  for (const x of [-hx + 20, hx - 20]) for (const z of [-hz - 40, hz - 80]) block(g, [40, L.frameH - L.table, 40], [x, (L.frameH + L.table) / 2, z], MAT.frame);
  for (const z of [-hz - 40, hz - 80]) block(g, [L.len, 40, 40], [0, L.frameH - 20, z], MAT.frame);
  for (const x of [-hx + 20, hx - 20]) block(g, [40, 40, L.depth - 40], [x, L.frameH - 20, -60], MAT.frame);
  // 相機橫樑（站上方）
  for (const i of [1, 3]) block(g, [40, 40, L.depth - 40], [L.x[i], L.frameH - 60, -60], MAT.frame);
  // 後側透明防護
  const glass = std(0x9fc7e6, .1, 0, { transparent: true, opacity: .12, depthWrite: false });
  block(g, [L.len - 80, L.frameH - L.table - 80, 4], [0, (L.frameH + L.table) / 2, -hz - 40], glass);
  plate(g, ['步進移載（前方側入）'], 360, 60, [-hx + 260, L.table + 12, hz - 40], 0);
  return g;
}

export function buildConveyors(scene) {
  const g = new THREE.Group(); g.name = 'conveyors'; scene.add(g);
  // 入料：ST1 姿態（開口朝下）以凸緣頂（工件 Z +1.5）落在輸送面上
  const inTop = LINE.band + worldBand('ST1', [1.5, 1.5])[0];
  const inC = createConveyor({ length: 600, width: 160, height: inTop, pitch: 70, roller: 20 });
  inC.root.position.set(LINE.x[0] - 240, 0, 0); g.add(inC.root); tagPart(inC, 'P-00260'); Object.assign(inC.root.userData, { contact: true });
  // 出料：ST2 姿態（開口朝上）以止口端環（工件 Z −69）落在輸送面上
  const outTop = LINE.band + worldBand('ST2', [-69, -69])[0];
  const outC = createConveyor({ length: 600, width: 160, height: outTop, pitch: 70, roller: 20 });
  outC.root.position.set(LINE.x[4] + 240, 0, 0); g.add(outC.root); tagPart(outC, 'P-00260'); Object.assign(outC.root.userData, { contact: true });
  // 入料置中：兩側導引（漸縮）＋V 形擋停，夾在 Ø100 外圓帶上半段（世界 986～1000，在開口側耳朵上方、移載夾叉下方）
  const gy0 = 986, gy1 = 1000, gc = new THREE.Group(); gc.name = 'infeed-guides'; g.add(gc);
  for (const sd of [-1, 1]) {
    block(gc, [420, gy1 - gy0, 8], [LINE.x[0] - 330, (gy0 + gy1) / 2, sd * 56], MAT.alu);               // 直段：內面在 r 52
    const fl = block(gc, [180, gy1 - gy0, 8], [LINE.x[0] - 620, (gy0 + gy1) / 2, sd * 70], MAT.alu); fl.rotation.y = sd * rad(9);   // 喇叭口
    const v = block(gc, [8, gy1 - gy0, 70], [LINE.x[0] + 47, (gy0 + gy1) / 2, sd * 32], MAT.ppDark); v.rotation.y = sd * rad(30);   // V 形擋停
    Object.assign(v.userData, { contact: true });
  }
  for (const m of gc.children) Object.assign(m.userData, { contact: true });
  // NG 輸送帶（並排在出料帶後側，可存 8～10 顆，滿料感測）
  const ngC = createConveyor({ length: 600, width: 160, height: outTop, pitch: 70, roller: 20 });
  ngC.root.position.set(LINE.x[4] + 240, 0, -NG_Z); ngC.root.name = 'ng-conveyor'; g.add(ngC.root); tagPart(ngC, 'P-00260'); Object.assign(ngC.root.userData, { contact: true });
  plate(g, ['NG'], 120, 46, [LINE.x[4] + 470, outTop + 6, -NG_Z - 110], 0);
  return { group: g, inC, outC, ngC, inTop, outTop };
}

// NG 分料：出料位東側、沿 Z 的伺服軸（前方），推臂越過輸送帶前框、推板在滾筒上方 4–19 mm（低於移載夾叉），把 NG 件推上後側並排的 NG 輸送帶
export const NG_Z = 230;   // NG 輸送帶中心在產線後方 230 mm
export const SORTER = { x: 1000, armLen: 380, idleZ: 75, push: NG_Z, rootZ: 440 };
export function buildSorter(scene, outTop) {
  const g = new THREE.Group(); g.name = 'sorter'; scene.add(g);
  const axis = linearAxis.create({ axis: 'z', length: 600, width: 70, height: 40, carL: 80, carH: 30 });
  block(g, [80, LINE.table, 80], [SORTER.x, LINE.table / 2, SORTER.rootZ], MAT.steelDark);   // 立座（落地）
  axis.root.position.set(SORTER.x, LINE.table, SORTER.rootZ); g.add(axis.root); tagPart(axis, 'P-00051');
  const arm = new THREE.Group(); arm.name = 'pusher'; axis.carriage.add(arm);
  const y0 = outTop + 4 - LINE.table, y1 = outTop + 19 - LINE.table, ym = (y0 + y1) / 2;
  block(arm, [30, y1 - 70, 30], [0, 70 + (y1 - 70) / 2, 0], MAT.alu);                     // 立桿
  block(arm, [20, y1 - y0, SORTER.armLen], [0, ym, -SORTER.armLen / 2 - 15], MAT.alu);     // 推臂（往後越過輸送帶）
  block(arm, [100, y1 - y0, 20], [-55, ym, -SORTER.armLen - 15], MAT.alu);                // 橫桿
  Object.assign(block(arm, [150, y1 - y0, 10], [-SORTER.x + LINE.x[4], ym, -SORTER.armLen - 30], MAT.ppDark).userData, { contact: true });   // 推板（X 中心在 P4）
  // push：推板從待機（Z +75）往後推的距離；推板 Z ＝ 滑座 Z − armLen − 30
  const set = push => axis.set({ pos: SORTER.idleZ - push + SORTER.armLen + 30 - SORTER.rootZ });
  set(0);
  return { group: g, set };
}

// ---------------------------------------------------------------- 旋轉夾頭（ST1、ST2）：底座、DD 馬達、夾頭本體、3 爪（隨工件轉）
export function buildChuck(scene, idx, pose) {
  const g = new THREE.Group(); g.name = idx === 1 ? 'chuck-st1' : 'chuck-st2'; scene.add(g);
  const c = stationCenter(idx), postEnd = pose === 'ST2' ? -110 : 50;     // 爪柱往底座延伸到工件 Z
  const bodyTop = LINE.band + worldBand(pose, [postEnd, postEnd])[0];
  const hollow = pose === 'ST1';                                         // ST1：中空 DD（孔徑 Ø100），反射鏡探頭與相機光路從中間穿過
  const baseH = bodyTop - LINE.table - 30;
  if (hollow) tubeY(g, 50, 92, baseH, [c.x, LINE.table + baseH / 2, 0], MAT.steelDark);
  else cylinder(g, 70, baseH, [c.x, LINE.table + baseH / 2, 0], MAT.steelDark, 'y', 32);
  const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(c.x, bodyTop, 0); g.add(rotor);
  if (hollow) tubeY(rotor, 50, 92, 30, [0, -15, 0], MAT.alu); else cylinder(rotor, 92, 30, [0, -15, 0], MAT.alu, 'y', 40);
  const jaws = [];
  for (const a of JAWS.angles) {
    const j = new THREE.Group(); j.name = `jaw-${a}`; rotor.add(j);
    const slide = new THREE.Group(); slide.name = 'jaw-slide'; j.add(slide); jaws.push({ g: j, slide, a });
    const [h0, h1] = worldBand(pose, JAWS.z).map(v => v + LINE.band - bodyTop);
    block(slide, [10, h0, JAWS.width], [69, h0 / 2, 0], MAT.steelBlue);                // 爪柱（到爪頭下緣）
    Object.assign(block(slide, [24, h1 - h0, JAWS.width], [62, (h0 + h1) / 2, 0], MAT.steelBlue).userData, { contact: true });   // 爪頭（內面在 r 50）
  }
  // 姿態：爪的方位以工件角度表示，工件 θ° 在世界的方向
  const worldAz = th => { const v = partToWorld([Math.cos(rad(th)), Math.sin(rad(th)), BAND_CENTER], pose, new THREE.Vector3()); return Math.atan2(-v.z, v.x); };
  const set = (spinDeg, open) => {
    const sgn = pose === 'ST2' ? 1 : -1;                                // ST1 工件軸朝下，世界上的轉向相反
    rotor.rotation.y = sgn * rad(spinDeg);
    for (const j of jaws) { j.g.rotation.y = worldAz(j.a); j.slide.position.x = open * JAWS.stroke; }
  };
  set(0, 0);
  return { group: g, set, rotor };
}

// ---------------------------------------------------------------- 翻轉模組（P2）：伺服在台面上，經齒輪箱帶動 Ø24 細軸（翻轉軸＝世界 X、在帶中心高度）；
// U 形夾爪本體在半徑 109–131 mm（工件下方），兩指夾工件 90/270°（翻轉軸上）。細軸、輪轂都低於抬升中工件的下緣，不擋搬運路徑；
// 翻轉與空回都經由機台後側（避開前方的移載夾叉）。
export const FLIP_GEO = { bodyR: 109, bodyT: 22, open: 20, closed: 55, hubR: 15 };
export function buildFlip(scene) {
  const g = new THREE.Group(); g.name = 'flip'; scene.add(g);
  const c = stationCenter(2), F = FLIP_GEO;
  block(g, [16, LINE.band - LINE.table - 15, 60], [c.x - 150, (LINE.band - 15 + LINE.table) / 2, 0], MAT.steelDark);   // 齒輪箱
  block(g, [90, 90, 120], [c.x - 150, LINE.table + 45, -110], MAT.black);                                              // 伺服馬達＋減速機
  const rot = new THREE.Group(); rot.name = 'flip-rotor'; rot.position.set(c.x, LINE.band, 0); g.add(rot);
  const [f0, f1] = worldBand('ST1', FLIP_FINGERS.z);                       // ST1 姿態下的夾指高度（翻轉軸在帶中心）
  cylinder(rot, 12, 50, [-117, 0, 0], MAT.chrome, 'x', 20);                // 細軸
  block(rot, [14, F.hubR * 2, F.hubR * 2], [-95, 0, 0], MAT.alu);          // 輪轂
  block(rot, [14, F.bodyR - F.hubR, 30], [-95, -(F.bodyR + F.hubR) / 2, 0], MAT.alu);                   // 側板（輪轂 → 本體上緣）
  block(rot, [176, F.bodyT, 50], [-1, -(F.bodyR + F.bodyT / 2), 0], MAT.steelBlue);                        // U 形本體底
  const fingers = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Group(); f.name = 'flip-finger'; rot.add(f); fingers.push({ f, s });
    block(f, [10, f0 + F.bodyR, FLIP_FINGERS.width], [s * 5, (-F.bodyR + f0) / 2, 0], MAT.alu);          // 指桿：本體上緣 → 夾指下緣
    Object.assign(block(f, [10, f1 - f0, FLIP_FINGERS.width], [s * 5, (f0 + f1) / 2, 0], MAT.pu).userData, { contact: true });   // 指墊（內面在 r 50）
  }
  const set = (angle, open) => {
    rot.rotation.x = rad(angle);
    for (const { f, s } of fingers) f.position.x = s * (F.closed - 5 + open * F.open);
  };
  set(180, 1);
  return { group: g, set };
}

// ---------------------------------------------------------------- 步進移載：前方 X 軸（伺服）→ 立柱上的升降滑座（伺服）→ 夾叉進出（氣缸）→ 4 組夾叉
// 4 組夾叉一次把 P0→P1、P1→P2、P2→P3、P3→P4 的工件往下游搬一格；前 2 組搬 ST1 姿態、後 2 組搬 ST2 姿態，夾指高度各自設定
export const FORK = { barRise: 45, zIn: 165, tip: -15, closed: 58, open: 12 };
export function buildTransfer(scene) {
  const g = new THREE.Group(); g.name = 'transfer'; scene.add(g);
  const zRail = 500, c = LINE.band;
  const xAxis = linearAxis.create({ length: 900, width: 140, height: 50, carL: 240, carH: 40 });
  xAxis.root.position.set(0, LINE.table, zRail); g.add(xAxis.root); tagPart(xAxis, 'P-00051');
  const col = new THREE.Group(); col.name = 'column'; xAxis.carriage.add(col);
  block(col, [120, 300, 80], [0, 90 + 150, 30], MAT.steelDark);           // 立柱（升降導軌）
  const liftCar = new THREE.Group(); liftCar.name = 'lift-car'; col.add(liftCar);
  const barY = c + FORK.barRise - LINE.table;                              // 夾叉樑高度（升降 0 時，滑座局部座標）
  block(liftCar, [100, 50, 60], [0, barY, -40], MAT.alu);                  // 升降滑座
  block(liftCar, [70, 30, 200], [0, barY, -170], MAT.alu);                 // 進出缸本體（往後伸）
  const slide = new THREE.Group(); slide.name = 'fork-slide'; liftCar.add(slide);
  block(slide, [40, 20, 150], [0, barY, 75], MAT.chrome);                  // 進出缸活塞桿
  const span = PITCH * 3;
  block(slide, [span + 220, 30, 30], [0, barY, 0], MAT.alu);               // 夾叉樑（沿 X）
  const pairs = [];
  for (let k = 0; k < 4; k++) {
    const pose = k < 2 ? 'ST1' : 'ST2', [h0, h1] = worldBand(pose, FINGERS.z), hc = (h0 + h1) / 2;
    const pg = new THREE.Group(); pg.name = `fork-${k}`; slide.add(pg); pg.position.set(-span / 2 + k * PITCH, barY, 0);
    block(pg, [170, 16, 26], [0, -23, 0], MAT.steelBlue);                  // 夾爪本體（樑下）
    const len = FORK.zIn - FORK.tip, arms = [];
    for (const sd of [-1, 1]) {
      const a = new THREE.Group(); a.name = 'fork-arm'; pg.add(a); arms.push({ a, sd });
      const yRel = hc - FORK.barRise;                                       // 相對夾叉樑
      const top = -31, armTop = yRel + (h1 - h0) / 2;                       // 夾爪本體下緣 → 臂上緣
      if (top - armTop > .5) block(a, [12, top - armTop, 12], [0, (top + armTop) / 2, 0], MAT.alu);   // 垂直段
      block(a, [12, h1 - h0, len], [0, yRel, -len / 2], MAT.alu);          // 水平臂（沿 −Z 伸到工件後方，內面在 r 52）
      Object.assign(block(a, [2, h1 - h0, 30], [-sd * 7, yRel, -FORK.zIn], MAT.pu).userData, { contact: true });   // 指墊 2 mm（內面在 r 50，接觸夾持帶）
    }
    pairs.push({ pg, arms, pose });
  }
  // x：0～PITCH（0＝取件位、PITCH＝放件位）；lift：0～LIFT；out：0 伸入、1 退出；open：0 閉、1 開
  const set = ({ x, lift, out, open }) => {
    xAxis.set({ pos: -225 + x });
    liftCar.position.y = lift;
    slide.position.z = -(zRail - FORK.zIn) + out * LINE.forkOut;
    for (const p of pairs) for (const { a, sd } of p.arms) a.position.x = sd * (FORK.closed + open * FORK.open);
  };
  set({ x: 0, lift: 0, out: 1, open: 1 });
  return { group: g, set, pairs };
}
