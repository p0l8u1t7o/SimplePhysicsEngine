// SPE-AC-17 reed／limitSwitch 與 inverted、SPE-AC-19 pressureSwitch／levelSwitch／幾何感測器（假站的 sense）
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, driver, ofType, lastSnapshot, fakeTwin } from './helpers.mjs';

test('reed：致動器到端點的同一個 tick DI 改變；inverted 反相', () => {
  const s = newSession(), d = driver(s); d.hello();
  d.cmd('io-CYL-V', 'set', { value: true });
  let extAt = null, actAt = null;
  for (let i = 0; i < 700 && extAt === null; i++) {
    const st = ofType(d.tick(1000), 'state')[0];
    if (st?.actuators?.['act-CYL']?.state === 'extended') actAt = d.n;
    if (st?.di?.['io-CYL-EXT'] === true) extAt = d.n;
  }
  assert.equal(extAt, actAt);
  // 一離開縮回端，inverted 的縮回點 PLC 位準就變 true
  assert.equal(lastSnapshot(s).di['io-CYL-RET'], true);
});

test('limitSwitch：軸進出 axisWindow 時 DI 在同一個 tick 改變', () => {
  const s = newSession(), d = driver(s); d.hello();
  assert.equal(lastSnapshot(s).di['io-X-HOME'], true);
  d.cmd('ax-X', 'move_abs', { pos: 10, v: 10, a: 1000 });
  let offAt = null;
  for (let i = 0; i < 300 && offAt === null; i++) {
    const st = ofType(d.tick(1000), 'state')[0];
    if (st?.di?.['io-X-HOME'] === false) { offAt = d.n; assert.ok(st.axes['ax-X'].pos > 1); }
    else if (st?.axes) assert.ok(st.axes['ax-X'].pos <= 1);
  }
  assert.ok(offAt);
});

test('pressureSwitch 預設 ON、levelSwitch 預設 OFF；站的 switches 可以改', () => {
  let s = newSession(); driver(s).hello();
  assert.deepEqual([lastSnapshot(s).di['io-AIR'], lastSnapshot(s).di['io-FULL']], [true, false]);
  s = newSession({ twin: fakeTwin({ config: { switches: { 'sen-AIR': false, 'sen-FULL': true } } }) }); driver(s).hello();
  assert.deepEqual([lastSnapshot(s).di['io-AIR'], lastSnapshot(s).di['io-FULL']], [false, true]);
});

test('photoEye：站的 sense 判定；只有 geometryKeys 改變時才重新套用場景', () => {
  const twin = fakeTwin(), s = newSession({ twin }), d = driver(s); d.hello();
  const applied0 = twin.applied.length;
  d.cmd('io-CYL-V', 'set', { value: true }); d.run(0.6);          // 只動氣缸：不重新套用
  assert.equal(twin.applied.length, applied0);
  d.cmd('ax-X', 'move_abs', { pos: 500 }); d.run(2);
  assert.equal(lastSnapshot(s).di['io-PART'], true);
  assert.ok(twin.applied.length > applied0);
  d.cmd('ax-X', 'move_abs', { pos: 600 }); d.run(1);
  assert.equal(lastSnapshot(s).di['io-PART'], false);
});
