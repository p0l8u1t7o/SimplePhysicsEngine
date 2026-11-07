// 地形：DSM → 網格、高程查詢、NoData、決定性、跨投影、正射影像貼圖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeTIFF, syntheticDSM, syntheticRGB } from './tiff-writer.mjs';
import { readGeoTIFF, readElevation } from '../geotiff.js';
import { twd97, utm, createSiteFrame } from '../coords.js';
import { createTerrain, applyOrthophoto, rasterSampler } from '../terrain.js';

// 合成 DSM：80 × 60 像素、0.5 m 解析度、原點 TM2 (250100, 2650200)
const PIX = 0.5, X0 = 250100, Y0 = 2650200;
const GEO = { epsg: 3826, origin: [X0, Y0], pixel: [PIX, PIX] };
const site = createSiteFrame({ crs: twd97(), origin: { E: X0 + 20, N: Y0 - 15, H: 50 } });
const dsm = syntheticDSM(80, 60);
const demP = (async () => readElevation(await writeTIFF([{ ...dsm, compression: 'deflate', predictor: 3, tile: [32, 32], geo: GEO, nodata: -9999 }])))();
// 像素中心 (c+0.5, r+0.5) 在案場座標
const siteOfPixel = (c, r) => site.fromMap(X0 + c * PIX, Y0 - r * PIX);

test('heightAt：像素中心等於 DSM 值、之間雙線性、範圍外 NaN、NoData 附近用有效點', async () => {
  const dem = await demP;
  const s = rasterSampler(dem, site);
  const p = siteOfPixel(10.5, 20.5);
  assert.ok(Math.abs(s.heightAt(p.x, p.z) - (dsm.fn(10.5, 20.5) - 50) * 1000) < 0.01);
  // 兩個像素中心的中點 = 平均
  const q = siteOfPixel(11, 20.5);
  const mid = (dsm.data[20 * 80 + 10] + dsm.data[20 * 80 + 11]) / 2;
  assert.ok(Math.abs(s.heightAt(q.x, q.z) - (mid - 50) * 1000) < 0.01);
  const out = siteOfPixel(-3, 5);
  assert.ok(Number.isNaN(s.heightAt(out.x, out.z)));
  // 洞（col 2～4、row 55～57）裡面 NaN
  const h = siteOfPixel(3.5, 56.5);
  assert.ok(Number.isNaN(s.heightAt(h.x, h.z)));
  const e = siteOfPixel(5.2, 56.5);   // 左鄰是洞：只用右邊的有效點
  assert.ok(Number.isFinite(s.heightAt(e.x, e.z)));
});

test('createTerrain：分塊、頂點相對塊中心、surfaceAt 在格點等於網格高度、決定性', async () => {
  const dem = await demP;
  const build = () => createTerrain(dem, site, { spacing: 1000, chunkCells: 16 });
  const t = build();
  assert.ok(t.chunks.length >= 4);
  assert.ok(t.grid.x0 % 1000 === 0);
  for (const m of t.chunks) {
    const pos = m.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) assert.ok(Math.abs(pos.getX(k)) <= 8000 + 1e-6 && Math.abs(pos.getZ(k)) <= 8000 + 1e-6);
  }
  // surfaceAt 在格點等於 heightAt（同一個取樣）
  const { x0, z0, spacing } = t.grid;
  for (const [i, j] of [[3, 4], [10, 7], [20, 15]]) {
    const x = x0 + i * spacing, z = z0 + j * spacing;
    assert.ok(Math.abs(t.surfaceAt(x, z) - t.heightAt(x, z)) < 0.01);
  }
  // 平滑地面：網格高度和 DSM 雙線性的差應該很小
  let maxd = 0;
  for (let k = 0; k < 200; k++) {
    const x = x0 + 1000 + (k * 7919 % 30000), z = z0 + 1000 + (k * 104729 % 20000);
    const a = t.surfaceAt(x, z), b = t.heightAt(x, z);
    if (Number.isFinite(a) && Number.isFinite(b)) maxd = Math.max(maxd, Math.abs(a - b));
  }
  assert.ok(maxd < 30, `網格與 DSM 差 ${maxd} mm`);
  // 法向量朝上
  const nrm = t.chunks[0].geometry.attributes.normal;
  for (let k = 0; k < nrm.count; k++) assert.ok(nrm.getY(k) > 0.9);
  // 決定性
  const hash = tt => {
    const h = createHash('sha256');
    for (const m of tt.chunks) { h.update(new Uint8Array(m.geometry.attributes.position.array.buffer)); h.update(new Uint8Array(m.geometry.index.array.buffer)); h.update(String(m.position.toArray())); }
    return h.digest('hex');
  };
  assert.equal(hash(t), hash(build()));
});

test('NoData：hole 挖掉三角形、fill 補值、數字填固定高度', async () => {
  const dem = await demP;
  const opts = { spacing: 500, bounds: { x0: -20000, z0: 0, x1: -10000, z1: 14000 } };
  const hole = createTerrain(dem, site, { ...opts, nodata: 'hole' });
  const fill = createTerrain(dem, site, { ...opts, nodata: 'fill' });
  const flat = createTerrain(dem, site, { ...opts, nodata: -1234 });
  assert.ok(hole.stats.holes > 0);
  assert.ok(hole.stats.triangles < fill.stats.triangles);
  assert.equal(fill.stats.filled, fill.stats.holes);
  assert.equal(fill.stats.triangles, (fill.grid.nx - 1) * (fill.grid.nz - 1) * 2);
  assert.ok([...flat.grid.heights].includes(-1234));
});

test('DSM 是 UTM 51N、案場是 TWD97：經緯度轉換後高度一致', async () => {
  // 同一塊平面斜坡分別用 TM2 與 UTM 51N 表示
  const tm = twd97(), u = utm(51);
  const slope = (E, N) => 50 + 0.01 * (E - X0) - 0.02 * (Y0 - N);
  const W = 40, H = 30;
  const make = (crs, epsg, ox, oy) => {
    const data = new Float32Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const g = crs.inverse(ox + (c + 0.5) * PIX, oy - (r + 0.5) * PIX);
      const t = tm.forward(g.lat, g.lon);
      data[r * W + c] = slope(t.E, t.N);
    }
    return writeTIFF([{ width: W, height: H, samples: 1, bits: 32, format: 3, data, compression: 'deflate', geo: { epsg, origin: [ox, oy], pixel: [PIX, PIX] } }]);
  };
  const g0 = tm.inverse(X0, Y0), uo = u.forward(g0.lat, g0.lon);
  const demTM = await readElevation(await make(tm, 3826, X0, Y0));
  const demU = await readElevation(await make(u, 32651, Math.round(uo.E), Math.round(uo.N)));
  assert.equal(demU.epsg, 32651);
  const s1 = rasterSampler(demTM, site), s2 = rasterSampler(demU, site);
  let n = 0;
  for (const [x, z] of [[-15000, -12000], [-10000, -5000], [-5000, -8000], [-3000, -3000]]) {
    const a = s1.heightAt(x, z), b = s2.heightAt(x, z);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    assert.ok(Math.abs(a - b) < 1, `${a} vs ${b}`);   // 平面上雙線性內插是精確的，差只來自 float32
    n++;
  }
  assert.ok(n >= 3);
});

test('正射影像：單張（2 的次方）與分塊兩種模式，uv 在範圍內', async () => {
  const dem = await demP;
  const t = createTerrain(dem, site, { spacing: 1000, chunkCells: 16 });
  const rgb = syntheticRGB(160, 120, 3);   // 0.25 m 解析度，涵蓋同一範圍
  const tif = readGeoTIFF(await writeTIFF([{ ...rgb, compression: 'deflate', tile: [64, 64], geo: { epsg: 3826, origin: [X0, Y0], pixel: [0.25, 0.25] } }]));
  const single = await applyOrthophoto(t, tif, site, { groundResolution: 250, maxSize: 256 });
  assert.equal(single.mode, 'single');
  const [w, h] = single.size;
  assert.ok(Number.isInteger(Math.log2(w)) && Number.isInteger(Math.log2(h)));
  for (const m of t.chunks) {
    const uv = m.geometry.attributes.uv;
    for (let k = 0; k < uv.count; k++) assert.ok(uv.getX(k) >= -0.01 && uv.getX(k) <= 1.01 && uv.getY(k) >= -0.01 && uv.getY(k) <= 1.01);
  }
  const tiled = await applyOrthophoto(t, tif, site, { groundResolution: 250, maxSize: 64, tileSize: 64 });
  assert.equal(tiled.mode, 'tiled');
  assert.equal(tiled.textures.length, t.chunks.length);
  assert.ok(new Set(t.chunks.map(m => m.material)).size === t.chunks.length);
  // 貼圖第 0 列是北緣：uv.y 越小越北（案場 z 越小）
  const m = t.chunks[0], uv = m.geometry.attributes.uv, pos = m.geometry.attributes.position;
  let north = 0, south = 0;
  for (let k = 0; k < pos.count; k++) { if (pos.getZ(k) < pos.getZ(0)) north = uv.getY(k); if (pos.getZ(k) > pos.getZ(0)) south = uv.getY(k); }
  assert.ok(south > north || south === 0);
});
