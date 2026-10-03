// 代理轉接層：Claude Code 與 Codex 包成同一個介面。
//   adapter.detect()           → { installed, loggedIn, version, detail }
//   adapter.listModels()       → 可選的模型名稱（CLI 無法查詢時用設定清單）
//   runAgent(adapter, opts, onEvent) → Promise<結果>
// opts：{ cwd, prompt, sessionId?, model?, effort?, readDirs?, allowWrite?, denyWrite?, logFile?, timeoutMs?, signal? }
// 統一事件（onEvent）：
//   { kind: 'session', id }                  工作階段 ID（續接用）
//   { kind: 'text', text }                   代理的文字訊息
//   { kind: 'tool', name, detail }           工具呼叫（檔案路徑、指令）
//   { kind: 'tool_result', ok, detail }      工具結果
//   { kind: 'usage', usage } / { kind: 'rate', info }
//   { kind: 'end', ok, text, usage, costUsd?, turns? }
//   { kind: 'error', message }               整輪失敗
//   { kind: 'warn', message }                暫時性的警告（不影響結果）
// 結果：{ ok, code, sessionId, text, usage, costUsd, turns, stderr, seconds, aborted, timedOut }
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { claude } from './claude.mjs';
import { codex } from './codex.mjs';

export const ADAPTERS = { claude, codex };
export const adapterFor = name => {
  const a = ADAPTERS[name];
  if (!a) throw new Error(`不支援的 CLI：${name}（可用：${Object.keys(ADAPTERS).join('、')}）`);
  return a;
};

export function runAgent(adapter, opts, onEvent = () => {}) {
  const { cmd, args, input, env } = adapter.command(opts);
  const t0 = Date.now();
  if (opts.logFile) mkdirSync(dirname(opts.logFile), { recursive: true });
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...env }, windowsHide: true });
    const state = { sessionId: opts.sessionId || null, text: '', usage: null, costUsd: null, turns: null, ok: null, failed: false };
    let buf = '', stderr = '', aborted = false, timedOut = false;
    const emit = e => {
      if (e.kind === 'session') state.sessionId = e.id;
      if (e.kind === 'text') state.text = e.text;
      if (e.kind === 'usage') state.usage = e.usage;
      if (e.kind === 'error') state.failed = true;
      if (e.kind === 'end') Object.assign(state, { ok: e.ok, text: e.text ?? state.text, usage: e.usage ?? state.usage, costUsd: e.costUsd ?? null, turns: e.turns ?? null });
      onEvent(e);
    };
    const line = l => {
      if (!l.trim()) return;
      if (opts.logFile) appendFileSync(opts.logFile, l + '\n');
      let raw; try { raw = JSON.parse(l); } catch { return emit({ kind: 'text', text: l }); }
      for (const e of adapter.parse(raw)) emit(e);
    };
    child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on('data', d => { stderr += d; });
    const kill = () => { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); else child.kill('SIGTERM'); };
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs) : null;
    opts.signal?.addEventListener('abort', () => { aborted = true; kill(); });
    child.on('error', e => { stderr += String(e); });
    child.on('close', code => {
      if (buf) line(buf);
      clearTimeout(timer);
      const ok = !aborted && !timedOut && code === 0 && !state.failed && state.ok !== false;
      resolve({ ok, code, sessionId: state.sessionId, text: state.text, usage: state.usage, costUsd: state.costUsd, turns: state.turns,
        stderr: stderr.trim().split('\n').slice(-20).join('\n'), seconds: +((Date.now() - t0) / 1000).toFixed(1), aborted, timedOut });
    });
    child.stdin.end(input ?? '');
  });
}
