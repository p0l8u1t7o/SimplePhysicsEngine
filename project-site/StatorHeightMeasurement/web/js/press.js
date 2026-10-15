// 沖壓區（現場既有設備，不採購：userData.noBom）：沖壓機、6 列出料滑道與滑道上排隊的工件、地板下的廢料坑（鋼蓋板＋支撐樑＋落料網格）。
// 沖壓機只做外形示意（顏色、尺寸依照片估計），滑塊上下動作的頻率放慢成 2 Hz 方便看。
import * as THREE from 'three';
import { block, cylinder, rod, plate, floorText } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { LAYOUT } from './spec.js';
import { partGeometry, partMaterials } from './parts.js';
import { visionCamera } from '@core/models/vision.js';
import { barLight } from '@core/models/lights.js';
import { stainless, polished, wornSteel } from './finishes.js';
import { pressDetails, alignerDetails, pitDetails } from './equipment-details.js';

const P = LAYOUT.press, LN = LAYOUT.lane, PIT = LAYOUT.pit;
const orange = new THREE.MeshStandardMaterial({ color: 0xe46f22, roughness: .55, metalness: .25 });
const dieMat = new THREE.MeshStandardMaterial({ color: 0x4b525a, roughness: .45, metalness: .6 });
const coverMat = wornSteel;
const pitMat = new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 1 });
export const laneX = k => P.x + (k - (LN.n - 1) / 2) * LN.pitch;

export function createPress(scene, part) {
  const root = new THREE.Group(); root.name = 'press'; root.userData.noBom = '現場既有沖壓機'; scene.add(root);
  const x0 = P.x - P.w / 2, x1 = P.x + P.w / 2, zc = P.z;
  // 底座、左右立柱、上橫樑
  block(root, [P.w, P.bed - 120, P.d], [P.x, (P.bed - 120) / 2, zc], orange);
  for (const s of [-1, 1]) block(root, [520, P.h - P.bed, P.d - 200], [P.x + s * (P.w / 2 - 260), P.bed + (P.h - P.bed) / 2, zc], orange);
  block(root, [P.w + 80, 900, P.d], [P.x, P.h - 450 + 200, zc], orange);
  block(root, [P.w - 1040, 120, P.d - 300], [P.x, P.bed - 60, zc], MAT.steelDark);   // 工作台面
  // 模具：下模座、上模座（隨滑塊）、導柱
  const lower = block(root, [P.w - 1200, 180, 1300], [P.x, P.bed + 90, zc], dieMat); lower.name = 'lower die';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(root, 25, 420, [P.x + sx * 600, P.bed + 180 + 210, zc + sz * 520], MAT.chrome);
  const slide = new THREE.Group(); slide.name = 'press slide'; root.add(slide);
  block(slide, [P.w - 1060, 700, P.d - 360], [P.x, P.bed + 1200, zc], orange);
  block(slide, [P.w - 1200, 160, 1300], [P.x, P.bed + 770, zc], dieMat);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylinder(slide, 34, 120, [P.x + sx * 600, P.bed + 780, zc + sz * 520], MAT.steel);
  // 正面的操作盤與銘牌
  block(root, [420, 600, 160], [x1 + 260, 1400, P.front - 200], MAT.cabinet);
  plate(root, ['沖壓機（現場既有）'], 900, 150, [P.x, P.h - 300, zc + P.d / 2 + 20], 0);

  // ---- 出料滑道（現場既有，散料區）：從下模前緣往南伸出到整列單元；6 列，每列兩側導板
  const chute = new THREE.Group(); chute.name = 'chute'; chute.userData.noBom = '現場既有出料滑道'; scene.add(chute);
  const G0 = LN.guide[0], len = G0 - LN.z0, w = LN.n * LN.pitch + 40, zm = (LN.z0 + G0) / 2;
  block(chute, [w, 12, len], [P.x, LN.y - 6, zm], stainless);
  for (let k = 0; k <= LN.n; k++) block(chute, [4, LN.wall, len], [P.x + (k - LN.n / 2) * LN.pitch, LN.y + LN.wall / 2, zm], polished);
  for (const s of [-1, 1]) block(chute, [50, LN.y - 24, 50], [P.x + s * (w / 2 - 25), 12 + (LN.y - 24) / 2, G0 - 60], MAT.steelDark);

  const aligner = createAligner(scene, part, w);
  pressDetails(root, slide);
  alignerDetails(aligner, part);

  // ---- 滑道上的工件：每列一個 InstancedMesh。
  // 位置序號 s＝m − fed（fed＝已送進定位座的顆數，可帶小數）：s ≤ −1 在定位座、−1～0 正從擋銷前滑進定位座、s ≥ 0 在通道裡排隊（上游間距較鬆）。
  // 散料區的工件左右偏、歪斜，進收斂導正段後線性擺正，窄通道與定位座內完全對正。
  const geo = partGeometry(part), M = partMaterials(), N = Math.ceil((LN.z1 - LN.z0) / part.lanePitch);
  const laneParts = new THREE.Group(); laneParts.name = 'lane parts'; scene.add(laneParts);
  const lanes = Array.from({ length: LN.n }, (_, k) => {
    const im = new THREE.InstancedMesh(geo, [M.cap, M.side], N); im.name = `lane ${k + 1} parts`; im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    laneParts.add(im); return im;
  });
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const pickZ = LN.z1 - part.lanePitch / 2, zQ = pickZ - part.lanePitch - 8;
  const hash = (k, m, c) => { const v = Math.sin(k * 127.1 + m * 311.7 + c * 74.7) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
  const slack = Math.max(0, (LN.pitch - 4) / 2 - part.w / 2) * .85;
  function laneZ(s) { return s <= -1 ? pickZ : s < 0 ? zQ + (pickZ - zQ) * -s : zQ - s * part.lanePitch - Math.max(0, s - 3) * 16; }
  function setLane(k, picked, fed) {
    const im = lanes[k];
    for (let j = 0; j < N; j++) {
      const m = picked + j, z = laneZ(m - fed);
      if (z < LN.z0 + part.lanePitch / 2) { im.setMatrixAt(j, zero); continue; }
      const g = Math.min(1, Math.max(0, (LN.guide[1] - z) / (LN.guide[1] - LN.guide[0])));
      q.setFromAxisAngle(Y, hash(k, m, 1) * .35 * g);
      im.setMatrixAt(j, m4.compose(new THREE.Vector3(laneX(k) + hash(k, m, 2) * slack * g, LN.y, z), q, one));
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return {
    root, slide, lanes, setLane, aligner, pickZ,
    set(t) { slide.position.y = -30 * (1 - Math.cos(t * Math.PI * 4)) / 2; },
    pickPoint: k => new THREE.Vector3(laneX(k), LN.y + part.h, pickZ),
  };
}

// ---- 整列單元（新增設備，下料機的一部分）：收斂導正板、窄通道、分料擋銷、定位座（擋塊面＋西側基準壁＋東側側推缸）、
// 到位／方向光纖；定位座上方一台 2D 相機＋條形光確認位置與方向（雙重保險，偏差回饋給手臂）。
function createAligner(scene, part, w) {
  const g = new THREE.Group(); g.name = 'lane aligner'; scene.add(g);
  const [G0, G1] = LN.guide, z1 = LN.z1, ch = part.channel, pickZ = z1 - part.lanePitch / 2, zE = pickZ - part.len / 2 - 4.5;
  block(g, [w, 12, z1 + 20 - G0], [P.x, LN.y - 6, (G0 + z1 + 20) / 2], MAT.alu).userData.guide = 'escapement';   // 底板（擋銷穿過的孔）
  block(g, [w, 40, 20], [P.x, LN.y + 20, z1 + 10], MAT.steelDark);                                   // 擋塊（定位座 z 基準）
  for (const s of [-1, 1]) block(g, [50, LN.y - 24, 50], [P.x + s * (w / 2 - 10), 12 + (LN.y - 24) / 2, z1 - 40], MAT.steelDark);
  block(g, [w - 100, 40, 40], [P.x, 300, z1 - 40], MAT.steelDark);
  const pins = [], pushers = [], leds = [];
  for (let k = 0; k < LN.n; k++) {
    const x = laneX(k);
    for (const s of [-1, 1]) {
      // 收斂導正板：從列寬內側（±38）斜收到通道寬
      const xa = x + s * (LN.pitch / 2 - 4), xb = x + s * (ch / 2 + 2), L = Math.hypot(xb - xa, G1 - G0 - 2);
      const gp = block(g, [4, 30, L], [(xa + xb) / 2, LN.y + 15, (G0 + 2 + G1) / 2], MAT.steel); gp.rotation.y = Math.atan2(xb - xa, G1 - G0 - 2);
      // 窄通道壁（西側＝基準壁）
      const cw = block(g, [4, 30, z1 - G1], [xb, LN.y + 15, (G1 + z1) / 2], s < 0 ? MAT.steelDark : MAT.steel);
      if (s > 0) cw.userData.guide = 'nest pusher';                                        // 東側壁開窗讓側推墊塊穿過
    }
    // 分料擋銷：從底板下方升起擋住第二顆；本體在底板下
    const pin = cylinder(g, 3, 18, [x, LN.y + 9, zE], MAT.chrome); pin.name = 'escapement pin'; pin.userData.on = 'escapement'; pins.push(pin);
    block(g, [24, 40, 24], [x, LN.y - 12 - 20 - 10, zE], MAT.black);
    // 側推缸：東側通道壁外，把工件推靠西側基準壁
    block(g, [30, 22, 26], [x + ch / 2 + 4 + 15, LN.y + 14, pickZ], MAT.black);
    // 圓形聚氨酯墊消除方墊角落；中心與側推行程沿用既有定位。
    const pad = cylinder(g, 8, 4, [x + ch / 2 - 2 + 6, LN.y + 14, pickZ], MAT.yellow, 'x', 16); pad.name = 'nest pusher'; pad.userData.on = 'nest pusher'; pushers.push({ pad, x0: x + ch / 2 + 4 });
    // 到位／方向光纖（西側壁外兩支）＋指示燈
    for (const dz of [-6, 6]) block(g, [8, 8, 8], [x - ch / 2 - 8, LN.y + 12, pickZ + dz], MAT.black);
    const led = block(g, [6, 4, 6], [x - ch / 2 - 8, LN.y + 18, pickZ + 14], MAT.green.clone()); led.name = 'nest led'; leds.push(led);
  }
  // 相機架：兩支立柱在手臂作業半徑外（離手臂軸 > 690 mm），橫樑高過手臂
  const top = 1860, px = 700, pz = 560;
  for (const s of [-1, 1]) { block(g, [60, top - 24, 60], [P.x + s * px, 24 + (top - 24) / 2, pz], MAT.frame); block(g, [110, 12, 160], [P.x + s * px, 18, pz], MAT.steelDark); }
  block(g, [2 * px + 60, 60, 60], [P.x, top + 30, pz], MAT.frame);
  // 相機（俯拍 6 個定位座）：吊在橫樑下、鏡頭朝下；條形光沿 X、在相機下方偏南（避開手臂花鍵軸最高點）
  const camY = 1760;
  block(g, [60, top - camY - 70, 40], [P.x, (camY + 70 + top) / 2, pz], MAT.steelDark);
  block(g, [60, 30, pz - pickZ + 20], [P.x, camY + 85, (pz + pickZ) / 2], MAT.steelDark);
  const cam = visionCamera.create({ spot: false, ringR: 0, fov: 34, bodyW: 44, bodyD: 44, bodyL: 50, lensR: 16, lensL: 40, view: { type: 'perspective', fov: 34, aspect: 2.4, near: 50, far: 3000 } });
  cam.root.position.set(P.x, camY - 10, pickZ); g.add(cam.root);
  for (const s of [-1, 1]) block(g, [30, top - 1690, 30], [P.x + s * 335, (1690 + top) / 2, pz], MAT.steelDark);
  const bar = barLight.create({ length: 640, axis: 'x', w: 50, h: 40, lensW: 42 });
  bar.root.position.set(P.x, 1670, pz); bar.root.rotation.x = .35; g.add(bar.root);
  return { root: g, pins, pushers, leds, zE, pickZ, cam, bar, post: { x: px, z: pz } };
}

// ---- 廢料坑：地板下的空洞；上面是鋼蓋板（有提把，可掀開清廢料）、接縫下有支撐樑，靠沖壓機一側有落料網格
export function createPit(scene) {
  const root = new THREE.Group(); root.name = 'scrap pit'; root.userData.noBom = '現場既有廢料坑與蓋板'; scene.add(root);
  const T = 12, [gx0, gx1, gz0, gz1] = PIT.grate;
  const zs = [PIT.z0, ...PIT.joints, PIT.z1], xs = [PIT.x0, ...PIT.seams, PIT.x1];
  // 坑壁與坑底（網格開口看得到）
  block(root, [PIT.x1 - PIT.x0, 20, PIT.z1 - PIT.z0], [(PIT.x0 + PIT.x1) / 2, -900, (PIT.z0 + PIT.z1) / 2], pitMat);
  for (const [a, b, c, d] of [[gx0 - 40, gx0, gz0, gz1], [gx1, gx1 + 40, gz0, gz1]]) block(root, [b - a, 720, d - c], [(a + b) / 2, -540, (c + d) / 2], pitMat);
  for (const [c, d] of [[gz0 - 40, gz0], [gz1, gz1 + 40]]) block(root, [gx1 - gx0 + 80, 720, d - c], [(gx0 + gx1) / 2, -540, (c + d) / 2], pitMat);
  // 支撐樑（接縫正下方）：蓋板厚 12，樑頂貼蓋板底
  for (const z of PIT.joints) block(root, [PIT.x1 - PIT.x0, 160, 100], [(PIT.x0 + PIT.x1) / 2, -80, z], MAT.steelDark);
  // 蓋板：每格一塊，網格那一塊挖空
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const a = xs[i], b = xs[i + 1], c = zs[j], d = zs[j + 1], g = 4;
    const hasGrate = gx0 >= a && gx1 <= b && gz0 >= c && gz1 <= d;
    if (!hasGrate) block(root, [b - a - g, T, d - c - g], [(a + b) / 2, T / 2, (c + d) / 2], coverMat);
    else {
      block(root, [gx0 - a - g / 2, T, d - c - g], [(a + gx0) / 2 - g / 4, T / 2, (c + d) / 2], coverMat);
      block(root, [b - gx1 - g / 2, T, d - c - g], [(gx1 + b) / 2 + g / 4, T / 2, (c + d) / 2], coverMat);
      block(root, [gx1 - gx0, T, gz0 - c - g / 2], [(gx0 + gx1) / 2, T / 2, (c + gz0) / 2 - g / 4], coverMat);
      block(root, [gx1 - gx0, T, d - gz1 - g / 2], [(gx0 + gx1) / 2, T / 2, (gz1 + d) / 2 + g / 4], coverMat);
    }
    // 提把：每塊兩支
    for (const s of [-1, 1]) rod(root, [(a + b) / 2 + s * 180 - 60, T + 1, d - 120], [(a + b) / 2 + s * 180 + 60, T + 1, d - 120], 6, MAT.chrome);
  }
  // 落料網格：菱形鋼網（斜向細桿）
  const gm = new THREE.Group(); gm.name = 'grate'; root.add(gm);
  pitDetails(root, gm);
  block(gm, [gx1 - gx0, T, 20], [(gx0 + gx1) / 2, T / 2, gz0 + 10], MAT.steelDark);
  block(gm, [gx1 - gx0, T, 20], [(gx0 + gx1) / 2, T / 2, gz1 - 10], MAT.steelDark);
  floorText(root, ['廢料坑蓋板區（可掀開）'], (PIT.x0 + PIT.x1) / 2 - 900, PIT.z1 - 220, 1600, 200);
  return { root };
}
