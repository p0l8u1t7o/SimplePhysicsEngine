// 測試用 Hub（SPE-AC-04）：把一份工作階段紀錄（*.twin-session.jsonl）裡 hub>spe 的訊息依序送給 SPE 孿生 server，
// 依協定等待對應的回覆（hello → snapshot n = 0、tick → tickAck、snapshot 要求 → snapshot、bye → bye），寫出這次的完整紀錄。
// 寫出的紀錄可以交給 Automation-Schema 的 validate.py session 驗證：
//   node core/tools/twin-hub.mjs <輸入.jsonl> --port <p> [--host 127.0.0.1] --out <輸出.jsonl> [--timeout-ms 10000]
//   cd ..\Automation-Schema\tools; uv run validate.py session <輸出.jsonl> --md ..\examples\MilitaryGradePC.md.json
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLineReader, parseMessage } from '../twin/framing.js';

export async function replay({ input, port, host = '127.0.0.1', timeoutMs = 10000 }) {
  const sends = readFileSync(input, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(l => l.dir === 'hub>spe').map(l => l.msg);
  const socket = net.connect({ port, host });
  await new Promise((ok, fail) => { socket.once('connect', ok); socket.once('error', fail); });
  const reader = createLineReader(), lines = [], waiters = [];
  let closed = false;
  socket.on('data', chunk => {
    const { lines: got, error } = reader.push(chunk);
    for (const l of got) { const m = parseMessage(l).msg; lines.push({ dir: 'spe>hub', msg: m }); for (const w of [...waiters]) if (w.test(m)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m); } }
    if (error) throw new Error(error.msg);
  });
  socket.on('close', () => { closed = true; for (const w of waiters.splice(0)) w.ok(null); });
  const wait = test => new Promise((ok, fail) => {
    const w = { test, ok: m => { clearTimeout(timer); ok(m); } }, timer = setTimeout(() => fail(new Error('等待回覆逾時')), timeoutMs);
    waiters.push(w);
  });
  const fatal = m => m.t === 'error' && m.fatal;
  for (const msg of sends) {
    if (closed) break;
    lines.push({ dir: 'hub>spe', msg });
    const expect = msg.t === 'hello' ? m => m.t === 'snapshot' || fatal(m)
      : msg.t === 'tick' ? m => (m.t === 'tickAck' && m.n === msg.n) || fatal(m)
        : msg.t === 'snapshot' ? m => m.t === 'snapshot' || fatal(m)
          : msg.t === 'bye' ? m => m.t === 'bye' || fatal(m) : null;
    const p = expect ? wait(expect) : null;
    socket.write(JSON.stringify(msg) + '\n');
    if (p) { const m = await p; if (!m || fatal(m)) break; }
  }
  socket.end();
  await new Promise(r => (closed ? r() : socket.once('close', r)));
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  if (!argv[0] || !opt('--port') || !opt('--out')) { console.error('用法：node core/tools/twin-hub.mjs <輸入.jsonl> --port <p> --out <輸出.jsonl>'); process.exit(2); }
  const lines = await replay({ input: argv[0], port: Number(opt('--port')), host: opt('--host') || '127.0.0.1', timeoutMs: Number(opt('--timeout-ms') || 10000) });
  writeFileSync(opt('--out'), lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  console.log(`寫出 ${lines.length} 行：${opt('--out')}`);
}
