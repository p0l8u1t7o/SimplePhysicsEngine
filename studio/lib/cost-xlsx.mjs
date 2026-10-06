// 成本表 xlsx（評估平台 Q3）：照各站原本成本表的格式，「摘要」與「明細」兩個工作表。
// 單價、數量、費率、幅度是藍字輸入；小計、上下限、摘要都是公式（同時寫快取值），客戶拿到可以自己改數量、費率，Excel 會重算。
// 明細另外有元件編號與鎖定的版本、原幣單價與匯率、提醒，方便回查元件庫。
import { writeXlsx } from './xlsx-write.mjs';

const NATURE = { equipment: '設備與材料', labor: '工程人日', option: '選配' };
const FLAG = { estimate: '估價', expired: '報價過期', pending: '元件待確認', noPrice: '沒有單價', noFx: '沒有匯率', noGrade: '沒填等級（當 C）', partialSum: '模組加總不完整' };
const H = { s: 'head' };
const D = "'明細'!", S = "'摘要'!";

// data：bom.get() 或 bom.getSnapshot() 的結果；title：專案名稱
export function costWorkbook(data, { title = '', subtitle = '' } = {}) {
  const { lines, summary: s, settings: st } = data;
  const n = lines.length, last = n + 1;
  const col = c => `${D}$${c}$2:$${c}$${Math.max(2, last)}`;
  // ---- 明細 ----
  const head = ['編號', '子系統', '分部', '項目', '規格要求', '建議選型', '選型理由', '數量', '單位', '單價 NT$', '小計 NT$', '等級', '下限 NT$', '上限 NT$', '性質', '元件編號／版本', '原幣單價', '幣別', '匯率', '提醒'].map(v => ({ v, ...H }));
  const rows = [head, ...lines.map((l, i) => {
    const r = i + 2, foreign = l.currency !== 'TWD' && l.price != null;
    // 單價：人日用摘要的費率（沒自己填單價時）；外幣是原幣 × 匯率；其他是數字
    const price = l.source === 'labor' ? { v: l.unit_twd, f: `${S}$B$${l.labor === 'tech' ? 6 : 5}`, s: 'money' }
      : foreign ? { v: l.unit_twd ?? 0, f: `Q${r}*S${r}`, s: 'money' } : { v: l.unit_twd ?? 0, s: 'moneyInput' };
    const range = k => ({ v: l[k], f: `K${r}*(1${k === 'low' ? '-' : '+'}VLOOKUP(L${r},${S}$A$13:$B$15,2,FALSE))`, s: 'money' });
    return [l.line, l.section, l.grp, l.name, l.spec, l.model, l.reason, { v: l.qty, s: 'numInput' }, l.unit, price, { v: l.subtotal, f: `H${r}*J${r}`, s: 'money' }, { v: l.grade, s: 'numInput' },
      range('low'), range('high'), NATURE[l.nature], l.code ? `${l.code} v${l.part_version}` : '', foreign ? { v: l.price, s: 'numInput' } : null, foreign ? l.currency : null, foreign ? { v: l.fx ?? '', s: 'numInput' } : null,
      l.flags.filter(f => f !== 'estimate').map(f => FLAG[f]).join('、')];
  })];
  // ---- 摘要 ----
  const sumif = nature => ({ f: `SUMIFS(${col('K')},${col('O')},"${nature}")` });
  const fmt = s => s;
  const sum = [
    [{ v: `${title}　成本估算`, s: 'title' }],
    [{ v: subtitle || `${new Date().toLocaleDateString('sv')} 由 3D工作室匯出；新台幣、未稅為主；外幣依 ${st.fxDate} 的匯率換算。金額是預算估計，不是供應商報價。`, s: 'note' }],
    [],
    [{ v: '參數（藍字可改）', s: 'bold' }],
    ['工程費率（NT$／人日）', { v: st.engRate, s: 'moneyInput' }, '設計、程式、整合與驗收'],
    ['技術費率（NT$／人日）', { v: st.techRate, s: 'moneyInput' }, '組立配線'],
    ['預備費率', { v: st.contingency, s: 'pctInput' }, '套用設備＋工程＋已選選配'],
    ['營業稅率', { v: st.tax, s: 'pctInput' }, '含稅＝含預備費總額 ×（1＋稅率）'],
    ['匯率日期', st.fxDate, '外幣單價的換算依據'],
    [],
    [{ v: '估價等級與幅度', s: 'bold' }],
    [{ v: '等級', ...H }, { v: '幅度', ...H }, { v: '定義', ...H }],
    ['A', { v: st.gradeRange.A, s: 'pctInput' }, '型錄價或近期同級採購價'],
    ['B', { v: st.gradeRange.B, s: 'pctInput' }, '同級品預算價，需詢價'],
    ['C', { v: st.gradeRange.C, s: 'pctInput' }, '規格未定、自製或客製，幅度較大'],
    [],
    [{ v: '項目', ...H }, { v: '金額 NT$', ...H }, { v: '說明', ...H }],
    ['設備與材料', { v: s.equipment, ...sumif('設備與材料'), s: 'money' }, '不含工程人日與選配'],
    ['工程人日', { v: s.labor, ...sumif('工程人日'), s: 'money' }, '設計、程式、組立與驗收'],
    ['已選選配', { v: s.option, ...sumif('選配'), s: 'money' }, '數量改為 1 以上才計入'],
    ['小計（未稅）', { v: s.subtotal, f: 'SUM(B18:B20)', s: 'money' }],
    ['預備費', { v: s.contingency, f: 'B21*B7', s: 'money' }],
    [{ v: '含預備費，未稅', s: 'bold' }, { v: s.total, f: 'B21+B22', s: 'moneyBold' }, '預算主數字'],
    ['下限（含預備費，未稅）', { v: s.low, f: `SUM(${col('M')})*(1+B7)`, s: 'money' }, '逐列幅度加總，不是統計區間'],
    ['上限（含預備費，未稅）', { v: s.high, f: `SUM(${col('N')})*(1+B7)`, s: 'money' }],
    ['含稅預算', { v: s.taxed, f: 'B23*(1+B8)', s: 'money' }],
    ['工程人日數', { v: s.laborDays, f: `SUMIFS(${col('H')},${col('O')},"工程人日")` }, '工程師與技術人員合計'],
  ];
  if (s.groups.length > 1) {
    sum.push([], [{ v: '分部', ...H }, { v: '設備與材料', ...H }, { v: '工程人日', ...H }, { v: '選配', ...H }, { v: '小計（未稅）', ...H }, { v: '含預備費', ...H }, { v: '含稅', ...H }]);
    for (const g of s.groups) {
      const r = sum.length + 1, by = (nat, v) => ({ v, f: `SUMIFS(${col('K')},${col('O')},"${nat}",${col('C')},"${g.grp}")`, s: 'money' });
      sum.push([g.grp, by('設備與材料', g.equipment), by('工程人日', g.labor), by('選配', g.option), { v: g.subtotal, f: `SUM(B${r}:D${r})`, s: 'money' },
        { v: g.total, f: `E${r}*(1+$B$7)`, s: 'money' }, { v: g.taxed, f: `F${r}*(1+$B$8)`, s: 'money' }]);
    }
  }
  const f = s.flags, notes = [f.estimate && `C 級估價 ${f.estimate} 行`, f.expired && `報價過期 ${f.expired} 行`, f.pending && `元件待確認 ${f.pending} 行`, f.noPrice && `沒有單價 ${f.noPrice} 行`, f.noFx && `外幣沒有匯率 ${f.noFx} 行`, f.newer && `元件庫有新版 ${f.newer} 行（這份用的是鎖定的版本）`].filter(Boolean);
  if (notes.length) sum.push([], [{ v: '提醒', s: 'bold' }], ...notes.map(x => [x]));
  return writeXlsx([
    { name: '摘要', cols: [26, 16, 46, 14, 14, 14, 14], rows: sum.map(r => r.map(fmt)) },
    { name: '明細', cols: [7, 14, 10, 22, 36, 24, 26, 7, 6, 12, 13, 6, 13, 13, 10, 14, 10, 6, 7, 22], rows, freeze: 'A2' },
  ], { title });
}
