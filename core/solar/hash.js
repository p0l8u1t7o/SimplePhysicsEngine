// 決定性檢查用的雜湊：把數值陣列的 IEEE-754 位元組做 FNV-1a 64 位（BigInt 不需要，用兩個 32 位累加）。
// Node 與瀏覽器同一份輸入得到同一個字串；NaN 一律正規化成同一個位元型樣。
export function hashFloat64(values) {
  const f = new Float64Array(1), b = new Uint8Array(f.buffer);
  let h1 = 0x811c9dc5 >>> 0, h2 = 0x01000193 >>> 0;
  const push = v => {
    f[0] = Number.isNaN(v) ? NaN : v === 0 ? 0 : v;   // −0 與 0 視為相同
    for (let k = 0; k < 8; k++) {
      h1 = Math.imul(h1 ^ b[k], 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ b[7 - k], 0x01000193) >>> 0;
    }
  };
  for (const v of values) {
    if (typeof v === 'number') push(v);
    else if (v && typeof v.length === 'number') for (let i = 0; i < v.length; i++) push(v[i]);
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
