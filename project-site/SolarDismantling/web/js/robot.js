// FANUC M-710iC/45M（共用模型 core/models/robots/fanuc-m710ic.js）＋置中輕量真空吸盤架。
// 底座繞 Y 轉 ROBOT.yaw（J1 零度朝北），手臂只在開放的棧板與交接台上方取放；板中心在法蘭軸正下方，手腕幾乎沒有偏心力矩。
// 工具座標：+Y 朝上（＝法蘭軸反向）、+X 沿板長邊、+Z 沿板短邊；TCP 在吸盤面中心，也就是板的玻璃面中心。
import * as THREE from 'three';
import { createArm, K, LIMITS, SPEED, JOINTS, RATING } from '@core/models/robots/fanuc-m710ic.js';
import { suctionCup, vacuumEjector } from '@core/models/motion.js';
import { block, cylinder, tube } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { ROBOT, GRIP } from './layout.js';

export { K, LIMITS, SPEED, JOINTS, RATING };

const UP = new THREE.Vector3(0, 1, 0);

export function createRobot(scene) {
  // ---- 底座台（地腳錨栓固定）
  const base = new THREE.Group(); base.name = 'robot base'; scene.add(base);
  block(base, [820, ROBOT.pedestal, 820], [ROBOT.x, ROBOT.pedestal / 2, ROBOT.z], MAT.steelDark);

  const arm = createArm({ name: 'robot' });
  arm.root.position.set(ROBOT.x, ROBOT.pedestal, ROBOT.z); arm.root.rotation.y = ROBOT.yaw; scene.add(arm.root);

  // ---- 吸盤架：工具群組繞 Z 轉 90°，使工具 −Y 對齊法蘭軸（法蘭 +X）
  // 由法蘭往下：轉接板 20、輪轂 40、橫樑 40、縱樑 50、安裝座 4、吸盤 60（合計 D = 214）
  const tool = new THREE.Group(); tool.name = 'gripper'; tool.rotation.z = Math.PI / 2; arm.flange.add(tool);
  const D = GRIP.D;
  cylinder(tool, 100, 20, [0, -10, 0], MAT.steelDark, 'y', 32).name = 'gripper plate';
  block(tool, [180, 40, 180], [0, -40, 0], MAT.frame).name = 'gripper hub';
  block(tool, [80, 40, 580], [0, -80, 0], MAT.frame).name = 'gripper cross beam';
  for (const z of [-250, 250]) block(tool, [1260, 50, 60], [0, -125, z], MAT.frame).name = 'gripper rail';   // 縱樑（沿板長邊）
  for (const [x, z] of GRIP.cups) block(tool, [56, 4, 56], [x, -152, z], MAT.steelDark).name = 'cup mount';
  const cups = suctionCup.create({ r: GRIP.cupR, h: GRIP.cupH, topR: 22, at: GRIP.cups.map(([x, z]) => [x, -D + GRIP.cupH / 2, z]) });
  tool.add(cups.root);
  // 真空發生器（輪轂南北兩側，坐在橫樑上）＋負壓開關（坐在真空發生器上）
  for (const s of [-1, 1]) { const ej = vacuumEjector.create({ w: 120, h: 40, d: 70 }); ej.root.position.set(0, -40, s * 135); tool.add(ej.root); }
  const switches = [-1, 1].map(s => {
    const sw = new THREE.Group(); sw.name = 'vacuum pressure switch'; tool.add(sw);
    sw.position.set(0, 1, s * 135);
    block(sw, [42, 22, 32], [0, 0, 0], MAT.steelBlue).name = 'vacuum switch body';
    const display = block(sw, [30, 2, 22], [0, 12, 0], MAT.green.clone()); display.name = 'vacuum switch display';
    return display;
  });
  // 真空主管：真空發生器沿縱樑頂面到兩端吸盤
  for (const s of [-1, 1]) for (const e of [-1, 1])
    tube(tool, [[e * 61, -40, s * 160], [e * 200, -94, s * 230], [e * 500, -94, s * 230], [e * 550, -94, s * 230]], 6, MAT.black, 16).name = `vacuum main hose ${s} ${e}`;
  // 測高雷射：吊在橫樑下
  block(tool, [50, 70, 40], [0, -135, 120], MAT.black).name = 'laser sensor';

  // ---- 前臂固定段＋腕部鬆弛環：每格由關節座標重算分段外皮，跳播不累積形變
  const fy = K.foreOff + 95 + 18;                                                      // 前臂頂面上方
  tube(arm.j.j3, [[200, fy, 0], [500, fy + 10, 0], [800, fy + 10, 0], [960, fy, 0]], 12, MAT.black, 24).name = 'forearm dress pack';
  for (const x of [300, 700]) block(arm.j.j3, [35, 6, 30], [x, K.foreOff + 95 + 3, 0], MAT.steelDark).name = 'dress pack saddle';
  // 腕部段：前臂末端 → 手腕叉外側的旋轉接頭座（裝在 J4 上，不隨 J5、J6 轉；管路經旋轉接頭進吸盤架）
  const dress = Array.from({ length: 12 }, (_, i) => {
    const m = cylinder(arm.root, 10, 1, [0, 0, 0], MAT.black, 'y', 8); m.name = `wrist dress segment ${i}`; return m;
  });
  block(arm.j.j4, [40, 40, 20], [200, 0, -116], MAT.steelDark).name = 'dress connector';
  const local = (node, p) => arm.root.worldToLocal(node.localToWorld(new THREE.Vector3(...p)));
  function updateDress() {
    arm.root.updateMatrixWorld(true);
    const end = arm.j.j3.worldToLocal(arm.j.j4.localToWorld(new THREE.Vector3(200, 0, -126)));
    const side = Math.sign(end.z) || -1;
    const path = new THREE.CatmullRomCurve3([
      local(arm.j.j3, [960, fy, 0]), local(arm.j.j3, [1060, fy + 10, side * 60]),
      local(arm.j.j3, [end.x - 40, Math.max(end.y, fy - 40), side * 150]), arm.root.worldToLocal(arm.j.j3.localToWorld(end)),
    ]);
    for (let i = 0; i < dress.length; i++) {
      const a = path.getPoint(i / dress.length), b = path.getPoint((i + 1) / dress.length), delta = b.clone().sub(a);
      dress[i].position.copy(a).add(b).multiplyScalar(.5);
      dress[i].quaternion.setFromUnitVectors(UP, delta.clone().normalize());
      dress[i].scale.y = Math.max(.1, delta.length() - 1);
    }
  }
  // ---- 效果：測高雷射光束、破真空吹氣環（userData.fx：不是實體）
  const laser = cylinder(tool, 2, 1, [0, -170, 120], new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: .7, depthWrite: false }), 'y', 8);
  laser.name = 'laser height beam'; laser.userData.fx = true;
  const blow = new THREE.Group(); blow.name = 'vacuum release air'; blow.userData.fx = true; tool.add(blow);
  const air = new THREE.MeshBasicMaterial({ color: 0x9aeaff, transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide });
  for (const [x, z] of GRIP.cups) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(40, 44, 20), air); ring.rotation.x = -Math.PI / 2; ring.position.set(x, -D + 2, z); blow.add(ring);
  }
  // laserTo：雷射打到的世界高度（0＝不顯示）
  function setDetail({ vac = 0, laserTo = 0, blowProgress = 0 } = {}) {
    updateDress();
    switches.forEach(m => { m.material.emissiveIntensity = vac >= .95 ? 1.4 : .04; });
    const len = laserTo ? tool.localToWorld(new THREE.Vector3(0, -170, 120)).y - laserTo : 0;
    laser.visible = len > 0; laser.scale.y = Math.max(.1, len); laser.position.y = -170 - len / 2;
    blow.visible = blowProgress > 0 && blowProgress < 1;
    for (const ring of blow.children) ring.scale.setScalar(1 + 1.4 * blowProgress);
    air.opacity = .65 * (1 - blowProgress);
  }

  const tcp = new THREE.Object3D(); tcp.name = 'tcp'; tcp.position.set(0, -D, 0); tool.add(tcp);
  arm.apply();
  const solver = arm.createSolver({
    tool, tcp, approach: new THREE.Vector3(0, -1, 0),
    toFlange: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  });

  // 板的位姿：center＝玻璃面中心（TCP）；板長邊一律沿世界 X（棧板、交接台、拆框機同向），由 J6 補償 J1 的轉角
  const posePanel = center => ({ target: new THREE.Vector3(...(center.isVector3 ? center.toArray() : center)), rot: new THREE.Quaternion() });
  return { arm, root: arm.root, base, tool, tcp, cups, dress, laser, blow, switches, setDetail, q: arm.q, setJoints: arm.setJoints, apply: arm.apply,
    posePanel, solve: solver.solve, track: (pose, seed) => solver.track(pose, seed), error: solver.error, seeds: solver.seeds };
}
