// xlsx 寫出（純 Node）、成本表 xlsx 匯出、既有成本表轉成 BOM 並和原檔比對（評估平台 Q3）。
//   node --test studio/test/cost-xlsx.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeXlsx } from '../lib/xlsx-write.mjs';
import { costWorkbook } from '../lib/cost-xlsx.mjs';
import { importCostTable, readCostSummary, expectedFromSheet } from '../lib/cost-import.mjs';
import { readZip, xlsxSheets } from '../lib/office.mjs';
import { readCostSheet, seedFromCostTables } from '../lib/parts-seed.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';

const read = buf => Object.fromEntries(xlsxSheets(readZip(buf)).map(s => [s.name, s.rows]));
const cell = (rows, no, col) => rows.find(r => r.no === no)?.cells[col];

test('writeXlsx：中文工作表名稱、字串跳脫、數字、公式的快取值、百分比樣式，讀得回來', () => {
  const buf = writeXlsx([
    { name: '摘要', rows: [['項目', '金額'], ['A&B <測試> "引號"', { v: 1234.5, s: 'money' }], ['比例', { v: 0.15, s: 'pctInput' }], ['公式', { v: 2469, f: 'B2*2', s: 'money' }], [], ['布林', true]] },
    { name: '明細', cols: [10, 20], rows: [['x', { v: '文字公式', f: '"文字"&"公式"' }]], freeze: 'A2' },
  ], { title: '測試' });
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const s = read(buf);
  assert.deepEqual(s.摘要.find(r => r.no === 2).cells, ['A&B <測試> "引號"', '1234.5']);
  assert.equal(cell(s.摘要, 3, 1), '15%'); assert.equal(cell(s.摘要, 4, 1), '2469'); assert.equal(cell(s.摘要, 6, 1), 'TRUE');
  assert.ok(!s.摘要.some(r => r.no === 5), '空列不寫');
  assert.equal(cell(s.明細, 1, 1), '文字公式');
});

// 一份站的成本表（照各站的格式）：摘要（費率、預備費、稅、等級幅度、金額）＋明細
function stationXlsx(rows) {
  return writeXlsx([
    { name: '摘要', rows: [['測試站 預算級估價'], [], [], ['參數'], ['工程費率（NT$/人日）', 8000], ['技術費率（NT$/人日）', 5500], ['預備費率', { v: 0.15, s: 'pctInput' }], ['營業稅率（預算假設）', { v: 0.05, s: 'pctInput' }],
      [], ['估價等級與幅度'], ['等級', '幅度'], ['A', { v: 0.1, s: 'pctInput' }], ['B', { v: 0.2, s: 'pctInput' }], ['C', { v: 0.3, s: 'pctInput' }]] },
    { name: '明細', rows: [['編號', '子系統', '項目', '規格要求', '建議選型', '選型理由', '數量', '單位', '單價 NT$', '小計 NT$', '等級'], ...rows] },
  ]);
}

test('既有成本表轉成 BOM：市購品引用元件、價格不同時用成本表的單價、人日用費率、客製件；逐行與摘要和原檔一致；重轉先留快照', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-cost-'));
  let db;
  try {
    const file = join(dir, 'cost-estimate.xlsx');
    writeFileSync(file, stationXlsx([
      ['1-01', '1 手臂', 'SCARA 手臂＋控制器', '動作範圍 600 mm', 'DENSO HSR065', '構得到', 1, '套', 950000, null, 'B'],
      ['3-01', '3 視覺', '上視相機組', '5MP GigE', 'IDS GigE 5MP', '', 2, '組', 150000, null, 'B'],
      ['4-01', '4 治具', '組裝治具', 'SKD11', '自製', '', 2, '套', 90000, null, 'C'],
      ['5-01', '5 機台', '機台與外罩', '鋁擠外罩', '自製', '', 1, '式', 380000, null, 'C'],
      ['6-01', '6 工程', '機構設計', '', '—', '', 30, '人日', 8000, null, 'B'],
      ['6-02', '6 工程', '組立配線', '', '—', '', 25, '人日', 5500, null, 'B'],
      ['6-03', '6 工程', '外包驗證', '', '—', '', 2, '人日', 12000, null, 'C'],
      ['7-01', '7 選配', '雙吸嘴', '', '自製', '', 0, '組', 70000, null, 'C'],
    ]));
    db = openPartsDb(join(dir, 'studio.db'));
    const rows = readCostSheet(file);
    seedFromCostTables(db, [{ project: 'Demo', source: 'cost-estimate.xlsx', date: '2026-09-26', rows }]);
    const arm = db.findUsage('Demo', 'cost-estimate.xlsx', '1-01').part_id;
    db.addPrice(arm, { unit_price: 990000, grade: 'A', quoted_on: '2026-10-01' });       // 元件庫之後有新價格：轉換時仍用成本表上的 95 萬
    const r = importCostTable(db, { project: 'Demo', source: 'cost-estimate.xlsx', file });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual([r.lines, r.parts, r.labor, r.custom], [8, 4, 3, 1], '「自製」但不是「一式」的治具與選配也在元件庫（seed 的規則）；自製的一式是客製件');
    assert.equal(r.cached, false, '原檔沒有存公式結果：用原本的公式重算比對');
    const g = db.bom.get('@Demo'), L = Object.fromEntries(g.lines.map(l => [l.line, l]));
    assert.deepEqual([L['1-01'].source, L['1-01'].unit_twd], ['override', 950000], '和元件的參考單價不同：用成本表的單價');
    assert.deepEqual([L['3-01'].source, L['3-01'].code !== ''], ['version', true], '一樣就用元件版本的單價');
    assert.deepEqual([L['6-01'].source, L['6-02'].labor, L['6-03'].source], ['labor', 'tech', 'labor-override']);
    assert.deepEqual([L['7-01'].nature, L['4-01'].source, L['5-01'].source], ['option', 'version', 'custom']);
    assert.equal(g.summary.subtotal, 950000 + 300000 + 180000 + 380000 + 240000 + 137500 + 24000);
    assert.equal(g.settings.contingency, 0.15);
    // 重轉：原本有內容就先留快照
    importCostTable(db, { project: 'Demo', source: 'cost-estimate.xlsx', file });
    assert.deepEqual(db.bom.get('@Demo').snapshots.map(s => s.name), ['從成本表轉換前']);
    // 匯出的 xlsx 用同一套讀法讀回來：逐行與摘要的快取值和平台一致（欄位也讀得懂）
    const out = join(dir, 'export.xlsx'); writeFileSync(out, costWorkbook(g, { title: '測試站' }));
    const back = readCostSheet(out).filter(x => x.sheet === '明細'), sum = readCostSummary(out), exp = expectedFromSheet(back, sum);
    assert.ok(exp.cached, '匯出的檔案有存公式結果');
    for (const k of ['subtotal', 'total', 'low', 'high', 'taxed']) assert.equal(exp.totals[k], g.summary[k], k);
    assert.deepEqual(back.map(x => x.kind), ['設備與材料', '設備與材料', '設備與材料', '設備與材料', '工程人日', '工程人日', '工程人日', '選配']);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});
