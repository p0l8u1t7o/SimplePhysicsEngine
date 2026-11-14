// 本庫模式的 git 操作（計畫書 4.10）。使用者也在同一個工作目錄改檔，所以：
//   - 絕不執行 checkout／restore／stash／reset --hard／clean；回滾一律「逐檔寫回」（git show <commit>:<路徑> 的內容寫回檔案）。
//   - 只 add／commit 該專案路徑（pathspec `.`，工作目錄是專案資料夾），不會把使用者在其他路徑的改動帶進來。
//   - 開工時目標專案有未提交的改動就拒絕開始；每次指令開一個本機分支 <範圍>/vs3d-<日期時間>（從目前的 HEAD，不動檔案）。
//   - 專案外被改動只偵測、不自動還原（分不出是代理還是使用者同時在改），停下來讓使用者確認。
//   - 併改偵測：代理執行中使用者也改了代理改的檔案時，這一輪不提交、轉成提問（createEditTracker，lib/loop.mjs 的 round）。
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { git, sha1, hashTree, walk } from './util.mjs';

const GIT_ID = ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost'];
// 專案裡 app 自己的東西：不算使用者的改動、不進版控
const APP_AREA = /^(\.studio|TEMP|docs)(\/|$)/;
export const slugOf = id => id.toLowerCase().replace(/\s+/g, '-');
export const prefix = J => git(J.dir, ['rev-parse', '--show-prefix']).trim();          // 例如 project-site/RecycleSorter/
export const branch = J => git(J.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
export const head = J => git(J.dir, ['rev-parse', 'HEAD']).trim();

// git status --porcelain=v1 -z 的輸出 → [{ code, path, from? }]。改名（R）與複製（C）的下一筆是原路徑：記在 from，不當成另一個檔
export function parseStatusZ(out) {
  const rows = String(out).split('\0'), list = [];
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i]; if (!l) continue;
    const c = { code: l.slice(0, 2), path: l.slice(3) };
    if (/^[RC]/.test(c.code) && i + 1 < rows.length) c.from = rows[++i];
    list.push(c);
  }
  return list;
}

// 專案路徑下的變更（相對於專案資料夾）：[{ code, path, from? }]（from 是改名前的路徑，同樣相對於專案資料夾）
export function changes(J) {
  const pre = prefix(J);
  return parseStatusZ(git(J.dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'])).filter(c => c.path.startsWith(pre))
    .map(c => ({ ...c, path: c.path.slice(pre.length), ...(c.from?.startsWith(pre) ? { from: c.from.slice(pre.length) } : {}) }))
    .filter(c => !APP_AREA.test(c.path));
}

// 本庫所有站的未提交改動（介面清單用，一次 git status）：{ 站名: [相對於該站的路徑] }；別的工具（Claude Code、Codex 桌面版等）改過但還沒提交的會列在這裡
export function stationChanges(repoRoot, dir = 'project-site') {
  const out = {};
  for (const c of parseStatusZ(git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', dir]))) {
    const m = c.path.match(new RegExp(`^${dir}/([^/]+)/(.+)$`));
    if (m && !APP_AREA.test(m[2])) (out[m[1]] ||= []).push(m[2]);
  }
  return out;
}

const stamp = (d = new Date()) => `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
// 本庫模式的 new（開發機，2026-11-14）：站還不存在，從本庫根目錄開分支 <站>/vs3d-new-<月日-時分>（不改任何檔案）
export function beginNewSiteBranch(root, id) {
  const name = `${slugOf(id)}/vs3d-new-${stamp()}`;
  git(root, ['switch', '-q', '-c', name]);
  return name;
}
// 開工檢查＋開分支：目前已經在本專案的 vs3d 分支上就沿用
export function beginFlow(J, label) {
  const dirty = changes(J);
  if (dirty.length) throw new Error(`本庫的 ${J.id} 有未提交的改動（${dirty.slice(0, 5).map(c => c.path).join('、')}${dirty.length > 5 ? '…' : ''}），請先自行提交或處理後再開始`);
  const cur = branch(J), slug = slugOf(J.id);
  if (cur.startsWith(`${slug}/vs3d-`)) return cur;
  const name = `${slug}/vs3d-${label}-${stamp()}`;
  git(J.dir, ['switch', '-q', '-c', name]);        // 從目前的 HEAD 開新分支：不改任何檔案，未提交的其他改動照樣留著
  return name;
}

// review JSON 只有時間或耗時變動的，寫回 HEAD 的內容（本庫慣例：不提交）
// 和 core/tools/compare-review.py 同一套規則：at、date 只在頂層是執行時間；深層的 at 是事件時刻，屬於檢查結果
const VOLATILE = new Set(['startedAt', 'finishedAt', 'generated', 'seconds', 'sourceHash', 'ms']);
const VOLATILE_TOP = new Set(['date', 'at']);
const strip = (v, top = true) => Array.isArray(v) ? v.map(x => strip(x, false)) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k) && !(top && VOLATILE_TOP.has(k))).map(([k, x]) => [k, strip(x, false)])) : v;
// 某個 commit 裡的檔案內容，套用簽出時的轉換（core.autocrlf 等）；直接用 git show 寫回會變成 LF，git 會把它當成已修改
const checkoutContent = (J, rev, path) => git(J.dir, ['cat-file', '--filters', `${rev}:${path}`], { encoding: 'buffer' });
export function revertTimestampOnly(J) {
  const pre = prefix(J);
  for (const c of changes(J)) {
    if (!/^review\/.+\.json$/.test(c.path) || c.code.includes('?')) continue;
    try {
      const old = checkoutContent(J, 'HEAD', `${pre}${c.path}`), cur = readFileSync(join(J.dir, c.path), 'utf8');
      if (JSON.stringify(strip(JSON.parse(old.toString('utf8')))) === JSON.stringify(strip(JSON.parse(cur)))) writeFileSync(join(J.dir, c.path), old);
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
  try { content = checkoutContent(J, commit, `${pre}${rel}`); } catch { /* 該 commit 沒有這個檔 */ }
  if (content == null) { rmSync(file, { force: true }); return 'deleted'; }
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); return 'restored';
}

// 回到 base 的內容：只寫回「代理在 base 之後改過、而且目前工作目錄仍等於 HEAD」的檔案；使用者之後又改過的留著並回報
export function revertToCommit(J, base, message) {
  const pre = prefix(J), skipped = [];
  const files = git(J.dir, ['diff', '--name-only', '-z', base, 'HEAD', '--', '.']).split('\0').filter(Boolean).map(p => p.slice(pre.length)).filter(p => !APP_AREA.test(p));
  for (const rel of files) {
    // 比的是 git 的 blob id（工作目錄的檔案經過 clean 轉換再算），不是原始位元組：autocrlf=true 時工作目錄是 CRLF、blob 是 LF
    let atHead = null; try { atHead = git(J.dir, ['rev-parse', `HEAD:${pre}${rel}`]).trim(); } catch { /* HEAD 沒有 */ }
    const now = existsSync(join(J.dir, rel)) ? git(J.dir, ['hash-object', `--path=${rel}`, '--', rel]).trim() : null;
    const same = (atHead == null && now == null) || (atHead && now && atHead === now);
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

// ---------------------------------------------------------------- 併改偵測（2026-11-08）
// 代理執行中，使用者（或別的工具）也在改本站的檔案。用代理的工具事件（lib/adapters 的 tool／tool_result）分辨是誰改的：
//   - 寫檔工具（Claude 的 Write／Edit／MultiEdit／NotebookEdit、Codex 的 file_change）帶 paths：工具結束時記下那些檔案的內容＝代理寫的版本，
//     這些檔案算「代理改過」。
//   - 其他會動檔案的工具（shell、子代理…）：開始到結束之間的變動都算代理的，結束時重新記下全部檔案。
//   - 查核點：每個工具開始前（含 Read、Grep 這類只讀的）與這一輪結束時，和最後記下的內容不同、又不在代理動作中的檔案＝別人改的。
//   - 代理改過、也被別人改過的檔案＝併改：這一輪不提交、轉成提問（lib/loop.mjs）。
// 限制：代理的 shell 指令執行期間別人改的檔案會被算成代理的；代理只用 shell 改的檔案不算「代理改過」（別人也改了不會被當成併改）；
// Codex 的 file_change 是改完才送，代理寫之前別人改的抓不到。
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'WebFetch', 'WebSearch', 'BashOutput']);
const TRACK_SKIP = r => APP_AREA.test(r) || /(^|\/)(node_modules|\.git)$/.test(r);
export function createEditTracker(dir, { skip = TRACK_SKIP } = {}) {
  const cache = new Map();          // 相對路徑 → { m, s, h }：修改時間與大小沒變就不重算雜湊
  const scan = () => {
    const out = {};
    for (const r of walk(dir, skip)) {
      try {
        const f = join(dir, r), st = statSync(f), c = cache.get(r);
        // 最近 2 秒內改過的檔不信快取（檔案時間的解析度有限，同一個刻度內再改一次、大小又一樣時會看不出來；同 git 的 racy-clean 處理）
        if (c && c.m === st.mtimeMs && c.s === st.size && Date.now() - st.mtimeMs > 2000) { out[r] = c.h; continue; }
        const h = sha1(readFileSync(f)); cache.set(r, { m: st.mtimeMs, s: st.size, h }); out[r] = h;
      } catch { /* 走訪後被刪掉 */ }
    }
    return out;
  };
  let known = scan(), pendingEdits = [], anon = 0;
  const touched = new Set(), others = new Map(), pendingOpaque = new Set();      // others：別人改的檔 → 當時看到的內容
  const relOf = p => {
    const r = relative(dir, resolve(dir, String(p))).split(sep).join('/');
    return !r || r.startsWith('../') || r === '..' || isAbsolute(r) || skip(r) ? null : r;
  };
  const setKnown = (r, h) => { if (h === undefined) delete known[r]; else known[r] = h; };
  // 查核點：不在代理動作中的變動算別人的；except 是這次工具自己要寫的檔（事件可能比寫檔晚到）
  function checkpoint(except = []) {
    if (pendingOpaque.size) return;                  // 代理的指令還在跑：這段時間的變動算代理的
    const now = scan(), busy = new Set([...pendingEdits.flatMap(p => p.rels), ...except]);
    for (const k of new Set([...Object.keys(known), ...Object.keys(now)])) {
      if (known[k] === now[k] || busy.has(k)) continue;
      others.set(k, now[k]); setKnown(k, now[k]);
    }
  }
  // 代理的寫檔結束：記下代理寫的版本。事件比寫檔晚到時（輸出慢一點讀到），前一個查核點可能已經看到代理寫好的內容、誤記成別人改的；
  // 寫完的結果和當時看到的一樣，就是代理自己的改動，取消那筆（代理寫完後極短時間內又被別人改、而且事件還沒讀到的情況會漏掉）。
  function settle(rels) {
    const now = scan();
    for (const r of rels) { touched.add(r); if (others.has(r) && others.get(r) === now[r]) others.delete(r); setKnown(r, now[r]); }
  }
  return {
    on(e) {
      if (e?.kind === 'tool') {
        if (Array.isArray(e.paths)) {
          const rels = e.paths.map(relOf).filter(Boolean);
          checkpoint(rels);
          if (e.done) settle(rels); else pendingEdits.push({ id: e.id ?? null, rels });
        } else if (READ_ONLY_TOOLS.has(e.name)) checkpoint();
        else { checkpoint(); pendingOpaque.add(e.id ?? `anon-${++anon}`); }
      } else if (e?.kind === 'tool_result' && e.id != null) {
        const done = pendingEdits.filter(p => p.id === e.id);
        // 寫檔失敗（例如 Claude 的 Edit 發現檔案在讀過之後被改了）：代理沒寫，不記成代理的版本，留給下一個查核點判斷
        if (done.length) { pendingEdits = pendingEdits.filter(p => p.id !== e.id); if (e.ok !== false) settle(done.flatMap(p => p.rels)); }
        if (pendingOpaque.delete(e.id)) known = scan();
      }
    },
    // 這一輪結束：沒收到結束事件的寫檔與指令（例如中斷）都當成代理的，再做最後一次查核
    finish() {
      if (pendingEdits.length) { const rels = pendingEdits.flatMap(p => p.rels); pendingEdits = []; settle(rels); }
      if (pendingOpaque.size) { pendingOpaque.clear(); known = scan(); }
      checkpoint();
      return { conflicts: [...touched].filter(r => others.has(r)).sort(), others: [...others.keys()].filter(r => !touched.has(r)).sort(), touched: [...touched].sort() };
    },
  };
}
