// 工作站周邊：入料／出料棧板與板堆、安全圍籬、叉車口光柵、手臂控制櫃、操作站（HMI、三色燈、急停）。
import * as THREE from 'three';
import { block, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { floor } from '@core/geom/environment.js';
import { lightCurtain } from '@core/models/sensors.js';
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { createPanelParts, placeParts } from './panel.js';
import { IN, OUT, FENCE, CONTROLLER, OPERATOR, inGlassY, outGlassY } from './layout.js';

const wood = new THREE.MeshStandardMaterial({ color: 0xa47f52, roughness: .85 });
const ROT_IN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);     // 入料棧板上板長邊朝北（板 +X → 世界 −Z）
const ROT_OUT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);   // 出料棧板（板 +X → 世界 +Z）
export { ROT_IN, ROT_OUT };

// 木棧板：上板＋三支沿 X 的底樑（叉車由東西兩側進叉）
function woodPallet(parent, name, x, z, { w, d, h }) {
  const g = new THREE.Group(); g.name = name; parent.add(g);
  block(g, [w, 22, d], [x, h - 11, z], wood).name = 'pallet deck';
  for (const s of [-1, 0, 1]) block(g, [w, h - 22, 100], [x, (h - 22) / 2, z + s * (d / 2 - 50)], wood).name = 'pallet runner';
  return g;
}

export function createCell(scene) {
  floor(scene, { size: [9000, 8000], center: [0, 1800], cell: 500 });

  // ---------------------------------------------------------------- 棧板與板堆（只有最上面兩片會動，其餘是靜態板堆）
  woodPallet(scene, 'in pallet', IN.x, IN.z, IN.pallet);
  woodPallet(scene, 'out pallet', OUT.x, OUT.z, OUT.pallet);
  const inStack = new THREE.Group(); inStack.name = 'in stack'; scene.add(inStack);
  for (let i = 0; i < IN.n - 2; i++) placeParts(createPanelParts(inStack, `in${i}`, { detail: false }), new THREE.Vector3(IN.x, inGlassY(i), IN.z), ROT_IN);
  const outStack = new THREE.Group(); outStack.name = 'out stack'; scene.add(outStack);
  for (let i = 0; i < OUT.n; i++) placeParts(createPanelParts(outStack, `out${i}`, { raw: false }), new THREE.Vector3(OUT.x, outGlassY(i), OUT.z), ROT_OUT);

  // ---------------------------------------------------------------- 安全圍籬（網板＋黃色立柱），北面接到拆框機兩端
  const fence = new THREE.Group(); fence.name = 'fence'; scene.add(fence);
  const segs = [
    [[-FENCE.x, FENCE.zN], [-1450, FENCE.zN]], [[1450, FENCE.zN], [FENCE.x, FENCE.zN]],
    [[-FENCE.x, FENCE.zN], [-FENCE.x, FENCE.gate[0]]], [[-FENCE.x, FENCE.gate[1]], [-FENCE.x, FENCE.zS]],
    [[FENCE.x, FENCE.zN], [FENCE.x, FENCE.gate[0]]], [[FENCE.x, FENCE.gate[1]], [FENCE.x, FENCE.zS]],
    [[-FENCE.x, FENCE.zS], [FENCE.x, FENCE.zS]],
  ];
  const H = FENCE.h, posts = new Set();
  for (const [[x0, z0], [x1, z1]] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 1500)), alongX = z0 === z1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, key = `${Math.round(x)},${Math.round(z)}`;
      if (!posts.has(key)) { posts.add(key); block(fence, [60, H, 60], [x, H / 2, z], MAT.fence).name = 'fence post'; }
      if (i < n) {
        const xm = x0 + (x1 - x0) * (i + .5) / n, zm = z0 + (z1 - z0) * (i + .5) / n, l = len / n - 60;
        block(fence, alongX ? [l, H - 250, 4] : [4, H - 250, l], [xm, 150 + (H - 250) / 2, zm], MAT.mesh).name = 'fence mesh';
        for (const y of [130, H - 80]) block(fence, alongX ? [l, 30, 30] : [30, 30, l], [xm, y, zm], MAT.fence).name = 'fence rail';
      }
    }
  }
  // 叉車口光柵（東西兩側各一組，機身貼在兩側立柱內側；叉車換棧板時屏蔽該側，手臂只在另一側作業）
  const curtains = [-1, 1].map(s => {
    const lc = lightCurtain.create({ span: FENCE.gate[1] - FENCE.gate[0] - 110, height: 1600, axis: 'z', name: s < 0 ? 'in curtain' : 'out curtain' });
    lc.root.position.set(s * FENCE.x, 0, (FENCE.gate[0] + FENCE.gate[1]) / 2); scene.add(lc.root); return lc;
  });

  // ---------------------------------------------------------------- 手臂控制櫃（圍籬外）
  const ctrl = new THREE.Group(); ctrl.name = 'robot controller'; scene.add(ctrl);
  block(ctrl, [740, 1100, 560], [CONTROLLER.x, 550, CONTROLLER.z], MAT.cabinet).name = 'controller cabinet';
  block(ctrl, [600, 140, 8], [CONTROLLER.x, 950, CONTROLLER.z + 284], MAT.fanucDark);
  plate(ctrl, ['手臂控制器'], 360, 70, [CONTROLLER.x, 800, CONTROLLER.z + 289], 0);

  // ---------------------------------------------------------------- 操作站（圍籬外南側）：HMI、急停、三色燈
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

  return { inStack, outStack, curtains, hmi: panel, tower };
}
