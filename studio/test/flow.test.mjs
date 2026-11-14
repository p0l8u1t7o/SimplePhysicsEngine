// 整合測試（不耗額度）：真的建立工作區與專案、跑 core 檢查；代理換成 test/fake-agent.mjs。
//   node --test studio/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { ADAPTERS } from '../lib/adapters/index.mjs';
import { adapters as fakeAdapters } from './fake-adapters.mjs';
import { initWorkspace, createProject, projectPaths, paths, setReadOnly, writeSpecSummary } from '../lib/workspace.mjs';
import { snapshot, verifyAndRestore } from '../lib/isolation.mjs';
import { runProject, loadState, pickItems } from '../lib/loop.mjs';
import { recordAnswer, loadQuestions } from '../lib/questions.mjs';
import { runChecks } from '../lib/checks.mjs';
import { STUDIO, git } from '../lib/util.mjs';
import { pptx } from './office-fixtures.mjs';

Object.assign(ADAPTERS, fakeAdapters);

let ws;
after(() => { delete process.env.VS3D_DB; for (const d of [paths(ws).core, paths(ws).pristine]) setReadOnly(d, false); rmSync(ws, { recursive: true, force: true }); });
before(async () => {
  ws = mkdtempSync(join(tmpdir(), 'vs3d-ws-'));
  process.env.VS3D_DB = join(ws, 'studio.db');      // 元件資料庫用暫存檔（流程會寫元件清單、匯入提案的元件），不要動到本機的 studio/data/studio.db
  initWorkspace(ws, { log: () => {} });
  await createProject(ws, { id: 'Alpha', title: '測試 A', prompt: '輸送帶＋龍門' });
  await createProject(ws, { id: 'Beta', title: '測試 B' });
});

test('工作區模式：core 從 projects/ 找專案，範本專案填好規格摘要後通過快速檢查', async () => {
  // 規格摘要還是空的：structure 擋下（core/SITE-RULES.md 完成定義第 4 項）
  const c0 = await runChecks(ws, 'Alpha', { quick: true });
  assert.ok(!c0.ok && /規格摘要/.test(c0.out), c0.out);
  // 提案確認後 app 從 .studio/plan/spec-summary.md 填入
  const JA = projectPaths(ws, 'Alpha');
  mkdirSync(JA.plan, { recursive: true });
  writeFileSync(join(JA.plan, 'spec-summary.md'), '# 規格摘要\n\n- 資料來源：測試需求\n- 製程：入料輸送 → 龍門取放 → 出料\n- 設備：輸送帶一條、龍門一座（示意）\n- 節拍：示意 10 秒一件，尺寸待現場確認\n');
  assert.ok(writeSpecSummary(JA));
  assert.match(readFileSync(JA.agents, 'utf8'), /## 規格摘要\n\n- 資料來源：測試需求/);
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

test('專案建立：Office 上傳檔抽到 docs/*.extract，AGENTS.md 標出 text.md；舊格式提示另存', async () => {
  const src = mkdtempSync(join(tmpdir(), 'vs3d-up-')), pf = join(src, '規格.pptx'), old = join(src, '舊.doc');
  writeFileSync(pf, pptx()); writeFileSync(old, 'x');
  const J = await createProject(ws, { id: 'Office', title: '測試 O', prompt: 'x', files: [pf, old] });
  rmSync(src, { recursive: true, force: true });
  const agents = readFileSync(J.agents, 'utf8');
  assert.match(agents, /- `docs\/規格\.pptx`（已抽出文字與圖片：`docs\/規格\.pptx\.extract\/text\.md`，2 張投影片、3 張圖）/);
  assert.match(agents, /- `docs\/舊\.doc`（舊版格式/);
  assert.ok(existsSync(join(J.docs, '規格.pptx.extract', 'slide01-image1.png')));
  assert.ok(J.notes.some(n => /舊\.doc.*另存成 \.docx/.test(n)));
  assert.equal(git(J.dir, ['status', '--porcelain']).trim(), '');      // docs/ 不進版控
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
  const opts = { override: { cli: 'fake', roles: {} }, full: false, shots: false, review: false, render: false, stage2: false, log };
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
  const J = projectPaths(ws, 'Beta'), opts = { override: { cli: 'fake', roles: {}, autoApprove: true }, full: false, shots: false, review: false, render: false, stage2: false, log: () => {} };
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

test('審查與補強（假代理）：必修送修正 → 再審查 → 補強改到節拍被守門擋下 → 修正 → 接受', async () => {
  process.env.FAKE_RENDER_BREAK = '1';
  await createProject(ws, { id: 'Gamma', title: '測試 G', prompt: '輸送帶＋龍門' });
  const J = projectPaths(ws, 'Gamma'), logs = [];
  const opts = { override: { cli: 'fake', roles: {}, autoApprove: true }, full: false, shots: false, perf: false, stage2: false, log: s => logs.push(s) };
  try {
    let r = await runProject(ws, 'Gamma', opts);
    recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });
    r = await runProject(ws, 'Gamma', opts);
    assert.equal(r.status, 'waiting', logs.join('\n'));
    assert.match(r.questions[0], /^vs3d-render-accept/);
    const s = loadState(J), rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.deepEqual(rounds.filter(x => x.review).map(x => x.must.length), [1, 0]);           // 第 1 次抓到必修，修好後第 2 次沒有
    assert.ok(existsSync(join(J.dir, 'web', 'review-fixed.txt')));
    const guards = rounds.filter(x => x.guard);
    assert.equal(guards.length, 2);
    assert.equal(guards[0].ok, false); assert.match(guards[0].fails.join(), /時間軸總長/);    // 改了節拍被擋下
    assert.equal(guards[1].ok, true);
    assert.ok(existsSync(join(J.temp, 'render-compare', 'index.html')));
    assert.deepEqual(s.renderItems.map(x => x.id), ['S1', 'S2']);
    recordAnswer(J, loadQuestions(J).list.find(q => !q.answered), { choices: [0] });
    r = await runProject(ws, 'Gamma', opts);
    assert.equal(r.status, 'done');
    assert.equal(loadState(J).render.result, 'accepted');
    assert.ok(existsSync(join(J.dir, 'web', 'render-detail.txt')));
  } finally { delete process.env.FAKE_RENDER_BREAK; }
});

test('補強後選「整批還原」：回到補強前的 commit', async () => {
  await createProject(ws, { id: 'Delta', title: '測試 D', prompt: 'x' });
  const J = projectPaths(ws, 'Delta'), opts = { override: { cli: 'fake', roles: {}, autoApprove: true }, full: false, shots: false, perf: false, stage2: false, log: () => {} };
  let r = await runProject(ws, 'Delta', opts);
  recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });
  r = await runProject(ws, 'Delta', opts);
  assert.match(r.questions[0], /^vs3d-render-accept/);
  assert.ok(existsSync(join(J.dir, 'web', 'render-detail.txt')));
  const base = loadState(J).renderBase.commit;
  recordAnswer(J, loadQuestions(J).list.find(q => !q.answered), { choices: [2] });
  r = await runProject(ws, 'Delta', opts);
  assert.equal(r.status, 'done');
  assert.equal(git(J.dir, ['rev-parse', 'HEAD']).trim(), base);
  assert.ok(!existsSync(join(J.dir, 'web', 'render-detail.txt')));
  assert.equal(loadState(J).render.result, 'reverted');
});

test('第二段（假代理）：第一段完成出卡片 → 第二段規劃（用戶名稱進名單並遮蔽）→ 開發改到節拍被排程指紋擋下 → 修正 → 完成', async () => {
  process.env.FAKE_SEG2_BREAK = '1';
  await createProject(ws, { id: 'Eps', title: '測試 E', prompt: '幫測試用戶甲規劃輸送帶' });
  const J = projectPaths(ws, 'Eps'), logs = [];
  const opts = { override: { cli: 'fake', roles: {}, autoApprove: true }, full: false, shots: false, perf: false, review: false, render: false, log: s => logs.push(s) };
  try {
    let r = await runProject(ws, 'Eps', opts);
    recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });
    r = await runProject(ws, 'Eps', opts);                       // 第一段完成 → 第二段卡片
    assert.equal(r.status, 'waiting', logs.join('\n')); assert.match(r.questions[0], /^vs3d-stage2/);
    assert.equal(loadState(J).stage, 'done');
    recordAnswer(J, loadQuestions(J).list.find(q => !q.answered), { choices: [0] });
    r = await runProject(ws, 'Eps', opts);
    assert.equal(r.status, 'done', logs.join('\n'));
    const s = loadState(J), rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(s.segment, 2);
    assert.ok(s.sessions['plan@2'] && s.sessions['build@2'] && s.sessions['fix@2'], '第二段的工作階段另存');
    assert.equal(s.segments[1].rounds > 0, true);
    assert.ok(rounds.some(x => x.role === 'build' && x.segment === 2));
    assert.ok(logs.some(l => /排程指紋：/.test(l)) && logs.some(l => /排程指紋與第一段相同/.test(l)), '改到節拍要先被擋下，修好後通過');
    assert.ok(existsSync(join(J.dir, 'web', 'segment2.txt')));
    assert.match(readFileSync(join(paths(ws).ws, '.studio', 'client-names.txt'), 'utf8'), /測試用戶甲/);
    assert.doesNotMatch(readFileSync(J.agents, 'utf8'), /測試用戶甲/);   // 需求原文裡的用戶名稱被遮掉
    assert.match(readFileSync(J.agents, 'utf8'), /幫（用戶）規劃/);
    assert.ok(readdirSync(J.logs).some(f => f.endsWith('-build-s2.jsonl')));
  } finally { delete process.env.FAKE_SEG2_BREAK; }
});

test('角色依段落指派：第二段的開發與修正預設 Codex gpt-6，審查維持 opus；「角色@段」可以覆寫', async () => {
  const { resolveRole } = await import('../lib/roles.mjs');
  assert.deepEqual(resolveRole('build', {}, 1), { cli: 'claude', model: 'opus', effort: 'high' });
  assert.deepEqual(resolveRole('build', {}, 2), { cli: 'codex', model: 'gpt-6-astra', effort: 'high' });
  assert.deepEqual(resolveRole('fix', {}, 2), { cli: 'codex', model: 'gpt-6-astra', effort: 'high' });
  assert.equal(resolveRole('review', {}, 2).cli, 'claude');
  assert.deepEqual(resolveRole('build', { studioJson: { roles: { 'build@2': { cli: 'claude', model: 'opus' } } } }, 2), { cli: 'claude', model: 'opus', effort: 'high' });
  assert.equal(resolveRole('build', { override: { cli: 'claude', roles: {} } }, 2).cli, 'claude');   // --cli 讓所有角色用同一種
});

test('交接包：匯出 → 匯入成新專案，git 歷史、階段、拍板與名單都帶過去，工作階段清掉', async () => {
  const { exportHandoff, importHandoff } = await import('../lib/handoff.mjs');
  const J = projectPaths(ws, 'Alpha'), file = join(J.temp, 'exports', 'alpha-handoff.zip');
  const before = loadState(J), head = git(J.dir, ['rev-parse', 'HEAD']).trim();
  const meta = await exportHandoff(ws, 'Alpha', file, { log: () => {} });
  assert.equal(meta.head, head);
  const r = await importHandoff(ws, file, { id: 'AlphaCopy', log: () => {} });
  const K = projectPaths(ws, 'AlphaCopy'), s = loadState(K);
  assert.equal(git(K.dir, ['rev-parse', 'HEAD']).trim(), head);                       // 歷史完整
  assert.equal(s.stage, before.stage); assert.equal(s.round, before.round);
  assert.deepEqual(s.sessions, {}); assert.equal(s.importedFrom.id, 'Alpha');           // 工作階段屬於原本的電腦
  assert.match(readFileSync(K.agents, 'utf8'), /\*\*站位\*\*：左邊/);                   // 拍板事項
  assert.ok(existsSync(join(K.plan, 'proposal.md')));
  assert.ok(!existsSync(join(K.studio, 'logs')), '代理的完整對話記錄不帶過去');
  await assert.rejects(importHandoff(ws, file, { id: 'AlphaCopy', log: () => {} }), /專案已存在/);
  assert.equal(r.id, 'AlphaCopy');

  // 惡意交接包（2026-11-07 巡檢）：代號含 ../ 不能 clone 到工作區外；docs/../ 的項目不能寫出專案資料夾
  await assert.rejects(importHandoff(ws, file, { id: '../Outside', log: () => {} }), /專案名稱/);
  assert.ok(!existsSync(join(ws, '..', 'Outside')));
  const { readZip, writeZip } = await import(new URL(`file:///${join(paths(ws).core, 'tools', 'zip.mjs').replace(/\\/g, '/')}`).href);
  const evil = join(J.temp, 'exports', 'evil-handoff.zip');
  writeZip(evil, [...readZip(file), { name: 'docs/../../../escaped.txt', data: 'x' }, { name: 'studio/..\\..\\..\\escaped2.txt', data: 'x' }]);
  const skipped = [];
  await importHandoff(ws, evil, { id: 'AlphaEvil', log: m => skipped.push(m) });
  assert.ok(!existsSync(join(ws, 'escaped.txt')) && !existsSync(join(ws, 'projects', 'escaped.txt')) && !existsSync(join(ws, 'escaped2.txt')) && !existsSync(join(ws, 'projects', 'escaped2.txt')));
  assert.equal(skipped.filter(m => /不安全的路徑/.test(m)).length, 2);
});

// 參考站的假本庫：三個站，各有 web/、AGENTS.md 與只留本機的 docs/
function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'vs3d-refs-'));
  const station = (name, title, summary, agents) => {
    const d = join(root, 'project-site', name);
    mkdirSync(join(d, 'web', 'js'), { recursive: true }); mkdirSync(join(d, 'docs'), { recursive: true });
    writeFileSync(join(d, 'project.json'), JSON.stringify({ title, summary }));
    writeFileSync(join(d, 'AGENTS.md'), `# ${title}\n\n${agents}\n`);
    writeFileSync(join(d, 'web', 'js', 'project.js'), '// 參考站的場景\n');
    writeFileSync(join(d, 'docs', 'secret.txt'), '本機資料');
  };
  station('Conveyor', '輸送帶取放', '輸送帶加龍門取放', '龍門在輸送帶上方取放工件');
  station('Lab', '實驗室滴定', '酸鹼滴定', '滴定管與燒杯');
  station('Press', '壓合站', '手臂壓合', '手臂把接頭壓進外殼');
  return root;
}
const fakeShots = async (wsDir, id, dir) => { mkdirSync(join(dir, id), { recursive: true }); writeFileSync(join(dir, id, 'desktop.png'), 'png'); return { ok: true, dir }; };

test('開發後自我檢查（假代理）：截圖交給同一個開發工作階段、參考站唯讀、中斷後續跑不重做也不跳過、第二段不能改第一段的節拍', async () => {
  const root = fakeRepo(), promptLog = join(root, 'prompts.txt'), seen = [];
  Object.assign(ADAPTERS, { spy: { ...ADAPTERS.fake, name: 'spy', command: o => { seen.push(o); return ADAPTERS.fake.command(o); } } });
  process.env.FAKE_PROMPT_LOG = promptLog;
  await createProject(ws, { id: 'Zeta', title: '測試 Z', prompt: '輸送帶＋龍門取放' });
  const J = projectPaths(ws, 'Zeta'), logs = [];
  const opts = { override: { cli: 'spy', roles: {}, autoApprove: true }, full: false, shots: true, shotsFn: fakeShots, perf: false, review: false, render: false, refRoot: root, log: s => logs.push(s) };
  try {
    let r = await runProject(ws, 'Zeta', opts);
    recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });
    process.env.FAKE_SELF_FAIL = '1';
    r = await runProject(ws, 'Zeta', opts);                      // 開發 → 檢查失敗 → 修正 → 通過＋截圖 → 自我檢查（中斷）
    assert.equal(r.status, 'stopped', logs.join('\n'));
    let s = loadState(J);
    assert.equal(s.stage, 'self-review'); assert.equal(s.selfReviews || 0, 0);
    delete process.env.FAKE_SELF_FAIL;
    r = await runProject(ws, 'Zeta', opts);                      // 續跑：重做自我檢查 → 再檢查 → 完成 → 第二段卡片
    assert.equal(r.status, 'waiting', logs.join('\n')); assert.match(r.questions[0], /^vs3d-stage2/);
    s = loadState(J);
    assert.equal(s.selfReviews, 1); assert.equal(s.selfReviewDue, false);
    let rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const build = rounds.find(x => x.role === 'build' && !x.step), self = rounds.filter(x => x.step === 'self-review');
    assert.equal(self.length, 2);                                // 中斷的一輪＋續跑的一輪
    assert.ok(self[1].ok && self[1].resumed && self[1].sessionId === build.sessionId, '續接開發的工作階段');
    assert.match(readFileSync(join(J.dir, 'web', 'self-review-1-1.txt'), 'utf8'), /TEMP\/shots-r\d+\/Zeta\/desktop\.png/);
    assert.ok(rounds.findLastIndex(x => x.check === 'quick') > rounds.findLastIndex(x => x.step === 'self-review'), '自我檢查後重新檢查');
    // 參考站：自動挑到關鍵字最接近的站；程式資料夾唯讀加進來、整站禁止寫、docs 禁止讀；規格摘要複製到 .studio/references/
    assert.deepEqual(s.references, ['Conveyor']);
    const site = join(root, 'project-site', 'Conveyor'), b = seen.find(o => /任務：第一段開發/.test(o.prompt));
    assert.ok(b.readDirs.includes(join(site, 'web')) && !b.readDirs.some(d => d === site || d.includes('docs')));
    assert.ok(b.denyWrite.includes(site) && b.denyRead.includes(join(site, 'docs')) && b.denyRead.includes(join(site, '.studio')));
    assert.ok(seen.filter(o => /任務：修正檢查失敗/.test(o.prompt)).every(o => !o.readDirs.includes(join(site, 'web'))), '修正角色不給參考站');
    assert.match(b.prompt, /參考站[\s\S]*Conveyor[\s\S]*不要複製場景/);
    assert.ok(existsSync(join(J.studio, 'references', 'Conveyor', 'AGENTS.md')));
    assert.doesNotMatch(readFileSync(promptLog, 'utf8'), /secret/);
    assert.ok(seen.find(o => /任務：自我檢查/.test(o.prompt)).images.some(f => f.endsWith('desktop.png')));
    // 第二段：自我檢查改到第一段的節拍 → 排程指紋擋下 → 修正 → 完成
    process.env.FAKE_SELF_BREAK2 = '1';
    recordAnswer(J, loadQuestions(J).list.find(q => !q.answered), { choices: [0] });
    r = await runProject(ws, 'Zeta', opts);
    assert.equal(r.status, 'done', logs.join('\n'));
    s = loadState(J); rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(s.segment, 2); assert.equal(s.selfReviews, 1); assert.equal(s.segments[1].selfReviews, 1);
    assert.ok(rounds.some(x => x.step === 'self-review' && x.segment === 2 && x.resumed));
    assert.ok(existsSync(join(J.dir, 'web', 'self-review-2-1.txt')));
    assert.ok(logs.some(l => /排程指紋：/.test(l)) && logs.some(l => /排程指紋與第一段相同/.test(l)), '改到節拍要先被擋下，修好後通過');
    // 已完成：續跑不會再做自我檢查
    const n = s.round;
    r = await runProject(ws, 'Zeta', opts);
    assert.equal(r.status, 'done'); assert.equal(loadState(J).round, n);
  } finally {
    for (const k of ['FAKE_PROMPT_LOG', 'FAKE_SELF_FAIL', 'FAKE_SELF_BREAK2']) delete process.env[k];
    rmSync(root, { recursive: true, force: true });
  }
});

test('自我檢查與參考站可以關掉：studio.json 的 selfReview: 0、references: []', async () => {
  const root = fakeRepo(), seen = [];
  Object.assign(ADAPTERS, { spy2: { ...ADAPTERS.fake, name: 'spy2', command: o => { seen.push(o); return ADAPTERS.fake.command(o); } } });
  await createProject(ws, { id: 'Eta', title: '測試 H', prompt: '輸送帶＋龍門取放' });
  const J = projectPaths(ws, 'Eta');
  writeFileSync(J.studioJson, JSON.stringify({ ...JSON.parse(readFileSync(J.studioJson, 'utf8')), selfReview: 0, references: [] }));
  const opts = { override: { cli: 'spy2', roles: {}, autoApprove: true }, full: false, shots: true, shotsFn: fakeShots, perf: false, review: false, render: false, stage2: false, refRoot: root, log: () => {} };
  try {
    await runProject(ws, 'Eta', opts);
    recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });
    const r = await runProject(ws, 'Eta', opts);
    assert.equal(r.status, 'done');
    const rounds = readFileSync(J.rounds, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.ok(!rounds.some(x => x.step === 'self-review'));
    assert.ok(seen.every(o => o.readDirs.length === 1 && !o.denyRead.length && !/參考站/.test(o.prompt)));
    assert.ok(!existsSync(join(J.studio, 'references')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pickItems：編號、id、「除了」', () => {
  const all = [{ id: 'S1' }, { id: 'S2' }, { id: 'S3' }, { id: 'S4' }];
  assert.deepEqual(pickItems(all, '1,3').map(x => x.id), ['S1', 'S3']);
  assert.deepEqual(pickItems(all, 'S2、S4').map(x => x.id), ['S2', 'S4']);
  assert.deepEqual(pickItems(all, '除了 2、4').map(x => x.id), ['S1', 'S3']);
  assert.equal(pickItems(all, '').length, 4);
});
