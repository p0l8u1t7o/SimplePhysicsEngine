// SPE-AC-10（TCP）工作階段隔離與關閉、Q-15 一次一條連線、SPE-AC-01 送出端的 maxLine、SPE-AC-12 SSE 不影響工作階段
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { createTwinServer } from '../../tools/twin-server.mjs';
import { prepareTwin } from '../session.js';
import { createLineReader, parseMessage } from '../framing.js';
import { fixture, fakeTwin, hubHello, FIXTURE_HASH } from './helpers.mjs';

async function start(extra = {}) {
  const server = createTwinServer({ prepared: prepareTwin({ md: fixture(), twin: fakeTwin() }), mdHash: FIXTURE_HASH, sseEveryUs: 0, ...extra });
  const addr = await server.listen({ port: 0, ssePort: 0 });
  return { server, ...addr };
}
// 一條 Hub 連線：send(msg) 後 until(條件) 等回覆
function connect(port) {
  const socket = net.connect(port, '127.0.0.1'), reader = createLineReader(), got = [], waits = [];
  let closed = false;
  socket.on('data', c => { for (const l of reader.push(c).lines) { const m = parseMessage(l).msg; got.push(m); for (const w of [...waits]) if (w.f(m)) { waits.splice(waits.indexOf(w), 1); w.ok(m); } } });
  socket.on('close', () => { closed = true; for (const w of waits.splice(0)) w.ok(null); });
  return {
    got, socket, get closed() { return closed; },
    send: m => socket.write(JSON.stringify(m) + '\n'),
    until: f => new Promise(ok => { const hit = got.find(f); if (hit) ok(hit); else waits.push({ f, ok }); }),
    closedP: () => new Promise(r => (closed ? r() : socket.once('close', r))),
  };
}
// 等 server 端也釋放連線（client 端關閉時 server 端的 close 事件可能稍晚）
const idle = async server => { while (server.busy) await new Promise(r => setImmediate(r)); };
const lockstep = async (c, ticks) => {
  for (let n = 1; n <= ticks; n++) { c.send({ t: 'tick', n, tUs: n * 1000, time: n / 1000, dt: 0.001 }); await c.until(m => m.t === 'tickAck' && m.n === n); }
};

test('bye 或斷線後可以接受下一條連線，兩次的 snapshot n = 0 逐位元組相同', async () => {
  const { server, port } = await start();
  const a = connect(port);
  a.send(hubHello());
  const snapA = await a.until(m => m.t === 'snapshot');
  a.send({ t: 'cmd', seq: 1, id: 'ax-X', op: 'move_abs', args: { pos: 400 } });
  await lockstep(a, 50);
  a.send({ t: 'bye', reason: 'done' });
  assert.deepEqual(await a.until(m => m.t === 'bye'), { t: 'bye', reason: 'done' });
  await a.closedP(); await idle(server);
  const b = connect(port);
  b.send(hubHello());
  assert.equal(JSON.stringify(await b.until(m => m.t === 'snapshot')), JSON.stringify(snapA));
  b.socket.destroy(); await b.closedP(); await idle(server);
  // 對方直接斷線也一樣
  const c = connect(port); c.send(hubHello());
  assert.equal(JSON.stringify(await c.until(m => m.t === 'snapshot')), JSON.stringify(snapA));
  c.socket.destroy(); await c.closedP();
  await server.close();
});

test('一次只服務一條連線：第二條收到 fatal error 後被關閉', async () => {
  const { server, port } = await start();
  const a = connect(port); a.send(hubHello()); await a.until(m => m.t === 'snapshot');
  const b = connect(port);
  const e = await b.until(m => m.t === 'error');
  assert.equal(e.fatal, true); await b.closedP();
  await lockstep(a, 3);
  a.socket.destroy(); await a.closedP(); await server.close();
});

test('fatal error 之後 server 關閉連線；tickAck 帶 wallUs', async () => {
  const { server, port } = await start();
  const a = connect(port); a.send(hubHello()); await a.until(m => m.t === 'snapshot');
  a.send({ t: 'tick', n: 1, tUs: 1000, time: 0.001, dt: 0.001 });
  const ack = await a.until(m => m.t === 'tickAck');
  assert.ok(Number.isInteger(ack.wallUs) && ack.wallUs >= 0);
  a.send({ t: 'tick', n: 5, tUs: 5000, time: 0.005, dt: 0.001 });
  assert.equal((await a.until(m => m.t === 'error')).code, 'OUT_OF_ORDER');
  await a.closedP(); await server.close();
});

test('送出端遵守 Hub 宣告的 maxLine：超過的訊息不送（不送半行）', async () => {
  const logs = [];
  const { server, port } = await start({ log: m => logs.push(m) });
  const a = connect(port);
  a.send(hubHello({ maxLine: 65536 }));
  await a.until(m => m.t === 'snapshot');
  // 一則超長的工件 kind 不會讓 snapshot 超過；改用大量工件放大 snapshot
  for (let i = 0; i < 1200; i++) a.send({ t: 'cmd', seq: i + 1, id: 'scene', op: 'wp_spawn', args: { wp: `wp-${i}`, kind: 'K'.repeat(60), at: 'cell/x' } });
  await lockstep(a, 1);
  a.send({ t: 'snapshot', request: true, seq: 2000 });
  a.send({ t: 'tick', n: 2, tUs: 2000, time: 0.002, dt: 0.001 });
  await a.until(m => m.t === 'tickAck' && m.n === 2);
  assert.equal(a.got.filter(m => m.t === 'snapshot').length, 1);
  assert.ok(logs.some(l => l.includes('不送出')));
  a.socket.destroy(); await a.closedP(); await server.close();
});

test('SSE：觀看端收到 view；有沒有觀看端，Hub 收到的輸出逐位元組相同', async () => {
  const run = async (watch) => {
    const { server, port, ssePort } = await start();
    let views = 0, req = null;
    if (watch) await new Promise(ok => { req = http.get({ port: ssePort, host: '127.0.0.1', path: '/events' }, res => { res.on('data', d => { views += (String(d).match(/^data: /gm) || []).length; }); ok(); }); });
    const a = connect(port); a.send(hubHello());
    a.send({ t: 'cmd', seq: 1, id: 'ax-X', op: 'move_abs', args: { pos: 500 } });
    await lockstep(a, 30);
    a.send({ t: 'bye', reason: 'done' }); await a.closedP();
    req?.destroy(); await server.close();
    return { out: a.got.map(m => JSON.stringify(m.t === 'tickAck' ? { t: m.t, n: m.n } : m)).join('\n'), views };
  };
  const plain = await run(false), watched = await run(true);
  assert.equal(watched.out, plain.out);
  assert.ok(watched.views > 5, String(watched.views));
});
