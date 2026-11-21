// 相機、光源、視錐與照射範圍、選配雷射、讀碼器、三色燈與 HMI。相機位姿由 optics-plan.js（工件座標）換到世界座標。
import * as THREE from 'three';
import { block } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { visionCamera, codeReader, laserProfiler } from '@core/models/vision.js';
import { barLight } from '@core/models/lights.js';
import { signalTower, hmi } from '@core/models/indicators.js';
import { lightCurtain } from '@core/models/sensors.js';
import { tagPart } from '@core/models/parts.js';
// 元件編號（成本表 bom.json 匯入後由平台編號；core 的 bom 檢查以 partRef 對照）
export const PART = { cam5: 'P-00262', cam16: 'P-00263', bar: 'P-00270', reader: 'P-00048', tower: 'P-00084', hmi: 'P-00221', curtain: 'P-00081' };
import { CAMERAS, LASERS, derive, lightPoints } from './optics-plan.js';
import { LINE, orientQ, partToWorld, stationCenter } from './machine.js';

export const STATION_OF = { ST1: 1, ST2: 3 };
export const STATION_COLOR = { ST1: 0x3d8bfd, ST2: 0xf08c2e };
export const CAMERA_COLOR = { 'C1-1': 0x3d8bfd, 'C1-2': 0x22b8cf, 'C1-3': 0x7a5cff, 'C2-1': 0xf08c2e, 'C2-2': 0xe8590c, 'C2-3': 0xf2c230, 'C2-4': 0xd6336c, 'C2-5': 0x40c057 };
const dirToWorld = (v, pose) => new THREE.Vector3(...v).applyQuaternion(orientQ(pose));
const fxMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
// 效果物件（視錐、照射範圍）：不是實體，全場干涉檢查略過
const markFx = o => { o.traverse(m => { Object.assign(m.userData, { fx: true }); if (m.isMesh || m.isLine) m.renderOrder = 5; }); return o; };

// 兩點之間的截錐（照射範圍）：a 端半徑 ra、b 端半徑 rb，開口
function beam(parent, a, b, ra, rb, color, opacity = .1) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 28, 1, true), fxMat(color, opacity));
  m.position.copy(a).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m); return m;
}
// 視錐：相機位置 → 景深遠端的視野矩形（半透明面＋邊線）＋工作距離處的視野框
function frustum(parent, pos, fwd, right, up, wd, fovW, fovH, far, color) {
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

export function buildOptics(scene) {
  const g = new THREE.Group(); g.name = 'optics'; scene.add(g);
  const viz = new THREE.Group(); viz.name = 'optics-viz'; scene.add(viz);
  const cams = {};
  for (const cam of CAMERAS) {
    const dv = derive(cam), center = stationCenter(STATION_OF[cam.station]);
    const pos = partToWorld(dv.pos, cam.station, center), fwd = dirToWorld(dv.fwd, cam.station).normalize();
    const right = dirToWorld(dv.right, cam.station).normalize(), up = dirToWorld(dv.up, cam.station).normalize();
    const vfov = 2 * Math.atan(dv.fovH / 2 / dv.wd) * 180 / Math.PI, big = cam.sensor === '5MP';
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), fwd);
    const upLocal = up.clone().applyQuaternion(q.clone().invert());
    const vc = visionCamera.create({
      name: `camera-${cam.id}`, bodyW: big ? 44 : 30, bodyD: big ? 44 : 30, bodyL: big ? 52 : 40, lensR: big ? 19 : 15, lensL: cam.f >= 35 ? 58 : 44,
      ringR: cam.light.kind === 'lensRing' ? cam.light.r : 0, fov: vfov,
      view: { fov: vfov, aspect: dv.fovW / dv.fovH, near: 5, far: 3000, up: upLocal.toArray() },
    });
    vc.root.position.copy(pos); vc.root.quaternion.copy(q); g.add(vc.root); tagPart(vc, big ? PART.cam5 : PART.cam16);
    const color = CAMERA_COLOR[cam.id], vg = new THREE.Group(); vg.name = `viz-${cam.id}`; viz.add(vg);
    frustum(vg, pos, fwd, right, up, dv.wd, dv.fovW, dv.fovH, dv.wd + Math.min(dv.dof, 60) / 2, color);
    // 光源本體與照射範圍
    const L = cam.light, target = partToWorld(cam.target, cam.station, center), lights = [];
    const lpts = lightPoints(cam, dv).map(p => partToWorld(p, cam.station, center));
    if (L.kind === 'ring') {
      const ring = new THREE.Group(); ring.name = `ps-ring-${cam.id}`; g.add(ring);
      const c0 = partToWorld([L.center[0], L.center[1], L.at], cam.station, center); ring.position.copy(c0);
      for (let k = 0; k < L.segments; k++) {
        const m = new THREE.Mesh(new THREE.TorusGeometry(L.r, 9, 10, 24, Math.PI * 2 / L.segments - .06), std(0xf4f6f8, .4, 0, { emissive: 0xffffff, emissiveIntensity: .05 }));
        m.name = `ps-segment-${k}`; m.rotation.x = Math.PI / 2; m.rotation.z = k * Math.PI * 2 / L.segments + .03; ring.add(m); lights.push(m);
      }
      for (const s of [-1, 1]) block(ring, [16, 70, 16], [s * L.r, 44, 0], MAT.alu);   // 吊架
      beam(vg, c0, partToWorld([0, 0, -63.5], cam.station, center), L.r, 62, 0xfff3c4, .07);
    } else if (L.kind === 'coaxial') {
      const box = new THREE.Group(); box.name = `coaxial-${cam.id}`; g.add(box);
      const c0 = pos.clone().addScaledVector(fwd, 75); box.position.copy(c0); box.quaternion.copy(q);
      block(box, [76, 70, 76], [0, 0, 0], MAT.black);
      lights.push(block(box, [56, 3, 56], [0, -36.5, 0], std(0xfff8e0, .3, 0, { emissive: 0xfff3c4, emissiveIntensity: .1 })));
      beam(vg, c0.clone().addScaledVector(fwd, 38), target, 28, 22, 0xfff3c4, .1);
    } else if (L.kind === 'lensRing') {
      beam(vg, pos, target, L.r, dv.fovH / 2, 0xfff3c4, .06);
    } else {
      // 條形光（bar、psBars）：每支一盞 core 條形光，發光面朝目標
      const pts = L.kind === 'bar' ? [lpts[2]] : [0, 1, 2].map(k => lpts[k * 3 + 1]);
      pts.forEach((p, k) => {
        const bar = barLight.create({ length: L.kind === 'bar' ? L.length : 70, w: 30, h: 26, lensW: 24, lensT: 4 });
        bar.root.name = `bar-${cam.id}-${k}`; bar.root.position.copy(p);
        bar.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(p).normalize());
        g.add(bar.root); tagPart(bar, PART.bar); lights.push(bar);
        beam(vg, p, target, 14, L.kind === 'bar' ? 22 : 26, 0xfff3c4, .06);
      });
    }
    cams[cam.id] = { cam, dv, vc, pos, fwd, right, up, target, lights, viz: vg, station: cam.station };
  }
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
  // 讀碼器（P0 上方，條碼位置待確認）
  const reader = codeReader.create({ name: 'code-reader' });
  reader.root.position.set(LINE.x[0], LINE.band + 260, -40); g.add(reader.root); tagPart(reader, PART.reader);
  return { group: g, viz, cams, reader, options: opt };
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
