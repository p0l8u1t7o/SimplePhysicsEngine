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
import { loadState, cancelFlow } from '../lib/loop.mjs';
import * as repoGit from '../lib/repo.mjs';

let root;
const run = (env, ...args) => spawnSync(process.execPath, [join(STUDIO, 'vs3d.mjs'), ...args, '--workspace', root, '--cli', 'fake', '--no-wait'],
  { encoding: 'utf8', env: { ...process.env, VS3D_EXTRA_ADAPTERS: join(STUDIO, 'test', 'fake-adapters.mjs'), VS3D_DB: join(root, 'studio.db'), ...env } });      // 元件資料庫用暫存檔
const vs3d = (...args) => run({}, ...args);
before(() => {
  root = mkdtempSync(join(tmpdir(), 'vs3d-repo-'));
  cpSync(join(REPO, 'core'), join(root, 'core'), { recursive: true, filter: s => !/[\\/]review([\\/]|$)/.test(s.slice(REPO.length)) });
  writeFileSync(join(root, 'AGENTS.md'), '# 測試庫\n');
  writeFileSync(join(root, '.gitignore'), 'TEMP/\n/project-site/*/docs/\n/project-site/*/.studio/\n/project-site/*/TEMP/\n');
  git(root, ['init', '-q', '-b', 'main']); git(root, ['config', 'core.autocrlf', 'false']);
  const r = spawnSync(process.execPath, [join(root, 'core', 'tools', 'new-project.mjs'), 'Demo', '示範站'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // 規格摘要不能是空的（structure 檢查，core/SITE-RULES.md 完成定義第 4 項）
  const ag = join(root, 'project-site', 'Demo', 'AGENTS.md');
  writeFileSync(ag, readFileSync(ag, 'utf8').replace(/（設備、節拍、主要選型、資料來源。[^）]*）/, '- 示範站：輸送帶一條、工作台一座（示意尺寸），節拍示意 10 秒一件，資料來源是測試用假資料；尺寸與型號待現場確認'));
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

test('本庫模式：core.autocrlf=true（Windows 的 Git 預設）時，整批還原照樣寫回，寫回後不留只差換行的改動', () => {
  const J = projectPaths(root, 'Demo');
  git(root, ['config', 'core.autocrlf', 'true']);
  try {
    writeFileSync(join(J.dir, 'web', 'c.txt'), 'line1\nline2\n'); repoGit.commitProject(J, 'add c');
    rmSync(join(J.dir, 'web', 'c.txt')); git(root, ['checkout', '--', 'project-site/Demo/web/c.txt']);   // 照簽出規則變成 CRLF
    assert.match(readFileSync(join(J.dir, 'web', 'c.txt'), 'utf8'), /\r\n/);
    const base = repoGit.head(J);
    writeFileSync(join(J.dir, 'web', 'c.txt'), 'agent\r\n'); repoGit.commitProject(J, 'agent round');
    const r = repoGit.revertToCommit(J, base, 'revert');
    assert.deepEqual(r.skipped, [], '使用者沒改過的檔案不能因為 CRLF 被當成「之後改過」');
    assert.equal(readFileSync(join(J.dir, 'web', 'c.txt'), 'utf8'), 'line1\r\nline2\r\n');
    assert.equal(git(root, ['status', '--porcelain', '--', 'project-site/Demo/web/c.txt']).trim(), '');
  } finally { git(root, ['config', 'core.autocrlf', 'false']); }
});

// 併改偵測：假代理改完 README.md 之後，「使用者」在代理執行中也改了 README.md（FAKE_USER_EDIT，見 test/fake-agent.mjs）
test('本庫模式：代理執行中你也改了代理改的檔 → 這一輪不提交、轉成提問；選「照常提交」才一起提交，選「先停下」就停在未提交', () => {
  const J = projectPaths(root, 'Demo'), readme = () => readFileSync(join(J.dir, 'README.md'), 'utf8');
  const dirty = p => git(root, ['status', '--porcelain', '--', `project-site/Demo/${p}`]).trim() !== '';
  // 前面的測試留下的：autocrlf 改回 false 後只差換行的 c.txt、故意設成另一個分支的流程狀態
  for (const c of repoGit.changes(J)) repoGit.writeBack(J, 'HEAD', c.path);
  if (existsSync(J.state)) writeFileSync(J.state, JSON.stringify({ ...loadState(J), stage: 'done', flowActive: false, branch: repoGit.branch(J) }));
  assert.deepEqual(repoGit.changes(J), [], '前面的測試沒有留下未提交的改動');
  // 1. 偵測到併改：不提交、寫出提問
  let r = run({ FAKE_USER_EDIT: 'README.md' }, 'change', 'Demo', '--text', '加一行紀錄', '--no-review');
  assert.equal(r.status, 10, r.stdout + r.stderr);                    // 10：有問題等回答
  assert.match(r.stdout, /併改：README\.md/);
  let s = loadState(J);
  assert.deepEqual(s.concurrent.files, ['README.md']); const qid = s.concurrent.qid;
  assert.ok(dirty('README.md'), '這一輪的成果（含使用者的改動）還沒提交');
  assert.match(readme(), /修改紀錄：假代理[\s\S]*使用者同時在改/);
  // 還沒回答就續跑：照樣等，不會提交
  r = vs3d('resume', 'Demo'); assert.equal(r.status, 10, r.stdout + r.stderr); assert.ok(dirty('README.md'));
  // 2. 回答「照常提交」→ 一起提交，流程繼續到完成
  r = vs3d('answer', 'Demo', qid, '1'); assert.equal(r.status, 0, r.stdout + r.stderr);
  r = vs3d('resume', 'Demo', '--no-review', '--no-render'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!dirty('README.md'), r.stdout);
  assert.match(git(root, ['log', '--format=%s', '-8']), /\(with concurrent user edits\)/);
  s = loadState(J); assert.equal(s.concurrent, null); assert.equal(s.stage, 'done');
  // 3. 再一次，回答「先停下」→ 不提交、流程停下，之後續跑才會提交當下的內容
  r = run({ FAKE_USER_EDIT: 'README.md' }, 'change', 'Demo', '--text', '再加一行', '--no-review');
  assert.equal(r.status, 10, r.stdout + r.stderr);
  const q2 = loadState(J).concurrent.qid; assert.notEqual(q2, qid);
  vs3d('answer', 'Demo', q2, '2');
  r = vs3d('resume', 'Demo', '--no-review', '--no-render');
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, /沒有提交/);
  assert.ok(dirty('README.md')); assert.equal(loadState(J).concurrent, null);
});

test('本庫模式：代理執行中你改的是代理沒碰的檔 → 不是併改，照常提交並在記錄裡提醒', () => {
  const J = projectPaths(root, 'Demo');
  // 上一個測試停在未提交：當成使用者整理好了自己提交，並取消那個流程（省掉續跑的檢查時間）
  git(root, ['add', '-A', '--', 'project-site/Demo']); git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'user tidy']);
  if (loadState(J).stage !== 'done') cancelFlow(root, 'Demo');
  const r = run({ FAKE_USER_EDIT: 'web/user-note.txt' }, 'change', 'Demo', '--text', '第三次', '--no-review');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /併改：/);
  assert.match(r.stdout, /被別人改過（代理沒有改它們）：web\/user-note\.txt/);
  assert.equal(loadState(J).concurrent ?? null, null);
  assert.equal(git(root, ['status', '--porcelain', '--', 'project-site/Demo/web/user-note.txt']).trim(), '', '沒有重疊：照舊一起提交');
});

// 開發機的新建（2026-11-14）：直接建在 project-site/，保留範本的規則檔與寫檔關卡、不另建 git 庫、在本機分支只提交這一站
test('本庫模式：new 建在 project-site/、保留規則檔與寫檔關卡、開分支只提交這一站', () => {
  const r = vs3d('new', 'NewSite', '--prompt', '輸送帶＋龍門取放', '--title', '新站', '--create-only');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const J = projectPaths(root, 'NewSite');
  assert.ok(J.repo && existsSync(join(root, 'project-site', 'NewSite', 'web', 'index.html')));
  assert.ok(existsSync(join(J.dir, '.claude', 'settings.json')), '寫檔關卡要保留');
  assert.ok(!existsSync(join(J.dir, '.git')), '不能在本庫裡另建 git 庫');
  const agents = readFileSync(J.agents, 'utf8');
  assert.match(agents, /## 範圍/); assert.match(agents, /## 需求[\s\S]*> 輸送帶＋龍門取放[\s\S]*## 規格摘要/);
  assert.match(repoGit.branch(J), /^newsite\/vs3d-new-\d{4}-\d{4}$/);
  const files = git(root, ['diff', '--name-only', 'HEAD~2', 'HEAD']).trim().split('\n');
  assert.ok(files.every(f => f.startsWith('project-site/NewSite/')), files.join(','));
  assert.ok(files.includes('project-site/NewSite/.claude/settings.json') && files.includes('project-site/NewSite/studio.json'));
  const s = loadState(J);
  assert.equal(s.stage, 'plan'); assert.ok(s.newSite && s.flowActive);
  assert.deepEqual(JSON.parse(readFileSync(J.studioJson, 'utf8')).components, ['assess', '3d']);
  assert.equal(JSON.parse(readFileSync(join(J.dir, 'project.json'), 'utf8')).strict, true);
});

// 對話式修改（B 項）：第一句開新的工作階段（修改指令的完整提示），之後續接同一個；每句只跑快速檢查，紀錄寫在 .studio/chat.jsonl
test('本庫模式：chat 一句一句改、續接同一個開發工作階段、紀錄含代理截圖與檢查結果', () => {
  const J = projectPaths(root, 'Demo');
  const r1 = vs3d('chat', 'Demo', '--text', '出料台往右移');
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const s1 = loadState(J), sid = s1.sessions[Object.keys(s1.sessions).find(k => k.startsWith('build'))]?.sessionId;
  assert.equal(s1.stage, 'done'); assert.equal(s1.flow, null); assert.ok(sid);
  const r2 = vs3d('chat', 'Demo', '--text', '標籤字大一點');
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(readFileSync(join(J.dir, 'web', 'chat.txt'), 'utf8'), /標籤字大一點/);
  const items = readFileSync(join(J.studio, 'chat.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(items.map(m => m.role), ['user', 'agent', 'app', 'user', 'agent', 'app']);
  assert.match(items[4].text, /已照你說的改：標籤字大一點/); assert.deepEqual(items[4].images, ['TEMP/snap/iso@1.png']);
  assert.equal(items[5].ok, true);
  const rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(x => x.role === 'build');
  assert.equal(rounds.at(-1).sessionId, sid, '第二句續接同一個開發工作階段');
  assert.ok(!rounds.some(x => x.role === 'review'), '對話不審查');
});
