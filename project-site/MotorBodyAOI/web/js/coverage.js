// 取像覆蓋檢查：每台相機、每張（旋轉角）對負責的檢測面逐三角形判斷
//   視野內（視錐）→ 視角 ≤ MAX_VIEW_ANGLE → 景深內 → 有效解析度 ≤ 0.1 mm/px → 視線不被工件或夾爪擋住 → 光源照得到（入射角、遮擋）
// 結果：各面的覆蓋率與看不到的原因、景深需求、解析度範圍、入射角範圍，以及每個三角形被哪幾張拍到（動畫的取像足跡）。
// 純數學，tools/plan.mjs 產生 coverage-data.js、tools/verify.mjs 重算比對。
import { bodyData, faceTriangles, FACES } from './body.js';
import { createRaycaster, boxTriangles } from './raycast.js';
import { specularReport } from './specular.js';
import { CAMERAS, MAX_VIEW_ANGLE, TARGET_MMPX, LAMBDA, derive, rotZ, frameAngles, lightPoints, jawBoxes, blurFor, dofOf, deg, mirrorHit } from './optics-plan.js';

const REASONS = ['視野外', '擦過角', '景深外', '解析度不足', '被遮擋'];

// 各站的遮擋物：工件三角形＋該站夾頭爪
function stationRaycaster(station) {
  const d = bodyData(), soup = new Float32Array(d.nt * 9);
  for (let t = 0; t < d.nt; t++) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) soup[t * 9 + k * 3 + a] = d.positions[d.index[t * 3 + k] * 3 + a];
  const extra = jawBoxes(station).flatMap(b => boxTriangles(b.center, b.ax, b.ay, b.az));
  const all = new Float32Array(soup.length + extra.length); all.set(soup); all.set(extra, soup.length);
  return createRaycaster(all);
}

export function computeCoverage({ cameras = CAMERAS } = {}) {
  const d = bodyData(), ft = faceTriangles(), rc = {}, cos = Math.cos(MAX_VIEW_ANGLE * Math.PI / 180);
  const out = { cameras: {}, faces: {} };
  for (const cam of cameras) {
    const dv = derive(cam), ray = rc[cam.station] ??= stationRaycaster(cam.station);
    const angles = frameAngles(cam), L0 = lightPoints(cam, dv);
    const tanW = dv.fovW / 2 / dv.wd, tanH = dv.fovH / 2 / dv.wd;
    const res = { id: cam.id, faces: {}, tris: [], masks: [] };
    for (const fno of cam.faces) {
      const tris = ft[fno].tris, stat = { area: ft[fno].area, seen: 0, lit: 0, multi: 0, lost: Object.fromEntries(REASONS.map(r => [r, 0])), zSpan: [1e9, -1e9], mmpx: [1e9, 0], inc: [1e9, 0], view: [1e9, 0] };
      for (const t of tris) {
        const p = [0, 1, 2].map(k => d.cen[t * 3 + k] + d.nor[t * 3 + k] * .02), n = [d.nor[t * 3], d.nor[t * 3 + 1], d.nor[t * 3 + 2]];
        let mask = 0, worst = 0, litAny = false;
        angles.forEach((phi, k) => {
          const C = rotZ(dv.pos, phi), fwd = rotZ(dv.fwd, phi), right = rotZ(dv.right, phi), up = rotZ(dv.up, phi);
          const v = C.map((c, i) => c - p[i]), dist = Math.hypot(...v), dir = v.map(x => x / dist);
          const rel = p.map((x, i) => x - C[i]), z = rel[0] * fwd[0] + rel[1] * fwd[1] + rel[2] * fwd[2];
          const x = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2], y = rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2];
          let fail = 0;
          if (z <= 0 || Math.abs(x / z) > tanW || Math.abs(y / z) > tanH) fail = 1;
          const ca = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2];
          if (!fail && ca < cos) fail = 2;
          if (!fail && Math.abs(z - dv.wd) > dv.dof / 2) fail = 3;
          const eff = dv.mmpx * z / dv.wd / Math.max(ca, 1e-3);
          if (!fail && eff > TARGET_MMPX) fail = 4;
          // 反射鏡相機：視線要先打到鏡面範圍內（否則看不到），遮擋只檢查「檢測點 → 鏡面」這一段（鏡面 → 相機經杯口，無遮擋物）
          let segLen = dist;
          if (!fail && cam.mirror) { const h = mirrorHit(cam.mirror, p, dir, phi); if (h == null) fail = 1; else segLen = h; }
          if (!fail && ray.blocked(p, dir, segLen, s => s === t)) fail = 5;
          if (fail) { worst = Math.max(worst, fail); return; }
          mask |= 1 << k;
          stat.zSpan[0] = Math.min(stat.zSpan[0], z); stat.zSpan[1] = Math.max(stat.zSpan[1], z);
          stat.mmpx[0] = Math.min(stat.mmpx[0], eff); stat.mmpx[1] = Math.max(stat.mmpx[1], eff);
          const va = Math.acos(Math.min(1, ca)) * 180 / Math.PI; stat.view[0] = Math.min(stat.view[0], va); stat.view[1] = Math.max(stat.view[1], va);
          // 光源：任一發光點在面的正面、入射角 < 88°、不被擋
          // 這一張照得到的發光點中，入射角最小的那個（多個光源時取最有利的）
          let best = Infinity;
          for (const L of L0) {
            const Lp = rotZ(L, phi), w = Lp.map((c, i) => c - p[i]), wl = Math.hypot(...w), wd = w.map(q => q / wl);
            const ci = wd[0] * n[0] + wd[1] * n[1] + wd[2] * n[2];
            if (ci < Math.cos(88 * Math.PI / 180)) continue;
            const inc = deg(Math.acos(Math.min(1, ci)));
            let lLen = wl;
            if (cam.mirror && !cam.light.direct) { const h = mirrorHit(cam.mirror, p, wd, phi); if (h == null) continue; lLen = h; }
            if (inc >= best || ray.blocked(p, wd, lLen, s => s === t)) continue;
            best = inc;
          }
          if (best < Infinity) { litAny = true; stat.inc[0] = Math.min(stat.inc[0], best); stat.inc[1] = Math.max(stat.inc[1], best); }
        });
        if (mask) { stat.seen += d.area[t]; if (mask & (mask - 1)) stat.multi += d.area[t]; if (litAny) stat.lit += d.area[t]; res.tris.push(t); res.masks.push(mask); }
        else stat.lost[REASONS[worst - 1]] += d.area[t];
      }
      stat.coverage = stat.seen / stat.area; stat.overlap = stat.seen ? stat.multi / stat.seen : 0; stat.litRatio = stat.seen ? stat.lit / stat.seen : 0;
      stat.depth = stat.zSpan[1] - stat.zSpan[0]; stat.bNeed = blurFor(Math.max(stat.depth, 0));
      res.faces[fno] = stat;
    }
    out.cameras[cam.id] = res;
  }
  // 每面合併（目前每面只由一台相機負責）
  for (const f of FACES) {
    const cams = cameras.filter(c => c.faces.includes(f.no));
    const best = cams.map(c => out.cameras[c.id].faces[f.no]).sort((a, b) => b.coverage - a.coverage)[0];
    out.faces[f.no] = { cameras: cams.map(c => c.id), coverage: best?.coverage ?? 0, litRatio: best?.litRatio ?? 0, area: ft[f.no].area };
  }
  return out;
}
export { REASONS };

// 12 面對照表的幾何核對（Z、半徑範圍對不上 0.3 mm 以上就列出）
export function checkFaceGeometry() {
  const d = bodyData(), ft = faceTriangles(), err = [];
  for (const f of FACES) {
    let z0 = 1e9, z1 = -1e9, r0 = 1e9, r1 = -1e9;
    for (const t of ft[f.no].tris) for (let k = 0; k < 3; k++) {
      const v = d.index[t * 3 + k] * 3, z = d.positions[v + 2], r = Math.hypot(d.positions[v], d.positions[v + 1]);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    if (Math.abs(z0 - f.z[0]) > .3 || Math.abs(z1 - f.z[1]) > .3 || Math.abs(r0 - f.r[0]) > .3 || Math.abs(r1 - f.r[1]) > .3)
      err.push(`面 ${f.no}：Z ${z0.toFixed(2)}~${z1.toFixed(2)}、r ${r0.toFixed(2)}~${r1.toFixed(2)} 與對照表不符`);
  }
  return err;
}

// 覆蓋計算＋整理成報告（數字四捨五入）；summary 是網頁與檢查用的精簡版
export function coverageReport() {
  const cov = computeCoverage(), ft = faceTriangles();
  // 高反光加工面：反光分類（散開 4° 為設計值、8° 檢查餘裕）
  const spec4 = specularReport({ spread: 4 }), spec8 = specularReport({ spread: 8 });
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 1e4) / 1e4, pct = v => Math.round(v * 1000) / 10;
  const cameras = CAMERAS.map(c => {
    const dv = derive(c), fs = Object.values(cov.cameras[c.id].faces);
    // 整台相機要涵蓋的深度（各面合併）→ 需要的模糊 b → 設計 b（不小於 2 px、不大於上限）→ 工作光圈與景深
    const span = Math.max(0, Math.max(...fs.map(s => s.zSpan[1])) - Math.min(...fs.map(s => s.zSpan[0])));
    const bNeed = blurFor(span), bDesign = Math.min(c.b, Math.max(bNeed * 1.3, 2 * dv.mmpx));
    const Nd = bDesign * dv.m / (2.44 * LAMBDA * (1 + dv.m));
    return {
      id: c.id, station: c.station, name: c.name, faces: c.faces, sensor: c.sensor, f: c.f, lens: c.lens, frames: c.frames, b: c.b,
      wd: r2(dv.wd), fov: [r2(dv.fovW), r2(dv.fovH)], mmpx: r4(dv.mmpx), pos: dv.pos.map(r2), light: c.light.type, lightNote: c.light.note,
      span: r2(span), bNeed: r3(bNeed), bDesign: r3(bDesign), Ndesign: Math.round(Nd * 10) / 10, dofDesign: r2(dofOf(bDesign)),
      perFace: Object.fromEntries(Object.entries(cov.cameras[c.id].faces).map(([f, s]) => [f, {
        area: r2(s.area), coverage: pct(s.coverage), overlap: pct(s.overlap), lit: pct(s.litRatio), depth: r2(s.depth),
        mmpx: s.seen ? [r4(s.mmpx[0]), r4(s.mmpx[1])] : null, view: s.seen ? [Math.round(s.view[0]), Math.round(s.view[1])] : null,
        inc: s.inc[1] ? [Math.round(s.inc[0]), Math.round(s.inc[1])] : null,
        lost: Object.fromEntries(Object.entries(s.lost).filter(([, a]) => a > .05).map(([k, a]) => [k, r2(a)])),
        glare: spec4[c.id][f].kind, glareMean: pct(spec4[c.id][f].mean), glare8: spec8[c.id][f].kind,
      }])),
    };
  });
  const faces = FACES.map(f => ({ no: f.no, name: f.name, group: f.group, station: f.station, cameras: cov.faces[f.no].cameras, area: r2(ft[f.no].area), coverage: pct(cov.faces[f.no].coverage), lit: pct(cov.faces[f.no].litRatio) }));
  const summary = {
    faces: Object.fromEntries(faces.map(f => [f.no, { coverage: f.coverage, lit: f.lit, area: f.area, cameras: f.cameras }])),
    cameras: Object.fromEntries(cameras.map(c => [c.id, { span: c.span, bNeed: c.bNeed, bDesign: c.bDesign, N: c.Ndesign, dof: c.dofDesign, mmpx: c.mmpx, wd: c.wd, fov: c.fov,
      perFace: Object.fromEntries(Object.entries(c.perFace).map(([f, s]) => [f, { coverage: s.coverage, overlap: s.overlap, mmpx: s.mmpx, view: s.view, inc: s.inc, glare: s.glare, glare8: s.glare8 }])) }])),
  };
  return { cov, faces, cameras, summary };
}
