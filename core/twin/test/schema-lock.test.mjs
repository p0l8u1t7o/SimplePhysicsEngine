// SPE-AC-25 孿生用 schema（2026-11-11 起為 AutoSequence/schema，只鎖協定 schema）定位與版本檢查：三種定位方式；路徑不存在、協定 schema 有未提交修改、
// SHA-256 不符、RELEASE 不符各自拒絕（訊息含要求與實際版本、修正方式）；commit 改變但內容相同仍可載入；SPE repo 內沒有產生碼
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSchema, lockFor, locateSchemaRepo, SchemaError, ENV, DEFAULT_DIR } from '../../tools/twin-schema.mjs';
import { REPO } from '../../tools/projects.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fakeRepo(release = '9.9.9', hello = '{\n  "type": "object"\n}\n') {
  const dir = mkdtempSync(join(tmpdir(), 'as-'));
  mkdirSync(join(dir, 'generated', 'js'), { recursive: true });
  mkdirSync(join(dir, 'schemas', 'twin-protocol', 'v2'), { recursive: true });
  writeFileSync(join(dir, 'generated', 'js', 'constants.mjs'), `export const RELEASE = "${release}";\n`);
  writeFileSync(join(dir, 'generated', 'js', 'index.mjs'), `export * from './constants.mjs';\n`);
  writeFileSync(join(dir, 'schemas', 'twin-protocol', 'v2', 'README.md'), 'x\n');
  writeFileSync(join(dir, 'schemas', 'twin-protocol', 'v2', 'hello.schema.json'), hello);
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'r'); git(dir, 'tag', `v${release}`);
  return dir;
}
const rejects = async (opts, pattern) => {
  await assert.rejects(loadSchema(opts), e => e instanceof SchemaError && pattern.test(e.message) && /要求/.test(e.message));
};

test('定位：--schema-repo、環境變數、預設的上一層 ../AutoSequence/schema', () => {
  assert.equal(locateSchemaRepo({ repo: 'X:/a' }), resolve('X:/a'));
  const saved = process.env[ENV];
  try {
    process.env[ENV] = 'Y:/b'; assert.equal(locateSchemaRepo(), resolve('Y:/b'));
    delete process.env[ENV]; assert.equal(locateSchemaRepo(), resolve(REPO, '..', 'AutoSequence', 'schema')); assert.equal(resolve(DEFAULT_DIR), locateSchemaRepo());
  } finally { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; }
});

test('版本相符時載入；各種不符都拒絕啟動', async () => {
  const dir = fakeRepo(), lock = lockFor({ repo: dir });
  try {
    assert.equal(lock.release, '9.9.9'); assert.equal(lock.source, 'AutoSequence/schema');
    assert.deepEqual(Object.keys(lock.files), ['schemas/twin-protocol/v2/hello.schema.json']);
    const ok = await loadSchema({ repo: dir, lock });
    assert.equal(ok.release, '9.9.9'); assert.equal(ok.commit, lock.commit);
    await assert.rejects(loadSchema({ repo: join(dir, 'nope'), lock }), e => e instanceof SchemaError && /找不到/.test(e.message));
    await rejects({ repo: dir, lock: { ...lock, files: { 'schemas/twin-protocol/v2/hello.schema.json': '0'.repeat(64) } } }, /SHA-256/);
    await rejects({ repo: dir, lock: { ...lock, release: '9.9.8' } }, /RELEASE/);
    await rejects({ repo: dir, lock: { ...lock, release: null } }, /lock 檔還沒填/);
    // 只鎖協定 schema：其他地方的提交、產生碼與其他 schema 的修改（含未提交）都照常載入
    writeFileSync(join(dir, 'other.txt'), 'x\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'other');
    writeFileSync(join(dir, 'generated', 'js', 'index.mjs'), `export * from './constants.mjs';\n// 改過\n`);
    mkdirSync(join(dir, 'schemas', 'twin-model', 'v1'), { recursive: true });
    writeFileSync(join(dir, 'schemas', 'twin-model', 'v1', 'model.schema.json'), '{}\n');
    const moved = await loadSchema({ repo: dir, lock });
    assert.notEqual(moved.commit, lock.commit);
    // 換行不同（CRLF）不算修改：同內容、CRLF 的另一份算出相同雜湊
    const other = fakeRepo('9.9.9', '{\r\n  "type": "object"\r\n}\r\n');
    try { assert.deepEqual(lockFor({ repo: other }).files, lock.files); } finally { rmSync(other, { recursive: true, force: true }); }
    // 協定 schema 未提交的修改：拒絕，鎖定也拒絕
    writeFileSync(join(dir, 'schemas', 'twin-protocol', 'v2', 'hello.schema.json'), '{\n  "type": "array"\n}\n');
    await rejects({ repo: dir, lock }, /未提交的修改/);
    assert.throws(() => lockFor({ repo: dir }), e => e instanceof SchemaError && /不能鎖定/.test(e.message));
    // 提交後內容與 lock 不同：雜湊不符（含修正方式）
    git(dir, 'commit', '-q', '-am', 'next');
    await rejects({ repo: dir, lock }, /SHA-256/);
    // 新增協定 schema 檔：也要重新確認
    writeFileSync(join(dir, 'schemas', 'twin-protocol', 'v2', 'extra.schema.json'), '{}\n'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'extra');
    const newer = lockFor({ repo: dir });
    const { ['schemas/twin-protocol/v2/extra.schema.json']: _, ...without } = newer.files;
    await rejects({ repo: dir, lock: { ...newer, files: without } }, /新增了/);
    await assert.rejects(loadSchema({ repo: dir, lock }), e => e.message.includes('--write-lock'));
    // --schema-unlocked：只警告
    const loose = await loadSchema({ repo: dir, lock, unlocked: true });
    assert.ok(loose.warnings.some(w => w.includes('--schema-unlocked')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SPE repo 進版控的檔案裡沒有孿生用 schema 的產生碼，core/vendor 沒有它的檔案', () => {
  const files = execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(f => /\.(m?js|ts|json)$/.test(f));
  // 產生碼的特徵字串（拼接，避免本檔自己命中）
  const marks = [['export const', 'SCHEMA_BASE'].join(' '), ['azschema', 'codegen'].join('.')];
  const hits = files.filter(f => { try { const t = readFileSync(join(REPO, f), 'utf8'); return marks.some(m => t.includes(m)); } catch { return false; } });
  assert.deepEqual(hits, []);
  assert.deepEqual(files.filter(f => f.startsWith('core/vendor/') && /automation|azschema|twin/i.test(f)), []);
});
