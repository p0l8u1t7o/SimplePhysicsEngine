// 範圍檢查：子專案代理只能改自己的資料夾（規則見根目錄 AGENTS.md「範圍」）。
//   node core/tools/check-scope.mjs --staged                       pre-commit：依執行 git commit 的位置（GIT_PREFIX）判定範圍
//   node core/tools/check-scope.mjs --range <base>...<head> --branch <分支>   PR CI：依分支名稱判定範圍
//   node core/tools/check-scope.mjs --scope <範圍> <路徑…>          直接檢查一組路徑（測試用）
// 範圍：各專案資料夾（project-site/<專案>/，有 web/index.html 或 project.json）、core、tools、studio；其餘都算 root。
// 在根目錄提交、或分支名稱不是 <範圍>/… 時不限制（主 session 與使用者要跨範圍提交）。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, ROOT, PROJECTS_DIR } from './projects.mjs';

export const FIXED = ['core', 'tools', 'studio'];
// 任何範圍都可以改的共用檔：core 需求登記、待辦清單
export const SHARED = ['core/REQUESTS.md', 'PENDING.md'];

const projectIds = () => existsSync(ROOT) ? readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && (existsSync(join(ROOT, d.name, 'web', 'index.html')) || existsSync(join(ROOT, d.name, 'project.json'))))
  .map(d => d.name) : [];

// 分支名稱不能有空白：專案用小寫、空白換成 -（shutter assembly → shutter-assembly）
export const slug = id => id.toLowerCase().replace(/\s+/g, '-');

// 範圍名稱（core／tools／studio 或專案名）→ 正式名稱（大小寫不分）；不是任何範圍時回傳 null
export function scopeNamed(seg, ids = projectIds()) {
  if (!seg) return null;
  const s = seg.toLowerCase();
  return FIXED.find(f => f === s) || ids.find(id => id.toLowerCase() === s) || null;
}
export const scopeOfBranch = (branch, ids = projectIds()) => {
  const seg = (branch || '').split('/')[0].toLowerCase();
  return branch?.includes('/') ? FIXED.find(f => f === seg) || ids.find(id => slug(id) === seg) || null : null;
};

const toRel = p => (isAbsolute(p) ? relative(REPO, p) : p).split(sep).join('/').replace(/^\.\//, '');
// 庫內相對路徑（或資料夾，例如 GIT_PREFIX）→ 範圍；project-site/<專案>/… 是專案，core／tools／studio 是固定範圍，其餘 null（root）
export function scopeOf(p, ids = projectIds()) {
  const [a, b] = toRel(p).split('/');
  if (a?.toLowerCase() === PROJECTS_DIR) return b ? ids.find(id => id.toLowerCase() === b.toLowerCase()) || null : null;
  return FIXED.find(f => f === a?.toLowerCase()) || null;
}
export const scopeOfPath = (p, ids = projectIds()) => scopeOf(p, ids) || 'root';

// 回傳不在範圍內的路徑（相對於庫根目錄）；scope 為 null 表示不限制
export function violations(scope, paths, ids = projectIds()) {
  if (!scope) return [];
  return paths.map(toRel).filter(p => !SHARED.some(s => s.toLowerCase() === p.toLowerCase()) && scopeOfPath(p, ids) !== scope);
}

const git = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);

function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  let scope, paths, why;
  if (argv.includes('--staged')) {
    const prefix = (process.env.GIT_PREFIX || '').replace(/\\/g, '/');
    scope = scopeOf(prefix);
    paths = git(['diff', '--cached', '--name-only', '--no-renames', '-z']);
    why = `在 ${prefix || '根目錄'} 執行 git commit`;
  } else if (opt('--range')) {
    const branch = opt('--branch') || '';
    scope = scopeOfBranch(branch);
    paths = git(['diff', '--name-only', '--no-renames', '-z', opt('--range')]);
    why = `分支 ${branch || '（未指定）'}`;
  } else if (opt('--scope')) {
    scope = scopeNamed(opt('--scope')) || opt('--scope');
    paths = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--scope');
    why = '指定範圍';
  } else {
    console.log('用法：check-scope.mjs --staged ｜ --range <base>...<head> --branch <分支> ｜ --scope <範圍> <路徑…>');
    return 2;
  }
  if (!scope) { console.log(`範圍檢查：${why}，不限制範圍（${paths.length} 個檔案）`); return 0; }
  const bad = violations(scope, paths);
  if (!bad.length) { console.log(`範圍檢查：${why} → 範圍 ${scope}，${paths.length} 個檔案都在範圍內`); return 0; }
  console.log(`✗ 範圍檢查：${why} → 範圍 ${scope}，以下 ${bad.length} 個檔案在範圍外：`);
  for (const p of bad) console.log(`   ${p}`);
  console.log(`\n子專案只能提交自己的資料夾（另可改 ${SHARED.join('、')}）。core 缺功能請登記到 core/REQUESTS.md；`
    + '跨範圍的提交請由主 session 在根目錄執行。規則見根目錄 AGENTS.md「範圍」。');
  return 1;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) process.exit(main(process.argv.slice(2)));
