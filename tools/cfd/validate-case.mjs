#!/usr/bin/env node
// 檢查一個 OpenFOAM 案例資料夾（不需要 OpenFOAM）：node validate-case.mjs <案例資料夾>
// 讀 system/、constant/（不含 polyMesh）、0.orig/（或 0/）與 Allrun、Allclean，交給 lib/validate.js。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFiles } from '../../core/cfd/validate.js';

export function readCaseFiles(dir) {
  const files = {};
  const walk = d => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f), rel = relative(dir, p).replace(/\\/g, '/');
      if (statSync(p).isDirectory()) {
        if (/^(constant\/polyMesh|postProcessing|processor\d+)/.test(rel)) continue;
        walk(p);
      } else if (!/\.(stl|gz|eMesh)$/.test(f) || rel.startsWith('constant/triSurface/')) {
        files[rel] = /\.(gz)$/.test(f) ? '' : readFileSync(p, 'utf8');
      }
    }
  };
  for (const sub of ['system', 'constant', existsSync(join(dir, '0.orig')) ? '0.orig' : '0']) if (existsSync(join(dir, sub))) walk(join(dir, sub));
  for (const f of ['Allrun', 'Allclean']) if (existsSync(join(dir, f))) files[f] = readFileSync(join(dir, f), 'utf8');
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node validate-case.mjs <案例資料夾>'); process.exit(2); }
  const v = validateFiles(readCaseFiles(dir));
  for (const w of v.warnings) console.log(`警告：${w}`);
  for (const e of v.errors) console.error(`錯誤：${e}`);
  console.log(`${v.checked} 個字典，${v.errors.length} 個錯誤，${v.warnings.length} 個警告`);
  process.exitCode = v.errors.length ? 1 : 0;
}
