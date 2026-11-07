import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVtk, VtkError } from '../../../core/cfd/vtk.js';
import { parseDat, forcesSeries, mergeSeries, parseProbes, residualSeries, yPlusSummary } from '../../../core/cfd/dat.js';
import { writeVtk } from './vtk-writer.mjs';

// 小網格：2×1 個四邊形＋1 個三角形，外加一條 3 點的線
const points = [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0, 3, 0.5, 0];
const polys = [[0, 1, 4, 3], [1, 2, 5, 4], [2, 6, 5]];
const lines = [[0, 1, 2]];
const pd = { p: { components: 1, values: [0, 1, 2, 3, 4, 5, 6] }, U: { components: 3, values: Array.from({ length: 21 }, (_, i) => i * 0.5) } };
const cdPoly = { pc: { components: 1, values: [10, 20, 30] } };
const cdAll = { pc: { components: 1, values: [99, 10, 20, 30] } }; // POLYDATA 的 cell 順序：線先、多邊形後

const variants = [];
for (const binary of [false, true]) for (const v51 of [false, true]) for (const style of ['field', 'attributes']) variants.push({ binary, v51, style });

for (const opt of variants) {
  test(`POLYDATA ${opt.binary ? 'BINARY' : 'ASCII'}${opt.v51 ? ' 5.1' : ''} ${opt.style}`, () => {
    const v = parseVtk(writeVtk({ ...opt, points, polys, lines, pointData: pd, cellData: cdAll, fieldData: { TimeValue: { components: 1, values: [800] } } }));
    assert.equal(v.dataset, 'POLYDATA');
    assert.equal(v.format, opt.binary ? 'binary' : 'ascii');
    assert.equal(v.nPoints, 7);
    assert.deepEqual(Array.from(v.points.slice(18)), [3, 0.5, 0]);
    assert.equal(v.polys.count, 3);
    assert.deepEqual(Array.from(v.polys.offsets), [0, 4, 8, 11]);
    assert.deepEqual(Array.from(v.polys.connectivity.slice(8)), [2, 6, 5]);
    assert.deepEqual(Array.from(v.polys.cellIds), [1, 2, 3]);
    assert.deepEqual(Array.from(v.lines.cellIds), [0]);
    assert.equal(v.nCells, 4);
    assert.deepEqual(Array.from(v.pointData.p.values), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(v.pointData.U.components, 3);
    assert.equal(v.pointData.U.values[20], 10);
    assert.deepEqual(Array.from(v.cellData.pc.values), [99, 10, 20, 30]);
    assert.deepEqual(Array.from(v.fieldData.TimeValue.values), [800]);
  });
}

test('UNSTRUCTURED_GRID：只取面與線，體元素計數', () => {
  const pts = [...points, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1];
  const hex = [0, 1, 4, 3, 7, 8, 10, 9];
  for (const binary of [false, true]) {
    const v = parseVtk(writeVtk({ dataset: 'UNSTRUCTURED_GRID', binary, points: pts, polys: [...polys, hex], lines, cellTypes: [9, 9, 5, 12, 3], cellData: { pc: { components: 1, values: [1, 2, 3, 4, 5] } } }));
    assert.equal(v.polys.count, 3);
    assert.deepEqual(Array.from(v.polys.cellIds), [0, 1, 2]);
    assert.deepEqual(Array.from(v.lines.cellIds), [4]);
    assert.equal(v.skipped3D, 1);
    assert.deepEqual(Array.from(v.cellData.pc.values), [1, 2, 3, 4, 5]);
  }
});

test('TRIANGLE_STRIPS 轉成三角形', () => {
  const txt = `# vtk DataFile Version 3.0\nstrip\nASCII\nDATASET POLYDATA\nPOINTS 5 float\n0 0 0 1 0 0 0 1 0 1 1 0 0 2 0\nTRIANGLE_STRIPS 1 6\n5 0 1 2 3 4\nCELL_DATA 1\nSCALARS s float 1\nLOOKUP_TABLE default\n7\n`;
  const v = parseVtk(txt);
  assert.equal(v.polys.count, 3);
  assert.deepEqual(Array.from(v.polys.connectivity), [0, 1, 2, 2, 1, 3, 2, 3, 4]);
  assert.deepEqual(Array.from(v.polys.cellIds), [0, 0, 0]);
});

test('錯誤：不是 VTK、不支援的資料集、長度不符、索引越界', () => {
  assert.throws(() => parseVtk('hello'), VtkError);
  assert.throws(() => parseVtk('# vtk DataFile Version 2.0\nx\nASCII\nDATASET STRUCTURED_POINTS\n'), /不支援的 DATASET/);
  assert.throws(() => parseVtk('# vtk DataFile Version 2.0\nx\nASCII\nDATASET POLYDATA\nPOINTS 2 float\n0 0 0 1 1 1\nPOINT_DATA 2\nSCALARS p float\n1\n'), /資料提前結束|長度不符/);
  assert.throws(() => parseVtk('# vtk DataFile Version 2.0\nx\nASCII\nDATASET POLYDATA\nPOINTS 2 float\n0 0 0 1 1 1\nPOLYGONS 1 4\n3 0 1 5\n'), /超出範圍/);
  assert.throws(() => parseVtk('# vtk DataFile Version 2.0\nx\nBINARY\nDATASET POLYDATA\nPOINTS 2 float\n\x00\x00'), /二進位資料不足/);
});

test('forces：v2006 以後的 force.dat、舊版 forces.dat、重新起算合併', () => {
  const newer = parseDat('# Force\n# CofR : (0 0 0)\n#\n# Time\ttotal_x\ttotal_y\ttotal_z\tpressure_x\tpressure_y\tpressure_z\tviscous_x\tviscous_y\tviscous_z\n10\t3\t0\t-1\t2.9\t0\t-1\t0.1\t0\t0\n20\t4\t0\t-2\t3.9\t0\t-2\t0.1\t0\t0\n');
  const a = forcesSeries(newer);
  assert.deepEqual(a.time, [10, 20]);
  assert.deepEqual(a.total.at(-1), [4, 0, -2]);
  assert.deepEqual(a.viscous[0], [0.1, 0, 0]);
  const older = parseDat('# Time forces(pressure viscous porous) moment(pressure viscous porous)\n20 ((1 2 3) (0.5 0 0) (0 0 0)) ((0 0 0) (0 0 0) (0 0 0))\n30 ((2 2 3) (0.5 0 0) (0 0 0)) ((0 0 0) (0 0 0) (0 0 0))\n');
  const b = forcesSeries(older);
  assert.deepEqual(b.total, [[1.5, 2, 3], [2.5, 2, 3]]);
  const m = mergeSeries([a, b]);
  assert.deepEqual(m.time, [10, 20, 30]);
  assert.deepEqual(m.total[1], [1.5, 2, 3]); // 重疊的時間以後面的檔為準
  assert.throws(() => forcesSeries(parseDat('# Time a b\n1 2 3\n')), /認不出/);
});

test('probes：位置、純量、向量、找不到的探針', () => {
  const p = parseProbes('# Probe 0 (1 2 3)\n# Probe 1 (4 5 6) # Not Found\n#     Probe 0 1\n#      Time\n10 1.5 -1e+300\n20 2.5 -1e+300\n');
  assert.deepEqual(p.locations, [[1, 2, 3], [4, 5, 6]]);
  assert.deepEqual(p.missing, [false, true]);
  assert.deepEqual(p.time, [10, 20]);
  assert.equal(p.values[1][0], 2.5);
  assert.ok(Number.isNaN(p.values[1][1]));
  const u = parseProbes('# Probe 0 (0 0 0)\n# Time\n5 (1 2 3)\n');
  assert.deepEqual(u.values[0][0], [1, 2, 3]);
});

test('solverInfo 與 yPlus：欄位可以是字', () => {
  const r = residualSeries(parseDat('# Solver information\n# Time\tU_solver\tUx_initial\tUx_final\tUx_iters\tp_solver\tp_initial\tp_final\tp_iters\n1\tsmoothSolver\t1\t0.1\t2\tGAMG\t1\t0.01\t5\n2\tsmoothSolver\t0.5\t0.05\t2\tGAMG\t0.4\t0.004\t5\n'));
  assert.deepEqual(r.time, [1, 2]);
  assert.deepEqual(r.fields, { Ux: [1, 0.5], p: [1, 0.4] });
  const y = yPlusSummary(parseDat('# y+ ()\n# Time\tpatch\tmin\tmax\taverage\n100\tpanel\t0.5\t120\t30\n100\tground\t1\t300\t80\n'));
  assert.deepEqual(y.panel, { time: 100, min: 0.5, max: 120, average: 30 });
});
