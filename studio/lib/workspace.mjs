// 工作區與專案的建立。
//   <工作區>/
//     studio-workspace.json   工作區標記（core 的 projects.mjs 看到它就改從 projects/ 找專案）
//     core/                   內附的 core（唯讀屬性）；.studio/core-pristine/ 是還原用的副本
//     AGENTS.md、CLAUDE.md    共通規則（唯讀）
//     projects/<專案>/         每個專案一個 git 庫；docs/、TEMP/、.studio/ 不進版控
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SOURCE_CORE, STUDIO, git, readJson, writeJson, writeText, walk, now, run } from './util.mjs';
import { DEFAULT_STUDIO_JSON } from './roles.mjs';

export const paths = ws => ({
  ws, marker: join(ws, 'studio-workspace.json'), core: join(ws, 'core'), pristine: join(ws, '.studio', 'core-pristine'),
  rules: [join(ws, 'AGENTS.md'), join(ws, 'CLAUDE.md')], projects: join(ws, 'projects'), settings: join(ws, '.studio', 'settings.json'),
});
export const projectPaths = (ws, id) => {
  const dir = join(ws, 'projects', id), st = join(dir, '.studio');
  return { id, dir, docs: join(dir, 'docs'), studio: st, state: join(st, 'state.json'), rounds: join(st, 'rounds.jsonl'), logs: join(st, 'logs'),
    questions: join(st, 'questions'), answers: join(st, 'answers'), plan: join(st, 'plan'), handoff: join(st, 'handoff'),
    agents: join(dir, 'AGENTS.md'), studioJson: join(dir, 'studio.json'), temp: join(dir, 'TEMP') };
};

const coreVersion = core => readFileSync(join(core, 'VERSION'), 'utf8').trim();
const SKIP_CORE = r => /^review(\/|$)/.test(r);      // core/review 是本庫 models 檢查的結果，工作區用不到

// 工作區執行鎖：同一個工作區一次只跑一個 vs3d。
// 雜湊比對會把其他專案的變更當成越界並還原，兩個專案同時跑會互相毀掉對方的工作。
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function acquireLock(ws, id) {
  const f = join(ws, '.studio', 'run.lock'), cur = readJson(f, null);
  if (cur && cur.pid !== process.pid && alive(cur.pid)) throw new Error(`工作區正在執行專案 ${cur.project}（pid ${cur.pid}，${cur.at} 開始）；一個工作區一次只能跑一個專案`);
  writeJson(f, { pid: process.pid, project: id, at: now() });
  return () => { if (readJson(f, null)?.pid === process.pid) rmSync(f, { force: true }); };
}

export function setReadOnly(dir, readOnly = true) {
  for (const r of walk(dir)) try { chmodSync(join(dir, r), readOnly ? 0o444 : 0o644); } catch { /* 略過 */ }
}

export function initWorkspace(ws, { log = console.log } = {}) {
  const P = paths(ws);
  mkdirSync(P.projects, { recursive: true });
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

// 由 core 範本建立專案，換成 studio 用的規則檔，複製上傳檔，git init
export async function createProject(ws, { id, title, summary = '', prompt = '', files = [], cli }) {
  const P = paths(ws), J = projectPaths(ws, id);
  if (existsSync(J.dir)) throw new Error(`專案已存在：${J.dir}`);
  const r = await run(process.execPath, [join(P.core, 'tools', 'new-project.mjs'), id, title, summary || title], { cwd: ws });
  if (r.code) throw new Error('new-project 失敗：\n' + r.out);
  rmSync(join(J.dir, '.claude'), { recursive: true, force: true });   // 本庫的範圍關卡不適用於工作區；studio 另外掛關卡

  mkdirSync(J.docs, { recursive: true });
  const copied = [];
  for (const f of files) { const dest = join(J.docs, basename(f)); copyFileSync(f, dest); copied.push(basename(f)); }
  const quote = prompt.trim() ? prompt.trim().split('\n').map(l => '> ' + l).join('\n') : '（未提供）';
  const tpl = readFileSync(join(STUDIO, 'templates', 'project-AGENTS.md'), 'utf8');
  writeText(J.agents, tpl.replace('{{title}}', title).replace('{{id}}', id).replace('{{prompt}}', quote)
    .replace('{{files}}', copied.length ? copied.map(f => `- \`docs/${f}\``).join('\n') : '- （沒有）'));
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
