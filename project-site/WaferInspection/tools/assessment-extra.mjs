// 評估簡報（本站自有的補頁）：先執行 `vs3d assess "WaferInspection" --repo deck` 重新產生簡報與成本表，再在附錄之前補上
// 光學與掃描估算、週期分項、線掃描比較、檢測演算方式、模擬／估算／實機驗證的界線、SIM 情境截圖。數字由站的程式（spec.js 的展示參數）即時計算。
//   node --import ../../core/tools/register.mjs tools/assessment-extra.mjs <shots.mjs 截圖資料夾> [情境截圖資料夾]（在站資料夾執行）
// 需要公司樣板（studio 的 findDeckKit：VS3D_DECK_KIT 或 ~/.claude/skills 的 zq-work-deck）、Python 與 python-pptx。輸出覆寫原檔（docs/ 只留本機）。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject } from '../web/js/project.js';
import { findDeckKit } from '../../../studio/lib/deck.mjs';

const [stdShots, shotsDir] = process.argv.slice(2);
if (!stdShots || !existsSync(stdShots)) { console.log('用法：tools/assessment-extra.mjs <shots.mjs 截圖資料夾> [情境截圖資料夾]'); process.exit(2); }
const root = fileURLToPath(new URL('../../../', import.meta.url));
const gen = spawnSync(process.execPath, [join(root, 'studio', 'vs3d.mjs'), 'assess', 'WaferInspection', 'deck', '--repo', '--shots', resolve(stdShots)], { cwd: root, encoding: 'utf8' });
process.stdout.write(gen.stdout || ''); if (gen.status !== 0) { process.stderr.write(gen.stderr || ''); process.exit(1); }
const pptx = (gen.stdout.match(/✓ (.+\.pptx)/) || [])[1]?.trim();
if (!pptx || !existsSync(pptx)) { console.log('✗ 沒有產生簡報（缺公司樣板或 Python？）'); process.exit(1); }
const kit = findDeckKit(); if (!kit) { console.log('✗ 找不到公司簡報樣板（zq-work-deck）'); process.exit(1); }

const r1 = (v, n = 1) => v == null ? '待確認' : (+v).toFixed(n);
const base = createProject({ scene: new THREE.Scene(), mode: 'full', scenario: 'clean' });
const variants = [['本版（GigE）', {}], ['10GigE', { camIf: '10GigE' }], ['倍率 2×＋GigE', { mag: 2 }], ['倍率 2×＋10GigE', { mag: 2, camIf: '10GigE' }]]
  .map(([name, params]) => { const e = name === '本版（GigE）' ? base.est : createProject({ scene: new THREE.Scene(), mode: 'full', scenario: 'clean', params }).est; return { name, e }; });
const e = base.est, p = base.p;
const data = {
  optics: [
    ['視野（FOV）', `${r1(e.fov[0], 2)} × ${r1(e.fov[1], 2)} mm`, 'core/optics L1（固定倍率）'],
    ['物方解析度', `${r1(e.umPerPx, 2)} µm/px`, '像素 2.4 µm ÷ 倍率 1×'],
    ['10 µm 缺陷佔像素', `${r1(e.defectPx, 2)} px（需 ${p.pxPerDefect}）`, '只代表幾何取樣條件'],
    ['景深（近似）', `${r1(e.dof * 1000, 0)} µm`, `平面度假設 ${p.flatness * 1000} µm`],
    ['取像位置', `${e.positions}（${e.rows} 列，邊緣 ${e.edgePositions}）`, `重疊 ${p.overlap * 100}%，蛇形`],
    ['有效區覆蓋', `${r1(e.coverage * 100, 2)}%`, `逐點檢查 Ø${(2 * base.plan.Rv).toFixed(0)}，排除區 ${p.edgeExcl} mm`],
    ['取像張數／資料量', `${e.images} 張／${r1(e.dataGB)} GB`, `每張 ${r1(base.optics.frameMB)} MB`],
    ['打光幾何（L2）', `同軸＝明場、Ø${p.dfRingD} 環形光＝暗場（入射 ${r1(base.optics.lightAngleDF)}°）`, '借用「鏡面金屬」代表拋光平整區'],
  ],
  breakdown: e.breakdown.filter(b => b.s > 0.001).map(b => [b.label, `${b.s.toFixed(1)} s`]).concat([['整片週期（關鍵路徑合計）', `${e.cycle.toFixed(1)} s`]]),
  parallel: e.parallel.map(b => [b.label, `${b.s.toFixed(1)} s`, b.note]),
  variants: variants.map(({ name, e }) => [name, `${e.positions}`, `${e.reviewCount}`, `${r1(e.dataGB)} GB`, `${r1(e.cycle, 0)} s`, `${r1(e.dof * 1000, 0)} µm`, e.bottleneck]),
  lineScan: base.lineScan.map(c => [c.name, `${c.swath} mm × ${c.swaths} 道`, `${c.speed} mm/s`, `${c.lineKHz} kHz`, `約 ${c.scanS} s`, `${c.dataGB} GB`]),
  shots: shotsDir ? [['12-select-candidate.png', 'SIM：線狀表面異常——演算法候選（紅框）與 C 待人工確認；影像為示意'], ['06-defocus-review.png', 'SIM：局部翹曲超出景深、照明不足——判「待複檢」，不判良品'], ['05-particle-end-truth.png', 'SIM：顆粒情境——A 真值（紫）對照 B 候選；低對比的一顆 SIM 漏檢']]
    .map(([f, cap]) => [join(shotsDir, f), cap]).filter(([f]) => existsSync(f)) : [],
};
const dir = mkdtempSync(join(tmpdir(), 'wafer-deck-')), json = join(dir, 'extra.json');
writeFileSync(json, JSON.stringify(data));
const r = spawnSync(process.env.VS3D_PYTHON || 'python', ['-I', fileURLToPath(new URL('./assessment_extra.py', import.meta.url)), kit, json, pptx], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
