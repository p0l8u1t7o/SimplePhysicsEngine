// Claude Code 的 PreToolUse 寫檔關卡：從子專案資料夾啟動的 session，Write／Edit／MultiEdit／NotebookEdit
// 不能寫到該專案以外的庫內檔案（判定規則與 pre-commit 相同，見 check-scope.mjs）。
// 各專案的 .claude/settings.json 掛上：node "$CLAUDE_PROJECT_DIR/../core/tools/scope-guard.mjs"
// 允許：本專案、共用檔（core/REQUESTS.md、PENDING.md）、根目錄 TEMP/（代理的暫存）、庫以外的路徑。
// 攔不到 shell 指令的寫入；那部分靠 pre-commit 與 PR CI 的範圍檢查。
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { ROOT } from './projects.mjs';
import { scopeNamed, violations } from './check-scope.mjs';

const rel = p => relative(ROOT, p).split(sep).join('/');
const inside = r => r && !r.startsWith('..') && !isAbsolute(r);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '{}');
const home = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const scope = inside(rel(home)) ? scopeNamed(rel(home).split('/')[0]) : null;
const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!scope || !target) process.exit(0);

const r = rel(resolve(input.cwd || home, target));
if (!inside(r) || /^temp\//i.test(r) || !violations(scope, [r]).length) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `範圍限制：這個 session 從 ${scope}/ 啟動，只能改 ${scope}/ 內的檔案（另可改 core/REQUESTS.md、PENDING.md、根目錄 TEMP/），`
      + `不能寫 ${r}。core 缺功能請在本專案暫代並登記到 core/REQUESTS.md；其他範圍的修改請交給主 session。規則見根目錄 AGENTS.md「範圍」。`,
  },
}));
