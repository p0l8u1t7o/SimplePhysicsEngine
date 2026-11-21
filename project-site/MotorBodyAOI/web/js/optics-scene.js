// 相機（含 XYZ＋傾角調整座）、反射鏡探頭、P0 定位相機、光源、視錐與照射範圍、選配雷射、三色燈與 HMI。相機位姿由 optics-plan.js（工件座標）換到世界座標。
import * as THREE from 'three';
import { block } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { visionCamera, laserProfiler } from '@core/models/vision.js';
import { barLight } from '@core/models/lights.js';
import { signalTower, hmi } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { tagPart } from '@core/models/parts.js';
// 元件編號（成本表 bom.json 匯入後由平台編號；core 的 bom 檢查以 partRef 對照）
export const PART = { cam5: 'P-00262', cam16: 'P-00263', bar: 'P-00270', tower: 'P-00084', hmi: 'P-00221', curtain: 'P-00081' };
import { CAMERAS, LASERS, LOCATOR, derive, lightPoints, realCamera } from './optics-plan.js';
import { LINE, POCKET, orientQ, partToWorld, stationCenter } from './machine.js';

export const STATION_OF = { ST1: 1, ST2: 3 };
export const STATION_COLOR = { ST1: 0x3d8bfd, ST2: 0xf08c2e };
export const CAMERA_COLOR = { C0: 0x20c997, 'C1-1': 0x3d8bfd, 'C1-2': 0x22b8cf, 'C1-3': 0x7a5cff, 'C1-4': 0xf2c230, 'C2-1': 0xf08c2e, 'C2-2': 0xe8590c, 'C2-4': 0xd6336c };
const dirToWorld = (v, pose) => new THREE.Vector3(...v).applyQuaternion(orientQ(pose));
export const fxMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
// 效果物件（視錐、照射範圍）：不是實體，全場干涉檢查略過
export const markFx = o => { o.traverse(m => { Object.assign(m.userData, { fx: true }); if (m.isMesh || m.isLine) m.renderOrder = 5; }); return o; };

// 兩點之間的截錐（照射範圍）：a 端半徑 ra、b 端半徑 rb，開口
export function beam(parent, a, b, ra, rb, color, opacity = .1) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 28, 1, true), fxMat(color, opacity));
  m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m); return m;
}
// 視錐：相機位置 → 景深遠端的視野矩形（半透明面＋邊線）＋工作距離處的視野框
export function frustum(parent, pos, fwd, right, up, wd, fovW, fovH, far, color) {
  const k = far / wd, corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
    pos.clone().addScaledVector(fwd, far).addScaledVector(right, sx * fovW / 2 * k).addScaledVector(up, sy * fovH / 2 * k));
  const tri = [], line = [];
  for (let i = 0; i < 4; i++) { const p = corners[i], q = corners[(i + 1) % 4]; tri.push(...pos.toArray(), ...p.toArray(), ...q.toArray()); line.push(...pos.toArray(), ...p.toArray(), ...p.toArray(), ...q.toArray()); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  parent.add(new THREE.Mesh(g, fxMat(color, .06)));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(line, 3));
  parent.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .5, depthWrite: false })));
  const rect = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([sx, sy]) => pos.clone().addScaledVector(fwd, wd).addScaledVector(right, sx * fovW / 2).addScaledVector(up, sy * fovH / 2));
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rect), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95, depthWrite: false })));
}

// 相機調整座：相機機身後方一組 XYZ 手動微調台（±12.5 mm，附刻度與鎖緊）＋傾角台（±15°）＋立柱（接到頂框；ST1 下方的相機接到挖空區底部）。
//   調好後打定位銷，拆修後可復位。back：鏡頭前緣到機身後端的距離
export function addMount(parent, name, pos, fwd, back, { yEnd = LINE.frameH - 80, toX = null, gap = 22 } = {}) {
  const m = new THREE.Group(); m.name = name; parent.add(m);
  const c = pos.clone().addScaledVector(fwd, -(back + gap));
  const up = yEnd > c.y ? 1 : -1;
  block(m, [44, 16, 44], [c.x, c.y, c.z], MAT.alu);                                   // 傾角台
  for (let k = 0; k < 3; k++) block(m, [64, 9, 64], [c.x, c.y + up * (13 + k * 10), c.z], k % 2 ? MAT.steelDark : MAT.alu);   // XYZ 微調台（三層）
  const y0 = c.y + up * 42;
  block(m, [30, Math.abs(yEnd - y0), 30], [c.x, (y0 + yEnd) / 2, c.z], MAT.frame);       // 立柱（鋁擠型，粗調高度）
  if (toX != null) block(m, [Math.abs(toX - c.x), 30, 30], [(toX + c.x) / 2, yEnd - 15, c.z], MAT.frame);   // 橫臂（接到側框）
  return m;
}

// 一台相機（一筆拍攝設定）：相機本體＋XYZ 調整座、光源、視錐與照射範圍、反射鏡探頭。W／D：工件座標的點／方向 → 世界。
//   withBody：建相機本體與調整座（同一台實體相機的第二筆設定只加光源）；withFrustum：畫視錐；mount：調整座立柱參數；probe：反射鏡探頭支柱走線
export function buildCameraUnit({ scene, g, mounts, viz, cam, W, D, color, name = cam.id, withBody = true, withFrustum = true, mount = {}, probe = {} }) {
  const dv = derive(cam), rc = realCamera(cam, dv);
  // 實際相機（反射鏡相機在杯口下方往上看）；pos/fwd/right/up 是鏡中的虛像相機（正對檢測面）
  const realPos = W(rc.pos), realFwd = D(rc.fwd), realUp = D(rc.up);
  const pos = W(dv.pos), fwd = D(dv.fwd);
  const right = D(dv.right), up = D(dv.up);
  const vfov = 2 * Math.atan(dv.fovH / 2 / dv.wd) * 180 / Math.PI, big = cam.sensor === '5MP';
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), realFwd);
  const upLocal = realUp.clone().applyQuaternion(q.clone().invert());
  const lensL = cam.f >= 35 ? 58 : 44, bodyL = big ? 52 : 40;
  const vc = !withBody ? null : visionCamera.create({
    name: `camera-${name}`, bodyW: big ? 44 : 30, bodyD: big ? 44 : 30, bodyL, lensR: big ? 19 : 15, lensL,
    ringR: ['lensRing', 'psSide'].includes(cam.light.kind) ? cam.light.r : 0, fov: vfov,
    view: { fov: vfov, aspect: dv.fovW / dv.fovH, near: 5, far: 3000, up: upLocal.toArray() },
  });
  if (vc) { vc.root.position.copy(realPos); vc.root.quaternion.copy(q); g.add(vc.root); tagPart(vc, big ? PART.cam5 : PART.cam16); }
  if (withBody) addMount(mounts, `mount-${name}`, realPos, realFwd, lensL + bodyL, mount);
  // 相機視窗用的虛擬相機：反射鏡相機改用鏡中的虛像相機，近裁切面放在鏡面之後（只看到鏡子映出的內壁）
  let viewCam = vc?.camera ?? null, probeBar = null;
  if (cam.mirror) {
    viewCam = new THREE.PerspectiveCamera(vfov, dv.fovW / dv.fovH, dv.wd - 10, 3000);
    viewCam.position.copy(pos); viewCam.up.copy(up); viewCam.lookAt(pos.clone().add(fwd)); g.add(viewCam);
  }
  const vg = new THREE.Group(); vg.name = `viz-${cam.id}`; viz.add(vg);
  if (!withFrustum) { /* 同一台實體相機的第二筆設定：視錐已由第一筆畫過 */ } else if (!cam.mirror) frustum(vg, pos, fwd, right, up, dv.wd, dv.fovW, dv.fovH, dv.wd + Math.min(dv.dof, 60) / 2, color);
  else {
    // 兩段視錐：實際相機 → 鏡面，鏡面 → 內壁
    const mp = W(cam.mirror.point), mn = D(cam.mirror.normal);
    const pts = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const dir = fwd.clone().multiplyScalar(dv.wd).addScaledVector(right, sx * dv.fovW / 2).addScaledVector(up, sy * dv.fovH / 2).normalize();
      const t = mp.clone().sub(pos).dot(mn) / dir.dot(mn), hit = pos.clone().addScaledVector(dir, t), wall = pos.clone().addScaledVector(dir, dv.wd);
      pts.push([hit, wall]);
    }
    const seg = [];
    for (let i = 0; i < 4; i++) { const [h, w] = pts[i], [h2, w2] = pts[(i + 1) % 4]; seg.push(realPos, h, h, w, h, h2, w, w2); }
    vg.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8, depthWrite: false })));
    probeBar = buildProbe(scene, cam, W, D, probe);
  }
  // 光源本體與照射範圍
  const L = cam.light, target = W(cam.target), lights = [];
  const lpts = lightPoints(cam, dv).map(W);
  const RL = L.kind === 'ring' ? L : L.aux;
  if (RL?.kind === 'ring') {
    const ring = new THREE.Group(); ring.name = `ps-ring-${cam.id}`; g.add(ring);
    const c0 = W([RL.center[0], RL.center[1], RL.at]); ring.position.copy(c0);
    for (let k = 0; k < RL.segments; k++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(RL.r, 9, 10, 24, Math.PI * 2 / RL.segments - .06), std(0xf4f6f8, .4, 0, { emissive: 0xffffff, emissiveIntensity: .05 }));
      m.name = `ps-segment-${k}`; m.rotation.x = Math.PI / 2; m.rotation.z = k * Math.PI * 2 / RL.segments + .03; ring.add(m); lights.push(m);
    }
    for (const s of [-1, 1]) block(ring, [16, 70, 16], [s * RL.r, 44, 0], MAT.alu);   // 吊架（高度可調）
    beam(vg, c0, W([0, 0, -63.5]), RL.r, 62, 0xfff3c4, .07);
  }
  if (L.kind === 'sectorBars') {
    // 扇區切向條形光：0° 方位扇區左右各一支，沿刀紋（圓周）方向打
    const aim = W([38, 0, cam.target[2]]);
    L.bars.forEach(([a, b], k) => {
      const p = W(a.map((v, i) => (v + b[i]) / 2));
      const bar = barLight.create({ length: 56, w: 30, h: 26, lensW: 24, lensT: 4 });
      bar.root.name = `bar-${cam.id}-${k}`; bar.root.position.copy(p);
      bar.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.clone().sub(p).normalize());
      g.add(bar.root); tagPart(bar, PART.bar); lights.push(bar);
      beam(vg, p, aim, 14, 24, 0xfff3c4, .06);
    });
  } else if (L.kind === 'coaxial') {
    const box = new THREE.Group(); box.name = `coaxial-${cam.id}`; g.add(box);
    const c0 = realPos.clone().addScaledVector(realFwd, 95); box.position.copy(c0); box.quaternion.copy(q);
    block(box, [120, 110, 120], [0, 0, 0], MAT.black);
    lights.push(block(box, [104, 3, 104], [0, -56.5, 0], std(0xfff8e0, .3, 0, { emissive: 0xfff3c4, emissiveIntensity: .1 })));
    beam(vg, c0.clone().addScaledVector(realFwd, 58), target, 50, 48, 0xfff3c4, .08);
  } else if (L.kind === 'lensRing' && !cam.mirror) {
    beam(vg, realPos, target, L.r, dv.fovH / 2, 0xfff3c4, .06);
  }
  if (L.kind === 'bar' || L.kind === 'psSide') {
    // 條形光：每支一盞 core 條形光，發光面朝目標（psSide 是目標左右兩支，另有鏡頭環形光）
    const pts = L.kind === 'bar' ? [lpts[2]] : [lpts[1], lpts[4]];
    pts.forEach((p, k) => {
      const bar = barLight.create({ length: L.kind === 'bar' ? L.length : 70, w: 30, h: 26, lensW: 24, lensT: 4 });
      bar.root.name = `bar-${cam.id}-${k}`; bar.root.position.copy(p);
      bar.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(p).normalize());
      g.add(bar.root); tagPart(bar, PART.bar); lights.push(bar);
      beam(vg, p, target, 14, L.kind === 'bar' ? 22 : 26, 0xfff3c4, .06);
    });
    if (L.kind === 'psSide') beam(vg, realPos, target, L.r, dv.fovH / 2, 0xfff3c4, .05);
  }
  if (probeBar) lights.push(probeBar);
  return { cam, dv, vc, viewCam, pos: realPos, fwd: realFwd, right, up, target, lights, viz: vg };
}

export function buildOptics(scene) {
  const g = new THREE.Group(); g.name = 'optics'; scene.add(g);
  const mounts = new THREE.Group(); mounts.name = 'camera-mounts'; scene.add(mounts);
  const viz = new THREE.Group(); viz.name = 'optics-viz'; scene.add(viz);
  const cams = {};
  for (const cam of CAMERAS) {
    const center = stationCenter(STATION_OF[cam.station]);
    cams[cam.id] = buildCameraUnit({
      scene, g, mounts, viz, cam, color: CAMERA_COLOR[cam.id],
      W: p => partToWorld(p, cam.station, center), D: v => dirToWorld(v, cam.station).normalize(),
      mount: cam.mirror ? { yEnd: POCKET.floor } : {}, probe: { yBot: 760, zWall: POCKET.z1, stemTop: [-27, 0, -18] },
    });
    cams[cam.id].station = cam.station;
  }
  // P0 定位相機（判角＋讀 QR）：俯視整顆，輸送帶滾筒下方加背光（只畫相機與環形光）
  const lc = LOCATOR, lm = 7.07 / lc.fovH, top = LINE.band + 38.5;   // ST1 姿態工件頂（法蘭側止口端）
  const lwd = lc.f * (1 + lm) / lm, lpos = new THREE.Vector3(LINE.x[0], top + lwd, 0);
  const locator = visionCamera.create({ name: 'camera-C0', bodyW: 44, bodyD: 44, bodyL: 52, lensR: 19, lensL: 44, ringR: 70, fov: 2 * Math.atan(lc.fovH / 2 / lwd) * 180 / Math.PI });
  locator.root.position.copy(lpos); g.add(locator.root); tagPart(locator, PART.cam5);
  addMount(mounts, 'mount-C0', lpos, new THREE.Vector3(0, -1, 0), 96, { yEnd: LINE.frameH - 40, toX: -LINE.len / 2 + 20 });
  const lg = new THREE.Group(); lg.name = 'viz-C0'; viz.add(lg);
  frustum(lg, lpos, new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), lwd, lc.fovH * 1.2, lc.fovH, lwd + 20, CAMERA_COLOR.C0);
  markFx(viz);
  // 選配：3D 雷射輪廓（預設隱藏；放在頂視視錐外，斜照外側平面）
  const opt = new THREE.Group(); opt.name = 'option-laser'; opt.visible = false; scene.add(opt);
  Object.assign(opt.userData, { noBom: '選配：3D 雷射輪廓打樣後才決定是否採用，不列入本成本表' });
  for (const L of LASERS) {
    const pose = L.station, center = stationCenter(STATION_OF[pose]);
    const faceZ = pose === 'ST1' ? -63.5 : -4, sgn = pose === 'ST1' ? -1 : 1;
    const head = partToWorld([-75, 0, faceZ + sgn * 200], pose, center), aim = partToWorld([-50, 0, faceZ], pose, center);
    const p = laserProfiler.create({ name: `laser-${L.id}` }); p.root.position.copy(head);
    p.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), aim.clone().sub(head).normalize());
    opt.add(p.root);
  }
  return { group: g, viz, cams, locator, options: opt };
}

// 反射鏡探頭（固定不動）：45° 表面鍍膜反射鏡＋鏡背支架＋支柱。全部在工件座標下定義再換到世界（W、D）。
//   固定方案（ST1）：支柱從鏡背往杯口方向穿過中空 DD，到 yBot 轉成橫臂接到挖空區側壁（zWall）；手臂方案：直接落到相機井底板（zWall 不給）
//   out：{ dir:[x,z]（世界水平方向）, len, yFloor }：支柱到 yBot 後水平往外 len，再落到 yFloor（避開正下方的相機與調整座）
function buildProbe(scene, cam, W, D, { yBot = 760, zWall = null, stemTop: st = [-27, 0, -18], out = null } = {}) {
  const g = new THREE.Group(); g.name = 'probe'; scene.add(g);
  const m = cam.mirror;
  const n = new THREE.Vector3(...m.normal), v = new THREE.Vector3(0, 1, 0), u = new THREE.Vector3().crossVectors(n, v);
  const basis = new THREE.Matrix4().makeBasis(D(u.toArray()), D(v.toArray()), D(n.toArray()));
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(m.halfU * 2, m.halfV * 2, 3), std(0xdfe8ef, .05, 1));
  mirror.name = 'probe-mirror'; mirror.position.copy(W(m.point.map((x, i) => x - m.normal[i] * 1.6))); mirror.quaternion.setFromRotationMatrix(basis); g.add(mirror);
  // 鏡背支架：從支柱頂端斜接到鏡背中心（都在鏡面背側，不擋光路）
  const back = W(m.point.map((x, i) => x - m.normal[i] * 8)), stemTop = W(st);
  const br = new THREE.Mesh(new THREE.BoxGeometry(10, 10, back.distanceTo(stemTop)), MAT.steelDark);
  br.position.copy(back).add(stemTop).multiplyScalar(.5); br.lookAt(back); g.add(br);
  // 支柱：工件座標 x −27，從鏡背高度往杯口方向（世界往下）
  const yTop = stemTop.y;
  block(g, [14, yTop - yBot, 14], [stemTop.x, (yTop + yBot) / 2, stemTop.z], MAT.steelDark);
  if (zWall != null) block(g, [14, 14, zWall - stemTop.z], [stemTop.x, yBot + 7, (stemTop.z + zWall) / 2], MAT.steelDark);
  if (out) {
    const a = new THREE.Vector3(stemTop.x, yBot + 7, stemTop.z), d = new THREE.Vector3(out.dir[0], 0, out.dir[1]).normalize(), b = a.clone().addScaledVector(d, out.len);
    const h = new THREE.Mesh(new THREE.BoxGeometry(14, 14, out.len + 14), MAT.steelDark); h.position.copy(a).add(b).multiplyScalar(.5); h.lookAt(b); h.castShadow = true; g.add(h);
    block(g, [14, yBot - out.yFloor, 14], [b.x, (yBot + out.yFloor) / 2, b.z], MAT.steelDark);
  }
  // 探頭條形光：杯口外、近側斜照內壁（暗場），裝在支柱旁的小支架上
  const L = cam.light, a = W(L.a), b = W(L.b), mid = a.clone().add(b).multiplyScalar(.5);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(a.distanceTo(b) + 6, 8, 8), std(0xfff8e0, .3, 0, { emissive: 0xfff3c4, emissiveIntensity: .1 }));
  bar.name = 'probe-bar-light'; bar.position.copy(mid); bar.lookAt(mid.clone().add(b.clone().sub(a).normalize().cross(new THREE.Vector3(0, 1, 0)))); g.add(bar);
  if (Math.abs(mid.x - stemTop.x) < 1) block(g, [8, 8, Math.abs(mid.z - stemTop.z)], [mid.x, mid.y - 8, (mid.z + stemTop.z) / 2], MAT.steelDark);
  else {
    // 支架不沿世界軸（手臂方案）：從光源下方水平斜接到支柱
    const a2 = new THREE.Vector3(mid.x, mid.y - 8, mid.z), b2 = new THREE.Vector3(stemTop.x, mid.y - 8, stemTop.z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(8, 8, a2.distanceTo(b2)), MAT.steelDark);
    arm.position.copy(a2).add(b2).multiplyScalar(.5); arm.lookAt(b2); arm.castShadow = arm.receiveShadow = true; g.add(arm);
  }
  return bar;
}

export function buildIndicators(scene) {
  const g = new THREE.Group(); g.name = 'indicators'; scene.add(g);
  const tower = signalTower.create({ poleH: 260 }); tower.root.position.set(LINE.len / 2 - 60, LINE.frameH, -LINE.depth / 2 - 30); g.add(tower.root); tagPart(tower, PART.tower);
  const panel = hmi.create({ display: true }); panel.root.position.set(LINE.len / 2 + 520, 1350, LINE.depth / 2 + 120); panel.root.rotation.y = -Math.PI / 6; g.add(panel.root); tagPart(panel, PART.hmi);   // 出料端外側（前方），不擋各站視角
  // 前方開口（移載側）的安全光柵：裝在機台前緣，兩支在框架立柱外側
  const curtain = lightCurtain.create({ span: LINE.len - 40, height: 900, beam: {} });
  curtain.root.position.set(0, LINE.table, LINE.depth / 2 - 25); g.add(curtain.root); tagPart(curtain, PART.curtain);
  return { group: g, tower, panel, curtain };
}
