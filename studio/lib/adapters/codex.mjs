// Codex 介面卡：codex exec --json（提示由 stdin 傳入，參數 "-"）。
// 權限：workspace-write 沙箱，可寫範圍是 cwd（專案資料夾）＋系統暫存；Windows 原生沙箱實測會擋下 cwd 以外的寫入。
// 續接：codex exec resume <id> 沒有 -s，改用 -c sandbox_mode=…。
// Codex 只從 git 根目錄（＝專案資料夾）往下找 AGENTS.md，工作區的共通規則要放進提示（loadsParentRules = false）。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const short = (s, n = 120) => (s = String(s ?? '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n) + '…' : s;

// Windows 上 npm 裝的 codex 是 codex.cmd；直接用 node 執行它的 codex.js，避開 shell 的引號問題
let resolved;
export function resolveCodex() {
  if (resolved) return resolved;
  if (process.platform === 'win32') {
    try {
      for (const p of execFileSync('where.exe', ['codex'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean)) {
        if (/\.exe$/i.test(p)) return (resolved = { cmd: p, pre: [] });
        const js = join(dirname(p), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
        if (existsSync(js)) return (resolved = { cmd: process.execPath, pre: [js] });
      }
    } catch { /* 找不到時落到下面 */ }
  }
  return (resolved = { cmd: 'codex', pre: [] });
}
const exec = args => { const { cmd, pre } = resolveCodex(); return execFileSync(cmd, [...pre, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); };

export const codex = {
  name: 'codex',
  label: 'Codex',
  loadsParentRules: false,
  models: [],                      // 空白＝用帳號預設模型；可在 studio.json 指定

  detect() {
    try {
      const version = exec(['--version']).trim();
      let loggedIn = false, detail = '';
      // login status 的結果印在 stderr
      const { cmd, pre } = resolveCodex(), r = spawnSync(cmd, [...pre, 'login', 'status'], { encoding: 'utf8', windowsHide: true });
      detail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n')[0] || '';
      loggedIn = r.status === 0 && /logged in/i.test(detail);
      return { installed: true, loggedIn, version, detail };
    } catch { return { installed: false, loggedIn: false, version: '', detail: '找不到 codex 指令' }; }
  },
  listModels() { return this.models; },

  command({ prompt, sessionId, model, effort, images = [] }) {
    const { cmd, pre } = resolveCodex();
    const common = ['--json', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"'];
    if (model) common.push('-m', model);
    if (effort) common.push('-c', `model_reasoning_effort="${effort}"`);
    // 審查截圖：用 --image=路徑，避免 -i 的多值參數把後面的工作階段 ID 與提示 "-" 也當成圖片
    for (const f of images) common.push(`--image=${f}`);
    const args = sessionId ? ['exec', 'resume', ...common, sessionId, '-'] : ['exec', ...common, '-'];
    return { cmd, args: [...pre, ...args], input: prompt, env: {} };
  },

  parse(e) {
    const out = [], it = e.item || {};
    if (e.type === 'thread.started') out.push({ kind: 'session', id: e.thread_id });
    if (e.type === 'item.started' && it.type === 'command_execution') out.push({ kind: 'tool', name: 'shell', detail: short(it.command.replace(/^"[^"]*powershell\.exe"\s+-Command\s+/i, '')) });
    if (e.type === 'item.completed') {
      if (it.type === 'agent_message' && it.text?.trim()) out.push({ kind: 'text', text: it.text });
      if (it.type === 'command_execution') out.push({ kind: 'tool_result', ok: it.exit_code === 0, detail: short(it.aggregated_output, 160) });
      if (it.type === 'file_change') out.push({ kind: 'tool', name: 'edit', detail: short((it.changes || []).map(c => `${c.kind || ''} ${c.path}`).join('、')) });
      if (it.type === 'error') out.push({ kind: 'warn', message: it.message || '' });
    }
    if (e.type === 'turn.completed') out.push({ kind: 'usage', usage: e.usage });
    // 只有 turn.failed 算失敗；頂層 error 多半是重新連線之類的暫時狀況
    if (e.type === 'turn.failed') out.push({ kind: 'error', message: e.error?.message || 'turn failed' });
    if (e.type === 'error') out.push({ kind: 'warn', message: e.message || '' });
    return out;
  },
};
