// 焊接手臂：DENSO VS-068 或 COBOTTA PRO 900（core 模型）＋快換盤＋TCP。
// 手臂一律「J1 與桶軸同軸、基座朝人孔、手臂伸向桶底」安裝：在桶座標裡手臂局部 +Y＝桶座標 −Y，手臂正前方（J1＝0 的 +X）對準焊點方位 psi。
// 姿態在手臂局部座標求解（IK 只做一次，與載具位置無關）：焊點在 (LINER_R, d, 0)，工具 +Z 朝襯裡。
import * as THREE from 'three';
import { createVS068 } from '@core/models/robots/denso-vs068.js';
import { createCobottaPro900 } from '@core/models/robots/denso-cobotta-pro900.js';
import { LINER_R } from './spec.js';
import { createAtc, ATC_LEN } from './tools.js';
import { TOOL_LEN } from './spec.js';

const D = 180 / Math.PI, J = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
export const ARMS = {
  // d：焊點離基座面的軸向距離；seed：IK 初值（度，試算得到肘部在焊點對側、離桶壁最遠的解）；stowLen：伸直時基座面到 TCP 的長度
  vs068: { name: 'DENSO VS-068', d: 600, seed: { j1: 0, j2: 34.7, j3: -38.8, j4: 0, j5: 4.1, j6: 180 }, reach: 710 },
  cobotta: { name: 'DENSO COBOTTA PRO 900', d: 1000, seed: { j1: 0, j2: 27.7, j3: 16.1, j4: 0, j5: -43.8, j6: -180 }, reach: 900 },
};
export const STOW = { j1: 0, j2: 0, j3: 90, j4: 0, j5: 0, j6: 0 };   // 伸直：整支手臂與工具沿桶軸，穿過人孔用

export function createWelderArm(kind, psi) {
  const spec = ARMS[kind];
  const arm = kind === 'vs068' ? createVS068({ q: STOW, name: 'robot' }) : createCobottaPro900({ q: STOW });
  const mountTool = arm.tool || arm.mount, L = arm.L;
  const set = deg => { for (const n of J) if (deg[n] != null) arm.q[n] = deg[n] / D; arm.apply(); };
  const { cplg, tcp } = createAtc(mountTool);
  // 安裝座：桶座標中 Ry(−psi)·Rx(π)（手臂 +Y → 桶 −Y，手臂 +X → 方位 psi）
  const mount = new THREE.Group(); mount.name = 'arm-mount'; mount.add(arm.root);
  arm.root.quaternion.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
  const yaw = new THREE.Group(); yaw.name = 'arm-yaw'; yaw.rotation.y = -psi; yaw.add(mount);
  const stowLen = L.base + L.shoulderY + L.upper + L.fore + L.wrist2 + L.flange + ATC_LEN + TOOL_LEN;

  // 手臂局部座標的目標 → 關節角（度）；marker 是要對到目標的點（tcp 或結合面 cplg），Z／X 是工具 +Z、+X 在手臂局部的方向
  function solve(target, Z, X, seeds, marker = tcp) {
    arm.root.updateMatrixWorld(true);
    const wq = arm.root.getWorldQuaternion(new THREE.Quaternion());
    const z = new THREE.Vector3(...Z).normalize(), x = new THREE.Vector3(...X).normalize(), y = z.clone().cross(x);
    const q = wq.multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)));
    const goal = arm.root.localToWorld(new THREE.Vector3(...target));
    let best = null;
    for (const s of seeds) {
      set(s); arm.ik.solve(marker, goal, q, 400); arm.apply();
      const e = marker.getWorldPosition(new THREE.Vector3()).distanceTo(goal);
      const a = 2 * Math.acos(Math.min(1, Math.abs(mountTool.getWorldQuaternion(new THREE.Quaternion()).dot(q)))) * D;
      if (!best || e + a < best.err + best.ang) best = { err: e, ang: a, pose: Object.fromEntries(J.map(n => [n, arm.q[n] * D])) };
    }
    set(STOW);
    return best;
  }
  // 與參考姿態最接近的等價角（J4、J6 可差 360°）
  function near(pose, ref) {
    const out = { ...pose };
    for (const n of ['j4', 'j6']) for (const k of [-360, 360]) { const v = out[n] + k; if (v >= arm.limits[n][0] && v <= arm.limits[n][1] && Math.abs(v - ref[n]) < Math.abs(out[n] - ref[n])) out[n] = v; }
    return out;
  }
  // 焊接、退刀（tuck：TCP 退到半徑 330）姿態
  const d = spec.d, R = LINER_R;
  const weldC = solve([R, d, 0], [1, 0, 0], [0, 0, 1], [spec.seed]);
  const weldL = solve([R, d, 0], [1, 0, 0], [0, -1, 0], [weldC.pose, spec.seed]);
  const tuck = solve([330, d - 40, 0], [1, 0, 0], [0, 0, 1], [weldC.pose]);
  weldL.pose = near(weldL.pose, weldC.pose); tuck.pose = near(tuck.pose, weldC.pose);
  const poses = { weldC, weldL, tuck };

  return { kind, spec, arm, root: arm.root, mount, yaw, tool: mountTool, tcp, cplg, set, solve, near, poses, stowLen, d, parts: arm.parts || arm.armParts || [] };
}
