// 專案清單：專案根目錄底下有 web/index.html 的資料夾即為一個 3D 動畫專案，說明寫在 project.json。
//   本庫：專案放在 <庫>/project-site/ 底下
//   工作區模式（3D 動畫生成應用程式 studio/ 建立的工作區）：core 旁邊有 studio-workspace.json 時，專案放在 <工作區>/projects/
// 兩種配置的專案都在 core 往上兩層（<根>/<專案資料夾>/<專案>/），網址配置不變（/core/、/<專案>/）。
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE = existsSync(resolve(CORE, '..', 'studio-workspace.json')) ? resolve(CORE, '..') : null;
// REPO：庫（或工作區）根目錄，放 TEMP/、.git、腳本；ROOT：專案根目錄
export const REPO = resolve(CORE, '..');
export const ROOT = WORKSPACE ? join(WORKSPACE, 'projects') : join(REPO, 'project-site');
export const PROJECTS_DIR = WORKSPACE ? 'projects' : 'project-site';

export function listProjects() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(ROOT, d.name, 'web', 'index.html')))
    .map(d => loadProject(d.name))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function loadProject(id) {
  const dir = join(ROOT, id), file = join(dir, 'project.json');
  const meta = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return { id, dir, web: join(dir, 'web'), title: meta.title || id, summary: meta.summary || '', order: meta.order ?? 99, ...meta };
}

// 命令列可用資料夾名稱或其開頭字串指定專案（大小寫不分）
export function pickProjects(names) {
  const all = listProjects();
  if (!names.length) return all;
  return names.map(n => {
    const hit = all.find(p => p.id === n) || all.find(p => p.id.toLowerCase().startsWith(n.toLowerCase()));
    if (!hit) throw new Error(`找不到專案：${n}（可用：${all.map(p => p.id).join('、')}）`);
    return hit;
  });
}
