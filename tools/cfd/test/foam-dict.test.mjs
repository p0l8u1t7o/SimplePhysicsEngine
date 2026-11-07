import test from 'node:test';
import assert from 'node:assert/strict';
import { foamFile, parseFoamDict, raw, dims, list, named, vec, fmt, valueOf, sub, keys, FoamSyntaxError } from '../../../core/cfd/foam-dict.js';
import { createFrame, orientedBoxFromInput, boxToFoam, rotatedBoxParams, axisAligned, boxTriangles, cylinderTriangles, v3, applyPoint } from '../../../core/cfd/geometry.js';

test('fmt：去掉浮點雜訊、極小值歸零', () => {
  assert.equal(fmt(0.1 + 0.2), '0.3');
  assert.equal(fmt(6e-17), '0');
  assert.equal(fmt(-0), '0');
  assert.equal(fmt(1.5e-5), '0.000015');
  assert.throws(() => fmt(NaN));
});

test('寫出再解析：子字典、清單、指令、regex 鍵、含括號的字', () => {
  const text = foamFile({ object: 'testDict' }, {
    a: 1, b: 'uniform (0 0 0)', c: true, d: [1, [2, 3]], dimensions: dims([0, 1, -1, 0, 0, 0, 0]),
    sub: { '"(U|k)"': { solver: 'smoothSolver' }, 'div(phi,U)': 'bounded Gauss linearUpwind grad(U)', '#include': '"other"' },
    blocks: list(raw('hex (0 1 2 3 4 5 6 7) (1 2 3) simpleGrading (1 1 1)')),
    boundary: list(named('inlet', { type: 'patch', faces: raw('((0 4 7 3))') })),
    actions: list({ name: 'x', type: 'faceSet' }),
    p: vec([1, 2.5, -3]),
    skipped: null,
  });
  const d = parseFoamDict(text);
  assert.equal(valueOf(d, 'FoamFile', 'object'), 'testDict');
  assert.equal(valueOf(d, 'a'), 1);
  assert.deepEqual(valueOf(d, 'd'), [1, [2, 3]]);
  assert.deepEqual(valueOf(d, 'p'), [1, 2.5, -3]);
  assert.equal(valueOf(d, 'sub', '"(U|k)"', 'solver'), 'smoothSolver');
  assert.deepEqual(valueOf(d, 'sub', 'div(phi,U)'), ['bounded', 'Gauss', 'linearUpwind', 'grad(U)']);
  assert.ok(sub(d, 'sub').entries.some(e => e.directive && e.key === '#include' && e.args[0] === '"other"'));
  assert.ok(!keys(d).includes('skipped'));
  const b = valueOf(d, 'boundary');
  assert.equal(b[0], 'inlet');
  assert.equal(valueOf({ entries: b[1].dict }, 'type'), 'patch');
});

test('語法錯誤帶行號', () => {
  const bad = [
    ['a 1;\nb 2\n', /分號/],
    ['a { b 1; \n', /\{ 沒有對應/],
    ['a (1 2;\n', /分號|\(/],
    ['a 1; }\n', /多出的 \}/],
    ['/* x\n', /註解/],
    ['a "abc;\n', /字串/],
    ['a (1 2));\n', /\)/],
  ];
  for (const [t, re] of bad) assert.throws(() => parseFoamDict(t), e => e instanceof FoamSyntaxError && re.test(e.message), t);
  try { parseFoamDict('a 1;\n\n\nb { c 2 }\n'); assert.fail(); } catch (e) { assert.equal(e.line, 4); }
});

test('座標：Y 向上 mm → Z 向上 m、風向轉到 +x、來回一致、右手系', () => {
  const fr = createFrame({ up: 'y', units: 'mm', origin: [100, 0, 200], direction: [0, 0, 1] });
  const p = [1234, 567, -890];
  const q = fr.toFoam(p);
  assert.deepEqual(fr.toScene(q), p);
  assert.deepEqual(fr.dirToFoam([0, 0, 1]), [1, 0, 0]); // 風向 → +x
  assert.deepEqual(fr.dirToFoam([0, 1, 0]), [0, 0, 1]); // 上 → +z
  const R = fr.rotation;
  const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
  assert.ok(Math.abs(det - 1) < 1e-12);
  // 4×4 矩陣和函式一致
  assert.ok(applyPoint(fr.sceneToFoam, p).every((v, i) => Math.abs(v - q[i]) < 1e-9));
  assert.ok(applyPoint(fr.foamToScene, q).every((v, i) => Math.abs(v - p[i]) < 1e-6));
  assert.throws(() => createFrame({ direction: [0, 1, 0] }), /水平/);
});

test('面板：tilt 抬高 +z 邊；searchableRotatedBox 的 origin 是角點', () => {
  const fr = createFrame({ direction: [1, 0, 0] });
  const box = orientedBoxFromInput({ type: 'plate', center: [0, 1000, 0], size: [4000, 2000], thickness: 40, tiltDeg: 30 });
  const fb = boxToFoam(box, fr);
  // 場景 +z 邊在 foam 是 -y；抬高 → z 較大
  const edgeP = v3.add(fb.center, v3.scale(fb.axes[2], fb.half[2]));
  assert.ok(edgeP[2] > fb.center[2] && edgeP[1] < 0);
  const r = rotatedBoxParams(fb);
  assert.deepEqual(r.span, [4, 0.04, 2]);
  const e2 = v3.cross(r.e3, r.e1);
  const center = [0, 1, 2].map(i => r.origin[i] + (r.span[0] * r.e1[i] + r.span[1] * e2[i] + r.span[2] * r.e3[i]) / 2);
  assert.ok(center.every((v, i) => Math.abs(v - fb.center[i]) < 1e-9));
  assert.equal(axisAligned(fb), null);
  assert.deepEqual(axisAligned(boxToFoam(orientedBoxFromInput({ type: 'box', center: [0, 500, 0], size: [200, 1000, 400] }), fr)), { min: [-0.1, -0.2, 0], max: [0.1, 0.2, 1] });
});

test('STL：三角形法向朝外', () => {
  const box = { center: [1, 2, 3], axes: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], half: [1, 2, 0.5] };
  for (const [a, b, c] of boxTriangles(box)) {
    const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    const fc = v3.scale(v3.add(v3.add(a, b), c), 1 / 3);
    assert.ok(v3.dot(n, v3.sub(fc, box.center)) > 0);
  }
  const cyl = { p1: [0, 0, 0], p2: [0, 0, 2], radius: 0.5 };
  for (const [a, b, c] of cylinderTriangles(cyl, 12)) {
    const n = v3.cross(v3.sub(b, a), v3.sub(c, a));
    const fc = v3.scale(v3.add(v3.add(a, b), c), 1 / 3);
    assert.ok(v3.dot(n, v3.sub(fc, [0, 0, 1])) > 0);
  }
});
