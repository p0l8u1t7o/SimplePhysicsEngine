// 把本庫各站既有的成本表（project-site/<站>/docs/*.xlsx 的「明細」）轉成平台的 BOM（評估平台 Q3）：vs3d parts bom-import。
// - 市購品：找 parts seed 匯入時留下的使用紀錄（專案、來源檔、編號）→ 引用那個元件（鎖定目前的版本）；
//   成本表上的單價和元件的參考單價不同時，這一行用成本表的單價（自填單價），金額才會和原檔一樣。
// - 工程人日：單價等於摘要的工程或技術費率就用費率，否則用成本表的單價。
// - 其他（自製、一式、沒有匯入元件庫的）：客製件，單價照成本表。
// - 性質：「性質」欄（設備／工程／選配），沒有就看子系統名稱（含「選配」是選配、含「工程」或單位是人日是工程人日）。
// - 費率、預備費、稅、等級幅度、美元匯率從「摘要」讀；BOM 的專案代號是 @<站>（本庫的站）。
// check：轉完逐行（小計）與摘要（小計、含預備費、上下限、含稅）和原檔比對；原檔沒有存公式的結果時，用原本的公式重算當作原檔的值。
import { readZip, xlsxSheets } from './office.mjs';
import { readFileSync, statSync } from 'node:fs';
import { readCostSheet } from './parts-seed.mjs';

const num = v => { const n = Number(String(v ?? '').replace(/[,%\s]/g, '')); return v == null || v === '' || !Number.isFinite(n) ? null : String(v).includes('%') ? n / 100 : n; };
const r2 = n => Math.round(n * 100) / 100;

// 摘要的參數與金額：依第一欄的文字找；金額取那一列最後一個數字（有分部的表是「合計」欄）
export function readCostSummary(file) {
  const sh = xlsxSheets(readZip(readFileSync(file))).find(s => s.name === '摘要');
  if (!sh?.rows) return null;
  const row = re => sh.rows.find(r => re.test(String(r.cells[0] ?? '').trim()));
  const first = re => num(row(re)?.cells[1]), lastNum = re => { const c = row(re)?.cells || []; for (let i = c.length - 1; i >= 1; i--) { const n = num(c[i]); if (n != null) return n; } return null; };
  const grade = g => num(sh.rows.find(r => String(r.cells[0] ?? '').trim() === g && num(r.cells[1]) != null)?.cells[1]);
  return {
    settings: { engRate: first(/^工程費率/), techRate: first(/^技術費率/), contingency: first(/^預備費率/), tax: first(/稅率/), gradeRange: { A: grade('A') ?? 0.1, B: grade('B') ?? 0.2, C: grade('C') ?? 0.3 } },
    usd: first(/^美元匯率/),
    totals: { subtotal: lastNum(/^小計/), total: lastNum(/^含預備費/), low: lastNum(/^下限/), high: lastNum(/^上限/), taxed: lastNum(/^含稅/) },
  };
}

function natureOf(r) {
  if (/選配/.test(r.kind)) return 'option';
  if (/工程/.test(r.kind)) return 'labor';
  if (/設備|硬體|授權/.test(r.kind)) return 'equipment';
  if (/選配/.test(r.subsystem)) return 'option';
  if (/工程/.test(r.subsystem) || r.unit === '人日') return 'labor';
  return 'equipment';
}

// 一份成本表 → BOM 的行（不寫入）；db 用來找使用紀錄與元件的參考單價
export function costRowsToItems(db, { project, source, file }) {
  const sum = readCostSummary(file), st = sum?.settings || {};
  const rows = readCostSheet(file).filter(r => r.sheet === '明細' && r.code && r.name);
  const items = rows.map(r => {
    const nature = natureOf(r), base = { line: r.code, section: r.subsystem, grp: r.part ? `第 ${r.part} 部分` : '', name: r.name, spec: r.spec, model: r.model, reason: r.reason || r.remark,
      qty: r.qty ?? 0, unit: r.unit, grade: r.grade, nature };
    const use = db.findUsage(project, source, r.code), part = use ? db.getPart(use.part_id) : null;
    if (part) {
      const latest = part.prices[0]?.unit_price ?? null;
      return { ...base, part: part.id, unit_price: latest === r.price && (part.prices[0]?.currency || 'TWD') === 'TWD' ? null : r.price };
    }
    if (nature === 'labor' && r.unit === '人日') {
      const labor = r.price === st.techRate ? 'tech' : 'eng', rate = labor === 'tech' ? st.techRate : st.engRate;
      return { ...base, labor, unit_price: r.price === rate ? null : r.price };
    }
    return { ...base, unit_price: r.price ?? 0 };
  });
  return { items, summary: sum, rows };
}

// 原檔的值：摘要有存公式的結果就用它；沒有（openpyxl 寫的、沒開過 Excel）就照原本的公式從明細重算
export function expectedFromSheet(rows, summary) {
  const st = summary.settings, k = 1 + (st.contingency ?? 0.15), range = g => st.gradeRange[g] ?? 0.3;
  const line = r => r2((r.qty ?? 0) * (r.price ?? 0));
  const calc = { subtotal: r2(rows.reduce((a, r) => a + line(r), 0)) };
  calc.total = r2(calc.subtotal * k); calc.taxed = r2(calc.total * (1 + (st.tax ?? 0.05)));
  calc.low = r2(rows.reduce((a, r) => a + line(r) * (1 - range(r.grade)), 0) * k); calc.high = r2(rows.reduce((a, r) => a + line(r) * (1 + range(r.grade)), 0) * k);
  const t = summary.totals, cached = t.subtotal != null;
  return { lines: Object.fromEntries(rows.map(r => [r.code, line(r)])), totals: cached ? t : calc, cached };
}

// 寫入：換掉 @<站> 的 BOM（先留快照，如果原本就有內容）；費率、匯率照原檔；回傳比對結果
export function importCostTable(db, { project, source, file, check = true }) {
  const { items, summary, rows } = costRowsToItems(db, { project, source, file }), id = `@${project}`, B = db.bom;
  if (!items.length) return { project, source, skipped: '沒有明細' };
  const date = statSync(file).mtime.toLocaleDateString('sv');
  if (summary?.usd) B.setFx({ currency: 'USD', rate: summary.usd, date, note: `${project} ${source}` });
  return db.tx(() => {
    const cur = B.current(id);
    if (cur && B.get(id).lines.length) B.snapshot(id, { name: '從成本表轉換前', note: `重新從 ${source} 轉換之前自動保存` });
    B.ensure(id, { note: `從 ${source} 轉換` });
    const s = summary?.settings || {};
    B.updateSettings(id, { ...Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)), fxDate: date });
    B.replaceItems(id, items);
    const got = B.get(id), out = { project, source, id, lines: got.lines.length, parts: got.lines.filter(l => l.part_id).length, labor: got.lines.filter(l => l.labor).length, custom: got.lines.filter(l => !l.part_id && !l.labor).length };
    if (!check || !summary) return out;
    const exp = expectedFromSheet(rows, summary), mism = got.lines.filter(l => Math.abs(l.subtotal - (exp.lines[l.line] ?? 0)) > 0.01).map(l => ({ line: l.line, want: exp.lines[l.line], got: l.subtotal }));
    const totals = Object.fromEntries(Object.entries(exp.totals).filter(([, v]) => v != null).map(([k, v]) => [k, { want: v, got: got.summary[k], ok: Math.abs(v - got.summary[k]) <= 0.01 }]));
    return { ...out, cached: exp.cached, lineMismatches: mism, totals, ok: !mism.length && Object.values(totals).every(t => t.ok) };
  });
}
