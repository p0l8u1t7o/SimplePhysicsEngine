// 寫入隔離（計畫書 4.3 的第 2、3 層）：每輪開工前記下受保護路徑的雜湊，結束後比對；被改動就自動還原，並記為違規。
//   受保護：core/、core 還原副本、工作區規則檔與標記檔、其他專案（git 追蹤的檔案＋docs/）、工作區與 projects/ 的第一層項目
//   還原：core ← .studio/core-pristine/（副本也被改時 ← 本庫 core）；規則檔 ← studio/templates；
//         其他專案 ← 該專案自己的 git（開工前是乾淨的才還原，否則只記錄）
import { existsSync, readdirSync, readFileSync, rmSync, copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hashTree, sha1, git, readJson, SOURCE_CORE, STUDIO } from './util.mjs';
import { paths, setReadOnly } from './workspace.mjs';

const SKIP_PROJECT = r => /^(\.git|TEMP|\.studio)(\/|$)/.test(r);
const RULE_TEMPLATES = { 'AGENTS.md': 'workspace-AGENTS.md', 'CLAUDE.md': 'workspace-CLAUDE.md' };
const listDir = d => existsSync(d) ? readdirSync(d).sort() : [];
const fileHash = f => existsSync(f) ? sha1(readFileSync(f)) : null;

export function snapshot(ws, id) {
  const P = paths(ws);
  const others = listDir(P.projects).filter(n => n !== id && existsSync(join(P.projects, n, '.git'))).map(n => {
    const dir = join(P.projects, n);
    let clean = false; try { clean = git(dir, ['status', '--porcelain']).trim() === ''; } catch { /* 不是 git 庫 */ }
    return { id: n, dir, clean, files: hashTree(dir, SKIP_PROJECT) };
  });
  return {
    core: hashTree(P.core), pristine: hashTree(P.pristine),
    rules: Object.fromEntries(['AGENTS.md', 'CLAUDE.md', 'studio-workspace.json'].map(n => [n, fileHash(join(ws, n))])),
    top: listDir(ws), projectsTop: listDir(P.projects), others,
  };
}

const diffMaps = (a, b) => {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push({ path: k, change: !(k in b) ? 'deleted' : !(k in a) ? 'added' : 'modified' });
  return out;
};

// 比對並還原；回傳 { violations: [{ area, path, change, restored }] }
export function verifyAndRestore(ws, id, before) {
  const P = paths(ws), after = snapshot(ws, id), violations = [];

  // core 還原副本：被改就先用本庫 core 修好（版本相同時）
  const pd = diffMaps(before.pristine, after.pristine);
  if (pd.length) {
    const sameVersion = readFileSync(join(SOURCE_CORE, 'VERSION'), 'utf8').trim() === readJson(P.marker, {}).core;
    for (const d of pd) violations.push({ area: 'core 副本', ...d, restored: sameVersion && restoreFile(join(SOURCE_CORE, d.path), join(P.pristine, d.path), d.change) });
  }
  for (const d of diffMaps(before.core, after.core)) violations.push({ area: 'core', ...d, restored: restoreFile(join(P.pristine, d.path), join(P.core, d.path), d.change) });

  for (const [n, h] of Object.entries(before.rules)) if (after.rules[n] !== h) {
    const tpl = RULE_TEMPLATES[n];
    violations.push({ area: '工作區規則', path: n, change: 'modified', restored: tpl ? restoreFile(join(STUDIO, 'templates', tpl), join(ws, n), 'modified') : false });
  }

  for (const o of before.others) {
    const now = after.others.find(x => x.id === o.id);
    const d = now ? diffMaps(o.files, now.files) : [{ path: '', change: 'deleted' }];
    if (!d.length) continue;
    let restored = false;
    if (o.clean && now) try { git(o.dir, ['reset', '-q', '--hard']); git(o.dir, ['clean', '-fdq']); restored = diffMaps(o.files, hashTree(o.dir, SKIP_PROJECT)).length === 0; } catch { /* 留給使用者處理 */ }
    for (const x of d) violations.push({ area: `專案 ${o.id}`, ...x, restored });
  }

  for (const [area, a, b] of [['工作區', before.top, after.top], ['projects/', before.projectsTop, after.projectsTop]])
    for (const n of b.filter(x => !a.includes(x) && x !== id)) violations.push({ area, path: n, change: 'added', restored: false });

  if (violations.some(v => v.area === 'core')) setReadOnly(P.core);
  return { violations };
}

function restoreFile(src, dest, change) {
  try {
    if (existsSync(dest)) chmodSync(dest, 0o644);
    if (change === 'added') { rmSync(dest, { force: true }); return true; }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    chmodSync(dest, 0o444);
    return true;
  } catch { return false; }
}
