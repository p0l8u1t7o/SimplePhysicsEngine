// 用戶名稱檢查：子專案的任何產出都不得出現用戶（客戶）名稱，即使規格檔或提示詞裡有（使用者 2026-10-04 拍板）。
// 名單只放本機、不進版控（名單本身就是不能公開的名稱）：
//   本庫：<庫>/.private/client-names.txt；studio 工作區：<工作區>/.studio/client-names.txt（vs3d 會寫入）
//   一行一個名稱，# 開頭是註解；也可以用環境變數 CLIENT_NAMES（以逗號分隔）補充。沒有名單時檢查直接通過。
//   node core/tools/check-names.mjs --staged         pre-commit：掃要提交的檔案內容與檔名
//   node core/tools/check-names.mjs <檔案或資料夾…>   直接掃描（check.mjs 的 names 檢查用）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, WORKSPACE } from './projects.mjs';

export function clientNames() {
  const files = [join(REPO, '.private', 'client-names.txt'), ...(WORKSPACE ? [join(WORKSPACE, '.studio', 'client-names.txt')] : [])];
  const names = files.filter(existsSync).flatMap(f => readFileSync(f, 'utf8').split(/\r?\n/));
  names.push(...(process.env.CLIENT_NAMES || '').split(','));
  return [...new Set(names.map(s => s.trim()).filter(s => s && !s.startsWith('#')))];
}

const SKIP = new Set(['.git', '.private', 'node_modules', 'docs', 'TEMP', '.studio', 'dist', 'logs']);
const BINARY = /\.(png|jpe?g|webp|gif|mp4|mov|glb|bin|exe|zip|pdf|xlsx?|pptx?|docx?|ico|woff2?)$/i;
function* walk(p) {
  const st = statSync(p);
  if (st.isFile()) { yield p; return; }
  for (const d of readdirSync(p, { withFileTypes: true })) if (!SKIP.has(d.name)) yield* walk(join(p, d.name));
}

// 回傳 [{ file, line, name }]；檔名本身含名稱也算
export function scan(paths, names = clientNames(), readText = f => readFileSync(f, 'utf8')) {
  const hits = [];
  if (!names.length) return hits;
  for (const f of paths) {
    for (const n of names) if (f.includes(n)) hits.push({ file: f, line: 0, name: n });
    if (BINARY.test(f)) continue;
    let text; try { text = readText(f); } catch { continue; }
    if (text == null) continue;
    text.split('\n').forEach((l, i) => { for (const n of names) if (l.includes(n)) hits.push({ file: f, line: i + 1, name: n }); });
  }
  return hits;
}
export const scanDirs = (dirs, names = clientNames()) => scan(dirs.filter(existsSync).flatMap(d => [...walk(d)]), names);

// 名稱只顯示第一個字（輸出也不要把名稱完整印出來）
const mask = n => n[0] + '○'.repeat(Math.max(1, n.length - 1));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), names = clientNames();
  let hits;
  if (argv.includes('--staged')) {
    const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
    hits = scan(files, names, f => execFileSync('git', ['show', ':' + f], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }));
  } else hits = scanDirs(argv.length ? argv : [REPO], names);
  if (!names.length) { console.log('用戶名稱檢查：沒有名單（.private/client-names.txt），略過'); process.exit(0); }
  for (const h of hits.slice(0, 40)) console.log(`✗ ${relative(REPO, h.file) || h.file}${h.line ? ':' + h.line : '（檔名）'} 出現用戶名稱 ${mask(h.name)}`);
  console.log(hits.length ? `用戶名稱檢查：${hits.length} 處出現用戶名稱，請改成中性描述（名單 ${names.length} 個）` : `用戶名稱檢查：通過（名單 ${names.length} 個）`);
  process.exit(hits.length ? 1 : 0);
}
