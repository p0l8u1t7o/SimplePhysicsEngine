// 工作站周邊：入料／出料棧板 A/B 與板堆、工位感測與指示燈、安全圍籬、叉車口光柵、手臂控制櫃、操作站（HMI、三色燈、急停）。
// 每個棧板工位：內側擋塊＋兩側導引（叉車放下即定位）、有棧板感測（擋塊上的光電）、工位指示燈與「換料請求／就位確認」按鈕盒；
// 出料工位另有對角對照式光電，光束高度在滿疊（OUT_MAX 片）的板面下 2 mm，第 OUT_MAX 片放上去就遮光＝滿料。
import * as THREE from 'three';
import { block, cylinder, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { floor } from '@core/geom/environment.js';
import { lightCurtain, boxSensor } from '@core/models/sensors.js';
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { createPanelParts, placeParts } from './panel.js';
import { BAYS, PALLET, FENCE, CONTROLLER, OPERATOR, OUT_MAX, inGlassY, outGlassY } from './layout.js';

const wood = new THREE.MeshStandardMaterial({ color: 0xa47f52, roughness: .85 });
const I = new THREE.Quaternion();
export const FULL_BEAM_Y = outGlassY(OUT_MAX - 1) - 2;

// 木棧板：上板＋三支沿 X 的底樑（叉車沿 X 由東西兩側進叉）
function woodPallet(parent, name, x, z, { w, d, h }) {
  const g = new THREE.Group(); g.name = name; parent.add(g);
  block(g, [w, 22, d], [x, h - 11, z], wood).name = 'pallet deck';
  for (const s of [-1, 0, 1]) block(g, [w, h - 22, 100], [x, (h - 22) / 2, z + s * (d / 2 - 50)], wood).name = 'pallet runner';
  return g;
}

export function createCell(scene) {
  floor(scene, { size: [10000, 9000], center: [0, 1900], cell: 500 });

  // ---------------------------------------------------------------- 棧板工位 A/B（只有會被搬的兩片是動態零件，其餘是靜態板堆）
  // 會動的：入料 A 最後 1 片（第 1 片板）、入料 B 最上 1 片（第 2 片板）；出料 A 第 60 片、出料 B 第 1 片
  const stacks = {}, bays = {};
  for (const [key, b] of Object.entries(BAYS)) {
    const isIn = key.startsWith('in'), side = b.side, xIn = b.x - side * PALLET.w / 2;   // 內側＝靠手臂那一端
    woodPallet(scene, `${key} pallet`, b.x, b.z, PALLET);
    const g = new THREE.Group(); g.name = `${key} stack`; scene.add(g); stacks[key] = g;
    const nStatic = isIn ? Math.max(0, b.n - 1) : b.n;
    for (let i = 0; i < nStatic; i++) placeParts(createPanelParts(g, `${key}${i}`, { raw: isIn, detail: false }), new THREE.Vector3(b.x, isIn ? inGlassY(i) : outGlassY(i), b.z), I);
    // 工位硬體：內側擋塊（兩塊）、兩側導引、有棧板感測
    const hw = new THREE.Group(); hw.name = `${key} bay`; scene.add(hw);
    for (const s of [-1, 1]) {
      block(hw, [40, 200, 300], [xIn - side * 22, 100, b.z + s * 350], MAT.fence).name = 'bay stop';
      block(hw, [60, 250, 30], [b.x + side * 300, 125, b.z + s * (PALLET.d / 2 + 22)], MAT.fence).name = 'bay guide';
    }
    const presence = boxSensor.create(); presence.root.position.set(xIn - side * 22, 209, b.z + 350); hw.add(presence.root);
    let full = null;
    if (!isIn) {
      // 對照式光電：內側北角 → 外側南角，對角穿過板堆上方
      const pA = [xIn - side * 60, b.z - 640], pB = [b.x + side * (PALLET.w / 2 + 60), b.z + 640];
      for (const [x, z] of [pA, pB]) {
        block(hw, [40, FULL_BEAM_Y - 25, 40], [x, (FULL_BEAM_Y - 25) / 2, z], MAT.steelDark).name = 'full sensor post';
        block(hw, [36, 50, 36], [x, FULL_BEAM_Y, z], MAT.amber).name = 'full sensor';
      }
      const A = new THREE.Vector3(pA[0], FULL_BEAM_Y, pA[1]), B = new THREE.Vector3(pB[0], FULL_BEAM_Y, pB[1]);
      const beam = cylinder(hw, 2, A.distanceTo(B) - 40, [0, 0, 0], new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: .35, depthWrite: false }), 'y', 6);
      beam.position.copy(A).add(B).multiplyScalar(.5); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      beam.name = 'full beam'; beam.userData.fx = true;
      full = beam;
    }
    // 工位指示燈與按鈕盒（圍籬外，叉車司機看得到）：綠＝使用中、黃＝預警／待命、紅＝空或滿，請換棧板
    const gate = FENCE.gates[key.endsWith('A') ? 0 : 1], tz = key.endsWith('A') ? gate[0] - 120 : gate[1] + 120;
    const lamp = signalTower.create({ poleH: 1400 }); lamp.root.position.set(side * (FENCE.x + 160), 0, tz); hw.add(lamp.root);
    block(hw, [200, 12, 200], [side * (FENCE.x + 160), 6, tz], MAT.steelDark).name = 'bay lamp base';
    const button = estop.create({ reset: 1, collarR: 13, capR: 10, capH: 14, box: { size: [52, 65, 16] } });
    button.root.position.set(side * (FENCE.x + 160), 1050, tz + 20); hw.add(button.root);
    bays[key] = { lamp, presence, full, button };
  }

  // ---------------------------------------------------------------- 安全圍籬（網板＋黃色立柱），北面接到拆框機兩端；東西兩側各兩個叉車口
  const fence = new THREE.Group(); fence.name = 'fence'; scene.add(fence);
  const [g0, g1] = FENCE.gates, segs = [
    [[-FENCE.x, FENCE.zN], [-1450, FENCE.zN]], [[1450, FENCE.zN], [FENCE.x, FENCE.zN]],
    ...[-1, 1].flatMap(s => [[[s * FENCE.x, FENCE.zN], [s * FENCE.x, g0[0]]], [[s * FENCE.x, g1[1]], [s * FENCE.x, FENCE.zS]]]),
    [[-FENCE.x, FENCE.zS], [FENCE.x, FENCE.zS]],
  ];
  const H = FENCE.h, posts = new Set();
  const post = (x, z) => { const key = `${Math.round(x)},${Math.round(z)}`; if (!posts.has(key)) { posts.add(key); block(fence, [60, H, 60], [x, H / 2, z], MAT.fence).name = 'fence post'; } };
  for (const [[x0, z0], [x1, z1]] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 1500)), alongX = z0 === z1;
    for (let i = 0; i <= n; i++) {
      post(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
      if (i < n) {
        const xm = x0 + (x1 - x0) * (i + .5) / n, zm = z0 + (z1 - z0) * (i + .5) / n, l = len / n - 60;
        block(fence, alongX ? [l, H - 250, 4] : [4, H - 250, l], [xm, 150 + (H - 250) / 2, zm], MAT.mesh).name = 'fence mesh';
        for (const y of [130, H - 80]) block(fence, alongX ? [l, 30, 30] : [30, 30, l], [xm, y, zm], MAT.fence).name = 'fence rail';
      }
    }
  }
  for (const s of [-1, 1]) post(s * FENCE.x, g0[1]);                      // 兩個叉車口之間的共用立柱
  // 叉車口光柵：每個工位一組，換該工位棧板時只屏蔽那一組，手臂繼續在另一工位作業
  const curtains = {};
  for (const [key, b] of Object.entries(BAYS)) {
    const gate = FENCE.gates[key.endsWith('A') ? 0 : 1];
    const lc = lightCurtain.create({ span: gate[1] - gate[0] - 110, height: 1600, axis: 'z', name: `${key} curtain` });
    lc.root.position.set(b.side * FENCE.x, 0, (gate[0] + gate[1]) / 2); scene.add(lc.root); curtains[key] = lc;
  }

  // ---------------------------------------------------------------- 手臂控制櫃（圍籬外）
  const ctrl = new THREE.Group(); ctrl.name = 'robot controller'; scene.add(ctrl);
  block(ctrl, [740, 1100, 560], [CONTROLLER.x, 550, CONTROLLER.z], MAT.cabinet).name = 'controller cabinet';
  block(ctrl, [600, 140, 8], [CONTROLLER.x, 950, CONTROLLER.z + 284], MAT.fanucDark);
  plate(ctrl, ['手臂控制器 R-30iB Plus'], 420, 70, [CONTROLLER.x, 800, CONTROLLER.z + 289], 0);

  // ---------------------------------------------------------------- 操作站（圍籬外南側）：HMI、急停；三色燈在拆框機頂部
  const op = new THREE.Group(); op.name = 'operator station'; scene.add(op);
  block(op, [80, 1200, 80], [OPERATOR.x, 600, OPERATOR.z], MAT.steelDark).name = 'operator post';
  block(op, [500, 20, 400], [OPERATOR.x, 10, OPERATOR.z], MAT.steelDark);
  const panel = hmi.create({ display: true }); panel.root.position.set(OPERATOR.x, 1350, OPERATOR.z + 65); op.add(panel.root);
  block(op, [120, 300, 40], [OPERATOR.x, 1350, OPERATOR.z + 20], MAT.steelDark);
  const stop = estop.create({ box: { size: [80, 90, 50] } }); stop.root.position.set(OPERATOR.x + 300, 1100, OPERATOR.z + 40); op.add(stop.root);
  block(op, [260, 30, 30], [OPERATOR.x + 170, 1100, OPERATOR.z], MAT.steelDark);
  const tower = signalTower.create({ poleH: 400 }); tower.root.position.set(1450, 1950, -900); scene.add(tower.root);   // 拆框機頂部東北角
  block(tower.root, [70, 12, 60], [-15, -6, 0], MAT.steelDark).name = 'tower mounting bracket';
  tower.set('green');

  return { stacks, bays, curtains, hmi: panel, tower };
}
