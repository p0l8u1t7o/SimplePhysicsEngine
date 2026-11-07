#!/usr/bin/env node
// 產生展示用資料：範例案例 → 假的 postProcessing（解析式流場，不是 CFD 結果）→ results.cfdpack。
// node make-demo.mjs → TEMP/cfd-cases/pv-row-wind-demo/results.cfdpack；加 --example 另寫 core/examples/cfd/demo.cfdpack.gz（範例頁 /core/examples/cfd/ 預設讀它）
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCase } from '../../core/cfd/case-gen.js';
import { writeCase } from './gen-case.mjs';
import { writeSyntheticResults } from './test/synth-results.mjs';
import { importCase } from './import-results.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(readFileSync(join(here, 'examples', 'pv-row-wind.json'), 'utf8'));
const dir = join(here, '..', '..', 'TEMP', 'cfd-cases', 'pv-row-wind-demo');
rmSync(dir, { recursive: true, force: true });
writeCase(generateCase(input).files, dir);
writeSyntheticResults(dir, input);
const { bytes } = importCase(dir);
writeFileSync(join(dir, 'results.cfdpack'), bytes);
console.log(`${join(dir, 'results.cfdpack')}（${(bytes.length / 1024).toFixed(0)} KB，假資料）`);
if (process.argv.includes('--example')) {
  const out = join(here, '..', '..', 'core', 'examples', 'cfd', 'demo.cfdpack.gz'), gz = gzipSync(bytes, { level: 9 });   // gzip 標頭的時間是 0：同樣的輸入產生同樣的檔
  writeFileSync(out, gz); console.log(`${out}（${(gz.length / 1024).toFixed(0)} KB）`);
}
