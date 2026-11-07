// Claude Code 介面卡：claude -p --output-format stream-json --verbose（提示由 stdin 傳入）。
// 權限：acceptEdits＋工具允許清單；寫檔關卡用 --settings 掛上 PreToolUse（studio/lib/guard.mjs），
// 可寫範圍由環境變數 VS3D_ALLOW／VS3D_DENY 傳給關卡。Windows 上 Bash 工具的寫入攔不到，靠每輪的雜湊比對。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STUDIO, posix } from '../util.mjs';

const GUARD = join(STUDIO, 'lib', 'guard.mjs');

// Windows 上 execFileSync 不經 shell，只找得到 claude.exe（原生安裝程式的版本）；
// npm 全域安裝的只有 claude.cmd 轉接，改用它旁邊套件裡的 bin/claude.exe
let resolved;
export function resolveClaude() {
  if (resolved) return resolved;
  if (process.platform === 'win32') {
    try {
      for (const p of execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).filter(Boolean)) {
        if (/\.exe$/i.test(p)) return (resolved = p);
        const exe = join(dirname(p), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
        if (existsSync(exe)) return (resolved = exe);
      }
    } catch { /* 找不到時落到下面 */ }
  }
  return (resolved = 'claude');
}

// 讀檔與搜尋工具全開；shell 只給檢查與查詢用的指令；git 的寫入操作由 app 負責
export const ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'NotebookEdit',
  'Bash(node:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(find:*)', 'Bash(grep:*)', 'Bash(mkdir:*)',
  // 複合指令（cd …; grep …）的每一段都要在清單內才會放行
  'Bash(cd:*)', 'Bash(echo:*)', 'Bash(pwd:*)', 'Bash(sort:*)', 'Bash(uniq:*)',
];
export const DISALLOWED_TOOLS = [
  'WebFetch', 'WebSearch',
  'Bash(git commit:*)', 'Bash(git checkout:*)', 'Bash(git restore:*)', 'Bash(git reset:*)', 'Bash(git stash:*)', 'Bash(git clean:*)', 'Bash(git push:*)',
  'Bash(curl:*)', 'Bash(wget:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(pip:*)',
];

const short = (s, n = 120) => (s = String(s ?? '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n) + '…' : s;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const toolDetail = (name, i = {}) => short(i.file_path || i.notebook_path || i.command || i.pattern || i.path || i.query || i.url || i.description || '');

export const claude = {
  name: 'claude',
  label: 'Claude Code',
  loadsParentRules: true,          // 會一路往上載入 CLAUDE.md，所以工作區規則不必放進提示
  models: ['opus', 'sonnet', 'haiku'],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],   // claude --effort 接受的值

  // 只看有沒有安裝；登入或金鑰的狀態由 lib/agent-auth.mjs 的 authStatus 決定（訂閱帳號的查法在 lib/subscription.mjs）
  detect() {
    try { return { installed: true, version: execFileSync(resolveClaude(), ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), detail: '' }; }
    catch { return { installed: false, version: '', detail: '找不到 claude 指令' }; }
  },
  listModels() { return this.models; },

  // settings：認證要加的設定（API 金鑰模式的 apiKeyHelper，lib/agent-auth.mjs），和寫檔關卡一起用 --settings 傳入
  // tools：這個角色另外的工具清單 { allow, deny }（例如元件補全只能讀寫檔與上網、不能用 shell）
  // denyRead：不能讀的資料夾（參考站的本機資料）；有的話寫檔關卡另外掛在 Read／Glob／Grep 上
  command({ prompt, sessionId, model, effort, readDirs = [], allowWrite = [], denyWrite = [], denyRead = [], settings: extra = {}, tools = null }) {
    const hook = [{ type: 'command', command: `node "${posix(GUARD)}"` }];
    const settings = { ...extra, hooks: { PreToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: hook }, ...(denyRead.length ? [{ matcher: 'Read|Glob|Grep', hooks: hook }] : [])] } };
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--settings', JSON.stringify(settings)];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (sessionId) args.push('--resume', sessionId);
    for (const d of readDirs) args.push('--add-dir', d);
    args.push('--disallowedTools', ...(tools?.deny || DISALLOWED_TOOLS), '--allowedTools', ...(tools?.allow || ALLOWED_TOOLS));
    return { cmd: resolveClaude(), args, input: prompt, env: { VS3D_ALLOW: JSON.stringify(allowWrite), VS3D_DENY: JSON.stringify(denyWrite), VS3D_NOREAD: JSON.stringify(denyRead) } };
  },

  parse(e) {
    const out = [];
    if (e.session_id && (e.type === 'system' && e.subtype === 'init')) out.push({ kind: 'session', id: e.session_id });
    if (e.type === 'assistant') for (const c of e.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) out.push({ kind: 'text', text: c.text });
      // id 與 paths 給本庫模式的併改偵測（lib/repo.mjs 的 createEditTracker）：寫檔工具寫了哪些檔、哪個 tool_result 是它的結束
      if (c.type === 'tool_use') out.push({ kind: 'tool', name: c.name, detail: toolDetail(c.name, c.input), id: c.id, ...(EDIT_TOOLS.has(c.name) ? { paths: [c.input?.file_path || c.input?.notebook_path].filter(Boolean) } : {}) });
    }
    if (e.type === 'user') for (const c of e.message?.content || []) if (c.type === 'tool_result') {
      const text = Array.isArray(c.content) ? c.content.map(x => x.text || '').join(' ') : c.content;
      out.push({ kind: 'tool_result', ok: !c.is_error, detail: short(text, 160), id: c.tool_use_id });
    }
    if (e.type === 'rate_limit_event') out.push({ kind: 'rate', info: e.rate_limit_info || e });
    // API 重試（例如金鑰錯誤的 401）：顯示出來，不然看起來像卡住
    if (e.type === 'system' && e.subtype === 'api_retry') out.push({ kind: 'warn', message: `API 重試第 ${e.attempt}/${e.max_retries} 次（${e.error_status || ''} ${e.error || ''}）` });
    if (e.type === 'result') {
      if (e.session_id) out.push({ kind: 'session', id: e.session_id });
      out.push({ kind: 'end', ok: e.subtype === 'success' && !e.is_error, text: e.result || '', usage: e.usage, costUsd: e.total_cost_usd, turns: e.num_turns });
    }
    return out;
  },
};
