// S6 工件持有權轉移與吸盤真空開關（SPE-AC-19、23 的引擎部分）、S5 即時干涉事件（SPE-AC-22 的引擎部分）、proximity
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, driver, ofType, lastSnapshot, fixture, fakeTwin, schema } from './helpers.mjs';

// 合成 MD 加一個真空吸盤（致動器＋DO＋vacuumSwitch）與一個 proximity
function md() {
  const m = fixture();
  m.io.push(
    { id: 'io-VAC-V', device: 'dev-PLC1', dir: 'DO', address: 'R510', unit: 'U-MAIN', function: { 'zh-Hant': '吸盤閥' }, drives: { actuator: 'act-VAC', action: 'on' } },
    { id: 'io-VAC-OK', device: 'dev-PLC1', dir: 'DI', address: 'R010', unit: 'U-MAIN', function: { 'zh-Hant': '真空到達' } },
    { id: 'io-PROX', device: 'dev-PLC1', dir: 'DI', address: 'R011', unit: 'U-MAIN', function: { 'zh-Hant': '近接' } });
  m.actuators.push({ id: 'act-VAC', name: { 'zh-Hant': '吸盤' }, type: 'vacuum', unit: 'U-MAIN', solenoid: 'single', travelTime: { on: 0.1, off: 0.1 }, scene: { object: 'cell/vac', stateKey: 'vac' } });
  m.sensors.push(
    { id: 'sen-VAC-OK', type: 'vacuumSwitch', io: 'io-VAC-OK', actuator: 'act-VAC', at: 'held' },
    { id: 'sen-PROX', type: 'proximity', io: 'io-PROX', scene: { origin: [900, 0, 0], range: 30 } });
  return m;
}
const twin = (extra = {}) => fakeTwin({
  keys: ['x', 'rot', 'q.rail', 'cyl', 'grip', 'q', 'vac'],
  objects: { 'cell/x': {}, 'cell/r': {}, robot: {}, 'cell/cyl': {}, 'cell/grip': {}, 'cell/lamp': {}, 'cell/cam': {}, 'cell/vac': {} },
  initialView: () => ({ keys: { x: 0, rot: 0, 'q.rail': 0, cyl: 0, grip: 0, q: [0, 0], vac: 0 }, paths: { 'cell/lamp': 0 } }),
  transfers: [{ from: 'cell/x', to: 'cell/vac', when: c => c.state('act-VAC') === 'held' && c.pos('ax-X') >= 400 }],
  ...extra,
});

test('合成 MD 仍通過 Automation-Schema 的 MD 驗證', { skip: schema ? false : '找不到 Automation-Schema' }, () => {
  const r = schema.validateMachineDescription(md());
  assert.ok(r.valid, JSON.stringify(r.errors));
});

test('持有權轉移：條件成立的 tick 送 transferred、snapshot 的 holder 改變；vacuumSwitch 要吸盤 held 且吸盤上有工件', () => {
  const s = newSession({ md: md(), twin: twin() }), d = driver(s); d.hello();
  d.cmd('scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' });
  d.cmd('io-VAC-V', 'set', { value: true }); d.run(0.3);
  assert.equal(lastSnapshot(s).di['io-VAC-OK'], false);              // 吸盤 held，但工件還在 cell/x
  d.cmd('ax-X', 'move_abs', { pos: 400 });
  const out = d.run(2);
  const ev = ofType(out, 'event').filter(e => e.k === 'workpiece' && e.action === 'transferred');
  assert.deepEqual(ev.map(e => [e.wp, e.holder]), [['wp-1', 'cell/vac']]);
  assert.deepEqual(lastSnapshot(s).workpieces, [{ wp: 'wp-1', kind: 'A', holder: 'cell/vac' }]);
  assert.equal(lastSnapshot(s).di['io-VAC-OK'], true);
  d.cmd('io-VAC-V', 'set', { value: false }); d.run(0.3);
  assert.equal(lastSnapshot(s).di['io-VAC-OK'], false);
});

test('proximity：站的 sense 判定（區域與目標重疊）', () => {
  const t = twin({ sense: sensor => sensor.id === 'sen-PROX' ? Math.abs((t.last?.keys.x ?? 0) - 900) <= 30 : false, apply(v) { t.last = v; }, geometryKeys: ['x'] });
  const s = newSession({ md: md(), twin: t }), d = driver(s); d.hello();
  assert.equal(lastSnapshot(s).di['io-PROX'], false);
  d.cmd('ax-X', 'move_abs', { pos: 910 }); d.run(4);
  assert.equal(lastSnapshot(s).di['io-PROX'], true);
});

test('即時干涉：開始干涉時送一次 event collision，分開後再干涉才再送；依虛擬時間格點降頻', () => {
  let last = null, calls = 0;
  const t = twin({ apply(v) { last = v; }, collide() { calls++; return last && last.keys.x > 800 ? [{ a: 'robot/arm', b: 'cell/post', depth: last.keys.x - 800 }] : []; }, config: { collisionEvery: 0.05 } });
  const s = newSession({ md: md(), twin: t }), d = driver(s); d.hello();
  d.cmd('ax-X', 'move_abs', { pos: 900 });
  const hit = ofType(d.run(3, 10000), 'event').filter(e => e.k === 'collision');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].a, 'robot/arm'); assert.ok(hit[0].depth > 0); assert.equal(hit[0].n > 0, true);
  assert.ok(calls <= 61 && calls >= 59, String(calls));                // 3 s ÷ 0.05 s
  d.cmd('ax-X', 'move_abs', { pos: 700 }); d.run(2);
  d.cmd('ax-X', 'move_abs', { pos: 950 });
  assert.equal(ofType(d.run(2), 'event').filter(e => e.k === 'collision').length, 1);
});
