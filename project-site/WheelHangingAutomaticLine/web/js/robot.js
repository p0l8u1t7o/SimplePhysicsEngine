// FANUC R-2000iC/165F（共用模型 core/models/robots/fanuc-r2000ic.js）＋輪框夾爪：
//   伺服長行程平行夾爪（core parallelGripper）＋PU V 型指墊（夾前輪緣與胎座，切削面不接觸）、
//   雙眼相機（core visionCamera × 2，鏡頭前加線偏光片＋525 nm 帶通濾鏡）＋中央選配圖案投影器、
//   夾爪本體底側 4 顆隔板吸盤。
// 工具座標：法蘭軸＝工具 −Y；夾指沿工具 X 開合；相機在工具 −Z 側（取像時朝上）、吸盤在 +Z 側（取像時朝下）。
// TCP＝輪框正面（輪緣平面）中心：掌面前方 GRIP.gap。
import * as THREE from 'three';
import { createArm, K, LIMITS, SPEED, JOINTS } from '@core/models/robots/fanuc-r2000ic.js';
import { parallelGripper, suctionCup } from '@core/models/motion.js';
import { visionCamera } from '@core/models/vision.js';
import { block, cylinder, tube } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { tagPart } from '@core/models/parts.js';
import { ROBOT, GRIP, STEREO } from './layout.js';

export { K, LIMITS, SPEED, JOINTS };
export const RATING = { payload: 165, reach: 2655 };

const PU = std(0x2f6fb0, .75, 0), CARBON = std(0x24282e, .45, .3);
const FILTER = new THREE.MeshStandardMaterial({ color: 0x3fae6a, roughness: .1, metalness: .2, transparent: true, opacity: .7 });
export const ROT = {
  pick: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)),          // 工具 −Y → 世界 −Z（朝北看輪面），吸盤朝下
  // yaw 繞世界 Y：pick 姿態的斜視（取像）或棧板上的夾指方向
  yaw: (yaw, base = null) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(base ?? new THREE.Quaternion()),
};
export const HELD = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));   // 輪框在工具座標的姿態（輪框 +Z → 工具 +Y）

export function createRobot(scene) {
  const base = new THREE.Group(); base.name = 'robot base'; scene.add(base);
  block(base, [1100, ROBOT.pedestal, 1100], [ROBOT.x, ROBOT.pedestal / 2, ROBOT.z], MAT.steelDark).name = 'robot pedestal';

  const arm = createArm({ name: 'robot' });
  arm.root.position.set(ROBOT.x, ROBOT.pedestal, ROBOT.z); scene.add(arm.root);

  const tool = new THREE.Group(); tool.name = 'gripper'; tool.rotation.z = Math.PI / 2; arm.flange.add(tool);
  const D = GRIP.D;
  cylinder(tool, 125, 24, [0, -12, 0], MAT.steelDark, 'y', 36).name = 'tool adapter';
  block(tool, [240, 150, 220], [0, -100, 0], MAT.frame).name = 'tool column';
  // 伺服長行程平行夾爪：本體面（掌面）在 −D；滑座、夾指往 −Y 伸出（在輪框外徑之外，不擋輪面）
  const grip = parallelGripper.create({
    axis: '-y', open: 'x', bodyU: 900, bodyV: 170, bodyW: 125, bodyOffset: 0, jawU: 56, jawV: 150, jawW: 34,
    maxWidth: 2 * GRIP.stroke[1] + 20, pad: 16, width: 2 * GRIP.stroke[1],
    finger: { size: [56, 130, GRIP.finger - 34 + GRIP.gap], material: MAT.steelDark },
    rail: { size: [860, 176, 10] }, name: 'servo gripper',
  });
  grip.root.position.y = -(D - 125); tool.add(grip.root);
  tagPart(grip, 'SERVO-GRIPPER-LS');
  // PU V 型指墊（夾指內側，接觸前輪緣與胎座）
  for (const f of grip.fingers) {
    const s = f.userData.side;
    // 夾爪根座標（root 在工具 y = −(D − 125)）：指墊由輪緣平面後 4 mm 起、長 finger − 20
    const y0 = -(GRIP.gap + 4) - 125, len = GRIP.finger - 20;
    block(f, [16, len, 104], [-s * (56 / 2 + 8), y0 - len / 2, 0], PU).name = 'finger pad';
  }
  // 伺服馬達＋減速機（本體 +X 端上方）
  cylinder(tool, 50, 150, [500, -(D - 62), 0], MAT.black, 'z', 24).name = 'gripper servo motor';

  // ---- 雙眼相機：碳纖維橫樑（基線沿工具 X）裝在夾爪本體 −Z 面；光軸往輪框軸俯 tilt，與夾爪軸在 converge 處相交
  const cams = new THREE.Group(); cams.name = 'stereo head'; tool.add(cams);
  const bodyZ = -170 / 2;
  const barZ = STEREO.z - 45, barY = STEREO.y + 80;
  for (const x of [-140, 140]) block(cams, [40, 50, bodyZ - barZ], [x, barY, (bodyZ + barZ) / 2], MAT.steelDark).name = 'stereo standoff';
  block(cams, [STEREO.baseline + 260, 46, 40], [0, barY, barZ], CARBON).name = 'stereo bar';
  // 俯角：相機（工具 y＝STEREO.y、z＝STEREO.z）看向夾爪軸上、輪緣平面前 converge 的點
  const tilt = Math.atan2(-STEREO.z, D + GRIP.gap + STEREO.converge + STEREO.y);
  const vfov = 2 * Math.atan(STEREO.sensor[1] / 2 / STEREO.focal) / Math.PI * 180;
  const cameras = [-1, 1].map(s => {
    const c = visionCamera.create({ bodyW: 29, bodyD: 29, bodyL: 42, lensR: 30, lensL: 64, ringR: 0, spot: false,
      view: { fov: vfov, aspect: STEREO.sensor[0] / STEREO.sensor[1], near: 40, far: 8000, name: s < 0 ? 'stereo left view' : 'stereo right view' },
      name: s < 0 ? 'stereo camera L' : 'stereo camera R' });
    c.root.position.set(s * STEREO.baseline / 2, STEREO.y, STEREO.z); c.root.rotation.x = -tilt; cams.add(c.root);
    // 濾鏡座：線偏光片（可旋轉框）＋ 525 nm 帶通
    cylinder(c.root, 33, 10, [0, -6.6, 0], MAT.black, 'y', 28).name = 'polarizer mount';      // 離開保護玻璃面（−1～0）
    cylinder(c.root, 26, 1.5, [0, -12.6, 0], FILTER, 'y', 28).name = 'polarizer filter';
    tagPart(c, 'STEREO-CAM-5MP');
    return c;
  });
  // 選配圖案投影器（兩相機中間）
  const proj = new THREE.Group(); proj.name = 'pattern projector'; proj.position.set(0, STEREO.y + 45, STEREO.z); proj.rotation.x = -tilt; cams.add(proj);
  block(proj, [70, 110, 80], [0, 45, 0], MAT.steelBlue).name = 'projector body';
  cylinder(proj, 22, 30, [0, -25, 0], MAT.black, 'y', 24).name = 'projector lens';
  const projLens = cylinder(proj, 16, 1.5, [0, -40.8, 0], new THREE.MeshStandardMaterial({ color: 0x113322, emissive: 0x3dff8a, emissiveIntensity: .05 }), 'y', 24);
  projLens.name = 'projector window';

  // ---- 隔板吸盤（本體 +Z 面，取像／夾取姿態時朝下）
  const cupRoot = new THREE.Group(); cupRoot.name = 'sheet cups'; cupRoot.rotation.x = -Math.PI / 2; tool.add(cupRoot);
  for (const [x, y] of GRIP.cups) block(cupRoot, [70, 60, 50], [x, -(-bodyZ + 30), y], MAT.steelDark).name = 'cup mount';
  const cups = suctionCup.create({ r: GRIP.cupR, h: GRIP.cupH, topR: 18, at: GRIP.cups.map(([x, y]) => [x, -(GRIP.cupZ - GRIP.cupH / 2), y]) });
  cupRoot.add(cups.root);
  // ---- 前臂線束（相機網路線、I/O、氣管）
  const fy = K.foreOff + 140;
  tube(arm.j.j3, [[150, fy, 0], [500, fy + 15, 0], [850, fy + 15, 0], [1050, fy - 10, 0]], 14, MAT.black, 24).name = 'forearm dress pack';
  for (const x of [320, 760]) block(arm.j.j3, [40, 10, 34], [x, K.foreOff + 125 + 5, 0], MAT.steelDark).name = 'dress pack saddle';

  // ---- 效果：取像頻閃（視野錐）、投影圖案、吸盤真空指示（userData.fx：不是實體）
  const fx = new THREE.Group(); fx.name = 'stereo fov'; fx.userData.fx = true; cams.add(fx);
  const fovMat = new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide });
  const cones = cameras.map(c => {
    const g = new THREE.ConeGeometry(1, 1, 4, 1, true); g.rotateY(Math.PI / 4); g.translate(0, -.5, 0);
    const m = new THREE.Mesh(g, fovMat); m.name = 'fov cone'; m.userData.fx = true;
    m.position.copy(c.root.position); m.quaternion.copy(c.root.quaternion); fx.add(m); return m;
  });
  const setFov = dist => {
    const hw = dist * STEREO.sensor[0] / 2 / STEREO.focal, hh = dist * STEREO.sensor[1] / 2 / STEREO.focal;
    for (const m of cones) m.scale.set(hw * Math.SQRT2, dist, hh * Math.SQRT2);
  };
  function setDetail({ width = 2 * GRIP.stroke[1], vac = 0, strobe = 0, dist = 900, pattern = 0 } = {}) {
    grip.set({ width });
    fx.visible = strobe > 0; setFov(dist); fovMat.opacity = .05 + .12 * strobe;
    projLens.material.emissiveIntensity = pattern > 0 ? 1.6 : .05;
    for (const c of cups.cups) c.material = vac > .5 ? CUP_ON : MAT.black;
  }

  const tcp = new THREE.Object3D(); tcp.name = 'tcp'; tcp.position.set(0, -(D + GRIP.gap), 0); tool.add(tcp);
  // 隔板吸盤中心（吸盤唇面）在工具座標的位置
  const cupLip = new THREE.Vector3(0, GRIP.cups.reduce((s, [, y]) => s + y, 0) / GRIP.cups.length, GRIP.cupZ);
  arm.apply();
  const solver = arm.createSolver({
    tool, tcp, approach: new THREE.Vector3(0, -1, 0),
    toFlange: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  });
  return {
    arm, root: arm.root, base, tool, tcp, grip, cameras, projector: proj, cups, fx, cupLip, setDetail,
    q: arm.q, setJoints: arm.setJoints, apply: arm.apply,
    solve: solver.solve, track: (pose, seed) => solver.track(pose, seed), error: solver.error,
  };
}
const CUP_ON = std(0x1d5f3a, .6, .1, { emissive: 0x3dd68c, emissiveIntensity: .35 });
