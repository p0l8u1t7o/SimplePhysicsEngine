#!/usr/bin/env node
// 產生 OpenFOAM 案例資料夾：node gen-case.mjs <輸入.json> [--out <資料夾>] [--force] [--quiet]
// 預設輸出到本機 TEMP/cfd-cases/<name>/（不進版控）。已有資料夾時要加 --force（只刪除本工具產生過的檔案種類，見 clearCase）。
// 產生後立刻跑 validate.js（不需要 OpenFOAM）；有錯誤時結束碼 1。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCase, TARGET } from '../../core/cfd/case-gen.js';
import { validateFiles } from '../../core/cfd/validate.js';

const here = dirname(fileURLToPath(import.meta.url));

export function writeCase(files, outDir, { force = false } = {}) {
  if (existsSync(outDir) && readdirSync(outDir).length) {
    if (!force) throw new Error(`${outDir} 已存在且不是空的；加 --force 覆寫`);
    if (!existsSync(join(outDir, 'cfd-case.json'))) throw new Error(`${outDir} 不是本工具產生的案例（沒有 cfd-case.json），不覆寫`);
    clearCase(outDir);
  }
  for (const [rel, text] of Object.entries(files)) {
    const p = join(outDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, { encoding: 'utf8', mode: /^All(run|clean)$/.test(rel) ? 0o755 : 0o644 });
  }
}

// 只清掉產生器管的東西與 OpenFOAM 的輸出，不碰使用者另外放進來的檔案
function clearCase(dir) {
  for (const d of ['system', '0.orig', '0', 'constant', 'postProcessing']) rmSync(join(dir, d), { recursive: true, force: true });
  for (const f of readdirSync(dir)) {
    if (/^(Allrun|Allclean|cfd-case\.json|log\..*)$/.test(f) || /^processor\d+$/.test(f) || /^\d+(\.\d+)?$/.test(f)) rmSync(join(dir, f), { recursive: true, force: true });
  }
}

async function main(argv) {
  const args = argv.slice(2);
  const input = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out');
  if (!input) { console.error('用法：node gen-case.mjs <輸入.json> [--out <資料夾>] [--force] [--quiet]'); return 2; }
  const cfg = JSON.parse(readFileSync(input, 'utf8'));
  const oi = args.indexOf('--out');
  const outDir = resolve(oi >= 0 ? args[oi + 1] : join(here, '..', '..', 'TEMP', 'cfd-cases', cfg.name || 'case'));
  const { files, meta, warnings } = generateCase(cfg);
  const v = validateFiles(files);
  writeCase(files, outDir, { force: args.includes('--force') });
  const quiet = args.includes('--quiet');
  if (!quiet) {
    console.log(`案例：${outDir}`);
    console.log(`目標：${TARGET.distribution} ${TARGET.version}（${TARGET.image}）`);
    console.log(`計算域 ${meta.domain.min.join(',')} → ${meta.domain.max.join(',')} m，背景網格 ${meta.domain.cells.join('×')}，基準格 ${meta.domain.baseCell} m`);
    console.log(`粗估 ${meta.estimate.cells.toLocaleString()} 格、約 ${meta.estimate.seconds < 90 ? `${meta.estimate.seconds} 秒` : `${Math.round(meta.estimate.seconds / 60)} 分鐘`}（${meta.solver.nProcs} 核）、記憶體約 ${meta.estimate.memoryMB} MB`);
    console.log(`檔案 ${Object.keys(files).length} 個；字典檢查 ${v.checked} 個`);
  }
  for (const w of warnings) console.log(`警告：${w}`);
  for (const w of v.warnings) console.log(`檢查警告：${w}`);
  for (const e of v.errors) console.error(`檢查錯誤：${e}`);
  return v.errors.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then(code => { process.exitCode = code; }, e => { console.error(e.message); process.exitCode = 2; });
}
