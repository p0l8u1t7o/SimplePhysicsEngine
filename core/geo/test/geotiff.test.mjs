// GeoTIFF 讀取：用 tiff-writer.mjs 產生合成檔（各種壓縮、排列、位元組順序、預測器），讀回比對。
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeTIFF, syntheticDSM, syntheticRGB, lzwEncode, packbitsEncode } from './tiff-writer.mjs';
import { readGeoTIFF, readElevation, readOrthophoto, lzwDecode, packbitsDecode } from '../geotiff.js';

const GEO = { epsg: 3826, origin: [250100, 2650200], pixel: [0.05, 0.05] };
const same = (a, b) => { for (let i = 0; i < b.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i; return -1; };

test('LZW 與 PackBits 編解碼往返（含 KwKwK、超過 4096 碼的清表）', () => {
  const inputs = [
    new Uint8Array(0), Uint8Array.of(7), new Uint8Array(5000).fill(65),
    Uint8Array.from({ length: 20000 }, (_, i) => (i * 2654435761) >>> 24),
    Uint8Array.from({ length: 9000 }, (_, i) => (i % 7) * 30 + ((i >> 5) & 3)),
  ];
  for (const u of inputs) {
    assert.equal(same(lzwDecode(lzwEncode(u), u.length), u), -1);
    assert.equal(same(packbitsDecode(packbitsEncode(u), u.length), u), -1);
  }
});

test('壓縮 × 排列 × 位元組順序 × 預測器 × BigTIFF：像素逐一相同', async () => {
  let n = 0;
  for (const compression of ['none', 'deflate', 'lzw', 'packbits'])
    for (const tile of [null, [16, 16]])
      for (const littleEndian of [true, false])
        for (const [base, preds, planars] of [[syntheticDSM(37, 29), [1, 2, 3], [1]], [syntheticRGB(37, 29, 3), [1, 2], [1, 2]], [syntheticRGB(37, 29, 4), [1], [1]]])
          for (const predictor of preds)
            for (const planar of planars) {
              const bigTiff = n % 3 === 0;
              const bytes = await writeTIFF([{ ...base, compression, predictor, tile, planar, rowsPerStrip: 7, geo: GEO, nodata: base.format === 3 ? -9999 : null }], { littleEndian, bigTiff });
              const tif = readGeoTIFF(bytes);
              assert.equal(tif.bigTiff, bigTiff);
              const r = await tif.image.readRaster();
              assert.equal(same(r.data, base.data), -1, JSON.stringify({ compression, tile, littleEndian, predictor, planar, bigTiff }));
              n++;
            }
  assert.ok(n >= 100);
});

test('地理參考：tiepoint＋scale、PixelIsPoint、ModelTransformation、EPSG、自訂 TM、NoData', async () => {
  const base = syntheticDSM(10, 8, { hole: false });
  const a = readGeoTIFF(await writeTIFF([{ ...base, geo: GEO, nodata: -9999 }])).image;
  assert.deepEqual(a.transform, [0.05, 0, 250100, 0, -0.05, 2650200]);
  assert.equal(a.epsg, 3826);
  assert.equal(a.crs.params.k0, 0.9999);
  assert.equal(a.nodata, -9999);
  // PixelIsPoint：tiepoint 是像素中心，角點往左上退半格
  const b = readGeoTIFF(await writeTIFF([{ ...base, geo: { ...GEO, pixelIsPoint: true } }])).image;
  assert.deepEqual(b.transform, [0.05, 0, 250100 - 0.025, 0, -0.05, 2650200 + 0.025]);
  // ModelTransformation（含旋轉）
  const M = [0.04, 0.03, 0, 250000, 0.03, -0.04, 0, 2650000, 0, 0, 0, 0, 0, 0, 0, 1];
  const c = readGeoTIFF(await writeTIFF([{ ...base, geo: { epsg: 32651, matrix: M } }])).image;
  assert.deepEqual(c.transform, [0.04, 0.03, 250000, 0.03, -0.04, 2650000]);
  assert.equal(c.crs.params.lon0, 123);
  // 使用者自訂橫麥卡托（ProjectedCSType = 32767）
  const d = readGeoTIFF(await writeTIFF([{ ...base, geo: { ...GEO, epsg: null, tm: { lon0: 121, k0: 0.9999, x0: 250000, ellps: 7019 } } }])).image;
  assert.equal(d.epsg, null);
  assert.equal(d.crs.params.lon0, 121);
  assert.ok(Math.abs(d.crs.forward(24, 121.5).E - readGeoTIFF(await writeTIFF([{ ...base, geo: GEO }])).image.crs.forward(24, 121.5).E) < 1e-9);
});

test('視窗讀取、逐塊縮小、縮圖層（COG overview）', async () => {
  const big = syntheticDSM(64, 48, { hole: false });
  const half = { width: 32, height: 24, samples: 1, bits: 32, format: 3, data: new Float32Array(32 * 24) };
  for (let r = 0; r < 24; r++) for (let c = 0; c < 32; c++) half.data[r * 32 + c] = (big.data[2 * r * 64 + 2 * c] + big.data[2 * r * 64 + 2 * c + 1] + big.data[(2 * r + 1) * 64 + 2 * c] + big.data[(2 * r + 1) * 64 + 2 * c + 1]) / 4;
  const bytes = await writeTIFF([
    { ...big, compression: 'deflate', predictor: 3, tile: [16, 16], geo: GEO, nodata: -9999 },
    { ...half, compression: 'deflate', tile: [16, 16], subfile: 1 },
  ]);
  const tif = readGeoTIFF(bytes);
  assert.equal(tif.overviews.length, 1);
  assert.deepEqual(tif.overviews[0].transform, [0.1, 0, 250100, 0, -0.1, 2650200]);
  // 視窗
  const w = await tif.image.readRaster({ window: [10, 5, 30, 20] });
  assert.equal(w.width, 20);
  assert.equal(w.data[0], big.data[5 * 64 + 10]);
  assert.deepEqual(w.transform, [0.05, 0, 250100 + 0.5, 0, -0.05, 2650200 - 0.25]);
  // 逐塊縮小 2×（方框平均）＝縮圖層
  const s = await tif.image.readRaster({ width: 32, height: 24 });
  let maxd = 0;
  for (let i = 0; i < s.data.length; i++) maxd = Math.max(maxd, Math.abs(s.data[i] - half.data[i]));
  assert.ok(maxd < 1e-4, `${maxd}`);
  // readElevation 會挑縮圖層
  assert.equal(tif.pick(32), tif.overviews[0]);
  const e = await readElevation(tif, { maxSize: 32 });
  assert.equal(e.width, 32);
  assert.equal(e.pixelSize, 0.1);
});

test('readElevation：NoData 換成 NaN；readOrthophoto：RGB → RGBA', async () => {
  const dsm = syntheticDSM(12, 10);
  const e = await readElevation(await writeTIFF([{ ...dsm, compression: 'lzw', predictor: 3, geo: GEO, nodata: -9999 }]));
  assert.ok(Number.isNaN(e.data[(10 - 4) * 12 + 3]));
  assert.ok(Math.abs(e.data[0] - dsm.fn(0.5, 0.5)) < 1e-4);
  const rgb = syntheticRGB(20, 10, 3);
  const o = await readOrthophoto(await writeTIFF([{ ...rgb, compression: 'deflate', predictor: 2, geo: GEO }]));
  assert.equal(o.data.length, 20 * 10 * 4);
  assert.deepEqual([...o.data.subarray(4 * 13, 4 * 14)], [rgb.data[39], rgb.data[40], rgb.data[41], 255]);
});

test('不支援的壓縮給清楚的錯誤', async () => {
  const bytes = await writeTIFF([{ ...syntheticRGB(8, 8, 3), geo: GEO }]);
  // 把 Compression 標籤改成 7（JPEG）
  const dv = new DataView(bytes.buffer);
  const ifd = dv.getUint32(4, true), n = dv.getUint16(ifd, true);
  for (let i = 0; i < n; i++) if (dv.getUint16(ifd + 2 + 12 * i, true) === 259) dv.setUint16(ifd + 2 + 12 * i + 8, 7, true);
  const tif = readGeoTIFF(bytes);
  assert.equal(tif.image.compression, 'jpeg');
  await assert.rejects(tif.image.readRaster(), /jpeg.*gdal_translate/);
  assert.throws(() => readGeoTIFF(new Uint8Array(20)), /不是 TIFF/);
});
