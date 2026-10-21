// 本站孿生檢查（SPE-AC-15、16、18；core 的 Twin Protocol 引擎見 core/twin）：
//   1. 綁定解析：站內 MD 解析出 7 軸、16 感測器、1 機器人、8 致動器與 1 個設備（dev-CAM02），unbound 恰為 act-S3-PCLAMP，bindings = 33；
//      站內 MD 的 mdHash 等於 twin/SOURCE.md 的紀錄（需要相鄰的 Automation-Schema；找不到時明確印「略過」，Q-22）
//   2. applyState 等價：40 個時間點，apply(t) 與「先跳到別的時間、再 applyState(sample(t).state)＋手臂設到同一關節」的可見實體網格世界矩陣差 ≤ 1e-3
//   3. photoEye：ax-CONV 在 -1450／-1000／1450 時 io-S0／S1／S4-PALLET 各自 ON、離開 OFF；產品（不在 detects）顯示與否不影響
// 結果寫到 review/twin-checks.json（沒有時間戳）。
import '../../../core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { createTwinBinding } from '../web/js/twin-binding.js';
import { prepareTwin, createTwinSession } from '../../../core/twin/session.js';
import { loadSchemaIfPresent } from '../../../core/tools/twin-schema.mjs';

const here = p => new URL(p, import.meta.url);
const mdText = readFileSync(here('../twin/MilitaryGradePC.md.json'), 'utf8'), md = JSON.parse(mdText);
const recorded = /`(sha256:[0-9a-f]{64})`/.exec(readFileSync(here('../twin/SOURCE.md'), 'utf8'))[1];
const failures = [], report = {};
const check = (name, ok, detail) => { report[name] = { ok, ...detail }; if (!ok) failures.push(name); };

const scene = new THREE.Scene(), project = await createProject({ scene, headless: true });
const twin = createTwinBinding(project, scene), prepared = prepareTwin({ md, twin }), b = prepared.bound;

// ---------------------------------------------------------------- 1. 綁定與 mdHash
const counts = { axes: b.axes.length, actuators: b.actuators.length, sensors: b.sensors.length, robots: b.robots.length, devices: b.devices.map(d => d.md.id) };
check('bindings', counts.axes === 7 && counts.actuators === 8 && counts.sensors === 16 && counts.robots === 1 && counts.devices.join() === 'dev-CAM02'
  && b.unbound.join() === 'act-S3-PCLAMP' && b.bindings === 33, { ...counts, unbound: b.unbound, bindings: b.bindings });
const as = await loadSchemaIfPresent().catch(() => null);
if (as) {
  const hash = as.schema.mdHashOfText(mdText), v = as.schema.validateMachineDescription(md);
  check('mdHash', hash === recorded && v.valid, { mdHash: hash, recorded, mdValid: v.valid });
} else { report.mdHash = { skipped: '找不到 Automation-Schema（相鄰 checkout）' }; console.log('略過 mdHash：找不到 Automation-Schema'); }

// ---------------------------------------------------------------- 2. applyState 等價
const meshes = [];
// 光源、雷射線、ROI 框等效果由 effects() 設定（不是 applyState 的輸入），用站的 verify.skip 排除
scene.traverse(o => { if (o.isMesh && !project.verify.skip(o)) meshes.push(o); });
const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const snapshot = () => { scene.updateMatrixWorld(true); return meshes.filter(visible).map(m => m.matrixWorld.elements.slice()); };
const JOINTS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'rail'];
let worst = 0, worstAt = null;
for (let i = 0; i < 40; i++) {
  const t = project.total * i / 39;
  project.apply(t);
  const want = snapshot(), q = Object.fromEntries(JOINTS.map(k => [k, project.robot.q[k]]));
  const state = structuredClone(project.sample(t).state);
  project.apply((t + project.total / 2) % project.total);       // 先跳到別的時間，確認 applyState 不依賴前一個狀態
  project.applyState(state);
  Object.assign(project.robot.q, q); project.robot.apply();
  const got = snapshot();
  let d = 0;
  for (let k = 0; k < want.length; k++) for (let e = 0; e < 16; e++) d = Math.max(d, Math.abs(want[k][e] - got[k][e]));
  if (d > worst) { worst = d; worstAt = t; }
}
check('applyState', worst <= 1e-3, { samples: 40, maxMatrixDiff: +worst.toExponential(3), at: worstAt });

// ---------------------------------------------------------------- 3. photoEye（經 Twin 工作階段，與 Hub 看到的 DI 相同）
const session = createTwinSession({ prepared, mdHash: recorded });
session.handle({ t: 'hello', proto: 'zqs.twin/2.0', role: 'hub', mdHash: recorded, mode: 'lockstep', dt: 0.01 });
let n = 0, tUs = 0, seq = 0;
const tick = () => { n++; tUs += 10000; return session.handle({ t: 'tick', n, tUs, time: tUs / 1e6, dt: 0.01 }); };
const moveConv = pos => { session.handle({ t: 'cmd', seq: ++seq, id: 'ax-CONV', op: 'move_abs', args: { pos } }); for (let i = 0; i < 1500; i++) { tick(); const s = session.handle({ t: 'snapshot', request: true }); if (!s[0].axes['ax-CONV'].busy) return s[0]; } return null; };
const eyes = ['io-S0-PALLET', 'io-S1-PALLET', 'io-S4-PALLET'], rows = [];
for (const [pos, on] of [[-1450, 'io-S0-PALLET'], [-1000, 'io-S1-PALLET'], [1450, 'io-S4-PALLET'], [-1700, null], [0, null]]) {
  const snap = moveConv(pos), di = Object.fromEntries(eyes.map(e => [e, snap.di[e]]));
  rows.push({ pos, di, ok: eyes.every(e => di[e] === (e === on)) });
}
// 產品（不在 detects 內）出現在射線上不觸發：S0 位以外放一台產品
session.handle({ t: 'cmd', seq: ++seq, id: 'scene', op: 'wp_spawn', args: { wp: 'wp-1', kind: 'V110-STND', at: 'cell/pallet' } });
const withProduct = moveConv(-1700);
rows.push({ pos: -1700, workpiece: true, di: Object.fromEntries(eyes.map(e => [e, withProduct.di[e]])), ok: eyes.every(e => withProduct.di[e] === false) });
check('photoEye', rows.every(r => r.ok), { rows });

// ---------------------------------------------------------------- 4. 機器人 move 的位姿目標（站的逆運動學）
// 目標取時間軸上 S1 用相機、且關節離初始姿態最遠的位姿：手臂移到後，TCP 與目標相差 ≤ 1 mm、工具軸 ≤ 1°；搆不到的目標回 BAD_ARGS
{
  project.apply(0);
  const q0 = JOINTS.slice(0, 6).map(n => project.robot.q[n]);
  let step = null, far0 = -1;
  for (const s of project.sequence.steps.filter(s => s.station === 1 && s.pose1?.tcp === 'cam')) {
    project.apply(s.start + s.dur);
    const d = Math.max(...JOINTS.slice(0, 6).map((n, i) => Math.abs(project.robot.q[n] - q0[i])));
    if (d > far0) { far0 = d; step = s; }
  }
  project.apply(step.start + step.dur);
  const pos = project.robot.getTcpWorld('cam').toArray(), quat = project.robot.tool.getWorldQuaternion(new THREE.Quaternion());
  const rot = new THREE.Euler().setFromQuaternion(quat, 'ZYX').toArray().slice(0, 3).map(r => r * 180 / Math.PI), rail = project.robot.q.rail;
  const s2 = createTwinSession({ prepared, mdHash: recorded });
  s2.handle({ t: 'hello', proto: 'zqs.twin/2.0', role: 'hub', mdHash: recorded, mode: 'lockstep', dt: 0.01 });
  let k = 0, us = 0;
  const run = () => { for (let i = 0; i < 2000; i++) { k++; us += 10000; const out = s2.handle({ t: 'tick', n: k, tUs: us, time: us / 1e6, dt: 0.01 }); if (out.some(m => m.t === 'error')) return out.filter(m => m.t === 'error'); if (!s2.handle({ t: 'snapshot', request: true })[0].robots['rb-VM60'].busy) return []; } return ['timeout']; };
  s2.handle({ t: 'cmd', seq: 1, id: 'rb-VM60', op: 'move', args: { motion: 'ptp', target: { pos, rot, tool: 'cam', rail }, speed: 100 } });
  const errs = run();
  const qEnd = s2.handle({ t: 'snapshot', request: true })[0].robots['rb-VM60'].q;
  const moved = Math.max(...qEnd.map((v, i) => Math.abs(v - q0[i])));
  project.apply(0);                                  // 手臂先回待命位，確認量到的是孿生工作階段給的關節角
  twin.apply(s2.view());
  const dPos = project.robot.getTcpWorld('cam').distanceTo(new THREE.Vector3(...pos));
  const dAng = project.robot.tool.getWorldQuaternion(new THREE.Quaternion()).angleTo(quat) * 180 / Math.PI;
  s2.handle({ t: 'cmd', seq: 2, id: 'rb-VM60', op: 'move', args: { motion: 'ptp', target: { pos: [0, 5000, 0], rot: [0, 0, 0], tool: 'cam' } } });
  const far = run();
  check('robotPose', !errs.length && moved > 0.5 && dPos <= 1 && dAng <= 1 && far[0]?.code === 'BAD_ARGS', { step: step.action, jointTravel: +far0.toFixed(3), sessionTravel: +moved.toFixed(3), tcpError: +dPos.toFixed(3), angleError: +dAng.toFixed(3), unreachable: far[0]?.code ?? null });
}

// ---------------------------------------------------------------- 5. 即時干涉（SPE-AC-22）與工件持有權（SPE-AC-23）
// 手臂以關節指令移進 S3 左立柱 → 一則 event collision（a、b 用名稱找得回場景物件、depth > 0），同一輸入跑兩次事件逐位元相同；
// S2 夾持情境（輸送到 S2、夾緊、鬆開，手臂不動）全程 0 則。S3 翻轉夾臂在載具上夾緊 → 產品交給治具，鬆開 → 交回載具
{
  const { resolvePath } = await import('../../../core/twin/binding.js');
  const runHub = (cmds, ticks) => {
    const s = createTwinSession({ prepared, mdHash: recorded }), out = [];
    s.handle({ t: 'hello', proto: 'zqs.twin/2.0', role: 'hub', mdHash: recorded, mode: 'lockstep', dt: 0.01 });
    let seq = 0, k = 0;
    for (const [at, id, op, args] of cmds) { while (k < at) { k++; out.push(...s.handle({ t: 'tick', n: k, tUs: k * 10000, time: k / 100, dt: 0.01 })); } s.handle({ t: 'cmd', seq: ++seq, id, op, args }); }
    while (k < ticks) { k++; out.push(...s.handle({ t: 'tick', n: k, tUs: k * 10000, time: k / 100, dt: 0.01 })); }
    return { out, snap: s.handle({ t: 'snapshot', request: true })[0] };
  };
  const into = [[0, 'ax-RAIL', 'move_abs', { pos: 500 }], [0, 'rb-VM60', 'move', { motion: 'ptp', target: { q: [-1.3, -0.4, -0.5, 0, 0.5, 0] } }]];
  const a = runHub(into, 600), b = runHub(into, 600);
  const hits = a.out.filter(m => m.t === 'event' && m.k === 'collision');
  const post = hits.filter(h => h.b.endsWith('S3 左立柱'));
  const found = post.every(h => resolvePath(twin, h.a) && resolvePath(twin, h.b));
  const s2 = runHub([[0, 'scene', 'wp_spawn', { wp: 'wp-1', kind: 'V110-STND', at: 'cell/pallet' }], [0, 'ax-CONV', 'move_abs', { pos: 0 }], [600, 'io-S2-CLAMP-V', 'set', { value: true }], [800, 'io-S2-CLAMP-V', 'set', { value: false }]], 1000);
  const s2hits = s2.out.filter(m => m.t === 'event' && m.k === 'collision').length;
  check('collision', post.length >= 1 && post[0].depth > 0 && found && JSON.stringify(a.out) === JSON.stringify(b.out) && s2hits === 0,
    { into: hits.length, first: post[0] ? { a: post[0].a, b: post[0].b, depth: post[0].depth, time: post[0].time } : null, resolvable: found, repeatable: JSON.stringify(a.out) === JSON.stringify(b.out), s2ClampEvents: s2hits });
  const s3 = runHub([[0, 'scene', 'wp_spawn', { wp: 'wp-1', kind: 'V110-STND', at: 'cell/pallet' }], [0, 'ax-CONV', 'move_abs', { pos: 1150 }], [0, 'ax-S3-LIFT', 'move_abs', { pos: 0 }],
    [700, 'io-S3-GRIP-V', 'set', { value: true }], [900, 'io-S3-GRIP-V', 'set', { value: false }]], 1100);
  const moves = s3.out.filter(m => m.t === 'event' && m.k === 'workpiece' && m.action === 'transferred').map(m => m.holder);
  check('workpieceTransfer', moves.join() === 'cell/cradle,cell/pallet' && s3.snap.workpieces[0].holder === 'cell/pallet', { transfers: moves });
}

writeFileSync(here('../review/twin-checks.json'), JSON.stringify({ checks: report, failures }, null, 2) + '\n');
console.log(JSON.stringify({ checks: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.ok ?? v.skipped])), failures }));
if (failures.length) process.exitCode = 1;
