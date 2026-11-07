// cfdpack 的 gzip：loadPack／gunzipIfNeeded 自動解壓；範例頁的 demo.cfdpack.gz 讀得出來而且標示是假資料
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePack, gunzipIfNeeded } from '../../../core/cfd/pack.js';

const DEMO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core', 'examples', 'cfd', 'demo.cfdpack.gz');

test('gunzipIfNeeded：gzip 的解開、沒壓縮的原樣回傳', async () => {
  const raw = new Uint8Array([1, 2, 3, 250]);
  assert.deepEqual([...await gunzipIfNeeded(raw)], [...raw]);
  assert.deepEqual([...await gunzipIfNeeded(gzipSync(raw))], [...raw]);
});

test('範例頁的 demo.cfdpack.gz：解得開、是假資料、有切面與風力', async () => {
  const pack = decodePack(await gunzipIfNeeded(readFileSync(DEMO)));
  assert.equal(pack.case.synthetic, true);
  assert.ok(pack.obstacles.length >= 3);
  assert.ok(Array.isArray(pack.forces) && pack.forces.length >= 3);
});
