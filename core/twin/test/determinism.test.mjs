// SPE-AC-09 決定性：同一串 hub>spe 訊息 → 兩個新的工作階段、兩個不同的 Node 行程輸出逐位元組相同；
// 靜態檢查 core/twin 沒有掛鐘、亂數、計時器，也沒有 import Automation-Schema（SPE-AC-25 (d)）
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { transcript, staticCheck } from './scenario.mjs';

test('兩個新的工作階段：輸出逐位元組相同', () => {
  const a = transcript(), b = transcript();
  assert.equal(a, b);
  assert.ok(a.length > 10000);
});

test('兩個不同的 Node 行程：輸出逐位元組相同', () => {
  const here = fileURLToPath(new URL('./determinism-run.mjs', import.meta.url));
  const run = () => execFileSync(process.execPath, [here], { encoding: 'utf8' });
  assert.equal(run(), run());
  assert.equal(run(), transcript() + '\n');
});

test('靜態檢查：core/twin/*.js 沒有掛鐘、亂數、計時器、node:*，也沒有 import Automation-Schema', () => {
  assert.deepEqual(staticCheck(), []);
});
