// 匯入 CAD → 自動產生產品檔（免教導）：STEP 轉網格 → A/B 面 → 設計特徵遮罩 → 視角規劃（含手臂可達）→ 拍攝順序 → 寫成產品模組。
// 新料號只要跑一次這個工具，產線端不必教導；輸出 web/js/products/<id>.js，網頁動畫與檢查直接讀它。
//
//   node ../../core/tools/run.mjs PlumbingFixtureInspection tools/import-cad.mjs <檔案.stp> --id sleeve-12449 --part 12449 --name 套筒 --adapter mandrel --mount-band 6
//   node ../../core/tools/run.mjs PlumbingFixtureInspection tools/import-cad.mjs gooseneck --id gooseneck-demo --part GN-350 --name 鵝頸出水管 --adapter collet --mount-band 45
//
// STEP 轉網格用 OpenCascade 的 WebAssembly 版（occt-import-js，不進版控、不放 core）。第一次使用先安裝到根目錄 TEMP：
//   npm install --prefix TEMP/occt occt-import-js@0.0.23
// 選項：--finish chrome|brushed|pvd（取像模式）、--family、--deflection（網格精度，佔外形對角線的比例，預設 0.001）、--units（STEP 已帶單位，通常不用）
// 產出只含幾何（網格量化到 0.01 mm）與規劃結果，不帶 STEP 檔頭的作者、公司等欄位。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMesh, classify, featureMask, planViews, orderViews, stats, blocked, sampleVerts } from '../web/js/planner.js';
import { createRobot, JOINTS } from '../web/js/robot.js';
import { scanPose } from '../web/js/poses.js';
import { encode, indexArray } from '../web/js/codec.js';
import { OPTICS, MEASURE, CAMERA_SETUP, ADAPTERS } from '../web/js/layout.js';
import { gooseneck } from './parametric.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, '../../..');
const argv = process.argv.slice(2), src = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i > 0 ? argv[i + 1] : d; };
if (!src) { console.log('用法：import-cad.mjs <檔案.stp | gooseneck> --id <id> --part <料號> --name <名稱> --adapter mandrel|collet --mount-band <mm>'); process.exit(2); }
const id = opt('id', basename(src).replace(/\.\w+$/, '').toLowerCase());
const meta = {
  id, partNo: opt('part', id), name: opt('name', id), family: opt('family', '龍頭類單件'), finish: opt('finish', 'chrome'),
  adapter: opt('adapter', 'mandrel'), mountBand: +opt('mount-band', 6),
};
const t0 = performance.now(), log = s => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)} s] ${s}`);

// ---------------------------------------------------------------- 1. 讀幾何
let raw, source;
if (src === 'gooseneck') { raw = gooseneck(); source = { format: '參數化示範件', faces: 6 }; }
else {
  const occtDir = join(REPO, 'TEMP/occt/node_modules/occt-import-js');
  if (!existsSync(occtDir)) { console.error(`找不到 occt-import-js：請先執行 npm install --prefix TEMP/occt occt-import-js@0.0.23`); process.exit(2); }
  const occt = await createRequire(join(occtDir, 'package.json'))('occt-import-js')();
  const res = occt.ReadStepFile(new Uint8Array(readFileSync(src)), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: +opt('deflection', .001), angularDeflection: .3 });
  if (!res.success || !res.meshes.length) throw new Error('STEP 讀取失敗');
  // 多個實體合併；B-rep 面編號依序累加
  const pos = [], idx = [], face = []; let fbase = 0;
  for (const m of res.meshes) {
    const off = pos.length / 3, P = m.attributes.position.array, I = m.index.array;
    // CAD 為 Z 向上 → 產品座標 Y 向上：(x, y, z) → (x, z, −y)
    for (let i = 0; i < P.length; i += 3) pos.push(P[i], P[i + 2], -P[i + 1]);
    for (const v of I) idx.push(v + off);
    const tf = new Uint16Array(I.length / 3);
    (m.brep_faces || []).forEach((f, k) => { for (let t = f.first; t <= f.last; t++) tf[t] = fbase + k; });
    face.push(...tf); fbase += (m.brep_faces || [1]).length;
  }
  raw = { positions: Float32Array.from(pos), index: Uint32Array.from(idx), face: Uint16Array.from(face) };
  source = { format: 'STEP', faces: fbase, file: basename(src) };
}
// 量化到 0.01 mm、夾持端面移到 y = 0（CAD 原點通常在軸上，X／Z 不動）
let minY = Infinity; for (let i = 1; i < raw.positions.length; i += 3) minY = Math.min(minY, raw.positions[i]);
const q = new Int32Array(raw.positions.length);
for (let i = 0; i < q.length; i++) q[i] = Math.round((raw.positions[i] - (i % 3 === 1 ? minY : 0)) * 100);
const positions = Float32Array.from(q, v => v / 100);
const index = indexArray(positions.length / 3, raw.index.length); index.set(raw.index);
const m = prepareMesh({ positions, index, face: raw.face });
log(`網格 ${m.nv} 頂點、${m.nt} 三角形、${source.faces} 個面；外形 ${m.max.clone().sub(m.min).toArray().map(v => v.toFixed(1)).join(' × ')} mm`);

// ---------------------------------------------------------------- 2. A／B 面、遮罩
const { cls, open } = classify(m, { mountBand: meta.mountBand });
log(`A／B／不檢：${[0, 1, 2].map(k => cls.filter(c => c === k).length).join('／')} 個三角形`);
const { mask, faces } = featureMask(m, cls, { faceKinds: raw.faceKinds });
if (argv.includes("--verbose")) console.table(faces.map((f, i) => ({ i, ...f })));
log(`遮罩：${[1, 2, 3].map(k => mask.filter(c => c === k).length).join('／')}（稜線／標誌／孔與螺牙）`);

// ---------------------------------------------------------------- 3. 視角規劃（手臂 IK 判斷可達）
const robot = createRobot(new THREE.Scene());
const anchor0 = m.center.clone();
const deg = qq => Object.fromEntries(JOINTS.map(n => [n, +(qq[n] * 180 / Math.PI).toFixed(3)]));
// 可達：IK 有解、J5 不超過 ±116°（VM-60B1 模型的手腕方塊與前臂端蓋 R56 的間隙：110° 7.4 mm、116° 約 2.9 mm、120° 相碰）、手臂本體（J2 以後）不碰條紋屏、相機、LED 環與艙壁
const J5_MAX = 116 * Math.PI / 180, verts = sampleVerts(m, 600);
const armClear = q => { robot.setJoints(q); return !robot.bodyPoints().some(p => blocked(p, 0, 10)); };
function reach(pose) {
  const r = robot.solve(robot.toolPoseFor(meta.adapter, pose.quat, pose.pos));
  return { ok: r.ok && Math.abs(r.q.j5) <= J5_MAX && armClear(r.q), q: r.q, err: r.err };
}
// 姿態之間的關節插值移動：取 8 點檢查手臂本體與產品（產品點由法蘭位姿換算）
const _tq = new THREE.Quaternion(), _tp = new THREE.Vector3();
const prodInTool = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
function moveClear(a, b) {
  for (let i = 1; i < 8; i++) {
    const q = Object.fromEntries(JOINTS.map(n => [n, a[n] + (b[n] - a[n]) * i / 8]));
    if (!armClear(q)) return false;
    robot.tool.getWorldQuaternion(_tq); robot.tool.getWorldPosition(_tp);
    const pq = _tq.clone().multiply(prodInTool), po = _tp.clone().add(new THREE.Vector3(0, 0, ADAPTERS[meta.adapter].mount).applyQuaternion(_tq));
    if (verts.some(v => blocked(v.clone().applyQuaternion(pq).add(po), 0, 5))) return false;
  }
  return true;
}
const plan = planViews(m, cls, { finish: meta.finish, reach, log });
log(`挑出 ${plan.views.length} 個姿態；不可達排除 ${plan.rejected.unreachable}`);
// 拍攝順序：從快掃位出發，以關節移動時間（最慢軸）＋ 0.25 s 加減速估算
const scan = robot.solve(robot.toolPoseFor(meta.adapter, ...Object.values(scanPose(anchor0))));
// 移動會撞到的兩個姿態之間加重罰（排序時避開）；排好後仍會撞的段數寫進統計，排程改經退出位
const clearCache = new Map(), clearOf = (a, b) => { const k = `${a ? plan.views.indexOf(a) : -1}_${plan.views.indexOf(b)}`; if (!clearCache.has(k)) clearCache.set(k, moveClear(a ? a.q : scan.q, b.q)); return clearCache.get(k); };
const cost = (a, b) => robot.jointTime(a ? a.q : scan.q, b.q) * 1.875 + (clearOf(a, b) ? 0 : 60);
const { order, time } = orderViews(plan.views, cost);
const views = order.map(i => plan.views[i]);
const via = views.map((v, k) => !clearOf(k ? views[k - 1] : null, v));
log(`姿態間移動會撞到光學艙的段數：${via.filter(Boolean).length}（排程改經退出位）`);
const firstView = new Uint8Array(m.nt).fill(255);
views.forEach((v, k) => { for (const t of v.tris) if (firstView[t] === 255) firstView[t] = k; });
const st = stats(m, cls, mask, plan.covered);
const perPose = OPTICS.settle + OPTICS.capture.fringe * OPTICS.capture.steps + OPTICS.capture.white;
log(`覆蓋率 A ${(st.coverage.A * 100).toFixed(1)}%、B ${(st.coverage.B * 100).toFixed(1)}%；移動 ${time.toFixed(1)} s＋取像 ${(views.length * perPose).toFixed(1)} s`);

// ---------------------------------------------------------------- 4. 寫出產品模組
const product = {
  ...meta, source,
  size: m.max.clone().sub(m.min).toArray().map(v => +v.toFixed(1)),
  anchor: anchor0.toArray().map(v => +v.toFixed(2)),
  mesh: { vertices: m.nv, triangles: m.nt, positions: encode(q), index: encode(index), face: encode(Uint16Array.from(raw.face)) },
  file: {
    cls: encode(cls), mask: encode(mask), firstView: encode(firstView),
    views: views.map(v => ({
      anchor: plan.anchors[v.anchor].toArray().map(x => +x.toFixed(2)), tilt: v.tilt, az: v.az, spin: +(v.spin * 180 / Math.PI).toFixed(1),
      quat: v.pose.quat.toArray().map(x => +x.toFixed(6)), pos: v.pose.pos.toArray().map(x => +x.toFixed(3)),
      q: deg(v.q), tris: v.newCount, gain: +v.gain.toFixed(1), via: via[views.indexOf(v)] || undefined,
    })),
    stats: { ...st, views: views.length, moveTime: +(time - 60 * via.filter(Boolean).length).toFixed(2), via: via.filter(Boolean).length, captureTime: +(views.length * perPose).toFixed(2), anchors: plan.anchors.length,
      candidates: plan.candidates, rejected: plan.rejected, faces: faces.filter(f => f.kind).length },
    optics: { fov: MEASURE.fov, dof: MEASURE.dof, maxIncidence: MEASURE.maxIncidence, wd: OPTICS.wd, mmPerPx: +MEASURE.mmPerPx.toFixed(4), camera: `${CAMERA_SETUP.camera.hPx}×${CAMERA_SETUP.camera.vPx}` },
  },
};
const out = join(HERE, '../web/js/products', `${id}.js`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `// 自動產生（tools/import-cad.mjs，${meta.name}），勿手改；重新匯入 CAD 或改光學艙配置後重跑。\n// mesh：網格（0.01 mm 整數、索引、B-rep 面）；file：產品檔（A/B 面、遮罩、每個三角形第一次被量測的姿態、視角與關節角）。\nexport default ${JSON.stringify(product, null, 1)};\n`);
log(`寫出 ${out.replace(REPO, '').replace(/\\/g, '/')}（${(JSON.stringify(product).length / 1024).toFixed(0)} KB）`);
