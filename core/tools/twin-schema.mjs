// 孿生用 schema（Twin Protocol、機台描述檔 MD）的定位與版本檢查。twin.mjs、core/twin 的測試與 check.mjs 的 twin 檢查共用。
// 來源（2026-11-11 使用者拍板）：AutoSequence repo 內的 schema/（AutoSequence 自 Automation-Schema v2.0.0-preview.3 收入後自行維護，
// 不再追上游；與 SPE 的相容性由 SPE 這邊以本檔的 lock 把關）。執行時讀相鄰的 repo，不複製進 SPE（專有授權），只讀不寫，git 只執行 rev-parse 與 status。
//
//   路徑優先序：--schema-repo <路徑> → 環境變數 SPE_AUTOMATION_SCHEMA → SPE 根目錄的上一層 ../AutoSequence/schema
//   版本要求：core/twin/automation-schema.lock.json——RELEASE 與「協定相關的 schema」（SCHEMA_DIRS 的 *.schema.json，換行統一後的 SHA-256）。
//   只鎖協定（使用者 2026-11-11 拍板）：AutoSequence 新增其他 schema（例 twin-model）、改產生碼或工具不擋；產生碼行為的變化由 core 的 twin 測試把關。
//   AutoSequence 的 commit 只做紀錄（HEAD 隨它每次提交改變）。不符時拒絕，除非 --schema-unlocked（開發期，只印警告）
//
//   node core/tools/twin-schema.mjs [--schema-repo <路徑>] [--schema-unlocked]     # 檢查並印出結果
//   node core/tools/twin-schema.mjs --write-lock [--schema-repo <路徑>]             # 確認相容（twin 檢查通過）後由主 session 更新 lock 檔
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './projects.mjs';

export const LOCK_FILE = join(REPO, 'core', 'twin', 'automation-schema.lock.json');
export const ENV = 'SPE_AUTOMATION_SCHEMA';
export const DEFAULT_DIR = join(REPO, '..', 'AutoSequence', 'schema');
// 協定相關的 schema：Twin Protocol、MD，以及兩者 $ref 的 common
export const SCHEMA_DIRS = ['schemas/twin-protocol/v2', 'schemas/machine-description/v2', 'schemas/common/v2'];

export class SchemaError extends Error {}

export function locateSchemaRepo({ repo = null } = {}) {
  return resolve(repo || process.env[ENV] || DEFAULT_DIR);
}

// 換行統一成 LF 再算（不同機器的 git autocrlf 設定不影響判定）
const sha256 = file => createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const schemaFiles = dir => SCHEMA_DIRS.flatMap(d => (existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter(f => f.endsWith('.schema.json')).sort().map(f => `${d}/${f}`) : []));
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const releaseOf = dir => /export const RELEASE = "([^"]+)"/.exec(readFileSync(join(dir, 'generated', 'js', 'constants.mjs'), 'utf8'))?.[1] ?? null;
const headOf = dir => { try { return git(dir, ['rev-parse', 'HEAD']); } catch { return null; } };
export const readLock = () => JSON.parse(readFileSync(LOCK_FILE, 'utf8'));

// 檢查並載入：通過時回傳 { dir, schema（generated/js/index.mjs 的模組）, release, commit, unlocked, warnings }；不符時丟出 SchemaError（訊息含要求、實際與修正方式）
export async function loadSchema({ repo = null, unlocked = false, lock = null } = {}) {
  const dir = locateSchemaRepo({ repo });
  const index = join(dir, 'generated', 'js', 'index.mjs');
  if (!existsSync(index)) throw new SchemaError(`找不到孿生用 schema：${dir}（缺 generated/js/index.mjs）。用 --schema-repo 或環境變數 ${ENV} 指定，或在 SPE 旁邊 checkout AutoSequence（預設 ${DEFAULT_DIR}）`);
  lock = lock || readLock();
  const warnings = [];
  const commit = headOf(dir);
  if (!commit) warnings.push('不是 git 工作樹（只以檔案雜湊確認內容）');
  const problems = [];
  const release = releaseOf(dir);
  if (!lock.release) problems.push(`要求的 release 還沒設定（lock 檔還沒填：${LOCK_FILE}）；確認相容後執行 node core/tools/twin-schema.mjs --write-lock`);
  else {
    if (release !== lock.release) problems.push(`RELEASE 是 ${release}，要求 ${lock.release}`);
    if (commit) {
      const dirty = git(dir, ['status', '--porcelain', '--', ...SCHEMA_DIRS]);
      if (dirty) problems.push(`${SCHEMA_DIRS.join('、')} 有未提交的修改：\n${dirty}`);
    }
    for (const [name, hash] of Object.entries(lock.files || {})) {
      const f = join(dir, name);
      if (!existsSync(f)) problems.push(`缺 ${name}`);
      else if (sha256(f) !== hash) problems.push(`${name} 的 SHA-256 與 lock 檔不符（協定或 MD schema 改了）`);
    }
    for (const name of schemaFiles(dir)) if (!Object.hasOwn(lock.files || {}, name)) problems.push(`新增了 ${name}（lock 檔沒有）`);
  }
  if (problems.length) {
    const text = `孿生用 schema 版本不符（${dir}）：要求 ${lock.release || '未設定'}${lock.commit ? `（鎖定時 ${lock.source || 'AutoSequence'} ${String(lock.commit).slice(0, 7)}）` : ''}，實際 ${release}${commit ? `（${commit.slice(0, 7)}）` : ''}\n- ${problems.join('\n- ')}` +
      '\n修正：AutoSequence 改了協定或 MD schema 時，先以 --schema-unlocked 跑 core 的 twin 檢查確認相容，再執行 node core/tools/twin-schema.mjs --write-lock 更新 lock 檔';
    if (!unlocked) throw new SchemaError(text);
    warnings.push(`--schema-unlocked：略過版本要求（不得用於聯調驗收）\n${text}`);
  }
  const schema = await import(pathToFileURL(index).href);
  if (!unlocked && schema.RELEASE !== lock.release) throw new SchemaError(`載入後的 RELEASE ${schema.RELEASE} 與要求 ${lock.release} 不符`);
  return { dir, schema, release: schema.RELEASE, commit, unlocked, warnings };
}

// 找得到就載入，找不到回傳 null（CI 沒有 AutoSequence 時，需要它的檢查明確印「略過」；Q-22 = A）
export async function loadSchemaIfPresent(opts = {}) {
  const dir = locateSchemaRepo(opts);
  if (!existsSync(join(dir, 'generated', 'js', 'index.mjs'))) return null;
  return loadSchema({ ...opts, unlocked: opts.unlocked ?? true });
}

// 以目前的內容算出 lock（release、協定 schema 雜湊；commit 只做紀錄）；要鎖的路徑不得有未提交的修改
export function lockFor({ repo = null } = {}) {
  const dir = locateSchemaRepo({ repo });
  if (!existsSync(join(dir, 'generated', 'js', 'index.mjs'))) throw new SchemaError(`找不到孿生用 schema：${dir}`);
  const commit = headOf(dir);
  if (commit) {
    const dirty = git(dir, ['status', '--porcelain', '--', ...SCHEMA_DIRS]);
    if (dirty) throw new SchemaError(`${dir} 的 ${SCHEMA_DIRS.join('、')} 有未提交的修改，不能鎖定：\n${dirty}`);
  }
  const files = {};
  for (const name of schemaFiles(dir)) files[name] = sha256(join(dir, name));
  if (!Object.keys(files).length) throw new SchemaError(`${dir} 沒有協定 schema（${SCHEMA_DIRS.join('、')}）`);
  const note = '孿生用 schema 的版本要求（只放版本與雜湊，不放產生碼）。來源是 AutoSequence repo 的 schema/（2026-11-11 起；原 Automation-Schema v2.0.0-preview.3）。只鎖 RELEASE 與協定相關的 schema（換行統一後的 SHA-256）；commit 只做紀錄。更新：node core/tools/twin-schema.mjs --write-lock';
  return { note, source: 'AutoSequence/schema', release: releaseOf(dir), commit, lockedAt: new Date().toISOString().slice(0, 10), files };
}

export function writeLock(opts = {}) {
  const lock = lockFor(opts);
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  try {
    if (argv.includes('--write-lock')) { const lock = writeLock({ repo: opt('--schema-repo') }); console.log(`已寫入 ${LOCK_FILE}：RELEASE ${lock.release}、${Object.keys(lock.files).length} 個協定 schema${lock.commit ? `（${lock.commit.slice(0, 7)}）` : ''}`); }
    else {
      const r = await loadSchema({ repo: opt('--schema-repo'), unlocked: argv.includes('--schema-unlocked') });
      for (const w of r.warnings) console.warn('! ' + w);
      console.log(`孿生用 schema：${r.dir}，RELEASE ${r.release}${r.commit ? `，${r.commit.slice(0, 7)}` : ''}${r.unlocked ? '（未鎖定）' : ''}`);
    }
  } catch (e) { console.error(e instanceof SchemaError ? e.message : e); process.exit(1); }
}
