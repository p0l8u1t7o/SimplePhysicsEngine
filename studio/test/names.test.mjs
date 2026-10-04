// 用戶名稱：名單合併、遮蔽、core 的 check-names 掃描
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addClientNames, readClientNames, redactNames, namesFile } from '../lib/workspace.mjs';
import { scan } from '../../core/tools/check-names.mjs';

test('用戶名稱：名單合併與遮蔽', () => {
  const ws = mkdtempSync(join(tmpdir(), 'vs3d-names-'));
  try {
    assert.deepEqual(readClientNames(ws), []);
    assert.deepEqual(addClientNames(ws, ['甲公司', ' 甲 ', '', '# 註解']), ['甲公司', '甲']);
    assert.deepEqual(addClientNames(ws, ['甲']), []);                 // 重複的不再加
    assert.deepEqual(readClientNames(ws), ['甲公司', '甲']);
    assert.match(readFileSync(namesFile(ws), 'utf8'), /^# /);
    assert.equal(redactNames('幫甲公司規劃，甲的需求', readClientNames(ws)), '幫（用戶）規劃，（用戶）的需求');   // 長的先換
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('用戶名稱：check-names 掃內容與檔名', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-scan-'));
  try {
    const a = join(dir, 'a.js'), b = join(dir, '乙站.md'), c = join(dir, '乙圖.png');
    writeFileSync(a, 'ok\n// 乙 的設備\n'); writeFileSync(b, 'clean'); writeFileSync(c, '乙');
    const hits = scan([a, b, c], ['乙']);
    assert.deepEqual(hits.map(h => [h.file === a ? 'a' : h.file === b ? 'b' : 'c', h.line]), [['a', 2], ['b', 0], ['c', 0]]);   // 圖片只看檔名
    assert.deepEqual(scan([a], []), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
