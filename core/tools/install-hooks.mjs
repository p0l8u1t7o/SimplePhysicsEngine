// 安裝本庫的 git hook：把 core.hooksPath 指向 .githooks（clone 後執行一次；scripts/setup.ps1 會自動執行）。
//   node core/tools/install-hooks.mjs
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './projects.mjs';

if (!existsSync(join(REPO, '.githooks', 'pre-commit'))) throw new Error('找不到 .githooks/pre-commit');
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: REPO });
const now = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: REPO, encoding: 'utf8' }).trim();
console.log(`已安裝 git hook：core.hooksPath = ${now}（pre-commit 範圍檢查）`);
