// 手臂可達檢查（評估平台 Q9）：工作點在不在手臂到得了的範圍。回傳的列可以直接放進 layoutChecks。
//   reachByIK(arm, tcp, points, { quaternion, iters, tol })     有 arm.ik.solve 的 6 軸手臂（core/models/robots 的 VS-068、VM-60B1、COBOTTA PRO 900）：
//        每個點用手臂的幾組幾何初值（arm.seeds；COBOTTA 是 arm.seedJoints，兩種手肘都試）加上目前姿態各解一次 IK，
//        位置誤差 ≤ tol（mm）就算到得了；quaternion 是工具姿態（預設工具朝下）。
//        幾何初值沒考慮 arm.root 的旋轉，基座轉了角度時主要靠目前姿態那一組，判定可能偏保守。
//        FANUC 的 createArm() 沒有 arm.ik（解算器在 arm.createSolver），不能直接用；粗估改用 reachByEnvelope。
//   reachByEnvelope({ base, rMin, rMax, yMin, yMax }, points)   SCARA、並聯手臂或只想粗估時：以基座為中心的圓環柱（水平半徑、高度範圍）
//   points：[{ name, pos: [x, y, z]（世界座標 mm）, quaternion? }]
// 會改動手臂的關節角，檢查完呼叫端自己恢復（或在 apply(t) 前跑）。
import * as THREE from 'three';

const down = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));      // 工具 +Z（前進方向）朝下
const fmt = v => Math.round(v * 10) / 10;

// 手臂的幾何初值：VS-068、VM-60B1 是 seeds(origin, q)；COBOTTA 是 seedJoints(origin, q, { elbowDown })，兩種手肘都取。都回傳陣列
function seedsOf(arm) {
  if (arm.seeds) return (t, q) => arm.seeds(t, q);
  if (arm.seedJoints) return (t, q) => [false, true].flatMap(elbowDown => arm.seedJoints(t, q, { elbowDown }) || []);
  return () => [];
}

export function reachByIK(arm, tcp, points, { quaternion = down, iters = 120, tol = 1, group = '可達' } = {}) {
  if (!arm?.ik?.solve) throw new Error('reachByIK 需要有 arm.ik.solve 的手臂（FANUC 的 createArm 請改用 reachByEnvelope，或自己包一層 { root, q, apply, ik }）');
  const save = { ...arm.q }, origin = new THREE.Vector3(), target = new THREE.Vector3(), got = new THREE.Vector3(), geometric = seedsOf(arm);
  arm.root.updateMatrixWorld(true); arm.root.getWorldPosition(origin);
  const rows = points.map(p => {
    const q = p.quaternion ? new THREE.Quaternion(...(p.quaternion.isQuaternion ? p.quaternion.toArray() : p.quaternion)) : quaternion;
    target.set(...p.pos);
    let best = Infinity;
    // 初值：工具安裝座在目標點時的幾何解，最後再試目前姿態（基座有旋轉、幾何解偏掉時靠它）
    const seeds = [...geometric(target, q), { ...save }];
    for (const s of seeds) {
      Object.assign(arm.q, s); arm.ik.solve(tcp, target, q, iters); arm.apply(); arm.root.updateMatrixWorld(true);
      best = Math.min(best, tcp.getWorldPosition(got).distanceTo(target));
      if (best <= tol) break;
    }
    return { group, name: p.name, ok: best <= tol, value: best <= tol ? `誤差 ${fmt(best)} mm` : `差 ${fmt(best)} mm`, note: best <= tol ? '' : '工作點超出手臂範圍或姿態到不了（換位置、加高或換臂長）' };
  });
  Object.assign(arm.q, save); arm.apply(); arm.root.updateMatrixWorld(true);
  return rows;
}

export function reachByEnvelope({ base = [0, 0, 0], rMin = 0, rMax, yMin = -Infinity, yMax = Infinity }, points, { group = '可達' } = {}) {
  return points.map(p => {
    const r = Math.hypot(p.pos[0] - base[0], p.pos[2] - base[2]), y = p.pos[1];
    const ok = r >= rMin && r <= rMax && y >= yMin && y <= yMax;
    const margin = Math.min(r - rMin, rMax - r, y - yMin, yMax - y);
    return { group, name: p.name, ok, value: `半徑 ${fmt(r)} mm、高 ${fmt(y)} mm`, note: ok ? `餘裕 ${fmt(margin)} mm` : `範圍：半徑 ${rMin}～${rMax} mm、高 ${yMin}～${yMax} mm` };
  });
}
