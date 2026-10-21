// Twin Protocol 的傳輸層（node:net TCP server＋node:http SSE）：收送與關閉，協定邏輯全在 core/twin/session.js。
// twin.mjs（命令列）與 core/twin 的連線測試共用。
//   - 一條連線 = 一個工作階段，從站的初始狀態開始；一次只服務一條，其他連線回 fatal error 並關閉（開發計畫 Q-15）
//   - 送出前檢查對方宣告的 maxLine，超過時不送（不送半行）並記錯誤；tickAck.wallUs 是這個 tick 的處理時間（只供效能診斷）
//   - 即時模式：每 1/stateRate 秒呼叫 session.pollRealtime(掛鐘 µs)；掛鐘只在本檔，session 不讀時鐘
//   - SSE（GET /events）：推送站的 view（applyState 的輸入，Q-20）；觀看端不回送任何東西，不影響工作階段
//     鎖步以虛擬時間格點降頻（每 sseEveryUs 推一次）；即時模式每次 poll 推一次
import net from 'node:net';
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createLineReader, encodeMessage, DEFAULT_MAX_LINE } from '../twin/framing.js';
import { createTwinSession } from '../twin/session.js';

export function createTwinServer({ prepared, mdHash, schema = null, software, maxLine = null, options = {}, log = () => { }, transcript = null, sseEveryUs = 20000 }) {
  const sockets = new Set(), sse = new Set();
  let active = null, lastView = null, lastSseUs = -Infinity;

  const record = (dir, msg) => { if (transcript) appendFileSync(transcript, JSON.stringify({ dir, msg }) + '\n'); };
  if (transcript) writeFileSync(transcript, '');

  function broadcast(session, force = false) {
    if (!force && !session.realtime && session.timeUs - lastSseUs < sseEveryUs) return;
    lastSseUs = session.timeUs;
    lastView = { t: session.timeUs, tick: session.tick, view: session.view() };
    const data = `data: ${JSON.stringify(lastView)}\n\n`;
    for (const res of sse) res.write(data);
  }

  function serve(socket) {
    const session = createTwinSession({ prepared, mdHash, schema, software, maxLine, options });
    const reader = createLineReader({ maxLine: maxLine ?? DEFAULT_MAX_LINE });
    let timer = null, started = 0, ended = false, shook = false;
    lastSseUs = -Infinity;
    const send = msg => {
      const r = encodeMessage(msg, session.peerMaxLine);
      if (r.error) { log(`! 不送出：${r.error.msg}`); return; }
      record('spe>hub', msg);
      socket.write(r.text);
    };
    const finish = () => {
      if (ended) return; ended = true;
      if (timer) clearInterval(timer);
      if (active === socket) active = null;   // 工作階段已結束：下一條連線可以立即進來
      socket.end();
    };
    socket.on('data', chunk => {
      if (ended) return;
      const t0 = performance.now();
      const { lines, error } = reader.push(chunk);
      for (const line of lines) {
        const out = session.receive(line);
        try { record('hub>spe', JSON.parse(line)); } catch { /* 不是 JSON：session 已回 BAD_JSON */ }
        for (const m of out) send(m.t === 'tickAck' ? { ...m, wallUs: Math.max(0, Math.round((performance.now() - t0) * 1000)) } : m);
        if (!shook && session.ready) {
          shook = true;
          log(`握手完成：${session.realtime ? '即時' : '鎖步'}模式`);
          broadcast(session, true);
          if (session.realtime) {
            started = performance.now();
            timer = setInterval(() => { for (const m of session.pollRealtime(Math.round((performance.now() - started) * 1000))) send(m); broadcast(session); if (session.closed) finish(); }, 1000 / session.stateRate);
          }
        } else if (out.some(m => m.t === 'tickAck')) broadcast(session);
        if (session.closed) { finish(); return; }
      }
      if (error) { send({ t: 'error', code: error.code, msg: error.msg, fatal: true }); finish(); }
    });
    socket.on('close', () => { if (timer) clearInterval(timer); sockets.delete(socket); if (active === socket) active = null; log('連線關閉'); });
    socket.on('error', e => log(`! socket：${e.message}`));
  }

  const tcp = net.createServer(socket => {
    sockets.add(socket);
    if (active) {
      // 一次只服務一條連線（Q-15）；錯誤碼協定沒有指定，用 INTERNAL
      socket.end(JSON.stringify({ t: 'error', code: 'INTERNAL', msg: 'SPE 一次只服務一條連線', fatal: true }) + '\n');
      return;
    }
    active = socket;
    log(`連線：${socket.remoteAddress}:${socket.remotePort}`);
    serve(socket);
  });

  const web = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
    if (req.url === '/events') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': twin\n\n');
      if (lastView) res.write(`data: ${JSON.stringify(lastView)}\n\n`);
      sse.add(res); req.on('close', () => sse.delete(res));
      return;
    }
    if (req.url === '/view') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(lastView)); return; }
    res.writeHead(404, cors); res.end();
  });

  return {
    tcp, web,
    get busy() { return active !== null; },
    listen({ port = 7600, host = '127.0.0.1', ssePort = null } = {}) {
      return new Promise((ok, fail) => {
        tcp.once('error', fail);
        tcp.listen(port, host, () => {
          const tcpPort = tcp.address().port;
          if (ssePort === null) return ok({ port: tcpPort });
          web.once('error', fail);
          web.listen(ssePort, host, () => ok({ port: tcpPort, ssePort: web.address().port }));
        });
      });
    },
    close() {
      for (const s of sockets) s.destroy();
      for (const r of sse) r.end();
      return Promise.all([new Promise(r => tcp.close(() => r())), new Promise(r => (web.listening ? web.close(() => r()) : r()))]);
    },
  };
}
