// 視角名稱解析（core/tools/views.mjs）：註解、字串、巢狀都不能讓後面的視角被漏掉
import test from 'node:test';
import assert from 'node:assert/strict';
import { viewNames } from '../views.mjs';

test('註解後面的視角也要讀到（2026-11-08 以前會漏）', () => {
  const src = `const views = {
    iso: () => [[1, 2, 3], [0, 0, 0]],
    // 狀態燈：在外罩頂（其他視角拍不到）
    status: () => { const p = f({ a: 1 }); return [p, 'x,y']; },
    /* 區塊註解: 也要跳過 */ top: () => [[0, 1, 0], [0, 0, 0]],
    'quoted-key': () => [[1, 1, 1], [0, 0, 0]],
  };`;
  assert.deepEqual(viewNames(src), ['iso', 'status', 'top', 'quoted-key']);
});

test('沒有字面值的視角物件時退回 iso', () => assert.deepEqual(viewNames('const VIEWS = plan.views;'), ['iso']));
