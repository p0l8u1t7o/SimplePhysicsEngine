// 本站的孿生描述（core/twin 的綁定表、Node 端孿生 server 與網頁的孿生觀看模式共用；規格見 core/twin/README.md）。
// MD（twin/MilitaryGradePC.md.json）的場景路徑是邏輯路徑（例 cell/stackerIn/forks），在這裡對照到本站的物件與狀態鍵。
// 孿生模式不跑時間軸：站狀態 = initialState() 的複本，再寫入 MD 實體的值（view.keys）後交給 applyState；
// MD 沒有對應的鍵（pushOut、doors、lift、palletLift、inStackY…）維持初始值（開發計畫 Q-19）。
// 檔名刻意避開 PlumbingFixtureInspection 的 twin.js（那是展示用的畫面，與 Twin Protocol 無關）。
import * as THREE from 'three';
import { createSceneSensors } from '@core/twin/geometry.js';
import { createCollisionWatch } from '@core/twin/collisions.js';
import { JOINTS } from '@core/models/robots/denso-vm60b1.js';

// 止擋與到位燈的索引（cell.js 的 stops：x = -1450、S1、S2、S3、1450）
const STOP = { S1: 1 }, RAIL = 1100;
const PALLET_LED = { 'io-S0-PALLET': 0, 'io-S1-PALLET': 1, 'io-S4-PALLET': 4 };

export function createTwinBinding(project, scene) {
  const { cell, robot, carrier } = project;
  const base = project.initialState();
  project.apply(0);   // 手臂到 t = 0 的待命位姿（初始關節角）
  const q0 = JOINTS.map(n => robot.q[n]), rail0 = robot.q.rail;
  const stateKeys = Object.keys(base).filter(k => typeof base[k] === 'number');
  const TOOLS = { cam: robot.tcpCam, hook: robot.tcpHook, press: robot.tcpPress, laser: robot.tcpLaser };

  const objects = {
    robot: robot.root,
    'cell/pallet': cell.pallet.group,
    'cell/stackerIn/lift': cell.stackerIn.lift, 'cell/stackerOut/lift': cell.stackerOut.lift,
    'cell/stackerIn/forks': cell.stackerIn.group, 'cell/stackerOut/forks': cell.stackerOut.group,
    'cell/stackerIn/pusher': cell.stackerIn.rod,
    'cell/S1/head': cell.head,
    'cell/cradle': cell.cradle.group, 'cell/cradle/rot': cell.cradle.rot, 'cell/cradle/lift': cell.cradle.lift,
    'cell/stops/S1': cell.stops[STOP.S1].stop.root,
    'cell/tower/green': cell.tower.lamps.green, 'cell/tower/red': cell.tower.lamps.red,
  };
  // photoEye 偵測的類別：主載具（堆料架內的載具不標，不在射線上）
  Object.assign(cell.pallet.group.userData, { twinClass: 'pallet' });
  const resolve = path => objects[path] ?? null;
  const sensors = createSceneSensors({ root: scene, resolve }), wps = new Set();
  // 即時干涉：手臂連桿與末端工具對 S1 懸臂、取像頭、S3 龍門、電控櫃等固定結構（與 tools/verify.mjs 的碰撞檢查同一組）
  const watch = createCollisionWatch({ root: scene, movers: () => [...robot.clearanceParts.arm, ...robot.clearanceParts.tool], obstacles: () => cell.keepout });
  const S3X = 1150;

  function apply(view) {
    const k = view.keys || {}, p = view.paths || {};
    const s = { ...structuredClone(base), located: false };
    for (const key of stateKeys) if (typeof k[key] === 'number') s[key] = k[key];
    project.applyState(s);
    // 止擋：MD 的行程比例 0 = raised、1 = lowered（cell 的 setStop 是 1 升起、0 降下）；MD 沒有的止擋維持降下
    if (typeof p['cell/stops/S1'] === 'number') cell.setStop(STOP.S1, p['cell/stops/S1'] < 0.5 ? 1 : 0);
    // 到位燈由 DI 驅動（觀看模式才有 view.di）；沒有 DI 時全滅
    cell.stops.forEach((_, i) => cell.setStopLed(i, false));
    for (const [io, i] of Object.entries(PALLET_LED)) if (view.di?.[io]) cell.setStopLed(i, true);
    // 三色燈：紅、綠各自一個 DO；黃燈在孿生模式不亮
    cell.setLamp('green', (p['cell/tower/green'] ?? 0) >= 0.5); cell.setLamp('red', (p['cell/tower/red'] ?? 0) >= 0.5); cell.setLamp('yellow', false);
    // 手臂：關節角（rad，MD joints 順序 = JOINTS）與第七軸
    if (Array.isArray(k.q)) JOINTS.forEach((n, i) => { robot.q[n] = k.q[i]; });
    // 第七軸夾在行程內（拖鏈模型超出行程會丟例外；追隨誤差的偏移可能讓回報位置略超出 MD 的 ±1100）
    if (typeof k['q.rail'] === 'number') robot.q.rail = Math.min(RAIL, Math.max(-RAIL, k['q.rail']));
    robot.apply();
    // 光源與曝光（觀看模式才有）：光源控制器開著、或視覺電腦 0.1 s 內曝光過 → 頂視閃光與手臂相機光源亮
    const lit = !!view.lights?.['dev-LC1']?.on || (view.exposures?.['dev-IPC1'] !== undefined && view.timeUs - view.exposures['dev-IPC1'] <= 100000);
    cell.topFlash.intensity = lit ? 2000 : 0; robot.setFlash(lit);
    // 觀看模式：有工件時才顯示產品（server 端由 spawnWorkpiece／removeWorkpiece 處理）
    if (Array.isArray(view.workpieces)) carrier.visible = view.workpieces.length > 0;
  }

  return {
    station: 'MilitaryGradePC',
    root: scene, objects,
    keys: [...stateKeys, 'q', 'q.rail'],
    setters: ['cell/stops/S1', 'cell/tower/green', 'cell/tower/red'],
    initialView: () => ({ keys: { ...Object.fromEntries(stateKeys.map(key => [key, base[key]])), q: [...q0], 'q.rail': rail0 }, paths: { 'cell/stops/S1': 0, 'cell/tower/green': 0, 'cell/tower/red': 0 } }),
    // photoEye 只偵測主載具：只有載具位置改變時才重新判定，而且只移動載具本身（不套用整個場景）
    geometryKeys: ['palletX'],
    applyGeometry(view) {
      const x = view.keys?.palletX;
      if (typeof x !== 'number') return;
      cell.pallet.group.position.x = x;
      cell.pallet.group.updateMatrixWorld(true);
    },
    apply,
    sense: sensor => sensors.sense(sensor),
    collide: () => watch.check(),
    // 工件持有權：S3 翻轉夾臂在載具上夾緊 → 產品交給翻轉治具；鬆開 → 交回載具（治具在夾持高度、載具停在 S3）
    transfers: [
      { from: 'cell/pallet', to: 'cell/cradle', when: c => c.state('act-S3-GRIP') === 'clamped' && Math.abs(c.pos('ax-CONV') - S3X) <= 2 && c.pos('ax-S3-LIFT') <= 1 },
      { from: 'cell/cradle', to: 'cell/pallet', when: c => c.state('act-S3-GRIP') === 'released' && Math.abs(c.pos('ax-CONV') - S3X) <= 2 && c.pos('ax-S3-LIFT') <= 1 },
    ],
    // move 的位姿目標（Twin README §5：pos mm、rot deg 固定軸 X→Y→Z、tool）→ 關節角（rad，MD joints 順序）；
    // 用本站的逆運動學（robot.js 的 solveJoints，以目前關節角為參考選最近的解），誤差超過 1 mm／1° 視為無解（session 回 BAD_ARGS）
    ik(id, target, q) {
      const tcp = TOOLS[target.tool] ? target.tool : 'cam';
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...target.rot.map(d => d * Math.PI / 180), 'ZYX'));
      const origin = new THREE.Vector3().fromArray(target.pos).sub(TOOLS[tcp].position.clone().applyQuaternion(rotation));
      const rail = typeof target.rail === 'number' ? target.rail : robot.q.rail;
      const ref = { ...Object.fromEntries(JOINTS.map((n, i) => [n, q[i]])), rail };
      const c = robot.solveJoints({ origin, rotation, rail, tcp }, ref);
      return c.position <= 1 && c.angle <= 1 ? JOINTS.map(n => c[n]) : null;
    },
    // 工件流（S6 之前的最小版）：產品模型只有一台（carrier），有工件時才顯示
    resetWorkpieces() { wps.clear(); carrier.visible = false; },
    spawnWorkpiece(wp) { wps.add(wp); carrier.visible = true; },
    removeWorkpiece(wp) { wps.delete(wp); carrier.visible = wps.size > 0; },
    // 與 AutoSequence 假 SPE（tests/Fixtures/Twin/mgpc.fake-spe.json）相同的設定值
    config: {
      exposureDelay: 0.05, homeDuration: 0.5, taskDefault: 2,
      taskDuration: { S1_SIDES: 3, S2_DOORS: 2.5, S3_BOTTOM: 2, PARK: 1 },
      switches: { 'sen-AIR-OK': true, 'sen-STACK-FULL': false },
    },
  };
}
