// SPE-AC-06 cmd 語意（每個 op 一個正例、四種錯誤碼各一個反例）、SPE-AC-07 動態
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, driver, ofType, lastSnapshot } from './helpers.mjs';
import { trapezoid } from '../dynamics/axis.js';

const start = () => { const s = newSession(), d = driver(s); d.hello(); return { s, d }; };
const errors = out => ofType(out, 'error').map(e => [e.code, e.refSeq, e.fatal]);

test('錯誤碼：UNKNOWN_ID、UNSUPPORTED_OP（含 unbound）、BAD_ARGS、DEVICE_OFFLINE 都是 non-fatal，refSeq = cmd 的 seq', () => {
  const { s, d } = start();
  d.cmd('ax-NOPE', 'home');                                      // 1 UNKNOWN_ID
  d.cmd('act-LOOSE', 'set', { value: true });                    // 2 UNSUPPORTED_OP：unbound（而且 set 只能寫 io）
  d.cmd('ax-X', 'set', { value: true });                         // 3 UNSUPPORTED_OP：軸不支援 set
  d.cmd('io-CYL-EXT', 'set', { value: true });                   // 4 UNSUPPORTED_OP：不是輸出點
  d.cmd('ax-X', 'move_abs', { pos: -1 });                        // 5 BAD_ARGS：超出行程
  d.cmd('io-CYL-V', 'set', { value: 3 });                        // 6 BAD_ARGS：DO 要布林
  d.fault({ fid: 'f-1', action: 'inject', id: 'dev-EC1', kind: 'commLoss' });  // 7
  d.tick();
  d.cmd('ax-X', 'home');                                         // 8 DEVICE_OFFLINE
  assert.deepEqual(errors(d.tick()), [['DEVICE_OFFLINE', 8, false]]);
  assert.ok(!s.closed);
});

test('每個 op 的正例都不回 error', () => {
  const { s, d } = start();
  const ops = [
    ['ax-X', 'move_abs', { pos: 10 }], ['ax-R', 'move_rel', { dist: 5 }], ['ax-X', 'stop', {}], ['ax-X', 'enable', { value: true }],
    ['ax-R', 'home', {}], ['ax-X', 'clear_error', {}], ['io-CYL-V', 'set', { value: true }], ['io-AO', 'set', { value: 2.5 }],
    ['rb-ARM', 'move', { motion: 'ptp', target: { q: [0.1, 0.1] } }], ['rb-ARM', 'task', { action: 'start', name: 'PICK' }], ['rb-ARM', 'stop', {}],
    ['dev-LC1', 'light', { on: true, channel: 1, level: 80 }], ['dev-IPC1', 'barcode', { action: 'trigger' }], ['dev-IPC1', 'vision', { action: 'trigger', shot: 'a' }],
    ['scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' }], ['scene', 'wp_remove', { wp: 'wp-1' }],
  ];
  for (const [id, op, args] of ops) d.cmd(id, op, args);
  assert.deepEqual(errors(d.tick()), []);
  assert.deepEqual(s.view().lights, { 'dev-LC1': { on: true, channel: 1, level: 80 } });
});

test('move_abs 到位時刻與梯形閉式解相差 ≤ 1 tick；busy／inPos 轉換', () => {
  const { s, d } = start();
  d.cmd('ax-X', 'move_abs', { pos: 800, v: 400, a: 1000 });
  const endUs = trapezoid(0, 0, 800, 400, 1000).endUs;
  let doneAt = null;
  for (let i = 0; i < 4000 && doneAt === null; i++) {
    const st = ofType(d.tick(1000), 'state')[0];
    const ax = st?.axes?.['ax-X'];
    if (ax && !ax.busy) { doneAt = d.tUs; assert.equal(ax.inPos, true); assert.equal(ax.pos, 800); assert.equal(ax.vel, 0); }
    else if (ax) { assert.equal(ax.busy, true); assert.equal(ax.inPos, false); }
  }
  assert.ok(Math.abs(doneAt - endUs) <= 1000, `${doneAt} vs ${endUs}`);
});

test('stop controlled 減速、immediate 立即', () => {
  for (const mode of ['controlled', 'immediate']) {
    const { s, d } = start();
    d.cmd('ax-X', 'move_abs', { pos: 1000 }); d.run(0.5);
    d.cmd('ax-X', 'stop', { mode });
    const ax = ofType(d.tick(1000), 'state')[0].axes['ax-X'];
    if (mode === 'immediate') { assert.equal(ax.vel, 0); assert.equal(ax.busy, false); }
    else { assert.ok(Math.abs(ax.vel) > 0); assert.equal(ax.busy, true); d.run(1); assert.equal(lastSnapshot(s).axes['ax-X'].busy, false); }
  }
});

test('單線圈氣缸：set true 後依 travelTime 到 extended，false 後彈簧復歸 retracted；state 只在端點', () => {
  const { s, d } = start();
  d.cmd('io-CYL-V', 'set', { value: true });
  let reached = null;
  for (let i = 0; i < 700 && reached === null; i++) {
    const st = ofType(d.tick(1000), 'state')[0], a = st?.actuators?.['act-CYL'];
    if (a?.state === 'extended') reached = d.tUs; else if (a) assert.equal(a.state, null);
  }
  assert.ok(Math.abs(reached - 500000) <= 1000, String(reached));
  d.cmd('io-CYL-V', 'set', { value: false }); d.run(0.3, 1000);
  assert.equal(lastSnapshot(s).actuators['act-CYL'].state, 'retracted');
  assert.equal(lastSnapshot(s).actuators['act-CYL'].pos, 0);
});

test('雙線圈夾爪：各動作一個 DO，OFF 不動作；指示燈 travelTime 0 立即', () => {
  const { s, d } = start();
  d.cmd('io-GRIP-CLOSE', 'set', { value: true }); d.run(0.3);
  d.cmd('io-GRIP-CLOSE', 'set', { value: false }); d.run(0.3);
  assert.equal(lastSnapshot(s).actuators['act-GRIP'].state, 'closed');
  d.cmd('io-GRIP-OPEN', 'set', { value: true }); d.cmd('io-LAMP', 'set', { value: true });
  d.tick();
  assert.equal(lastSnapshot(s).actuators['act-LAMP'].state, 'on');
  d.run(0.3);
  assert.equal(lastSnapshot(s).actuators['act-GRIP'].state, 'opened');
});

test('機器人 move ptp 的時間不短於 max(|Δq_i| / vMax_i) ÷ (speed / 100)；帶 rail 時第七軸一起移動', () => {
  const { s, d } = start();
  const q = [1, -0.5], speed = 50;
  const min = Math.max(1 / (90 * Math.PI / 180), 0.5 / (45 * Math.PI / 180)) / (speed / 100);
  d.cmd('rb-ARM', 'move', { motion: 'ptp', target: { q, rail: 200 }, speed });
  let done = null;
  for (let i = 0; i < 5000 && done === null; i++) { d.tick(1000); const r = lastSnapshot(s).robots['rb-ARM']; if (!r.busy) done = d.tUs; }
  assert.ok(done / 1e6 >= min - 1e-9, `${done} < ${min}`);
  const r = lastSnapshot(s).robots['rb-ARM'];
  assert.deepEqual(r.q, q); d.run(2); assert.equal(lastSnapshot(s).robots['rb-ARM'].rail, 200);
});

test('機器人任務：start → running → done（站設定的時長）；未知任務 BAD_ARGS', () => {
  const { s, d } = start();
  d.cmd('rb-ARM', 'task', { action: 'start', name: 'NOPE' });
  assert.deepEqual(errors(d.tick()), [['BAD_ARGS', 1, false]]);
  d.cmd('rb-ARM', 'task', { action: 'start', name: 'PICK' }); d.tick();
  assert.equal(lastSnapshot(s).robots['rb-ARM'].task, 'running');
  d.run(0.5);
  assert.equal(lastSnapshot(s).robots['rb-ARM'].task, 'done');
});

test('vision 觸發 → 曝光延遲後 event exposure（id = 設備、shot 照 cmd）；工件重複 ID → BAD_ARGS', () => {
  const { d } = start();
  d.cmd('dev-IPC1', 'vision', { action: 'trigger', shot: 'top' });
  const ev = ofType(d.run(0.1, 10000), 'event').filter(e => e.k === 'exposure');
  assert.equal(ev.length, 1); assert.equal(ev[0].id, 'dev-IPC1'); assert.equal(ev[0].shot, 'top'); assert.equal(ev[0].time, 0.05);
  d.cmd('scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' }); d.cmd('scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' });
  assert.deepEqual(errors(d.tick()), [['BAD_ARGS', 3, false]]);
});
