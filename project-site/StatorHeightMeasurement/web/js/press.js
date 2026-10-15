// 沖壓區（現場既有設備，不採購：userData.noBom）：沖壓機、6 列出料滑道與滑道上排隊的工件、地板下的廢料坑（鋼蓋板＋支撐樑＋落料網格）。
// 沖壓機只做外形示意（顏色、尺寸依照片估計），滑塊上下動作的頻率放慢成 2 Hz 方便看。
import * as THREE from 'three';
import { block, cylinder, rod, plate, floorText } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { LAYOUT } from './spec.js';
import { partGeometry, partMaterials } from './parts.js';

const P = LAYOUT.press, LN = LAYOUT.lane, PIT = LAYOUT.pit;
const orange = new THREE.MeshStandardMaterial({ color: 0xe46f22, roughness: .55, metalness: .25 });
const dieMat = new THREE.MeshStandardMaterial({ color: 0x4b525a, roughness: .45, metalness: .6 });
const coverMat = new THREE.MeshStandardMaterial({ color: 0x7d858c, roughness: .6, metalness: .55 });
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
  plate(root, ['沖壓機（現場既有）'], 900, 150, [P.x, P.h - 300, zc + P.d / 2 + 2], 0);

  // ---- 出料滑道：從下模前緣往南伸出；6 列，每列兩側導板
  const chute = new THREE.Group(); chute.name = 'chute'; chute.userData.noBom = '現場既有出料滑道'; scene.add(chute);
  const len = LN.z1 - LN.z0, w = LN.n * LN.pitch + 40, zm = (LN.z0 + LN.z1) / 2;
  block(chute, [w, 12, len], [P.x, LN.y - 6, zm], MAT.steel);
  for (let k = 0; k <= LN.n; k++) block(chute, [4, LN.wall, len], [P.x + (k - LN.n / 2) * LN.pitch, LN.y + LN.wall / 2, zm], MAT.steel);
  block(chute, [w, 40, 20], [P.x, LN.y + 20, LN.z1 + 10], MAT.steelDark);       // 末端擋塊
  for (const s of [-1, 1]) block(chute, [50, LN.y - 24, 50], [P.x + s * (w / 2 - 25), 12 + (LN.y - 24) / 2, LN.z1 - 60], MAT.steelDark);
  block(chute, [w - 100, 40, 40], [P.x, 300, LN.z1 - 60], MAT.steelDark);

  // ---- 滑道上的工件：每列一個 InstancedMesh；最前一顆抵住擋塊
  const geo = partGeometry(part), M = partMaterials(), N = Math.ceil(len / part.lanePitch);
  const laneParts = new THREE.Group(); laneParts.name = 'lane parts'; scene.add(laneParts);
  const lanes = Array.from({ length: LN.n }, (_, k) => {
    const im = new THREE.InstancedMesh(geo, [M.cap, M.side], N); im.name = `lane ${k + 1} parts`; im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    laneParts.add(im); return im;
  });
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // picked：已被取走的顆數（含正在被取的那顆）；adv：已往前推進的顆數（可帶小數）
  function setLane(k, picked, adv) {
    const im = lanes[k];
    for (let j = 0; j < N; j++) {
      const m = picked + j, z = LN.z1 - part.lanePitch / 2 - (m - adv) * part.lanePitch;
      im.setMatrixAt(j, z < LN.z0 + part.lanePitch / 2 ? zero : m4.makeTranslation(laneX(k), LN.y, z));
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return {
    root, slide, lanes, setLane,
    set(t) { slide.position.y = -30 * (1 - Math.cos(t * Math.PI * 4)) / 2; },
    pickPoint: k => new THREE.Vector3(laneX(k), LN.y + part.h, LN.z1 - part.lanePitch / 2),
  };
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
  // 兩組 45° 斜桿：z − gz0 = ±(x − c)，裁到網格矩形內
  for (const s of [1, -1]) for (let c = gx0 - (gz1 - gz0); c <= gx1 + (gz1 - gz0); c += 70) {
    const xa = Math.max(gx0, s > 0 ? c : c - (gz1 - gz0)), xb = Math.min(gx1, s > 0 ? c + (gz1 - gz0) : c);
    if (xb - xa < 15) continue;
    const zOf = x => s > 0 ? gz0 + (x - c) : gz0 + (c - x);
    rod(gm, [xa, T - 4, zOf(xa)], [xb, T - 4, zOf(xb)], 3, MAT.steelDark, 6);
  }
  block(gm, [gx1 - gx0, T, 20], [(gx0 + gx1) / 2, T / 2, gz0 + 10], MAT.steelDark);
  block(gm, [gx1 - gx0, T, 20], [(gx0 + gx1) / 2, T / 2, gz1 - 10], MAT.steelDark);
  floorText(root, ['廢料坑蓋板區（可掀開）'], (PIT.x0 + PIT.x1) / 2 - 900, PIT.z1 - 220, 1600, 200);
  return { root };
}
