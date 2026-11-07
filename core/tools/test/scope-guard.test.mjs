// 寫檔關卡（core/tools/scope-guard.mjs）：子專案 session 寫到範圍外要擋，Windows 長路徑前綴 \\?\ 也要擋
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'core', 'tools', 'scope-guard.mjs');
const SITE = join(REPO, 'project-site', 'MilitaryGradePC');
const decide = file => {
  const r = spawnSync(process.execPath, [GUARD], { input: JSON.stringify({ cwd: SITE, tool_input: { file_path: file } }), env: { ...process.env, CLAUDE_PROJECT_DIR: SITE }, encoding: 'utf8' });
  return r.stdout.includes('"deny"') ? 'deny' : 'allow';
};

test('子專案 session：本站與 TEMP 放行，core 擋下；長路徑前綴不能繞過', () => {
  assert.equal(decide(join(SITE, 'web', 'js', 'x.js')), 'allow');
  assert.equal(decide(join(REPO, 'TEMP', 'x.txt')), 'allow');
  assert.equal(decide(join(REPO, 'core', 'x.js')), 'deny');
  if (process.platform === 'win32') {
    assert.equal(decide('\\\\?\\' + join(REPO, 'core', 'x.js')), 'deny', '\\\\?\\ 前綴（之前被當成庫外而放行）');
    assert.equal(decide('\\\\.\\' + join(REPO, 'core', 'x.js')), 'deny', '\\\\.\\ 前綴');
    assert.equal(decide('\\\\?\\' + join(SITE, 'web', 'x.js')), 'allow', '本站加前綴照樣放行');
  }
  assert.equal(decide(join(REPO, '..', 'elsewhere', 'x.txt')), 'allow', '庫以外的路徑不管');
});
