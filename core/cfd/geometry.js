// 座標轉換與障礙物幾何。純 JS（瀏覽器與 Node 都能用）。
//
// 場景座標：本框架的 three.js 慣例，Y 向上、單位 mm（輸入 JSON 可改 up: 'z'、units: 'm'）。
// OpenFOAM 座標（以下稱 foam）：Z 向上、單位 m，而且把風向轉到 +x（入口在 x 最小、出口在 x 最大），
// 計算域因此永遠是對齊座標軸的長方體，blockMesh 最簡單。
//   foam = S · Rz(-θ) · A · (scene - origin)
//   A：Y 向上 → Z 向上（x, y, z）→（x, -z, y），是繞 x 軸 +90° 的正交旋轉（右手系不變）
//   θ：風向（吹往的方向）在 Z 向上水平面的方位角
//   S：單位換算（mm → m 為 0.001）
// 匯入結果時用反矩陣把點轉回場景座標，向量（速度、力）只套旋轉。

export const D2R = Math.PI / 180;

const UNIT = { mm: 0.001, cm: 0.01, m: 1 };

export function unitScale(units = 'mm') {
  const s = UNIT[units];
  if (!s) throw new Error(`不支援的單位：${units}（mm、cm、m）`);
  return s;
}

// 3×3 矩陣以列優先（row-major）的 9 元素陣列表示
export const mat3 = {
  mul(a, b) {
    const r = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
    return r;
  },
  apply(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; },
  transpose(m) { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; },
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; },
  identity: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); if (!l) throw new Error('零向量無法正規化'); return [a[0] / l, a[1] / l, a[2] / l]; },
};

// 清掉浮點雜訊（cos(90°) = 6e-17 之類），讓輸出的字典與 JSON 決定性又好讀
export const clean = x => { if (Math.abs(x) < 1e-12) return 0; const r = Math.round(x); return Math.abs(x - r) < 1e-12 ? r : x; };
// 座標輸出：10 位有效數字（去掉 160.10000000000014 這類雜訊）
const r10 = x => clean(Number(x.toPrecision(10)));
const cleanV = a => a.map(r10);

// Euler 角（度），順序 XYZ，與 three.js Object3D.rotation 的預設相同：R = Rx · Ry · Rz
export function eulerXYZ([rx = 0, ry = 0, rz = 0] = []) {
  return mat3.mul(mat3.mul(mat3.rotX(rx * D2R), mat3.rotY(ry * D2R)), mat3.rotZ(rz * D2R)).map(clean);
}

// 建立轉換。direction：風吹往的方向（場景座標）
export function createFrame({ up = 'y', units = 'mm', origin = [0, 0, 0], direction = [1, 0, 0] } = {}) {
  if (up !== 'y' && up !== 'z') throw new Error(`up 只能是 'y' 或 'z'：${up}`);
  const s = unitScale(units);
  const A = up === 'y' ? [1, 0, 0, 0, 0, -1, 0, 1, 0] : mat3.identity.slice();
  const d = mat3.apply(A, direction);
  if (Math.hypot(d[0], d[1]) < 1e-9) throw new Error('風向沒有水平分量');
  const theta = Math.atan2(d[1], d[0]);
  const R = mat3.mul(mat3.rotZ(-theta), A).map(clean); // 場景 → foam 的旋轉
  const Rt = mat3.transpose(R);
  const toFoam = p => cleanV(v3.scale(mat3.apply(R, v3.sub(p, origin)), s));
  const toScene = q => cleanV(v3.add(mat3.apply(Rt, v3.scale(q, 1 / s)), origin));
  const dirToFoam = v => cleanV(mat3.apply(R, v));
  const dirToScene = v => cleanV(mat3.apply(Rt, v));
  // 4×4（列優先）矩陣，存進 cfd-case.json 給匯入器用
  const m4 = (M, t, k) => [M[0] * k, M[1] * k, M[2] * k, t[0], M[3] * k, M[4] * k, M[5] * k, t[1], M[6] * k, M[7] * k, M[8] * k, t[2], 0, 0, 0, 1].map(clean);
  const tF = v3.scale(mat3.apply(R, v3.scale(origin, -1)), s);
  return {
    up, units, scale: s, origin: origin.slice(), headingDeg: clean(theta / D2R),
    rotation: R, toFoam, toScene, dirToFoam, dirToScene,
    sceneToFoam: m4(R, tF, s),
    foamToScene: m4(Rt, origin, 1 / s),
  };
}

// 4×4（列優先）矩陣套用到點、向量；匯入器用（只靠 cfd-case.json，不必重建 frame）
export function applyPoint(m, p) {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
}
export function rotationOf(m) {
  // 去掉均勻縮放，只留旋轉
  const k = Math.hypot(m[0], m[4], m[8]);
  return [m[0] / k, m[1] / k, m[2] / k, m[4] / k, m[5] / k, m[6] / k, m[8] / k, m[9] / k, m[10] / k];
}

// ---------------------------------------------------------------- 障礙物

// 方向盒（oriented box）：中心、三軸（單位向量，右手系）、半尺寸
export function orientedBoxFromInput(o) {
  if (o.min && o.max) {
    const c = o.min.map((v, i) => (v + o.max[i]) / 2);
    const h = o.min.map((v, i) => Math.abs(o.max[i] - v) / 2);
    return { center: c, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: h };
  }
  if (!o.center || !o.size) throw new Error(`障礙物 ${o.name}：box／plate 要給 center＋size 或 min＋max`);
  let R;
  if (o.type === 'plate' && o.rotation === undefined) {
    // 面板：先平放（長邊沿場景 x、寬邊沿 z、厚度沿 y），tiltDeg 讓 +z 邊抬高（繞 x 軸 -tilt），再繞 y 軸轉 yawDeg
    R = mat3.mul(mat3.rotY((o.yawDeg || 0) * D2R), mat3.rotX(-(o.tiltDeg || 0) * D2R)).map(clean);
  } else {
    R = eulerXYZ(o.rotation || [0, 0, 0]);
  }
  const axes = [0, 1, 2].map(j => [R[j], R[3 + j], R[6 + j]]);
  const size = o.type === 'plate' ? [o.size[0], o.thickness ?? 40, o.size[1]] : o.size;
  return { center: o.center.slice(), axes, half: size.map(v => v / 2) };
}

export function boxCorners({ center, axes, half }) {
  const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push([0, 1, 2].map(i => center[i] + sx * half[0] * axes[0][i] + sy * half[1] * axes[1][i] + sz * half[2] * axes[2][i]));
  }
  return out;
}

// 把場景座標的方向盒轉到 foam
export function boxToFoam(box, frame) {
  return {
    center: frame.toFoam(box.center),
    axes: box.axes.map(a => frame.dirToFoam(a)),
    half: box.half.map(h => clean(h * frame.scale)),
  };
}

// 三軸都和座標軸平行時（允許順序與正負號不同）回傳 min／max，否則 null
export function axisAligned(box) {
  const ext = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const a = box.axes[j];
    const k = a.findIndex(x => Math.abs(Math.abs(x) - 1) < 1e-9);
    if (k < 0) return null;
    ext[k] = box.half[j];
  }
  return { min: box.center.map((c, i) => clean(c - ext[i])), max: box.center.map((c, i) => clean(c + ext[i])) };
}

// searchableRotatedBox 的參數：origin 是盒子角點（區域座標的 0 點），span 是三邊長，e1／e3 是區域 x、z 軸
export function rotatedBoxParams(box) {
  const [e1, e2, e3] = box.axes;
  const origin = [0, 1, 2].map(i => clean(box.center[i] - box.half[0] * e1[i] - box.half[1] * e2[i] - box.half[2] * e3[i]));
  return { span: box.half.map(h => clean(2 * h)), origin, e1: cleanV(e1), e3: cleanV(e3) };
}

export function cylinderFromInput(o) {
  if (o.p1 && o.p2) return { p1: o.p1.slice(), p2: o.p2.slice(), radius: o.radius };
  if (!o.center || !o.height) throw new Error(`障礙物 ${o.name}：cylinder 要給 p1＋p2 或 center＋height（axis 預設 y）`);
  const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[o.axis || 'y'];
  const h = o.height / 2;
  return { p1: v3.sub(o.center, v3.scale(ax, h)), p2: v3.add(o.center, v3.scale(ax, h)), radius: o.radius };
}

export function pointInBox(p, box, margin = 0) {
  const d = v3.sub(p, box.center);
  return box.axes.every((a, j) => Math.abs(v3.dot(d, a)) <= box.half[j] + margin);
}
export function pointInCylinder(p, c, margin = 0) {
  const ax = v3.sub(c.p2, c.p1), L = v3.len(ax), u = v3.scale(ax, 1 / L);
  const t = v3.dot(v3.sub(p, c.p1), u);
  if (t < -margin || t > L + margin) return false;
  const r = v3.len(v3.sub(v3.sub(p, c.p1), v3.scale(u, t)));
  return r <= c.radius + margin;
}

// ---------------------------------------------------------------- STL（ASCII）

function facet(a, b, c) {
  const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
  const l = v3.len(n) || 1;
  const f = x => clean(x).toExponential(7);
  return `  facet normal ${n.map(x => f(x / l)).join(' ')}\n    outer loop\n${[a, b, c].map(p => `      vertex ${p.map(f).join(' ')}\n`).join('')}    endloop\n  endfacet\n`;
}

// 方向盒 → 12 個三角形，法向朝外
export function boxTriangles(box) {
  const C = boxCorners(box); // 索引 = sx*4 + sy*2 + sz（0 為負側）
  const quads = [
    [0, 1, 3, 2], [4, 6, 7, 5], // -x、+x
    [0, 4, 5, 1], [2, 3, 7, 6], // -y、+y
    [0, 2, 6, 4], [1, 5, 7, 3], // -z、+z
  ];
  const tris = [];
  for (const [a, b, c, d] of quads) { tris.push([C[a], C[b], C[c]], [C[a], C[c], C[d]]); }
  // 方向盒的軸若是左手系會讓所有面朝內：用第一個三角形檢查並整體翻面
  const n = v3.cross(v3.sub(tris[0][1], tris[0][0]), v3.sub(tris[0][2], tris[0][0]));
  if (v3.dot(n, v3.sub(tris[0][0], box.center)) < 0) return tris.map(([a, b, c]) => [a, c, b]);
  return tris;
}

export function cylinderTriangles({ p1, p2, radius }, segments = 32) {
  const ax = v3.norm(v3.sub(p2, p1));
  const ref = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = v3.norm(v3.cross(ax, ref)), w = v3.cross(ax, u);
  const ring = (c, k) => v3.add(c, v3.add(v3.scale(u, radius * Math.cos(2 * Math.PI * k / segments)), v3.scale(w, radius * Math.sin(2 * Math.PI * k / segments))));
  const tris = [];
  for (let k = 0; k < segments; k++) {
    const a = ring(p1, k), b = ring(p1, k + 1), c = ring(p2, k + 1), d = ring(p2, k);
    tris.push([a, b, c], [a, c, d]);   // 側面（u→w 逆時針，軸向 ax：法向朝外）
    tris.push([p1, b, a]);             // 底面（朝 -ax）
    tris.push([p2, d, c]);             // 頂面（朝 +ax）
  }
  return tris;
}

export function writeStl(name, tris) {
  return `solid ${name}\n${tris.map(t => facet(...t)).join('')}endsolid ${name}\n`;
}
