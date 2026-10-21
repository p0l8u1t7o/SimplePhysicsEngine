// SPE-AC-03 鎖步順序、SPE-AC-05 增量 state 與 snapshot
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, driver, ofType, schema, needSchema } from './helpers.mjs';

const order = { error: 0, state: 1, event: 2, tickAck: 3 };

test('每個 tick 的輸出恰為 [error]* → state(n)? → event(n)* → tickAck(n)', () => {
  const s = newSession(), d = driver(s); d.hello();
  d.cmd('ax-NOPE', 'home');                                  // UNKNOWN_ID
  d.cmd('ax-X', 'move_abs', { pos: 100 });
  d.cmd('scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' });
  d.cmd('ax-X', 'move_abs', { pos: 5000 });                  // BAD_ARGS（超出行程）
  const first = d.tick();
  assert.deepEqual(first.map(m => m.t), ['error', 'error', 'state', 'event', 'tickAck']);
  assert.deepEqual(first.filter(m => m.t === 'error').map(e => [e.code, e.refSeq, e.fatal]), [['UNKNOWN_ID', 1, false], ['BAD_ARGS', 4, false]]);
  for (let i = 0; i < 200; i++) {
    const out = d.tick();
    const ranks = out.map(m => order[m.t]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.equal(ofType(out, 'tickAck').length, 1); assert.equal(out.at(-1).t, 'tickAck'); assert.equal(out.at(-1).n, d.n);
    assert.ok(ofType(out, 'state').length <= 1);
    for (const m of out) if (m.t === 'state' || m.t === 'event') assert.equal(m.n, d.n);
    for (const m of ofType(out, 'state')) assert.equal(m.tUs, d.tUs);
  }
});

test('tick 之間不主動送東西：cmd／fault 收到時不回覆（驗證延到下一個 tick 開始）', () => {
  const s = newSession(), d = driver(s); d.hello();
  assert.deepEqual(d.cmd('ax-NOPE', 'home'), []);
  assert.deepEqual(d.fault({ fid: 'f-1', action: 'inject', id: 'sen-NOPE', kind: 'sensorStuck', params: { value: true } }), []);
  assert.equal(ofType(d.tick(), 'error').length, 2);
});

test('tick 跳號、tUs 不等於上一個 tUs + dt × 10⁶ → OUT_OF_ORDER fatal', () => {
  for (const bad of [{ n: 2, tUs: 1000, dt: 0.001 }, { n: 1, tUs: 1500, dt: 0.001 }, { n: 1, tUs: 0, dt: 0.001 }]) {
    const s = newSession(), d = driver(s); d.hello();
    const out = s.handle({ t: 'tick', time: bad.tUs / 1e6, ...bad });
    assert.equal(out.length, 1); assert.equal(out[0].code, 'OUT_OF_ORDER'); assert.equal(out[0].fatal, true); assert.ok(s.closed);
  }
});

test('沒有變化的 tick 不送 state；有變化只列變化的實體，欄位完整', () => {
  const s = newSession(), d = driver(s); d.hello();
  assert.equal(ofType(d.tick(), 'state').length, 0);
  d.cmd('ax-X', 'move_abs', { pos: 50 });
  const [st] = ofType(d.tick(), 'state');
  assert.deepEqual(Object.keys(st.axes), ['ax-X']);
  assert.deepEqual(Object.keys(st.axes['ax-X']), ['pos', 'vel', 'busy', 'inPos', 'enabled', 'homed', 'fault']);
  assert.ok(!('actuators' in st) && !('robots' in st));
});

test('snapshot 要求：立即回覆、n = 最後完成的 tick，列出綁定實體、工件與生效中的故障', () => {
  const s = newSession(), d = driver(s); d.hello();
  d.cmd('scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' });
  d.fault({ fid: 'f-1', action: 'inject', id: 'sen-AIR', kind: 'sensorStuck', params: { value: false } });
  d.fault({ fid: 'f-2', action: 'inject', id: 'sen-FULL', kind: 'sensorStuck', from: 10, params: { value: true } });
  d.tick(); d.tick();
  const [snap] = d.snapshot();
  assert.equal(snap.t, 'snapshot'); assert.equal(snap.n, 2); assert.equal(snap.tUs, 2000);
  assert.deepEqual(Object.keys(snap.axes), ['ax-R', 'ax-RAIL', 'ax-X']);
  assert.deepEqual(Object.keys(snap.actuators), ['act-CYL', 'act-GRIP', 'act-LAMP']);
  assert.deepEqual(snap.workpieces, [{ wp: 'wp-1', kind: 'A', holder: 'cell/x' }]);
  assert.deepEqual(snap.faults, ['f-1']);
  assert.equal(snap.di['io-AIR'], false);
});

test('所有輸出都通過 Automation-Schema 的訊息 schema', needSchema, () => {
  const s = newSession({ withSchema: true }), d = driver(s), out = [...d.hello()];
  d.cmd('ax-X', 'move_abs', { pos: 500 }); d.cmd('io-CYL-V', 'set', { value: true }); d.cmd('rb-ARM', 'move', { motion: 'ptp', target: { q: [0.5, -0.2] } });
  d.cmd('dev-IPC1', 'vision', { action: 'trigger', shot: 's1' }); d.cmd('rb-ARM', 'task', { action: 'start', name: 'PICK' });
  d.fault({ fid: 'f-1', action: 'inject', id: 'ax-R', kind: 'axisFault', from: 0.2, until: 0.4, params: { code: 'E1' } });
  out.push(...d.run(2), ...d.snapshot(), ...s.handle({ t: 'bye', reason: 'done' }));
  for (const m of out) { const v = schema.validateTwinMessage(m); assert.ok(v.valid, JSON.stringify(m) + JSON.stringify(v.errors)); }
});
