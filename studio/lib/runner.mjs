// 介面的執行管理：用子程序跑 vs3d 命令列（和終端機同一套流程），把輸出逐行廣播給介面。
// 一個工作區一次只跑一個（vs3d 本身也有執行鎖）；代理提問時子程序以代碼 10 結束，介面回答後再自動續跑。
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { STUDIO } from './util.mjs';

export function createRunner(ws, { onLine = () => {}, onExit = () => {} } = {}) {
  let current = null;
  const history = new Map();          // 專案 → 最近 400 行輸出（介面重新整理後補回）
  const push = (id, line) => { const h = history.get(id) || []; h.push(line); if (h.length > 400) h.splice(0, h.length - 400); history.set(id, h); onLine(id, line); };

  function start(cmd, id, args = []) {
    if (current) throw new Error(`工作區正在執行 ${current.id}（${current.cmd}），請等它結束`);
    const child = spawn(process.execPath, [join(STUDIO, 'vs3d.mjs'), cmd, id, '--no-wait', '--workspace', ws, ...args], { cwd: STUDIO, windowsHide: true, env: process.env });
    current = { id, cmd, child, started: Date.now() };
    push(id, `$ vs3d ${cmd} ${id} ${args.join(' ')}`.trim());
    let buf = '';
    const feed = d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { push(id, buf.slice(0, i).replace(/\r$/, '')); buf = buf.slice(i + 1); } };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('close', code => {
      if (buf) push(id, buf);
      const status = { 0: 'done', 10: 'waiting', 1: 'stopped', 2: 'error' }[code] || 'error';
      push(id, `（結束：${status}，代碼 ${code}）`);
      current = null;
      onExit(id, status, code);
    });
    return { id, cmd };
  }

  return {
    start,
    stop() { if (!current) return false; if (process.platform === 'win32') spawn('taskkill', ['/pid', String(current.child.pid), '/T', '/F'], { windowsHide: true }); else current.child.kill('SIGINT'); return true; },
    get current() { return current && { id: current.id, cmd: current.cmd, started: current.started }; },
    history: id => history.get(id) || [],
  };
}
