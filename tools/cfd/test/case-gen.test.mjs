import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateCase, normalize, locationInMesh } from '../../../core/cfd/case-gen.js';
import { validateFiles } from '../../../core/cfd/validate.js';
import { parseFoamDict, valueOf, sub, keys } from '../../../core/cfd/foam-dict.js';
import { writeCase } from '../gen-case.mjs';
import { readCaseFiles } from '../validate-case.mjs';
import { pointInBox, pointInCylinder } from '../../../core/cfd/geometry.js';

const here = dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(readFileSync(join(here, '..', 'examples', 'pv-row-wind.json'), 'utf8'));
const OUT = join(here, '..', '..', '..', 'TEMP', 'cfd-test-out');   // 測試輸出只留本機

test('範例：三座面板的案例結構完整、檢查 0 錯誤', () => {
  const { files, meta, warnings } = generateCase(example);
  assert.deepEqual(warnings, []);
  const expected = ['system/blockMeshDict', 'system/snappyHexMeshDict', 'system/meshQualityDict', 'system/controlDict', 'system/fvSchemes', 'system/fvSolution',
    'system/decomposeParDict', 'constant/transportProperties', 'constant/turbulenceProperties', '0.orig/U', '0.orig/p', '0.orig/k', '0.orig/omega', '0.orig/nut', 'Allrun', 'Allclean', 'cfd-case.json'];
  assert.deepEqual(Object.keys(files).sort(), expected.sort());
  const v = validateFiles(files);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.warnings, []);
  assert.equal(v.checked, 14);

  const sh = parseFoamDict(files['system/snappyHexMeshDict']);
  const geo = sub(sh, 'geometry');
  const types = Object.fromEntries(keys(geo).map(k => [k, valueOf(geo, k, 'type')]));
  assert.deepEqual(types, { table1: 'searchableRotatedBox', table2: 'searchableRotatedBox', table3: 'searchableRotatedBox', inverter: 'searchableBox', pole: 'searchableCylinder', wake: 'searchableBox' });
  assert.deepEqual(valueOf(sh, 'castellatedMeshControls', 'refinementSurfaces', 'table1', 'patchInfo', 'inGroups'), ['obstacles', 'panels']);

  // 背景網格是正立方體：計算域長度 = 格數 × 基準格
  const c = normalize(example);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(c.size[i] - c.mesh.cells[i] * c.mesh.baseCell) < 1e-6);
  // locationInMesh 不在任何障礙物裡（含 2 格的餘裕）
  const loc = locationInMesh(c);
  for (const o of c.obstacles) assert.ok(!(o.foamBox ? pointInBox(loc, o.foamBox, 2 * c.mesh.baseCell) : pointInCylinder(loc, o.foamCyl, 2 * c.mesh.baseCell)));

  // 函數物件：每座面板與變流器都有 forces 與 patch 取樣、有參考探針與流線
  const cd = parseFoamDict(files['system/controlDict']);
  const fns = keys(sub(cd, 'functions'));
  for (const n of ['forces_table1', 'forces_table2', 'forces_table3', 'forces_inverter', 'probes', 'streamLines', 'surfaces', 'yPlus', 'residuals']) assert.ok(fns.includes(n), n);
  assert.deepEqual(keys(sub(cd, 'functions', 'surfaces', 'surfaces')), ['plan', 'elevation', 'behind1', 'patch_table1', 'patch_table2', 'patch_table3', 'patch_inverter']);
  assert.equal(valueOf(cd, 'functions', 'surfaces', 'formatOptions', 'vtk', 'legacy'), 'true');

  // 0.orig/U：ABL 入口，Uref、Zref 照輸入（Zref 10000 mm → 10 m）
  const U = parseFoamDict(files['0.orig/U']);
  assert.equal(valueOf(U, 'boundaryField', 'inlet', 'type'), 'atmBoundaryLayerInletVelocity');
  assert.equal(valueOf(U, 'boundaryField', 'inlet', 'Uref'), 12);
  assert.equal(valueOf(U, 'boundaryField', 'inlet', 'Zref'), 10);
  assert.equal(valueOf(U, 'boundaryField', 'obstacles', 'type'), 'noSlip');

  // meta：座標轉換與面板資料
  assert.equal(meta.target.distribution, 'openfoam.com');
  assert.equal(meta.obstacles.find(o => o.name === 'table1').area, 15.64);
  assert.deepEqual(meta.obstacles.find(o => o.name === 'table1').center, [0, 1350, -5000]);
  assert.equal(meta.sampling.referenceProbe, 'ref');
  assert.ok(meta.estimate.cells > 1e5 && meta.estimate.cells < 1e7);
});

test('決定性：同一份輸入產生完全相同的檔案', () => {
  const a = generateCase(example).files, b = generateCase(structuredClone(example)).files;
  assert.deepEqual(a, b);
});

test('寫到資料夾後再讀回來檢查；Allrun 用 LF、bash -n 通過', () => {
  const dir = join(OUT, 'pv-row-wind');
  rmSync(dir, { recursive: true, force: true });
  writeCase(generateCase(example).files, dir);
  const v = validateFiles(readCaseFiles(dir));
  assert.deepEqual(v.errors, []);
  const allrun = readFileSync(join(dir, 'Allrun'), 'utf8');
  assert.ok(!allrun.includes('\r'));
  assert.match(allrun, /runApplication blockMesh\nrunApplication snappyHexMesh -overwrite\nrunApplication checkMesh\nrestore0Dir\nrunApplication decomposePar\nrunParallel/);
  const bash = spawnSync('bash', ['-n', join(dir, 'Allrun')], { encoding: 'utf8' });
  if (!bash.error) assert.equal(bash.status, 0, bash.stderr); // 沒有 bash 的機器略過這一項
  // 不覆寫：沒有 --force 時丟錯
  assert.throws(() => writeCase({ a: '1' }, dir), /已存在/);
});

test('薄板：厚度不到最細網格 2 格時加厚並警告', () => {
  const inp = structuredClone(example);
  inp.obstacles[0].level = [3, 3];
  const { warnings, meta } = generateCase(inp);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /table1.*加厚到 200 mm/);
  assert.equal(meta.obstacles[0].inflatedThickness, 200);
});

test('STL 模式：寫出 triSurface 與 surfaceFeatureExtractDict，Allrun 多一步', () => {
  const inp = structuredClone(example);
  inp.mesh.geometryMode = 'stl';
  const { files } = generateCase(inp);
  assert.ok(files['constant/triSurface/table1.stl'].startsWith('solid table1'));
  assert.equal((files['constant/triSurface/table1.stl'].match(/facet normal/g) || []).length, 12);
  assert.equal((files['constant/triSurface/pole.stl'].match(/facet normal/g) || []).length, 32 * 4);
  assert.match(files.Allrun, /surfaceFeatureExtract/);
  const v = validateFiles(files);
  assert.deepEqual(v.errors, []);
  const sh = parseFoamDict(files['system/snappyHexMeshDict']);
  assert.equal(valueOf(sh, 'snapControls', 'explicitFeatureSnap'), 'true');
});

test('enclosure：封閉空間＋開口（水槽）', () => {
  const inp = {
    name: 'tank', domain: { kind: 'enclosure', min: [0, 0, 0], max: [2000, 1500, 1000], openings: [
      { name: 'feed', kind: 'inlet', min: [0, 1100, 400], max: [0, 1300, 600], velocity: 1.5 },
      { name: 'drain', kind: 'outlet', min: [1800, 0, 400], max: [1900, 0, 600] },
    ] },
    flow: { medium: 'water' },
    mesh: { baseCell: 100 },
    obstacles: [{ name: 'baffle', type: 'box', center: [1000, 700, 500], size: [50, 1000, 800], report: true }],
    solver: { nProcs: 1, iterations: 300 },
  };
  const { files, meta } = generateCase(inp);
  assert.ok(files['system/topoSetDict'] && files['system/createPatchDict']);
  assert.match(files.Allrun, /topoSet\nrunApplication createPatch -overwrite/);
  assert.match(files.Allrun, /runApplication "\$\(getApplication\)"/); // 單核
  const v = validateFiles(files);
  assert.deepEqual(v.errors, []);
  assert.equal(meta.flow.nu, 1e-6);
  const U = parseFoamDict(files['0.orig/U']);
  assert.equal(valueOf(U, 'boundaryField', 'feed', 'type'), 'surfaceNormalFixedValue');
  assert.deepEqual(valueOf(U, 'boundaryField', 'feed', 'refValue'), ['uniform', -1.5]);
  // 開口不在牆上 → 丟錯
  const bad = structuredClone(inp); bad.domain.openings[0].min[0] = 300; bad.domain.openings[0].max[0] = 300;
  assert.throws(() => generateCase(bad), /不在計算域的任何一面牆上/);
});

test('輸入錯誤與未支援功能', () => {
  assert.throws(() => generateCase({ ...example, solver: { application: 'interFoam' } }), /interFoam.*之後/);
  assert.throws(() => generateCase({ ...example, obstacles: [{ name: '1bad', type: 'box', min: [0, 0, 0], max: [1, 1, 1] }] }), /英文字母開頭/);
  assert.throws(() => generateCase({ ...example, obstacles: [...example.obstacles, example.obstacles[0]] }), /重複/);
  assert.throws(() => generateCase({ ...example, mesh: { baseCell: 'abc' } }), /長度格式/);
});

test('檢查器抓得到常見錯誤', () => {
  const { files } = generateCase(example);
  const broken = (path, fn) => validateFiles({ ...files, [path]: fn(files[path]) }).errors.join('\n');
  assert.match(broken('system/fvSolution', t => t.replace('SIMPLE\n{', 'SIMPLE\n')), /語法錯誤/);
  assert.match(broken('0.orig/k', t => t.replace(/ {4}ground\n {4}\{[^}]*\}\n/, '')), /patch ground 沒有邊界條件/);
  assert.match(broken('0.orig/U', t => t.replace('noSlip;', 'noslip;')), /noslip.*不在已知清單/);
  assert.match(broken('system/blockMeshDict', t => t.replace('((0 4 7 3))', '((0 3 7 4))')), /法向朝內/);
  assert.match(broken('system/snappyHexMeshDict', t => t.replace(/locationInMesh\s+\([^)]*\)/, 'locationInMesh  (0 0 1.35)')), /locationInMesh 落在障礙物 table2/);
  assert.match(broken('system/controlDict', t => t.replace('patches         (table1);', 'patches         (tableX);')), /tableX 不存在/);
  assert.match(broken('0.orig/U', t => t.replace('[0 1 -1 0 0 0 0]', '[0 1 -1 0 0]')), /dimensions/);
  assert.match(validateFiles({ ...files, Allrun: files.Allrun.replace(/\n/g, '\r\n') }).errors.join('\n'), /CR/);
});

