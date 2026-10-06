// 光學 L2：打光幾何與近似模擬影像（評估平台 Q7，core 1.12.0）。純函式，瀏覽器與 Node 共用，不需要 three.js。
//   lighting(setup, derived)   在視野內的工件表面取樣：鏡面反射進不進鏡頭（明場／暗場）、漫射照度、相機看不到與光被擋住的地方、
//                              各種缺陷（刮傷、凹痕、髒污、缺件）和周圍的對比
//   simulateImage(setup, derived, { width })  灰階的近似影像（整個視野＋每個缺陷的原解析度特寫），含景深模糊、運動模糊、雜訊
// 這些都是幾何近似（不是光線追蹤）：用來比較打光方案，不能取代實際打樣。
// 座標：工件表面是 z = 0、中心在光軸上，相機在 (0, 0, WD) 往下看，x 是視野寬度方向（輸送方向），單位 mm。

const rad = d => d * Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const num = v => v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// 材質預設：kd 漫射、ks 鏡面、lobe 鏡面瓣的寬度（度）、transmit 背光時的透光率
export const MATERIALS = {
  鏡面金屬: { kd: 0.05, ks: 1, lobe: 1.5 },
  霧面金屬: { kd: 0.45, ks: 0.45, lobe: 10 },
  黑色塑膠: { kd: 0.06, ks: 0.25, lobe: 12 },
  白色塑膠: { kd: 0.85, ks: 0.12, lobe: 18 },
  透明: { kd: 0.03, ks: 0.08, lobe: 1, transmit: 0.9 },
  'PCB 綠漆': { kd: 0.22, ks: 0.35, lobe: 6 },
  銅箔: { kd: 0.35, ks: 0.75, lobe: 4 },
};
export const DEFECT_KINDS = ['刮傷', '凹痕', '髒污', '缺件'];
const FIELD_LABEL = { bright: '明場（平整表面的反光進鏡頭）', dark: '暗場（平整表面的反光不進鏡頭，凸顯刮傷與邊緣）', mixed: '明暗混合（視野內有的地方反光進鏡頭）', diffuse: '漫射（穹頂，抑制反光）', back: '背光（輪廓與透光）' };

// 光源的取樣點：{ p: 位置, A: 發光面積 mm²（面向下方） } 或 { dir: 入射方向（平行光）}；w 是功率權重（總和 1，算漫射照度用）。
// 穹頂的取樣點直接給 omega（從工件中心看的立體角）。鏡面反射的亮度看光源佔了鏡面瓣多少立體角（見 respond）。
export function lightSamples(light = {}, wd = 300) {
  const t = light.type, h = num(light.distance) ?? 50, size = num(light.size), off = num(light.offset), width = num(light.width), out = [];
  const add = (p, n, A) => out.push({ p, w: 1 / n, A });
  if (t === '同軸') return [{ dir: [0, 0, -1], w: 1 }];
  if (t === '穹頂') {
    const R = Math.max(size ? size / 2 : 0, h, 40), ring = [], de = 11, da = 22.5;
    for (let e = 12; e <= 78; e += de) for (let a = 0; a < 360; a += da) ring.push({ p: [R * Math.cos(rad(e)) * Math.cos(rad(a)), R * Math.cos(rad(e)) * Math.sin(rad(a)), R * Math.sin(rad(e))], omega: Math.cos(rad(e)) * rad(de) * rad(da) });
    ring.forEach(s => out.push({ ...s, w: 1 / ring.length })); return out;
  }
  if (t === '條形' || t === '線光') {
    const L = size ?? 100, o = off ?? (t === '線光' ? h * 0.6 : h), n = 16, wid = width ?? (t === '線光' ? 10 : 20);
    for (let i = 0; i < n; i++) add([-L / 2 + L * (i + 0.5) / n, o, h], n, L / n * wid); return out;
  }
  if (t === '點光') { const d = size ?? 10; return [{ p: [off ?? 0, 0, h], w: 1, A: Math.PI * d * d / 4 }]; }
  if (t === '平面') {
    const s = size ?? 100, n = 6;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) add([-s / 2 + s * (i + 0.5) / n, -s / 2 + s * (j + 0.5) / n, h], n * n, (s / n) ** 2); return out;
  }
  // 環形（預設）：發光環的寬度預設是半徑的 12%（至少 8 mm）
  const r = size ? size / 2 : 40, n = 32, wid = width ?? Math.max(8, r * 0.12);
  for (let i = 0; i < n; i++) add([r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n), h], n, 2 * Math.PI * r / n * wid);
  return out;
}

// 射線和方塊（工件座標，z 從 0 往上）是否相交；o 起點、dir 單位方向、maxT 最遠距離
function hitBox(o, dir, b, maxT) {
  const lo = [b.x - b.w / 2, b.y - b.d / 2, b.z ?? 0], hi = [b.x + b.w / 2, b.y + b.d / 2, (b.z ?? 0) + b.h];
  let t0 = 1e-6, t1 = maxT;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
    let a = (lo[k] - o[k]) / dir[k], c = (hi[k] - o[k]) / dir[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}
const blocked = (o, to, boxes) => { if (!boxes.length) return false; const d = sub(to, o), L = len(d), u = [d[0] / L, d[1] / L, d[2] / L]; return boxes.some(b => hitBox(o, u, b, L)); };

// 缺陷：預設在視野內排一列（每種一個），大小依最小缺陷 scene.defect
export function defectsOf(sc = {}, fov = [40, 30]) {
  if (Array.isArray(sc.defects) && sc.defects.length) return sc.defects.filter(x => DEFECT_KINDS.includes(x.kind));
  const s = num(sc.defect); if (!s) return [];
  const w = Math.min(fov[0], num(sc.target?.w) ?? fov[0]);
  return DEFECT_KINDS.map((kind, i) => ({ kind, x: -w * 0.3 + w * 0.2 * i, y: 0, size: kind === '刮傷' ? s : kind === '凹痕' ? s * 3 : s * 2, length: s * 12, angle: 60, tilt: kind === '凹痕' ? 10 : 20 }));
}
// 這一點有沒有缺陷：回傳 { n 法向量, a 漫射倍率, k 鏡面倍率, missing }
function surfaceAt(x, y, defects) {
  for (const f of defects) {
    const dx = x - (f.x ?? 0), dy = y - (f.y ?? 0), s = num(f.size) ?? 0.1;
    if (f.kind === '刮傷') {
      const a = rad(f.angle ?? 0), along = dx * Math.cos(a) + dy * Math.sin(a), across = -dx * Math.sin(a) + dy * Math.cos(a), L = num(f.length) ?? s * 12;
      if (Math.abs(along) <= L / 2 && Math.abs(across) <= s / 2) {
        const t = rad(f.tilt ?? 20) * (across >= 0 ? 1 : -1);      // V 形溝的兩面
        return { n: [-Math.sin(a) * Math.sin(t), Math.cos(a) * Math.sin(t), Math.cos(t)], a: 1, k: 1, rough: true };      // 刮傷的溝壁粗糙：漫射多、鏡面瓣寬（暗場看得到刮傷的原因）
      }
    } else if (f.kind === '凹痕') {
      const r = Math.hypot(dx, dy), R = s / 2;
      if (r <= R && r > 1e-9) { const t = rad(f.tilt ?? 10) * r / R; return { n: [-dx / r * Math.sin(t), -dy / r * Math.sin(t), Math.cos(t)], a: 1, k: 1 }; }
    } else if (f.kind === '髒污') {
      if (Math.hypot(dx, dy) <= s / 2) return { n: [0, 0, 1], dirt: true };      // 髒污：表面蓋上一層灰色霧面（亮的表面上變暗，鏡面在暗場下反而變亮）
    } else if (f.kind === '缺件') {
      if (Math.abs(dx) <= s / 2 && Math.abs(dy) <= s / 2) return { n: [0, 0, 1], a: 1, k: 1, missing: true };
    }
  }
  return null;
}

// 一個表面點的反應：S 鏡面進鏡頭的比例（只看幾何）、E 漫射照度（光源正上方、距離同安裝高度時是 1）、hidden 相機看不到、shadow 光被擋的比例
function respond(p, n, ctx, sigma = ctx.sigma) {
  const { lights, cam, boxes } = ctx;
  const toCam = cam.tele ? [0, 0, 1] : norm(sub(cam.pos, p));
  const hidden = blocked(p, cam.tele ? [p[0], p[1], cam.pos[2]] : cam.pos, boxes);
  const alpha = cam.tele ? cam.accept : Math.atan(cam.pupil / len(sub(cam.pos, p)));
  let S = 0, E = 0, shadow = 0;
  for (const L of lights) {
    let i, dist = 1;
    if (L.dir) i = L.dir;
    else { const d = sub(p, L.p); dist = len(d); i = [d[0] / dist, d[1] / dist, d[2] / dist]; if (blocked(p, L.p, boxes)) { shadow += L.w; continue; } }
    const cosIn = -dot(i, n);
    if (cosIn <= 0) continue;
    E += L.w * cosIn * (L.dir ? 1 : (ctx.href * ctx.href) / (dist * dist));
    const r = [i[0] + 2 * cosIn * n[0], i[1] + 2 * cosIn * n[1], i[2] + 2 * cosIn * n[2]];
    const delta = Math.acos(Math.max(-1, Math.min(1, dot(r, toCam))));
    if (L.dir) { S += delta <= alpha ? 1 : Math.exp(-((delta - alpha) ** 2) / (2 * sigma * sigma)); continue; }      // 平行光（同軸）充滿整個鏡面瓣
    if (ctx.dome) continue;                                                                                            // 穹頂的鏡面反射用下面的解析式
    // 面光源的一小塊：它的立體角 Ω 除以鏡面瓣（入射瞳的張角 α 加上材質的粗糙度 σ，再加上這一小塊自己的張角）的立體角
    const omega = L.A * Math.max(0.05, Math.abs(i[2])) / (dist * dist), beta2 = alpha * alpha + sigma * sigma + omega / Math.PI;
    S += omega / (2 * Math.PI * beta2) * Math.exp(-(delta * delta) / (2 * beta2));
  }
  if (ctx.dome) S = domeSpec(p, n, toCam, Math.sqrt(alpha * alpha + sigma * sigma), ctx.dome, boxes);
  return { S: Math.min(1, S), E, hidden, shadow };
}
// 穹頂：均勻的半球發光面，頂上有相機孔、底部開口到 rim 仰角。相機看到的是「視線對表面法向量鏡射後的方向」上的穹頂，
// 鏡面瓣（寬 β）落在發光面上的比例 = 高於底緣的比例 × 不在相機孔裡的比例（常態分布近似）
const Phi = x => 0.5 * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
function domeSpec(p, n, toCam, beta, dome) {
  const c = dot(n, toCam), d = [2 * c * n[0] - toCam[0], 2 * c * n[1] - toCam[1], 2 * c * n[2] - toCam[2]];
  if (d[2] <= 0) return 0;
  const elev = Math.asin(Math.min(1, d[2])), toHole = norm(sub([0, 0, dome.R], p)), holeR = Math.atan(dome.hole / 2 / Math.max(1, len(sub([0, 0, dome.R], p))));
  const dh = Math.acos(Math.max(-1, Math.min(1, dot(d, toHole))));
  return Phi((elev - dome.rim) / beta) * Phi((dh - holeR) / beta);
}

function context(setup, derived, material) {
  const lens = setup.lens || {}, light = setup.light || {}, sc = setup.scene || {}, wd = derived.wd || num(sc.wd) || 300;
  const N = num(lens.fNumber) ?? num(lens.fMin) ?? 4, f = num(lens.focal) ?? 25, m = derived.magnification || 0.1;
  const M = MATERIALS[material] || MATERIALS['霧面金屬'];
  return {
    lights: lightSamples(light, wd), boxes: (sc.obstacles || []).filter(b => num(b.w) && num(b.d) && num(b.h)), href: num(light.distance) ?? 50,
    cam: { pos: [0, 0, wd], pupil: f / N / 2, tele: !!derived.telecentric, accept: Math.atan(m / (2 * N)) },
    sigma: rad(M.lobe), M, back: light.type === '背光',
    // 穹頂：半徑、相機孔直徑（預設 40 mm，至少要讓鏡頭看得出去）、底部開口的仰角（預設 8°）
    dome: light.type === '穹頂' ? { R: Math.max(num(light.size) ? num(light.size) / 2 : 0, num(light.distance) ?? 50, 40), hole: num(light.hole) ?? 40, rim: rad(8) } : null,
  };
}
// 一點的亮度（0～1 左右）：工件範圍外與缺件處用背景材質
function intensity(x, y, ctx, ctxBg, defects, inTarget) {
  const def = inTarget ? surfaceAt(x, y, defects) : null, onPart = inTarget && !def?.missing;
  if (ctx.back) return onPart ? (ctx.M.transmit ?? 0) * (def?.a ?? 1) : 1;
  const c = onPart ? ctx : ctxBg, n = def && !def.missing ? def.n : [0, 0, 1];
  if (def?.dirt) { const r = respond([x, y, 0], n, c, rad(30)); return r.hidden ? 0.08 : 0.2 * r.E + 0.05 * r.S; }
  const rough = def?.rough, r = respond([x, y, 0], n, c, rough ? Math.max(c.sigma, rad(25)) : c.sigma);
  if (r.hidden) return 0.08;
  return (rough ? Math.max(c.M.kd, 0.35) : c.M.kd) * (def?.a ?? 1) * r.E + c.M.ks * (rough ? 0.5 : def?.k ?? 1) * r.S;
}

// 打光分析：視野內 nx × ny 的取樣（平整表面），加上缺陷的對比
export function lighting(setup, derived, { nx = 48 } = {}) {
  const sc = setup.scene || {}, material = sc.material || '霧面金屬', fov = derived.fov && derived.fov[1] ? derived.fov : derived.fov ? [derived.fov[0], derived.fov[0] * 0.05] : null;
  if (!fov) return null;
  const ctx = context(setup, derived, material), ctxBg = context(setup, derived, sc.background || '黑色塑膠');
  const ny = Math.max(2, Math.round(nx * fov[1] / fov[0])), S = new Float32Array(nx * ny), E = new Float32Array(nx * ny), H = new Uint8Array(nx * ny), Sh = new Float32Array(nx * ny);
  let bright = 0, hidden = 0, shadow = 0, eMin = Infinity, eMax = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) / nx * fov[0] - fov[0] / 2, y = (j + 0.5) / ny * fov[1] - fov[1] / 2, k = j * nx + i;
    const r = ctx.back ? { S: 0, E: 1, hidden: false, shadow: 0 } : respond([x, y, 0], [0, 0, 1], ctx);
    S[k] = r.S; E[k] = r.E; H[k] = r.hidden ? 1 : 0; Sh[k] = r.shadow;
    if (r.S >= 0.5) bright++; if (r.hidden) hidden++; if (r.shadow > 0.25) shadow++;
    if (!r.hidden) { eMin = Math.min(eMin, r.E + r.S); eMax = Math.max(eMax, r.E + r.S); }
  }
  const n = nx * ny, ratio = bright / n, t = setup.light?.type;
  const field = t === '背光' ? 'back' : t === '穹頂' ? 'diffuse' : ratio >= 0.8 ? 'bright' : ratio <= 0.2 ? 'dark' : 'mixed';
  // 缺陷：缺陷內與周圍的平均亮度比較
  const defects = defectsOf(sc, fov), tw = num(sc.target?.w) ?? fov[0], th = num(sc.target?.h) ?? fov[1];
  const inT = (x, y) => Math.abs(x) <= tw / 2 && Math.abs(y) <= th / 2;
  const I = (x, y, list) => intensity(x, y, ctx, ctxBg, list, inT(x, y));
  const res = defects.map(f => {
    const s = num(f.size) ?? 0.1, L = f.kind === '刮傷' ? (num(f.length) ?? s * 12) : s, a = rad(f.angle ?? 0), inside = [], around = [];
    for (let q = 0; q < 25; q++) {
      const u = (q % 5) / 4 - 0.5, v = Math.floor(q / 5) / 4 - 0.5;
      const px = f.kind === '刮傷' ? (f.x ?? 0) + u * L * 0.8 * Math.cos(a) - v * s * 0.9 * Math.sin(a) : (f.x ?? 0) + u * s * 0.9;
      const py = f.kind === '刮傷' ? (f.y ?? 0) + u * L * 0.8 * Math.sin(a) + v * s * 0.9 * Math.cos(a) : (f.y ?? 0) + v * s * 0.9;
      inside.push(I(px, py, [f])); around.push(I(px, py, []));
    }
    const di = inside.reduce((x, y) => x + y, 0) / inside.length, bg = around.reduce((x, y) => x + y, 0) / around.length;
    const contrast = Math.abs(di - bg) / Math.max(di, bg, 0.02), px = derived.mmPerPx ? s / derived.mmPerPx : null;
    return { kind: f.kind, x: f.x, y: f.y, size: s, contrast, polarity: di > bg ? '亮' : '暗', px, signal: di, background: bg };
  });
  return { field, label: FIELD_LABEL[field], brightRatio: ratio, hiddenRatio: hidden / n, shadowRatio: shadow / n, uniformity: eMax > 0 ? eMin / eMax : 0,
    map: { nx, ny, w: fov[0], h: fov[1], spec: S, irr: E, hidden: H, shadow: Sh }, defects: res, material };
}

// 決定性的亂數（雜訊用，同一個方案每次的影像都一樣）
function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function boxBlur(img, w, h, rx, ry) {
  const tmp = new Float32Array(img.length), out = new Float32Array(img.length);
  const pass = (src, dst, r, horiz) => { if (r < 0.5) { dst.set(src); return; } const R = Math.round(r);
    for (let j = 0; j < (horiz ? h : w); j++) for (let i = 0; i < (horiz ? w : h); i++) { let s = 0, c = 0;
      for (let k = -R; k <= R; k++) { const q = i + k; if (q < 0 || q >= (horiz ? w : h)) continue; s += src[horiz ? j * w + q : q * w + j]; c++; }
      dst[horiz ? j * w + i : i * w + j] = s / c; } };
  pass(img, tmp, rx, true); pass(tmp, out, ry, false); return out;
}

// 近似影像：full 是整個視野（寬 width 像素，每格取中心一點），crops 是每個缺陷周圍的原解析度特寫（64 × 64 相機像素）。
// 景深：工件高低差超過景深時依超出的比例模糊；運動模糊：沿 x 方向；自動增益讓亮處約 85%；加 1% 的雜訊。
export function simulateImage(setup, derived, { width = 480, crop = 64 } = {}) {
  const sc = setup.scene || {}, fov = derived.fov && derived.fov[1] ? derived.fov : null;
  if (!fov || !derived.mmPerPx) return null;
  const ctx = context(setup, derived, sc.material || '霧面金屬'), ctxBg = context(setup, derived, sc.background || '黑色塑膠');
  const defects = defectsOf(sc, fov), tw = num(sc.target?.w) ?? fov[0], th = num(sc.target?.h) ?? fov[1];
  const inT = (x, y) => Math.abs(x) <= tw / 2 && Math.abs(y) <= th / 2;
  const hPx = derived.sensor?.hPx || Math.round(fov[0] / derived.mmPerPx);
  const excess = derived.dof && num(sc.target?.heightRange) > derived.dof ? num(sc.target.heightRange) / derived.dof : 0;
  const dofPx = excess ? (num(sc.cocPx) ?? 2) * excess / 2 : 0, blurPx = derived.blurPx || 0;
  const render = (x0, y0, w, h, step, ss) => {
    const img = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0;
      for (let a = 0; a < ss; a++) for (let b = 0; b < ss; b++) { const x = x0 + (i + (a + 0.5) / ss) * step, y = y0 + (j + (b + 0.5) / ss) * step; s += intensity(x, y, ctx, ctxBg, defects, inT(x, y)); }
      img[j * w + i] = s / (ss * ss);
    }
    return img;
  };
  const finish = (img, w, h, scale, seed) => {
    const blurred = boxBlur(img, w, h, Math.max(dofPx, blurPx / 2) / scale, dofPx / scale);
    const sorted = Float32Array.from(blurred).sort(), p99 = sorted[Math.floor(sorted.length * 0.99)] || 1, gain = Math.min(8, 0.85 / Math.max(p99, 1e-3)), r = rng(seed);
    const data = new Uint8ClampedArray(w * h);
    for (let k = 0; k < w * h; k++) { const g = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); data[k] = Math.round(clamp01(blurred[k] * gain + g * 0.01) * 255); }
    return data;
  };
  const W = Math.min(width, hPx), k = hPx / W, step = derived.mmPerPx * k, H = Math.max(1, Math.round(fov[1] / step));
  const full = { width: W, height: H, mmPerPx: step, data: finish(render(-fov[0] / 2, -fov[1] / 2, W, H, step, 1), W, H, k, 1) };
  const crops = defects.map((f, i) => {
    const half = crop / 2 * derived.mmPerPx, img = render((f.x ?? 0) - half, (f.y ?? 0) - half, crop, crop, derived.mmPerPx, 1);
    return { kind: f.kind, width: crop, height: crop, mmPerPx: derived.mmPerPx, data: finish(img, crop, crop, 1, 7 + i) };
  });
  return { full, crops, note: '近似預覽：幾何打光模型，不是實際成像' };
}
