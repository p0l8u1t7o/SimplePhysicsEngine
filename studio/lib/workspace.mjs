// 工作區與專案的建立。
//   <工作區>/
//     studio-workspace.json   工作區標記（core 的 projects.mjs 看到它就改從 projects/ 找專案）
//     core/                   內附的 core（唯讀屬性）；.studio/core-pristine/ 是還原用的副本
//     AGENTS.md、CLAUDE.md    共通規則（唯讀）
//     projects/<專案>/         每個專案一個 git 庫；docs/、TEMP/、.studio/ 不進版控
// 本庫模式（計畫書 4.10）：ws 也可以是本庫根目錄（有 core/ 與 project-site/、沒有工作區標記），專案就是 project-site/<專案>/，
//   用本庫的 git（只動該專案路徑）、本庫目前的 core 與規則；app 自己的狀態放在 TEMP/studio/（鎖、設定、上傳）與各專案的 .studio/。
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, copyFileSync, renameSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { SOURCE_CORE, STUDIO, git, readJson, writeJson, writeText, walk, now, run } from './util.mjs';
import { DEFAULT_STUDIO_JSON } from './roles.mjs';
import { extractUploads } from './office.mjs';

export const isRepo = ws => !existsSync(join(ws, 'studio-workspace.json')) && existsSync(join(ws, 'core', 'VERSION')) && existsSync(join(ws, 'project-site'));
export const paths = ws => {
  const repo = isRepo(ws), app = repo ? join(ws, 'TEMP', 'studio') : join(ws, '.studio');
  return {
    ws, repo, app, marker: join(ws, repo ? 'core/VERSION' : 'studio-workspace.json'), core: join(ws, 'core'), pristine: join(app, 'core-pristine'),
    rules: [join(ws, 'AGENTS.md'), join(ws, 'CLAUDE.md')], projects: join(ws, repo ? 'project-site' : 'projects'), settings: join(app, 'settings.json'),
  };
};
export const projectPaths = (ws, id) => {
  const repo = isRepo(ws), dir = join(ws, repo ? 'project-site' : 'projects', id), st = join(dir, '.studio');
  return { id, dir, repo, ws, docs: join(dir, 'docs'), studio: st, state: join(st, 'state.json'), rounds: join(st, 'rounds.jsonl'), logs: join(st, 'logs'),
    questions: join(st, 'questions'), answers: join(st, 'answers'), plan: join(st, 'plan'), handoff: join(st, 'handoff'),
    agents: join(dir, 'AGENTS.md'), studioJson: join(dir, 'studio.json'), temp: join(dir, 'TEMP') };
};

const coreVersion = core => readFileSync(join(core, 'VERSION'), 'utf8').trim();
const SKIP_CORE = r => /^review(\/|$)/.test(r);      // core/review 是本庫 models 檢查的結果，工作區用不到

// 工作區執行鎖：同一個工作區一次只跑一個 vs3d。
// 雜湊比對會把其他專案的變更當成越界並還原，兩個專案同時跑會互相毀掉對方的工作。
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function acquireLock(ws, id) {
  const f = join(paths(ws).app, 'run.lock'), cur = readJson(f, null);
  if (cur && cur.pid !== process.pid && alive(cur.pid)) throw new Error(`工作區正在執行專案 ${cur.project}（pid ${cur.pid}，${cur.at} 開始）；一個工作區一次只能跑一個專案`);
  writeJson(f, { pid: process.pid, project: id, at: now() });
  return () => { if (readJson(f, null)?.pid === process.pid) rmSync(f, { force: true }); };
}

// 刪除工作區的專案：整個資料夾移到 <工作區>/.studio/trash/<名稱>-<時間>，不會直接消失；確定不要了再自己清掉，要復原就搬回 projects/。
// 本庫的站在版控裡，不從這裡刪。
export function deleteProject(ws, id) {
  const P = paths(ws), J = projectPaths(ws, id);
  if (P.repo) throw new Error('本庫的站在版控裡，不能從這裡刪除（要移除請用 git）');
  if (!existsSync(join(J.dir, 'studio.json'))) throw new Error(`找不到專案：${id}`);
  const release = acquireLock(ws, id);      // 正在執行就會丟出錯誤
  try {
    const dest = join(P.app, 'trash', `${id}-${now().slice(0, 19).replace(/[-:T]/g, '')}`);
    mkdirSync(dirname(dest), { recursive: true });
    try { renameSync(J.dir, dest); } catch (e) { throw new Error(`搬不動專案資料夾（${e.code || e.message}）：可能有程式正開著裡面的檔案，關掉後再試`); }
    return dest;
  } finally { release(); }
}

export function setReadOnly(dir, readOnly = true) {
  for (const r of walk(dir)) try { chmodSync(join(dir, r), readOnly ? 0o444 : 0o644); } catch { /* 略過 */ }
}

// refreshCore：來源 core 的版本和工作區不同時，換掉工作區的 core 與還原副本（開發用；正式的升級＋背景驗證在 P5）
export function initWorkspace(ws, { log = console.log, refreshCore = false } = {}) {
  const P = paths(ws);
  mkdirSync(P.projects, { recursive: true });
  if (refreshCore && existsSync(P.core) && coreVersion(P.core) !== coreVersion(SOURCE_CORE)) {
    log(`更新 core：${coreVersion(P.core)} → ${coreVersion(SOURCE_CORE)}`);
    for (const d of [P.core, P.pristine]) if (existsSync(d)) { setReadOnly(d, false); rmSync(d, { recursive: true, force: true }); }
  }
  if (!existsSync(P.core)) {
    const filter = src => !SKIP_CORE(src.slice(SOURCE_CORE.length + 1).replace(/\\/g, '/'));
    cpSync(SOURCE_CORE, P.core, { recursive: true, filter });
    cpSync(SOURCE_CORE, P.pristine, { recursive: true, filter });
    setReadOnly(P.core); setReadOnly(P.pristine);
    log(`已複製 core ${coreVersion(P.core)} → ${P.core}`);
  }
  for (const [name, file] of [['workspace-AGENTS.md', P.rules[0]], ['workspace-CLAUDE.md', P.rules[1]]]) {
    if (existsSync(file)) chmodSync(file, 0o644);
    copyFileSync(join(STUDIO, 'templates', name), file);
    chmodSync(file, 0o444);
  }
  const marker = readJson(P.marker, {});
  writeJson(P.marker, { created: marker.created || now(), core: coreVersion(P.core), studio: 1 });
  if (!existsSync(P.settings)) writeJson(P.settings, { defaultCli: 'claude', roles: {} });
  return P;
}

// 用戶名稱名單（不得出現在任何產出；core/tools/check-names.mjs 讀同一個檔）：<工作區>/.studio/client-names.txt，一行一個
export const namesFile = ws => isRepo(ws) ? join(ws, '.private', 'client-names.txt') : join(ws, '.studio', 'client-names.txt');   // 本庫用 .private/（不進版控）
export const readClientNames = ws => existsSync(namesFile(ws)) ? readFileSync(namesFile(ws), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
export function addClientNames(ws, names = []) {
  const cur = readClientNames(ws), add = names.map(s => String(s).trim()).filter(s => s && !s.startsWith('#') && !cur.includes(s));
  if (add.length) { mkdirSync(dirname(namesFile(ws)), { recursive: true }); writeFileSync(namesFile(ws), ['# 用戶名稱：不得出現在任何產出（vs3d 與 check.mjs 的 names 檢查使用）', ...cur, ...add].join('\n') + '\n'); }
  return add;
}
// 專案自己的名單（<專案>/.studio/client-names.txt）：交接包靠它把名稱保護帶給接手的人
export const projectNamesFile = J => join(J.studio, 'client-names.txt');
export const readProjectNames = J => existsSync(projectNamesFile(J)) ? readFileSync(projectNamesFile(J), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
export function addProjectNames(J, names = []) {
  const cur = readProjectNames(J), add = names.map(s => String(s).trim()).filter(s => s && !s.startsWith('#') && !cur.includes(s));
  if (add.length) { mkdirSync(J.studio, { recursive: true }); writeFileSync(projectNamesFile(J), ['# 這個專案不得顯示的用戶名稱', ...cur, ...add].join('\n') + '\n'); }
  return add;
}
// 長的名稱先換，避免「A 公司」被「A」拆開
export const redactNames = (text, names) => [...names].sort((a, b) => b.length - a.length).reduce((s, n) => s.split(n).join('（用戶）'), String(text));

// 由 core 範本建立專案，換成 studio 用的規則檔，複製上傳檔（Office 檔抽出文字與圖片），git init
//   J.notes：給使用者看的訊息（抽取結果、舊格式提示、失敗警告）
//   clientNames：不得顯示的用戶名稱；加進工作區名單，標題、說明與需求原文裡的名稱換成「（用戶）」
export async function createProject(ws, { id, title, summary = '', prompt = '', files = [], cli, clientNames = [] }) {
  const P = paths(ws), J = projectPaths(ws, id);
  addClientNames(ws, clientNames);
  const names = readClientNames(ws);
  [title, summary, prompt] = [title, summary, prompt].map(s => redactNames(s, names));
  if (existsSync(J.dir)) throw new Error(`專案已存在：${J.dir}`);
  const r = await run(process.execPath, [join(P.core, 'tools', 'new-project.mjs'), id, title, summary || title], { cwd: ws });
  if (r.code) throw new Error('new-project 失敗：\n' + r.out);
  rmSync(join(J.dir, '.claude'), { recursive: true, force: true });   // 本庫的範圍關卡不適用於工作區；studio 另外掛關卡
  addProjectNames(J, clientNames);

  mkdirSync(J.docs, { recursive: true });
  const copied = [];
  for (const f of files) { const dest = join(J.docs, basename(f)); copyFileSync(f, dest); copied.push(basename(f)); }
  const office = extractUploads(J.docs, copied);      // 代理讀不了 Office 檔：抽到 docs/<檔名>.extract/
  J.notes = office.notes;
  const quote = prompt.trim() ? prompt.trim().split('\n').map(l => '> ' + l).join('\n') : '（未提供）';
  const tpl = readFileSync(join(STUDIO, 'templates', 'project-AGENTS.md'), 'utf8');
  writeText(J.agents, tpl.replace('{{title}}', title).replace('{{id}}', id).replace('{{prompt}}', quote)
    .replace('{{files}}', copied.length ? copied.map(f => `- \`docs/${f}\`${office.info[f] ? `（${office.info[f]}）` : ''}`).join('\n') : '- （沒有）'));
  writeText(join(J.dir, 'CLAUDE.md'), '@AGENTS.md\n');
  writeText(join(J.dir, '.gitignore'), '# 使用者上傳檔只留本機；TEMP 與 app 狀態不進版控\ndocs/\nTEMP/\n.studio/\n');
  writeJson(J.studioJson, { ...(cli ? { defaultCli: cli } : {}), ...DEFAULT_STUDIO_JSON });

  git(J.dir, ['init', '-q']);
  // 不做換行轉換：還原後的檔案要和開工前逐位元相同（雜湊比對）
  git(J.dir, ['config', 'core.autocrlf', 'false']);
  git(J.dir, ['add', '-A']);
  git(J.dir, ['-c', 'user.name=vs3d', '-c', 'user.email=vs3d@localhost', 'commit', '-qm', `Create project ${id} from core template`]);
  return J;
}
