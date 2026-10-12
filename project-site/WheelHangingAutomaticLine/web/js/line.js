// 吊掛線（清洗線下段）與取像區固定設施：I 型鋼軌道＋支架、C 型吊鉤（台車＋吊桿）、掛在吊鉤上的輪框、
// 到位光電、線速編碼器、防擺導軌、消光黑背板、固定面光源（偏光膜）。
// 吊鉤以全域編號 j 排列：x_j(t) = X0 − j·pitch + v·t（j = 0、1、2 是動畫示範的三個輪框）；場景只畫 LINE.hooks 個吊鉤物件，
// 每個物件在任一時刻顯示「落在畫面範圍內、編號同餘」的那一個吊鉤，所以狀態只由時間決定。
import * as THREE from 'three';
import { block, cylinder, rod, plate } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { rotaryEncoder } from '@core/models/motion.js';
import { boxSensor } from '@core/models/sensors.js';
import { barLight } from '@core/models/lights.js';
import { tagPart } from '@core/models/parts.js';
import { createWheel } from './wheel.js';
import { LINE, PICK, WHEELS, hangY } from './layout.js';

export const X0 = 920;                      // 第 0 個示範輪框在 t = 0 的位置（剛進追蹤窗）
const SPAN = LINE.hooks * LINE.pitch;      // 畫面內吊鉤循環的長度（＝ LINE.x 範圍）
export const hookX = (j, t) => X0 - j * LINE.pitch + LINE.v * t;
// 吊鉤 j 掛的款式：j < 0 已被取走（空鉤）；0、1 是 A 款；2 起換成 B 款（換款示範）
export const modelOf = j => j < 0 ? null : j < 2 ? 'A' : 'B';
export const DEMO = [0, 1, 2];             // 示範輪框的吊鉤編號（由 project.js 另外建立、可被手臂取走）

const UHMW = std(0xf2f2ea, .8, 0), MATTE = std(0x0b0d10, .98, 0);

function createHook(name) {
  const g = new THREE.Group(); g.name = name;
  const z0 = 0, dz = LINE.rodZ - LINE.z, top = LINE.railY - 4;
  block(g, [180, 80, 140], [0, top - 40, z0], MAT.steelDark).name = 'hook trolley';
  const rollers = [];
  for (const s of [-1, 1]) for (const side of [-1, 1]) {
    const r = new THREE.Group(); r.position.set(s * 60, top - 40, side * 80); g.add(r);
    cylinder(r, 22, 20, [0, 0, 0], MAT.black, 'z', 16).name = 'hook trolley roller';
    block(r, [24, 4, 1], [0, 0, side * 11], MAT.alu).name = 'roller index'; rollers.push(r);
  }
  const tag = plate(g, ['#101'], 130, 70, [85, 2690, 12]);
  block(g, [132, 72, 4], [85, 2690, 9], MAT.steelDark).name = 'hook number plate';
  block(g, [70, 12, 12], [25, 2690, 0], MAT.steelDark).name = 'hook tag bracket';
  const pts = [[0, top - 80, z0], [0, 2830, z0], [0, 2760, dz], [0, LINE.barY + 40, dz], [0, LINE.barY, dz + 40], [0, LINE.barY, LINE.barEnd], [0, LINE.barY + LINE.tip, LINE.barEnd + 14]];
  const names = ['hook drop', 'hook offset', 'hook rod', 'hook bend', 'hook bar', 'hook tip'];
  for (let i = 0; i < pts.length - 1; i++) rod(g, new THREE.Vector3(...pts[i]), new THREE.Vector3(...pts[i + 1]), i === 4 ? LINE.barR : 10, MAT.chrome, 14).name = names[i];
  pts.slice(1, -1).forEach((p, i) => { const k = new THREE.Mesh(new THREE.SphereGeometry(i >= 3 ? LINE.barR : 10, 14, 10), MAT.chrome); k.position.set(...p); k.name = 'hook joint'; g.add(k); });
  // 吊桿 PU 護套（接觸中心孔的那段，避免刮傷）
  cylinder(g, LINE.sleeveR, 120, [0, LINE.barY, 10], std(0x2c5f8a, .7, 0), 'z', 16).name = 'hook sleeve';
  // 每個吊鉤物件帶 A、B 兩款輪框，依吊鉤編號切換顯示
  const wheels = {};
  for (const [key, spec] of Object.entries(WHEELS)) if (key !== 'C') {
    const w = createWheel(spec, `hook wheel ${key}`); w.position.set(0, hangY(spec), 0); g.add(w); wheels[key] = w;
  }
  return { root: g, wheels, rollers, tag };
}

export function createLine(scene) {
  const line = new THREE.Group(); line.name = 'hanging line'; scene.add(line);
  const [x0, x1] = LINE.x, L = x1 - x0, xc = (x0 + x1) / 2, Y = LINE.railY;
  // ---- I 型鋼軌道（下翼板是台車行走面）
  block(line, [L, 10, 110], [xc, Y + 5, LINE.z], MAT.steel).name = 'rail bottom flange';
  block(line, [L, 180, 10], [xc, Y + 100, LINE.z], MAT.steel).name = 'rail web';
  block(line, [L, 12, 110], [xc, Y + 196, LINE.z], MAT.steel).name = 'rail top flange';
  // ---- 支架：北側立柱（圍籬外）＋懸臂，懸臂延伸到南側掛光源樑
  const CZ = -2500;                                      // 立柱在圍籬外（北）
  for (const x of [-3600, -600, 2400, 5400]) {
    block(line, [200, 3320, 200], [x, 1680, CZ], MAT.steelBlue).name = 'line column';
    block(line, [160, 160, -500 - CZ + 100], [x, 3420, (CZ - 100 - 500) / 2], MAT.steelBlue).name = 'line arm';
    block(line, [60, 18, 160], [x, Y + 211, LINE.z], MAT.steelDark).name = 'rail hanger plate';
    block(line, [40, 120, 40], [x, Y + 280, LINE.z], MAT.steelDark).name = 'rail hanger';
    block(line, [500, 20, 500], [x, 10, CZ], MAT.steelDark).name = 'line column foot';
  }
  // ---- 吊鉤
  const hooks = Array.from({ length: LINE.hooks }, (_, s) => { const h = createHook(`hook ${s}`); line.add(h.root); return h; });

  // ---- 取像區：防擺導軌（夾住吊桿垂直段）、消光黑背板、固定面光源
  const zone = new THREE.Group(); zone.name = 'pick zone'; scene.add(zone);
  const G = PICK.guide, gl = G.x[1] - G.x[0], gx = (G.x[0] + G.x[1]) / 2;
  for (const s of [-1, 1]) {
    block(zone, [gl, 60, 20], [gx, G.y, LINE.rodZ + s * (G.gap / 2 + 10)], UHMW).name = 'anti-sway guide';
    // 入口喇叭口（上游端往外張）
    const flare = block(zone, [300, 60, 20], [G.x[0] - 140, G.y, LINE.rodZ + s * (G.gap / 2 + 10 + 40)], UHMW); flare.rotation.y = s * .27; flare.name = 'anti-sway guide flare';
  }
  // 導軌吊架（吊鉤從兩支導軌中間通過，吊架不能跨過吊桿）：北側導軌由懸臂直接吊下；
  // 南側導軌用 L 型架：吊桿在台車南側 200 mm 垂下，再往北接到導軌外側（高度在吊鉤斜段下方、輪框上方）
  for (const x of [-600, 2400]) {
    const zn = LINE.rodZ - G.gap / 2 - 20 - 20, zs = LINE.rodZ + G.gap / 2 + 20, armY = G.y + 70;
    block(zone, [40, 3340 - G.y + 30, 40], [x, (3340 + G.y - 30) / 2, zn], MAT.steelDark).name = 'guide hanger';
    block(zone, [40, 3340 - armY + 20, 40], [x, (3340 + armY - 20) / 2, -1100], MAT.steelDark).name = 'guide hanger south';
    block(zone, [40, 40, -1100 - zs + 20], [x, armY, (-1100 + 20 + zs) / 2], MAT.steelDark).name = 'guide hanger arm';
    block(zone, [40, 40 + 30, 30], [x, G.y + 35, zs + 15], MAT.steelDark).name = 'guide hanger drop';
  }
  const B = PICK.backdrop;
  block(zone, [B.x[1] - B.x[0], B.y[1] - B.y[0], 12], [(B.x[0] + B.x[1]) / 2, (B.y[0] + B.y[1]) / 2, B.z], MATTE).name = 'matte backdrop';
  for (const x of [B.x[0] + 60, B.x[1] - 60]) {
    block(zone, [60, B.y[1] - 12, 60], [x, (B.y[1] + 12) / 2, B.z - 42], MAT.steelDark).name = 'backdrop post';
    block(zone, [300, 12, 300], [x, 6, B.z - 40], MAT.steelDark).name = 'backdrop foot';
  }
  // 光源樑（沿 X）：由兩支懸臂延伸段吊下；面光源 300 × 300（525 nm＋偏光膜），斜向照輪面
  const beamY = 2780, beamZ = -880;
  block(zone, [3300, 80, 80], [900, beamY, beamZ], MAT.frame).name = 'light beam';
  for (const x of [-600, 2400]) block(zone, [50, 3340 - beamY - 40, 50], [x, (3340 + beamY + 40) / 2, beamZ], MAT.steelDark).name = 'light beam hanger';
  const target = new THREE.Vector3(0, hangY(WHEELS.A), LINE.z + 60);
  const lights = PICK.lights.map((p, i) => {
    const l = barLight.create({ length: 300, w: 300, h: 45, lensW: 290, lensT: 6, axis: 'z', name: `area light ${i}` });
    const d = target.clone().setX(p.x).sub(new THREE.Vector3(p.x, p.y, p.z));
    l.root.position.set(p.x, p.y, p.z); l.root.rotation.x = Math.atan2(-d.z, -d.y); zone.add(l.root);
    // 托架：樑下兩支短吊桿
    for (const s of [-1, 1]) block(zone, [20, beamY - 40 - p.y - 30, 20], [p.x + s * 120, (beamY - 40 + p.y + 30) / 2, beamZ], MAT.steelDark).name = 'light bracket';
    tagPart(l, 'AREA-LIGHT-525');
    l.lens.material.color.set(0x9cf6b6); l.lens.material.emissive.set(0x54ff82);
    return l;
  });
  // ---- 到位光電（上游，回歸反射：南側投受光、北側反射板）、線速編碼器
  const sensor = boxSensor.create({ w: 40, h: 60, d: 50, name: 'arrival sensor' });
  sensor.root.position.set(PICK.sensorX, 1500, -640); zone.add(sensor.root);
  block(zone, [50, 1470, 50], [PICK.sensorX, 735, -600], MAT.steelDark).name = 'sensor post';
  block(zone, [80, 80, 6], [PICK.sensorX, 1500, -1900], std(0xd03a2a, .5, 0)).name = 'reflector';
  block(zone, [50, 1460, 50], [PICK.sensorX, 730, -1940], MAT.steelDark).name = 'reflector post';
  const beam = cylinder(zone, 3, 1250, [PICK.sensorX, 1500, -1265], new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: .45, depthWrite: false }), 'z', 6);
  beam.name = 'arrival beam'; beam.userData.fx = true;
  const enc = rotaryEncoder.create({ bodyR: 30, bodyL: 60, axis: 'z', name: 'line encoder' });
  enc.root.position.set(PICK.encoderX, Y + 100, LINE.z + 130); line.add(enc.root);
  block(line, [90, 120, 86], [PICK.encoderX, Y + 100, LINE.z + 5 + 43], MAT.steelDark).name = 'encoder bracket';
  const measuring = new THREE.Group(); measuring.name = 'encoder measuring wheel';
  measuring.position.set(PICK.encoderX, Y + 100, LINE.z + 260); line.add(measuring);
  cylinder(measuring, 70, 16, [0, 0, 0], MAT.black, 'z', 32).name = 'encoder rubber wheel';
  block(measuring, [95, 6, 2], [0, 0, 10], MAT.alu).name = 'encoder index';
  cylinder(line, 8, 110, [PICK.encoderX, Y + 100, LINE.z + 205], MAT.chrome, 'z', 16).name = 'encoder wheel axle';
  const chain = Array.from({ length: Math.floor(L / 50) }, (_, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(8, 2, 6, 10), MAT.steelDark);
    m.scale.x = 2.4; m.rotation.x = i % 2 ? Math.PI / 2 : 0; m.name = 'drive chain link'; line.add(m); return m;
  });
  plate(scene, ['吊掛線 4 cm/s →'], 900, 160, [2400, 20, LINE.z + 520], 0);

  const _hit = { j: null };
  // 回傳畫面內每個吊鉤物件此刻代表的吊鉤編號（給 project.js 判斷到位光電）
  function set(t) {
    hooks.forEach((h, s) => {
      // 找 j ≡ s (mod hooks)，使 x_j(t) 落在 [x0, x0 + SPAN)
      const base = hookX(s, t), n = Math.floor((base - x0) / SPAN), j = s + n * LINE.hooks, x = hookX(j, t);
      h.root.position.set(x, 0, LINE.z); h.j = j;
      h.rollers.forEach(r => { r.rotation.z = -LINE.v * t / 22; });
      if (h.tag && h.tag.userData.hookNumber !== j + 101) {
        const image = h.tag.material.map.image, ctx = image?.getContext?.('2d');
        if (ctx) { ctx.fillStyle = '#e9edf0'; ctx.fillRect(0, 0, image.width, image.height); ctx.fillStyle = '#1d2833'; ctx.font = 'bold 80px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`#${j + 101}`, image.width / 2, image.height / 2); h.tag.material.map.needsUpdate = true; }
        h.tag.userData.hookNumber = j + 101;
      }
      const m = modelOf(j);
      for (const [k, w] of Object.entries(h.wheels)) w.visible = m === k && !DEMO.includes(j);
    });
    measuring.rotation.z = -LINE.v * t / 70;
    chain.forEach((m, i) => { m.position.set(x0 + ((i * 50 + LINE.v * t) % L), Y + 20, LINE.z + 260); });
    return hooks;
  }
  set(0);
  return { root: line, zone, hooks, lights, sensor, beam, encoder: enc, measuring, chain, set, _hit };
}
