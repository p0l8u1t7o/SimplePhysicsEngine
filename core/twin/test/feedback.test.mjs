// AutoSequence 聯調回饋（2026-10-22）P2～P4 的回歸測試（P1 在 server.test.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, driver, ofType, lastSnapshot, fakeTwin, hubHello, needSchema } from './helpers.mjs';

test('P2：初始狀態是全部 DO OFF 的穩態：單線圈與無電磁閥的致動器在 states[0]，雙線圈沿用站的初始畫面', () => {
  // 站的初始畫面把單線圈氣缸（scale 100）畫在伸出、雙線圈夾爪畫在閉合
  const twin = fakeTwin({ initialView: () => ({ keys: { x: 0, rot: 0, 'q.rail': 0, cyl: 100, grip: 1, q: [0, 0] }, paths: { 'cell/lamp': 1 } }) });
  const s = newSession({ twin }), d = driver(s); d.hello();
  const snap = lastSnapshot(s);
  assert.equal(snap.actuators['act-CYL'].pos, 0);
  assert.equal(snap.actuators['act-LAMP'].pos, 0);
  assert.equal(snap.actuators['act-GRIP'].pos, 1);
  // 第一批 DO 全部 OFF 不會讓單線圈氣缸動（以前會從伸出收回、多出一段 motion）
  for (const id of ['io-CYL-V', 'io-GRIP-CLOSE', 'io-GRIP-OPEN', 'io-LAMP']) d.cmd(id, 'set', { value: false });
  const out = d.run(1);
  assert.ok(!ofType(out, 'state').some(m => m.actuators?.['act-CYL'] || m.actuators?.['act-LAMP']), '單線圈致動器不該有狀態變化');
});

test('P3：不合 schema 的 cmd 不執行、回 non-fatal error，不會被回送到 event（有 schema 時不需 --validate）', needSchema, () => {
  const s = newSession({ withSchema: true });
  s.receive(JSON.stringify(hubHello()));
  const bad = s.receive(JSON.stringify({ t: 'cmd', seq: 1, id: 'dev-IPC1', op: 'vision', args: { action: 'trigger', shot: 1 } }));
  assert.equal(bad.length, 1); assert.equal(bad[0].t, 'error'); assert.equal(bad[0].fatal, false); assert.equal(bad[0].refSeq, 1);
  const out = [];
  for (let n = 1; n <= 80; n++) out.push(...s.receive(JSON.stringify({ t: 'tick', n, tUs: n * 1000, time: n / 1000, dt: 0.001 })));
  assert.equal(ofType(out, 'event').filter(e => e.k === 'exposure').length, 0);
});

test('P3：沒有 schema 時，內建檢查也擋下會回送的錯誤型別（vision 的 shot 必須是字串）', () => {
  const s = newSession(), d = driver(s); d.hello();
  d.cmd('dev-IPC1', 'vision', { action: 'trigger', shot: 1 });
  const out = d.run(0.2, 1000);
  assert.deepEqual(ofType(out, 'error').map(e => [e.code, e.refSeq]), [['BAD_ARGS', 1]]);
  assert.equal(ofType(out, 'event').filter(e => e.k === 'exposure').length, 0);
});

test('P4：幾何沒有變化時不重算干涉；有變化時照常檢查，事件不變', () => {
  let last = null, calls = 0;
  const twin = fakeTwin({ apply(v) { last = v; }, collide() { calls++; return last && last.keys.x > 800 ? [{ a: 'robot/arm', b: 'cell/post', depth: last.keys.x - 800 }] : []; } });
  const s = newSession({ twin }), d = driver(s); d.hello();
  d.run(5);                                                   // 5 s 靜止（10 ms idle tick）：只在第一次檢查
  assert.equal(calls, 1);
  d.cmd('ax-X', 'move_abs', { pos: 900 });
  const hit = ofType(d.run(4, 1000), 'event').filter(e => e.k === 'collision');
  assert.equal(hit.length, 1);
  const moving = calls;
  assert.ok(moving > 10, String(moving));                    // 移動中照常每 20 ms 檢查
  d.run(5);                                                   // 停下後不再重算
  assert.ok(calls <= moving + 1, `${moving} → ${calls}`);
});
