// 常見錯誤清單（lib/lessons.mjs）：只收 lesson、去重累計、遮名稱、停用的不給代理、改寫與刪除
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'lessons-'));
process.env.VS3D_LESSONS = join(dir, 'lessons.json');
const L = await import('../lib/lessons.mjs');
after(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.VS3D_LESSONS; });

test('審查必修項：只收 lesson、同一句累計次數與專案、遮掉用戶名稱', () => {
  let r = L.addLessons([{ issue: '甲站的夾爪穿進工件', lesson: '夾爪閉合時不能和工件重疊，要留 1 mm 以上間隙' }, { issue: '只有 issue 沒有 lesson' }, { lesson: '太短' }], { project: '@A' });
  assert.deepEqual(r, { added: 1, counted: 0 });
  r = L.addLessons([{ lesson: '夾爪閉合時，不能和工件重疊；要留 1mm 以上間隙。' }, { lesson: '標籤不能寫甲公司的名稱，要用中性描述' }], { project: 'B', names: ['甲公司'] });
  assert.deepEqual(r, { added: 1, counted: 1 });
  const items = L.listLessons();
  assert.equal(items[0].count, 2); assert.deepEqual(items[0].projects, ['@A', 'B']);
  assert.equal(items[1].text, '標籤不能寫（用戶）的名稱，要用中性描述');
});

test('寫給代理的清單：次數排序、停用的不列、全部停用就清空；改寫與刪除', () => {
  const J = { studio: join(dir, 'p', '.studio') }; mkdirSync(J.studio, { recursive: true });
  assert.equal(L.writeLessons(J), 2);
  const md = readFileSync(join(J.studio, 'lessons.md'), 'utf8');
  assert.ok(md.indexOf('夾爪閉合') < md.indexOf('標籤不能'), '次數高的在前'); assert.match(md, /（2）/);
  const [a, b] = L.listLessons();
  L.updateLesson(b.id, { disabled: true });
  assert.equal(L.writeLessons(J), 1); assert.ok(!readFileSync(join(J.studio, 'lessons.md'), 'utf8').includes('標籤不能'));
  L.updateLesson(a.id, { text: '夾爪閉合位置要和工件留 1 mm 以上間隙' });
  assert.equal(L.listLessons()[0].text, '夾爪閉合位置要和工件留 1 mm 以上間隙');
  assert.throws(() => L.updateLesson(a.id, { text: '短' }), /太短/);
  L.deleteLesson(a.id);
  assert.equal(L.writeLessons(J), 0); assert.equal(readFileSync(join(J.studio, 'lessons.md'), 'utf8'), '');
  assert.ok(existsSync(L.lessonsFile()));
});
