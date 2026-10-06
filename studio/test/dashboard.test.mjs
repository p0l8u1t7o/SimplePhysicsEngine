// 儀表板的彙整：代理執行統計、檢查結果合併、元件資料庫統計。
//   node --test studio/test/dashboard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRounds, agentStats, checkStats } from '../lib/dashboard.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';

test('每輪紀錄：壞掉的列略過，檔案不存在回傳空陣列', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-dash-')), f = join(dir, 'rounds.jsonl');
  try {
    assert.deepEqual(readRounds(f), []);
    writeFileSync(f, '{"round":1,"role":"plan"}\n{"round":2,"ro\n\n{"check":"quick","ok":true}\n');
    assert.deepEqual(readRounds(f).map(r => r.round ?? r.check), [1, 'quick']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('代理執行統計：合計、各角色依 CLI 分開、每天、最近幾輪', () => {
  const today = new Date(2026, 9, 5, 15), at = (d, h = 10) => new Date(2026, 9, 5 - d, h).toISOString();
  const s = agentStats([
    { id: 'A', title: '甲站', rounds: [
      { round: 1, role: 'plan', cli: 'claude', startedAt: at(2), seconds: 600, ok: true },
      { round: 2, role: 'build', cli: 'claude', startedAt: at(2, 11), seconds: 1800, ok: true, costUsd: 1.5 },
      { check: 'quick', at: at(2, 12), ok: true, seconds: 30 },                      // 不是代理的輪，不算
      { round: 3, role: 'build', cli: 'codex', startedAt: at(0), seconds: 1200, ok: false, violations: ['x', 'y'] }] },
    { id: 'B', title: '乙站', rounds: [{ round: 1, role: 'render', cli: 'codex', startedAt: at(30), seconds: 300, ok: true }] },     // 超過 14 天：算進合計，不在每天的圖上
  ], { days: 14, today, recent: 2 });
  assert.deepEqual(s.totals, { rounds: 4, seconds: 3900, failed: 1, violations: 2, costUsd: 1.5, projects: 2 });
  assert.deepEqual(s.clis, ['claude', 'codex']);
  const build = s.byRole.find(r => r.role === 'build');
  assert.deepEqual([build.rounds, build.seconds, build.failed, build.byCli.claude.seconds, build.byCli.codex.seconds], [2, 3000, 1, 1800, 1200]);
  assert.equal(s.daily.length, 14); assert.equal(s.daily.at(-1).day, '2026-10-05');
  assert.deepEqual(s.daily.filter(d => d.rounds).map(d => [d.day, d.rounds, d.seconds]), [['2026-10-03', 2, 2400], ['2026-10-05', 1, 1200]]);
  assert.deepEqual(s.recent.map(r => [r.id, r.round, r.ok, r.violations]), [['A', 3, false, 2], ['A', 2, true, 0]]);
  assert.equal(agentStats([]).totals.rounds, 0);
});

test('檢查結果：快速與完整兩份取每一項最新的那次', () => {
  const s = checkStats([
    { at: '2026-10-05T10:00:00Z', quick: false, results: [{ project: 'A', check: 'scene', ok: false, note: '2 筆干涉' }, { project: 'A', check: 'ui', ok: true }] },
    { at: '2026-10-05T11:00:00Z', quick: true, results: [{ project: 'A', check: 'scene', ok: true }, { project: 'A', check: 'names', ok: true }, { project: 'B', check: 'layout', ok: false, note: '超出' }] },
  ]);
  assert.deepEqual(s.A, { at: '2026-10-05T11:00:00Z', passed: 3, failed: 0, failures: [] });     // scene 後來通過了，ui 只在完整檢查跑過
  assert.deepEqual(s.B.failures, [{ check: 'layout', note: '超出' }]);
  assert.deepEqual(checkStats([]), {});
});

test('元件資料庫統計：類別、專案、各成本表金額、到期提醒、待整理', () => {
  const db = openPartsDb(':memory:');
  assert.deepEqual(db.overview('2026-10-05').quality, { total: 0, uncategorized: 0, unpriced: 0, noSupplier: 0, pending: 0 });
  const s = db.createSupplier({ name: '甲代理商' });
  const cam = db.createPart({ name: '相機', category: '相機與讀碼' }), lens = db.createPart({ name: '鏡頭' }), usd = db.createPart({ name: '感測器', category: '量測與感測' });
  db.createPart({ name: '還沒報價的', category: '相機與讀碼' });
  db.addPrice(cam.id, { unit_price: 20000, quoted_on: '2026-09-01', supplier_id: s.id, valid_until: '2026-10-01' });       // 已過期
  db.addPrice(lens.id, { unit_price: 6500, quoted_on: '2026-09-01', valid_until: '2026-10-20' });                          // 30 天內到期
  db.addPrice(usd.id, { unit_price: 900, currency: 'USD', quoted_on: '2026-09-01', valid_until: '2027-01-01' });           // 還早；不是新台幣不算金額
  db.addUsage(cam.id, { project: 'X', source: 'cost.xlsx', item_code: '1', qty: 4 });
  db.addUsage(lens.id, { project: 'X', source: 'cost.xlsx', item_code: '2', qty: 2 });
  db.addUsage(usd.id, { project: 'X', source: 'cost.xlsx', item_code: '3', qty: 1 });
  db.addUsage(cam.id, { project: 'Y', source: '', item_code: '', qty: 0 });       // 選配：數量 0
  const o = db.overview('2026-10-05');
  assert.deepEqual([o.parts, o.prices, o.usages, o.suppliers], [4, 3, 4, 1]);
  assert.deepEqual(o.categories, [{ name: '視覺 › 相機與讀碼', count: 2 }, { name: '', count: 1 }, { name: '感測與量測 › 量測與感測', count: 1 }], '類別用分類樹的完整路徑');
  assert.deepEqual(o.projects, [{ name: 'X', parts: 3 }, { name: 'Y', parts: 1 }]);
  assert.deepEqual(o.sources, [{ project: 'X', source: 'cost.xlsx', items: 3, amount: 4 * 20000 + 2 * 6500 }, { project: 'Y', source: '', items: 1, amount: 0 }]);
  assert.deepEqual(o.expiring.map(x => [x.name, x.valid_until, x.supplier]), [['相機', '2026-10-01', '甲代理商'], ['鏡頭', '2026-10-20', null]]);
  assert.deepEqual(o.quality, { total: 4, uncategorized: 1, unpriced: 1, noSupplier: 2, pending: 0 });
  db.close();
});
