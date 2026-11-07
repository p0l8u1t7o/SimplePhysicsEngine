// 決定性的靜態檢查：烘焙用的模組不得呼叫引擎相依的 Math 超越函式（Node 與 Chrome 在部分輸入差 1 ulp，Math.hypot 也是），也不得用 localeCompare（順序看語系）、時鐘或 Math.random（只量烘焙耗時、不進雜湊的行註明「計時」）。
// 要用就改 core/math/dmath.js；只影響顯示的行（取樣插值、顯示用網格）在行尾註明「顯示用」才放行。analysis.js 是烘焙後的分析數字，不在範圍。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['physics/physics.js', 'physics/rope.js', 'physics/cloth.js', 'physics/fluid.js', 'physics/collide.js', 'weather/precip.js', 'weather/snow.js', 'structure/solar-frame.js'];
const BAD = /Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh|random)\(/;

test('烘焙模組不用引擎相依的 Math 函式（顯示用的行要註明）', () => {
  const bad = [];
  for (const f of FILES) readFileSync(join(CORE, f), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (BAD.test(code) && !/顯示用/.test(line)) bad.push(`${f}:${i + 1} ${code.trim().slice(0, 80)}`);
    if (/localeCompare\(/.test(code)) bad.push(`${f}:${i + 1} localeCompare（順序看執行環境的語系，改用字碼比較）`);
    if (/performance\.now|Date\.now|new Date\(/.test(code) && !/計時/.test(line)) bad.push(`${f}:${i + 1} 時鐘（只量耗時的行註明「計時」）`);
  });
  assert.deepEqual(bad, []);
});
