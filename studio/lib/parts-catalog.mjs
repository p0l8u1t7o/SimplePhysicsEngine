// 給代理用的元件清單：把元件資料庫整理成 Markdown，寫進專案的 .studio/parts-catalog.md。
// 代理在工作區或沙箱裡不一定讀得到 studio/data/studio.db，所以每次開始執行時由 app 寫一份最新的清單到專案裡；
// 規劃與選型時先查這份清單，沿用過去專案用過的元件與參考單價（提示詞見 prompts.mjs）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPartsDb, defaultPartsDb } from './partsdb.mjs';
import { writeText } from './util.mjs';

const cell = s => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '／').trim();
const price = p => p.unit_price == null ? '' : `${p.currency === 'TWD' ? 'NT$' : p.currency + ' '}${Number(p.unit_price).toLocaleString('en-US')}${p.grade ? `（${p.grade}）` : ''}`;

// redact：把不得顯示的用戶名稱換掉的函式（預設不處理）
export function catalogMarkdown(db, { redact = s => s, today = new Date().toLocaleDateString('sv') } = {}) {
  const { parts, total } = db.listParts({ limit: 5000 });
  const out = [`# 元件資料庫清單（${today}，${total} 個元件）`, '',
    '這是公司元件資料庫的摘要：過去專案用過或評估過的元件、規格與參考單價。由 app 在每次執行開始時更新，**不要修改這個檔**。', '',
    '- 選型時先在這裡找有沒有合用的元件；有就沿用，並在提案、說明或成本估算裡寫出元件編號（例如 `P-00132 工業相機`）；編號是唯一的，不會變。',
    '- 清單裡沒有合用的才另外選型，並標明「新元件」和選型理由，方便之後補進資料庫。',
    '- 參考單價是新台幣未稅的預算價（括號是估價等級：A 型錄或近期採購價 ±10%、B 同級品預算價 ±20%、C 規格未定或自製 ±30%），不是報價。',
    '- 「用過的專案」是本庫其他專案的代號，只當作參考來源，不要寫進網頁或說明文字。', ''];
  // 依分類樹分段：最上層一節（##），底下的路徑一小節（###）；模組列出組成
  const top = p => p.category_path[0] || '', sub = p => p.category_path.slice(1).join(' › ');
  let group = null, category = null;
  for (const p of parts) {
    if (top(p) !== group) { group = top(p); category = null; out.push(`## ${group || '未分類'}`, ''); }
    if (sub(p) !== category) { category = sub(p); out.push(`### ${category || group || '未分類'}`, '', '| 編號 | 名稱 | 廠牌 | 型號／選型 | 規格 | 單位 | 參考單價 | 用過的專案 | 選型備註 |', '|---|---|---|---|---|---|---|---|---|'); }
    const attrs = Object.entries(p.attrs).filter(([, v]) => v !== '').map(([k, v]) => `${k}：${v}`).join('；');
    const parts_ = p.kind === 'module' ? `模組，組成：${db.links.linksOf(p.id).components.map(c => `${c.code}×${c.qty ?? 1}`).join('、') || '（還沒有子件）'}` : '';
    out.push(`| ${p.code} | ${[p.status ? `${p.name}（${p.status}）` : p.name, p.brand, p.model, [p.spec, attrs, parts_].filter(Boolean).join('；'), p.unit, price(p), p.projects.join('、'), [p.selection_note, p.alternatives && `替代：${p.alternatives}`].filter(Boolean).join('；')].map(cell).join(' | ')} |`);
    const next = parts[parts.indexOf(p) + 1];
    if (!next || sub(next) !== category || top(next) !== group) out.push('');
  }
  return redact(out.join('\n'));
}

// 寫到專案的 .studio/parts-catalog.md；資料庫不存在或是空的就不寫，回傳寫出的元件數（沒寫是 0）
export function writeCatalog(J, { file = defaultPartsDb(), redact } = {}) {
  if (!existsSync(file)) return 0;
  const db = openPartsDb(file);
  try {
    const n = db.stats().parts;
    if (n) writeText(join(J.studio, 'parts-catalog.md'), catalogMarkdown(db, { redact }));
    return n;
  } finally { db.close(); }
}

// 有 3D 模型的元件 → 專案的 web/js/parts-models.js（core/models/parts.js 的 fromPart 用；評估平台 Q9）。
// 內容沒變就不寫（避免每輪都多一個 commit）；本庫的站不寫（站自己決定要不要用）。回傳元件數
export function writePartsModels(J, { file = defaultPartsDb(), redact = s => s } = {}) {
  if (J.repo || !existsSync(file) || !existsSync(join(J.dir, 'web', 'js'))) return 0;
  const db = openPartsDb(file);
  try {
    const rows = db.listParts({ limit: 5000 }).parts.filter(p => p.model_id).sort((a, b) => a.code.localeCompare(b.code));
    const map = Object.fromEntries(rows.map(p => [p.code, { model: p.model_id, params: JSON.parse(p.model_params || '{}'), name: redact(p.name) }]));
    const text = `// 由 3D工作室 寫出（每輪代理執行前更新，不要手改）：元件編號 → 共用模型與參數。用法見 core/models/parts.js 的 fromPart。\nexport default ${JSON.stringify(map, null, 1)};\n`;
    const target = join(J.dir, 'web', 'js', 'parts-models.js');
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) writeText(target, text);
    return rows.length;
  } finally { db.close(); }
}
