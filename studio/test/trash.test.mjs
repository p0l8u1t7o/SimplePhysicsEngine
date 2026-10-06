// 回收桶（評估平台 Q1）：列出刪除的專案、依天數或名稱永久刪除（含 git 的唯讀檔）。
//   node --test studio/test/trash.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { paths, listTrash, purgeTrash } from '../lib/workspace.mjs';
import { cleanSystem } from '../lib/settings.mjs';

test('回收桶：列出（新的在前、大小、刪除時間）、清掉超過天數的、刪掉指定的', () => {
  const ws = mkdtempSync(join(tmpdir(), 'vs3d-trash-'));
  try {
    const dir = join(paths(ws).app, 'trash');
    const make = (name, bytes) => { mkdirSync(join(dir, name, '.git', 'objects'), { recursive: true }); const f = join(dir, name, '.git', 'objects', 'x'); writeFileSync(f, Buffer.alloc(bytes)); chmodSync(f, 0o444); };
    assert.deepEqual(listTrash(ws), []);
    make('Old-20260901080000', 100); make('New-20261005120000', 50); make('Old-20261001000000', 10);
    const list = listTrash(ws);
    assert.deepEqual(list.map(x => [x.project, x.deletedAt, x.bytes]), [['New', '2026-10-05T12:00:00Z', 50], ['Old', '2026-10-01T00:00:00Z', 10], ['Old', '2026-09-01T08:00:00Z', 100]]);
    const purged = purgeTrash(ws, { olderThanDays: 30, now: Date.parse('2026-10-06T00:00:00Z') });
    assert.deepEqual(purged.map(x => x.name), ['Old-20260901080000'], '只清掉超過 30 天的；唯讀的 git 物件也刪得掉');
    assert.ok(!existsSync(join(dir, 'Old-20260901080000')));
    assert.throws(() => purgeTrash(ws, { name: '../projects' }), /回收桶裡沒有/, '只能刪清單裡的項目');
    purgeTrash(ws, { name: 'New-20261005120000' });
    assert.deepEqual(listTrash(ws).map(x => x.name), ['Old-20261001000000']);
    assert.deepEqual(purgeTrash(ws, {}), [], '沒給條件不刪任何東西');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('自動清理的天數：0～3650', () => {
  assert.deepEqual(cleanSystem({ 'trash.keepDays': '30' }), { 'trash.keepDays': 30 });
  assert.throws(() => cleanSystem({ 'trash.keepDays': -1 }), /0～3650/);
});
