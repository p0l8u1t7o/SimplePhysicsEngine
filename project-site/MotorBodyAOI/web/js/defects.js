// 示範缺陷（動畫用；尺寸、位置為示意）與「哪一張拍到它」的判斷。兩個方案共用。
// 位置：檢測面上離 (方位 az、高度 z) 最近的 STEP 三角形；哪一張拍到：用 coverage-data.js 的取像足跡（每個三角形被第幾張拍到的位元遮罩）。
// 判定門檻照 05 的建議（選項 B）：外側 ≥ 0.8 mm、杯內與孔內 ≥ 1.5 mm 判 NG；未達門檻的列為「判 OK（未達門檻）」。
import * as THREE from 'three';
import { bodyData, faceTriangles, FACES } from './body.js';
import { decode } from './codec.js';

export const LIMIT = { 外側: .8, 杯內: 1.5, 孔內: 1.5 };
// 每個方案的示範：key 是工件編號（0 起算）
export const DEMO = {
  fixed: { 2: [{ face: 4, kind: '砂孔', size: 1.2, az: 75 }] },
  arm: {
    1: [{ face: 4, kind: '砂孔', size: 1.2, az: 75 }],
    2: [{ face: 6, kind: '碰傷', size: .5, az: 300 }],
    3: [{ face: 8, kind: '刮傷', size: 3, az: 200, z: -32 }],
  },
};
export const isNg = d => d.size >= LIMIT[FACES.find(f => f.no === d.face).zone];

// 缺陷所在的三角形（面上離目標點最近）
export function defectTri(d) {
  const b = bodyData(), f = FACES.find(x => x.no === d.face), r = (f.r[0] + f.r[1]) / 2, z = d.z ?? (f.z[0] + f.z[1]) / 2;
  const a = d.az * Math.PI / 180, p = [r * Math.cos(a), r * Math.sin(a), z];
  let best = -1, bd = Infinity;
  for (const t of faceTriangles()[d.face].tris) {
    const q = [b.cen[t * 3] - p[0], b.cen[t * 3 + 1] - p[1], b.cen[t * 3 + 2] - p[2]], dd = q[0] * q[0] + q[1] * q[1] + q[2] * q[2];
    if (dd < bd) { bd = dd; best = t; }
  }
  return best;
}

// 缺陷網格（掛在工件的 spin 群組下，工件座標）：砂孔、碰傷畫成暗色小圓點，刮傷畫成沿圓周的細長暗線；
// 另加一圈半透明紅環（效果物件，只在 3D 主畫面標示位置，相機縮圖會隱藏）
export function defectMesh(d) {
  const b = bodyData(), t = defectTri(d), c = new THREE.Vector3(b.cen[t * 3], b.cen[t * 3 + 1], b.cen[t * 3 + 2]);
  const n = new THREE.Vector3(b.nor[t * 3], b.nor[t * 3 + 1], b.nor[t * 3 + 2]).normalize();
  const g = new THREE.Group(); g.name = `defect-${d.face}`;
  g.position.copy(c).addScaledVector(n, .06);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  const dark = new THREE.MeshBasicMaterial({ color: 0x15181c, polygonOffset: true, polygonOffsetFactor: -8 });
  let m;
  if (d.kind === '刮傷') {
    // 沿圓周（刀紋方向）的刮傷：在切平面內轉到圓周方向
    m = new THREE.Mesh(new THREE.PlaneGeometry(d.size, .25), dark);
    const tang = new THREE.Vector3(-c.y, c.x, 0).normalize(), local = tang.clone().applyQuaternion(g.quaternion.clone().invert());
    m.rotation.z = Math.atan2(local.y, local.x);
  } else m = new THREE.Mesh(new THREE.CircleGeometry(d.size / 2, 16), dark);
  m.name = 'defect-mark'; g.add(m);
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.2, 24), new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: .9, depthTest: false, side: THREE.DoubleSide }));
  ring.name = 'defect-ring'; ring.renderOrder = 9; ring.userData.fx = true; g.add(ring);
  Object.assign(g.userData, { defect: d, tri: t });
  return g;
}

// 第 k 張（k = −1：轉之前的靜態張）有沒有拍到缺陷：取像足跡的位元遮罩
export function makeSeer(footprint) {
  const cache = {};
  return (camId, d, k) => {
    const fp = footprint[camId]; if (!fp) return false;
    const c = cache[camId] ??= { tris: decode(fp.tris), masks: decode(fp.masks) };
    const t = d.tri ?? (d.tri = defectTri(d)), i = c.tris.indexOf(t); if (i < 0) return false;
    return k < 0 ? c.masks[i] !== 0 : !!(c.masks[i] & (1 << k));
  };
}
