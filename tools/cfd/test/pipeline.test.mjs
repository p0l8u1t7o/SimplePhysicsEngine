// 端到端：產生範例案例 → 寫假的 postProcessing（解析式流場）→ 匯入成 .cfdpack → 解碼 → 檢查座標、單位、衍生量、決定性，
// 最後用 three.js 建出 createFlowView 的幾何（Node 端，不渲染）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCase } from '../../../core/cfd/case-gen.js';
import { writeCase } from '../gen-case.mjs';
import { importCase } from '../import-results.mjs';
import { decodePack } from '../../../core/cfd/pack.js';
import { applyPoint } from '../../../core/cfd/geometry.js';
import { resampleSlice, arrowSegments, traceStreamlines, robustRange, colormap } from '../../../core/cfd/flow-field.js';
import { writeSyntheticResults, syntheticField } from './synth-results.mjs';
import { normalize } from '../../../core/cfd/case-gen.js';

const here = dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(readFileSync(join(here, '..', 'examples', 'pv-row-wind.json'), 'utf8'));
const dir = join(here, '..', '..', '..', 'TEMP', 'cfd-test-out', 'pipeline');   // 測試輸出只留本機

rmSync(dir, { recursive: true, force: true });
writeCase(generateCase(example).files, dir);
const synth = writeSyntheticResults(dir, example);
const imported = importCase(dir);
const pack = decodePack(imported.bytes);
const meta = JSON.parse(readFileSync(join(dir, 'cfd-case.json'), 'utf8'));

test('匯入內容齊全', () => {
  assert.deepEqual(imported.counts, { surfaces: 7, lines: 1, forces: 4, probes: 2 });
  assert.equal(pack.format, 'spe-cfd-pack');
  assert.equal(pack.case.synthetic, true);
  assert.equal(pack.case.time, 800);
  assert.deepEqual(pack.surfaces.map(s => s.name), ['behind1', 'elevation', 'patch_inverter', 'patch_table1', 'patch_table2', 'patch_table3', 'plan']);
  assert.deepEqual(pack.surfaces.map(s => s.kind), ['slice', 'slice', 'patch', 'patch', 'patch', 'patch', 'slice']);
  assert.ok(pack.sources.some(s => s.path === 'postProcessing/surfaces/800/plan.vtk'));
});

test('座標轉回場景（Y 向上、mm）；速度向量跟著轉', () => {
  const c = normalize(example);
  const f = syntheticField(c);
  const plan = pack.surfaces.find(s => s.name === 'plan');
  // 切面高度 = 面板中心高度 1350 mm（場景 y）
  for (let i = 1; i < plan.positions.length; i += 3) assert.ok(Math.abs(plan.positions[i] - 1350) < 0.01);
  // 任取一點：場景點 → foam → 解析流場，和匯入的 U（場景座標）比
  const U = plan.fields.find(x => x.name === 'U');
  for (const k of [0, 1234, 5000]) {
    const ps = [plan.positions[3 * k], plan.positions[3 * k + 1], plan.positions[3 * k + 2]];
    const q = applyPoint(meta.frame.sceneToFoam, ps);
    const uf = f.U(q);
    // foam (ux, uy, uz) → 場景 (uy, uz, ux)（風向 +z、上 +y）
    const us = [uf[1], uf[2], uf[0]];
    for (let j = 0; j < 3; j++) assert.ok(Math.abs(U.data[3 * k + j] - us[j]) < 1e-3, `${k}:${j}`);
  }
  // 面板中心高度 1.35 m 的對數律風速：12 × ln(1.35/0.03)/ln(10/0.03) ≈ 7.9 m/s
  const r = U.range;
  assert.ok(r[1] > 7 && r[1] < 9, String(r));
});

test('壓力換成 Pa、Cp 用 ½ρU² 正規化；面板的 cell 資料', () => {
  assert.equal(pack.reference.q, 0.5 * 1.225 * 12 * 12);
  const t1 = pack.surfaces.find(s => s.name === 'patch_table1');
  const p = t1.fields.find(f => f.name === 'p'), cp = t1.fields.find(f => f.name === 'Cp');
  assert.equal(p.location, 'cell');
  assert.equal(p.data.length, t1.nCells);
  for (let i = 0; i < p.data.length; i++) assert.ok(Math.abs(cp.data[i] - (p.data[i] - pack.reference.pRef) / pack.reference.q) < 1e-5);
  // 迎風第一座的最大 Cp 比第二座大（假資料的遮蔽係數 1 對 0.55）
  const cp2 = pack.surfaces.find(s => s.name === 'patch_table2').fields.find(f => f.name === 'Cp');
  assert.ok(cp.range[1] > 1.5 * cp2.range[1]);
  // 三角化：四邊形 → 2 個三角形，triCell 指回 cell
  assert.equal(t1.nTriangles, 2 * t1.nCells);
  assert.equal(t1.triCell[t1.nTriangles - 1], t1.nCells - 1);
});

test('力：場景座標、法向力係數、和 patch 壓力積分一致', () => {
  const f1 = pack.forces.find(f => f.obstacle === 'table1');
  const F = synth.forces.table1; // foam 座標、最終值（假資料曲線在 t=800 還差 e^(-800/150) 的比例）
  const k = 1 - Math.exp(-800 / 150);
  const viscous = 1.02; // 假資料的黏滯力 = 壓力的 2%
  // foam (x,y,z) → 場景 (y, z, x)
  const expected = [F[1], F[2], F[0]].map(v => v * k * viscous);
  for (let j = 0; j < 3; j++) assert.ok(Math.abs(f1.total[j] - expected[j]) < 0.05 * Math.abs(expected[j]) + 1, `${j}`);
  assert.ok(f1.CN < 0, '正面受風：面板被往下壓');
  assert.ok(f1.CD > 0, '阻力沿風向');
  assert.ok(f1.tailVariation < 0.05);
  const f2 = pack.forces.find(f => f.obstacle === 'table2');
  assert.ok(Math.abs(f2.CN) < Math.abs(f1.CN));
  // 舊格式 forces.dat（inverter）也讀到，沒有面積就不算係數
  const inv = pack.forces.find(f => f.obstacle === 'inverter');
  assert.ok(inv.total[2] > 0 && inv.CN === undefined);
});

test('探針、y+、殘差', () => {
  assert.deepEqual(pack.probes.names, ['ref', 'gap12', 'wake']);
  assert.equal(pack.probes.fields.U.last.length, 3);
  assert.ok(pack.probes.fields.U.last[0][2] > 10); // 上游參考點：風向 +z
  assert.ok(pack.yPlus.table1.max > 0);
  assert.ok(pack.residuals.time.length <= 201);
  assert.ok(pack.residuals.final.p < 1e-3);
});

test('流線（BINARY VTK）', () => {
  const l = pack.lines[0];
  assert.equal(l.name, 'track0');
  assert.equal(l.nLines, 24);
  assert.equal(l.segments.length, 2 * l.nSegments);
  assert.ok(l.fields.some(f => f.name === 'Umag'));
});

test('決定性：再匯入一次位元組完全相同', () => {
  const again = importCase(dir);
  assert.deepEqual(Buffer.from(again.bytes), Buffer.from(imported.bytes));
});

test('切面重新取樣、箭頭、切面內流線', () => {
  const plan = pack.surfaces.find(s => s.name === 'plan');
  const U = plan.fields.find(x => x.name === 'U');
  const g = resampleSlice({ positions: plan.positions, indices: plan.indices }, U.data, 3, { cell: 400 });
  assert.deepEqual(g.plane.normal.map(Math.abs), [0, 1, 0]);
  const covered = g.mask.reduce((a, b) => a + b, 0);
  assert.ok(covered > 0.95 * g.nx * g.ny);
  const a = arrowSegments(g, { stride: 6 });
  assert.equal(a.positions.length, a.count * 6 * 3);
  assert.ok(a.count > 50);
  const s = traceStreamlines(g, { count: 10 });
  assert.equal(s.lines.length, 10);
  assert.ok(s.lines.filter(n => n > 20).length >= 8, `流線太短：${s.lines}`);
  // 流線沿 +z 前進
  assert.ok(s.positions[s.positions.length - 1] > s.positions[2]);
  const r = robustRange([3, 1, NaN, 2, 100, 4]);
  assert.equal(r.min, 1); assert.equal(r.max, 100);
  assert.deepEqual(colormap('viridis', 0), [0.267, 0.005, 0.329]);
});

test('createFlowView（three.js，Node 端建幾何）', async () => {
  await import(pathToFileURL(join(here, '..', '..', '..', 'core', 'tools', 'register.mjs')).href);
  const { createFlowView } = await import('../../../core/cfd/flow-view.js');
  const flow = createFlowView(pack, { arrows: { surface: 'plan', stride: 6 }, traced: { surface: 'elevation', count: 8 } });
  assert.equal(flow.group.children.length, 7 + 1 + 2);
  const legend = flow.legend('slices');
  assert.equal(legend.field, 'Umag');
  assert.ok(legend.min >= 0 && legend.min < legend.max);
  assert.ok(legend.max > 5);
  assert.equal(legend.stops.length, 9);
  const pl = flow.legend('patches');
  assert.equal(pl.field, 'Cp');
  assert.equal(pl.min, -pl.max); // 對稱
  // patch 往流體側推 3 mm：表面的點和原始位置不重合
  const mesh = flow.meshes.get('patch_table1');
  const pos = mesh.geometry.getAttribute('position').array;
  const src = pack.surfaces.find(s => s.name === 'patch_table1');
  const i0 = src.indices[0];
  const d = Math.hypot(pos[0] - src.positions[3 * i0], pos[1] - src.positions[3 * i0 + 1], pos[2] - src.positions[3 * i0 + 2]);
  assert.ok(Math.abs(d - 3) < 1e-3);
  // 往流體側＝離開面板中心
  const ob = pack.obstacles.find(o => o.name === 'table1');
  const dist = (x, y, z) => Math.hypot(x - ob.center[0], y - ob.center[1], z - ob.center[2]);
  assert.ok(dist(pos[0], pos[1], pos[2]) > dist(src.positions[3 * i0], src.positions[3 * i0 + 1], src.positions[3 * i0 + 2]));
  // 換欄位、換範圍會重新上色
  const col = mesh.geometry.getAttribute('color').array.slice();
  flow.setField('p', 'patches'); // p 與 Cp 只差線性換算（pRef = 0），對稱範圍下顏色相同
  assert.ok(mesh.geometry.getAttribute('color').array.every((v, i) => Math.abs(v - col[i]) < 1e-3));
  flow.setRange([0, 80], 'patches');
  assert.notDeepEqual(Array.from(mesh.geometry.getAttribute('color').array.slice()), Array.from(col));
  flow.setRange([0, 20]);
  assert.deepEqual(flow.legend().ticks, [0, 5, 10, 15, 20]);
  const rows = flow.forcesTable();
  assert.equal(rows.length, 4);
  assert.ok(rows.find(r => r.obstacle === 'table1').converged);
  flow.dispose();
  writeFileSync(join(dir, 'flow-view.ok'), 'ok\n');
});
