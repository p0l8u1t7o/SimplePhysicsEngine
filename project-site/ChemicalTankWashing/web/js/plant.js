// 全廠設備建立與狀態套用：網頁主程式與 core 統一檢查共用同一份邏輯，檢查的就是畫面上的幾何。
// 清洗手臂分兩份：ikRobot 不放進場景，排程在 cell 邏輯座標解運動學；robot 是畫面上的手臂（放在 cell 框架），每格照抄關節角。
import * as THREE from 'three';
import { D2R } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { pallet } from '@core/models/transport-handling.js';
import { FRAME, PALLET, FILL } from './layout.js';
import { createBuilding } from './building.js';
import { createAgv } from './agv.js';
import { createLine } from './line.js';
import { createRobot } from './robot.js';
import { createWashing } from './washing.js';
import { createFilling } from './filling.js';
import { createDrum, addTopLabels, BIG_CAP, SMALL_CAP } from './drum.js';
import { drumWorld, palletWorld, DRUM_IDS, PRE_ID, DRUM_KEYS } from './sequence.js';

export function buildPlant(scene) {
  const building = createBuilding(scene);
  const agv = createAgv(scene, 'agv'), agv2 = createAgv(scene, 'agv2');
  const line = createLine(scene);
  // 畫面上的清洗手臂：獨立一組（模組名 robot），放在 cell 框架
  const robotFrame = new THREE.Group(); robotFrame.name = 'robot'; scene.add(robotFrame);
  robotFrame.position.set(FRAME.cell.x, 0, FRAME.cell.z); robotFrame.rotation.y = Math.PI;
  const robot = createRobot(); robotFrame.add(robot.root);
  const ikRobot = createRobot();
  const washing = createWashing(scene);
  const filling = createFilling(scene);
  // 會移動的棧板：D 待洗棧板（之後成為空棧板）、A 組板位 A
  const pallets = new THREE.Group(); pallets.name = 'pallets'; scene.add(pallets);
  const pal = Object.fromEntries(['D', 'A'].map(k => { const p = pallet.create({ size: PALLET.W, height: PALLET.H }); p.root.name = 'pallet ' + k; pallets.add(p.root); return [k, p.root]; }));
  const drums = [...DRUM_IDS, PRE_ID].map(id => { const d = createDrum(id); d.top = addTopLabels(d); scene.add(d.root); return d; });
  const held = { big: new THREE.Mesh(BIG_CAP, MAT.cap), small: new THREE.Mesh(SMALL_CAP, MAT.cap) };
  for (const k of ['big', 'small']) { held[k].position.y = 8; line.socket(k).add(held[k]); }
  return { building, agv, agv2, line, robot, ikRobot, washing, filling, pal, drums, held };
}

// 依取樣結果擺放所有設備與桶（不含 UI）
export function applyPlant(p, sm, { playing = false } = {}) {
  const st = sm.st, { agv, agv2, line, robot, ikRobot, drums, held, washing, filling, pal } = p;
  agv.set({ ...st.agv, time: sm.time }); agv2.set({ ...st.agv2, time: sm.time });
  for (const k of ['D', 'A']) { const pw = palletWorld(st['pal' + k], st); pal[k].position.copy(pw.pos); pal[k].rotation.y = pw.yaw * D2R; }
  line.setGantry(st.gantry); line.setLabeler(st.labeler); line.setUpender(st.upender); line.setDecap(st.decap);
  held.big.visible = st.decap.heldBig; held.small.visible = st.decap.heldSmall;
  // 手臂：排程用的 ikRobot 已在 seq.sample 設好關節角，畫面上的手臂照抄
  robot.setJoints({ ...ikRobot.q }); robot.setJaw(st.grip.jaw); robot.root.updateMatrixWorld(true);
  ikRobot.root.updateMatrixWorld(true);
  drums.forEach((d, k) => {
    const key = DRUM_KEYS[k], s = st[key], w = drumWorld(key, st, ikRobot.tcp.matrixWorld);
    d.root.visible = !w.hidden; if (w.hidden) return;
    d.root.position.copy(w.pos); d.root.quaternion.copy(w.q); d.root.updateMatrixWorld(true);
    d.setCaps(s.capBig, s.capSmall); d.setLabel(s.label, s.labelAng * D2R); d.setWater(s.water); d.top.set(s.top);
  });
  const b = st.booth, sp = st.sump;
  washing.set({
    knife: b.knife, lance: b.lance, lance2: b.lance2, spray: b.spray, pool: b.pool, sump: sp.level, tanks: st.tanks,
    pour: b.pour !== '' ? drums[+b.pour].bungWorld('big') : null,
    flows: { hot: b.hot, vac: b.vac, vacOut: b.vac, supply: b.spray, supply2: b.spray, fromF: b.spray && b.src === 'F', fromR: b.spray && b.src === 'R', sump: sp.pump, riser: sp.pump, toWA: sp.pump && sp.dest === 'WA', toWB: sp.pump && sp.dest === 'WB', toR: sp.pump && sp.dest === 'R', city: st.makeup.on },
  });
  line.setScale(st.scale);
  line.setTower(playing ? 'run' : 'wait');
  line.animate(sm.time, st);
  filling.setTopLabeler(st.topLab); filling.setReaders(st.readers);
  FILL.lines.forEach((_, li) => { filling.setLine(li, FILL.pos.map((_, pi) => st[`h${li}${pi}`])); filling.setWiper(li, st['wiper' + li]); });
  filling.setWeights(drums.map((d, k) => ({ ...d.root.position, visible: d.root.visible, water: st[DRUM_KEYS[k]].water })));
  filling.setStaging(st.stg);
}
