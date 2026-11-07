// 配管的 3D。只用長期穩定的 three API（Curve、CurvePath、LineCurve3、TubeGeometry、CylinderGeometry、TorusGeometry、InstancedMesh、BufferGeometry）。
//   routeCurve(route)            → THREE.CurvePath（直線＋圓弧），可以給 TubeGeometry 或流動貼圖用
//   routeTube(route, opts)       → 單一 Mesh（TubeGeometry），少量管線或要貼圖時用
//   createPipeBatch(opts)        → 多條管線共用幾何：直管一種管徑一個 InstancedMesh（單位圓柱縮放），
//                                  彎頭依（管徑, R, 角度）共用一份 TorusGeometry 再用 InstancedMesh 擺放
//   trayGeometry(route, opts)    → 電纜槽（U 形斷面沿路徑掃掠）的 BufferGeometry
import * as THREE from 'three';
import { std } from '../geom/materials.js';
import { pathPoints } from './route.js';

export const PIPE_MAT = {
  steel: std(0x9aa3ab, .4, .7), pvc: std(0xd9dde0, .55, 0), hdpe: std(0x23272b, .7, 0),
  conduit: std(0xb9c0c6, .35, .8), tray: std(0xa9b2b8, .45, .7, { side: THREE.DoubleSide }),
};

// 圓弧曲線：圓心 c、起點方向 x（單位）、切線方向 y（單位）、半徑 R、角度 th（弧度）
export class ArcCurve3 extends THREE.Curve {
  constructor(center, x, y, R, th) { super(); this.c = new THREE.Vector3(...center); this.x = new THREE.Vector3(...x); this.y = new THREE.Vector3(...y); this.R = R; this.th = th; }
  getPoint(t, target = new THREE.Vector3()) {
    const a = this.th * t;
    return target.copy(this.c).addScaledVector(this.x, this.R * Math.cos(a)).addScaledVector(this.y, this.R * Math.sin(a));
  }
}
const arcOf = b => {
  const x = [(b.start[0] - b.center[0]) / b.R, (b.start[1] - b.center[1]) / b.R, (b.start[2] - b.center[2]) / b.R];
  return new ArcCurve3(b.center, x, b.a, b.R, b.angle * Math.PI / 180);
};

export function routeCurve(route) {
  const path = new THREE.CurvePath(), bendAt = new Map(route.bends.map(b => [b.at, b]));
  route.straights.forEach((s, j) => {
    if (s.length > 1e-6) path.add(new THREE.LineCurve3(new THREE.Vector3(...s.from), new THREE.Vector3(...s.to)));
    const b = bendAt.get(j + 1); if (b) path.add(arcOf(b));
  });
  return path;
}

export function routeTube(route, { radius = route.od / 2, material = PIPE_MAT.steel, radialSegments = 12, segmentsPerM = 4, name = 'pipe' } = {}) {
  const curve = routeCurve(route), n = Math.max(8, Math.ceil(route.developed / 1000 * segmentsPerM) + route.bends.length * 8);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, n, radius, radialSegments, false), material);
  m.name = name; m.castShadow = m.receiveShadow = true; return m;
}

// 多條管線批次建模
export function createPipeBatch({ material = PIPE_MAT.steel, radialSegments = 14, bendSegments = 12, name = 'piping' } = {}) {
  const items = [];   // { route, od, material }
  return {
    add(route, { od = route.od, material: mat = material } = {}) { items.push({ route, od, mat }); return this; },
    build() {
      const root = new THREE.Group(); root.name = name; root.userData.coreModel = 'piping';
      const straight = new Map(), bend = new Map(), geo = new Map();
      for (const { route, od, mat } of items) {
        const r = od / 2;
        for (const s of route.straights) if (s.length > 1e-6) {
          const k = `${mat.uuid}|${r}`; if (!straight.has(k)) straight.set(k, { r, mat, list: [] }); straight.get(k).list.push(s);
        }
        for (const b of route.bends) {
          const R = Math.round(b.R * 10) / 10, ang = Math.round(b.angle * 100) / 100, k = `${mat.uuid}|${r}|${R}|${ang}`;
          if (!bend.has(k)) bend.set(k, { r, R, ang, mat, list: [] }); bend.get(k).list.push(b);
        }
      }
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), P = new THREE.Vector3(), S = new THREE.Vector3();
      if (!geo.has('unit')) geo.set('unit', new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, false));
      for (const { r, mat, list } of straight.values()) {
        const mesh = new THREE.InstancedMesh(geo.get('unit'), mat, list.length); mesh.name = `${name} straight Ø${(2 * r).toFixed(1)}`;
        list.forEach((s, i) => {
          d.set(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]); const L = d.length(); d.multiplyScalar(1 / L);
          q.setFromUnitVectors(up, d);
          M.compose(P.set((s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2, (s.from[2] + s.to[2]) / 2), q, S.set(r, L, r)); mesh.setMatrixAt(i, M);
        });
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
      }
      const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), B = new THREE.Matrix4();
      for (const { r, R, ang, mat, list } of bend.values()) {
        // TorusGeometry：圓弧在 XY 平面、圓心在原點、從 +X 開始繞 +Z 掃 arc 弧度
        const tg = new THREE.TorusGeometry(R, r, radialSegments, Math.max(2, Math.ceil(bendSegments * ang / 90)), ang * Math.PI / 180);
        const mesh = new THREE.InstancedMesh(tg, mat, list.length); mesh.name = `${name} bend Ø${(2 * r).toFixed(1)} R${R} ${ang}°`;
        list.forEach((b, i) => {
          X.set(b.start[0] - b.center[0], b.start[1] - b.center[1], b.start[2] - b.center[2]).normalize();
          Z.set(...b.normal); Y.crossVectors(Z, X);   // Y ＝ 起點切線（＝入射方向 a）
          B.makeBasis(X, Y, Z); q.setFromRotationMatrix(B);
          M.compose(P.set(...b.center), q, S.set(1, 1, 1)); mesh.setMatrixAt(i, M);
        });
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
      }
      return root;
    },
  };
}

// 電纜槽：U 形（開口朝上）斷面沿路徑掃掠。路徑點是槽斷面的中心；up 沿路徑平行傳遞（垂直段也不會翻轉）
export function trayGeometry(route, { width = 200, height = 75, step = 300 } = {}) {
  const pts = pathPoints(route, { step, arcStep: 7.5 }).map(p => new THREE.Vector3(...p));
  const n = pts.length, frames = [];
  let up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const t = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    if (i > 0 && i < n - 1) t.add(pts[i].clone().sub(pts[i - 1]).normalize()).normalize();   // 取前後平均，轉角處不扭
    let u = up.clone().addScaledVector(t, -up.dot(t));
    if (u.lengthSq() < 1e-6) u = new THREE.Vector3(1, 0, 0).addScaledVector(t, -t.x);
    u.normalize(); up = u;
    frames.push({ p: pts[i], u, s: new THREE.Vector3().crossVectors(t, u).normalize() });
  }
  const w = width / 2, h = height / 2;
  const strips = [[[-w, h], [-w, -h]], [[-w, -h], [w, -h]], [[w, -h], [w, h]]];   // 左壁、底板、右壁（[側向, 上下]）
  const pos = [], idx = [];
  for (const [[s0, u0], [s1, u1]] of strips) {
    const base = pos.length / 3;
    for (const f of frames) for (const [s, u] of [[s0, u0], [s1, u1]]) {
      const v = f.p.clone().addScaledVector(f.s, s).addScaledVector(f.u, u); pos.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < n - 1; i++) { const a = base + 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function routeTray(route, { width, height, material = PIPE_MAT.tray, name = 'cable tray' } = {}) {
  const m = new THREE.Mesh(trayGeometry(route, { width, height }), material); m.name = name; m.castShadow = m.receiveShadow = true; return m;
}
