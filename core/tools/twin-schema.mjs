// Automation-Schema 的定位與版本檢查（SPE 孿生開發計畫 4.1 設計要點 16；Q-06 = C：執行時讀相鄰的 repo，不複製進 SPE）。
// twin.mjs、core/twin 的測試與 check.mjs 的 twin 檢查共用。只讀該 repo：不修改、不複製任何檔案，git 只執行 rev-parse 與 status。
//
//   路徑優先序：--schema-repo <路徑> → 環境變數 SPE_AUTOMATION_SCHEMA → SPE 根目錄的上一層 ../Automation-Schema
//   版本要求：core/twin/automation-schema.lock.json（tag、commit、generated/js 各檔 SHA-256）；未填時拒絕，除非 --schema-unlocked（開發期，只印警告）
//
//   node core/tools/twin-schema.mjs [--schema-repo <路徑>] [--schema-unlocked]     # 檢查並印出結果
//   node core/tools/twin-schema.mjs --write-lock <tag> [--schema-repo <路徑>]       # Automation-Schema 發版後由主 session 填 lock 檔
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './projects.mjs';

export const LOCK_FILE = join(REPO, 'core', 'twin', 'automation-schema.lock.json');
export const ENV = 'SPE_AUTOMATION_SCHEMA';
const WATCHED = ['generated/js', 'schemas/twin-protocol/v2', 'schemas/machine-description/v2'];

export class SchemaError extends Error {}

export function locateSchemaRepo({ repo = null } = {}) {
  const raw = repo || process.env[ENV] || join(REPO, '..', 'Automation-Schema');
  return resolve(raw);
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const releaseOf = dir => /export const RELEASE = "([^"]+)"/.exec(readFileSync(join(dir, 'generated', 'js', 'constants.mjs'), 'utf8'))?.[1] ?? null;
export const readLock = () => JSON.parse(readFileSync(LOCK_FILE, 'utf8'));

// 檢查並載入：通過時回傳 { dir, schema（generated/js/index.mjs 的模組）, release, commit, unlocked, warnings }；不符時丟出 SchemaError（訊息含要求、實際與修正指令）
export async function loadSchema({ repo = null, unlocked = false, lock = null } = {}) {
  const dir = locateSchemaRepo({ repo });
  const index = join(dir, 'generated', 'js', 'index.mjs');
  if (!existsSync(index)) throw new SchemaError(`找不到 Automation-Schema：${dir}（缺 generated/js/index.mjs）。用 --schema-repo 或環境變數 ${ENV} 指定，或在 SPE 旁邊 checkout：git clone <Automation-Schema> "${join(REPO, '..', 'Automation-Schema')}"`);
  lock = lock || readLock();
  const warnings = [];
  let commit = null;
  try { commit = git(dir, ['rev-parse', 'HEAD']); } catch { warnings.push('不是 git 工作樹（只以檔案雜湊確認內容）'); }
  const fix = lock.tag ? `git -C "${dir}" fetch --tags && git -C "${dir}" checkout ${lock.tag}` : '';
  const problems = [];
  if (!lock.tag || !lock.commit) problems.push(`要求的 tag／commit 還沒設定（lock 檔還沒填：${LOCK_FILE}）；Automation-Schema 發版後執行 node core/tools/twin-schema.mjs --write-lock <tag>`);
  else {
    if (commit && commit !== lock.commit) problems.push(`HEAD 是 ${commit}，要求 ${lock.tag}（${lock.commit}）`);
    if (commit) {
      const dirty = git(dir, ['status', '--porcelain', '--', ...WATCHED]);
      if (dirty) problems.push(`${WATCHED.join('、')} 有未提交的修改：\n${dirty}`);
    }
    for (const [name, hash] of Object.entries(lock.files || {})) {
      const f = join(dir, 'generated', 'js', name);
      if (!existsSync(f)) problems.push(`缺 generated/js/${name}`);
      else if (sha256(f) !== hash) problems.push(`generated/js/${name} 的 SHA-256 與 lock 檔不符`);
    }
    const release = releaseOf(dir);
    if (release !== lock.tag.replace(/^v/, '')) problems.push(`RELEASE 是 ${release}，要求 ${lock.tag.replace(/^v/, '')}`);
  }
  if (problems.length) {
    const want = lock.tag ? `${lock.tag}（${String(lock.commit).slice(0, 7)}）` : '未設定';
    const text = `Automation-Schema 版本不符（${dir}）：要求 ${want}，實際 ${releaseOf(dir)}${commit ? `（${commit.slice(0, 7)}）` : ''}\n- ${problems.join('\n- ')}${fix ? `\n修正：${fix}` : ''}`;
    if (!unlocked) throw new SchemaError(text);
    warnings.push(`--schema-unlocked：略過版本要求（不得用於聯調驗收）\n${text}`);
  }
  const schema = await import(pathToFileURL(index).href);
  if (!unlocked && schema.RELEASE !== lock.tag.replace(/^v/, '')) throw new SchemaError(`載入後的 RELEASE ${schema.RELEASE} 與要求不符`);
  return { dir, schema, release: schema.RELEASE, commit, unlocked, warnings };
}

// 找得到就載入，找不到回傳 null（CI 沒有 Automation-Schema 時，需要它的檢查明確印「略過」；Q-22 = A）
export async function loadSchemaIfPresent(opts = {}) {
  const dir = locateSchemaRepo(opts);
  if (!existsSync(join(dir, 'generated', 'js', 'index.mjs'))) return null;
  return loadSchema({ ...opts, unlocked: opts.unlocked ?? true });
}

// 依 tag 算出 lock 內容（HEAD 必須就是該 tag）
export function lockFor(tag, { repo = null } = {}) {
  const dir = locateSchemaRepo({ repo });
  const commit = git(dir, ['rev-parse', `${tag}^{commit}`]);
  if (git(dir, ['rev-parse', 'HEAD']) !== commit) throw new SchemaError(`${dir} 的 HEAD 不是 ${tag}；先 git -C "${dir}" checkout ${tag}`);
  const files = {};
  for (const name of readdirSync(join(dir, 'generated', 'js')).sort()) if (/\.(mjs|d\.ts)$/.test(name)) files[name] = sha256(join(dir, 'generated', 'js', name));
  return { ...readLock(), tag, commit, files };
}

export function writeLock(tag, opts = {}) {
  const lock = lockFor(tag, opts);
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  try {
    if (argv.includes('--write-lock')) { const lock = writeLock(opt('--write-lock'), { repo: opt('--schema-repo') }); console.log(`已寫入 ${LOCK_FILE}：${lock.tag} ${lock.commit}`); }
    else {
      const r = await loadSchema({ repo: opt('--schema-repo'), unlocked: argv.includes('--schema-unlocked') });
      for (const w of r.warnings) console.warn('! ' + w);
      console.log(`Automation-Schema：${r.dir}，RELEASE ${r.release}${r.commit ? `，${r.commit.slice(0, 7)}` : ''}${r.unlocked ? '（未鎖定）' : ''}`);
    }
  } catch (e) { console.error(e instanceof SchemaError ? e.message : e); process.exit(1); }
}
