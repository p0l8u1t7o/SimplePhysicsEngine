// 三個方案的機構：桶的擺放（frame 的世界位置）、載具（把手臂沿桶軸送進人孔的軸）、迴轉（桶轉或 J1 轉）、工具架與上料方式。
// 共同介面：每個方案回傳
//   frame：桶座標在世界中的位置與姿態；psi：手臂正前方（焊點）在桶座標的方位；carrier：手臂掛點群組（桶座標，原點在桶軸上）
//   setCarrier(s, lat)：s＝手臂基座面在桶座標的高度、lat＝橫移（B／C 往工具架、桶座標 x）；setSpin(phi)；setLoad(k)（0＝就位、1＝吊起／移出）
//   rackPose：工具架取放姿態（手臂局部座標）、slots：每格的 { s, lat }；cut：剖切平面（桶座標，法向量朝保留側）
import * as THREE from 'three';
import { MAT, std } from '@core/geom/materials.js';
import { block, cylinder } from '@core/geom/shapes.js';
import { floor } from '@core/geom/environment.js';
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { frl } from '@core/models/motion.js';
import { TANK } from './spec.js';
import { rackSlot } from './tools.js';
import { addRollDetails, addTurntableDetails, addGantryDetails } from './details.js';

const P = { paint: std(0x2f5d8a, .5, .35), yellow: MAT.yellow, dark: MAT.steelDark, rubber: std(0x2a2d31, .85, 0), pu: std(0xd9a441, .7, .05), sling: std(0x3a8f4f, .8, 0) };
const g = (name, parent) => { const o = new THREE.Group(); o.name = name; if (parent) parent.add(o); return o; };
const mod = (o, name) => { o.userData.module = name; return o; };
const box = (parent, size, pos, mat, name) => { const m = block(parent, size, pos, mat); if (name) m.name = name; return m; };

// 共用周邊：電控櫃、熱風控制與氣源、兆赫波主機、HMI、三色燈、安全光柵
function periphery(scene, { x, z, rotY = 0, curtain }) {
  const p = mod(g('periphery', scene), 'periphery'); p.position.set(x, 0, z); p.rotation.y = rotY;
  box(p, [800, 1900, 500], [0, 950, 0], MAT.cabinet, 'control-cabinet');
  box(p, [600, 1300, 500], [800, 650, 0], MAT.cabinet, 'hot-air-controller');
  box(p, [600, 900, 500], [1500, 450, 0], std(0x46536b, .5, .3), 'thz-main-unit');
  const air = frl.create(); air.root.position.set(800, 1320 + 60, 260); p.add(air.root);
  const tower = signalTower.create({ poleH: 260 }); tower.root.position.set(-300, 1900, 0); p.add(tower.root);
  const panel = hmi.create({ display: true }); panel.root.position.set(200, 1350, 262); p.add(panel.root);
  const stop = estop.create(); stop.root.position.set(-200, 1150, 252); p.add(stop.root);
  if (curtain) for (const c of curtain) { const lc = lightCurtain.create(c.params || {}); lc.root.position.set(...c.pos); lc.root.rotation.y = c.rotY || 0; scene.add(lc.root); mod(lc.root, 'safety'); }
  return { group: p, tower, panel };
}

// 天車吊鉤（上料示意）：吊鉤塊＋吊帶；k＝0 吊帶掛在桶上、k＞0 跟著吊起
function hook(scene) {
  const h = mod(g('crane-hook', scene), 'crane');
  box(h, [160, 220, 90], [0, 0, 0], P.yellow, 'hook-block');
  cylinder(h, 18, 900, [0, 560, 0], MAT.steel, 'y', 12).name = 'hoist-rope';
  const lines = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(50, 1, 4), P.sling); m.name = 'sling'; h.add(m); return m; });
  return {
    group: h,
    // pos：吊鉤世界位置；ends：兩條吊帶下端（世界座標）
    set(pos, ends) {
      h.position.copy(pos);
      lines.forEach((m, i) => { const A = new THREE.Vector3(0, -110, 0), B = ends[i].clone().sub(pos); m.scale.y = A.distanceTo(B); m.position.copy(A).add(B).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); });
    },
  };
}

// ================================================================ 方案 A：臥式雙環迴轉架＋懸吊 X 軸伸臂
function planRoll(scene) {
  const Hc = 1100, xb = 600;                                   // 桶軸高、下切線的世界 X（人孔朝 −X）
  const frameW = { pos: new THREE.Vector3(xb, Hc, 0), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)) };
  floor(scene, { size: [12000, 7000], center: [-1800, 0], cell: 250 });

  // ---- 雙環迴轉架（開合式）：兩環夾住直筒，每環 4 支夾緊螺桿；底座 2 支托輪（一支驅動）
  const pos = mod(g('positioner', scene), 'positioner'), rings = [];
  const ringX = [xb - 250, xb - 1100], rIn = 640, rOut = 760, w = 110;
  const lathe = (r0, r1, wd, phi0, len) => new THREE.LatheGeometry([[r0, -wd / 2], [r1, -wd / 2], [r1, wd / 2], [r0, wd / 2], [r0, -wd / 2]].map(([r, y]) => new THREE.Vector2(r, y)), 64, phi0, len);
  for (const x of ringX) {
    const base = g('ring-base', pos);
    box(base, [520, 160, 1500], [x, 80, 0], P.paint);
    for (const s of [-1, 1]) {
      const a = (90 + s * 36) * Math.PI / 180, ry = Hc - (rOut + 60) * Math.sin(a), rz = (rOut + 60) * Math.cos(a);
      cylinder(base, 60, 90, [x, ry, rz], P.pu, 'x', 32).name = 'support-roller';
      box(base, [200, ry - 160 + 10, 140], [x, 160 + (ry - 160) / 2 - 5, rz], P.paint);
    }
    box(base, [260, 220, 260], [x + 260, 270, (rOut + 60) * Math.cos(126 * Math.PI / 180)], MAT.steelDark, 'ring-drive');
    const ring = g('ring', pos); ring.position.set(x, Hc, 0); ring.userData.cableHost = false;
    const lower = new THREE.Mesh(lathe(rIn, rOut, w, Math.PI, Math.PI), P.yellow); lower.rotation.z = Math.PI / 2; lower.name = 'ring-lower'; ring.add(lower);
    const hinge = g('ring-hinge', ring); hinge.position.set(0, 0, rOut - 60);
    const upper = new THREE.Mesh(lathe(rIn, rOut, w, 0, Math.PI), P.yellow); upper.rotation.z = Math.PI / 2; upper.position.z = -(rOut - 60); upper.name = 'ring-upper'; hinge.add(upper);
    // 夾緊螺桿：上半環兩支（±45°）、下半環兩支（±135°）；方向 (0, cos a, sin a)，上半環的在鉸鏈座標要扣掉鉸鏈位移
    const clamps = [];
    for (const deg of [45, -45, 135, -135]) {
      const a = deg * Math.PI / 180, top = Math.abs(deg) < 90, c = g('clamp', top ? hinge : ring);
      c.position.z = top ? -(rOut - 60) : 0; c.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
      const scr = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, rIn - 540, 12), MAT.chrome); scr.name = 'clamp-screw'; scr.position.y = (rIn + 540) / 2; c.add(scr);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(60, 12, 90), P.rubber); pad.name = 'clamp-pad'; c.add(pad);
      clamps.push({ c, scr, pad });
    }
    rings.push({ ring, hinge, clamps });
  }

  // ---- 懸吊 X 軸（門型架）＋伸臂
  const gx = mod(g('x-axis', scene), 'x-axis'), beamY = 2750, xs = [-1500, -6000];
  box(gx, [xs[0] - xs[1] + 300, 300, 300], [(xs[0] + xs[1]) / 2, beamY, 0], P.paint, 'x-beam');
  box(gx, [xs[0] - xs[1], 40, 60], [(xs[0] + xs[1]) / 2, beamY - 170, 0], MAT.steel, 'x-rail');
  for (const x of xs) { for (const z of [-850, 850]) box(gx, [200, beamY + 150, 200], [x, (beamY + 150) / 2, z], P.paint, 'post'); box(gx, [200, 260, 1900], [x, beamY, 0], P.paint, 'portal-beam'); }
  const carriage = mod(g('boom', scene), 'boom'); carriage.userData.cableHost = false;
  box(carriage, [420, 180, 380], [0, beamY - 280, 0], MAT.steelDark, 'x-carriage');
  box(carriage, [180, beamY - 370 - Hc + 80, 180], [0, (beamY - 370 + Hc - 80) / 2, 0], P.paint, 'drop-column');
  const boomLen = 900;
  box(carriage, [boomLen, 160, 160], [boomLen / 2 + 90, Hc, 0], P.paint, 'boom-arm');
  box(carriage, [20, 220, 220], [boomLen + 100, Hc, 0], MAT.steel, 'boom-plate');
  const tipX = boomLen + 110;                                  // 手臂基座面（伸臂前端板外側）相對滑座

  // ---- 工具架：X 軸下方地面，手臂在桶外朝下取放
  const rack = mod(g('tool-rack', scene), 'tool-rack');

  // ---- 周邊與上料吊鉤
  const per = periphery(scene, { x: -3600, z: 2200, curtain: [{ pos: [-1300, 0, 1900], rotY: 0 }] });
  const crane = hook(scene);
  const slingAt = [xb - 1290 + 300, xb - 300];
  const updateDetails = addRollDetails({ pos, rings, carriage, gx, beamY, Hc });

  return {
    key: 'roll', Hc, frameW, psi: Math.PI, rackPose: { r: 560, d: 450, Z: [1, 0, 0], X: [0, 1, 0], lift: 'arm', up: 300 },
    cut: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 40),                     // 保留世界下半（桶座標 x ≤ 40）
    build(carrier, ctx) {
      carriage.add(carrier); carrier.position.set(tipX, Hc, 0); carrier.quaternion.copy(frameW.quat);
      // 工具架：每格在 s_out 之後，間距 340（換工具時手腕擺動不碰鄰格工具）（格位世界位置由手臂取放姿態的順向運動學決定，層板在 project.js 建）
      ctx.slots = ctx.tools.map((_, i) => ({ s: ctx.sOut + 120 + i * 340, lat: 0 }));
    },
    rackRoot: rack,
    setCarrier(s) { carriage.position.x = xb - s - tipX; updateDetails(); },
    setSpin(phi, tank) { tank.spin.rotation.y = phi; for (const r of rings) r.ring.rotation.x = -phi; },
    // 上料：k 1→0 吊鉤把臥放的桶放進下半環；open 0→1 上半環張開；clamp 0→1 夾緊（夾墊從 40 mm 外推到貼桶身）
    setLoad({ k, open, clamp }, tank) {
      const lift = k * 1700;
      tank.frame.position.copy(frameW.pos).add(new THREE.Vector3(0, lift, 0));
      for (const r of rings) { r.hinge.rotation.x = open * 1.9; for (const cl of r.clamps) { cl.pad.position.y = TANK.ri + TANK.wall + 6 + (1 - clamp) * 40; } }
      const top = Hc + TANK.ri + TANK.wall + lift, hp = new THREE.Vector3((slingAt[0] + slingAt[1]) / 2, top + 1300, 0);
      crane.group.visible = open > .02;
      crane.set(hp, slingAt.map(x => new THREE.Vector3(x, top, 0)));
    },
    periphery: per,
    views: {
      iso: [[-5200, 4200, 6200], [-900, 900, 0]],
      inside: [[-250, 2650, 1900], [-70, 1000, 0]],
      weld: [[180, 1940, 1100], [-160, 640, 0]],
      rack: [[-3000, 2200, 3200], [-2600, 900, 0]],
      top: [[-1800, 11000, 10], [-1800, 0, 0]],
    },
  };
}

// ================================================================ 方案 B／C 共用：立式桶、手臂倒吊在垂直伸縮柱下端
function verticalCarrier(scene, { y0, ramLen, name }) {
  const ram = mod(g(name, scene), name); ram.userData.cableHost = false;
  box(ram, [200, ramLen, 200], [0, ramLen / 2 + 20, 0], P.paint, 'ram');
  box(ram, [260, 20, 260], [0, 10, 0], MAT.steel, 'ram-plate');
  return ram;
}

// ================================================================ 方案 B：立式轉台＋立柱懸臂（懸臂上下、伸縮）
function planTurntable(scene) {
  const tt = 300, y0 = tt + 1 - TANK.legs.footY;               // 轉台面高、桶下切線高（腳底板離台面 1 mm，避免重合面）
  const frameW = { pos: new THREE.Vector3(0, y0, 0), quat: new THREE.Quaternion() };
  floor(scene, { size: [11000, 8000], center: [-1500, 0], cell: 250 });
  const pos = mod(g('positioner', scene), 'positioner');
  cylinder(pos, 700, tt - 60, [0, (tt - 60) / 2, 0], P.paint, 'y', 48).name = 'turntable-base';
  const table = g('turntable', pos); table.userData.cableHost = false;
  cylinder(table, 900, 60, [0, tt - 30, 0], MAT.steelDark, 'y', 64).name = 'turntable-top';
  const locators = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, r = TANK.legs.footR;
    const lg = g('leg-locator', table); lg.position.set(r * Math.cos(a), tt, r * Math.sin(a)); lg.rotation.y = -a;
    for (const s of [-1, 1]) box(lg, [40, 60, 200], [s * (TANK.legs.plate / 2 + 22), 30, 0], P.yellow, 'locator');
    locators.push(lg);
  }
  box(pos, [400, 260, 400], [-900, 130, 700], MAT.steelDark, 'turntable-drive');

  // 立柱＋懸臂：懸臂沿立柱上下（Z），懸臂本身沿 X 伸縮；伸縮柱固定長度掛在懸臂前端。
  // 立柱偏在懸臂南側（z = colZ），懸臂從滑座框中穿過、往後伸時從立柱旁邊經過
  const colX = -3500, colZ = -650, colH = 5400, mastLen = 600;
  const col = mod(g('column', scene), 'column');
  box(col, [900, 60, 900], [colX, 30, colZ], MAT.steelDark, 'column-foot');
  box(col, [420, colH, 420], [colX, colH / 2, colZ], P.paint, 'column');
  box(col, [60, colH - 400, 40], [colX, colH / 2, colZ + 230], MAT.steel, 'column-rail');
  const boom = mod(g('boom', scene), 'boom'); boom.userData.cableHost = false;
  const slide = g('boom-slide', boom);
  // 滑座：靠立柱的連接座＋包住懸臂的方框（四片板，與懸臂留 10 mm）
  box(boom, [520, 520, 240], [colX, 0, colZ + 370], MAT.steelDark, 'boom-carriage');
  for (const [size, y, z] of [[[480, 30, 340], 155, 0], [[480, 30, 340], -155, 0], [[480, 280, 30], 0, -155], [[480, 280, 30], 0, 155]]) box(boom, size, [colX, y, z], MAT.steelDark, 'boom-guide');
  const boomLen = 3600;
  box(slide, [boomLen, 260, 260], [-boomLen / 2, 0, 0], P.paint, 'boom-beam');
  box(slide, [300, 120, 300], [0, -190, 0], MAT.steelDark, 'mast-head');
  box(slide, [200, mastLen, 200], [0, -250 - mastLen / 2, 0], P.paint, 'mast');
  box(slide, [260, 20, 260], [0, -260 - mastLen, 0], MAT.steel, 'mast-plate');
  const drop = 270 + mastLen;                                   // 懸臂中心 → 手臂基座面

  const rack = mod(g('tool-rack', scene), 'tool-rack');
  const per = periphery(scene, { x: -3900, z: 2300, curtain: [{ pos: [-1500, 0, 2000] }] });
  const crane = hook(scene);
  const lugR = 420, lugY = TANK.straight + 70;
  const updateDetails = addTurntableDetails({ pos, table, col, boom, slide, y0 });

  return {
    key: 'turntable', frameW, psi: -Math.PI / 2, rackPose: { r: 250, d: 700, Z: [0, 1, 0], X: [-1, 0, 0], lift: 'carrier', up: 380 },
    cut: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),                      // 保留後半（z ≤ 0）
    build(carrier, ctx) {
      slide.add(carrier); carrier.position.set(0, -drop, 0);
      ctx.slots = ctx.tools.map((_, i) => ({ s: 1300 + this.rackPose.d - y0, lat: -1150 - i * 240 }));   // 結合面高 1300
    },
    rackRoot: rack,
    setCarrier(s, lat) { boom.position.set(0, y0 + s + drop, 0); slide.position.x = lat; updateDetails(); },
    setSpin(phi, tank) { tank.spin.rotation.y = phi; table.rotation.y = phi; },
    setLoad({ k }, tank) {
      tank.frame.position.set(0, y0 + k * 1500, 0);
      const ly = y0 + lugY + k * 1500;
      crane.group.visible = k > .02;
      crane.set(new THREE.Vector3(0, ly + 1500, 0), [new THREE.Vector3(-lugR, ly, 0), new THREE.Vector3(lugR, ly, 0)]);
    },
    lugs: { r: lugR, y: lugY },
    periphery: per,
    views: {
      iso: [[-3600, 4600, 6600], [-900, 2000, 0]],
      inside: [[250, 2600, 2300], [0, 1750, -120]],
      weld: [[350, 2200, 1300], [0, 1650, -340]],
      rack: [[-1000, 2600, 2600], [-1600, 1500, -250]],
      top: [[-1300, 12000, 10], [-1300, 0, 0]],
    },
  };
}

// ================================================================ 方案 C：移動式門架（X 橫移＋Z 伸縮柱）＋COBOTTA PRO 900，桶不動
function planCobot(scene) {
  const y0 = 1 - TANK.legs.footY;                               // 桶腳站地面（底板離地 1 mm，避免與地坪重合面）
  const frameW = { pos: new THREE.Vector3(0, y0, 0), quat: new THREE.Quaternion() };
  floor(scene, { size: [13000, 8000], center: [600, 0], cell: 250 });
  const H = 5000, xs = [-2900, 1100], zs = [-1200, 1200], ramLen = 2300;
  const gantry = mod(g('gantry', scene), 'gantry'); gantry.userData.cableHost = false;
  for (const x of xs) for (const z of zs) {
    box(gantry, [180, H, 180], [x, H / 2 + 110, z], P.paint, 'gantry-post');
    cylinder(gantry, 55, 50, [x, 55, z + (z > 0 ? -60 : 60)], P.rubber, 'z', 24).name = 'caster';
  }
  const feet = [];
  for (const x of xs) for (const z of zs) { const f = box(gantry, [120, 80, 120], [x + (x > 0 ? -150 : 150), 150, z], MAT.steelDark, 'leveling-foot'); feet.push(f); }
  for (const z of zs) { box(gantry, [xs[1] - xs[0] + 180, 300, 260], [(xs[0] + xs[1]) / 2, H + 260, z], P.paint, 'side-beam'); box(gantry, [xs[1] - xs[0], 160, 160], [(xs[0] + xs[1]) / 2, 260, z], P.paint, 'base-rail'); }
  const cross = g('cross-carriage', gantry); cross.userData.cableHost = false;
  box(cross, [300, 260, zs[1] - zs[0] + 200], [0, H + 540, 0], P.paint, 'cross-beam');
  box(cross, [420, 300, 420], [0, H + 260, 0], MAT.steelDark, 'z-carriage');
  const ram = verticalCarrier(cross, { y0, ramLen, name: 'ram' });
  const rack = mod(g('tool-rack', scene), 'tool-rack');
  const per = periphery(scene, { x: -3400, z: 2600, curtain: [] });
  const updateDetails = addGantryDetails({ gantry, cross, ram, H, xs, zs });

  let gx = 0;
  return {
    key: 'cobot', frameW, psi: -Math.PI / 2, rackPose: { r: 250, d: 900, Z: [0, 1, 0], X: [-1, 0, 0], lift: 'carrier', up: 380 },
    cut: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
    build(carrier, ctx) {
      ram.add(carrier); carrier.position.set(0, 0, 0);
      ctx.slots = ctx.tools.map((_, i) => ({ s: 1300 + this.rackPose.d - y0, lat: -1100 - i * 240 }));
    },
    rackRoot: rack,
    setCarrier(s, lat) { cross.position.x = lat; ram.position.y = y0 + s; updateDetails(); },
    setSpin(phi, tank) { tank.spin.rotation.y = 0; },
    // 上料：門架從東側推進（k 1→0），定位腳下降（clamp）
    setLoad({ k, clamp }) { gantry.position.x = k * 4200; gx = k; for (const f of feet) f.position.y = 150 - clamp * 85; },
    periphery: per,
    views: {
      iso: [[-3200, 5200, 7400], [-300, 2200, 0]],
      inside: [[250, 2300, 2300], [0, 1450, -120]],
      weld: [[350, 1900, 1300], [0, 1350, -340]],
      rack: [[-900, 2700, 2700], [-1500, 1500, -250]],
      top: [[0, 13000, 10], [0, 0, 0]],
    },
  };
}

export function buildPlan(key, scene) {
  return key === 'turntable' ? planTurntable(scene) : key === 'cobot' ? planCobot(scene) : planRoll(scene);
}
