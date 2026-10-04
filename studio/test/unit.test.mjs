// 單元測試：轉接層事件解析、角色指派、提問、檢查輸出解析、寫檔關卡。
//   node --test studio/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { claude } from '../lib/adapters/claude.mjs';
import { codex } from '../lib/adapters/codex.mjs';
import { resolveRole, parseRoleOverrides } from '../lib/roles.mjs';
import { validateQuestion, parseChoice, recordAnswer, appendToSection, loadQuestions } from '../lib/questions.mjs';
import { parseCheckOutput } from '../lib/checks.mjs';
import { STUDIO } from '../lib/util.mjs';

const fixture = name => readFileSync(join(STUDIO, 'test', 'fixtures', name), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const events = (a, name) => fixture(name).flatMap(e => a.parse(e));

test('Claude stream-json：工作階段、工具、結束', () => {
  const ev = events(claude, 'claude-stream.jsonl');
  assert.equal(ev.find(e => e.kind === 'session').id, 'a2218387-e098-4621-b846-f12402864aa4');
  assert.deepEqual(ev.filter(e => e.kind === 'tool').map(e => e.name), ['Write']);
  assert.ok(ev.some(e => e.kind === 'tool_result' && e.ok));
  const end = ev.find(e => e.kind === 'end');
  assert.equal(end.ok, true); assert.equal(end.text, 'DONE'); assert.equal(end.turns, 2);
});

test('Codex exec --json：工作階段、shell、沙箱擋下的寫入', () => {
  const ev = events(codex, 'codex-exec.jsonl');
  assert.equal(ev[0].kind, 'session');
  const shells = ev.filter(e => e.kind === 'tool');
  assert.equal(shells.length, 2);
  assert.match(shells[1].detail, /outside/);
  const results = ev.filter(e => e.kind === 'tool_result');
  assert.deepEqual(results.map(r => r.ok), [true, false]);       // 第二個指令被沙箱拒絕
  assert.ok(ev.some(e => e.kind === 'usage'));
  assert.ok(!ev.some(e => e.kind === 'error'));
});

test('Codex 頂層 error 只算警告，turn.failed 才算失敗', () => {
  assert.equal(codex.parse({ type: 'error', message: 'Reconnecting... 1/5' })[0].kind, 'warn');
  assert.equal(codex.parse({ type: 'turn.failed', error: { message: 'x' } })[0].kind, 'error');
});

test('指令參數：Claude 續接與寫檔關卡、Codex 續接用 -c sandbox_mode', () => {
  const c = claude.command({ prompt: 'p', sessionId: 's1', model: 'sonnet', allowWrite: ['/a'], denyWrite: ['/a/b'] });
  assert.ok(c.args.includes('--resume') && c.args.includes('s1'));
  assert.equal(c.input, 'p');
  assert.match(c.args[c.args.indexOf('--settings') + 1], /PreToolUse/);
  assert.deepEqual(JSON.parse(c.env.VS3D_ALLOW), ['/a']);
  const x = codex.command({ prompt: 'p', sessionId: 's2', model: 'm' });
  const args = x.args.slice(x.args.indexOf('exec'));
  assert.deepEqual(args.slice(0, 2), ['exec', 'resume']);
  assert.ok(args.includes('sandbox_mode="workspace-write"'));
  assert.deepEqual(args.slice(-2), ['s2', '-']);
  assert.ok(!codex.command({ prompt: 'p' }).args.includes('resume'));
});

test('角色指派的優先順序', () => {
  const ws = { defaultCli: 'claude', roles: { plan: { model: 'opus' } } };
  const sj = { roles: { fix: { cli: 'codex', model: 'gpt-x' } } };
  assert.deepEqual(resolveRole('plan', { workspaceSettings: ws, studioJson: sj }), { cli: 'claude', model: 'opus', effort: '' });
  assert.deepEqual(resolveRole('build', { workspaceSettings: ws, studioJson: sj }), { cli: 'claude', model: 'opus', effort: '' });
  assert.deepEqual(resolveRole('fix', { workspaceSettings: ws, studioJson: sj }), { cli: 'codex', model: 'gpt-x', effort: '' });
  // 單次指定 --cli codex：所有角色改用 codex，模型名稱不沿用 claude 的
  assert.deepEqual(resolveRole('plan', { workspaceSettings: ws, studioJson: sj, override: { cli: 'codex', roles: {} } }), { cli: 'codex', model: '', effort: '' });
  assert.deepEqual(resolveRole('plan', { workspaceSettings: ws, override: { roles: parseRoleOverrides('plan=haiku') } }).model, 'haiku');
  // 專案 studio.json 的 defaultCli（vs3d new --cli codex）：resume 沒帶 --cli 也沿用
  assert.deepEqual(resolveRole('plan', { workspaceSettings: ws, studioJson: { defaultCli: 'codex' } }), { cli: 'codex', model: '', effort: '' });
  assert.deepEqual(parseRoleOverrides('render=codex:gpt-5'), { render: { cli: 'codex', model: 'gpt-5' } });
  assert.throws(() => parseRoleOverrides('foo=x'));
});

test('問題檔驗證與選擇解析', () => {
  const ok = validateQuestion({ id: 'a-1', header: '一二三四五六七八九十十一十二十三', question: '?', options: [{ label: 'x' }, { label: 'y' }], recommended: 5 });
  assert.equal(ok.errors.length, 0); assert.equal(ok.q.header.length, 12); assert.equal(ok.q.recommended, null);
  assert.ok(validateQuestion({ id: 'bad id', question: '', options: [{ label: 'x' }] }).errors.length >= 3);
  const q = ok.q;
  assert.deepEqual(parseChoice(q, '2'), { choices: [1], text: '' });
  assert.equal(parseChoice(q, '0'), null);
  assert.deepEqual(parseChoice(q, '改用第三種'), { choices: [], text: '改用第三種' });
  assert.throws(() => parseChoice(q, '1,2'));
  assert.deepEqual(parseChoice({ ...q, multiSelect: true }, '1, 2').choices, [0, 1]);
});

test('回答寫進 AGENTS.md「已拍板事項」', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-q-'));
  const J = { questions: join(dir, 'q'), answers: join(dir, 'a'), agents: join(dir, 'AGENTS.md') };
  writeFileSync(J.agents, '# T\n\n## 已拍板事項\n\n（說明）\n\n## 其他\n\n內容\n');
  const q = { id: 'site-1', header: '站位', question: '?', options: [{ label: '左邊' }, { label: '右邊' }] };
  recordAnswer(J, q, { choices: [1], note: '靠牆' });
  const md = readFileSync(J.agents, 'utf8');
  assert.match(md, /## 已拍板事項\n\n（說明）\n- \*\*站位\*\*：右邊（靠牆）/);
  assert.match(md, /\n\n## 其他\n\n內容\n$/);
  assert.equal(appendToSection('# x\n', '## 已拍板事項', '- a'), '# x\n\n## 已拍板事項\n\n- a\n');
  assert.equal(loadQuestions(J).list.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('check.mjs 輸出解析', () => {
  const out = ['✓ P · imports  16 個模組  (0.0 s)', '✗ P · scene  {"ok":false}  (0.4 s)', '     A ↔ B 0.5 mm', '     C', '✗ P · tools/verify.mjs  exit 1  (0.1 s)', '', '1/3 通過'].join('\n');
  const rows = parseCheckOutput(out);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1].detail, ['A ↔ B 0.5 mm', 'C']);
  assert.equal(rows[2].check, 'tools/verify.mjs');
});

test('寫檔關卡：允許、拒絕、暫存目錄', () => {
  // 路徑只做比對、不必存在；不能放在系統暫存目錄底下（那裡一律允許）
  const guard = join(STUDIO, 'lib', 'guard.mjs'), root = process.platform === 'win32' ? 'D:\\vs3d-guard-test' : '/vs3d-guard-test';
  const call = (file, allow, deny = []) => {
    const r = spawnSync(process.execPath, [guard], { input: JSON.stringify({ cwd: root, tool_name: 'Write', tool_input: { file_path: file } }), env: { ...process.env, VS3D_ALLOW: JSON.stringify(allow), VS3D_DENY: JSON.stringify(deny) }, encoding: 'utf8' });
    return r.stdout.includes('"deny"') ? 'deny' : 'allow';
  };
  assert.equal(call(join(root, 'p', 'a.js'), [join(root, 'p')]), 'allow');
  assert.equal(call(join(root, 'core', 'a.js'), [join(root, 'p')]), 'deny');
  assert.equal(call(join(root, 'p', 'AGENTS.md'), [join(root, 'p')], [join(root, 'p', 'AGENTS.md')]), 'deny');
  assert.equal(call(join(tmpdir(), 'x.txt'), [join(root, 'p')]), 'allow');
  assert.equal(call(join(root, 'core', 'a.js'), []), 'allow');                 // 沒設定就不限制
});
