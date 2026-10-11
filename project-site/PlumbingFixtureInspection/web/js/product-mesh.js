// 產品模組（web/js/products/*.js，tools/import-cad.mjs 產生）→ three.js 幾何與逐三角形資料。
import * as THREE from 'three';
import { decode } from './codec.js';
import { prepareMesh } from './planner.js';

const cache = new WeakMap();
// 解碼一次：網格（mm，產品座標）、prepareMesh 的重心與法向量、產品檔的逐三角形陣列
export function productData(prod) {
  let d = cache.get(prod); if (d) return d;
  const positions = Float32Array.from(decode(prod.mesh.positions), v => v / 100), index = decode(prod.mesh.index);
  const m = prepareMesh({ positions, index, face: decode(prod.mesh.face) });
  d = { m, cls: decode(prod.file.cls), mask: decode(prod.file.mask), firstView: decode(prod.file.firstView) };
  cache.set(prod, d); return d;
}

// 實體網格：共用頂點、平滑法向量（CAD 轉出的頂點在 B-rep 面交界本來就分開，稜線保持銳利）
export function productGeometry(prod) {
  const { m } = productData(prod), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// 數位空間用的上色網格：每個三角形獨立三個頂點，color 逐三角形設定
export function colorGeometry(prod) {
  const { m } = productData(prod), n = m.nt, pos = new Float32Array(n * 9), nor = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const v = m.index[t * 3 + k];
    pos.set(m.positions.subarray(v * 3, v * 3 + 3), t * 9 + k * 3);
    nor.set(m.nor.subarray(t * 3, t * 3 + 3), t * 9 + k * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 9).fill(1), 3));
  g.computeBoundingSphere();
  // paint(fn)：fn(t) 回傳 THREE.Color（同一個物件可重用）
  g.userData.paint = fn => {
    const c = g.attributes.color.array;
    for (let t = 0; t < n; t++) { const col = fn(t); for (let k = 0; k < 3; k++) { c[t * 9 + k * 3] = col.r; c[t * 9 + k * 3 + 1] = col.g; c[t * 9 + k * 3 + 2] = col.b; } }
    g.attributes.color.needsUpdate = true;
  };
  return g;
}

// 產品座標中離 p 最近、類別在 classes 內的三角形（缺陷示範點吸附到表面）
export function nearestTri(prod, p, classes = [0, 1]) {
  const { m, cls } = productData(prod);
  let best = -1, bd = Infinity;
  for (let t = 0; t < m.nt; t++) {
    if (!classes.includes(cls[t])) continue;
    const d = (m.cen[t * 3] - p[0]) ** 2 + (m.cen[t * 3 + 1] - p[1]) ** 2 + (m.cen[t * 3 + 2] - p[2]) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
