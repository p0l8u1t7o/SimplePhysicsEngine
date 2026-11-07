// 決定性的靜態與黃金值檢查：core-solar 不得用引擎相依的數學函式、時鐘或亂數；dmath 的輸出位元固定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../../math/dmath.js';
import { hashFloat64 } from '../hash.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..');   // core/solar 的模組（dmath 在 core/math，另外掃）

test('靜態：不用 Math 的超越函式、** 運算子、時鐘、亂數', () => {
  const bad = [];
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.js'))) {
    readFileSync(join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/\/\*\*.*?(\*\/|$)/g, '');   // 去掉註解與 JSDoc
      if (/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh|random)\(/.test(code)) bad.push(`${f}:${i + 1} Math 函式`);
      if (/\*\*/.test(code)) bad.push(`${f}:${i + 1} ** 運算子`);
      if (/Date\.now|new Date|performance\.now|Math\.random|crypto\./.test(code)) bad.push(`${f}:${i + 1} 時鐘或亂數`);
    });
  }
  assert.deepEqual(bad, []);
});

test('dmath：已知值與黃金雜湊（任何引擎都必須相同）', () => {
  assert.equal(D.sin(1e22), -0.8522008497671888);
  assert.equal(D.cos(0), 1); assert.equal(D.exp(1), Math.E); assert.equal(D.log(1), 0); assert.equal(D.atan2(1, 1), Math.PI / 4);
  const xs = []; for (let i = 0; i < 5000; i++) xs.push((i * 0.6180339887498949) % 1 * 40 - 20 + i * 1e-3);
  const v = [];
  for (const x of xs) v.push(D.sin(x), D.cos(x), D.tan(x), D.atan(x), D.atan2(x, 1.7 - x), D.asin(x / 26), D.acos(x / 26), D.exp(x / 2), D.log(Math.abs(x) + 1e-3), D.pow(Math.abs(x) + 1, -1.6364), D.sin(x * 1e7));
  assert.equal(hashFloat64(v), GOLDEN, '黃金雜湊不同：dmath 被改動，或執行環境的 IEEE-754 基本運算不一致');
});
const GOLDEN = 'da3e74907110780c';
