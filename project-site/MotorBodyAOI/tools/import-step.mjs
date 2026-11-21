// 本體 STEP → 網頁與檢查共用的網格模組 web/js/body-mesh.js（網格量化到 0.01 mm，只含幾何，不帶 STEP 檔頭與零件名稱）。
// 座標沿用 STEP：工件軸為 Z，Z = +1.5 為杯口凸緣頂，Z = −69 為法蘭側最低面。
// STEP 轉網格用 OpenCascade 的 WebAssembly 版（occt-import-js，不進版控）；第一次使用先在根目錄安裝：
//   npm install --prefix TEMP/occt occt-import-js@0.0.23
// 用法（在根目錄）：node core/tools/run.mjs MotorBodyAOI tools/import-step.mjs "project-site/MotorBodyAOI/docs/<本體>.STEP"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from '../web/js/codec.js';

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, '../../..');
const src = process.argv[2];
if (!src) { console.log('用法：import-step.mjs <本體.STEP> [--deflection 0.08]'); process.exit(2); }
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const occtDir = join(REPO, 'TEMP/occt/node_modules/occt-import-js');
if (!existsSync(occtDir)) { console.error('找不到 occt-import-js：請先執行 npm install --prefix TEMP/occt occt-import-js@0.0.23'); process.exit(2); }
const occt = await createRequire(join(occtDir, 'package.json'))('occt-import-js')();
const step = new Uint8Array(readFileSync(resolve(REPO, src)));
const read = (linearDeflection, angularDeflection) => {
  const r = occt.ReadStepFile(step, { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection, angularDeflection });
  if (!r.success || r.meshes.length !== 1) throw new Error('STEP 讀取失敗或不是單一實體');
  return r.meshes[0];
};
// 粗網格在某些 B 雲形面會產生飛出去的三角形（例如外框 X 從 121.0 變 123.6）：
// 先用細網格（0.02 mm）求每個面的外框，粗網格裡頂點超出所屬面外框 0.1 mm 的三角形丟掉
const fine = read(.02, .1), m = read(+opt('deflection', .08), .35);
const faceBox = fine.brep_faces.map(f => {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], FP = fine.attributes.position.array, FI = fine.index.array;
  for (let t = f.first; t <= f.last; t++) for (let j = 0; j < 3; j++) { const v = FI[t * 3 + j]; for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], FP[v * 3 + k]); b[k + 3] = Math.max(b[k + 3], FP[v * 3 + k]); } }
  return b;
});
if (faceBox.length !== m.brep_faces.length) throw new Error('細、粗網格的 B-rep 面數不同');
const P = m.attributes.position.array, I0 = m.index.array, keep = [], ranges = [];
let dropped = 0;
m.brep_faces.forEach((f, k) => {
  const b = faceBox[k], first = keep.length / 3;
  for (let t = f.first; t <= f.last; t++) {
    const tri = [I0[t * 3], I0[t * 3 + 1], I0[t * 3 + 2]];
    if (tri.every(v => [0, 1, 2].every(a => P[v * 3 + a] >= b[a] - .1 && P[v * 3 + a] <= b[a + 3] + .1))) keep.push(...tri); else dropped++;
  }
  ranges.push(first, keep.length / 3 - 1);   // 空面時 last < first
});
const pos = Int16Array.from(P, v => Math.round(v * 100));
if (pos.length / 3 >= 65536) throw new Error('頂點超過 65535，請加大 --deflection');
const I = keep, index = Uint16Array.from(keep);
console.log(`丟掉飛出面外框的三角形 ${dropped} 個`);
// 每個 B-rep 面的三角形範圍 [first, last]（依面連續）
const rangesArr = Uint32Array.from(ranges);
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (const i of I.map(v => v * 3)) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
const size = max.map((v, k) => +(v - min[k]).toFixed(1));
const out = `// 由 tools/import-step.mjs 產生，不要手改。本體網格：座標 ×0.01 mm（Int16），工件軸為 Z；faces 是每個 B-rep 面的三角形範圍 [first, last]。
export const BODY_MESH = {
  size: ${JSON.stringify(size)}, vertices: ${pos.length / 3}, triangles: ${index.length / 3}, brepFaces: ${rangesArr.length / 2},
  positions: '${encode(pos)}',
  index: '${encode(index)}',
  faces: '${encode(rangesArr)}',
};
`;
writeFileSync(join(HERE, '../web/js/body-mesh.js'), out);
console.log(`body-mesh.js：${pos.length / 3} 頂點、${index.length / 3} 三角形、${rangesArr.length / 2} 個 B-rep 面；外形 ${size.join(' × ')} mm；${(out.length / 1024).toFixed(0)} kB`);
