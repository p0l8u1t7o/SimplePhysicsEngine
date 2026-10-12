// 工作站周邊：地坪、棧板 A/B（含既有疊料與隔板）、隔板架、安全圍籬（吊掛線穿越開口＋叉車口光柵）、
// 手臂控制器、視覺／PLC 控制櫃（IPC 在櫃內）、操作站（HMI、急停）、三色燈。
// 會被手臂搬動的輪框與隔板由 project.js 建立，這裡只畫靜態的部分。
import * as THREE from 'three';
import { block, cylinder, plate } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { floor } from '@core/geom/environment.js';
import { pallet } from '@core/models/transport-handling.js';
import { lightCurtain } from '@core/models/sensors.js';
import { signalTower, hmi, estop } from '@core/models/indicators.js';
import { createWheel } from './wheel.js';
import { HELD } from './robot.js';
import { WHEELS, PALLET, BAYS, SHEETS, FENCE, CONTROLLER, CABINET, OPERATOR, LINE, slotOf, sheetTopY } from './layout.js';

export const SHEET_MAT = std(0xb48a56, .9, 0);
// 棧板上第 i 格的姿態：輪框正面朝上，夾指沿棧板對角線（slot 的 yaw）
export const slotYaw = (sx, sz) => { const a = Math.atan2(-sz, sx); return a > Math.PI / 2 ? a - Math.PI : a < -Math.PI / 2 ? a + Math.PI : a; };
export function placeOnPallet(obj, bay, i, spec) {
  const s = slotOf(bay, i, spec);
  obj.position.set(s.x, s.y, s.z);
  obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), slotYaw(s.sx, s.sz)).multiply(HELD.clone().invert().invert());   // HELD：輪框 +Z → 朝上
  return s;
}
export function createSheet(parent, name) {
  const m = block(null, [SHEETS.size, PALLET.sheet, SHEETS.size], [0, 0, 0], SHEET_MAT); m.name = 'layer sheet';
  const g = new THREE.Group(); g.name = name; g.add(m); parent.add(g); return g;
}

export function createCell(scene) {
  floor(scene, { size: [12000, 10000], center: [400, 400], cell: 500 });

  // ---------------------------------------------------------------- 棧板 A/B（棧板底在地面；每層底下一張隔板）
  const bays = {};
  for (const [key, b] of Object.entries(BAYS)) {
    const p = pallet.create({ size: PALLET.size, height: PALLET.h, name: `pallet ${key}` });
    p.root.position.set(b.x, 0, b.z); scene.add(p.root);
    const stack = new THREE.Group(); stack.name = `stack ${key}`; scene.add(stack);
    const spec = WHEELS[b.model], layers = Math.floor(b.n / 4) + 1;
    for (let l = 0; l < layers; l++) { const s = createSheet(stack, `sheet ${key}${l}`); s.position.set(b.x, sheetTopY(l, spec) - PALLET.sheet / 2, b.z); }
    for (let i = 0; i < b.n; i++) placeOnPallet(stack.add(createWheel(spec, `pallet wheel ${key}${i}`, { detail: false })).children.at(-1), b, i, spec);
    // 定位擋塊（棧板外側兩邊，叉車放下即定位）
    const hw = new THREE.Group(); hw.name = `bay ${key}`; scene.add(hw);
    const half = PALLET.size / 2;
    // 擋塊頂在棧板面下（120 < 150），夾指放第一層時不會碰到
    if (key === 'A') for (const s of [-1, 1]) block(hw, [40, 120, 300], [b.x - half - 22, 60, b.z + s * 380], MAT.fence).name = 'bay stop';
    else for (const s of [-1, 1]) block(hw, [300, 120, 40], [b.x + s * 380, 60, b.z - half - 22], MAT.fence).name = 'bay stop';
    bays[key] = { pallet: p, stack };
    plate(scene, [`棧板 ${key}（${WHEELS[b.model].name.split('（')[0]}）`], 700, 120, [b.x, 2, b.z + (key === 'A' ? 0 : 0) + half + 160], 0);
  }

  // ---------------------------------------------------------------- 隔板架（瓦楞隔板 1150 見方；最上面一張由 project.js 另外建立）
  const rack = new THREE.Group(); rack.name = 'sheet rack'; scene.add(rack);
  const S = SHEETS, top0 = S.h;
  block(rack, [S.size + 60, 40, S.size + 60], [S.x, top0 - 20, S.z], MAT.steelBlue).name = 'sheet rack deck';
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) block(rack, [60, top0 - 40, 60], [S.x + sx * (S.size / 2), (top0 - 40) / 2, S.z + sz * (S.size / 2)], MAT.steelBlue).name = 'sheet rack leg';
  for (const [sx, sz] of [[-1, 0], [0, -1]]) block(rack, sx ? [20, 260, 300] : [300, 260, 20], [S.x + sx * (S.size / 2 + 20), top0 + 130, S.z + sz * (S.size / 2 + 20)], MAT.fence).name = 'sheet guide';
  const stackH = (S.n - 1) * PALLET.sheet;
  block(rack, [S.size, stackH, S.size], [S.x, top0 + stackH / 2, S.z], SHEET_MAT).name = 'sheet stack';

  // ---------------------------------------------------------------- 安全圍籬（網板＋黃色立柱）：北側在背板後；東西兩側留吊掛線開口（下緣 1100 以下封板）
  const fence = new THREE.Group(); fence.name = 'fence'; scene.add(fence);
  const [X0, X1] = FENCE.x, [Z0, Z1] = FENCE.z, H = FENCE.h, posts = new Set();
  const post = (x, z) => { const k = `${Math.round(x)},${Math.round(z)}`; if (!posts.has(k)) { posts.add(k); block(fence, [60, H, 60], [x, H / 2, z], MAT.fence).name = 'fence post'; } };
  function run([x0, z0], [x1, z1], h = H) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 1500)), alongX = z0 === z1;
    for (let i = 0; i <= n; i++) {
      post(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
      if (i === n) continue;
      const xm = x0 + (x1 - x0) * (i + .5) / n, zm = z0 + (z1 - z0) * (i + .5) / n, l = len / n - 60;
      block(fence, alongX ? [l, h - 250, 4] : [4, h - 250, l], [xm, 150 + (h - 250) / 2, zm], MAT.mesh).name = 'fence mesh';
      for (const y of [130, h - 80]) block(fence, alongX ? [l, 30, 30] : [30, 30, l], [xm, y, zm], MAT.fence).name = 'fence rail';
    }
  }
  const [g0, g1] = FENCE.lineGap, [a0, a1] = FENCE.gateA, [b0, b1] = FENCE.gateB;
  run([X0, Z0], [X1, Z0]);                                              // 北
  run([X0, Z1], [b0, Z1]); run([b1, Z1], [X1, Z1]);                     // 南（中間是棧板 B 叉車口）
  run([X0, Z0], [X0, g0]); run([X0, g1], [X0, Z1]);                     // 西
  run([X1, Z0], [X1, g0]); run([X1, g1], [X1, a0]); run([X1, a1], [X1, Z1]);   // 東（棧板 A 叉車口）
  for (const x of [X0, X1]) { run([x, g0], [x, g1], 1100); block(fence, [60, 60, g1 - g0], [x, 1100, (g0 + g1) / 2], MAT.fence).name = 'line opening sill'; }
  // 叉車口光柵（換棧板時只屏蔽那一組）、吊掛線開口光柵（只在開口下緣以下有人進入時跳脫，輪框通過時由吊鉤光電屏蔽）
  const curtains = {
    A: lightCurtain.create({ span: a1 - a0 - 110, height: 1600, axis: 'z', name: 'gate A curtain' }),
    B: lightCurtain.create({ span: b1 - b0 - 110, height: 1600, axis: 'x', name: 'gate B curtain' }),
  };
  curtains.A.root.position.set(X1, 0, (a0 + a1) / 2); curtains.B.root.position.set(0, 0, Z1);
  for (const c of Object.values(curtains)) scene.add(c.root);

  // ---------------------------------------------------------------- 手臂控制器、視覺／PLC 控制櫃（圍籬外南側）
  const ctrl = new THREE.Group(); ctrl.name = 'robot controller'; scene.add(ctrl);
  block(ctrl, [740, 1100, 560], [CONTROLLER.x, 550, CONTROLLER.z], MAT.cabinet).name = 'controller cabinet';
  block(ctrl, [600, 140, 8], [CONTROLLER.x, 950, CONTROLLER.z + 284], MAT.fanucDark).name = 'controller badge';
  plate(ctrl, ['R-30iB Plus'], 420, 70, [CONTROLLER.x, 800, CONTROLLER.z + 289], 0);
  const cab = new THREE.Group(); cab.name = 'vision cabinet'; scene.add(cab);
  block(cab, [800, 1900, 500], [CABINET.x, 1000, CABINET.z], MAT.cabinet).name = 'vision cabinet body';
  block(cab, [820, 100, 520], [CABINET.x, 50, CABINET.z], MAT.steelDark).name = 'vision cabinet plinth';
  plate(cab, ['視覺 IPC＋PLC'], 520, 80, [CABINET.x, 1700, CABINET.z + 252], 0);
  // 操作站：HMI（輪型、追蹤狀態、棧板計數）＋急停
  const op = new THREE.Group(); op.name = 'operator station'; scene.add(op);
  block(op, [80, 1200, 80], [OPERATOR.x, 620, OPERATOR.z], MAT.steelDark).name = 'operator post';
  block(op, [500, 20, 400], [OPERATOR.x, 10, OPERATOR.z], MAT.steelDark).name = 'operator foot';
  const panel = hmi.create({ display: true, w: 420, h: 300 }); panel.root.position.set(OPERATOR.x, 1400, OPERATOR.z + 65); op.add(panel.root);
  block(op, [140, 320, 40], [OPERATOR.x, 1400, OPERATOR.z + 20], MAT.steelDark).name = 'hmi bracket';
  const stop = estop.create({ box: { size: [80, 90, 50] } }); stop.root.position.set(OPERATOR.x + 320, 1100, OPERATOR.z + 40); op.add(stop.root);
  block(op, [280, 30, 30], [OPERATOR.x + 180, 1100, OPERATOR.z], MAT.steelDark).name = 'estop arm';
  const tower = signalTower.create({ poleH: 300 }); tower.root.position.set(CABINET.x, 1950, CABINET.z); scene.add(tower.root);
  tower.set('green');
  // 地面標示：吊掛線投影
  plate(scene, ['清洗線（吊掛）下段'], 1100, 150, [-1600, 2, LINE.z], 0);
  return { bays, rack, fence, curtains, hmi: panel, tower, estop: stop };
}
