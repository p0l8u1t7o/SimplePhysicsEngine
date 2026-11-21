// 鏡面反光分析（高反光加工面，2026-11-21）：檢測點看向相機的方向 v，對面法向 n 鏡射得到「光要從哪裡來，相機才看得到反光」L = 2(n·v)n − v。
// L 方向在 ±SPREAD 內打到任一發光體 → 這一點在這一張是「鏡面反光」（亮到飽和；同軸設計時是刻意的亮場）。
// 每台相機每個面統計：每張影像中反光面積的比例（平均）。≥ 90%：均勻亮場；≤ 5%：暗場；介於中間：局部反光（亮斑、亮線，最難判）。
// 反射鏡相機以鏡中的虛像相機計算（平面鏡下反射幾何完全等價）。純數學，tools/plan.mjs 與網頁共用。
import { bodyData, faceTriangles } from './body.js';
import { CAMERAS, derive, rotZ, frameAngles, lightPoints, rad } from './optics-plan.js';

export const SPREAD = 4;             // 加工面的鏡面反射散開角（°，示意，打樣時量測）
export const CLASS = { bright: .9, dark: .05 };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(...a);
const nrm = a => { const l = len(a); return a.map(x => x / l); };
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(nrm(a), nrm(b))))) * 180 / Math.PI;

// 發光體：每台相機的光源換成可做角度測試的形狀（第 0 張、工件座標）
export function emitters(cam, dv = derive(cam)) {
  const L = cam.light, out = [];
  if (L.kind === 'coaxial') out.push({ type: 'cone', c: dv.pos, r: L.aperture ?? 25, axis: dv.fwd });   // 同軸：從相機方向來、出光口半徑內
  if (L.kind === 'lensRing' || L.kind === 'psSide') out.push({ type: 'annulus', c: dv.pos, r0: L.r - 6, r1: L.r + 6 });
  if (L.kind === 'ring') out.push({ type: 'ring', c: [L.center[0], L.center[1], L.at], R: L.r, w: 9 });
  if (L.kind === 'bar' || L.kind === 'psSide' || L.kind === 'probeBar') {
    const pts = lightPoints(cam, dv), groups = L.kind === 'psSide' ? [pts.slice(0, 3), pts.slice(3, 6)] : [pts.slice(0, 5)];
    for (const g of groups) out.push({ type: 'segment', a: g[0], b: g[g.length - 1], w: L.kind === 'probeBar' ? 5 : 13 });   // w：發光面半寬
  }
  return out;
}

// p 沿單位向量 d 看出去，是否在 spread 內打到發光體 e（第 φ 張時發光體繞 Z 轉 −φ）
function hits(e, p, d, phi, spread) {
  const tol = Math.tan(rad(spread));
  if (e.type === 'cone' || e.type === 'annulus') {
    const c = rotZ(e.c, phi), toC = sub(c, p), dist = len(toC), a = angle(d, toC);
    if (e.type === 'cone') return a <= Math.atan(e.r / dist) * 180 / Math.PI + spread;
    const a0 = Math.atan(e.r0 / dist) * 180 / Math.PI - spread, a1 = Math.atan(e.r1 / dist) * 180 / Math.PI + spread;
    return a >= a0 && a <= a1;
  }
  if (e.type === 'ring') {
    const c = rotZ(e.c, phi);
    if (Math.abs(d[2]) < 1e-6) return false;
    const t = (c[2] - p[2]) / d[2]; if (t <= 0) return false;
    const q = [p[0] + d[0] * t - c[0], p[1] + d[1] * t - c[1]], r = Math.hypot(...q);
    return Math.abs(r - e.R) <= e.w + tol * t;
  }
  if (e.type === 'segment') {
    // 射線與線段的最近距離
    const a = rotZ(e.a, phi), b = rotZ(e.b, phi), u = sub(b, a), w0 = sub(p, a);
    const A = dot(d, d), B = dot(d, u), C = dot(u, u), D = dot(d, w0), E = dot(u, w0), den = A * C - B * B;
    let sc = den > 1e-9 ? (B * E - C * D) / den : 0, tc = den > 1e-9 ? (A * E - B * D) / den : 0;
    tc = Math.max(0, Math.min(1, tc)); sc = Math.max(0, (B * tc - D) / A);
    const q = sub([p[0] + d[0] * sc, p[1] + d[1] * sc, p[2] + d[2] * sc], [a[0] + u[0] * tc, a[1] + u[1] * tc, a[2] + u[2] * tc]);
    return sc > 0 && len(q) <= e.w + tol * sc;
  }
  return false;
}

// 每台相機、每個面：反光比例（每張影像中反光面積 ÷ 看得到的面積，取各張平均與最大）
export function specularReport({ cameras = CAMERAS, spread = SPREAD, seen = null } = {}) {
  const d = bodyData(), ft = faceTriangles(), out = {};
  for (const cam of cameras) {
    const dv = derive(cam), E = emitters(cam, dv), angles = frameAngles(cam), res = {};
    for (const fno of cam.faces) {
      let sum = 0, max = 0, cnt = 0;
      angles.forEach(phi => {
        const C = rotZ(dv.pos, phi), fwd = rotZ(dv.fwd, phi), right = rotZ(dv.right, phi), up = rotZ(dv.up, phi);
        const tanW = dv.fovW / 2 / dv.wd, tanH = dv.fovH / 2 / dv.wd;
        let a = 0, aSpec = 0;
        for (const t of ft[fno].tris) {
          const p = [d.cen[t * 3], d.cen[t * 3 + 1], d.cen[t * 3 + 2]], n = [d.nor[t * 3], d.nor[t * 3 + 1], d.nor[t * 3 + 2]];
          const rel = sub(p, C), z = dot(rel, fwd); if (z <= 0) continue;
          if (Math.abs(dot(rel, right) / z) > tanW || Math.abs(dot(rel, up) / z) > tanH) continue;
          const v = nrm(sub(C, p)), cv = dot(n, v); if (cv < .34) continue;            // 視角 > 70° 不算
          const Ld = nrm(n.map((x, i) => 2 * cv * x - v[i]));
          a += d.area[t];
          if (E.some(e => hits(e, p, Ld, phi, spread))) aSpec += d.area[t];
        }
        if (a > 0) { const f = aSpec / a; sum += f; max = Math.max(max, f); cnt++; }
      });
      const mean = cnt ? sum / cnt : 0;
      res[fno] = { mean, max, kind: mean >= CLASS.bright ? '均勻亮場' : max <= CLASS.dark ? '暗場' : '局部反光' };
    }
    out[cam.id] = res;
  }
  void seen;
  return out;
}

// 逐三角形：在任一張影像中是鏡面反光的三角形（文件的反光對照圖用）
export function glareTriangles(cam, spread = SPREAD) {
  const d = bodyData(), ft = faceTriangles(), dv = derive(cam), E = emitters(cam, dv), out = new Set();
  for (const phi of frameAngles(cam)) {
    const C = rotZ(dv.pos, phi), fwd = rotZ(dv.fwd, phi), right = rotZ(dv.right, phi), up = rotZ(dv.up, phi);
    const tanW = dv.fovW / 2 / dv.wd, tanH = dv.fovH / 2 / dv.wd;
    for (const fno of cam.faces) for (const t of ft[fno].tris) {
      const p = [d.cen[t * 3], d.cen[t * 3 + 1], d.cen[t * 3 + 2]], n = [d.nor[t * 3], d.nor[t * 3 + 1], d.nor[t * 3 + 2]];
      const rel = sub(p, C), z = dot(rel, fwd); if (z <= 0 || Math.abs(dot(rel, right) / z) > tanW || Math.abs(dot(rel, up) / z) > tanH) continue;
      const v = nrm(sub(C, p)), cv = dot(n, v); if (cv < .34) continue;
      const Ld = nrm(n.map((x, i) => 2 * cv * x - v[i]));
      if (E.some(e => hits(e, p, Ld, phi, spread))) out.add(t);
    }
  }
  return out;
}
