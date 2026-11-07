// Claude Code 的 PreToolUse 寫檔關卡（studio 用）：Write／Edit／MultiEdit／NotebookEdit 只能寫進 VS3D_ALLOW 列的路徑，
// 而且不能寫 VS3D_DENY 列的路徑。兩者都是絕對路徑的 JSON 陣列；資料夾以內的檔案都算。系統暫存目錄一律允許。
// 另外：VS3D_NOREAD 列的資料夾不能讀（見下方）。由 adapters/claude.mjs 以 --settings 掛上，可寫範圍依角色由 app 決定（例如規劃角色只能寫 .studio/ 與 AGENTS.md）。
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

const list = k => { try { return JSON.parse(process.env[k] || '[]'); } catch { return []; } };
const allow = list('VS3D_ALLOW'), deny = list('VS3D_DENY');
const under = (root, p) => { const r = relative(root, p); return !r.startsWith('..') && !isAbsolute(r); };

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');

// 讀取限制（參考站的 docs/、.studio/、TEMP/ 是使用者的本機資料）：VS3D_NOREAD 列的資料夾不能用 Read／Glob／Grep 讀；
// Glob／Grep 的搜尋範圍包含這些資料夾（例如對整個 project-site/ 搜尋）也擋下。shell 指令攔不到，靠提示約束。
if (/^(Read|Glob|Grep)$/.test(input.tool_name || '')) {
  const noRead = list('VS3D_NOREAD'), ti = input.tool_input || {}, cwd = input.cwd || process.cwd();
  if (!noRead.length) process.exit(0);
  const base = resolve(cwd, ti.file_path || ti.notebook_path || ti.path || '.');
  const globs = (input.tool_name === 'Grep' ? [ti.glob] : [ti.pattern]).filter(Boolean);      // Grep 的 pattern 是正規表示式，不是路徑
  const hits = [base, ...globs.map(x => resolve(base, x))];
  const blocked = noRead.find(d => hits.some(p => under(d, p)) || (input.tool_name !== 'Read' && under(base, d)));
  if (!blocked) process.exit(0);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `讀取限制：${blocked} 是使用者的本機資料（參考站的 docs/、.studio/、TEMP/），不能讀；參考站只看 web/ 與 app 複製到 .studio/references/ 的規格摘要。` } }));
  process.exit(0);
}

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
