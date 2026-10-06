// 代理佇列（評估平台 Q1）：依序一次跑一個、同一個專案不重複排、可以取消排隊、記下啟動的人；儀表板依人統計。
//   node --test studio/test/queue.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRunner } from '../lib/runner.mjs';
import { agentStats } from '../lib/dashboard.mjs';

test('佇列：依序執行、同專案不重複、取消排隊、輸出與結束事件', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'vs3d-queue-'));
  try {
    const exits = [], lines = [];
    let done; const all = new Promise(r => { done = r; });
    // 用不存在的子指令：vs3d 印出說明就結束，很快
    const runner = createRunner(ws, { onLine: (id, l) => lines.push([id, l]), onExit: id => { exits.push(id); if (exits.length === 2) done(); } });
    assert.deepEqual(runner.start('help', 'A', [], { by: 'amy' }).position, 0, '閒置時馬上開始');
    assert.equal(runner.current.id, 'A'); assert.equal(runner.current.by, 'amy');
    const b = runner.start('help', 'B', [], { by: 'bob' }), c = runner.start('help', 'C');
    assert.deepEqual([b.position, c.position], [1, 2]);
    assert.throws(() => runner.start('help', 'A'), /已經在執行或排隊/);
    assert.throws(() => runner.start('help', 'B'), /已經在執行或排隊/);
    assert.equal(runner.cancel(b.qid).id, 'B'); assert.equal(runner.cancel(b.qid), null);
    assert.deepEqual(runner.queue.map(q => q.id), ['C']);
    await all;
    assert.deepEqual(exits, ['A', 'C'], 'B 取消了，A 結束後換 C');
    assert.ok(lines.some(([id, l]) => id === 'B' && l.includes('已取消排隊')));
    assert.ok(lines.some(([id, l]) => id === 'C' && l.includes('前面還有 2 筆')));
    assert.equal(runner.current, null); assert.deepEqual(runner.queue, []);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('儀表板：依啟動的人統計', () => {
  const t = new Date('2026-10-06T10:00:00Z');
  const r = agentStats([{ id: 'A', title: 'A', rounds: [
    { role: 'build', ok: true, seconds: 60, startedAt: t, by: 'amy', costUsd: 1 },
    { role: 'fix', ok: true, seconds: 30, startedAt: t, by: 'amy' },
    { role: 'plan', ok: true, seconds: 120, startedAt: t } ] }], { today: t });
  assert.deepEqual(r.byUser.map(u => [u.user, u.rounds, u.seconds, u.costUsd]), [['', 1, 120, 0], ['amy', 2, 90, 1]]);
  assert.equal(r.recent.find(x => x.role === 'build').by, 'amy');
});
