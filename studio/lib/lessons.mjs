// 常見錯誤清單（2026-11-14，I 項）：審查角色抓到的必修項累積成通則，之後的規劃、開發、修正、補強都先看過。
//   來源：審查結果 must[] 的 lesson（審查角色寫的一句通則，不含站名與用戶名稱）；沒寫 lesson 的不收（issue 多半帶專案細節）。
//   存放：studio/data/lessons.json（只留本機，部署版就是中央主機那一份；VS3D_LESSONS 可改位置，測試用）。
//   同一句（去掉空白與標點後相同）只留一筆、累計次數；使用者在介面「設定」頁可以改寫、停用或刪除。
//   給代理：每次執行前寫到專案的 .studio/lessons.md（依次數排序，最多 40 條；用戶名稱遮掉）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STUDIO, readJson, writeJson, writeText, now } from './util.mjs';
import { redactNames } from './workspace.mjs';

export const lessonsFile = () => process.env.VS3D_LESSONS || join(STUDIO, 'data', 'lessons.json');
const key = s => String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const load = () => readJson(lessonsFile(), { items: [] });
const save = d => writeJson(lessonsFile(), d);

export function listLessons() { return load().items; }

// 審查的必修項併進清單；回傳新增與累計的筆數
export function addLessons(must = [], { project = '', names = [] } = {}) {
  const d = load(), out = { added: 0, counted: 0 };
  for (const m of must) {
    const text = redactNames(String(m?.lesson || '').replace(/\s+/g, ' ').trim(), names);
    if (text.length < 6) continue;
    const k = key(text), hit = d.items.find(x => key(x.text) === k);
    if (hit) { hit.count++; hit.lastAt = now(); if (project && !hit.projects.includes(project)) hit.projects.push(project); out.counted++; }
    else { d.items.push({ id: `L${String((d.seq = (d.seq || 0) + 1)).padStart(4, '0')}`, text, count: 1, firstAt: now(), lastAt: now(), projects: project ? [project] : [], disabled: false }); out.added++; }
  }
  if (out.added || out.counted) save(d);
  return out;
}

export function updateLesson(id, { text, disabled } = {}) {
  const d = load(), x = d.items.find(i => i.id === id);
  if (!x) throw new Error(`找不到 ${id}`);
  if (text != null) { const t = String(text).replace(/\s+/g, ' ').trim(); if (t.length < 6) throw new Error('內容太短'); x.text = t; }
  if (disabled != null) x.disabled = !!disabled;
  save(d); return x;
}
export function deleteLesson(id) {
  const d = load(), n = d.items.length;
  d.items = d.items.filter(i => i.id !== id);
  if (d.items.length === n) throw new Error(`找不到 ${id}`);
  save(d);
}

// 寫給代理看的清單；沒有任何啟用的條目就不寫，回傳條數
export function writeLessons(J, { names = [], max = 40 } = {}) {
  const items = load().items.filter(x => !x.disabled).sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, max);
  const f = join(J.studio, 'lessons.md');
  if (!items.length) { if (existsSync(f)) writeText(f, ''); return 0; }
  writeText(f, ['# 常見錯誤（過去專案的審查必修項，app 整理；不要修改這個檔）', '',
    '規劃、開發、修正、補強前先看過，同樣的錯不要再犯。括號裡是被抓到的次數。', '',
    ...items.map(x => `- ${redactNames(x.text, names)}（${x.count}）`), ''].join('\n'));
  return items.length;
}
export const hasLessons = J => { const f = join(J.studio, 'lessons.md'); return existsSync(f) && readFileSync(f, 'utf8').trim().length > 0; };
