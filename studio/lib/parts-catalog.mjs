// 給代理用的元件清單：把元件資料庫整理成 Markdown，寫進專案的 .studio/parts-catalog.md。
// 代理在工作區或沙箱裡不一定讀得到 studio/data/parts.db，所以每次開始執行時由 app 寫一份最新的清單到專案裡；
// 規劃與選型時先查這份清單，沿用過去專案用過的元件與參考單價（提示詞見 prompts.mjs）。
import { existsSync } from 'node:fs';
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
    '- 選型時先在這裡找有沒有合用的元件；有就沿用，並在提案、說明或成本估算裡寫出編號（例如 `#132 工業相機`）。',
    '- 清單裡沒有合用的才另外選型，並標明「新元件」和選型理由，方便之後補進資料庫。',
    '- 參考單價是新台幣未稅的預算價（括號是估價等級：A 型錄或近期採購價 ±10%、B 同級品預算價 ±20%、C 規格未定或自製 ±30%），不是報價。',
    '- 「用過的專案」是本庫其他專案的代號，只當作參考來源，不要寫進網頁或說明文字。', ''];
  let group = null, category = null;
  for (const p of parts) {
    if (p.grp !== group) { group = p.grp; category = null; out.push(`## ${group || '未分組'}`, ''); }
    if (p.category !== category) { category = p.category; out.push(`### ${category || '未分類'}`, '', '| 編號 | 名稱 | 廠牌 | 型號／選型 | 規格 | 單位 | 參考單價 | 用過的專案 | 選型備註 |', '|---|---|---|---|---|---|---|---|---|'); }
    const attrs = Object.entries(p.attrs).map(([k, v]) => `${k}：${v}`).join('；');
    out.push(`| #${p.id} | ${[p.name, p.brand, p.model, [p.spec, attrs].filter(Boolean).join('；'), p.unit, price(p), p.projects.join('、'), [p.selection_note, p.alternatives && `替代：${p.alternatives}`].filter(Boolean).join('；')].map(cell).join(' | ')} |`);
    const next = parts[parts.indexOf(p) + 1];
    if (!next || next.category !== category || next.grp !== group) out.push('');
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
