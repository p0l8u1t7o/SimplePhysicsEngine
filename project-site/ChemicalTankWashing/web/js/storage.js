// 穿梭車密集架、棧板、架上桶槽（靜態以 InstancedMesh 繪製）、示範車道與穿梭車。
import * as THREE from 'three';
import { RACK, PALLET, DRUM, lanePositions } from './layout.js';
import { pallet, shuttleCar, shuttleRack } from '@core/models/transport-handling.js';
import { createDrumInstances } from './drum.js';

// 塑膠棧板：core 的塑膠棧板模型（上板＋三條沿 Z 的底樑；叉子由 Z 向插入，兩側底樑落在穿梭車軌道上），回傳 root 群組
export const createPallet = (empty = false) => pallet.create({ size: PALLET.W, height: PALLET.H, empty }).root;
const rand = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

export function createStorage(scene, makeDrum) {
  const group = new THREE.Group(); group.name = 'storage'; scene.add(group);
  // ---- 架體：core 的穿梭車密集架模型（立柱、斜撐、軌道、頂樑、入口導引、車道牌）；root 不位移，座標就是站的絕對座標 ----
  // 柱子隔開成西 3 道、東 2 道兩座；最西一道只做 3 深（前緣退後）
  group.add(shuttleRack.create({ lanes: RACK.lanes, pitch: RACK.pitch, levels: RACK.levels, zBack: RACK.zBack, zFront: RACK.zFront, topBeam: RACK.topBeam,
    fronts: { [RACK.shortLane]: RACK.shortFront }, blocks: [[0, 1, 2], [3, 4]] }).root);

  // ---- 架上棧板與桶槽 ----
  const key = (l, v, p) => `${l},${v},${p}`;
  // 空位：第 3 道底層前位留給動畫入庫，其餘為零星空位
  const emptySlots = new Set([key(2, 0, 0), key(3, 2, 0), key(4, 1, 0), key(4, 2, 0)]);
  const inst = createDrumInstances(200), palletDeck = [], r = rand(11);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let full = 0;
  for (let l = 0; l < RACK.lanes.length; l++) for (let v = 0; v < RACK.levels.length; v++) for (const p of lanePositions(l)) {
    if (l === RACK.demo.lane && v === RACK.demo.level) continue;
    if (l === RACK.emptyLane && v === RACK.emptyLevel) continue;
    if (emptySlots.has(key(l, v, p))) continue;
    const x = RACK.lanes[l], y = RACK.levels[v], z = RACK.pos[p];
    palletDeck.push([x, y, z]); full++;
    for (const [dx, dz] of PALLET.slots) inst.add(m.compose(new THREE.Vector3(x + dx, y + PALLET.H + DRUM.H / 2, z + dz), q.setFromAxisAngle(Y, r() * Math.PI * 2), one));
  }
  inst.done(); group.add(inst.group);
  group.add(pallet.instances(palletDeck, { size: PALLET.W, height: PALLET.H }).root);   // 架上的靜態棧板：每種零件一個 InstancedMesh

  // ---- 空棧板疊（東側最後一道底層前位）----
  const empties = new THREE.Group(); empties.position.set(RACK.lanes[RACK.emptyLane], RACK.levels[RACK.emptyLevel], RACK.pos[0]); group.add(empties);
  for (let i = 0; i < RACK.emptyStack; i++) { const p = createPallet(true); p.position.y = i * PALLET.H; empties.add(p); }

  // ---- 示範車道（第 2 道第 2 層）：4 個棧板，前位那一個由產線動畫接手 ----
  const demo = [];
  for (let p = 0; p < RACK.pos.length; p++) {
    const pal = createPallet(); group.add(pal);
    const drums = p === 0 ? [] : PALLET.slots.map(([dx, dz], k) => {
      const d = makeDrum(`CTW-2610-${String(p * 4 + k + 1).padStart(4, '0')}`); d.root.position.set(dx, PALLET.H + DRUM.H / 2, dz); d.root.rotation.y = r() * Math.PI * 2; pal.add(d.root); return d;
    });
    demo.push({ group: pal, drums });
  }
  // 穿梭車（無線遙控型，在軌道下緣行走，頂升 40 mm 搬運棧板）
  // core 的棧板穿梭車模型，原點在軌道頂面（棧板底面）中心
  const shuttle = shuttleCar.create().root; group.add(shuttle);
  // 其他兩層的穿梭車停在各自車道後端（示意；換道由 AGV 搬運）
  for (const [l, v, p] of RACK.shuttles) if (v !== RACK.demo.level) { const s = shuttle.clone(); s.position.set(RACK.lanes[l], RACK.levels[v], RACK.pos[p]); group.add(s); }
  const laneX = RACK.lanes[RACK.demo.lane], laneY = RACK.levels[RACK.demo.level];
  // 先夾上限再取整（原本取整後再夾，會取到 RACK.pos[2.999] 變成 NaN，第 4 位的棧板看不到）
  const zAt = pos => { const i = Math.max(0, Math.floor(Math.min(2.999, pos))); return RACK.pos[i] + (RACK.pos[i + 1] - RACK.pos[i]) * (pos - i); };

  return {
    group, demo, shuttle, empties, fullCount: full + 4, zAt,
    // 示範車道狀態：pallets[i] = { pos, lift }；shuttle = { pos, lift }
    setDemo(pallets, sh) {
      pallets.forEach((s, i) => { if (!s) return; demo[i].group.visible = true; demo[i].group.position.set(laneX, laneY + s.lift * RACK.shuttleLift, zAt(s.pos)); });
      shuttle.position.set(laneX, laneY + sh.lift * RACK.shuttleLift, zAt(sh.pos));
    },
    setEmpties(n) { empties.children.forEach((p, i) => { p.visible = i < n; }); },
    emptyTop: n => RACK.levels[RACK.emptyLevel] + n * PALLET.H,
  };
}
