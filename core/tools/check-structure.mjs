// 結構檢查：不管專案是哪個工具做的（vs3d、Claude Code、Codex 或其他代理），都要符合開發架構，才能過 check 與 PR。
//   node core/tools/check-structure.mjs [專案…]
//   node core/tools/check-structure.mjs --staged      pre-commit：只檢查這次提交到的站
// check.mjs 的內建項目 structure 用同一個函式（快速）。
// 檢查項目（new-project.mjs 由 core/template 帶出的檔案與慣例）：
//   project.json  合法 JSON，有 title、summary，coreVersion 是語意化版本、不超過 core/VERSION
//   規則檔        AGENTS.md（各站規則）、CLAUDE.md 引用 @AGENTS.md
//   寫檔關卡      .claude/settings.json 掛 scope-guard.mjs（只有本庫；studio 工作區另外掛關卡）
//   docs/         不進版控（git check-ignore）
//   網頁          web/ 底下每個 HTML 都連 ../core/favicon.svg；有 importmap 的頁面用 @core/ 指到 ../core/
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { CORE, REPO, ROOT, WORKSPACE, PROJECTS_DIR, pickProjects } from './projects.mjs';

const SEMVER = /^\d+\.\d+\.\d+$/;
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const htmlFiles = d => !existsSync(d) ? [] : readdirSync(d).flatMap(n => { const f = join(d, n); return statSync(f).isDirectory() ? htmlFiles(f) : n.endsWith('.html') ? [f] : []; });

// 回傳問題清單（空陣列＝通過），每項附修正方式
export function checkStructure(p) {
  const out = [], has = f => existsSync(join(p.dir, f)), read = f => readFileSync(join(p.dir, f), 'utf8');
  const fix = 'new-project.mjs 由 core/template 帶出';

  if (!has('project.json')) out.push(`缺 project.json（首頁說明與檢查設定；studio 也靠它列出本站）：${fix}`);
  else {
    let pj = null;
    try { pj = JSON.parse(read('project.json')); } catch (e) { out.push(`project.json 不是合法 JSON：${e.message}`); }
    if (pj) {
      for (const k of ['title', 'summary']) if (typeof pj[k] !== 'string' || !pj[k].trim()) out.push(`project.json 缺 ${k}（首頁卡片的標題與一句說明）`);
      const core = readFileSync(join(CORE, 'VERSION'), 'utf8').trim();
      if (!SEMVER.test(String(pj.coreVersion || ''))) out.push(`project.json 的 coreVersion 要是語意化版本（目前 core ${core}；記錄最後一次驗證通過的 core 版本）`);
      else if (cmpVer(pj.coreVersion, core) > 0) out.push(`project.json 的 coreVersion ${pj.coreVersion} 比 core/VERSION ${core} 新`);
      if (pj.checks && (typeof pj.checks !== 'object' || [pj.checks.quick, pj.checks.full].some(v => v !== undefined && !Array.isArray(v)))) out.push('project.json 的 checks.quick／checks.full 要是陣列');
    }
  }

  if (!has('AGENTS.md')) out.push(`缺 AGENTS.md（本站規格摘要與已拍板事項，Codex 與 Claude Code 都會讀）：${fix}`);
  if (!has('CLAUDE.md')) out.push('缺 CLAUDE.md（內容只有一行 @AGENTS.md，讓 Claude Code 讀到同一份規則）');
  else if (!/^@AGENTS\.md\s*$/m.test(read('CLAUDE.md'))) out.push('CLAUDE.md 要引用 @AGENTS.md（規則只寫在 AGENTS.md 一份）');

  if (!WORKSPACE) {
    const s = '.claude/settings.json';
    if (!has(s)) out.push(`缺 ${s}（Claude Code 寫檔關卡，擋下寫到本站外的檔案）：${fix}`);
    else if (!read(s).includes('scope-guard.mjs')) out.push(`${s} 沒有掛 core/tools/scope-guard.mjs（PreToolUse 寫檔關卡）`);
  }

  // docs/：使用者給的圖面、照片、影片與規劃資料只留本機
  const g = spawnSync('git', ['check-ignore', '-q', 'docs/x'], { cwd: p.dir, windowsHide: true });
  if (g.status === 1) out.push(`docs/ 沒有被 git 忽略：在根目錄 .gitignore 加 /${PROJECTS_DIR}/${p.id}/docs/（或專案的 .gitignore 加 docs/）`);

  const pages = htmlFiles(p.web);
  if (!pages.length) out.push('web/ 底下沒有 HTML 頁面');
  for (const f of pages) {
    const s = readFileSync(f, 'utf8'), rel = relative(p.dir, f).replace(/\\/g, '/'), up = '../'.repeat(rel.split('/').length - 2);
    if (!/<link[^>]+rel=["']icon["'][^>]*core\/favicon\.svg/.test(s) && !/<link[^>]+core\/favicon\.svg[^>]*rel=["']icon["']/.test(s)) out.push(`${rel} 沒有連 ${up}../core/favicon.svg（<link rel="icon" href="${up}../core/favicon.svg" type="image/svg+xml">）`);
    const map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(s)?.[1];
    if (map && !/"@core\/"\s*:\s*"(\.\.\/)+core\/"/.test(map)) out.push(`${rel} 的 importmap 要有 "@core/": "${up}../core/"（共用框架只引用一份，不要複製）`);
  }
  return out;
}

// 專案根目錄底下不會被 check.mjs、首頁、studio 看到的資料夾（沒有 web/index.html）
export function strayFolders() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !existsSync(join(ROOT, d.name, 'web', 'index.html'))).map(d => d.name);
}

// --staged（pre-commit）：只檢查這次提交到的站；站被整個刪掉的不算
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), staged = argv.includes('--staged');
  let names = argv.filter(a => !a.startsWith('--'));
  if (staged) {
    if (WORKSPACE) process.exit(0);
    const files = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter(Boolean);
    names = [...new Set(files.filter(f => f.startsWith(PROJECTS_DIR + '/')).map(f => f.split('/')[1]))].filter(n => existsSync(join(ROOT, n)));
    if (!names.length) process.exit(0);
  }
  let bad = 0;
  const stray = strayFolders().filter(n => !staged || names.includes(n));
  if (!argv.some(a => !a.startsWith('--')) || staged) for (const n of stray) { bad++; console.log(`✗ ${PROJECTS_DIR}/${n}：沒有 web/index.html，check.mjs、首頁與 studio 都看不到（用 new-project.mjs 建立）`); }
  for (const p of pickProjects(names.filter(n => !stray.includes(n)))) {
    const r = checkStructure(p);
    if (r.length) bad++;
    if (!staged || r.length) console.log(`${r.length ? '✗' : '✓'} ${p.id}${r.length ? '' : '  結構通過'}`);
    for (const x of r) console.log('     ' + x);
  }
  if (staged) console.log(bad ? `結構檢查：${bad} 個站不符開發架構（說明見 AGENTS.md；新站用 new-project.mjs 建立）` : `結構檢查：通過（${names.length} 個站）`);
  process.exit(bad ? 1 : 0);
}
