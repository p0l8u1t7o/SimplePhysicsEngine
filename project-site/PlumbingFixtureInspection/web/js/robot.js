// DENSO VM-60B1（共用模型 @core/models/robots/denso-vm60b1.js）＋氣動快換器主側＋轉接頭（內撐式／筒夾式；依夾持介面分，不依料號）。
// 本檔只放快換器、轉接頭、TCP 與逆解選解；手臂本體、限位、IK、幾何初始解在共用模型。
// 座標：手臂工具安裝座 arm.tool 的 +Z 為法蘭前進方向；轉接頭座標同工具座標（快換盤貼法蘭時兩者重合）。
// 產品在轉接頭上：產品 +Y（安裝軸）＝轉接頭 +Z，產品原點（安裝端面中心）在轉接頭 z = mount。
import * as THREE from 'three';
import { createVM60B1, JOINTS, JOINT_SPEED, LIMITS } from '@core/models/robots/denso-vm60b1.js';
import { cylinder, block, D2R } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { ROBOT, QC, ADAPTERS } from './layout.js';

export { JOINTS, JOINT_SPEED };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// 產品座標 → 轉接頭座標：繞 X 轉 +90°（產品 +Y → 轉接頭 +Z）
export const PRODUCT_IN_TOOL = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2);

// 轉接頭（工具側快換盤＋本體＋夾持頭＋ID 標籤）。kind：mandrel／collet。原點在快換盤背面（貼主側的面）。
export function createAdapter(kind, name = 'adapter') {
  const A = ADAPTERS[kind], g = new THREE.Group(); g.name = name; g.userData.kind = kind;
  const z0 = QC.master;                                   // 轉接頭座標與工具座標相同：快換盤從 z = 42 開始
  cylinder(g, QC.r, QC.plate, [0, 0, z0 + QC.plate / 2], MAT.alu, 'z', 32).name = 'adapter plate';
  const [br, bl] = A.body, bz = z0 + QC.plate;
  cylinder(g, br, bl, [0, 0, bz + bl / 2], MAT.steelDark, 'z', 32).name = 'adapter body';
  // ID 標籤（側面平貼；讀碼器讀取）
  block(g, [1.5, 22, 30], [br + .75, 0, bz + bl * .45], MAT.screen).name = 'adapter id tag';
  const nose = new THREE.Group(); nose.name = 'adapter nose'; nose.position.z = bz + bl; g.add(nose);
  const [nr, nl] = A.nose;
  if (kind === 'mandrel') {
    // 內撐心軸：肩部 Ø40 擋住產品底環端面（產品原點）、心軸 Ø20.2 穿過底環、3 片撐爪（氣動撐開）＋ 3 支定向鍵對準鍵槽
    cylinder(nose, 20, 4, [0, 0, 2], MAT.steel, 'z', 32).name = 'mandrel shoulder';
    cylinder(nose, nr, nl, [0, 0, 4 + nl / 2], MAT.steel, 'z', 32).name = 'mandrel core';
    const jaws = [];
    for (let k = 0; k < 3; k++) {
      const a = k * 2 * Math.PI / 3, jaw = new THREE.Group(); jaw.name = 'mandrel jaw'; jaw.rotation.z = a; nose.add(jaw);
      block(jaw, [4, 9, 14], [nr + 2.2, 0, 4 + 5 + 7 + 6], MAT.pu).name = 'mandrel jaw pad';   // 底環上方（產品內孔 r ≈ 15.4）
      jaws.push(jaw);
      const key = new THREE.Group(); key.rotation.z = a + Math.PI / 3; nose.add(key);
      block(key, [1.6, 3.6, 4.8], [nr + .8, 0, 4 + 2.4], MAT.steelDark).name = 'mandrel key';
    }
    g.userData.jaws = jaws;
  } else {
    // 筒夾：本體前端的錐套＋夾頭（接管端外徑 Ø22 插入 30 mm）
    cylinder(nose, nr, nl, [0, 0, nl / 2], MAT.steel, 'z', 32).name = 'collet sleeve';
    cylinder(nose, 13.5, 3, [0, 0, nl - .5], MAT.pu, 'z', 32).name = 'collet lip';      // 凸出 1 mm，端面不與錐套重合
  }
  const mount = new THREE.Object3D(); mount.name = 'product mount'; mount.position.z = A.mount; g.add(mount);
  g.userData.mount = mount;
  // 撐開／夾緊：0 鬆、1 緊（撐爪徑向外移 0.8 mm）
  g.userData.setGrip = v => { for (const j of g.userData.jaws || []) j.children[0].position.x = nr + 2.2 + .8 * v; };
  return g;
}

export function createRobot(scene) {
  const arm = createVM60B1({ q: { j1: 0, j2: -20, j3: 20, j4: 0, j5: -60, j6: 0 }, name: 'robot' });
  arm.root.position.set(ROBOT.x, ROBOT.y, ROBOT.z); arm.root.rotation.y = ROBOT.yaw; scene.add(arm.root);
  // 底座固定板（地腳螺栓鎖在台面）
  const plate = new THREE.Group(); plate.name = 'robot base plate'; scene.add(plate);
  block(plate, [360, 16, 360], [ROBOT.x, ROBOT.y - 8, ROBOT.z], MAT.steelDark).name = 'robot riser plate';   // 台面 → 底座底面

  // 快換器主側（法蘭上；鎖定銷、氣路與訊號接點）
  const tool = arm.tool;
  const qc = new THREE.Group(); qc.name = 'quick changer'; tool.add(qc);
  cylinder(qc, QC.r, QC.master - 6, [0, 0, (QC.master - 6) / 2], MAT.steelBlue, 'z', 32).name = 'qc master body';
  cylinder(qc, QC.r - 6, 6, [0, 0, QC.master - 3], MAT.alu, 'z', 32).name = 'qc master face';
  block(qc, [24, 18, 26], [QC.r + 10, 0, 16], MAT.black).name = 'qc air block';
  const lock = block(qc, [8, 3, 8], [QC.r + 10, 10.5, 16], MAT.green.clone()); lock.name = 'qc lock lamp';     // 氣路塊頂面的鎖定燈

  // TCP：快換盤貼合面（＝轉接頭原點）；產品姿態由轉接頭的 mount 換算
  arm.apply();
  const _q = new THREE.Quaternion(), _p = V();

  // 產品世界姿態 → 工具安裝座的世界姿態（kind：轉接頭種類）
  function toolPoseFor(kind, quat, pos) {
    const tq = quat.clone().multiply(PRODUCT_IN_TOOL.clone().invert());
    const origin = pos.clone().sub(V(0, 0, ADAPTERS[kind].mount).applyQuaternion(tq));
    return { quat: tq, origin };
  }
  // 逆解：所有幾何初始解（＋參考解）逐組解 IK，取誤差可接受且離參考最近者；球形手腕等價解也比較
  const jointDist = (a, b) => JOINTS.reduce((s, n) => s + Math.abs(a[n] - b[n]) / JOINT_SPEED[n], 0);
  const within = c => JOINTS.every(n => c[n] >= LIMITS[n][0] * D2R - 1e-9 && c[n] <= LIMITS[n][1] * D2R + 1e-9);
  function error(target, quat) {
    tool.getWorldPosition(_p); tool.getWorldQuaternion(_q);
    return { position: _p.distanceTo(target), angle: _q.angleTo(quat) / D2R };
  }
  function solve({ origin, quat }, ref = null, iters = 100) {
    // 共用模型的幾何初始解假設底座不旋轉：目標先換算到底座座標（IK 本身用世界座標，不受影響）
    const base = arm.root.position, inv = arm.root.quaternion.clone().invert();
    const save = { ...arm.q }, seeds = arm.seeds(origin.clone().sub(base).applyQuaternion(inv).add(base), inv.multiply(quat), base);
    let best = null, bestScore = Infinity;
    for (const s of ref ? [ref, ...seeds] : seeds) {
      Object.assign(arm.q, s); arm.apply();
      arm.ik.solve(tool, origin, quat, iters);
      const e = error(origin, quat), ok = e.position <= .5 && e.angle <= .2;
      let c = { ...arm.q };
      if (ok && ref) {
        for (const [d4, s5, d6] of [[0, 1, 0], [Math.PI, -1, Math.PI], [Math.PI, -1, -Math.PI], [-Math.PI, -1, Math.PI], [-Math.PI, -1, -Math.PI]])
          for (const k4 of [0, 2 * Math.PI, -2 * Math.PI]) for (const k6 of [0, 2 * Math.PI, -2 * Math.PI]) {
            const alt = { ...c, j4: c.j4 + d4 + k4, j5: s5 * c.j5, j6: c.j6 + d6 + k6 };
            if (within(alt) && jointDist(alt, ref) < jointDist(c, ref) - 1e-9) c = alt;
          }
      }
      const score = (ok ? 0 : 1e6 + e.position * 100 + e.angle) + (ref ? jointDist(c, ref) : Math.abs(c.j4) + Math.abs(c.j6) * .5);
      if (score < bestScore) { bestScore = score; best = { q: c, err: e, ok }; }
    }
    Object.assign(arm.q, save); arm.apply();
    return best;
  }
  function setJoints(q) { Object.assign(arm.q, q); arm.apply(); }
  // 直線段追蹤：以起點關節角為初值（決定性），解到目標
  function track(pose, seed) {
    const save = { ...arm.q }; Object.assign(arm.q, seed); arm.apply();
    arm.ik.solve(tool, pose.origin, pose.quat, 40);
    const q = { ...arm.q }; Object.assign(arm.q, save); arm.apply(); return q;
  }
  // 手臂本體（J2 以後的連桿、手腕、快換器）各網格包圍盒的 8 個角＋中心，世界座標；規劃器用來判斷撞不撞光學艙與艙壁
  const bodyMeshes = []; arm.j.j2.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); bodyMeshes.push(o); } });
  function bodyPoints(out = []) {
    arm.root.updateMatrixWorld(true);
    for (const m of bodyMeshes) {
      const b = m.geometry.boundingBox;
      for (let k = 0; k < 9; k++) out.push((k < 8 ? V(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z) : b.getCenter(V())).applyMatrix4(m.matrixWorld));
    }
    return out;
  }
  const jointTime = (a, b) => Math.max(...JOINTS.map(n => Math.abs(a[n] - b[n]) / JOINT_SPEED[n]));
  return { arm, root: arm.root, tool, qc, lock, q: arm.q, apply: arm.apply, setJoints, solve, track, toolPoseFor, jointTime, bodyPoints, parts: arm.parts };
}
