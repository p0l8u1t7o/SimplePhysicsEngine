// core/geo/las.js：LAS 1.2～1.4 點雲讀取（未壓縮）→ THREE.Points（RGB／強度／分類／高度著色）。
// LAZ（壓縮）偵測到時丟出錯誤並說明轉檔方式；要直接讀 LAZ 見 README「LAZ」。
import * as THREE from 'three';
import { geoKeysFrom, crsFromKeys } from './geotiff.js';
import { crsFromEPSG } from './coords.js';

// 各點格式：記錄最小長度、RGB 位移、GPS 時間位移、是否為 1.4 新格式（6～10）
const FORMATS = {
  0: { size: 20, rgb: -1, gps: -1, ext: false }, 1: { size: 28, rgb: -1, gps: 20, ext: false },
  2: { size: 26, rgb: 20, gps: -1, ext: false }, 3: { size: 34, rgb: 28, gps: 20, ext: false },
  4: { size: 57, rgb: -1, gps: 20, ext: false }, 5: { size: 63, rgb: 28, gps: 20, ext: false },
  6: { size: 30, rgb: -1, gps: 22, ext: true }, 7: { size: 36, rgb: 30, gps: 22, ext: true },
  8: { size: 38, rgb: 30, gps: 22, ext: true }, 9: { size: 59, rgb: -1, gps: 22, ext: true },
  10: { size: 67, rgb: 30, gps: 22, ext: true },
};

const str = (u8, o, n) => { let s = ''; for (let i = 0; i < n && u8[o + i]; i++) s += String.fromCharCode(u8[o + i]); return s; };

/** 只讀檔頭與 VLR（不讀點） */
export function readLASHeader(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (str(u8, 0, 4) !== 'LASF') throw new Error('不是 LAS 檔（簽章不是 LASF）');
  const u16 = o => dv.getUint16(o, true), u32 = o => dv.getUint32(o, true), f64 = o => dv.getFloat64(o, true);
  const u64 = o => u32(o) + u32(o + 4) * 4294967296;
  const h = {
    version: `${u8[24]}.${u8[25]}`, major: u8[24], minor: u8[25],
    globalEncoding: u16(6), systemId: str(u8, 26, 32), software: str(u8, 58, 32),
    headerSize: u16(94), pointOffset: u32(96), vlrCount: u32(100),
    formatRaw: u8[104], recordLength: u16(105),
    count: u32(107),
    scale: [f64(131), f64(139), f64(147)], offset: [f64(155), f64(163), f64(171)],
    max: [f64(179), f64(195), f64(211)], min: [f64(187), f64(203), f64(219)],
  };
  if (h.minor >= 4 && h.headerSize >= 375) {
    const n = u64(247);
    if (n) h.count = n;
    h.evlrOffset = u64(235); h.evlrCount = u32(243);
  }
  h.compressed = (h.formatRaw & 0x80) !== 0 || (h.formatRaw & 0x40) !== 0;
  h.format = h.formatRaw & 0x3f;
  // VLR
  const vlrs = [];
  let p = h.headerSize;
  for (let i = 0; i < h.vlrCount && p + 54 <= u8.length; i++) {
    const len = u16(p + 20);
    vlrs.push({ user: str(u8, p + 2, 16), record: u16(p + 18), description: str(u8, p + 22, 32), data: u8.subarray(p + 54, p + 54 + len) });
    p += 54 + len;
  }
  if (h.evlrCount && h.evlrOffset) {
    let q = h.evlrOffset;
    for (let i = 0; i < h.evlrCount && q + 60 <= u8.length; i++) {
      const len = u64(q + 20);
      vlrs.push({ user: str(u8, q + 2, 16), record: u16(q + 18), description: str(u8, q + 28, 32), data: u8.subarray(q + 60, q + 60 + len), extended: true });
      q += 60 + len;
    }
  }
  h.vlrs = vlrs;
  if (vlrs.some(v => v.user === 'laszip encoded')) h.compressed = true;
  h.crs = crsOfVLRs(vlrs);
  return h;
}

function crsOfVLRs(vlrs) {
  const proj = vlrs.filter(v => v.user === 'LASF_Projection');
  const wkt = proj.find(v => v.record === 2112);
  if (wkt) {
    const s = str(wkt.data, 0, wkt.data.length);
    // WKT1 的最外層 AUTHORITY 在最後；WKT2 用 ID["EPSG",code]
    const m = [...s.matchAll(/(?:AUTHORITY\["EPSG",\s*"?(\d+)"?\]|ID\["EPSG",\s*(\d+)\])/g)].pop();
    const epsg = m ? Number(m[1] || m[2]) : null;
    return { epsg, crs: epsg ? crsFromEPSG(epsg) : null, wkt: s };
  }
  const dirV = proj.find(v => v.record === 34735);
  if (dirV) {
    const d = new DataView(dirV.data.buffer, dirV.data.byteOffset, dirV.data.byteLength);
    const dir = Array.from({ length: dirV.data.length / 2 }, (_, i) => d.getUint16(2 * i, true));
    const dv = proj.find(v => v.record === 34736);
    const dbl = dv ? Array.from({ length: dv.data.length / 8 }, (_, i) => new DataView(dv.data.buffer, dv.data.byteOffset).getFloat64(8 * i, true)) : [];
    const av = proj.find(v => v.record === 34737);
    const asc = av ? str(av.data, 0, av.data.length) : '';
    const keys = geoKeysFrom(dir, dbl, asc);
    return { ...crsFromKeys(keys), keys };
  }
  return { epsg: null, crs: null };
}

/**
 * 讀 LAS 點。
 * @param {ArrayBuffer|Uint8Array} input
 * @param {object} [o]
 * @param {number} [o.maxPoints] 最多讀幾點（等間隔抽樣，決定性）
 * @param {number[]} [o.classes] 只要這些分類（例如 [2] 只要地面）
 * @returns {{ header, count, x: Float64Array, y: Float64Array, z: Float64Array, intensity: Uint16Array,
 *   classification: Uint8Array, returnNumber: Uint8Array, rgb: Uint16Array|null, rgbBits: 8|16, gpsTime: Float64Array|null }}
 *   x、y、z 是投影座標（E、N、高程，公尺）
 */
export function readLAS(input, { maxPoints, classes } = {}) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const h = readLASHeader(u8);
  if (h.compressed) throw new Error('這是 LAZ（壓縮點雲），請先轉成 LAS：PDAL `pdal translate in.laz out.las`、LAStools `laszip -i in.laz -o out.las`，或 OpenDroneMap 輸出時選 LAS');
  const F = FORMATS[h.format];
  if (!F) throw new Error(`點格式 ${h.format} 不支援`);
  if (h.recordLength < F.size) throw new Error(`點記錄長度 ${h.recordLength} 小於格式 ${h.format} 的 ${F.size}`);
  const total = Math.min(h.count, Math.floor((u8.length - h.pointOffset) / h.recordLength));
  const stride = maxPoints && total > maxPoints ? Math.ceil(total / maxPoints) : 1;
  const cap = Math.ceil(total / stride);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const x = new Float64Array(cap), y = new Float64Array(cap), z = new Float64Array(cap);
  const intensity = new Uint16Array(cap), classification = new Uint8Array(cap), returnNumber = new Uint8Array(cap);
  const rgb = F.rgb >= 0 ? new Uint16Array(cap * 3) : null;
  const gpsTime = F.gps >= 0 ? new Float64Array(cap) : null;
  const [sx, sy, sz] = h.scale, [ox, oy, oz] = h.offset;
  const want = classes ? new Set(classes) : null;
  let n = 0, rgbMax = 0;
  for (let i = 0; i < total; i += stride) {
    const p = h.pointOffset + i * h.recordLength;
    const cls = F.ext ? u8[p + 16] : u8[p + 15] & 31;
    if (want && !want.has(cls)) continue;
    x[n] = dv.getInt32(p, true) * sx + ox;
    y[n] = dv.getInt32(p + 4, true) * sy + oy;
    z[n] = dv.getInt32(p + 8, true) * sz + oz;
    intensity[n] = dv.getUint16(p + 12, true);
    classification[n] = cls;
    returnNumber[n] = F.ext ? u8[p + 14] & 15 : u8[p + 14] & 7;
    if (rgb) {
      for (let c = 0; c < 3; c++) { const v = dv.getUint16(p + F.rgb + 2 * c, true); rgb[3 * n + c] = v; if (v > rgbMax) rgbMax = v; }
    }
    if (gpsTime) gpsTime[n] = dv.getFloat64(p + F.gps, true);
    n++;
  }
  const cut = a => (a && a.length !== n * (a === rgb ? 3 : 1) ? a.slice(0, n * (a === rgb ? 3 : 1)) : a);
  return {
    header: h, count: n, stride,
    x: cut(x), y: cut(y), z: cut(z), intensity: cut(intensity), classification: cut(classification), returnNumber: cut(returnNumber),
    rgb: cut(rgb), rgbBits: rgbMax > 255 ? 16 : 8, gpsTime: cut(gpsTime),
  };
}

// ASPRS 標準分類配色（sRGB）
export const CLASS_COLORS = {
  0: [160, 160, 160], 1: [190, 190, 190], 2: [150, 110, 70], 3: [140, 200, 110], 4: [80, 170, 70], 5: [30, 120, 40],
  6: [220, 90, 60], 7: [255, 0, 255], 8: [255, 255, 0], 9: [60, 120, 230], 10: [120, 80, 50], 11: [90, 90, 90],
  13: [230, 230, 60], 14: [230, 230, 60], 15: [200, 120, 220], 16: [230, 160, 60], 17: [120, 120, 200], 18: [255, 0, 128],
};

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * 點雲 → 案場座標的 THREE.Points（分塊，每塊頂點相對塊中心）。
 * @param {object} las readLAS() 的結果
 * @param {object} site createSiteFrame()
 * @param {object} [o]
 * @param {'rgb'|'intensity'|'classification'|'height'} [o.colorBy] 預設有 RGB 用 RGB，否則分類
 * @param {number} [o.size=2] 點大小（像素，sizeAttenuation=false）
 * @param {number} [o.chunk=50000] 分塊邊長（mm）
 * @param {object} [o.crs] 點雲的投影（預設讀 LAS 的 VLR；沒有就假設和案場相同）
 * @returns {{ root: THREE.Group, positions: Float64Array（案場 mm，xyz 交錯，分析用）, count }}
 */
export function createPointCloud(las, site, o = {}) {
  const n = las.count;
  const crs = o.crs || las.header.crs?.crs || null;
  const sameCRS = !crs || !crs.params || (crs.params.lon0 === site.crs.params.lon0 && crs.params.k0 === site.crs.params.k0 && crs.params.x0 === site.crs.params.x0 && crs.params.y0 === site.crs.params.y0 && crs.params.ellps === site.crs.params.ellps);
  const positions = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    let s;
    if (sameCRS) s = site.fromMap(las.x[i], las.y[i], las.z[i]);
    else { const g = crs.inverse(las.x[i], las.y[i]); s = site.fromLatLon(g.lat, g.lon, las.z[i]); }
    positions[3 * i] = s.x; positions[3 * i + 1] = s.y; positions[3 * i + 2] = s.z;
  }
  const colorBy = o.colorBy || (las.rgb ? 'rgb' : 'classification');
  // 顏色（線性，Uint16 正規化，6 bytes／點）
  const col = new Uint16Array(n * 3);
  if (colorBy === 'rgb' && las.rgb) {
    const div = las.rgbBits === 16 ? 65535 : 255;
    for (let i = 0; i < 3 * n; i++) col[i] = Math.round(srgbToLinear(las.rgb[i] / div) * 65535);
  } else if (colorBy === 'intensity') {
    const sorted = Float64Array.from(las.intensity).sort();
    const lo = sorted[Math.floor(n * 0.02)] || 0, hi = sorted[Math.floor(n * 0.98)] || 1;
    for (let i = 0; i < n; i++) { const v = Math.round(srgbToLinear(Math.max(0, Math.min(1, (las.intensity[i] - lo) / (hi - lo || 1)))) * 65535); col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = v; }
  } else if (colorBy === 'height') {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const v = positions[3 * i + 1]; if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < n; i++) {
      const t = (positions[3 * i + 1] - lo) / (hi - lo || 1);
      const c = new THREE.Color().setHSL(0.66 * (1 - t), 0.85, 0.5);   // 藍（低）→ 紅（高），線性色
      col[3 * i] = Math.round(c.r * 65535); col[3 * i + 1] = Math.round(c.g * 65535); col[3 * i + 2] = Math.round(c.b * 65535);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const c = CLASS_COLORS[las.classification[i]] || [255, 255, 255];
      for (let k = 0; k < 3; k++) col[3 * i + k] = Math.round(srgbToLinear(c[k] / 255) * 65535);
    }
  }
  // 分塊
  const chunk = o.chunk || 50000;
  const bins = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(positions[3 * i] / chunk)},${Math.floor(positions[3 * i + 2] / chunk)}`;
    let b = bins.get(key);
    if (!b) bins.set(key, b = []);
    b.push(i);
  }
  const root = new THREE.Group();
  root.name = 'point cloud';
  root.userData.geo = 'pointcloud';
  root.userData.noBom = '現場點雲';
  const material = new THREE.PointsMaterial({ size: o.size || 2, sizeAttenuation: false, vertexColors: true });
  for (const key of [...bins.keys()].sort()) {
    const idx = bins.get(key);
    const [bx, bz] = key.split(',').map(Number);
    const cx = (bx + 0.5) * chunk, cz = (bz + 0.5) * chunk;
    const pos = new Float32Array(idx.length * 3), c = new Uint16Array(idx.length * 3);
    idx.forEach((i, k) => {
      pos[3 * k] = positions[3 * i] - cx; pos[3 * k + 1] = positions[3 * i + 1]; pos[3 * k + 2] = positions[3 * i + 2] - cz;
      c[3 * k] = col[3 * i]; c[3 * k + 1] = col[3 * i + 1]; c[3 * k + 2] = col[3 * i + 2];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3, true));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const pts = new THREE.Points(g, material);
    pts.name = `points ${key}`;
    pts.position.set(cx, 0, cz);
    pts.userData.geo = 'pointcloud';
    root.add(pts);
  }
  return { root, positions, count: n, material };
}
