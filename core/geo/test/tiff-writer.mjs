// 測試用的 GeoTIFF 寫入器：產生小型合成檔，讓測試不依賴外部資料。
// 支援 TIFF／BigTIFF、II／MM、strip／tile、planar 1／2、壓縮 none／deflate／lzw／packbits、預測器 1／2／3、
// GeoKey（EPSG 或使用者自訂橫麥卡托）、GDAL_NODATA、縮圖（NewSubfileType=1）。

// ---------------------------------------------------------------- 壓縮
async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  w.write(u8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

export function lzwEncode(src) {
  const out = [];
  let acc = 0, nacc = 0;
  let width = 9;
  const put = code => {
    acc = (acc << width) | code; nacc += width;
    while (nacc >= 8) { out.push((acc >>> (nacc - 8)) & 0xff); nacc -= 8; }
    acc &= (1 << nacc) - 1;
  };
  let dict = new Map(), next = 258;
  put(256);
  if (!src.length) { put(257); if (nacc) out.push((acc << (8 - nacc)) & 0xff); return new Uint8Array(out); }
  let w = src[0];
  for (let i = 1; i < src.length; i++) {
    const c = src[i];
    const key = w * 256 + c;
    const hit = dict.get(key);
    if (hit !== undefined) { w = hit; continue; }
    put(w);
    dict.set(key, next++);
    if (next === 4094) { put(256); dict = new Map(); next = 258; width = 9; }
    else if (next > (1 << width) - 1 && width < 12) width++;
    w = c;
  }
  put(w);
  next++;
  if (next > (1 << width) - 1 && width < 12) width++;
  put(257);
  if (nacc) out.push((acc << (8 - nacc)) & 0xff);
  return new Uint8Array(out);
}

export function packbitsEncode(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) { out.push((1 - run) & 0xff, src[i]); i += run; continue; }
    let lit = 1;
    while (i + lit < src.length && lit < 128 && !(i + lit + 1 < src.length && src[i + lit] === src[i + lit + 1])) lit++;
    out.push(lit - 1);
    for (let k = 0; k < lit; k++) out.push(src[i + k]);
    i += lit;
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- 樣本 → 位元組（含預測器）
function encodeChunk(vals, w, rows, spp, bits, format, le, predictor) {
  const bytesPer = bits / 8;
  const out = new Uint8Array(w * rows * spp * bytesPer);
  const dv = new DataView(out.buffer);
  const n = w * rows * spp;
  if (predictor === 3) {
    const wc = w * spp, rowBytes = wc * bytesPer;
    const tmp = new Uint8Array(rowBytes), word = new DataView(new ArrayBuffer(bytesPer));
    for (let y = 0; y < rows; y++) {
      for (let k = 0; k < wc; k++) {
        if (bytesPer === 4) word.setFloat32(0, vals[y * wc + k], false); else word.setFloat64(0, vals[y * wc + k], false);
        for (let b = 0; b < bytesPer; b++) tmp[b * wc + k] = word.getUint8(b);
      }
      for (let i = rowBytes - 1; i >= spp; i--) tmp[i] = (tmp[i] - tmp[i - spp]) & 0xff;
      out.set(tmp, y * rowBytes);
    }
    return out;
  }
  let v = vals;
  if (predictor === 2) {
    const U = { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array }[bytesPer];
    const T = vals.constructor;
    const copy = new T(vals);
    const u = new U(copy.buffer, copy.byteOffset, n);
    const orig = new U(u);
    const row = w * spp;
    for (let y = 0; y < rows; y++) for (let i = spp; i < row; i++) u[y * row + i] = orig[y * row + i] - orig[y * row + i - spp];
    v = copy;
  }
  const set = format === 3 ? (bytesPer === 4 ? (o, x) => dv.setFloat32(o, x, le) : (o, x) => dv.setFloat64(o, x, le))
    : format === 2 ? { 1: (o, x) => dv.setInt8(o, x), 2: (o, x) => dv.setInt16(o, x, le), 4: (o, x) => dv.setInt32(o, x, le) }[bytesPer]
      : { 1: (o, x) => dv.setUint8(o, x), 2: (o, x) => dv.setUint16(o, x, le), 4: (o, x) => dv.setUint32(o, x, le) }[bytesPer];
  for (let i = 0; i < n; i++) set(i * bytesPer, v[i]);
  return out;
}

async function compress(u8, c) {
  if (c === 'none') return u8;
  if (c === 'deflate') return deflate(u8);
  if (c === 'lzw') return lzwEncode(u8);
  if (c === 'packbits') return packbitsEncode(u8);
  throw new Error(c);
}
const COMP = { none: 1, lzw: 5, deflate: 8, packbits: 32773 };

// 從整張影像切出一塊（不足處補 0）
function extract(img, x0, y0, w, h, sample) {
  const { width, height, samples, data } = img;
  const spp = sample == null ? samples : 1;
  const out = new data.constructor(w * h * spp);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x, sy = y0 + y;
    if (sx >= width || sy >= height) continue;
    for (let s = 0; s < spp; s++) out[(y * w + x) * spp + s] = data[(sy * width + sx) * samples + (sample ?? s)];
  }
  return out;
}

/**
 * @param {object[]} images [{ width, height, samples, data(TypedArray 交錯), bits, format(1 uint/2 int/3 float),
 *   compression, predictor, tile:[tw,th]|null, rowsPerStrip, planar, geo:{ epsg | tm:{lon0,k0,x0,y0,ellps:7019}, origin:[X,Y], pixel:[dx,dy], pixelIsPoint, matrix }, nodata, subfile }]
 * @param {{ littleEndian?: boolean, bigTiff?: boolean }} [opts]
 */
export async function writeTIFF(images, { littleEndian = true, bigTiff = false } = {}) {
  const le = littleEndian;
  const parts = [];       // [offset, Uint8Array]
  let pos = bigTiff ? 16 : 8;
  const add = u8 => { const o = pos; parts.push([o, u8]); pos += u8.length + (u8.length & 1); return o; };
  const ifdOffsets = [];
  const ifdPatches = [];  // 下一個 IFD 位址的位置

  for (const im of images) {
    const { width, height, samples, bits, format = 1, compression = 'none', predictor = 1, tile = null, planar = 1 } = im;
    const tw = tile ? tile[0] : width, th = tile ? tile[1] : (im.rowsPerStrip || height);
    const across = Math.ceil(width / tw), down = Math.ceil(height / th);
    const offsets = [], counts = [];
    const planes = planar === 2 ? [...Array(samples).keys()] : [null];
    for (const pl of planes) for (let ty = 0; ty < down; ty++) for (let tx = 0; tx < across; tx++) {
      const rows = tile ? th : Math.min(th, height - ty * th);
      const vals = extract(im, tx * tw, ty * th, tw, rows, pl);
      const raw = encodeChunk(vals, tw, rows, pl == null ? samples : 1, bits, format, le, predictor);
      const c = await compress(raw, compression);
      offsets.push(add(c)); counts.push(c.length);
    }
    // 標籤
    const tags = [];
    const T = (tag, type, values) => tags.push({ tag, type, values: Array.isArray(values) || typeof values === 'string' ? values : [values] });
    if (im.subfile) T(254, 4, im.subfile);
    T(256, 4, width); T(257, 4, height);
    T(258, 3, Array(samples).fill(bits));
    T(259, 3, COMP[compression]);
    T(262, 3, samples >= 3 ? 2 : 1);
    if (!tile) { T(273, bigTiff ? 16 : 4, offsets); T(278, 4, th); T(279, 4, counts); }
    T(277, 3, samples);
    T(284, 3, planar);
    if (predictor !== 1) T(317, 3, predictor);
    if (tile) { T(322, 3, tw); T(323, 3, th); T(324, bigTiff ? 16 : 4, offsets); T(325, 4, counts); }
    if (samples === 4) T(338, 3, 2);
    T(339, 3, Array(samples).fill(format));
    const g = im.geo;
    if (g) {
      if (g.matrix) T(34264, 12, g.matrix);
      else { T(33550, 12, [g.pixel[0], g.pixel[1], 0]); T(33922, 12, [0, 0, 0, g.origin[0], g.origin[1], 0]); }
      const keys = [[1024, 0, 1, 1], [1025, 0, 1, g.pixelIsPoint ? 2 : 1]];
      const dbl = [];
      if (g.epsg) keys.push([3072, 0, 1, g.epsg]);
      else if (g.tm) {
        const d = (id, v) => { keys.push([id, 34736, 1, dbl.length]); dbl.push(v); };
        keys.push([2056, 0, 1, g.tm.ellps || 7019], [3072, 0, 1, 32767], [3074, 0, 1, 32767], [3075, 0, 1, 1], [3076, 0, 1, 9001]);
        d(3080, g.tm.lon0); d(3081, 0); d(3082, g.tm.x0); d(3083, g.tm.y0 || 0); d(3092, g.tm.k0);
      }
      keys.sort((a, b) => a[0] - b[0]);
      T(34735, 3, [1, 1, 0, keys.length, ...keys.flat()]);
      if (dbl.length) T(34736, 12, dbl);
    }
    if (im.nodata != null) T(42113, 2, String(im.nodata) + '\0');
    tags.sort((a, b) => a.tag - b.tag);

    // IFD 本體與外部數值
    const SIZE = { 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };
    const inline = bigTiff ? 8 : 4;
    const entry = bigTiff ? 20 : 12;
    const head = bigTiff ? 8 : 2, tail = bigTiff ? 8 : 4;
    const ifdLen = head + tags.length * entry + tail;
    const ifd = new Uint8Array(ifdLen);
    const idv = new DataView(ifd.buffer);
    const ifdPos = pos; pos += ifdLen + (ifdLen & 1);
    parts.push([ifdPos, ifd]);
    if (bigTiff) idv.setBigUint64(0, BigInt(tags.length), le); else idv.setUint16(0, tags.length, le);
    const writeVals = (dv, o, type, values) => {
      if (type === 2) { for (let i = 0; i < values.length; i++) dv.setUint8(o + i, values.charCodeAt(i)); return; }
      values.forEach((v, i) => {
        if (type === 3) dv.setUint16(o + 2 * i, v, le);
        else if (type === 4) dv.setUint32(o + 4 * i, v, le);
        else if (type === 12) dv.setFloat64(o + 8 * i, v, le);
        else if (type === 16) dv.setBigUint64(o + 8 * i, BigInt(v), le);
      });
    };
    tags.forEach((t, i) => {
      const p = head + i * entry;
      const count = t.values.length, size = SIZE[t.type] * count;
      idv.setUint16(p, t.tag, le); idv.setUint16(p + 2, t.type, le);
      if (bigTiff) idv.setBigUint64(p + 4, BigInt(count), le); else idv.setUint32(p + 4, count, le);
      const vp = p + (bigTiff ? 12 : 8);
      if (size <= inline) writeVals(idv, vp, t.type, t.values);
      else {
        const buf = new Uint8Array(size);
        writeVals(new DataView(buf.buffer), 0, t.type, t.values);
        const o = add(buf);
        if (bigTiff) idv.setBigUint64(vp, BigInt(o), le); else idv.setUint32(vp, o, le);
      }
    });
    ifdOffsets.push(ifdPos);
    ifdPatches.push(ifdPos + head + tags.length * entry);
  }
  const out = new Uint8Array(pos);
  const dv = new DataView(out.buffer);
  for (const [o, u8] of parts) out.set(u8, o);
  out[0] = out[1] = le ? 0x49 : 0x4d;
  dv.setUint16(2, bigTiff ? 43 : 42, le);
  if (bigTiff) { dv.setUint16(4, 8, le); dv.setUint16(6, 0, le); dv.setBigUint64(8, BigInt(ifdOffsets[0]), le); }
  else dv.setUint32(4, ifdOffsets[0], le);
  for (let i = 0; i < ifdPatches.length; i++) {
    const nextOff = ifdOffsets[i + 1] || 0;
    if (bigTiff) dv.setBigUint64(ifdPatches[i], BigInt(nextOff), le); else dv.setUint32(ifdPatches[i], nextOff, le);
  }
  return out;
}

// ---------------------------------------------------------------- 合成資料
/** 合成 DSM：平面斜坡＋一個丘＋一塊 nodata；回傳 { width, height, data(Float32Array), fn(col,row) } */
export function syntheticDSM(width, height, { nodata = -9999, hole = true } = {}) {
  const fn = (c, r) => 50 + 0.02 * c - 0.01 * r + 3 * Math.exp(-((c - width * 0.6) ** 2 + (r - height * 0.4) ** 2) / (2 * (width * 0.12) ** 2));
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const inHole = hole && c >= 2 && c < 5 && r >= height - 5 && r < height - 2;
    data[r * width + c] = inHole ? nodata : fn(c + 0.5, r + 0.5);
  }
  return { width, height, samples: 1, data, fn, bits: 32, format: 3 };
}

/** 合成正射影像 RGB（或 RGBA）：格子圖案，像素值可預測 */
export function syntheticRGB(width, height, samples = 3) {
  const data = new Uint8Array(width * height * samples);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const i = (r * width + c) * samples;
    data[i] = (c * 7) & 255; data[i + 1] = (r * 5) & 255; data[i + 2] = ((c >> 3) + (r >> 3)) & 1 ? 200 : 40;
    if (samples === 4) data[i + 3] = 255;
  }
  return { width, height, samples, data, bits: 8, format: 1 };
}
