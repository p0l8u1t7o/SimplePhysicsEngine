// 成品匯出（本庫各站與 studio 工作區共用）：
//   node core/tools/export.mjs <專案> [--zip] [--html] [--mp4] [--out 資料夾]
//   不指定格式時輸出 --zip 與 --html。預設輸出到 TEMP/exports/（工作區模式是專案自己的 TEMP/exports/）。
//   --zip   網站壓縮檔：首頁＋core＋本站，附 open-demo.cmd（雙擊用本機伺服器開啟，不需要安裝軟體）
//   --html  單一 HTML：全部內嵌，離線雙擊可開（core/tools/export-html.mjs）；超過 15 MB 時建議改用壓縮檔
//   --mp4   錄影：Chrome＋ffmpeg 全自動（core/tools/export-mp4.mjs）
// 匯出前後都做用戶名稱檢查（check-names.mjs）：成品裡出現名單上的名稱就失敗，不留下成品。
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CORE, REPO, WORKSPACE, pickProjects } from './projects.mjs';
import { zipDir } from './zip.mjs';
import { scanDirs, scan, clientNames } from './check-names.mjs';

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
export const defaultOut = p => WORKSPACE ? join(p.dir, 'TEMP', 'exports') : join(REPO, 'TEMP', 'exports');
const mb = n => (n / 1048576).toFixed(1) + ' MB';

function assertNoNames(files, label) {
  const hits = files.length && statSync(files[0]).isDirectory() ? scanDirs(files) : scan(files);
  if (hits.length) throw new Error(`${label}含有用戶名稱（${hits.length} 處，例如 ${hits[0].file}${hits[0].line ? ':' + hits[0].line : ''}），已停止匯出`);
}

// 網站壓縮檔：build-site 只建這一站，再附上離線啟動腳本
export function exportZip(p, outDir, { log = console.log } = {}) {
  const stage = join(outDir, `.site-${p.id.replace(/\s+/g, '-')}-${process.pid}`);
  rmSync(stage, { recursive: true, force: true });
  try {
    execFileSync(process.execPath, [join(CORE, 'tools', 'build-site.mjs'), stage, p.id], { stdio: 'pipe' });
    assertNoNames([stage], '網站內容');
    const page = encodeURIComponent(p.id) + '/';
    const extra = [
      { name: 'serve.ps1', data: readFileSync(join(CORE, 'tools', 'offline', 'serve.ps1')) },
      // cmd 的 % 要寫成 %%（專案名稱有空白時網址是 %20）
      { name: 'open-demo.cmd', data: `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Page "${page.replace(/%/g, '%%')}"\r\n` },
      { name: 'README.txt', data: '﻿' + [
        `${p.title || p.id}：3D 設備模擬`, '',
        '開啟方式：解壓縮後雙擊 open-demo.cmd，瀏覽器會自動開啟展示頁；關掉黑色視窗就會停止。',
        '不需要安裝任何軟體（使用 Windows 內建的 PowerShell）。請用 Chrome 或 Edge 開啟。',
        '如果瀏覽器沒有自動開啟，請複製黑色視窗裡顯示的網址貼到瀏覽器。',
        '畫面中的尺寸、型號與節拍標示「示意」者為規劃假設值。',
      ].join('\r\n') + '\r\n' },
    ];
    const file = join(outDir, `${p.id.replace(/\s+/g, '-')}-site-${today()}.zip`);
    const r = zipDir(stage, file, { extra });
    log(`✓ 網站壓縮檔：${file}（${mb(r.bytes)}，${r.entries} 個檔案）`);
    return { format: 'zip', file, bytes: r.bytes };
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

export async function exportProject(id, { formats = ['zip', 'html'], out, log = console.log } = {}) {
  const [p] = pickProjects([id]);
  const outDir = resolve(out || defaultOut(p));
  mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const f of formats) {
    if (f === 'zip') results.push(exportZip(p, outDir, { log }));
    else if (f === 'html') {
      const mod = join(CORE, 'tools', 'export-html.mjs');
      if (!existsSync(mod)) throw new Error('單一 HTML 匯出尚未安裝（core/tools/export-html.mjs）');
      const { exportHtml } = await import(pathToFileURL(mod).href);
      const file = join(outDir, `${p.id.replace(/\s+/g, '-')}-${today()}.html`);
      const r = await exportHtml(p.id, file, { log: s => { if (!/\/render/.test(s)) log(s); } });
      try { assertNoNames([r.file || file], '單一 HTML '); } catch (e) { rmSync(r.file || file, { force: true }); throw e; }
      if ((r.bytes || 0) > 15 * 1048576) log(`! 單一 HTML ${mb(r.bytes)} 超過 15 MB，建議改用網站壓縮檔`);
      // 錄影（?movie）要連本機 /render 接收端，離線檔本來就不能錄；這類警告合併成一行
      const movie = (r.warnings || []).filter(w => /\/render|movie/i.test(w)), other = (r.warnings || []).filter(w => !movie.includes(w));
      for (const w of other) log(`! ${w}`);
      if (movie.length) log('· 錄影功能（?movie）只在錄影時使用，離線檔不能錄影，不影響展示');
      r.warnings = other;
      log(`✓ 單一 HTML：${r.file || file}（${mb(r.bytes || statSync(file).size)}）`);
      results.push({ format: 'html', file: r.file || file, bytes: r.bytes, warnings: r.warnings || [] });
    } else if (f === 'mp4') {
      const mod = join(CORE, 'tools', 'export-mp4.mjs');
      if (!existsSync(mod)) throw new Error('MP4 匯出尚未安裝（core/tools/export-mp4.mjs）');
      const { exportMp4 } = await import(pathToFileURL(mod).href);
      const r = await exportMp4(p.id, join(outDir, `${p.id.replace(/\s+/g, '-')}-video-${today()}`), { log });
      log(`✓ 錄影：${r.file}`);
      results.push({ format: 'mp4', ...r });
    } else throw new Error(`未知的格式：${f}（可用 zip、html、mp4）`);
  }
  return { outDir, results, names: clientNames().length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2), oi = argv.indexOf('--out'), out = oi >= 0 ? argv.splice(oi, 2)[1] : undefined;
  const formats = ['zip', 'html', 'mp4'].filter(f => argv.includes('--' + f)), [id] = argv.filter(a => !a.startsWith('--'));
  if (!id) { console.log('用法：node core/tools/export.mjs <專案> [--zip] [--html] [--mp4] [--out 資料夾]'); process.exit(2); }
  try { const r = await exportProject(id, { formats: formats.length ? formats : ['zip', 'html'], out }); console.log(`輸出資料夾：${r.outDir}`); }
  catch (e) { console.error('✗ ' + e.message); process.exit(1); }
}
