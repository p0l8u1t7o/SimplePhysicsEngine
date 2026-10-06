// 代理的認證方式（評估平台 Q1）：開發機可以切換訂閱帳號／API 金鑰、部署版只有 API 金鑰、金鑰加密保存、
// API 金鑰模式注入環境變數並換掉 CLI 的設定目錄、沒有金鑰時不退回訂閱帳號。
//   node --test studio/test/agent-auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { edition, isDeploy, subscriptionAllowed, editionProblems } from '../lib/edition.mjs';
import { setKey, getKey, keyInfo } from '../lib/secrets.mjs';
import { agentEnv, authMode, authStatus } from '../lib/agent-auth.mjs';
import { cleanSystem, systemDefaults, readSystem } from '../lib/settings.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';
import { runAgent } from '../lib/adapters/index.mjs';

// 暫時改環境變數，跑完還原
async function withEnv(vars, fn) {
  const old = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v == null) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) if (v == null) delete process.env[k]; else process.env[k] = v; }
}
const temp = async fn => { const dir = mkdtempSync(join(tmpdir(), 'vs3d-auth-')); try { return await withEnv({ VS3D_SECRETS: join(dir, 'secrets.json'), VS3D_AGENT_HOME: join(dir, 'home'), VS3D_EDITION: null }, () => fn(dir)); } finally { rmSync(dir, { recursive: true, force: true }); } };
const ANT = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ', OAI = 'sk-proj-' + 'b'.repeat(40) + '9876';

test('版本別：預設開發機；部署版沒有訂閱帳號，而且不能包含 subscription.mjs', () => withEnv({ VS3D_EDITION: null }, async () => {
  assert.equal(edition(), 'dev'); assert.ok(subscriptionAllowed()); assert.deepEqual(editionProblems(), []);
  await withEnv({ VS3D_EDITION: 'deploy' }, () => {
    assert.ok(isDeploy()); assert.ok(!subscriptionAllowed());
    assert.match(editionProblems()[0], /subscription\.mjs/, '開發中的本庫還有這個檔，部署版的自我檢查要抓到');
  });
  await withEnv({ VS3D_EDITION: 'xyz' }, () => assert.throws(edition, /不認得/));
}));

test('系統設定：開發機可以選訂閱帳號或 API 金鑰；部署版只能 API 金鑰，存過的訂閱設定也讀成 API 金鑰', () => withEnv({ VS3D_EDITION: null }, async () => {
  assert.equal(systemDefaults()['agents.auth.claude'], 'subscription');
  assert.deepEqual(cleanSystem({ 'agents.auth.codex': 'apiKey' }), { 'agents.auth.codex': 'apiKey' });
  assert.throws(() => cleanSystem({ 'agents.auth.codex': 'oauth' }), /只能是/);
  const db = openPartsDb(':memory:'); db.writeSettings({ 'agents.auth.claude': 'subscription' });
  await withEnv({ VS3D_EDITION: 'deploy' }, () => {
    assert.throws(() => cleanSystem({ 'agents.auth.claude': 'subscription' }), /部署版/);
    assert.equal(readSystem(db)['agents.auth.claude'], 'apiKey');
    assert.equal(systemDefaults()['agents.auth.codex'], 'apiKey');
  });
  db.close();
}));

test('API 金鑰：加密保存、只露末四碼、格式檢查、刪除', () => temp(async dir => {
  assert.deepEqual(keyInfo(), { anthropic: { set: false }, openai: { set: false } });
  assert.throws(() => setKey('anthropic', 'sk-short'), /格式/);
  assert.throws(() => setKey('anthropic', OAI), /sk-ant-/);
  assert.throws(() => setKey('google', ANT), /不認得/);
  const info = setKey('anthropic', `  ${ANT}  `, 'boss');
  assert.deepEqual([info.set, info.last4, info.by], [true, 'WXYZ', 'boss']);
  const raw = readFileSync(join(dir, 'secrets.json'), 'utf8');
  assert.ok(!raw.includes(ANT), '檔案裡不是明文');
  if (process.platform === 'win32') assert.equal(info.protection, 'dpapi');
  assert.equal(getKey('anthropic'), ANT);
  assert.equal(getKey('openai'), null);
  setKey('anthropic', null); assert.equal(keyInfo().anthropic.set, false);
}));

test('認證環境：訂閱模式不改環境；API 金鑰模式注入金鑰、換設定目錄、拿掉訂閱的變數；沒有金鑰就停下', () => temp(async dir => {
  const sub = { 'agents.auth.claude': 'subscription', 'agents.auth.codex': 'subscription' }, key = { 'agents.auth.claude': 'apiKey', 'agents.auth.codex': 'apiKey' };
  assert.deepEqual(await agentEnv('claude', sub), { mode: 'subscription', env: {}, unset: [] });
  assert.deepEqual(await agentEnv('fake', key), { mode: '', env: {}, unset: [] }, '測試用的假代理不受影響');
  await assert.rejects(agentEnv('claude', key), /還沒有設定.*Anthropic/);
  setKey('anthropic', ANT); setKey('openai', OAI);
  const c = await agentEnv('claude', key), x = await agentEnv('codex', key);
  assert.deepEqual([c.mode, c.env.VS3D_AGENT_KEY, c.env.CLAUDE_CONFIG_DIR], ['apiKey', ANT, join(dir, 'home', 'claude')]);
  assert.match(c.settings.apiKeyHelper, /key-helper\.mjs"$/, 'Claude Code 用 apiKeyHelper 拿金鑰');
  assert.ok(c.unset.includes('CLAUDE_CODE_OAUTH_TOKEN') && c.unset.includes('ANTHROPIC_API_KEY'));
  // 寫進 --settings 的 apiKeyHelper 和寫檔關卡並存
  const { claude } = await import('../lib/adapters/claude.mjs');
  const s = JSON.parse(claude.command({ prompt: '', settings: c.settings }).args.at(claude.command({ prompt: '' }).args.indexOf('--settings') + 1));
  assert.ok(s.apiKeyHelper && s.hooks.PreToolUse.length === 1);
  assert.deepEqual([x.env.CODEX_API_KEY, x.env.CODEX_HOME], [OAI, join(dir, 'home', 'codex')]);
  assert.deepEqual(await authStatus('codex', key), { mode: 'apiKey', loggedIn: true, detail: 'API 金鑰 …9876' });
  // 部署版：設定寫的是訂閱帳號也一律用 API 金鑰
  await withEnv({ VS3D_EDITION: 'deploy' }, async () => {
    assert.equal(authMode('claude', sub), 'apiKey');
    assert.equal((await agentEnv('claude', sub)).env.VS3D_AGENT_KEY, ANT);
  });
}));

test('runAgent：認證的環境變數真的交給子程序，要拿掉的變數也拿掉了', () => withEnv({ VS3D_TEST_UNSET: 'subscription-token' }, async () => {
  const probe = {
    name: 'probe', command: () => ({ cmd: process.execPath, args: ['-e', 'console.log(JSON.stringify({ key: process.env.VS3D_TEST_KEY, gone: process.env.VS3D_TEST_UNSET ?? null }))'], input: '', env: {} }),
    parse: e => [{ kind: 'text', text: JSON.stringify(e) }, { kind: 'end', ok: true, text: JSON.stringify(e) }],
  };
  const r = await runAgent(probe, { cwd: tmpdir(), prompt: '', env: { VS3D_TEST_KEY: 'k-123' }, unsetEnv: ['VS3D_TEST_UNSET'] });
  assert.deepEqual(JSON.parse(r.text), { key: 'k-123', gone: null });
}));
