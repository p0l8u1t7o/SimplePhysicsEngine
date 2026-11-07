// 決定性數學函式（deterministic libm）：fdlibm 5.3 的 JavaScript 移植，只用 IEEE-754 精確運算（+ − × ÷、sqrt）
// 與位元操作，因此任何 JS 引擎、任何版本都得到相同位元。
// 原因：V8 不同版本的 Math.sin／cos／tan／atan／atan2／asin／acos／exp／log 結果末位會不同
// （實測 Node 26.13 與 Chrome 157 有 3～19% 的輸入差 1 ulp），「同是 V8」不保證 Node 與瀏覽器逐位元相同。
// 精度：與 fdlibm 相同（< 1 ulp）。三角函式的引數化簡支援 |x| ≤ 2^19·π/2（約 8.2e5 弧度），超過時改用
// 三段 π/2 的 Cody–Waite 化簡（仍決定性，但大引數精度下降；core/solar 的引數都遠小於此）。
//
// ====================================================
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunSoft, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this
// software is freely granted, provided that this notice
// is preserved.
// ====================================================

const F = new Float64Array(1), U = new Uint32Array(F.buffer), I = new Int32Array(F.buffer);
const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1, HI = LE ? 1 : 0, LO = LE ? 0 : 1;
const hiw = x => { F[0] = x; return I[HI]; };
const low = x => { F[0] = x; return U[LO]; };
const withLow0 = x => { F[0] = x; U[LO] = 0; return F[0]; };
const fromWords = (h, l) => { I[HI] = h; U[LO] = l; return F[0]; };
const setHigh = (x, h) => { F[0] = x; I[HI] = h; return F[0]; };

// ---------------------------------------------------------------- 三角
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function kSin(x, y, iy) {
  const ix = hiw(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kCos(x, y) {
  const ix = hiw(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * y));
}
const T = [3.33333333333334091986e-01, 1.33333333333201242699e-01, 5.39682539762260521377e-02, 2.18694882948595424599e-02,
  8.86323982359930005737e-03, 3.59207910759131235356e-03, 1.45620945432529025516e-03, 5.88041240820264096874e-04,
  2.46463134818469906812e-04, 7.81794442939557092300e-05, 7.14072491382608190305e-05, -1.85586374855275456654e-05,
  2.59073051863633712884e-05];
const PIO4 = 7.85398163397448278999e-01, PIO4LO = 3.06161699786838301793e-17;
function kTan(x, y, iy) {
  let z, r, v, w, s;
  const hx = hiw(x), ix = hx & 0x7fffffff;
  if (ix < 0x3e300000 && (x | 0) === 0) {
    if (((ix | low(x)) | (iy + 1)) === 0) return 1 / Math.abs(x);
    if (iy === 1) return x;
    w = x + y; z = withLow0(w); v = y - (z - x);
    const a = -1 / w, t = withLow0(a); s = 1 + t * z;
    return t + a * (s + t * v);
  }
  if (ix >= 0x3FE59428) {
    if (hx < 0) { x = -x; y = -y; }
    z = PIO4 - x; w = PIO4LO - y; x = z + w; y = 0.0;
  }
  z = x * x; w = z * z;
  r = T[1] + w * (T[3] + w * (T[5] + w * (T[7] + w * (T[9] + w * T[11]))));
  v = z * (T[2] + w * (T[4] + w * (T[6] + w * (T[8] + w * (T[10] + w * T[12])))));
  s = z * x;
  r = y + z * (s * (r + v) + y);
  r += T[0] * s;
  w = x + r;
  if (ix >= 0x3FE59428) { v = iy; return (1 - ((hx >> 30) & 2)) * (v - 2.0 * (x - (w * w / (w + v) - r))); }
  if (iy === 1) return w;
  z = withLow0(w); v = r - (z - x);
  const a = -1.0 / w, t = withLow0(a); s = 1.0 + t * z;
  return t + a * (s + t * v);
}
const NPIO2_HW = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A,
  0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C,
  0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB];
const INVPIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11,
  PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21, PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const Y = [0, 0];
// x 化簡到 [−π/4, π/4]：回傳 n，餘數放在 Y[0] + Y[1]
function remPio2(x) {
  const hx = hiw(x), ix = hx & 0x7fffffff;
  let z, w, t, r, fn, n;
  if (ix <= 0x3fe921fb) { Y[0] = x; Y[1] = 0; return 0; }
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { Y[0] = z - PIO2_1T; Y[1] = (z - Y[0]) - PIO2_1T; }
      else { z -= PIO2_2; Y[0] = z - PIO2_2T; Y[1] = (z - Y[0]) - PIO2_2T; }
      return 1;
    }
    z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { Y[0] = z + PIO2_1T; Y[1] = (z - Y[0]) + PIO2_1T; }
    else { z += PIO2_2; Y[0] = z + PIO2_2T; Y[1] = (z - Y[0]) + PIO2_2T; }
    return -1;
  }
  if (ix >= 0x7ff00000) { Y[0] = Y[1] = x - x; return 0; }
  if (ix > 0x413921fb) return remPio2Big(x);
  // 中等大小（fdlibm 的 |x| ≤ 2^19·π/2 分支）
  t = Math.abs(x);
  n = Math.floor(t * INVPIO2 + 0.5);
  fn = n;
  r = t - fn * PIO2_1;
  w = fn * PIO2_1T;
  if (n < 32 && ix !== NPIO2_HW[n - 1]) Y[0] = r - w;
  else {
    const j = ix >> 20;
    Y[0] = r - w;
    let i = j - ((hiw(Y[0]) >> 20) & 0x7ff);
    if (i > 16) {
      t = r; w = fn * PIO2_2; r = t - w; w = fn * PIO2_2T - ((t - r) - w); Y[0] = r - w;
      i = j - ((hiw(Y[0]) >> 20) & 0x7ff);
      if (i > 49) { t = r; w = fn * PIO2_3; r = t - w; w = fn * PIO2_3T - ((t - r) - w); Y[0] = r - w; }
    }
  }
  Y[1] = (r - Y[0]) - w;
  if (hx < 0) { Y[0] = -Y[0]; Y[1] = -Y[1]; return -n; }
  return n;
}

// 大引數（|x| > 2^19·π/2）：用 BigInt 做精確的 x·(2/π) 取餘（Payne–Hanek 的概念），餘數以 double-double 乘 π/2。
// 2/π 的位元在第一次用到時以 Machin 公式（BigInt 定點）算出，決定性。
const PREC = 1280n;
let TWO_OVER_PI = 0n;
function twoOverPi() {
  if (TWO_OVER_PI) return TWO_OVER_PI;
  const P = PREC + 64n, one = 1n << P;
  const atanInv = k => { let s = 0n, term = one / k, n = 1n, sign = 1n; const k2 = k * k; while (term) { s += sign * term / n; term /= k2; n += 2n; sign = -sign; } return s; };
  const pi = 16n * atanInv(5n) - 4n * atanInv(239n);          // π·2^P
  TWO_OVER_PI = (2n << (P + PREC)) / pi;                      // (2/π)·2^PREC
  return TWO_OVER_PI;
}
const SPLIT = 134217729;   // 2^27 + 1（Veltkamp 分割，兩數乘積的精確誤差）
function twoProd(a, b) {
  const p = a * b;
  let t = SPLIT * a; const ah = t - (t - a), al = a - ah;
  t = SPLIT * b; const bh = t - (t - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}
const PIO2_DH = 1.5707963267948966, PIO2_DL = 6.123233995736766e-17, TWOM120 = fromWords(0x38700000, 0);   // 2^-120
function remPio2Big(x) {
  F[0] = Math.abs(x);
  const e = ((U[HI] >>> 20) & 0x7ff) - 1075;                  // |x| = M·2^e
  const M = (BigInt(U[HI] & 0xfffff | 0x100000) << 32n) | BigInt(U[LO]);
  const prod = M * twoOverPi(), s = PREC - BigInt(e);         // |x|·2/π = prod / 2^s
  let q = prod >> s, frac = prod & ((1n << s) - 1n);
  const half = 1n << (s - 1n);
  let neg = false;
  if (frac >= half) { q += 1n; frac = (1n << s) - frac; neg = true; }
  // frac / 2^s → double-double（取前 120 位）
  const sh = s - 120n, top = sh > 0n ? frac >> sh : frac << -sh;
  const fhi = Number(top) * TWOM120, flo = Number(top - BigInt(Number(top))) * TWOM120;
  const [p, err] = twoProd(fhi, PIO2_DH);
  const e2 = err + (fhi * PIO2_DL + flo * PIO2_DH);
  let y0 = p + e2, y1 = e2 - (y0 - p);
  if (neg) { y0 = -y0; y1 = -y1; }
  const n = Number(q & 3n);
  if (x < 0) { Y[0] = -y0; Y[1] = -y1; return -n; }
  Y[0] = y0; Y[1] = y1; return n;
}
export function sin(x) {
  const ix = hiw(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) { case 0: return kSin(Y[0], Y[1], 1); case 1: return kCos(Y[0], Y[1]); case 2: return -kSin(Y[0], Y[1], 1); default: return -kCos(Y[0], Y[1]); }
}
export function cos(x) {
  const ix = hiw(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  switch (n & 3) { case 0: return kCos(Y[0], Y[1]); case 1: return -kSin(Y[0], Y[1], 1); case 2: return -kCos(Y[0], Y[1]); default: return kSin(Y[0], Y[1], 1); }
}
export function tan(x) {
  const ix = hiw(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kTan(x, 0, 1);
  if (ix >= 0x7ff00000) return x - x;
  const n = remPio2(x);
  return kTan(Y[0], Y[1], 1 - ((n & 1) << 1));
}

// ---------------------------------------------------------------- 反三角
const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
export function atan(x) {
  const hx = hiw(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && low(x) !== 0)) return x + x;
    return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); } else { id = 1; x = (x - 1.0) / (x + 1.0); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); } else { id = 3; x = -1.0 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}
const PI = 3.1415926535897931160E+00, PI_O_2 = 1.5707963267948965580E+00, PI_O_4 = 7.8539816339744827900E-01, PI_LO = 1.2246467991473531772E-16, TINY = 1.0e-300;
export function atan2(y, x) {
  if (x !== x || y !== y) return x + y;
  const hx = hiw(x), ix = hx & 0x7fffffff, lx = low(x), hy = hiw(y), iy = hy & 0x7fffffff, ly = low(y);
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) { switch (m) { case 0: case 1: return y; case 2: return PI + TINY; default: return -PI - TINY; } }
  if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) { switch (m) { case 0: return PI_O_4 + TINY; case 1: return -PI_O_4 - TINY; case 2: return 3.0 * PI_O_4 + TINY; default: return -3.0 * PI_O_4 - TINY; } }
    switch (m) { case 0: return 0; case 1: return -0; case 2: return PI + TINY; default: return -PI - TINY; }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) { z = PI_O_2 + 0.5 * PI_LO; m &= 1; }
  else if (hx < 0 && k < -60) z = 0.0;
  else z = atan(Math.abs(y / x));
  switch (m) { case 0: return z; case 1: return -z; case 2: return PI - (z - PI_LO); default: return (z - PI_LO) - PI; }
}
const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17, PIO4_HI = 7.85398163397448278999e-01;
const pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01, pS3 = -4.00555345006794114027e-02,
  pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05, qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00,
  qS3 = -6.88283971605453293030e-01, qS4 = 7.70381505559019352791e-02;
export function asin(x) {
  const hx = hiw(x), ix = hx & 0x7fffffff;
  let t = 0, w, p, q, c, r, s;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | low(x)) === 0) return x * PIO2_HI + x * PIO2_LO;
    return (x - x) / (x - x);
  } else if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) return x;
    t = x * x;
    p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
    q = 1 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
    w = p / q;
    return x + x * w;
  }
  w = 1 - Math.abs(x); t = w * 0.5;
  p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5)))));
  q = 1 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
  s = Math.sqrt(t);
  if (ix >= 0x3FEF3333) { w = p / q; t = PIO2_HI - (2.0 * (s + s * w) - PIO2_LO); }
  else {
    w = withLow0(s); c = (t - w * w) / (s + w); r = p / q;
    p = 2.0 * s * r - (PIO2_LO - 2.0 * c); q = PIO4_HI - 2.0 * w; t = PIO4_HI - (p - q);
  }
  return hx > 0 ? t : -t;
}
export function acos(x) {
  const hx = hiw(x), ix = hx & 0x7fffffff;
  let z, p, q, r, w, s, c, df;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | low(x)) === 0) return hx > 0 ? 0.0 : PI + 2.0 * PIO2_LO;
    return (x - x) / (x - x);
  }
  if (ix < 0x3fe00000) {
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    z = x * x;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  } else if (hx < 0) {
    z = (1 + x) * 0.5;
    p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
    q = 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    s = Math.sqrt(z); r = p / q; w = r * s - PIO2_LO;
    return PI - 2.0 * (s + w);
  }
  z = (1 - x) * 0.5; s = Math.sqrt(z); df = withLow0(s); c = (z - df * df) / (s + df);
  p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5)))));
  q = 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
  r = p / q; w = r * s + c;
  return 2.0 * (df + w);
}

// ---------------------------------------------------------------- 指數、對數
const O_THRESHOLD = 7.09782712893383973096e+02, U_THRESHOLD = -7.45133219101941108420e+02, TWOM1000 = 9.33263618503218878990e-302;
const LN2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01], LN2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const INVLN2 = 1.44269504088896338700e+00, P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
  P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08, HALF = [0.5, -0.5];
export function exp(x) {
  if (x === 1) return 2.718281828459045;   // 與 V8 相同：exp(1) 回傳正確捨入的 e
  let hx = hiw(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  let hi = 0, lo = 0, k = 0;
  if (hx >= 0x40862E42) {
    if (hx >= 0x7ff00000) { if (((hx & 0xfffff) | low(x)) !== 0) return x + x; return xsb === 0 ? x : 0.0; }
    if (x > O_THRESHOLD) return Infinity;
    if (x < U_THRESHOLD) return 0;
  }
  if (hx > 0x3fd62e42) {
    if (hx < 0x3FF0A2B2) { hi = x - LN2HI[xsb]; lo = LN2LO[xsb]; k = 1 - xsb - xsb; }
    else { k = (INVLN2 * x + HALF[xsb]) | 0; const t = k; hi = x - t * LN2HI[0]; lo = t * LN2LO[0]; }
    x = hi - lo;
  } else if (hx < 0x3e300000) return 1 + x;
  else k = 0;
  const t = x * x, c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2.0) - x);
  const y = 1 - ((lo - (x * c) / (2.0 - c)) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * 8.98846567431158e307;
    return setHigh(y, hiw(y) + (k << 20));
  }
  return setHigh(y, hiw(y) + ((k + 1000) << 20)) * TWOM1000;
}
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, TWO54 = 1.80143985094819840000e+16;
const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01,
  Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
export function log(x) {
  let hx = hiw(x);
  const lx = low(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= TWO54; hx = hiw(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = setHigh(x, hx | (i ^ 0x3ff00000));
  k += i >> 20;
  const f = x - 1.0;
  let dk;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) { if (k === 0) return 0; dk = k; return dk * LN2_HI + dk * LN2_LO; }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    dk = k; return dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2.0 + f);
  dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z, j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6)), t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

// ---------------------------------------------------------------- 次方
// 整數次方用二進位乘法（決定性）；其餘用 exp(y·log x)（相對誤差約 |y·ln x|·2^-53，本模組的用途都 < 1e-14）
export function pow(x, y) {
  if (y === (y | 0) && y >= -64 && y <= 64) {
    let n = y < 0 ? -y : y, r = 1, b = x;
    while (n) { if (n & 1) r *= b; b *= b; n >>= 1; }
    return y < 0 ? 1 / r : r;
  }
  if (x > 0) return exp(y * log(x));
  if (x === 0) return y > 0 ? 0 : Infinity;
  return NaN;
}
export const sqrt = Math.sqrt;   // IEEE-754 要求正確捨入，各引擎一致
export const hypot3 = (x, y, z = 0) => Math.sqrt(x * x + y * y + z * z);   // Math.hypot 的演算法各引擎不同，不用
export const PI_ = Math.PI;
