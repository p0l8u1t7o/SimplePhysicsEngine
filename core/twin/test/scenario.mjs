// 決定性測試的共用部分：一段固定情境（determinism.test.mjs 與子行程 determinism-run.mjs 共用）與 core/twin 的靜態檢查（check.mjs 的 twin 檢查也用）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newSession, hubHello } from './helpers.mjs';

// 一段涵蓋軸、致動器、機器人、任務、曝光、工件、故障的情境
export function scenario() {
  const msgs = [hubHello()];
  let seq = 0, n = 0, tUs = 0;
  const cmd = (id, op, args = {}) => msgs.push({ t: 'cmd', seq: ++seq, id, op, args });
  const tick = (dtUs) => { n += 1; tUs += dtUs; msgs.push({ t: 'tick', n, tUs, time: tUs / 1e6, dt: dtUs / 1e6 }); };
  cmd('ax-X', 'move_abs', { pos: 640, v: 333, a: 777 }); cmd('io-CYL-V', 'set', { value: true });
  cmd('rb-ARM', 'move', { motion: 'ptp', target: { q: [0.3, -0.7], rail: 123.4 }, speed: 37 }); cmd('scene', 'wp_spawn', { wp: 'wp-1', kind: 'A', at: 'cell/x' });
  msgs.push({ t: 'fault', seq: ++seq, fid: 'f-1', action: 'inject', id: 'ax-R', kind: 'axisFault', from: 0.4, until: 0.9 });
  for (let i = 0; i < 300; i++) tick(i % 7 === 0 ? 10000 : 1000);
  cmd('dev-IPC1', 'vision', { action: 'trigger', shot: 'a' }); cmd('rb-ARM', 'task', { action: 'start', name: 'PICK' }); cmd('io-CYL-V', 'set', { value: false });
  for (let i = 0; i < 200; i++) tick(3000);
  msgs.push({ t: 'snapshot', request: true, seq: ++seq }, { t: 'bye', reason: 'done' });
  return msgs;
}
export const transcript = () => { const s = newSession(); return scenario().flatMap(m => s.receive(JSON.stringify(m))).map(m => JSON.stringify(m)).join('\n'); };

const FORBIDDEN = [/\bDate\.now\s*\(/, /\bperformance\.now\s*\(/, /\bnew\s+Date\s*\(/, /\bMath\.random\s*\(/, /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/, /\bprocess\.hrtime/];
const IMPORT_SCHEMA = /from\s+['"][^'"]*(Automation-Schema|generated\/js)[^'"]*['"]|import\(\s*['"][^'"]*(Automation-Schema|generated\/js)/;

export function staticCheck(dir = fileURLToPath(new URL('..', import.meta.url))) {
  const problems = [];
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'test') walk(p); } else if (f.endsWith('.js')) check(p); } };
  const check = p => {
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const re of FORBIDDEN) if (re.test(code)) problems.push(`${p}:${i + 1} 禁止的呼叫 ${re.source}`);
      if (IMPORT_SCHEMA.test(code)) problems.push(`${p}:${i + 1} core/twin 不得 import Automation-Schema`);
      if (/from\s+['"]node:/.test(code)) problems.push(`${p}:${i + 1} core/twin 是瀏覽器也能載入的純模組，不得 import node:*`);
    });
  };
  walk(dir);
  return problems;
}

