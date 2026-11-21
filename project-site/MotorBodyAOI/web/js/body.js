// 本體工件：網格解碼（tools/import-step.mjs 由 STEP 產生）、12 個檢測面對 STEP B-rep 面的對照、three.js 幾何。
// 工件座標沿用 STEP：工件軸為 Z，Z = +1.5 為杯口凸緣頂、Z = −4 為開口端面（面 6）、Z = −69 為法蘭側最低面（止口端環）。
// 網頁與 tools/（Node）共用，不碰 DOM。
import * as THREE from 'three';
import { decode } from './codec.js';
import { BODY_MESH } from './body-mesh.js';

// 12 個檢測面：brep 是 STEP B-rep 面編號（tools/import-step.mjs 的順序），由規格書 12 張標示圖逐張比對 STEP 渲染確認（2026-11-21）。
// group：A 外側平面、B 外圓柱、C 孔壁、D 杯內大內壁、E 杯底平面（深位）。z、r 是 STEP 量到的範圍（mm），zone：外側／杯內（內外側定義待客戶拍板）。
export const FACES = [
  { no: 1, name: '法蘭側凸轂端面', group: 'A', station: 'ST1', kind: '環形平面', brep: [11], z: [-67.2, -67.2], r: [11.2, 18.7], zone: '外側' },
  { no: 2, name: 'Ø22 軸孔內壁', group: 'C', station: 'ST1', kind: '孔壁（貫穿）', brep: [9, 246], z: [-67, -62], r: [11, 11], zone: '孔內' },
  { no: 3, name: 'Ø80 止口外圓柱', group: 'B', station: 'ST1', kind: '外圓柱', brep: [35, 36], z: [-68, -63.9], r: [40, 40], zone: '外側' },
  { no: 4, name: '法蘭面（含 3 耳）', group: 'A', station: 'ST1', kind: '平面', brep: [38], z: [-63.5, -63.5], r: [40.4, 60.5], zone: '外側' },
  { no: 5, name: '杯口凸緣外側（3 段弧）', group: 'B', station: 'ST2', kind: '外圓柱', brep: [185, 186, 187], z: [-4, 1.1], r: [49, 49], zone: '外側' },
  { no: 6, name: '開口端面（含 3 耳）', group: 'A', station: 'ST2', kind: '平面', brep: [90], z: [-4, -4], r: [46.8, 60.5], zone: '外側' },
  { no: 7, name: 'Ø93 內壁根部窄台階', group: 'E', station: 'ST2', kind: '環形平面（寬 1.0）', brep: [231], z: [-48.5, -48.5], r: [45, 46.02], zone: '杯內' },
  { no: 8, name: '杯內壁下段 Ø93.0', group: 'D', station: 'ST1', kind: '內圓柱', brep: [97, 234], z: [-48.5, -18.5], r: [46.5, 46.5], zone: '杯內' },
  { no: 9, name: '杯內壁上段 Ø93.6（含凸緣內側）', group: 'D', station: 'ST1', kind: '內圓柱', brep: [95, 225], z: [-18, 1.35], r: [46.8, 46.8], zone: '杯內' },
  { no: 10, name: '杯底凸台端面', group: 'E', station: 'ST2', kind: '環形平面', brep: [4], z: [-53.5, -53.5], r: [14.17, 17.05], zone: '杯內' },
  { no: 11, name: 'Ø28 凸台孔壁', group: 'C', station: 'ST2', kind: '孔壁', brep: [1, 5], z: [-62, -53.8], r: [14, 14], zone: '杯內' },
  { no: 12, name: 'Ø28 孔底台階環', group: 'E', station: 'ST2', kind: '環形平面（寬 2.25）', brep: [8], z: [-62, -62], r: [11, 13.25], zone: '杯內' },
];
export const GROUPS = { A: '外側平面', B: '外圓柱', C: '孔壁', D: '杯內大內壁', E: '杯底平面（深位）' };
// 夾持帶（2026-11-21 拍板）：Ø100 外圓 Z −16 ~ −45，150–210° 有 0.25 mm 深凹面板要避開
export const GRIP_BAND = { r: 50, z: [-45, -16], panel: [150, 210] };
export const SIZE = BODY_MESH.size;

let cache;
// 解碼一次：positions（mm）、index、triBrep（每個三角形的 B-rep 面）、triFace（每個三角形屬於哪個檢測面，0＝不檢）、
// nor（逐三角形單位法向，朝外）、cen（重心）、area
export function bodyData() {
  if (cache) return cache;
  const positions = Float32Array.from(decode(BODY_MESH.positions), v => v / 100);
  const index = Uint32Array.from(decode(BODY_MESH.index)), ranges = decode(BODY_MESH.faces);
  const nt = index.length / 3, triBrep = new Int16Array(nt).fill(-1), triFace = new Uint8Array(nt);
  for (let k = 0; k < ranges.length / 2; k++) for (let t = ranges[k * 2]; t <= ranges[k * 2 + 1]; t++) triBrep[t] = k;
  const brepFace = new Map(FACES.flatMap(f => f.brep.map(b => [b, f.no])));
  for (let t = 0; t < nt; t++) triFace[t] = brepFace.get(triBrep[t]) ?? 0;
  const nor = new Float32Array(nt * 3), cen = new Float32Array(nt * 3), area = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nor[t * 3] = nx / l; nor[t * 3 + 1] = ny / l; nor[t * 3 + 2] = nz / l; area[t] = l / 2;
    for (let k = 0; k < 3; k++) cen[t * 3 + k] = (positions[a + k] + positions[b + k] + positions[c + k]) / 3;
  }
  return (cache = { positions, index, nt, triBrep, triFace, nor, cen, area });
}

// 各檢測面的三角形清單與面積（mm²）
export function faceTriangles() {
  const d = bodyData(), out = Object.fromEntries(FACES.map(f => [f.no, { tris: [], area: 0 }]));
  for (let t = 0; t < d.nt; t++) { const f = d.triFace[t]; if (f) { out[f].tris.push(t); out[f].area += d.area[t]; } }
  return out;
}

// 實體幾何（共用頂點，B-rep 面交界的頂點本來就分開，稜線保持銳利）
export function bodyGeometry() {
  const d = bodyData(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// 只含部分三角形的幾何（檢測面上色、取像足跡用）：每個三角形獨立頂點，沿法向外推 off（mm）避免與實體重合閃爍
export function subGeometry(tris, off = .06) {
  const d = bodyData(), pos = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) { const v = d.index[t * 3 + k] * 3; for (let a = 0; a < 3; a++) pos[i * 9 + k * 3 + a] = d.positions[v + a] + d.nor[t * 3 + a] * off; }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
