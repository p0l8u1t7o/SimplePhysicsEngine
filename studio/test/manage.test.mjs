// 專案管理：取消進行中的流程、刪除工作區的專案；給代理用的元件清單。
//   node --test studio/test/manage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cancelFlow, loadState } from '../lib/loop.mjs';
import { deleteProject, projectPaths, paths } from '../lib/workspace.mjs';
import { readRounds } from '../lib/dashboard.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';
import { catalogMarkdown, writeCatalog } from '../lib/parts-catalog.mjs';
import { handoff } from '../lib/prompts.mjs';
import { writeJson } from '../lib/util.mjs';

// 最小的工作區：有標記檔與一個專案（不需要 core）
function workspace(state) {
  const ws = mkdtempSync(join(tmpdir(), 'vs3d-manage-')), J = projectPaths((writeJson(join(ws, 'studio-workspace.json'), {}), ws), 'Demo');
  mkdirSync(J.questions, { recursive: true });
  writeJson(J.studioJson, {}); writeJson(J.state, state);
  writeJson(join(J.questions, 'q1.json'), { id: 'q1', question: '要嗎？', options: [{ label: '要' }, { label: '不要' }] });
  writeJson(join(J.questions, 'q0.json'), { id: 'q0', question: '舊問題？', options: [{ label: '甲' }, { label: '乙' }] });
  writeJson(join(J.answers, 'q0.json'), { id: 'q0', choices: [0] });
  return { ws, J };
}

test('取消流程：回到完成、還沒回答的問題收起來、已回答的留著', () => {
  const { ws, J } = workspace({ stage: 'render', flow: 'render', round: 7, sessions: {}, waiting: 'q1', reviews: 2, renderTries: 1 });
  try {
    const r = cancelFlow(ws, 'Demo');
    assert.deepEqual([r.from, r.questions], ['render', 1]);
    const s = loadState(J);
    assert.deepEqual([s.stage, s.flow, s.waiting, s.round, s.reviews], ['done', null, null, 7, 2]);
    assert.deepEqual(readdirSync(J.questions).sort(), ['cancelled', 'q0.json']);
    assert.deepEqual(readdirSync(join(J.questions, 'cancelled')), ['q1.json']);
    assert.equal(readRounds(J.rounds).at(-1).cancel, 'render');
    assert.equal(existsSync(join(paths(ws).app, 'run.lock')), false, '執行鎖已放開');
    assert.throws(() => cancelFlow(ws, 'Demo'), /沒有進行中的流程/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('取消流程：第二段做到一半回到第一段完成；第一段還沒完成的不能取消', () => {
  let { ws, J } = workspace({ stage: 'build', segment: 2, round: 12, sessions: {}, segments: { 1: { rounds: 9 } } });
  try { cancelFlow(ws, 'Demo'); assert.deepEqual([loadState(J).stage, loadState(J).segment], ['done', 1]); } finally { rmSync(ws, { recursive: true, force: true }); }
  ({ ws, J } = workspace({ stage: 'build', round: 2, sessions: {} }));
  try { assert.throws(() => cancelFlow(ws, 'Demo'), /第一段還沒完成/); assert.equal(loadState(J).stage, 'build'); } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('刪除專案：移到工作區的 .studio/trash/，可以搬回來', () => {
  const { ws, J } = workspace({ stage: 'done', round: 3, sessions: {} });
  try {
    writeFileSync(join(J.dir, 'keep.txt'), '內容');
    const dest = deleteProject(ws, 'Demo');
    assert.equal(existsSync(J.dir), false);
    assert.match(dest.replace(/\\/g, '/'), /\/\.studio\/trash\/Demo-\d{14}$/);
    assert.equal(readFileSync(join(dest, 'keep.txt'), 'utf8'), '內容');
    assert.throws(() => deleteProject(ws, 'Demo'), /找不到專案/);
    assert.throws(() => deleteProject(ws, '..'), /找不到專案/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('給代理用的元件清單：依群組與類別分段、沿用編號、遮掉用戶名稱；交接摘要會提到', () => {
  const { ws, J } = workspace({ stage: 'plan', round: 0, sessions: {} });
  const file = join(ws, 'parts.db');
  try {
    assert.equal(writeCatalog(J, { file }), 0, '資料庫不存在就不寫');
    assert.equal(existsSync(file), false, '也不會順手建立空的資料庫');
    const db = openPartsDb(file);
    let md; try {
    const cam = db.createPart({ name: '工業相機', category: '相機與讀碼', brand: 'Basler', model: 'ace 2', spec: '500 萬|GigE', unit: '台', attrs: { 介面: 'GigE' }, selection_note: '甲客戶指定' });
    db.addPrice(cam.id, { unit_price: 20000, grade: 'B', quoted_on: '2026-10-01' });
    db.addUsage(cam.id, { project: 'RecycleSorter', item_code: '2-01', qty: 4 });
    db.createPart({ name: '自訂的東西', category: '我的類別', grp: '我的群組' });
    db.createPart({ name: '沒分類的' });
    md = catalogMarkdown(db, { today: '2026-10-05' });
    assert.match(md, /^# 元件資料庫清單（2026-10-05，3 個元件）/);
    assert.ok(md.indexOf('## 視覺') < md.indexOf('## 我的群組') && md.indexOf('## 我的群組') < md.indexOf('## 未分類'), '預設群組在前、自訂的其次、未分類的最後');
    assert.match(md, new RegExp(`\\| ${cam.code} \\| 工業相機 \\| Basler \\| ace 2 \\| 500 萬／GigE；介面：GigE \\| 台 \\| NT\\$20,000（B） \\| RecycleSorter \\| 甲客戶指定 \\|`));
    } finally { db.close(); }
    assert.equal(writeCatalog(J, { file, redact: s => s.split('甲客戶').join('（用戶）') }), 3);
    const text = readFileSync(join(J.studio, 'parts-catalog.md'), 'utf8');
    assert.ok(text.includes('（用戶）指定') && !text.includes('甲客戶'));
    assert.match(handoff({ J }), /元件資料庫清單：`\.studio\/parts-catalog\.md`/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
