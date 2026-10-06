// 介面的執行管理（代理佇列）：用子程序跑 vs3d 命令列（和終端機同一套流程），把輸出逐行廣播給介面。
// 中央主機上多人共用：指令先進佇列，依序一次跑一個（工作區的執行鎖與每輪的雜湊比對都假設同時只有一個代理在改檔）。
// 同一個專案同時只能有一筆在執行或排隊；代理提問時子程序以代碼 10 結束，介面回答後再自動排入續跑。
// 子程序的環境變數 VS3D_BY 是啟動的人（每輪紀錄會記下來）。
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { STUDIO } from './util.mjs';

export function createRunner(ws, { onLine = () => {}, onExit = () => {}, onQueue = () => {} } = {}) {
  let current = null;
  const queue = [];
  const history = new Map();          // 專案 → 最近 400 行輸出（介面重新整理後補回）
  const push = (id, line) => { const h = history.get(id) || []; h.push(line); if (h.length > 400) h.splice(0, h.length - 400); history.set(id, h); onLine(id, line); };
  const pub = x => x && { qid: x.qid, id: x.id, cmd: x.cmd, by: x.by, queuedAt: x.queuedAt, ...(x.started ? { started: x.started } : {}) };

  function launch(item) {
    const child = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), item.cmd, item.name, '--no-wait', '--workspace', item.root, ...item.args],
      { cwd: STUDIO, windowsHide: true, env: { ...process.env, VS3D_BY: item.by || '' } });
    current = { ...item, child, started: Date.now() };
    push(item.id, `$ vs3d ${item.cmd} ${item.name} ${item.args.join(' ')}`.trim());
    let buf = '';
    const feed = d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { push(item.id, buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('close', code => {
      if (buf) push(item.id, buf);
      const status = { 0: 'done', 10: 'waiting', 1: 'stopped', 2: 'error' }[code] || 'error';
      push(item.id, `（結束：${status}，代碼 ${code}）`);
      current = null;
      onExit(item.id, status, code);
      next();
    });
  }
  function next() { if (!current && queue.length) { launch(queue.shift()); onQueue(); } }

  // id：介面用的專案代號（本庫的站是 @<名稱>，當作輸出記錄的鍵）；name／root：實際傳給 vs3d 的專案名稱與工作區（或本庫）；by：啟動的人
  // 回傳 { qid, position }：position 0 是馬上開始，1 以上是前面還有幾筆
  function start(cmd, id, args = [], { name = id, root = ws, by = '' } = {}) {
    if (current?.id === id || queue.some(q => q.id === id)) throw new Error(`${id} 已經在執行或排隊中，等它結束再試`);
    const item = { qid: randomUUID().slice(0, 8), cmd, id, args, name, root, by, queuedAt: Date.now() };
    queue.push(item);
    const position = (current ? 1 : 0) + queue.length - 1;
    if (position) push(id, `（排隊：${cmd}，前面還有 ${position} 筆）`);
    next(); onQueue();
    return { qid: item.qid, position };
  }

  return {
    start,
    // 取消排隊中的一筆（執行中的用 stop）；回傳被取消的那筆或 null
    cancel(qid) {
      const i = queue.findIndex(q => q.qid === qid);
      if (i < 0) return null;
      const [item] = queue.splice(i, 1);
      push(item.id, `（已取消排隊：${item.cmd}）`); onQueue();
      return pub(item);
    },
    stop() { if (!current) return false; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(current.child.pid), '/T', '/F'], { windowsHide: true }); else current.child.kill('SIGINT'); return true; },
    get current() { return pub(current); },
    get queue() { return queue.map(pub); },
    queued: qid => pub(queue.find(q => q.qid === qid)),
    history: id => history.get(id) || [],
  };
}
