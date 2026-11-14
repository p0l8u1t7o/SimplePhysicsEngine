// 提案簡報用的 3D 畫面：只留 3D 畫布（隱藏側欄、影像視窗、工具列與 3D 標籤），1920×1080。
//   node project-site/WaferInspection/tools/presentation-shots.mjs [輸出資料夾]   （在庫根目錄執行；重工作，開發機經 cpu-cap 包裝）
// 輸出預設 TEMP/WaferInspection-shots/presentation（不進版控）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startServer } from '../../../core/tools/serve.mjs';
import { openBrowser, sleep } from '../../../core/tools/cdp.mjs';

const out = resolve(process.argv[2] || 'TEMP/WaferInspection-shots/presentation'); mkdirSync(out, { recursive: true });
// [檔名, 網址參數, 視角或 cam=位置,注視點, 時間比例]
const JOBS = [
  ['machine', 'sc=line', 'iso', 0.42],
  ['machine-front', 'sc=line&hood=solid', 'front', 0.42],
  ['optics', 'sc=line', 'cam:260,1330,330,0,1225,0', 0.45],
  ['scan-top', 'sc=line', 'top', 0.62],
  ['full-scan', 'mode=full&sc=particle', 'top', 0.55],
  ['stage', 'sc=line', 'cam:950,1550,1100,0,1150,0', 0.3],
];
// 側欄與影像視窗用共用版面的開關收起（版面會重算畫布寬度）；頂列、播放列、工具列與標籤用 CSS 隱藏
const CLEAN = `#topbar,#bottombar,.viewer-tools,.label3d,.viewer-status,#loading{display:none!important}
  #c{top:0!important;height:100%!important}`;
const server = await startServer({ port: 0, quiet: true }), port = server.address().port;
const browser = await openBrowser({ width: 1920, height: 1080 });
for (const [name, q, view, frac] of JOBS) {
  const cam = view.startsWith('cam:') ? view.slice(4) : null;
  if (!await browser.goto(`http://127.0.0.1:${port}/WaferInspection/?pause&${q}${cam ? '&cam=' + cam : ''}`)) { console.log('✗ 載入失敗', name); continue; }
  await sleep(1500);
  await browser.evaluate(`(() => {
    const st = document.createElement('style'); st.textContent = ${JSON.stringify(CLEAN)}; document.head.append(st);
    document.getElementById('left').hidden = true; document.getElementById('side').hidden = true;
    const pip = document.getElementById('showPip'); pip.checked = false; pip.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('resize'));
    const s = window.sim; s.seekTo(s.total * ${frac});
    if (${JSON.stringify(!cam)}) s.setView(${JSON.stringify(view)}, true);
    s.project.machine.panelHmi.drawText(['晶圓表面 AOI', '掃描取像', '明場＋暗場', '運轉中']);
    return true;
  })()`);
  await browser.frames(); await sleep(800); await browser.frames();
  writeFileSync(join(out, name + '.png'), await browser.screenshot('png'));
  console.log(name);
}
const errs = browser.errors.splice(0); for (const e of errs) console.log('✗ 主控台錯誤', String(e).slice(0, 200));
await browser.close(); server.close();
