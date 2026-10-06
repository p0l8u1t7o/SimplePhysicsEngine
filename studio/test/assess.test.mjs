// 評估流程（評估平台 Q6）：專案組成、可行性分析與 BOM 的格式檢查、BOM 匯入、平台檢查、只做評估的完整流程與修改評估（假代理）。
//   node --test studio/test/assess.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ADAPTERS } from '../lib/adapters/index.mjs';
import { adapters as fakeAdapters } from './fake-adapters.mjs';
import { initWorkspace, createProject, projectPaths, paths, setReadOnly } from '../lib/workspace.mjs';
import { runProject, loadState } from '../lib/loop.mjs';
import { recordAnswer, loadQuestions } from '../lib/questions.mjs';
import { openPartsDb } from '../lib/partsdb.mjs';
import { cleanComponents, componentsOf, checkFeasibility, checkBomJson, importBom, checkProject, bomToJson, FEAS_SECTIONS } from '../lib/assess.mjs';
import { readJson, writeJson } from '../lib/util.mjs';
import { TASK } from '../lib/prompts.mjs';

Object.assign(ADAPTERS, fakeAdapters);
const md = FEAS_SECTIONS.map(([s]) => `## ${s}\n\n內容\n`).join('\n');
const feas = { verdict: '有條件可行', summary: '可以', conditions: ['打樣'], risks: [{ risk: 'r', mitigation: 'm' }], poc: [{ item: 'p' }], cycle: { target: 10, estimate: 8 } };

test('專案組成：至少一項、只能是三種；舊專案視為只有 3D；規劃的任務依組成換內容', () => {
  assert.deepEqual(cleanComponents('aoi, ASSESS'), ['assess', 'aoi']);
  assert.throws(() => cleanComponents(''), /至少要選一項/);
  assert.throws(() => cleanComponents('assess,video'), /只能是/);
  assert.deepEqual(componentsOf({}), ['3d']);
  const only = TASK.plan({ components: ['assess'] }), both = TASK.plan({ components: ['assess', '3d'] }), old = TASK.plan();
  assert.ok(only.includes('feasibility.json') && only.includes('bom.json') && only.includes('只做評估') && !only.includes('.studio/plan/parts.json'));
  assert.ok(both.includes('第一段範圍') && both.includes('bom.json'));
  assert.ok(old.includes('.studio/plan/parts.json') && !old.includes('feasibility'));
});

test('可行性分析：章節、結論、條件、風險、節拍和 3D 排程對照', () => {
  assert.equal(checkFeasibility(md, feas).ok, true);
  const r = checkFeasibility('# 結論\n\n只有結論', { ...feas, verdict: '還行', conditions: [], risks: [{ risk: 'x' }] });
  assert.ok(r.errors.some(e => /缺少章節「節拍核算」/.test(e)));
  assert.ok(r.errors.some(e => /verdict/.test(e)));
  assert.ok(r.errors.some(e => /risks 第 1 項/.test(e)));
  assert.ok(checkFeasibility(md, { ...feas, conditions: [] }).errors.some(e => /有條件可行要列出 conditions/.test(e)));
  assert.ok(checkFeasibility(md, feas, { scheduleTotal: 12 }).warnings.some(e => /3D 排程的總長 12\.00 s 不一致/.test(e)));
  assert.equal(checkFeasibility(md, null).ok, false);
});

test('BOM：市購品要引用或列成新元件、客製件只能是加工件類、工程人日、行號不重複', () => {
  const find = c => c === 'P-00001' ? { code: c } : null;
  const ok = checkBomJson({ items: [{ line: '1', ref: 'P-00001', qty: 2 }, { line: '2', name: '光源', category: '光源', spec: '白光', estimate: 100 }, { line: '3', custom: true, name: '定位治具', estimate: 5 }, { line: '4', labor: 'eng', name: '設計', qty: 3 }] }, { findByCode: find });
  assert.equal(ok.ok, true, ok.errors.join('；'));
  const bad = checkBomJson({ items: [{ line: '1', ref: 'P-09999' }, { line: '1', custom: true, name: '伺服馬達', estimate: 5 }, { line: '3', name: '感測器' }, { line: '4', labor: 'boss', name: 'x' }, { line: '5', qty: -1, custom: true, name: '機架' }] }, { findByCode: find });
  assert.ok(bad.errors.some(e => /P-09999 不存在/.test(e)));
  assert.ok(bad.errors.some(e => /行號重複/.test(e)));
  assert.ok(bad.errors.some(e => /「伺服馬達」標成客製件/.test(e)));
  assert.ok(bad.errors.some(e => /是新元件，要寫 name、category 與 spec/.test(e)));
  assert.ok(bad.errors.some(e => /labor 只能是/.test(e)));
  assert.ok(bad.errors.some(e => /qty 要是 0 以上/.test(e)) && bad.errors.some(e => /客製件要寫 estimate/.test(e)));
});

test('BOM 匯入：沿用鎖定版本、新元件待確認並記估價、客製與工程行；重新匯入前留快照；平台檢查', () => {
  const db = openPartsDb(':memory:');
  try {
    const cam = db.createPart({ name: '相機', model: 'C1' }); db.addPrice(cam.id, { unit_price: 20000, grade: 'A' });
    const bom = { items: [
      { line: '3-01', section: '3 視覺', ref: cam.code, qty: 2 },
      { line: '3-02', section: '3 視覺', name: '環形光源', model: 'R90', spec: '白光', category: '光源', unit: '組', qty: 2, estimate: 8000 },
      { line: '4-01', section: '4 治具', custom: true, name: '定位治具', qty: 1, estimate: 90000 },
      { line: '6-01', section: '6 工程', labor: 'eng', name: '機構設計', qty: 10 },
    ] };
    const r = importBom(db, 'Demo', bom, { redact: s => s.replace('R90', '（用戶）') });
    assert.deepEqual([r.lines, r.reused, r.created, r.custom, r.labor, r.snapshot], [4, 1, 1, 1, 1, null]);
    const b = db.bom.get('Demo'), L = Object.fromEntries(b.lines.map(l => [l.line, l]));
    assert.equal(L['3-01'].subtotal, 40000); assert.equal(L['3-01'].part_version, db.findByCode(cam.code).version, '鎖定匯入當下的最新版');
    const light = db.findByCode(L['3-02'].code);
    assert.equal(light.status, '待確認'); assert.equal(light.model, '（用戶）', '匯入時替換不得顯示的名稱');
    assert.equal(L['3-02'].price, 8000); assert.equal(L['3-02'].grade, 'C'); assert.ok(L['3-02'].flags.includes('pending'));
    assert.equal(L['4-01'].subtotal, 90000); assert.equal(L['6-01'].subtotal, 80000, '工程人日用預設費率 8000');
    assert.equal(db.getPart(cam.id).usages.length, 1, '市購品記使用紀錄');
    assert.throws(() => importBom(db, 'Demo', { items: [{ custom: true, name: '伺服馬達', estimate: 1 }] }), /BOM 有問題/);
    // 平台檢查：沒有可行性分析是失敗；待確認的元件是警告；成本只警告
    let c = Object.fromEntries(checkProject(db, 'Demo').map(x => [x.check, x]));
    assert.equal(c.feasibility.level, 'fail'); assert.equal(c.bom.level, 'warn'); assert.equal(c.cost.ok, true);
    db.assess.save('Demo', 'feasibility', { content: md, data: feas });
    c = Object.fromEntries(checkProject(db, 'Demo').map(x => [x.check, x]));
    assert.equal(c.feasibility.ok, true); assert.match(c.feasibility.note, /第 1 版，結論「有條件可行」/);
    // 匯出成 bom.json 再匯入：留快照、行不變
    const again = importBom(db, 'Demo', bomToJson(db, 'Demo'));
    assert.ok(again.snapshot?.id); assert.equal(db.bom.get('Demo').summary.total, b.summary.total);
    assert.equal(db.assess.save('Demo', 'feasibility', { content: md, data: { ...feas, verdict: '可行' } }).version, 2);
    assert.equal(db.assess.history('Demo', 'feasibility').length, 2);
    assert.deepEqual(db.assess.verdicts().map(v => [v.project, v.verdict]), [['Demo', '可行']]);
  } finally { db.close(); }
});

let ws, dbFile;
before(() => { ws = mkdtempSync(join(tmpdir(), 'vs3d-assess-')); dbFile = join(ws, 'studio.db'); process.env.VS3D_DB = dbFile; initWorkspace(ws, { log: () => {} }); });
after(() => { delete process.env.VS3D_DB; for (const d of [paths(ws).core, paths(ws).pristine]) setReadOnly(d, false); rmSync(ws, { recursive: true, force: true }); });

test('只做評估的專案（假代理）：格式不對退回 → 提案確認 → 存進資料庫、不進 3D → 修改評估', async () => {
  const J = await createProject(ws, { id: 'Quote', title: '報價評估', prompt: '輸送帶＋龍門取放' });
  writeJson(J.studioJson, { ...readJson(J.studioJson, {}), components: ['assess'] });
  const logs = [], opts = { override: { cli: 'fake', roles: {} }, full: false, shots: false, review: false, render: false, stage2: false, log: s => logs.push(s) };
  let r = await runProject(ws, 'Quote', opts);
  assert.equal(r.status, 'waiting');
  recordAnswer(J, loadQuestions(J).list[0], { choices: [0] });
  r = await runProject(ws, 'Quote', opts);           // 寫提案與評估檔（相機標成客製）→ 退回 → 修正 → 提案確認卡片
  assert.equal(r.status, 'waiting', logs.join('\n'));
  assert.ok(logs.some(l => /可行性分析或 BOM的格式不對/.test(l)), '格式不對要退回');
  const card = loadQuestions(J).list.find(q => !q.answered);
  assert.match(card.question, /確認後存進資料庫並產生成本表/);
  recordAnswer(J, card, { choices: [0] });
  r = await runProject(ws, 'Quote', opts);
  assert.equal(r.status, 'done', logs.join('\n'));
  const s = loadState(J);
  assert.equal(s.buildStarted, undefined, '沒勾 3D 就不開發');
  assert.ok(!existsSync(join(J.dir, 'tools', 'verify.mjs')) || !/fixed\.txt/.test(readFileSync(join(J.dir, 'tools', 'verify.mjs'), 'utf8')));
  let db = openPartsDb(dbFile);
  try {
    assert.equal(db.assess.latest('Quote', 'feasibility').verdict, '有條件可行');
    assert.equal(db.assess.latest('Quote', 'proposal').version, 1);
    const b = db.bom.get('Quote');
    assert.deepEqual(b.lines.map(l => l.line), ['3-01', '4-01', '6-01']);
    assert.equal(db.findByCode(b.lines[0].code).status, '待確認');
    assert.ok(checkProject(db, 'Quote').every(c => c.ok));
  } finally { db.close(); }

  // 修改評估：資料庫的版本寫回 → 規劃角色改（結論改成可行、加一行安裝）→ 存回，BOM 重新匯入前留快照
  Object.assign(s, { stage: 'assess-revise', flow: 'assess', assessRequest: '節拍有餘裕，結論改成可行；加現場安裝', assessRevised: false, waiting: null });
  writeJson(J.state, s);
  r = await runProject(ws, 'Quote', opts);
  assert.equal(r.status, 'done', logs.join('\n'));
  db = openPartsDb(dbFile);
  try {
    assert.equal(db.assess.latest('Quote', 'feasibility').version, 2);
    assert.equal(db.assess.latest('Quote', 'feasibility').verdict, '可行');
    assert.match(db.assess.latest('Quote', 'feasibility').note, /依要求修改/);
    assert.deepEqual(db.bom.get('Quote').lines.map(l => l.line), ['3-01', '4-01', '6-01', '6-02']);
    assert.equal(db.bom.snapshots('Quote').length, 1);
  } finally { db.close(); }
  assert.equal(loadState(J).stage, 'done');
});
