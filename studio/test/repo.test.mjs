// 本庫模式整合測試（假代理）：暫存的 git 庫（core＋project-site）上跑 vs3d change，確認
//   開本機分支、只提交該站路徑、站外未提交的改動不被碰、該站有未提交改動時拒絕開工、整批還原用逐檔寫回。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { STUDIO, REPO, git } from '../lib/util.mjs';
import { projectPaths, isRepo } from '../lib/workspace.mjs';
import { loadState } from '../lib/loop.mjs';
import * as repoGit from '../lib/repo.mjs';

let root;
const vs3d = (...args) => spawnSync(process.execPath, [join(STUDIO, 'vs3d.mjs'), ...args, '--workspace', root, '--cli', 'fake', '--no-wait'],
  { encoding: 'utf8', env: { ...process.env, VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs') } });
before(() => {
  root = mkdtempSync(join(tmpdir(), 'vs3d-repo-'));
  cpSync(join(REPO, 'core'), join(root, 'core'), { recursive: true, filter: s => !/[\\/]review([\\/]|$)/.test(s.slice(REPO.length)) });
  writeFileSync(join(root, 'AGENTS.md'), '# 測試庫\n');
  writeFileSync(join(root, '.gitignore'), 'TEMP/\n/project-site/*/docs/\n/project-site/*/.studio/\n/project-site/*/TEMP/\n');
  git(root, ['init', '-q', '-b', 'main']); git(root, ['config', 'core.autocrlf', 'false']);
  const r = spawnSync(process.execPath, [join(root, 'core', 'tools', 'new-project.mjs'), 'Demo', '示範站'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  git(root, ['add', '-A']); git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
});
after(() => rmSync(root, { recursive: true, force: true }));

test('本庫模式：change 開分支、只提交該站、站外未提交改動不動', () => {
  assert.ok(isRepo(root));
  const J = projectPaths(root, 'Demo');
  assert.equal(loadState(J).stage, 'done');                          // 本庫的站沒有 vs3d 狀態時視為已完成
  writeFileSync(join(root, 'notes.txt'), '使用者的筆記');            // 站外：未追蹤
  appendFileSync(join(root, 'AGENTS.md'), '使用者正在改\n');          // 站外：已追蹤、未提交
  const r = vs3d('change', 'Demo', '--text', '把出料台改成綠色', '--no-review');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const br = repoGit.branch(J);
  assert.match(br, /^demo\/vs3d-change-\d{4}-\d{4}$/);
  const files = git(root, ['diff', '--name-only', 'main', 'HEAD']).trim().split('\n');
  assert.ok(files.length > 0 && files.every(f => f.startsWith('project-site/Demo/')), files.join(','));
  assert.ok(files.includes('project-site/Demo/web/change.txt'));
  assert.equal(readFileSync(join(root, 'notes.txt'), 'utf8'), '使用者的筆記');
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /使用者正在改/);
  assert.match(git(root, ['status', '--porcelain']), / M AGENTS\.md/);   // 使用者的改動仍未提交
  const s = loadState(J);
  assert.equal(s.stage, 'done'); assert.equal(s.flowActive, false); assert.equal(s.branch, br);
});

test('本庫模式：該站有未提交改動時拒絕開工；不在流程分支上時拒絕續跑', () => {
  const J = projectPaths(root, 'Demo');
  appendFileSync(join(J.dir, 'README.md'), '使用者還沒提交的改動\n');
  const r = vs3d('change', 'Demo', '--text', '再改一次');
  assert.equal(r.status, 2); assert.match(r.stderr, /未提交的改動/);
  // 介面清單的「N 個未提交」：只算該站路徑，app 自己的 .studio/、TEMP/ 不算
  mkdirSync(join(J.dir, 'TEMP'), { recursive: true }); writeFileSync(join(J.dir, 'TEMP', 'x.txt'), 'x');
  assert.deepEqual(repoGit.stationChanges(root), { Demo: ['README.md'] });
  writeFileSync(join(J.dir, 'README.md'), git(J.dir, ['show', 'HEAD:project-site/Demo/README.md']));   // 測試自己清掉
  // 流程進行中卻不在該分支：resume 要拒絕
  const s = loadState(J); Object.assign(s, { flowActive: true, stage: 'check', branch: 'demo/vs3d-other-0000-0000' });
  writeFileSync(J.state, JSON.stringify(s));
  const q = vs3d('resume', 'Demo');
  assert.equal(q.status, 1); assert.match(q.stdout, /請切回該分支/);
});

test('本庫模式：revertToCommit 只寫回代理改過、使用者之後沒再改的檔案', () => {
  const J = projectPaths(root, 'Demo'), base = repoGit.head(J);
  writeFileSync(join(J.dir, 'web', 'a.txt'), 'agent'); writeFileSync(join(J.dir, 'web', 'b.txt'), 'agent');
  repoGit.commitProject(J, 'agent round');
  writeFileSync(join(J.dir, 'web', 'b.txt'), 'user edit');            // 使用者之後又改了 b
  const r = repoGit.revertToCommit(J, base, 'revert');
  assert.ok(!existsSync(join(J.dir, 'web', 'a.txt')), '代理新增的 a 被移除');
  assert.equal(readFileSync(join(J.dir, 'web', 'b.txt'), 'utf8'), 'user edit');
  assert.deepEqual(r.skipped, ['web/b.txt']);
});
