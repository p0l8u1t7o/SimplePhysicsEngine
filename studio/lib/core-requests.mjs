// core 缺功能的自動登記（2026-11-14，F 項）：代理在站裡暫代時把需求寫到 <專案>/.studio/core-requests.json，
//   app 每輪結束後遮掉用戶名稱、去重，依 core/REQUESTS.md 的格式加到「## 待處理」（本庫模式）；
//   部署版的工作區沒有本庫，寫到 <工作區>/.studio/core-requests.md，由管理者轉交 core 維護者。
//   代理被寫檔關卡擋在站內，本來就改不到 core/REQUESTS.md，所以由 app 代登記；已登記的標題記在 .studio/core-requests-done.json。
//   檔案格式：[{ "title": "一句話需求", "workaround": "站內暫代的檔案與函式", "interface": "期望的 core API", "impact": "還有哪些站會用到", "why": "現象或原因（選填）" }]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readJson, writeJson } from './util.mjs';
import { redactNames } from './workspace.mjs';

export const requestsFile = J => join(J.studio, 'core-requests.json');
const doneFile = J => join(J.studio, 'core-requests-done.json');
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
export const targetFile = (ws, J) => J.repo ? join(ws, 'core', 'REQUESTS.md') : join(ws, '.studio', 'core-requests.md');

// 新的需求加進登記檔；回傳 { added: [標題], file, invalid: [說明] }
export function registerCoreRequests(ws, J, { names = [], date = new Date().toISOString().slice(0, 10) } = {}) {
  const src = requestsFile(J);
  if (!existsSync(src)) return { added: [], file: null, invalid: [] };
  let list;
  try { list = JSON.parse(readFileSync(src, 'utf8')); } catch (e) { return { added: [], file: null, invalid: [`core-requests.json 不是合法 JSON：${e.message}`] }; }
  if (!Array.isArray(list)) list = [list];
  const done = new Set(readJson(doneFile(J), [])), file = targetFile(ws, J), red = s => redactNames(norm(s), names);
  const cur = existsSync(file) ? readFileSync(file, 'utf8') : '', existing = new Set([...cur.matchAll(/^### (.+)$/gm)].map(m => norm(m[1])));
  const added = [], invalid = [], blocks = [];
  for (const r of list) {
    const title = red(r?.title);
    if (!title) { invalid.push('有一筆沒有 title'); continue; }
    if (done.has(title) || existing.has(title)) { done.add(title); continue; }
    if (!norm(r.workaround)) invalid.push(`「${title}」沒寫暫代的位置（workaround）`);
    blocks.push([`### ${title}`, `- 提出：${J.id}（${date}，3D工作室代理自動登記，待主 session 判斷）`, ...(norm(r.why) ? [`- 現象：${red(r.why)}`] : []),
      `- 暫代：${red(r.workaround) || '（未寫）'}`, `- 期望介面：${red(r.interface) || '（未寫）'}`, `- 影響：${red(r.impact) || '（未寫）'}`, ''].join('\n'));
    added.push(title); done.add(title);
  }
  if (blocks.length) {
    let text = cur || '# core 需求（3D工作室代理登記，待轉交 core 維護者）\n\n## 待處理\n\n';
    const m = /^## 待處理[^\n]*\n+/m.exec(text);
    // 加在「待處理」標題下面的第一個位置（最新的在最上面），沒有這一節就接在檔尾
    text = m ? text.slice(0, m.index + m[0].length) + blocks.join('\n') + '\n' + text.slice(m.index + m[0].length) : text.replace(/\n*$/, '\n\n## 待處理\n\n') + blocks.join('\n');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  writeJson(doneFile(J), [...done]);
  return { added, file: blocks.length ? file : null, invalid };
}
// 介面用：這個專案登記過幾筆
export const coreRequestCount = J => readJson(doneFile(J), []).length;
