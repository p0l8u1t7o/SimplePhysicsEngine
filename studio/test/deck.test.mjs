// 評估簡報（lib/deck.mjs）的純函式：Markdown 章節、截圖挑選、給 Python 的資料（名稱遮蔽、成本分段）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdSections, pickShots, deckData, findDeckKit } from '../lib/deck.mjs';

test('mdSections：章節取條列、拿掉 Markdown 標記、表格列併成一行', () => {
  const s = mdSections('# 配置提案\n\n## 1. 製程流程\n\n- **入料**輸送\n- 視覺 `cam`\n\n## 2. 站位配置\n\n| 項目 | 尺寸 |\n|---|---|\n| 輸送線 | 4.5 m |\n');
  assert.deepEqual(s['製程流程'], ['入料輸送', '視覺 cam']);
  assert.deepEqual(s['站位配置'], ['項目：尺寸', '輸送線：4.5 m']);
});

test('pickShots：iso 優先、每個視角一張（時間最晚）、圖說拿掉時間', () => {
  const r = pickShots(['d/abb@37.2.png', 'd/iso@0.png', 'd/iso@116.4.png', 'd/line@14.4.png', 'd/zz@1.png', 'd/aa@2.png'], 3);
  assert.deepEqual(r.map(x => x.caption), ['iso', 'aa', 'abb']);
  assert.equal(r[0].path, 'd/iso@116.4.png');
});

test('deckData：用戶名稱遮掉、站位不撞文件標題、成本依子系統分段', () => {
  const d = {
    title: '甲公司分揀機', at: new Date('2026-11-14T00:00:00Z'), shots: [], aoi: [],
    proposal: { version: 1, content: '# 配置提案\n\n## 製程流程\n\n- 甲公司的料先進輸送帶\n\n## 站位配置\n\n- 輸送線 4.5 m\n' },
    feasibility: { version: 2, verdict: '有條件可行', data: { verdict: '有條件可行', summary: '甲公司要先做 POC', conditions: ['間距 ≥ 150 mm'], risks: [{ risk: 'r', level: '高', mitigation: 'm' }] } },
    bom: { bom: { name: 'R1', updated_at: '2026-10-06T00:00:00Z' }, settings: { contingency: .15, tax: .05 },
      summary: { equipment: 100, labor: 50, laborDays: 2, contingency: 10, total: 160, low: 140, high: 190, taxed: 168, flags: {} },
      lines: [{ line: '1-01', section: '1 手臂', name: '手臂', qty: 1, unit: '台', subtotal: 80 }, { line: '1-02', section: '1 手臂', name: '夾爪', qty: 1, unit: '組', subtotal: 20 },
        { line: '2-01', section: '2 視覺', name: '相機', qty: 2, unit: '台', subtotal: 40 }] },
  };
  const x = deckData(d, { names: ['甲公司'] });
  assert.equal(x.title, '（用戶）分揀機');
  assert.equal(x.summary, '（用戶）要先做 POC');
  assert.deepEqual(x.process, ['（用戶）的料先進輸送帶']);
  assert.deepEqual(x.layout, ['輸送線 4.5 m']);
  assert.deepEqual(x.cost.sections, [{ name: '1 手臂', lines: 2, subtotal: 100 }, { name: '2 視覺', lines: 1, subtotal: 40 }]);
  assert.ok(!JSON.stringify(x).includes('甲公司'));
});

test('findDeckKit：VS3D_DECK_KIT 指到不完整的資料夾就回傳 null（只產生 xlsx）', () => {
  assert.equal(findDeckKit({ VS3D_DECK_KIT: 'Z:/no/such/kit' }), null);
});

test('簡報目視檢查與修改的提示：列出每頁圖片、輸出檔名、內容問題與修改範圍', async () => {
  const { taskPrompt } = await import('../lib/prompts.mjs');
  const J = { dir: 'D', id: 'X', repo: true, plan: 'D/.studio/plan', studio: 'D/.studio' }, base = { ws: 'W', J, adapter: {}, scope: 'S' };
  const p = taskPrompt('review', 'deckReview', { ...base, pngs: ['.studio/deck-render/slide-01.png', '.studio/deck-render/slide-02.png'], n: 2 });
  assert.match(p, /slide-02\.png/); assert.match(p, /\.studio\/reviews\/deck-2\.json/); assert.match(p, /"fix": "content"/);
  const q = taskPrompt('plan', 'deckRevise', { ...base, issues: [{ slide: 5, kind: 'overflow', where: '右欄', text: '很長的說明', suggestion: '縮短' }] });
  assert.match(q, /第 5 頁（overflow）右欄：很長的說明 → 縮短/); assert.match(q, /verdict）、成本金額與元件不要改/);
});
