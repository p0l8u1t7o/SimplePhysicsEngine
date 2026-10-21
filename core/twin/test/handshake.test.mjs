// SPE-AC-02 握手、SPE-AC-10 工作階段隔離與 bye
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, hubHello, driver, ofType, schema, needSchema, fixture, fakeTwin, FIXTURE_TEXT, FIXTURE_HASH } from './helpers.mjs';
import { prepareTwin, createTwinSession } from '../session.js';

for (const withSchema of [false, true]) {
  const opts = withSchema ? needSchema : {};
  const tag = withSchema ? '（Automation-Schema）' : '（內建檢查）';

  test('主版號不同 → PROTO_MAJOR_MISMATCH fatal、不送 hello' + tag, opts, () => {
    const s = newSession({ withSchema });
    const out = s.receive(JSON.stringify(hubHello({ proto: 'zqs.twin/3.0' })));
    assert.equal(out.length, 1); assert.equal(out[0].code, 'PROTO_MAJOR_MISMATCH'); assert.equal(out[0].fatal, true); assert.ok(s.closed);
  });

  test('mdHash 不同 → MD_HASH_MISMATCH fatal' + tag, opts, () => {
    const s = newSession({ withSchema });
    const out = s.receive(JSON.stringify(hubHello({ mdHash: 'sha256:' + '0'.repeat(64) })));
    assert.equal(out[0].code, 'MD_HASH_MISMATCH'); assert.ok(s.closed);
  });

  test('minor 不同照常連線；hello 含 station、bindings、unbound，緊接 snapshot n = 0' + tag, opts, () => {
    const s = newSession({ withSchema });
    const out = s.receive(JSON.stringify(hubHello({ proto: 'zqs.twin/2.3' })));
    assert.deepEqual(out.map(m => m.t), ['hello', 'snapshot']);
    const [h, snap] = out;
    assert.equal(h.role, 'spe'); assert.equal(h.station, 'TwinFixture');
    // 3 軸 + 3 致動器（扣 unbound 的 act-LOOSE）+ 7 感測器 + 1 機器人 + 1 有場景的設備（dev-CAM1）
    assert.equal(h.bindings, 15);
    assert.deepEqual(h.unbound, ['dev-CAM2', 'act-LOOSE']);
    assert.equal(snap.n, 0); assert.equal(snap.tUs, 0); assert.equal(snap.time, 0);
    for (const k of ['axes', 'di', 'ai', 'actuators', 'robots', 'workpieces', 'faults']) assert.ok(k in snap, k);
    assert.ok(!('act-LOOSE' in snap.actuators));
  });
}

test('hello 前收到 tick／cmd → NOT_READY fatal', () => {
  for (const m of [{ t: 'tick', n: 1, tUs: 1000, time: 0.001, dt: 0.001 }, { t: 'cmd', seq: 1, id: 'ax-X', op: 'home', args: {} }]) {
    const s = newSession();
    const out = s.receive(JSON.stringify(m));
    assert.equal(out[0].code, 'NOT_READY'); assert.equal(out[0].fatal, true);
  }
});

test('role 不是 hub、hello 不合 schema → BAD_MESSAGE fatal', needSchema, () => {
  assert.equal(newSession({ withSchema: true }).receive(JSON.stringify(hubHello({ role: 'spe' })))[0].code, 'BAD_MESSAGE');
  const s = newSession({ withSchema: true });
  const out = s.receive(JSON.stringify(hubHello({ dt: undefined, mode: 'lockstep', station: 'x' })));
  assert.equal(out[0].code, 'BAD_MESSAGE'); assert.equal(out[0].fatal, true);
});

test('mdHash 與 Automation-Schema 的 mdHashOfText 相同', needSchema, () => {
  assert.equal(schema.mdHashOfText(FIXTURE_TEXT), FIXTURE_HASH);
});

test('收到 Hub 的 bye → 回 bye(done) 並關閉', () => {
  const s = newSession(); driver(s).hello();
  assert.deepEqual(s.handle({ t: 'bye', reason: 'done' }), [{ t: 'bye', reason: 'done' }]);
  assert.ok(s.closed);
  assert.deepEqual(s.handle({ t: 'tick', n: 1, tUs: 1000, time: 0.001, dt: 0.001 }), []);
});

test('兩條連線的 snapshot n = 0 逐位元組相同（從站的初始狀態開始）', () => {
  // 同一份 prepared（同一個站場景）連續服務兩條連線
  const prepared = prepareTwin({ md: fixture(), twin: fakeTwin() });
  const a = createTwinSession({ prepared, mdHash: FIXTURE_HASH }), d = driver(a);
  const first = JSON.stringify(d.hello()[1]);
  d.cmd('ax-X', 'move_abs', { pos: 300 }); d.cmd('io-CYL-V', 'set', { value: true }); d.run(0.5);
  a.handle({ t: 'bye', reason: 'done' });
  const b = createTwinSession({ prepared, mdHash: FIXTURE_HASH });
  assert.equal(JSON.stringify(driver(b).hello()[1]), first);
});

test('同一個 session 物件重新 hello 被拒（BAD_MESSAGE fatal）', () => {
  const s = newSession(); driver(s).hello();
  const out = s.handle(hubHello());
  assert.equal(out[0].code, 'BAD_MESSAGE'); assert.ok(s.closed);
  assert.equal(ofType(out, 'snapshot').length, 0);
});
