// SPE-AC-11 即時模式：收到 tick → UNEXPECTED；state 依 pollRealtime 週期送出、沒有變化也送；cmd 收到即套用（假時鐘）
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, hubHello, ofType } from './helpers.mjs';

const start = () => { const s = newSession(); s.handle(hubHello({ mode: 'realtime', stateRate: 20 })); return s; };

test('即時模式收到 tick → UNEXPECTED（non-fatal）', () => {
  const s = start();
  const out = s.handle({ t: 'tick', n: 1, tUs: 1000, time: 0.001, dt: 0.001 });
  assert.equal(out[0].code, 'UNEXPECTED'); assert.equal(out[0].fatal, false); assert.ok(!s.closed);
  assert.equal(s.stateRate, 20);
});

test('沒有變化也送 state（兼作心跳），不帶 n、tUs', () => {
  const s = start();
  for (let i = 1; i <= 3; i++) {
    const [st] = ofType(s.pollRealtime(i * 50000), 'state');
    assert.ok(st); assert.ok(!('n' in st) && !('tUs' in st)); assert.equal(st.time, i * 50000 / 1e6);
    assert.ok(!st.axes);
  }
});

test('cmd 收到即套用；被拒的立即回 error', () => {
  const s = start();
  assert.deepEqual(s.handle({ t: 'cmd', seq: 1, id: 'ax-X', op: 'move_abs', args: { pos: 100 } }), []);
  assert.equal(s.handle({ t: 'cmd', seq: 2, id: 'ax-NOPE', op: 'home', args: {} })[0].code, 'UNKNOWN_ID');
  const [st] = ofType(s.pollRealtime(100000), 'state');
  assert.equal(st.axes['ax-X'].busy, true);
});
