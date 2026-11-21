// 取像規劃計算：逐面覆蓋率、看不到的原因、景深需求、解析度、入射角；寫出
//   web/js/coverage-data.js（網頁的摘要與取像足跡：每台相機的三角形與每張的位元遮罩）
//   review/coverage.json（檢查與文件用的完整數字）
// 用法（在根目錄）：node core/tools/run.mjs MotorBodyAOI tools/plan.mjs
import '@core/verify/dom-stub.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { CAMERAS } from '../web/js/optics-plan.js';
import { coverageReport, checkFaceGeometry } from '../web/js/coverage.js';
import { encode } from '../web/js/codec.js';

const t0 = performance.now();
const geomErr = checkFaceGeometry();                    // STEP 換版時先抓到 12 面對照失效
if (geomErr.length) { console.error(geomErr.join('\n')); process.exit(1); }

const { cov, faces, cameras, summary } = coverageReport();
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/coverage.json', import.meta.url), JSON.stringify({ faces, cameras }, null, 2) + '\n');
const foot = Object.fromEntries(CAMERAS.map(c => [c.id, { tris: encode(Uint32Array.from(cov.cameras[c.id].tris)), masks: encode(Uint16Array.from(cov.cameras[c.id].masks)) }]));
writeFileSync(new URL('../web/js/coverage-data.js', import.meta.url),
  '// 由 tools/plan.mjs 產生，不要手改。SUMMARY：逐面覆蓋率與各相機的景深、解析度、入射角（tools/verify.mjs 重算比對）；\n' +
  '// FOOTPRINT：每台相機看得到的三角形（tris）與每個三角形被第幾張拍到（masks，位元 k＝第 k 張）。\n' +
  `export const SUMMARY = ${JSON.stringify(summary)};\nexport const FOOTPRINT = ${JSON.stringify(foot, null, 1)};\n`);

for (const f of faces) console.log(`面 ${String(f.no).padStart(2)} ${f.group} ${f.station} ${f.cameras.join(',')}：覆蓋 ${f.coverage}%、照得到 ${f.lit}%（${f.area} mm²）`);
for (const c of cameras) console.log(`${c.id} WD ${c.wd} FOV ${c.fov.join('×')} ${c.mmpx} mm/px 深度 ${c.span} b需 ${c.bNeed} b設計 ${c.bDesign} F${c.Ndesign} DOF ${c.dofDesign} ` + Object.entries(c.perFace).map(([f, s]) => `[面${f} 覆蓋 ${s.coverage} 重疊 ${s.overlap} 視角 ${s.view} 入射 ${s.inc} 有效 ${s.mmpx} 失 ${JSON.stringify(s.lost)}]`).join(' '));
console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
