// 檢測軟體頁的示意合成：以自家視覺平台 VisionSequence 的介面截圖為底（相鄰的 VisionSequence 庫，唯讀），
// 換上本站的 SIM 晶圓影像、演算法候選（B）與晶圓檢測流程，輸出「流程編輯器」與「運行總覽」兩張合成圖。
//   node --import ../../core/tools/register.mjs tools/vs-composite.mjs [輸出資料夾]   （在站資料夾執行）
// VisionSequence 位置：環境變數 VISIONSEQUENCE_DIR，預設本庫旁邊的 ../VisionSequence；找不到就略過。
// 輸出預設 ../../TEMP/WaferInspection-shots/visionsequence（不進版控）；合成圖上一律標「示意合成」。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../../../core/tools/png.mjs';
import { createProject } from '../web/js/project.js';
import { renderTile, DISPLAY_RES } from '../web/js/inspection-sim.js';
import { CELL_COLORS } from '../web/js/wafer.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VS = process.env.VISIONSEQUENCE_DIR || resolve(ROOT, '..', 'VisionSequence');
const SHOTS = { editor: join(VS, 'Image', '120-055-editor-preview.png'), dashboard: join(VS, 'Image', '120-143-worker-dashboard-locked.png') };
if (!Object.values(SHOTS).every(existsSync)) { console.log(`略過：找不到 VisionSequence 的介面截圖（${VS}\\Image）`); process.exit(0); }
const out = resolve(process.argv[2] || join(ROOT, 'TEMP', 'WaferInspection-shots', 'visionsequence')); mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'wafer-vs-'));

// 線狀情境（精簡展示）結束時：選第一個演算法候選所在的位置
const pr = createProject({ scene: new THREE.Scene(), scenario: 'line', mode: 'compact' });
const cand = pr.candidates[0], k = cand.k, q = pr.plan.positions[k], per = pr.per[k];
const img = renderTile(q.x, q.y, pr.plan.fov, pr.p, { defects: pr.scenario.defects, seed: 1 + k * 3, res: DISPLAY_RES, focusErr: per.focusErr, dof: pr.optics.dof });
const toPng = (w, h, px) => { const data = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) { const [r, g, b] = px(i); data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; } return encodePng({ width: w, height: h, data }); };
const c8 = v => Math.max(0, Math.min(255, Math.round(v * 255)));
writeFileSync(join(tmp, 'bf.png'), toPng(img.w, img.h, i => [c8(img.rgb[0][i]), c8(img.rgb[1][i]), c8(img.rgb[2][i])]));

// 迷你 wafer map（結束時的狀態：已取像、候選、略過）
const M = 300, R = pr.p.waferD / 2, inList = new Set(pr.list), hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
writeFileSync(join(tmp, 'map.png'), toPng(M, M, i => {
  const x = ((i % M) + .5) / M * 2 * R - R, y = R - (Math.floor(i / M) + .5) / M * 2 * R, r = Math.hypot(x, y);
  if (r > R) return [28, 34, 48];
  if (pr.candidates.some(c => Math.hypot(c.at[0] - x, c.at[1] - y) < 4)) return [255, 74, 58];
  if (r > pr.plan.Rv) return [120, 60, 60];
  const cell = pr.plan.covers(x, y);
  if (!cell) return [70, 45, 42];
  const st = !inList.has(cell.k) ? 'skipped' : pr.per[cell.k].status === 'ok' ? 'done' : pr.per[cell.k].status;
  const [cr, cg, cb] = hex(CELL_COLORS[st]), a = st === 'skipped' ? .35 : .8;
  return [cr * a + 90 * (1 - a), cg * a + 50 * (1 - a), cb * a + 46 * (1 - a)];
}));

const r = pr.resultsAt(pr.total), e = pr.est;
const data = {
  editor: SHOTS.editor, dashboard: SHOTS.dashboard,
  tiles: { before: join(tmp, 'bf.png'), after: join(tmp, 'bf.png'), map: join(tmp, 'map.png') },
  pxPerMm: 1 / DISPLAY_RES, origin: [img.x0, img.y0],
  blobs: per.blobs.filter(b => b.ch === 'BF').map(b => b.box),
  flowName: '晶圓表面 AOI・明暗場比對（SIM 示意）', status: '待人工確認', statusNote: `P${k + 1}・${cand.shape}`, stepSel: 4,
  steps: [['多光源取像', 'grab'], ['清晰度量測', 'focus'], ['亮度統計', 'stat'], ['陰影校正', 'shade'],
    ['良品影像差異比對', 'diff'], ['粒子分析', 'blob'], ['框操作合併', 'box'], ['結果影像與 wafer map', 'draw'], ['結果回報', 'out']],
  tool: { title: '良品影像差異比對（defect_diff）', name: '黃金樣本差異比對', desc: ['與良品（黃金樣本）影像逐像素比對，', '分區明暗補正後以 max(6σ, 0.1) 為門檻，', '輸出差異遮罩給粒子分析。（SIM 示意）'] },
  alert: { title: `${pr.review.length} 項待人工確認（SIM）`, sub: `線狀表面異常情境：${pr.candidates.map(c => `${c.id} ${c.shape}`).join('、')}；疑似暗線不判定為裂紋` },
  cards: [
    { name: '晶圓表面 AOI・明暗場', badge: '待確認', meta: `精簡展示 ${pr.list.length}／${pr.all.length} 位置`, right: `整片估算 ${e.cycle.toFixed(0)} s`, on: true },
    { name: '影像品質（清晰度／亮度）', badge: 'OK', meta: '待複檢 0 處', right: '缺圖 0' },
    { name: '複檢取像', badge: '待確認', meta: `${pr.review.length} 處・每處 ${pr.p.reviewImgs} 張`, right: '交人工確認（C）' },
    { name: 'Golden Set 回歸（SIM 情境）', badge: 'OK', meta: '無缺陷 0 候選・顆粒 4/5', right: 'A5 低對比 SIM 漏檢' },
    { name: '對位與對焦', badge: 'OK', meta: `θ 修正 0.35°・${pr.p.afPoints} 點對焦`, right: '平面擬合' },
  ],
  board: { title: `P${k + 1}・SIM 明場`, verdict: '待人工確認', lines: ['B 候選＝演算法在 SIM 影像上找到的差異區', `本位置 ${per.blobs.length} 個差異區塊，已併入 ${cand.id}`, '右下：wafer map（紅點＝候選、灰＝展示略過）', '影像為模擬示意，缺陷寬度示意放大'] },
  info: [['已取像', `${r.done.length}／${pr.list.length}`], ['整片位置', `${pr.all.length}`], ['B 候選', `${r.cands.length}`], ['待複檢（品質）', `${r.quality.length}`],
    ['C 待人工確認', `${r.reviewed.length}`], ['物方解析度', `${e.umPerPx.toFixed(2)} µm/px`], ['整片週期（估算）', `${e.cycle.toFixed(0)} s`], ['資料量（整片）', `${e.dataGB.toFixed(1)} GB`], ['來源', 'SIM／展示假設']],
};
writeFileSync(join(tmp, 'data.json'), JSON.stringify(data));
const py = spawnSync(process.env.VS3D_PYTHON || 'python', ['-I', fileURLToPath(new URL('./vs_composite.py', import.meta.url)), join(tmp, 'data.json'), out], { encoding: 'utf8' });
process.stdout.write(py.stdout || ''); process.stderr.write(py.stderr || '');
process.exit(py.status ?? 1);
