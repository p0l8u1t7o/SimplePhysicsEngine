// FANUC R-2000iC/165F（共用模型 core/models/robots/fanuc-r2000ic.js）＋懸臂側進式真空吸盤架。
// 吸盤架：法蘭朝下，主樑水平外伸 GRIP.C，吸盤面在法蘭下方 GRIP.D；手腕留在拆框機外，吸盤架從入料側開口水平伸入。
// 工具座標：+Y 朝上（＝法蘭軸反向）、−Z 為外伸方向、+X 沿板長邊；TCP 在吸盤面中心，也就是板的玻璃面中心。
import * as THREE from 'three';
import { createArm, K, LIMITS, SPEED, JOINTS } from '@core/models/robots/fanuc-r2000ic.js';
import { suctionCup, vacuumEjector } from '@core/models/motion.js';
import { block, cylinder, tube, plate, D2R } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { ROBOT, GRIP } from './layout.js';

export { K, LIMITS, SPEED, JOINTS };

const UP = new THREE.Vector3(0, 1, 0);

export function createRobot(scene) {
  // ---- 底座台（地腳錨栓固定）
  const base = new THREE.Group(); base.name = 'robot base'; scene.add(base);
  block(base, [1100, ROBOT.pedestal, 1100], [ROBOT.x, ROBOT.pedestal / 2, ROBOT.z], MAT.steelDark);

  const arm = createArm({ name: 'robot' });
  arm.root.position.set(ROBOT.x, ROBOT.pedestal, ROBOT.z); scene.add(arm.root);

  // ---- 吸盤架：工具群組繞 Z 轉 90°，使工具 −Y 對齊法蘭軸（法蘭 +X）
  const tool = new THREE.Group(); tool.name = 'gripper'; tool.rotation.z = Math.PI / 2; arm.flange.add(tool);
  // 由法蘭往下：轉接板 24、轉接座 22、主樑 100、連接座 34、吸盤框 60、安裝座 4、吸盤 56（合計 D = 300）
  const { D, C } = GRIP, frameTop = -D + GRIP.cupH + 60;
  cylinder(tool, 125, 24, [0, -12, 0], MAT.steelDark, 'y', 32);                       // 法蘭轉接板
  block(tool, [160, 22, 220], [0, -35, 30], MAT.frame);                               // 轉接座
  block(tool, [120, 100, C + 330], [0, -96, -(C + 330) / 2 + 140], MAT.frame);       // 主樑（鋁擠型 120×100）
  block(tool, [140, -146 - frameTop, 640], [0, (frameTop - 146) / 2, -C], MAT.frame);  // 主樑與吸盤框之間的連接座
  for (const x of [-560, 560]) block(tool, [80, 60, 420], [x, frameTop - 30, -C], MAT.frame);   // 吸盤橫樑（沿板短邊，夾在兩支縱樑之間）
  for (const z of [-250, 250]) block(tool, [1240, 60, 80], [0, frameTop - 30, -C + z], MAT.frame);   // 吸盤縱樑
  for (const [x, z] of GRIP.cups) block(tool, [56, 4, 56], [x, frameTop - 62, z - C], MAT.steelDark);   // 吸盤安裝座
  // 吸盤（core 模型；吸附面朝 −Y，原點在吸盤中心）：吸附面＝TCP 高度
  const cupH = GRIP.cupH - 4;
  const cups = suctionCup.create({ r: GRIP.cupR, h: cupH, topR: 22, at: GRIP.cups.map(([x, z]) => [x, -D + cupH / 2, z - C]) });
  tool.add(cups.root);
  // 真空發生器：主樑兩側各一組
  for (const s of [-1, 1]) { const ej = vacuumEjector.create({ w: 120, h: 50, d: 70 }); ej.root.position.set(s * 121, -96, -C + 420); tool.add(ej.root); }
  // 真空管沿主樑兩側走，再從橫樑外緣繞到吸盤頸部，避開實心鋁擠型。
  for (const s of [-1, 1]) {
    const feed = s < 0 ? [[-180, -35, 80], [-90, -35, -200]] : [];
    tube(tool, [...feed, [s * 80, -35, -500], [s * 121, -45, -C + 420], [s * 121, -69, -C + 420]], 7, MAT.black, 20).name = `vacuum main hose ${s}`;
  }
  tube(tool, [[-80, -35, -500], [-55, -15, -500], [55, -15, -500], [80, -35, -500]], 7, MAT.black, 12).name = 'vacuum supply crossover';
  for (const [i, [x, z]] of GRIP.cups.entries()) {
    const s = Math.sign(x), zz = z - C, lane = i % 4 * 12;
    tube(tool, [[s * (85 + lane), -120, -C + 420], [s * (85 + lane), -158, zz + Math.sign(z) * 80], [x, -158, zz + Math.sign(z) * 80], [x, -230, zz + Math.sign(z) * 68], [x, -262, zz + Math.sign(z) * 26]], 4, MAT.black, 22).name = `vacuum cup hose ${i}`;
  }
  // core 尚無負壓開關，本站以簡化機身、壓力顯示與接頭暫代（不冒用光電感測器）。
  const switches = [-1, 1].map(s => {
    const sw = new THREE.Group(); sw.name = 'vacuum pressure switch'; tool.add(sw);
    sw.position.set(s * 121, -50, -C + 420);
    block(sw, [42, 38, 32], [0, 0, 0], MAT.steelBlue).name = 'vacuum switch body';
    const display = block(sw, [30, 22, 2], [0, 0, 18], MAT.green.clone()); display.name = 'vacuum switch display';
    cylinder(sw, 6, 7, [0, -23.5, 0], MAT.chrome, 'y', 10).name = 'vacuum switch port';
    plate(sw, ['kPa'], 24, 10, [0, 0, 20]);
    return display;
  });

  // 前臂固定段＋腕部鬆弛環：每格由關節座標重算分段外皮，跳播不累積形變。
  tube(arm.j.j3, [[210, 390, -100], [450, 405, -100], [740, 405, -100], [900, 390, -150]], 13, MAT.black, 24).name = 'forearm dress pack';
  for (const x of [260, 700]) block(arm.j.j3, [35, 45, 30], [x, 373, -100], MAT.steelDark).name = 'dress pack saddle';
  const dress = Array.from({ length: 20 }, (_, i) => {
    const m = cylinder(arm.root, 11, 1, [0, 0, 0], MAT.black, 'y', 8); m.name = `wrist dress segment ${i}`; return m;
  });
  const local = (node, p) => arm.root.worldToLocal(node.localToWorld(new THREE.Vector3(...p)));
  function updateDress() {
    arm.root.updateMatrixWorld(true);
    const end = tool.localToWorld(new THREE.Vector3(-180, -35, 80));
    const tip = arm.j.j3.worldToLocal(end.clone());
    const path = new THREE.CatmullRomCurve3([
      local(arm.j.j3, [900, 390, -150]), local(arm.j.j3, [1020, 430, -270]),
      local(arm.j.j3, [tip.x - 140, tip.y + 160, -270]), arm.root.worldToLocal(end),
    ]);
    for (let i = 0; i < dress.length; i++) {
      const a = path.getPoint(i / dress.length), b = path.getPoint((i + 1) / dress.length), delta = b.clone().sub(a);
      dress[i].position.copy(a).add(b).multiplyScalar(.5);
      dress[i].quaternion.setFromUnitVectors(UP, delta.clone().normalize());
      dress[i].scale.y = Math.max(.1, delta.length() - 1);
    }
  }
  // 測高雷射（取板前量最上層板面高度），吊在主樑下
  block(tool, [50, 90, 40], [0, -191, -C + 400], MAT.black);
  const laser = cylinder(tool, 2, 1, [0, -236, -C + 400], new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: .7, depthWrite: false }), 'y', 8);
  laser.name = 'laser height beam'; laser.userData.fx = true;
  const blow = new THREE.Group(); blow.name = 'vacuum release air'; blow.userData.fx = true; tool.add(blow);
  const air = new THREE.MeshBasicMaterial({ color: 0x9aeaff, transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide });
  for (const [x, z] of GRIP.cups) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(40, 44, 20), air); ring.rotation.x = -Math.PI / 2; ring.position.set(x, -D + 2, z - C); blow.add(ring);
  }
  function setDetail({ vac = 0, laserLength = 0, blowProgress = 0 } = {}) {
    updateDress();
    switches.forEach(m => { m.material.emissiveIntensity = vac >= .95 ? 1.4 : .04; });
    laser.visible = laserLength > 0; laser.scale.y = Math.max(.1, laserLength); laser.position.y = -236 - laserLength / 2;
    blow.visible = blowProgress > 0 && blowProgress < 1;
    for (const ring of blow.children) ring.scale.setScalar(1 + 1.4 * blowProgress);
    air.opacity = .65 * (1 - blowProgress);
  }

  const tcp = new THREE.Object3D(); tcp.name = 'tcp'; tcp.position.set(0, -D, -C); tool.add(tcp);
  arm.apply();

  const solver = arm.createSolver({
    tool, tcp, approach: new THREE.Vector3(0, -1, 0),
    toFlange: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  });

  // 板的位姿：center＝玻璃面中心（TCP），dir＝從手腕往板中心的水平方向（吸盤架外伸方向）
  const _m = new THREE.Matrix4();
  function posePanel(center, dir) {
    const Z = new THREE.Vector3(...(dir.isVector3 ? dir.toArray() : dir)).setY(0).normalize().negate();
    const X = new THREE.Vector3().crossVectors(UP, Z);
    return { target: new THREE.Vector3(...(center.isVector3 ? center.toArray() : center)), rot: new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(X, UP, Z)) };
  }
  // 逆解：工作範圍在手臂北半邊（出料 J1 0°、拆框機 90°、入料 180°），正西的 ±180° 兩解一律取 +180°，
  // 轉動時經過北側、不從背面（圍籬南側）繞
  function solve(pose, ref = null) {
    const c = { ...solver.solve(pose, ref) };
    if (c.j1 < -150 * D2R && c.j1 + 2 * Math.PI <= LIMITS.j1[1] * D2R) c.j1 += 2 * Math.PI;
    return c;
  }
  // 直線段：以內插的關節角為初值，追蹤中間位姿
  const track = (pose, seed) => solver.track(pose, seed);
  return { arm, root: arm.root, base, tool, tcp, cups, dress, laser, blow, switches, setDetail, q: arm.q, setJoints: arm.setJoints, apply: arm.apply, posePanel, solve, track, error: solver.error, seeds: solver.seeds };
}
