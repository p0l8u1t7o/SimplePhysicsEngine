// FANUC M-710iC/45M 六軸手臂本體（不含工具）。共用模型，原用於 SolarDismantling。
// 型錄值：負載 45 kg、最大伸展 2606 mm（到 J5 中心）、重複精度 ±0.06 mm、本體約 570 kg；
// 手腕容許力矩／慣量 J4 206 N·m／28 kg·m²、J5 206／28、J6 127／20。
// 臂長為推估值（以同系列 M-710iC/50 的 J1–J2 偏移 150、J2 高 565、J3 偏移 170 為準，上臂 1150、前臂 1295 湊出 2606 mm 伸展）；
// 關節零點方向與連動限位為假設，採用前須以 FANUC 型錄／CAD 核對。
// 局部座標：原點在底座底面中心，+Y 向上；零位時上臂垂直、前臂與法蘭面朝 +X。
// 關節：j1 繞 Y，j2／j3／j5 繞 Z，j4／j6 繞 X（與 core/robot/kinematics.js 一致）。
// 工具掛在 arm.flange（法蘭面中心，軸向 +X）；IK 解算器見 arm.createSolver（介面與 fanuc-r2000ic.js 相同）。
import * as THREE from 'three';
import { createIK } from '../../robot/kinematics.js';
import { D2R, block, cylinder } from '../../geom/shapes.js';
import { MAT } from '../../geom/materials.js';
import { bolts, housing } from '../../geom/hardware.js';

export const K = { j2h: 565, j1x: 150, upper: 1150, foreOff: 170, fore: 1295, wrist: 140, flange: 35 };
// 模型座標的關節範圍：j2 = −J2（FANUC J2 −90～+135，取保守值）；j3 為相對上臂，連動限位尚未建模
export const LIMITS = { j1: [-180, 180], j2: [-90, 90], j3: [-80, 200], j4: [-360, 360], j5: [-125, 125], j6: [-360, 360] };
export const SPEED = { j1: 175, j2: 175, j3: 175, j4: 250, j5: 250, j6: 355 };   // deg/s，概略值
export const JOINTS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
// 中大型手臂：沿用 R-2000 模型的姿態權重與阻尼
export const IK_OPTIONS = { weight: 400, iterations: 30, lambda: [20, 4], step: .2, tol: [.05, .0005] };
// 型錄的負載能力（選型評估用）
export const RATING = { payload: 45, reach: 2606, weight: 570, moment: { j4: 206, j5: 206, j6: 127 }, inertia: { j4: 28, j5: 28, j6: 20 } };

// 建立手臂本體。root 可平移，也可繞 Y 旋轉（底座水平；幾何初始解在底座座標計算）。
// 旋轉底座可以把 J1 的 ±180° 分界轉到不需要經過的方向（例如圍籬側）。
export function createArm({ name = 'robot' } = {}) {
  const root = new THREE.Group(); root.name = name;
  const j = {};
  block(root, [760, 50, 760], [0, 25, 0], MAT.fanucDark);                                        // 底板
  cylinder(root, 300, 230, [0, 165, 0], MAT.fanuc, 'y', 36);                                     // 底座
  j.j1 = new THREE.Group(); root.add(j.j1);
  cylinder(j.j1, 270, 170, [0, 365, 0], MAT.fanuc, 'y', 36);                                     // J1 轉座
  block(j.j1, [330, 220, 300], [70, 470, 0], MAT.fanuc);
  cylinder(j.j1, 190, 420, [K.j1x, K.j2h, 0], MAT.fanuc, 'z', 32);                               // J2 減速機座
  cylinder(j.j1, 110, 180, [K.j1x - 40, K.j2h - 40, -300], MAT.fanucDark, 'z', 20);             // J2 馬達
  j.j2 = new THREE.Group(); j.j2.position.set(K.j1x, K.j2h, 0); j.j1.add(j.j2);
  housing(j.j2, 230, K.upper - 160, 220, MAT.fanuc, 0, K.upper / 2, 100, 22);                   // 上臂
  cylinder(j.j2, 165, 220, [0, 0, 110], MAT.fanuc, 'z', 28);
  cylinder(j.j2, 150, 300, [0, K.upper, 80], MAT.fanuc, 'z', 28);
  j.j3 = new THREE.Group(); j.j3.position.set(0, K.upper, 0); j.j2.add(j.j3);
  housing(j.j3, 430, 300, 280, MAT.fanuc, -60, 110, -40, 24);                                    // J3 殼體
  for (const [y, z] of [[60, -120], [190, -120]]) cylinder(j.j3, 70, 170, [-330, y, z], MAT.fanucDark, 'x', 18);   // J3／J4 馬達
  housing(j.j3, K.fore - 260 - 150, 190, 190, MAT.fanuc, (150 + K.fore - 260) / 2, K.foreOff, 0, 18);   // 前臂
  j.j4 = new THREE.Group(); j.j4.position.set(K.fore - 260, K.foreOff, 0); j.j3.add(j.j4);
  cylinder(j.j4, 115, 160, [80, 0, 0], MAT.fanuc, 'x', 28);
  for (const s of [-1, 1]) block(j.j4, [130, 130, 32], [200, 0, s * 90], MAT.fanuc);             // 手腕叉
  j.j5 = new THREE.Group(); j.j5.position.set(260, 0, 0); j.j4.add(j.j5);
  cylinder(j.j5, 88, 145, [0, 0, 0], MAT.fanuc, 'z', 24);
  cylinder(j.j5, 80, 110, [62, 0, 0], MAT.fanuc, 'x', 24);
  j.j6 = new THREE.Group(); j.j6.position.set(K.wrist, 0, 0); j.j5.add(j.j6);
  cylinder(j.j6, 75, K.flange, [K.flange / 2, 0, 0], MAT.fanucDark, 'x', 24);
  const flange = new THREE.Object3D(); flange.name = 'flange'; flange.position.x = K.flange; j.j6.add(flange);

  // 錨栓、減速機端蓋與螺栓，跟隨各自關節
  bolts(root, [-1, 1].flatMap(x => [-1, 1].map(z => [x * 320, 58, z * 320])), 18);
  for (const [parent, x, y, z, radius] of [[j.j2, 0, 0, 221, 120], [j.j2, 0, K.upper, 231, 110], [j.j5, 0, 0, 73, 60]]) {
    cylinder(parent, radius, 10, [x, y, z], MAT.steelDark, 'z', 28);
    bolts(parent, Array.from({ length: 8 }, (_, k) => [x + Math.cos(k * Math.PI / 4) * radius * .78, y + Math.sin(k * Math.PI / 4) * radius * .78, z + 10]), 7, 'z');
  }

  const q = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 };   // rad
  function apply() {
    j.j1.rotation.set(0, q.j1, 0); j.j2.rotation.set(0, 0, q.j2); j.j3.rotation.set(0, 0, q.j3);
    j.j4.rotation.set(q.j4, 0, 0); j.j5.rotation.set(0, 0, q.j5); j.j6.rotation.set(q.j6, 0, 0);
    root.updateMatrixWorld(true);
  }
  apply();
  function setJoints(c) { for (const n of JOINTS) q[n] = c[n]; apply(); }

  // 各連桿中心線（碰撞檢查用）：[起點, 終點, 半徑]；給 toolEnd 時再加一段法蘭→工具端
  const pts = ['j2', 'j3', 'j4', 'j5', 'j6'].map(() => new THREE.Vector3());
  function links(toolEnd = null, toolRadius = 200) {
    ['j2', 'j3', 'j4', 'j5', 'j6'].forEach((n, i) => j[n].getWorldPosition(pts[i]));
    const elbowOff = j.j3.localToWorld(new THREE.Vector3(0, K.foreOff, 0));
    const out = [[pts[0], pts[1], 140], [pts[1], elbowOff, 160], [elbowOff, pts[2], 110], [pts[2], pts[3], 110], [pts[3], pts[4], 90]];
    if (toolEnd) out.push([pts[4], toolEnd, toolRadius]);
    return out;
  }

  // IK 解算器（與 fanuc-r2000ic.js 同一套）：tool 為掛在 flange 下的工具座標（姿態目標），tcp 為 tool 的直接子物件（位置目標）。
  // approach：tool 局部座標中與法蘭軸（flange +X）同向的單位向量；toFlange：tool → flange 的旋轉。
  function createSolver({ tool, tcp, approach = null, toFlange = null }) {
    toFlange = toFlange || tool.quaternion.clone().invert();
    approach = approach || new THREE.Vector3(1, 0, 0).applyQuaternion(toFlange);
    const ik = createIK({ q, j, tool, apply, limits: LIMITS, ...IK_OPTIONS });
    const wrapJ = (n, v) => { const [lo, hi] = LIMITS[n].map(x => x * D2R); for (const k of [0, 2 * Math.PI, -2 * Math.PI]) if (v + k >= lo && v + k <= hi) return v + k; return THREE.MathUtils.clamp(v, lo, hi); };
    // 幾何初始解：肘上／肘下 × 手腕翻轉共四組
    function seeds(pose) {
      const dir = approach.clone().applyQuaternion(pose.rot);
      const origin = pose.target.clone().sub(tcp.position.clone().applyQuaternion(pose.rot));
      const base = root.quaternion.clone(), unbase = base.clone().invert();   // 底座只繞 Y 旋轉
      const w = origin.addScaledVector(dir, -(K.wrist + K.flange)).sub(root.position).applyQuaternion(unbase).sub(new THREE.Vector3(0, K.j2h, 0));
      const radial = Math.hypot(w.x, w.z) - K.j1x, a = K.upper, b = Math.hypot(K.fore, K.foreOff), phi = Math.atan2(K.foreOff, K.fore);
      const j1 = Math.atan2(-w.z, w.x), elbow = Math.acos(THREE.MathUtils.clamp((radial * radial + w.y * w.y - a * a - b * b) / (2 * a * b), -1, 1)), out = [];
      for (const beta of [-elbow, elbow]) {
        const j2 = Math.atan2(w.y, radial) - Math.atan2(b * Math.sin(beta), a + b * Math.cos(beta)) - Math.PI / 2, j3 = beta + Math.PI / 2 - phi;
        const shoulder = base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), j1)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), j2 + j3));
        const rel = shoulder.invert().multiply(pose.rot).multiply(toFlange);
        const m = new THREE.Matrix4().makeRotationFromQuaternion(rel).elements;
        const j5 = Math.acos(THREE.MathUtils.clamp(m[0], -1, 1));
        let j4 = 0, j6 = Math.atan2(m[6], m[5]); if (Math.sin(j5) > 1e-5) { j4 = Math.atan2(m[2], m[1]); j6 = Math.atan2(m[8], -m[4]); }
        for (const [w4, w5, w6] of [[j4, j5, j6], [j4 + Math.PI, -j5, j6 + Math.PI]]) {
          const c = { j1, j2, j3, j4: w4, j5: w5, j6: w6 }; for (const n of JOINTS) c[n] = wrapJ(n, c[n]); out.push(c);
        }
      }
      return out;
    }
    const _p = new THREE.Vector3(), _r = new THREE.Quaternion();
    function error(pose) {
      tcp.getWorldPosition(_p); tool.getWorldQuaternion(_r);
      return { position: _p.distanceTo(pose.target), angle: _r.angleTo(pose.rot) / D2R };
    }
    const dist = (a, b) => JOINTS.reduce((s, n) => s + Math.abs(a[n] - b[n]), 0);
    const within = c => JOINTS.every(n => c[n] >= LIMITS[n][0] * D2R - 1e-9 && c[n] <= LIMITS[n][1] * D2R + 1e-9);
    const cache = new WeakMap();
    // 位姿 → 關節角（結果快取在位姿物件上；有參考解時取最接近的等價解，避免手腕多轉一圈）
    function solve(pose, ref = null) {
      const hit = cache.get(pose); if (hit) return hit;
      let best = null, score = Infinity, near = null, nearD = Infinity;
      for (const c of ref ? [ref, ...seeds(pose)] : seeds(pose)) {
        for (const n of JOINTS) q[n] = c[n]; apply(); ik.solve(tcp, pose.target, pose.rot, 120);
        const e = error(pose), v = e.position + e.angle * 10;
        if (v < score) { score = v; best = { ...q }; }
        if (v < .1) { if (!ref) break; const d = dist(q, ref); if (d < nearD) { nearD = d; near = { ...q }; } }
      }
      for (const n of JOINTS) q[n] = (near || best)[n];
      if (ref) {
        let pick = { ...q }, pickD = dist(q, ref);
        for (const [d4, s5, d6] of [[0, 1, 0], [Math.PI, -1, Math.PI], [Math.PI, -1, -Math.PI], [-Math.PI, -1, Math.PI], [-Math.PI, -1, -Math.PI]])
          for (const k4 of [0, 2 * Math.PI, -2 * Math.PI]) for (const k6 of [0, 2 * Math.PI, -2 * Math.PI]) {
            const c = { ...q, j4: q.j4 + d4 + k4, j5: s5 * q.j5, j6: q.j6 + d6 + k6 };
            if (within(c)) { const d = dist(c, ref); if (d < pickD - 1e-9) { pickD = d; pick = c; } }
          }
        for (const n of JOINTS) q[n] = pick[n];
      }
      apply();
      const out = { ...q, err: error(pose) };
      cache.set(pose, out); return out;
    }
    // 從鄰近種子追蹤直線／擺動路徑上的中間位姿（不快取）
    function track(pose, seed) {
      for (const n of JOINTS) q[n] = seed[n]; apply(); ik.solve(tcp, pose.target, pose.rot, 40);
      return { ...q, err: error(pose) };
    }
    return { ik, seeds, solve, track, error };
  }

  return { root, j, flange, q, apply, setJoints, links, createSolver };
}

// ---------------------------------------------------------------- 模型目錄
// 目錄的關節範圍比 LIMITS 窄，避免任意組合時本體自撞（J2／J3 連動限位尚未建模）。
export const meta = {
  id: 'fanuc-m710ic', name: 'FANUC M-710iC/45M 六軸手臂', category: '機械手臂', source: 'SolarDismantling',
  params: {
    pedestal: { value: 0, min: 0, max: 1500, step: 10, unit: 'mm', label: '底座台高' },
  },
  states: {
    j1: { value: 0, min: LIMITS.j1[0], max: LIMITS.j1[1], unit: '°', label: 'J1 旋轉' },
    j2: { value: 0, min: -60, max: 60, unit: '°', label: 'J2 下臂（模型座標 = −J2）' },
    j3: { value: 0, min: -30, max: 150, unit: '°', label: 'J3 上臂（相對下臂）' },
    j4: { value: 0, min: -180, max: 180, unit: '°', label: 'J4 前臂旋轉' },
    j5: { value: 0, min: -100, max: 100, unit: '°', label: 'J5 手腕擺動' },
    j6: { value: 0, min: -180, max: 180, unit: '°', label: 'J6 法蘭旋轉' },
  },
  usage: "import { createArm, K, LIMITS, SPEED, JOINTS, RATING } from '@core/models/robots/fanuc-m710ic.js';\nconst arm = createArm({ name: 'robot' }); arm.root.position.set(x, 0, z); scene.add(arm.root);\nconst tool = new THREE.Group(); arm.flange.add(tool);   // 工具掛在法蘭（+X 為法蘭軸）\nconst tcp = new THREE.Object3D(); tool.add(tcp);\nconst s = arm.createSolver({ tool, tcp }); const c = s.solve({ target, rot }); arm.setJoints(c);",
};

export function create(p = {}) {
  const P = { ...Object.fromEntries(Object.entries(meta.params).map(([k, v]) => [k, v.value])), ...p };
  const root = new THREE.Group(); root.name = 'fanuc-m710ic';
  if (P.pedestal > 0) block(root, [800, P.pedestal, 800], [0, P.pedestal / 2, 0], MAT.steelDark);
  const arm = createArm({ name: 'arm' }); arm.root.position.y = P.pedestal; root.add(arm.root); arm.apply();
  return {
    root, arm,
    set(s = {}) { arm.setJoints(Object.fromEntries(JOINTS.map(n => [n, (s[n] ?? meta.states[n].value) * D2R]))); },
  };
}
