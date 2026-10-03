// 整合測試（不耗額度）：真的建立工作區與專案、跑 core 檢查；代理換成 test/fake-agent.mjs。
//   node --test studio/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { ADAPTERS } from '../lib/adapters/index.mjs';
import { claude } from '../lib/adapters/claude.mjs';
import { initWorkspace, createProject, projectPaths, paths, setReadOnly } from '../lib/workspace.mjs';
import { snapshot, verifyAndRestore } from '../lib/isolation.mjs';
import { runProject, loadState } from '../lib/loop.mjs';
import { recordAnswer, loadQuestions } from '../lib/questions.mjs';
import { runChecks } from '../lib/checks.mjs';
import { STUDIO, git } from '../lib/util.mjs';

ADAPTERS.fake = { ...claude, name: 'fake', label: '假代理', models: [],
  command: ({ prompt, sessionId }) => ({ cmd: process.execPath, args: [join(STUDIO, 'test', 'fake-agent.mjs')], input: prompt, env: { FAKE_SESSION: sessionId || '' } }) };

let ws;
after(() => { for (const d of [paths(ws).core, paths(ws).pristine]) setReadOnly(d, false); rmSync(ws, { recursive: true, force: true }); });
before(async () => {
  ws = mkdtempSync(join(tmpdir(), 'vs3d-ws-'));
  initWorkspace(ws, { log: () => {} });
  await createProject(ws, { id: 'Alpha', title: '測試 A', prompt: '輸送帶＋龍門' });
  await createProject(ws, { id: 'Beta', title: '測試 B' });
});

test('工作區模式：core 從 projects/ 找專案，範本專案通過快速檢查', async () => {
  const c = await runChecks(ws, 'Alpha', { quick: true });
  assert.ok(c.ok, c.out);
  assert.ok(c.rows.length >= 5);
  assert.ok(existsSync(join(projectPaths(ws, 'Alpha').temp, 'check-quick.json')));   // 結果寫在專案 TEMP/
  assert.ok(!existsSync(join(paths(ws).projects, 'TEMP')));
});

test('專案建立：規則檔、git、.gitignore、移除本庫的寫檔關卡', () => {
  const J = projectPaths(ws, 'Alpha');
  assert.match(readFileSync(J.agents, 'utf8'), /> 輸送帶＋龍門/);
  assert.ok(!existsSync(join(J.dir, '.claude')));
  assert.equal(git(J.dir, ['log', '--oneline']).trim().split('\n').length, 1);
  assert.equal(git(J.dir, ['config', 'core.autocrlf']).trim(), 'false');
  assert.match(readFileSync(join(J.dir, '.gitignore'), 'utf8'), /docs\//);
});

test('隔離：core、規則檔、其他專案被改會被偵測並還原', () => {
  const P = paths(ws), core = join(P.core, 'README.md'), orig = readFileSync(core, 'utf8');
  const beta = join(P.projects, 'Beta', 'README.md'), betaOrig = readFileSync(beta, 'utf8');
  const snap = snapshot(ws, 'Alpha');
  chmodSync(core, 0o644); appendFileSync(core, 'x');
  writeFileSync(join(P.core, 'new.js'), 'x');
  chmodSync(P.rules[0], 0o644); appendFileSync(P.rules[0], 'x');
  appendFileSync(beta, 'x'); writeFileSync(join(P.projects, 'Beta', 'extra.txt'), 'x');
  const { violations } = verifyAndRestore(ws, 'Alpha', snap);
  const areas = violations.map(v => `${v.area}:${v.path}:${v.restored}`).sort();
  assert.deepEqual(areas, ['core:README.md:true', 'core:new.js:true', '專案 Beta:README.md:true', '專案 Beta:extra.txt:true', '工作區規則:AGENTS.md:true']);
  assert.equal(readFileSync(core, 'utf8'), orig);
  assert.ok(!existsSync(join(P.core, 'new.js')));
  assert.equal(readFileSync(beta, 'utf8'), betaOrig);
  assert.equal(verifyAndRestore(ws, 'Alpha', snapshot(ws, 'Alpha')).violations.length, 0);
});

test('完整流程（假代理）：提問 → 回答 → 提案確認 → 開發（含越界）→ 檢查失敗 → 修正 → 完成', async () => {
  process.env.FAKE_ESCAPE = '1';
  const J = projectPaths(ws, 'Alpha'), logs = [], log = s => logs.push(s);
  const opts = { override: { cli: 'fake', roles: {} }, full: false, shots: false, log };
  try {
    let r = await runProject(ws, 'Alpha', opts);
    assert.equal(r.status, 'waiting'); assert.deepEqual(r.questions, ['site-1']);
    recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });

    r = await runProject(ws, 'Alpha', opts);        // 規劃續接寫出提案 → 提案確認卡片
    assert.equal(r.status, 'waiting'); assert.match(r.questions[0], /^vs3d-proposal/);
    assert.match(readFileSync(join(J.plan, 'proposal.md'), 'utf8'), /左邊/);
    assert.match(readFileSync(J.agents, 'utf8'), /\*\*站位\*\*：左邊/);
    recordAnswer(J, loadQuestions(J).list.find(q => !q.answered), { choices: [0] });

    r = await runProject(ws, 'Alpha', opts);
    assert.equal(r.status, 'done', logs.join('\n'));
    const s = loadState(J);
    assert.equal(s.lastCheck.ok, true);
    assert.equal(s.round, 4);                          // plan、plan（續接）、build、fix
    assert.equal(s.sessions.plan.sessionId.length > 0, true);
    const rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const build = rounds.find(x => x.role === 'build');
    assert.ok(build.violations.some(v => v.area === 'core' && v.restored), '越界改 core 要被還原');
    assert.ok(build.violations.some(v => v.path === 'AGENTS.md' && v.restored), '開發角色不能改 AGENTS.md');
    assert.ok(rounds.some(x => x.check === 'quick' && !x.ok) && rounds.some(x => x.check === 'quick' && x.ok));
    assert.doesNotMatch(readFileSync(join(paths(ws).core, 'README.md'), 'utf8'), /escape/);
    assert.doesNotMatch(readFileSync(J.agents, 'utf8'), /偷改/);
    assert.ok(git(J.dir, ['log', '--oneline']).trim().split('\n').length >= 4);
  } finally { delete process.env.FAKE_ESCAPE; }
});

test('執行鎖：工作區有別的 vs3d 在跑時不開始', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)']);
  try {
    writeFileSync(join(ws, '.studio', 'run.lock'), JSON.stringify({ pid: child.pid, project: 'Other', at: 'now' }));
    const r = await runProject(ws, 'Beta', { override: { cli: 'fake', roles: {} }, log: () => {} });
    assert.equal(r.status, 'stopped'); assert.match(r.message, /Other/);
  } finally { child.kill(); rmSync(join(ws, '.studio', 'run.lock'), { force: true }); }
});

test('同一項檢查連續失敗會轉成提問', async () => {
  process.env.FAKE_NEVER_FIX = '1';
  const J = projectPaths(ws, 'Beta'), opts = { override: { cli: 'fake', roles: {}, autoApprove: true }, full: false, shots: false, log: () => {} };
  try {
    let r = await runProject(ws, 'Beta', opts);
    recordAnswer(J, loadQuestions(J).list[0], { choices: [1] });
    r = await runProject(ws, 'Beta', opts);
    assert.equal(r.status, 'waiting');
    assert.match(r.questions[0], /^vs3d-streak/);
    const s = loadState(J);
    assert.equal(s.stage, 'fix');
    assert.equal(readdirSync(J.logs).filter(f => f.includes('-fix')).length, 3);   // 修了 3 次才停
    recordAnswer(J, loadQuestions(J).list.find(q => !q.answered), { choices: [2] });   // 接受目前狀態
    r = await runProject(ws, 'Beta', opts);
    assert.equal(r.status, 'done');
  } finally { delete process.env.FAKE_NEVER_FIX; }
});
