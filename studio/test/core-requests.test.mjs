// core 缺功能的自動登記（lib/core-requests.mjs）：加到「待處理」最上面、格式同 REQUESTS.md、去重、遮名稱、部署版寫到工作區
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCoreRequests, coreRequestCount } from '../lib/core-requests.mjs';

const setup = repo => {
  const ws = mkdtempSync(join(tmpdir(), 'creq-')), dir = join(ws, repo ? 'project-site' : 'projects', 'Demo'), studio = join(dir, '.studio');
  mkdirSync(studio, { recursive: true });
  if (repo) { mkdirSync(join(ws, 'core')); writeFileSync(join(ws, 'core', 'REQUESTS.md'), '# core 需求登記\n\n說明。\n\n## 待處理\n\n### 舊的需求\n- 提出：X\n'); }
  return { ws, J: { id: 'Demo', dir, studio, repo } };
};

test('本庫：加到 core/REQUESTS.md 的待處理最上面，格式相同、遮掉用戶名稱、不重複登記', () => {
  const { ws, J } = setup(true);
  try {
    writeFileSync(join(J.studio, 'core-requests.json'), JSON.stringify([
      { title: '輸送帶模型加 甲公司 款式的側板', why: '現場是甲公司的機台', workaround: 'web/js/conveyor-side.js 的 sidePanel()', interface: 'conveyor.create({ sidePanel })', impact: '輸送線的站' },
      { title: '舊的需求', workaround: 'x' }, { workaround: '沒有標題' }]));
    const r = registerCoreRequests(ws, J, { names: ['甲公司'], date: '2026-11-14' });
    assert.deepEqual(r.added, ['輸送帶模型加 （用戶） 款式的側板']);
    assert.deepEqual(r.invalid, ['有一筆沒有 title']);
    const md = readFileSync(join(ws, 'core', 'REQUESTS.md'), 'utf8');
    assert.match(md, /## 待處理\n\n### 輸送帶模型加 （用戶） 款式的側板\n- 提出：Demo（2026-11-14，3D工作室代理自動登記，待主 session 判斷）\n- 現象：現場是（用戶）的機台\n- 暫代：web\/js\/conveyor-side\.js 的 sidePanel\(\)\n/);
    assert.ok(md.indexOf('輸送帶模型') < md.indexOf('### 舊的需求'), '新的在最上面');
    assert.ok(!md.includes('甲公司'));
    const again = registerCoreRequests(ws, J, { names: ['甲公司'] });     // 同一個檔再跑一次：不重複
    assert.deepEqual(again.added, []); assert.equal(again.file, null);
    assert.equal(coreRequestCount(J), 2);       // 新登記的＋早就在清單裡的
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('部署版的工作區：寫到 <工作區>/.studio/core-requests.md', () => {
  const { ws, J } = setup(false);
  try {
    writeFileSync(join(J.studio, 'core-requests.json'), JSON.stringify({ title: '料箱模型加隔板', workaround: 'web/js/bin.js' }));
    const r = registerCoreRequests(ws, J, { date: '2026-11-14' });
    assert.deepEqual(r.added, ['料箱模型加隔板']);
    assert.match(readFileSync(join(ws, '.studio', 'core-requests.md'), 'utf8'), /^# core 需求[\s\S]*## 待處理\n\n### 料箱模型加隔板\n- 提出：Demo/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
