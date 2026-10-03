// Claude Code 的 PreToolUse 寫檔關卡（studio 用）：Write／Edit／MultiEdit／NotebookEdit 只能寫進 VS3D_ALLOW 列的路徑，
// 而且不能寫 VS3D_DENY 列的路徑。兩者都是絕對路徑的 JSON 陣列；資料夾以內的檔案都算。系統暫存目錄一律允許。
// 由 adapters/claude.mjs 以 --settings 掛上，可寫範圍依角色由 app 決定（例如規劃角色只能寫 .studio/ 與 AGENTS.md）。
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

const list = k => { try { return JSON.parse(process.env[k] || '[]'); } catch { return []; } };
const allow = list('VS3D_ALLOW'), deny = list('VS3D_DENY');
const under = (root, p) => { const r = relative(root, p); return !r.startsWith('..') && !isAbsolute(r); };

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!target || !allow.length) process.exit(0);

const p = resolve(input.cwd || process.cwd(), target);
const ok = (allow.some(a => under(a, p)) || under(tmpdir(), p)) && !deny.some(d => under(d, p));
if (ok) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `範圍限制：這一輪只能寫 ${allow.join('、')}${deny.length ? `（不含 ${deny.join('、')}）` : ''}，不能寫 ${p}。`
      + 'core 與工作區規則是唯讀的；core 缺功能請在專案內暫代，並在結束訊息中說明需求。',
  },
}));
