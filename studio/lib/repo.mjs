// 本庫模式的 git 操作（計畫書 4.10）。使用者也在同一個工作目錄改檔，所以：
//   - 絕不執行 checkout／restore／stash／reset --hard／clean；回滾一律「逐檔寫回」（git show <commit>:<路徑> 的內容寫回檔案）。
//   - 只 add／commit 該專案路徑（pathspec `.`，工作目錄是專案資料夾），不會把使用者在其他路徑的改動帶進來。
//   - 開工時目標專案有未提交的改動就拒絕開始；每次指令開一個本機分支 <範圍>/vs3d-<日期時間>（從目前的 HEAD，不動檔案）。
//   - 專案外被改動只偵測、不自動還原（分不出是代理還是使用者同時在改），停下來讓使用者確認。
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { git, sha1, hashTree } from './util.mjs';

const GIT_ID = ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost'];
// 專案裡 app 自己的東西：不算使用者的改動、不進版控
const APP_AREA = /^(\.studio|TEMP|docs)(\/|$)/;
export const slugOf = id => id.toLowerCase().replace(/\s+/g, '-');
export const prefix = J => git(J.dir, ['rev-parse', '--show-prefix']).trim();          // 例如 project-site/RecycleSorter/
export const branch = J => git(J.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
export const head = J => git(J.dir, ['rev-parse', 'HEAD']).trim();

// 專案路徑下的變更（相對於專案資料夾）：[{ code, path }]
export function changes(J) {
  const pre = prefix(J);
  return git(J.dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']).split('\0').filter(Boolean)
    .map(l => ({ code: l.slice(0, 2), path: l.slice(3) })).filter(c => c.path.startsWith(pre))
    .map(c => ({ ...c, path: c.path.slice(pre.length) })).filter(c => !APP_AREA.test(c.path));
}

// 開工檢查＋開分支：目前已經在本專案的 vs3d 分支上就沿用
export function beginFlow(J, label) {
  const dirty = changes(J);
  if (dirty.length) throw new Error(`本庫的 ${J.id} 有未提交的改動（${dirty.slice(0, 5).map(c => c.path).join('、')}${dirty.length > 5 ? '…' : ''}），請先自行提交或處理後再開始`);
  const cur = branch(J), slug = slugOf(J.id);
  if (cur.startsWith(`${slug}/vs3d-`)) return cur;
  const d = new Date(), stamp = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `${slug}/vs3d-${label}-${stamp}`;
  git(J.dir, ['switch', '-q', '-c', name]);        // 從目前的 HEAD 開新分支：不改任何檔案，未提交的其他改動照樣留著
  return name;
}

// review JSON 只有時間或耗時變動的，寫回 HEAD 的內容（本庫慣例：不提交）
const VOLATILE = new Set(['date', 'at', 'startedAt', 'finishedAt', 'generated', 'seconds', 'sourceHash']);
const strip = v => Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, strip(x)])) : v;
function revertTimestampOnly(J) {
  const pre = prefix(J);
  for (const c of changes(J)) {
    if (!/^review\/.+\.json$/.test(c.path) || c.code.includes('?')) continue;
    try {
      const old = git(J.dir, ['show', `HEAD:${pre}${c.path}`]), cur = readFileSync(join(J.dir, c.path), 'utf8');
      if (JSON.stringify(strip(JSON.parse(old))) === JSON.stringify(strip(JSON.parse(cur)))) writeFileSync(join(J.dir, c.path), old);
    } catch { /* 不是 JSON 或 HEAD 沒有：照常提交 */ }
  }
}

// 只提交專案路徑；沒有變更時回傳 null
export function commitProject(J, message) {
  revertTimestampOnly(J);
  if (!changes(J).length) return null;
  git(J.dir, ['add', '-A', '--', '.']);
  git(J.dir, [...GIT_ID, 'commit', '-q', '-m', message, '--', '.']);
  return git(J.dir, ['rev-parse', '--short', 'HEAD']).trim();
}

// 逐檔寫回：把專案路徑下的 rel 寫回成 commit 時的內容（commit 沒有這個檔就刪除）
export function writeBack(J, commit, rel) {
  const pre = prefix(J), file = join(J.dir, rel);
  let content = null;
  try { content = git(J.dir, ['show', `${commit}:${pre}${rel}`], { encoding: 'buffer' }); } catch { /* 該 commit 沒有這個檔 */ }
  if (content == null) { rmSync(file, { force: true }); return 'deleted'; }
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); return 'restored';
}

// 回到 base 的內容：只寫回「代理在 base 之後改過、而且目前工作目錄仍等於 HEAD」的檔案；使用者之後又改過的留著並回報
export function revertToCommit(J, base, message) {
  const pre = prefix(J), skipped = [];
  const files = git(J.dir, ['diff', '--name-only', '-z', base, 'HEAD', '--', '.']).split('\0').filter(Boolean).map(p => p.slice(pre.length)).filter(p => !APP_AREA.test(p));
  for (const rel of files) {
    let atHead = null; try { atHead = git(J.dir, ['show', `HEAD:${pre}${rel}`], { encoding: 'buffer' }); } catch { /* HEAD 沒有 */ }
    const now = existsSync(join(J.dir, rel)) ? readFileSync(join(J.dir, rel)) : null;
    const same = (atHead == null && now == null) || (atHead && now && sha1(atHead) === sha1(now));
    if (!same) { skipped.push(rel); continue; }
    writeBack(J, base, rel);
  }
  return { commit: commitProject(J, message), files: files.length, skipped };
}

// 專案外的保護：本庫追蹤中的檔案（不含本專案、各站 TEMP/docs/.studio、studio/ui/dist、node_modules）
const SKIP_OUTSIDE = (pre) => r => r.startsWith(pre) || /^(\.git|TEMP|logs|\.private|node_modules)(\/|$)/.test(r) || /^project-site\/[^/]+\/(TEMP|docs|\.studio)(\/|$)/.test(r) || /^studio\/ui\/(dist|node_modules)(\/|$)/.test(r) || /(^|\/)node_modules(\/|$)/.test(r);
export function snapshotOutside(J) {
  const root = J.ws, pre = prefix(J);
  return { pre, files: hashTree(root, SKIP_OUTSIDE(pre)) };
}
export function diffOutside(J, before) {
  const after = hashTree(J.ws, SKIP_OUTSIDE(before.pre)), out = [];
  for (const k of new Set([...Object.keys(before.files), ...Object.keys(after)])) if (before.files[k] !== after[k]) out.push({ area: '本庫（專案外）', path: k, change: !(k in after) ? 'deleted' : !(k in before.files) ? 'added' : 'modified', restored: false });
  return out;
}
