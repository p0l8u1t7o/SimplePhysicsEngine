// LAZ（壓縮的 LAS 點雲）：用 core/vendor/laz-perf 解壓成一般 LAS，再交給 readLAS。
// OpenDroneMap 預設輸出 LAZ；解壓後的 LAS 保留原本的表頭、VLR（座標系）與 LAS 1.4 的 EVLR。
//   const las = await readLAZ(buffer, { maxPoints, classes })     和 readLAS 回傳的結構相同
//   const bytes = await lazToLas(buffer)                          只要解壓（例如存成 .las）
import { readLAS } from './las.js';

let loading = null;
export function loadLazPerf() {
  loading ??= (async () => {
    const [{ default: create }, { default: b64 }] = await Promise.all([import('../vendor/laz-perf/laz-perf.mjs'), import('../vendor/laz-perf/laz-perf-wasm.mjs')]);
    const wasmBinary = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    // 網頁版的載入程式在呼叫當下同步檢查環境（沒有 window 也不是 Worker 就拒絕）；Node（檢查程式）只在這一下暫時給 window，馬上拿掉
    const shim = typeof window === 'undefined' && typeof importScripts === 'undefined';
    if (shim) globalThis.window = globalThis;
    let p; try { p = create({ wasmBinary }); } finally { if (shim) delete globalThis.window; }
    return p;
  })();
  return loading;
}

const bytesOf = b => b instanceof Uint8Array ? b : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);

export async function lazToLas(input) {
  const src = bytesOf(input), dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  if (src[0] !== 0x4c || src[1] !== 0x41 || src[2] !== 0x53 || src[3] !== 0x46) throw new Error('不是 LAS／LAZ 檔（開頭不是 LASF）');
  if (!(src[104] & 0x80)) return src;                                       // 已經是未壓縮的 LAS
  const L = await loadLazPerf();
  const fp = L._malloc(src.length); L.HEAPU8.set(src, fp);                 // 每次取 L.HEAPU8：記憶體成長後舊的視圖會失效
  const zip = new L.LASZip();
  try {
    zip.open(fp, src.length);
    const n = zip.getCount(), len = zip.getPointLength(), offset = dv.getUint32(96, true), minor = src[25];
    // LAS 1.4 的 EVLR 在點資料後面（座標系 WKT 可能在這裡），解壓後位置會變，要搬過去並改表頭的起點
    let evlr = null;
    if (minor >= 4) { const start = Number(dv.getBigUint64(235, true)), count = dv.getUint32(243, true); if (count && start) evlr = src.subarray(start); }
    const out = new Uint8Array(offset + n * len + (evlr ? evlr.length : 0)), od = new DataView(out.buffer);
    out.set(src.subarray(0, offset));
    const dp = L._malloc(len);
    try { for (let i = 0; i < n; i++) { zip.getPoint(dp); out.set(L.HEAPU8.subarray(dp, dp + len), offset + i * len); } } finally { L._free(dp); }
    out[104] &= 0x3f;                                                         // 清掉壓縮旗標（bit 7、6），格式碼本身在低 6 位元
    od.setUint16(105, len, true);
    // LASzip 的 VLR（user id「laszip encoded」）描述的是壓縮參數，解壓後不再適用：改名成 vs3d-decoded（長度不變，其他 VLR 的位置不受影響）
    for (let i = 0, p = od.getUint16(94, true), nv = od.getUint32(100, true); i < nv && p + 54 <= offset; i++) {
      const user = new TextDecoder().decode(out.subarray(p + 2, p + 18)).replace(/\0+$/, '');
      if (user === 'laszip encoded') { out.fill(0, p + 2, p + 18); out.set(new TextEncoder().encode('vs3d-decoded'), p + 2); }
      p += 54 + od.getUint16(p + 20, true);
    }
    if (evlr) { out.set(evlr, offset + n * len); od.setBigUint64(235, BigInt(offset + n * len), true); }
    return out;
  } finally { zip.delete(); L._free(fp); }
}

export async function readLAZ(input, opts) { return readLAS(await lazToLas(input), opts); }
