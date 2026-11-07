// LAS：讀 laspy（獨立實作）寫的 1.2／1.4 檔（格式 1、3、6、7、8＋額外位元組），LAZ 要給清楚的錯誤；點雲物件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readLAS, readLASHeader, createPointCloud } from '../las.js';
import { twd97, createSiteFrame } from '../coords.js';

const dir = new URL('./fixtures/las/', import.meta.url);
const exp = JSON.parse(readFileSync(new URL('expect.json', dir), 'utf8'));

test('LAS 1.2～1.4 和 laspy 讀回的值相同', () => {
  for (const c of exp.cases.filter(c => c.file.endsWith('.las'))) {
    const buf = readFileSync(new URL(c.file, dir));
    const las = readLAS(buf);
    assert.equal(las.count, c.count, c.file);
    assert.equal(las.header.format, c.format);
    assert.equal(las.header.version, c.version);
    assert.equal(las.header.crs.epsg, c.epsg);
    for (let i = 0; i < 50; i++) {
      assert.ok(Math.abs(las.x[i] - c.x[i]) < 1e-9 && Math.abs(las.y[i] - c.y[i]) < 1e-9 && Math.abs(las.z[i] - c.z[i]) < 1e-9);
      assert.equal(las.intensity[i], c.intensity[i]);
      assert.equal(las.classification[i], c.classification[i]);
      assert.equal(las.returnNumber[i], c.return_number[i]);
    }
    if (c.rgb) assert.deepEqual([...las.rgb.subarray(0, 150)], c.rgb);
    const cc = {};
    for (const v of las.classification) cc[v] = (cc[v] || 0) + 1;
    assert.deepEqual(Object.fromEntries(Object.entries(cc).map(([k, v]) => [k, v])), c.classCounts);
  }
});

test('抽樣與分類篩選', () => {
  const buf = readFileSync(new URL('v14-f7.las', dir));
  const all = readLAS(buf);
  const half = readLAS(buf, { maxPoints: 100 });
  assert.equal(half.count, 100);
  assert.equal(half.x[1], all.x[2]);
  const ground = readLAS(buf, { classes: [2] });
  assert.ok(ground.count > 0 && [...ground.classification].every(c => c === 2));
});

test('LAZ 偵測並說明轉檔方式', () => {
  const buf = readFileSync(new URL('v14-f7.laz', dir));
  assert.equal(readLASHeader(buf).compressed, true);
  assert.throws(() => readLAS(buf), /LAZ.*pdal/i);
});

test('createPointCloud：案場座標、分塊、顏色線性化', () => {
  const site = createSiteFrame({ crs: twd97(), origin: { E: 250400, N: 2650575, H: 40 } });
  const las = readLAS(readFileSync(new URL('v12-f3.las', dir)));
  const pc = createPointCloud(las, site, { chunk: 50000 });
  assert.equal(pc.count, las.count);
  const s = site.fromMap(las.x[0], las.y[0], las.z[0]);
  assert.ok(Math.abs(pc.positions[0] - s.x) < 1e-6 && Math.abs(pc.positions[2] - s.z) < 1e-6);
  let n = 0;
  pc.root.traverse(o => {
    if (!o.isPoints) return;
    const p = o.geometry.attributes.position;
    n += p.count;
    for (let k = 0; k < p.count; k++) assert.ok(Math.abs(p.getX(k)) <= 25000 && Math.abs(p.getZ(k)) <= 25000);
    assert.equal(o.geometry.attributes.color.normalized, true);
  });
  assert.equal(n, las.count);
  // UTM 51N 的點雲轉到 TWD97 案場
  const u = readLAS(readFileSync(new URL('v12-f1.las', dir)));
  const pu = createPointCloud(u, site, { colorBy: 'height' });
  assert.equal(pu.count, u.count);
  assert.ok(Number.isFinite(pu.positions[0]));
});
