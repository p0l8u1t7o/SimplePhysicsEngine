// 支架的 3D：每種構件（kind＋斷面）一個 InstancedMesh，斷面用真實輪廓擠出（長度 1，沿實例矩陣縮放）。
// 只用長期穩定的 three API：ExtrudeGeometry、BoxGeometry、InstancedMesh、Matrix4（makeBasis／makeRotationAxis／compose）。
import * as THREE from 'three';
import { MAT, std } from '../geom/materials.js';
import { defaults } from '../models/util.js';
import { profile } from './profiles.js';
import { layoutFixedRack } from './rack.js';
import { layoutTracker } from './tracker.js';
import { structureChecks } from './checks.js';

// 熱浸鍍鋅鋼與模組的預設材質（之後可以搬進 MAT）
export const STRUCT_MAT = {
  galv: std(0xaab4ba, .42, .75),
  module: std(0x1b2a44, .32, .25),
};

// 斷面輪廓（局部 x＝翼板方向、y＝腹板方向，以外框中心為原點）
export function sectionShape(p) {
  const s = new THREE.Shape(), poly = pts => { s.moveTo(...pts[0]); for (const q of pts.slice(1)) s.lineTo(...q); s.closePath(); return s; };
  const { h, b, t } = p;
  switch (p.type) {
    case 'C': {
      const c = p.c ?? 0, X = b / 2, Y = h / 2;
      if (c > 0) return poly([[-X, -Y], [X, -Y], [X, -Y + c], [X - t, -Y + c], [X - t, -Y + t], [-X + t, -Y + t], [-X + t, Y - t], [X - t, Y - t], [X - t, Y - c], [X, Y - c], [X, Y], [-X, Y]]);
      return poly([[-X, -Y], [X, -Y], [X, -Y + t], [-X + t, -Y + t], [-X + t, Y - t], [X, Y - t], [X, Y], [-X, Y]]);
    }
    case 'Z': {
      const c = p.c ?? 0, Y = h / 2, B = b - t / 2;
      return poly([[-t / 2, Y], [B, Y], [B, Y - c], [B - t, Y - c], [B - t, Y - t], [t / 2, Y - t], [t / 2, -Y], [-B, -Y], [-B, -Y + c], [-B + t, -Y + c], [-B + t, -Y + t], [-t / 2, -Y + t]]);
    }
    case 'H': {
      const X = b / 2, Y = h / 2, w = p.tw / 2, f = p.tf;
      return poly([[-X, -Y], [X, -Y], [X, -Y + f], [w, -Y + f], [w, Y - f], [X, Y - f], [X, Y], [-X, Y], [-X, Y - f], [-w, Y - f], [-w, -Y + f], [-X, -Y + f]]);
    }
    case 'SHS': case 'RHS': {
      const X = b / 2, Y = (h ?? b) / 2;
      poly([[-X, -Y], [X, -Y], [X, Y], [-X, Y]]);
      const hole = new THREE.Path(); hole.moveTo(-X + t, -Y + t); hole.lineTo(-X + t, Y - t); hole.lineTo(X - t, Y - t); hole.lineTo(X - t, -Y + t); hole.closePath();
      s.holes.push(hole); return s;
    }
    case 'CHS': {
      s.absarc(0, 0, p.D / 2, 0, Math.PI * 2, false);
      const hole = new THREE.Path(); hole.absarc(0, 0, p.D / 2 - t, 0, Math.PI * 2, true); s.holes.push(hole); return s;
    }
    default: throw new Error(`未知的斷面型式 ${p.type}`);
  }
}

// 斷面擠出幾何（長度 1，沿 +Z 置中），依斷面 id 快取共用
const geoCache = new Map();
export function profileGeometry(prof) {
  const p = profile(prof);
  if (!geoCache.has(p.id)) {
    const g = new THREE.ExtrudeGeometry(sectionShape(p), { depth: 1, bevelEnabled: false, curveSegments: p.type === 'CHS' ? 16 : 1 });
    g.translate(0, 0, -.5); geoCache.set(p.id, g);
  }
  return geoCache.get(p.id);
}

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
// 構件 → 實例矩陣：局部 z 沿構件、局部 y 沿 up（腹板方向），z 方向縮放成長度
export function memberMatrix(a, b, up, out = new THREE.Matrix4()) {
  _z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const L = _z.length(); _z.multiplyScalar(1 / L);
  _y.set(up[0], up[1], up[2]); _y.addScaledVector(_z, -_y.dot(_z));
  if (_y.lengthSq() < 1e-8) { _y.set(Math.abs(_z.x) < .9 ? 1 : 0, Math.abs(_z.x) < .9 ? 0 : 1, 0); _y.addScaledVector(_z, -_y.dot(_z)); }
  _y.normalize(); _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
  return out.compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, L));
}

// layout（layoutFixedRack／layoutTracker 的結果）→ { root, meshes, set }
//   options: { materials: { galv, module }, modules = true, buried = true（畫出埋入段）, name }
export function buildStructure(layout, { materials = {}, modules = true, buried = true, name = null, id = layout.kind === 'fixed' ? 'pv-fixed-rack' : 'pv-tracker' } = {}) {
  const mats = { ...STRUCT_MAT, ...materials };
  const root = new THREE.Group(); root.name = name ?? id; root.userData.coreModel = id;
  const groups = new Map();
  for (const m of layout.members) { const k = m.kind + '|' + m.profile; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const meshes = {}, rotating = [];
  for (const [k, list] of groups) {
    const [kind, prof] = k.split('|');
    const mesh = new THREE.InstancedMesh(profileGeometry(prof), mats[kind] ?? mats.galv, list.length);
    mesh.name = `${kind} ${prof}`; mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.structureKind = kind; mesh.userData.members = list.map(m => m.id);
    const M = new THREE.Matrix4();
    list.forEach((m, i) => {
      const a = !buried && m.kind === 'pile' ? [m.a[0], m.ground, m.a[2]] : m.a;
      memberMatrix(a, m.b, m.up, M); mesh.setMatrixAt(i, M);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    root.add(mesh); meshes[`${kind}:${prof}`] = mesh;
    if (list.some(m => m.pivot)) rotating.push({ mesh, base: list.map((m, i) => { const B = new THREE.Matrix4(); mesh.getMatrixAt(i, B); return B; }), pivots: list.map(m => m.pivot) });
  }
  if (modules && layout.modules.length) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.module, layout.modules.length);
    mesh.name = 'pv modules'; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.structureKind = 'module';
    mesh.userData.members = layout.modules.map(m => m.id);
    const M = new THREE.Matrix4(), S = new THREE.Vector3(), P = new THREE.Vector3();
    layout.modules.forEach((m, i) => {
      _x.set(...m.tx); _y.set(...m.n); _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
      M.compose(P.set(...m.center), _q, S.set(m.size[0], m.size[2], m.size[1])); mesh.setMatrixAt(i, M);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    root.add(mesh); meshes.module = mesh;
    if (layout.modules.some(m => m.pivot)) rotating.push({ mesh, base: layout.modules.map((m, i) => { const B = new THREE.Matrix4(); mesh.getMatrixAt(i, B); return B; }), pivots: layout.modules.map(m => m.pivot) });
  }
  // 追日轉角：可動件繞各自的轉軸（通過 pivot.p、方向 pivot.d）旋轉
  const R = new THREE.Matrix4(), T = new THREE.Matrix4(), Ti = new THREE.Matrix4(), out = new THREE.Matrix4(), axis = new THREE.Vector3();
  let angle = 0;
  function setAngle(deg) {
    angle = deg; const a = deg * Math.PI / 180;
    for (const { mesh, base, pivots } of rotating) {
      for (let i = 0; i < base.length; i++) {
        const pv = pivots[i];
        if (!pv) { mesh.setMatrixAt(i, base[i]); continue; }
        T.makeTranslation(pv.p[0], pv.p[1], pv.p[2]); Ti.makeTranslation(-pv.p[0], -pv.p[1], -pv.p[2]);
        R.makeRotationAxis(axis.set(...pv.d), a);
        out.multiplyMatrices(T, R).multiply(Ti).multiply(base[i]); mesh.setMatrixAt(i, out);
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    }
  }
  return { root, meshes, set: s => { if (s && s.angle != null) setAngle(s.angle); }, angle: () => angle };
}

// ---------------------------------------------------------------- 模型（照 core/models 的 meta＋create 慣例）
const common = {
  tilt: { value: 20, min: 0, max: 45, step: 1, unit: '°', label: '傾角' },
};
export const pvFixedRack = {
  meta: {
    id: 'pv-fixed-rack', name: '固定式光伏支架（依地形）', category: '光伏結構',
    params: {
      ...common,
      up: { value: 2, min: 1, max: 4, step: 1, unit: '片', label: '坡向片數' },
      across: { value: 20, min: 2, max: 60, step: 1, unit: '片', label: '每桌沿列片數' },
      rows: { value: 3, min: 1, max: 20, step: 1, unit: '列', label: '列數' },
      pitch: { value: 7500, min: 3000, max: 15000, step: 100, unit: 'mm', label: '列距' },
      clearance: { value: 600, min: 200, max: 2500, step: 50, unit: 'mm', label: '模組下緣離地' },
      pileSpacing: { value: 4000, min: 2000, max: 8000, step: 100, unit: 'mm', label: '框架間距上限' },
    },
    options: {
      module: '{ L, W, T, kg, wp }：模組尺寸 mm、重量 kg、瓦數（示意預設 2278×1134×35、28 kg、580 Wp）',
      orientation: "'portrait'（長邊沿坡向）｜'landscape'", height: '(x, z) => 地面高度 mm（預設平地）',
      profiles: '{ pile, rafter, purlin, brace }：斷面 id（見 profiles.js）或自訂斷面物件',
      pile: '{ embed（固定埋深）或 length（固定樁長）, minEmbed, maxReveal }',
      materials: '{ galv, module }', modules: 'false 不畫模組', buried: 'false 只畫基樁外露段',
    },
    usage: "import { pvFixedRack } from '@core/structure/index.js';\nconst rack = pvFixedRack.create({ tilt: 20, height: (x, z) => 地形(x, z) }); scene.add(rack.root);\nrack.bom.byProfile; rack.members; rack.checks()  // layoutChecks 列",
  },
  create(p = {}) {
    const layout = layoutFixedRack({ ...defaults(pvFixedRack.meta), ...p });
    const b = buildStructure(layout, p);
    return { ...b, layout, members: layout.members, bom: layout.bom, summary: layout.summary, meta: pvFixedRack.meta, checks: limits => structureChecks(layout, limits) };
  },
};

export const pvTracker = {
  meta: {
    id: 'pv-tracker', name: '單軸追日支架（依地形）', category: '光伏結構',
    params: {
      across: { value: 60, min: 4, max: 120, step: 1, unit: '片', label: '每列片數' },
      rows: { value: 3, min: 1, max: 20, step: 1, unit: '列', label: '列數' },
      pitch: { value: 5500, min: 3000, max: 12000, step: 100, unit: 'mm', label: '軸距' },
      maxAngle: { value: 60, min: 30, max: 75, step: 1, unit: '°', label: '最大轉角' },
      clearance: { value: 500, min: 200, max: 2000, step: 50, unit: 'mm', label: '最大轉角時離地' },
      pileSpacing: { value: 7000, min: 4000, max: 10000, step: 100, unit: 'mm', label: '樁距上限' },
    },
    states: { angle: { value: 0, min: -60, max: 60, unit: '°', label: '轉角' } },
    options: {
      follow: "'line'（每列一直線）｜'terrain'（跟地形，樁外露相同）", up: '1（1P）或 2（2P）', height: '(x, z) => 地面高度 mm',
      profiles: '{ pile, tube, rail }', pile: '{ embed 或 length, minEmbed, maxReveal }', materials: '{ galv, module }', modules: 'false 不畫模組',
    },
    usage: "import { pvTracker } from '@core/structure/index.js';\nconst trk = pvTracker.create({ follow: 'terrain', height }); scene.add(trk.root);\ntrk.set({ angle: 35 });   // φ > 0 模組往 +Z 傾",
  },
  create(p = {}) {
    const layout = layoutTracker({ ...defaults(pvTracker.meta), ...p });
    const b = buildStructure(layout, p);
    return { ...b, layout, members: layout.members, bom: layout.bom, summary: layout.summary, meta: pvTracker.meta, checks: limits => structureChecks(layout, limits) };
  },
};
