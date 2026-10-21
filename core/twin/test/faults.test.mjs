// SPE-AC-08 故障六種、SPE-AC-20 sensorStuck／actuatorStuck 與 DI
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, driver, ofType, lastSnapshot, fixture } from './helpers.mjs';

const start = (md) => { const s = newSession(md ? { md } : {}), d = driver(s); d.hello(); return { s, d }; };
const faultEvents = out => ofType(out, 'event').filter(e => e.k === 'fault').map(e => [e.fid, e.status, e.n]);

test('生效 = t0 ≥ from 的第一個 tick、解除 = t0 ≥ until 的第一個 tick；兩者都送 event k:fault', () => {
  const { s, d } = start();
  d.fault({ fid: 'f-1', action: 'inject', id: 'ax-R', kind: 'axisFault', from: 0.02, until: 0.05, params: { code: 'E7' } });
  const log = [];
  for (let i = 1; i <= 8; i++) log.push(...faultEvents(d.tick(10000)));
  // tick n 的 t0 = (n-1) × 10 ms：t0 = 20 ms 是 tick 3、t0 = 50 ms 是 tick 6
  assert.deepEqual(log, [['f-1', 'active', 3], ['f-1', 'cleared', 6]]);
  assert.deepEqual(lastSnapshot(s).faults, []);
});

test('clear：下一個 tick 解除並送 cleared（帶 n、排在 state 之後）；snapshot.faults 只列生效中的', () => {
  const { s, d } = start();
  d.fault({ fid: 'f-1', action: 'inject', id: 'rb-ARM', kind: 'robotFault' });
  d.tick();
  assert.deepEqual(lastSnapshot(s).faults, ['f-1']);
  assert.equal(lastSnapshot(s).robots['rb-ARM'].task, 'error');
  s.handle({ t: 'fault', seq: 9, fid: 'f-1', action: 'clear' });
  const out = d.tick();
  assert.deepEqual(faultEvents(out), [['f-1', 'cleared', 2]]);
  assert.ok(out.findIndex(m => m.t === 'event') > out.findIndex(m => m.t === 'state'));
  assert.deepEqual(lastSnapshot(s).faults, []);
});

test('sensorStuck（sen- 目標）覆寫感測器輸出；io- 目標的 value 也是感測器輸出，再套 io.logic（inverted）', () => {
  const { s, d } = start();
  d.tick();
  assert.equal(lastSnapshot(s).di['io-AIR'], true);
  assert.equal(lastSnapshot(s).di['io-CYL-RET'], false);           // 縮回中、inverted → PLC 看到 false
  d.fault({ fid: 'f-1', action: 'inject', id: 'sen-AIR', kind: 'sensorStuck', params: { value: false } });
  d.fault({ fid: 'f-2', action: 'inject', id: 'io-CYL-RET', kind: 'sensorStuck', params: { value: false } });
  d.tick();
  const di = lastSnapshot(s).di;
  assert.equal(di['io-AIR'], false);
  assert.equal(di['io-CYL-RET'], true);                             // 感測器輸出 false → inverted → true
});

test('actuatorStuck at mid：氣缸卡在中間，伸出磁簧維持 OFF', () => {
  const { s, d } = start();
  d.fault({ fid: 'f-1', action: 'inject', id: 'act-CYL', kind: 'actuatorStuck', params: { at: 'mid' } });
  d.cmd('io-CYL-V', 'set', { value: true });
  d.run(1);
  const snap = lastSnapshot(s);
  assert.equal(snap.actuators['act-CYL'].pos, 0.5); assert.equal(snap.actuators['act-CYL'].state, null);
  assert.equal(snap.di['io-CYL-EXT'], false);
});

test('followingError：未超過門檻只偏離回授、不設 fault；超過門檻與 MD 未填門檻時注入即 FOLLOWING_ERROR 並停止', () => {
  {
    const { s, d } = start();                                       // ax-X 的 followingErrorLimit = 2
    d.cmd('ax-X', 'move_abs', { pos: 100 }); d.run(1);
    d.fault({ fid: 'f-1', action: 'inject', id: 'ax-X', kind: 'followingError', params: { error: 1.5 } }); d.tick();
    let ax = lastSnapshot(s).axes['ax-X'];
    assert.equal(ax.fault, null); assert.equal(ax.pos, 101.5);
    d.fault({ fid: 'f-2', action: 'inject', id: 'ax-X', kind: 'followingError', params: { error: 3 } });
    d.cmd('ax-X', 'move_abs', { pos: 900 }); d.tick(); d.tick();
    ax = lastSnapshot(s).axes['ax-X'];
    assert.equal(ax.fault, 'FOLLOWING_ERROR'); assert.equal(ax.busy, false);
  }
  {
    const md = fixture(); delete md.axes[0].followingErrorLimit;
    const { s, d } = start(md);
    d.cmd('ax-X', 'move_abs', { pos: 900 }); d.tick();
    d.fault({ fid: 'f-1', action: 'inject', id: 'ax-X', kind: 'followingError', params: { error: 0.1 } }); d.tick();
    const ax = lastSnapshot(s).axes['ax-X'];
    assert.equal(ax.fault, 'FOLLOWING_ERROR'); assert.equal(ax.busy, false); assert.equal(ax.vel, 0);
  }
});

test('axisFault：busy = false、fault = code；之後的 move 回 BAD_ARGS', () => {
  const { s, d } = start();
  d.cmd('ax-X', 'move_abs', { pos: 900 }); d.tick();
  d.fault({ fid: 'f-1', action: 'inject', id: 'ax-X', kind: 'axisFault', params: { code: 'OVERLOAD' } }); d.tick();
  assert.deepEqual([lastSnapshot(s).axes['ax-X'].busy, lastSnapshot(s).axes['ax-X'].fault], [false, 'OVERLOAD']);
  d.cmd('ax-X', 'move_abs', { pos: 10 });
  assert.equal(ofType(d.tick(), 'error')[0].code, 'BAD_ARGS');
});

test('commLoss：該設備的狀態凍結、cmd 回 DEVICE_OFFLINE；指向 PLC 設備回 UNSUPPORTED_OP、不生效', () => {
  const { s, d } = start();
  d.cmd('ax-X', 'move_abs', { pos: 900 }); d.tick();
  d.fault({ fid: 'f-1', action: 'inject', id: 'dev-EC1', kind: 'commLoss' });
  const frozenAt = (d.tick(), lastSnapshot(s).axes['ax-X'].pos);
  d.run(0.5);
  assert.equal(lastSnapshot(s).axes['ax-X'].pos, frozenAt);
  d.fault({ fid: 'f-2', action: 'inject', id: 'dev-PLC1', kind: 'commLoss' });
  const out = d.tick();
  assert.deepEqual(ofType(out, 'error').map(e => [e.code, e.refSeq, e.fatal]), [['UNSUPPORTED_OP', 3, false]]);
  assert.deepEqual(lastSnapshot(s).faults, ['f-1']);
});

test('故障目標不存在 → UNKNOWN_ID；種類不符或 unbound → UNSUPPORTED_OP', () => {
  const { d } = start();
  d.fault({ fid: 'f-1', action: 'inject', id: 'sen-NOPE', kind: 'sensorStuck', params: { value: true } });
  d.fault({ fid: 'f-2', action: 'inject', id: 'ax-X', kind: 'robotFault' });
  d.fault({ fid: 'f-3', action: 'inject', id: 'act-LOOSE', kind: 'actuatorStuck', params: { at: 'mid' } });
  assert.deepEqual(ofType(d.tick(), 'error').map(e => e.code), ['UNKNOWN_ID', 'UNSUPPORTED_OP', 'UNSUPPORTED_OP']);
});
