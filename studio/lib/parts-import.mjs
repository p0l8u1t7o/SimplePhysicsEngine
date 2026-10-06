// 新案子的元件自動進元件資料庫（2026-10-05 拍板：提案確認後自動匯入，新元件標「待確認」）。
// 規劃角色除了提案，另外寫一份元件表：第一段 .studio/plan/parts.json、第二段 .studio/plan/parts-segment2.json，內容是
//   { "parts": [ { "ref": "P-00132", "name": "工業相機", "brand": "", "model": "", "spec": "", "category": "相機與讀碼", "unit": "台", "qty": 2, "reason": "…" } ] }
// ref 是沿用的元件編號（查 .studio/parts-catalog.md）；沒有 ref 的先找名稱與型號完全相同的既有元件，找不到才新增並標「待確認」。
// 每一列變成一筆使用紀錄（專案、來源檔、第幾列），重複執行不會重複匯入。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openPartsDb, defaultPartsDb, PENDING } from './partsdb.mjs';
import { readJson } from './util.mjs';

const str = v => v == null ? '' : String(v).trim();

export function importPlanParts(db, project, items, { source = 'parts.json', redact = s => s } = {}) {
  const out = { reused: 0, created: 0, existing: 0, invalid: 0, rows: [] };
  db.tx(() => {
    items.forEach((raw, i) => {
      const it = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v])), code = String(i + 1);
      if (!str(it.name)) { out.invalid++; return; }
      if (db.findUsage(project, source, code)) { out.existing++; return; }
      let part = (str(it.ref) && db.findByCode(str(it.ref))) || db.findSame(it.name, it.model), action = 'reused';
      if (!part) {
        part = db.createPart({ name: it.name, brand: it.brand, model: it.model, spec: it.spec, category: it.category, unit: it.unit, status: PENDING, selection_note: str(it.reason), note: `由 ${project} 的提案帶入${str(it.category) ? `；提案的類別：${str(it.category)}` : ''}` },
          { createCategory: false });      // 代理寫的類別不自動建分類：找得到就放進去，找不到放群組底下或未分類，原文記在備註
        action = 'created';
      }
      const qty = Number.isFinite(Number(it.qty)) && it.qty !== '' && it.qty != null ? Number(it.qty) : null;
      db.addUsage(part.id, { project, source, item_code: code, qty, reason: str(it.reason), note: action === 'created' ? '新元件' : '' });
      out[action]++; out.rows.push({ code: part.code, name: part.name, action });
    });
  });
  return out;
}

// 讀專案的元件表並匯入；沒有元件表就什麼都不做（也不會建立資料庫）。回傳 null 或合計
export function importFromProject(J, { file = defaultPartsDb(), redact } = {}) {
  const sources = ['parts.json', 'parts-segment2.json'].map(name => ({ name, data: existsSync(join(J.plan, name)) ? readJson(join(J.plan, name), null) : null }))
    .filter(s => Array.isArray(s.data?.parts) && s.data.parts.length);
  if (!sources.length) return null;
  const db = openPartsDb(file), total = { reused: 0, created: 0, existing: 0, invalid: 0, rows: [] };
  try {
    for (const s of sources) { const r = importPlanParts(db, J.id, s.data.parts, { source: s.name, redact }); for (const k of ['reused', 'created', 'existing', 'invalid']) total[k] += r[k]; total.rows.push(...r.rows); }
  } finally { db.close(); }
  return total;
}
