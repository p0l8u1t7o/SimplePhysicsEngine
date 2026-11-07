// core/geo/geotiff.js：精簡的 GeoTIFF 讀取器（DSM／DTM 單波段浮點、正射影像 RGB／RGBA 8 位元）。
// 不依賴第三方套件：Deflate 用瀏覽器與 Node 內建的 DecompressionStream，LZW、PackBits 自己解。
//
// 支援：TIFF 與 BigTIFF、兩種位元組順序、條帶（strip）與圖塊（tile）、chunky 與 planar 排列、
//       壓縮 1 無／5 LZW／8、32946 Deflate／32773 PackBits、預測器 2（水平差分）與 3（浮點）、
//       uint8／int8／uint16／int16／uint32／int32／float32／float64、內部縮圖（COG overview）、
//       GeoKey（EPSG、使用者自訂橫麥卡托）、ModelTiepoint＋ModelPixelScale 或 ModelTransformation、GDAL_NODATA。
// 不支援：JPEG（7）、WebP、ZSTD、LERC、float16、每個波段位元數不同；遇到時丟出清楚的錯誤（請用 gdal_translate 轉成 Deflate）。

import { crsFromEPSG, transverseMercator } from './coords.js';

const TAG = {
  NewSubfileType: 254, ImageWidth: 256, ImageLength: 257, BitsPerSample: 258, Compression: 259,
  Photometric: 262, StripOffsets: 273, SamplesPerPixel: 277, RowsPerStrip: 278, StripByteCounts: 279,
  PlanarConfig: 284, Predictor: 317, TileWidth: 322, TileLength: 323, TileOffsets: 324, TileByteCounts: 325,
  ExtraSamples: 338, SampleFormat: 339, ModelPixelScale: 33550, ModelTiepoint: 33922,
  ModelTransformation: 34264, GeoKeyDirectory: 34735, GeoDoubleParams: 34736, GeoAsciiParams: 34737,
  GDAL_METADATA: 42112, GDAL_NODATA: 42113,
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };
const COMPRESSION_NAME = { 1: 'none', 5: 'lzw', 7: 'jpeg', 8: 'deflate', 32946: 'deflate', 32773: 'packbits', 34887: 'lerc', 50000: 'zstd', 50001: 'webp' };

// ---------------------------------------------------------------- 解壓縮
async function inflate(u8) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  w.write(u8).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/** TIFF LZW（MSB 先、early change） */
export function lzwDecode(src, expected = 0) {
  let out = new Uint8Array(expected || src.length * 3);
  let op = 0;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
  let next = 258, width = 9, bitPos = 0, old = -1;
  const total = src.length * 8;
  const ensure = n => { if (op + n > out.length) { const o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out); out = o; } };
  const emit = code => {
    const l = len[code]; ensure(l);
    let c = code;
    for (let k = l - 1; k >= 0; k--) { out[op + k] = suffix[c]; c = prefix[c]; }
    op += l;
  };
  while (bitPos + width <= total && !(expected && op >= expected)) {
    // 讀 width 位元（MSB 先）
    let code = 0;
    for (let k = 0; k < width; k++) {
      const b = bitPos + k;
      code = (code << 1) | ((src[b >> 3] >> (7 - (b & 7))) & 1);
    }
    bitPos += width;
    if (code === 257) break;                 // EOI
    if (code === 256) { next = 258; width = 9; old = -1; continue; }   // Clear
    if (old === -1) { emit(code); old = code; continue; }
    if (code < next) {
      emit(code);
      if (next < 4096) { prefix[next] = old; suffix[next] = first[code]; first[next] = first[old]; len[next] = len[old] + 1; next++; }
    } else {
      // KwKwK：code == next
      if (next < 4096) { prefix[next] = old; suffix[next] = first[old]; first[next] = first[old]; len[next] = len[old] + 1; next++; }
      emit(code);
    }
    old = code;
    if (next + 1 >= (1 << width) && width < 12) width++;   // early change
  }
  return op === out.length ? out : out.subarray(0, op);
}

/** PackBits */
export function packbitsDecode(src, expected = 0) {
  let out = new Uint8Array(expected || src.length * 2);
  let op = 0, ip = 0;
  const ensure = n => { if (op + n > out.length) { const o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out); out = o; } };
  while (ip < src.length) {
    const n = (src[ip++] << 24) >> 24;
    if (n >= 0) { ensure(n + 1); out.set(src.subarray(ip, ip + n + 1), op); op += n + 1; ip += n + 1; }
    else if (n !== -128) { const c = 1 - n; ensure(c); out.fill(src[ip++], op, op + c); op += c; }
  }
  return op === out.length ? out : out.subarray(0, op);
}

// ---------------------------------------------------------------- 檔頭與 IFD
function readerOf(u8, le) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return {
    dv, le,
    u8: o => dv.getUint8(o), u16: o => dv.getUint16(o, le), u32: o => dv.getUint32(o, le),
    u64: o => { const lo = dv.getUint32(o + (le ? 0 : 4), le), hi = dv.getUint32(o + (le ? 4 : 0), le); return hi * 4294967296 + lo; },
  };
}

function readTagValues(r, type, count, off) {
  const out = new Array(count);
  const { dv, le } = r;
  for (let i = 0; i < count; i++) {
    switch (type) {
      case 1: case 7: out[i] = dv.getUint8(off + i); break;
      case 2: out[i] = dv.getUint8(off + i); break;
      case 6: out[i] = dv.getInt8(off + i); break;
      case 3: out[i] = dv.getUint16(off + 2 * i, le); break;
      case 8: out[i] = dv.getInt16(off + 2 * i, le); break;
      case 4: case 13: out[i] = dv.getUint32(off + 4 * i, le); break;
      case 9: out[i] = dv.getInt32(off + 4 * i, le); break;
      case 5: out[i] = dv.getUint32(off + 8 * i, le) / dv.getUint32(off + 8 * i + 4, le); break;
      case 10: out[i] = dv.getInt32(off + 8 * i, le) / dv.getInt32(off + 8 * i + 4, le); break;
      case 11: out[i] = dv.getFloat32(off + 4 * i, le); break;
      case 12: out[i] = dv.getFloat64(off + 8 * i, le); break;
      case 16: case 18: out[i] = r.u64(off + 8 * i); break;
      case 17: out[i] = Number(dv.getBigInt64(off + 8 * i, le)); break;
      default: throw new Error(`TIFF 標籤型別不支援：${type}`);
    }
  }
  if (type === 2) {
    let s = '';
    for (const c of out) s += String.fromCharCode(c);
    return s;
  }
  return out;
}

function parseIFDs(u8) {
  if (u8.length < 16) throw new Error('不是 TIFF（檔案太短）');
  const bo = String.fromCharCode(u8[0], u8[1]);
  if (bo !== 'II' && bo !== 'MM') throw new Error('不是 TIFF（位元組順序標記錯誤）');
  const r = readerOf(u8, bo === 'II');
  const magic = r.u16(2);
  const big = magic === 43;
  if (magic !== 42 && !big) throw new Error(`不是 TIFF（magic ${magic}）`);
  let off = big ? r.u64(8) : r.u32(4);
  const ifds = [];
  const seen = new Set();
  while (off && !seen.has(off) && off < u8.length) {
    seen.add(off);
    const n = big ? r.u64(off) : r.u16(off);
    const entrySize = big ? 20 : 12, inline = big ? 8 : 4;
    let p = off + (big ? 8 : 2);
    const tags = new Map();
    for (let i = 0; i < n; i++, p += entrySize) {
      const tag = r.u16(p), type = r.u16(p + 2);
      const count = big ? r.u64(p + 4) : r.u32(p + 4);
      const size = TYPE_SIZE[type];
      if (!size) continue;   // 不認得的型別略過
      const valOff = size * count <= inline ? p + (big ? 12 : 8) : (big ? r.u64(p + 12) : r.u32(p + 8));
      if (valOff + size * count > u8.length) throw new Error(`TIFF 標籤 ${tag} 超出檔案範圍`);
      tags.set(tag, readTagValues(r, type, count, valOff));
    }
    ifds.push(tags);
    off = big ? r.u64(p) : r.u32(p);
  }
  return { r, big, ifds };
}

// ---------------------------------------------------------------- GeoKey
function parseGeoKeys(tags) {
  const dir = tags.get(TAG.GeoKeyDirectory);
  return dir ? geoKeysFrom(dir, tags.get(TAG.GeoDoubleParams), tags.get(TAG.GeoAsciiParams)) : null;
}

/** GeoKeyDirectory（short 陣列）＋GeoDoubleParams＋GeoAsciiParams → { keyId: 值 }（LAS 的 GeoKey VLR 也用這個） */
export function geoKeysFrom(dir, dbl = [], asc = '') {
  const keys = {};
  for (let i = 0; i < dir[3]; i++) {
    const [id, loc, count, val] = dir.slice(4 + 4 * i, 8 + 4 * i);
    if (loc === 0) keys[id] = val;
    else if (loc === TAG.GeoDoubleParams) keys[id] = count === 1 ? dbl[val] : dbl.slice(val, val + count);
    else if (loc === TAG.GeoAsciiParams) keys[id] = asc.slice(val, val + count).replace(/[|\0]+$/, '');
  }
  return keys;
}

const ELLIPSOID_EPSG = { 7019: 'GRS80', 7030: 'WGS84' };
/** GeoKey → { epsg, crs, warning }（crs 是 coords.js 的投影，或 { geographic: true }） */
export function crsFromKeys(keys) {
  if (!keys) return { epsg: null, crs: null };
  const model = keys[1024];   // 1 投影、2 地理、3 地心
  if (model === 2) return { epsg: keys[2048] || 4326, crs: { geographic: true, epsg: keys[2048] || 4326 } };
  const epsg = keys[3072];
  if (epsg && epsg !== 32767) return { epsg, crs: crsFromEPSG(epsg) };
  // 使用者自訂：只認橫麥卡托（ProjCoordTransGeoKey = 1）
  if (keys[3075] === 1) {
    const unit = keys[3076] || 9001;
    if (unit !== 9001) return { epsg: null, crs: null, warning: `長度單位 ${unit} 不支援（只支援公尺 9001）` };
    let ellps = ELLIPSOID_EPSG[keys[2056]] || 'WGS84';
    if (keys[2057] && keys[2059]) ellps = { a: keys[2057], f: 1 / keys[2059] };
    const crs = transverseMercator({
      lon0: keys[3080] ?? keys[3088] ?? 0, lat0: keys[3081] ?? keys[3089] ?? 0,
      k0: keys[3092] ?? 1, x0: keys[3082] ?? 0, y0: keys[3083] ?? 0, ellps,
    });
    return { epsg: null, crs };
  }
  return { epsg: null, crs: null, warning: '座標系不支援（不是 EPSG 代碼也不是橫麥卡托）' };
}

function transformOf(tags, keys) {
  const pixelIsPoint = keys && keys[1025] === 2;
  const m = tags.get(TAG.ModelTransformation);
  if (m && m.length >= 16) {
    // X = a·col + b·row + c；Y = d·col + e·row + f（以像素角點為整數座標）
    let t = [m[0], m[1], m[3], m[4], m[5], m[7]];
    if (pixelIsPoint) t = [t[0], t[1], t[2] - (t[0] + t[1]) / 2, t[3], t[4], t[5] - (t[3] + t[4]) / 2];
    return t;
  }
  const tp = tags.get(TAG.ModelTiepoint), sc = tags.get(TAG.ModelPixelScale);
  if (!tp || !sc) return null;
  const [I, J, , X, Y] = tp;
  const off = pixelIsPoint ? 0.5 : 0;
  return [sc[0], 0, X - (I + off) * sc[0], 0, -sc[1], Y + (J + off) * sc[1]];
}

/** 仿射 [a,b,c,d,e,f]：(col,row) → (X,Y)；回傳反函式 */
export function invertTransform([a, b, c, d, e, f]) {
  const det = a * e - b * d;
  return { toPixel: (X, Y) => ({ col: (e * (X - c) - b * (Y - f)) / det, row: (-d * (X - c) + a * (Y - f)) / det }) };
}

// ---------------------------------------------------------------- 影像
function arrayType(format, bits) {
  if (format === 3) { if (bits === 32) return Float32Array; if (bits === 64) return Float64Array; }
  else if (format === 2) { if (bits === 8) return Int8Array; if (bits === 16) return Int16Array; if (bits === 32) return Int32Array; }
  else { if (bits === 8) return Uint8Array; if (bits === 16) return Uint16Array; if (bits === 32) return Uint32Array; }
  throw new Error(`樣本格式不支援：SampleFormat ${format}、${bits} 位元`);
}

function makeImage(tif, tags, index) {
  const g = t => tags.get(t);
  const one = (t, d) => (g(t) ? g(t)[0] : d);
  const width = one(TAG.ImageWidth), height = one(TAG.ImageLength);
  const spp = one(TAG.SamplesPerPixel, 1);
  const bpsArr = g(TAG.BitsPerSample) || [1];
  const bits = bpsArr[0];
  if (bpsArr.some(b => b !== bits)) throw new Error('每個波段位元數不同，不支援');
  const sampleFormat = one(TAG.SampleFormat, 1);
  const compression = one(TAG.Compression, 1);
  const predictor = one(TAG.Predictor, 1);
  const planar = one(TAG.PlanarConfig, 1);
  const tiled = tags.has(TAG.TileWidth);
  const tw = tiled ? one(TAG.TileWidth) : width;
  const th = tiled ? one(TAG.TileLength) : Math.min(one(TAG.RowsPerStrip, height), height);
  const offsets = g(tiled ? TAG.TileOffsets : TAG.StripOffsets);
  const counts = g(tiled ? TAG.TileByteCounts : TAG.StripByteCounts);
  const keys = parseGeoKeys(tags);
  const nodataStr = g(TAG.GDAL_NODATA);
  const nodata = nodataStr != null && nodataStr.trim() !== '' ? Number(nodataStr.trim().replace(/\0+$/, '')) : null;
  const { epsg, crs, warning } = crsFromKeys(keys);
  const Typed = arrayType(sampleFormat, bits);
  const bytesPer = bits / 8;
  const tilesAcross = Math.ceil(width / tw), tilesDown = Math.ceil(height / th);

  const image = {
    index, width, height, samplesPerPixel: spp, bitsPerSample: bits, sampleFormat,
    compression: COMPRESSION_NAME[compression] || String(compression), predictor, planar, tiled,
    tileWidth: tw, tileHeight: th, photometric: one(TAG.Photometric, 1), extraSamples: g(TAG.ExtraSamples) || [],
    subfileType: one(TAG.NewSubfileType, 0), nodata, geoKeys: keys, epsg, crs, crsWarning: warning || null,
    transform: null, tags,
    /**
     * 讀取影像（或其中一塊視窗），可同時縮小（方框平均）。
     * @param {object} [o]
     * @param {number[]} [o.window] [x0, y0, x1, y1]（像素，不含 x1、y1）
     * @param {number[]} [o.samples] 要的波段（預設全部）
     * @param {number} [o.width] 輸出寬（預設＝視窗寬）；給 width/height 時逐塊縮小，記憶體只用一塊加輸出
     * @param {number} [o.height]
     * @returns {Promise<{width, height, samples, data, transform, nodata}>} data 為交錯排列的 TypedArray
     */
    async readRaster(o = {}) { return readRaster(tif, image, o); },
  };
  image.transform = transformOf(tags, keys);
  image._chunk = { offsets, counts, Typed, bytesPer, tilesAcross, tilesDown, compressionCode: compression };
  return image;
}

async function decodeChunk(tif, image, idx) {
  const { offsets, counts, Typed, bytesPer, compressionCode } = image._chunk;
  const off = offsets[idx], cnt = counts[idx];
  const sppChunk = image.planar === 2 ? 1 : image.samplesPerPixel;
  const tw = image.tileWidth;
  // 條帶的最後一條可能比較短
  let rows = image.tileHeight;
  if (!image.tiled) {
    const strip = idx % Math.ceil(image.height / image.tileHeight);
    rows = Math.min(image.tileHeight, image.height - strip * image.tileHeight);
  }
  const expected = tw * rows * sppChunk * bytesPer;
  if (!cnt) return new Typed(tw * rows * sppChunk);      // 空的圖塊（稀疏檔）
  let raw = tif.u8.subarray(off, off + cnt);
  switch (compressionCode) {
    case 1: break;
    case 8: case 32946: raw = await inflate(raw); break;
    case 5: raw = lzwDecode(raw, expected); break;
    case 32773: raw = packbitsDecode(raw, expected); break;
    default: throw new Error(`壓縮方式不支援：${COMPRESSION_NAME[compressionCode] || compressionCode}（請先用 gdal_translate -co COMPRESS=DEFLATE 轉檔）`);
  }
  if (raw.length < expected) {
    const pad = new Uint8Array(expected); pad.set(raw); raw = pad;
  }
  return toSamples(raw, image, tw, rows, sppChunk);
}

// 解碼後的位元組 → 樣本陣列（處理位元組順序與預測器）
function toSamples(raw, image, w, rows, spp) {
  const { Typed, bytesPer } = image._chunk;
  const le = image._le;
  const n = w * rows * spp;
  const out = new Typed(n);
  if (image.predictor === 3) {
    // 浮點預測器：每列先做位元組差分還原（步距 spp），再把位元組平面（高位在前）組回數值
    const rowBytes = w * spp * bytesPer;
    const tmp = new Uint8Array(rowBytes);
    for (let y = 0; y < rows; y++) {
      tmp.set(raw.subarray(y * rowBytes, (y + 1) * rowBytes));
      for (let i = spp; i < rowBytes; i++) tmp[i] = (tmp[i] + tmp[i - spp]) & 0xff;
      const wc = w * spp;
      const word = new Uint8Array(bytesPer);
      const wdv = new DataView(word.buffer);
      for (let k = 0; k < wc; k++) {
        for (let b = 0; b < bytesPer; b++) word[b] = tmp[b * wc + k];
        out[y * wc + k] = bytesPer === 4 ? wdv.getFloat32(0, false) : wdv.getFloat64(0, false);
      }
    }
    return out;
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (bytesPer === 1) out.set(Typed === Int8Array ? new Int8Array(raw.buffer, raw.byteOffset, n) : raw.subarray(0, n));
  else {
    const get = {
      Uint16Array: o => dv.getUint16(o, le), Int16Array: o => dv.getInt16(o, le),
      Uint32Array: o => dv.getUint32(o, le), Int32Array: o => dv.getInt32(o, le),
      Float32Array: o => dv.getFloat32(o, le), Float64Array: o => dv.getFloat64(o, le),
    }[Typed.name];
    for (let i = 0; i < n; i++) out[i] = get(i * bytesPer);
  }
  if (image.predictor === 2) {
    // 水平差分：同一列、同一波段累加（整數環繞；浮點以同寬的無號整數位元處理，和 libtiff 相同）
    const U = { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array, 8: null }[bytesPer];
    if (!U) throw new Error('預測器 2 不支援 64 位元樣本');
    const u = new U(out.buffer);
    const row = w * spp;
    for (let y = 0; y < rows; y++) {
      const base = y * row;
      for (let i = spp; i < row; i++) u[base + i] = u[base + i] + u[base + i - spp];
    }
  }
  return out;
}

async function readRaster(tif, image, o) {
  const [x0, y0, x1, y1] = o.window || [0, 0, image.width, image.height];
  if (!(x0 >= 0 && y0 >= 0 && x1 <= image.width && y1 <= image.height && x1 > x0 && y1 > y0)) throw new Error(`視窗超出影像範圍：${o.window}`);
  const samples = o.samples || [...Array(image.samplesPerPixel).keys()];
  const ww = x1 - x0, wh = y1 - y0;
  const ow = o.width || ww, oh = o.height || wh;
  const resample = ow !== ww || oh !== wh;
  if (!resample && ww * wh * samples.length > 2 ** 28) throw new Error('影像太大，請指定 window 或輸出尺寸 width／height（逐塊縮小）');
  const S = samples.length, spp = image.samplesPerPixel;
  const { Typed, tilesAcross } = image._chunk;
  const nodata = image.nodata;
  const isFloat = image.sampleFormat === 3;
  const out = resample ? null : new Typed(ow * oh * S);
  const sum = resample ? new Float64Array(ow * oh * S) : null;
  const cnt = resample ? new Float64Array(ow * oh * S) : null;
  const tw = image.tileWidth, th = image.tileHeight;
  const tilesDown = Math.ceil(image.height / th);
  const perPlane = tilesAcross * tilesDown;
  const planes = image.planar === 2 ? samples.map(s => s) : [null];
  const sx = ow / ww, sy = oh / wh;

  for (let ty = Math.floor(y0 / th); ty <= Math.floor((y1 - 1) / th); ty++) {
    for (let tx = Math.floor(x0 / tw); tx <= Math.floor((x1 - 1) / tw); tx++) {
      for (const plane of planes) {
        const idx = (plane ?? 0) * perPlane + ty * tilesAcross + tx;
        const chunk = await decodeChunk(tif, image, idx);
        const cs = plane == null ? spp : 1;
        const cx0 = Math.max(x0, tx * tw), cx1 = Math.min(x1, (tx + 1) * tw, image.width);
        const cy0 = Math.max(y0, ty * th), cy1 = Math.min(y1, (ty + 1) * th, image.height);
        const sampleList = plane == null ? samples.map((s, i) => [s, i]) : [[0, samples.indexOf(plane)]];
        for (let y = cy0; y < cy1; y++) {
          const rowBase = ((y - ty * th) * tw - tx * tw) * cs;
          const oy = resample ? Math.min(oh - 1, Math.floor((y - y0) * sy)) : y - y0;
          for (let x = cx0; x < cx1; x++) {
            const ox = resample ? Math.min(ow - 1, Math.floor((x - x0) * sx)) : x - x0;
            const src = rowBase + x * cs;
            for (const [s, si] of sampleList) {
              const v = chunk[src + s];
              const di = (oy * ow + ox) * S + si;
              if (!resample) out[di] = v;
              else if (!(isFloat && Number.isNaN(v)) && v !== nodata) { sum[di] += v; cnt[di] += 1; }
            }
          }
        }
      }
    }
  }
  let data = out;
  if (resample) {
    data = new Typed(ow * oh * S);
    const nd = nodata ?? (isFloat ? NaN : 0);
    const round = !isFloat;
    for (let i = 0; i < data.length; i++) data[i] = cnt[i] ? (round ? Math.round(sum[i] / cnt[i]) : sum[i] / cnt[i]) : nd;
  }
  // 輸出格網的仿射（像素角點）
  let transform = null;
  if (image.transform) {
    const [a, b, c, d, e, f] = image.transform;
    const kx = ww / ow, ky = wh / oh;
    transform = [a * kx, b * ky, c + a * x0 + b * y0, d * kx, e * ky, f + d * x0 + e * y0];
  }
  return { width: ow, height: oh, samples: S, data, transform, nodata };
}

// ---------------------------------------------------------------- 入口
/**
 * 解析 GeoTIFF。只解析檔頭與 IFD，像素要呼叫 image.readRaster()。
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{ bigTiff, littleEndian, images, image, overviews, pick(maxSize) }}
 *   image 是第一張完整解析度影像；overviews 是同一張圖的縮圖（由大到小，transform 已依比例換算）。
 */
export function readGeoTIFF(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { r, big, ifds } = parseIFDs(u8);
  const tif = { u8 };
  const images = ifds.map((tags, i) => {
    const img = makeImage(tif, tags, i);
    img._le = r.le;
    return img;
  });
  const main = images.find(im => !(im.subfileType & 1) && !(im.subfileType & 4)) || images[0];
  // 縮圖（NewSubfileType bit0 = reduced；排除遮罩 bit2）：沿用主影像的地理參考，依比例換算 transform
  const overviews = images.filter(im => im !== main && (im.subfileType & 1) && !(im.subfileType & 4) && im.samplesPerPixel === main.samplesPerPixel)
    .sort((a, b) => b.width - a.width);
  for (const ov of overviews) {
    if (!ov.transform && main.transform) {
      const [a, b, c, d, e, f] = main.transform;
      const kx = main.width / ov.width, ky = main.height / ov.height;
      ov.transform = [a * kx, b * ky, c, d * kx, e * ky, f];
    }
    if (ov.nodata == null) ov.nodata = main.nodata;
    if (!ov.crs) { ov.crs = main.crs; ov.epsg = main.epsg; }
  }
  return {
    bigTiff: big, littleEndian: r.le, images, image: main, overviews,
    /** 挑最小但寬高仍 ≥ maxSize（或最接近）的那一層，縮圖讀取省記憶體 */
    pick(maxSize) {
      let best = main;
      for (const ov of overviews) if (Math.max(ov.width, ov.height) >= maxSize) best = ov;
      return best;
    },
  };
}

/**
 * 讀 DSM／DTM 成高程格網（float32，nodata 一律換成 NaN）。
 * @param {ArrayBuffer|Uint8Array|object} input GeoTIFF 位元組或 readGeoTIFF() 的結果
 * @param {object} [o]
 * @param {number} [o.maxSize] 輸出最長邊（像素）；超過就挑縮圖再逐塊縮小
 * @param {number[]} [o.window] 主影像的像素視窗
 * @param {number} [o.band=0]
 * @returns {Promise<{width, height, data: Float32Array, transform, crs, epsg, pixelSize}>}
 */
export async function readElevation(input, { maxSize, window, band = 0 } = {}) {
  const tif = input.images ? input : readGeoTIFF(input);
  let img = tif.image, win = window;
  if (maxSize && !window) img = tif.pick(maxSize);
  if (win && img !== tif.image) win = null;
  const ww = win ? win[2] - win[0] : img.width, wh = win ? win[3] - win[1] : img.height;
  const k = maxSize ? Math.min(1, maxSize / Math.max(ww, wh)) : 1;
  const r = await img.readRaster({ window: win, samples: [band], width: Math.max(1, Math.round(ww * k)), height: Math.max(1, Math.round(wh * k)) });
  const data = new Float32Array(r.data.length);
  for (let i = 0; i < data.length; i++) { const v = r.data[i]; data[i] = v === img.nodata ? NaN : v; }
  if (!r.transform) throw new Error('GeoTIFF 沒有地理參考（ModelTiepoint／ModelTransformation）');
  return { width: r.width, height: r.height, data, transform: r.transform, crs: img.crs, epsg: img.epsg, pixelSize: Math.hypot(r.transform[0], r.transform[3]) };
}

/**
 * 讀正射影像成 RGBA 8 位元（灰階、RGB 自動補成 RGBA；16 位元除以 257）。
 * @returns {Promise<{width, height, data: Uint8ClampedArray, transform, crs, epsg}>}
 */
export async function readOrthophoto(input, { maxSize = 4096, window } = {}) {
  const tif = input.images ? input : readGeoTIFF(input);
  let img = tif.image, win = window;
  if (!window) img = tif.pick(maxSize);
  if (win && img !== tif.image) win = null;
  const ww = win ? win[2] - win[0] : img.width, wh = win ? win[3] - win[1] : img.height;
  const k = Math.min(1, maxSize / Math.max(ww, wh));
  const spp = img.samplesPerPixel;
  const samples = spp >= 4 ? [0, 1, 2, 3] : spp === 3 ? [0, 1, 2] : spp === 2 ? [0, 1] : [0];
  const r = await img.readRaster({ window: win, samples, width: Math.max(1, Math.round(ww * k)), height: Math.max(1, Math.round(wh * k)) });
  const n = r.width * r.height;
  const out = new Uint8ClampedArray(n * 4);
  const div = img.bitsPerSample === 16 ? 257 : 1;
  for (let i = 0; i < n; i++) {
    const p = i * r.samples;
    if (r.samples >= 3) { out[4 * i] = r.data[p] / div; out[4 * i + 1] = r.data[p + 1] / div; out[4 * i + 2] = r.data[p + 2] / div; out[4 * i + 3] = r.samples === 4 ? r.data[p + 3] / div : 255; }
    else { const g = r.data[p] / div; out[4 * i] = out[4 * i + 1] = out[4 * i + 2] = g; out[4 * i + 3] = r.samples === 2 ? r.data[p + 1] / div : 255; }
  }
  return { width: r.width, height: r.height, data: out, transform: r.transform, crs: img.crs, epsg: img.epsg };
}
