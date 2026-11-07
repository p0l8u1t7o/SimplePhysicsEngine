// 測試與展示用：在產生好的案例裡寫一份「假的」postProcessing/（解析式流場，不是 CFD 結果），
// 格式照 OpenFOAM.com v2412 的輸出：surfaces/<t>/<面>.vtk（legacy、FIELD attributes）、sets/streamLines/<t>/track0.vtk（BINARY）、
// forces_*/0/force.dat（新格式；inverter 用舊的 forces.dat 格式）、probes/0/{p,U}、yPlus/0/yPlus.dat、residuals/0/solverInfo.dat。
// 流場：對數律風速剖面＋每座面板後方的尾流缺損＋面板前緣的上揚；面板壓力：迎風面正壓、背面負壓，後排遮蔽打折。
// 數字只為了讓匯入與顯示有東西可看，不代表任何物理結果。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { normalize } from '../../../core/cfd/case-gen.js';
import { boxCorners, v3 } from '../../../core/cfd/geometry.js';
import { writeVtk } from './vtk-writer.mjs';

const KAPPA = 0.41;

export function syntheticField(c) {
  const { Uref, Zref, z0 } = c.flow;
  const zg = c.zGround;
  const ustar = KAPPA * Uref / Math.log((Zref + z0) / z0);
  const plates = c.obstacles.filter(o => o.foamBox).map(o => {
    const C = boxCorners(o.foamBox);
    const mn = [0, 1, 2].map(i => Math.min(...C.map(p => p[i]))), mx = [0, 1, 2].map(i => Math.max(...C.map(p => p[i])));
    return { o, mn, mx, c: o.foamBox.center };
  }).sort((a, b) => a.c[0] - b.c[0]);
  let row = 0;
  for (const p of plates) p.shelter = p.o.type === 'plate' ? [1, 0.55, 0.45, 0.4][Math.min(row++, 3)] : 1;
  const cyl = c.obstacles.filter(o => o.foamCyl);
  const inside = q => plates.some(p => q.every((x, i) => x >= p.mn[i] && x <= p.mx[i])) || cyl.some(o => { const a = o.foamCyl; return q[2] >= a.p1[2] && q[2] <= a.p2[2] && Math.hypot(q[0] - a.p1[0], q[1] - a.p1[1]) <= a.radius; });
  const ablU = z => (z <= zg ? 0 : (ustar / KAPPA) * Math.log((z - zg + z0) / z0));
  function U(q) {
    if (inside(q)) return [0, 0, 0];
    const u0 = ablU(q[2]);
    let def = 0, w = 0, v = 0;
    for (const p of plates) {
      const hy = (p.mx[1] - p.mn[1]) / 2, hz = Math.max(0.3, (p.mx[2] - p.mn[2]) / 2), cy = (p.mn[1] + p.mx[1]) / 2, cz = (p.mn[2] + p.mx[2]) / 2;
      const dx = q[0] - p.mx[0], dxu = q[0] - p.mn[0];
      const span = Math.exp(-(((q[1] - cy) / (hy + 0.3)) ** 8));
      const vert = Math.exp(-(((q[2] - cz) / (1.4 * hz)) ** 2));
      const along = dx > 0 ? Math.exp(-dx / (8 * hz)) : dxu > 0 ? 1 : Math.exp(dxu / (0.6 * hz));
      def = Math.max(def, 0.75 * span * vert * along);
      // 前緣上揚、側邊外擴
      w += 0.35 * span * Math.exp(-((dxu / (1.2 * hz)) ** 2)) * Math.exp(-(((q[2] - p.mx[2]) / (1.5 * hz)) ** 2));
      v += 0.1 * Math.sign(q[1] - cy) * Math.exp(-(((Math.abs(q[1] - cy) - hy) / 0.6) ** 2)) * vert * (dx > -1 && dx < 4 * hz ? 1 : 0);
    }
    return [u0 * (1 - def), u0 * v, u0 * w];
  }
  // 運動壓力（p/ρ）：遠場 0，減速區正壓、尾流負壓
  function p(q) {
    const u = U(q), uinf = ablU(q[2]);
    const s = u[0] ** 2 + u[1] ** 2 + u[2] ** 2;
    return 0.5 * (uinf * uinf - s) * 0.45 - 0.12 * Math.max(0, uinf * uinf - s) * 0.5;
  }
  return { U, p, plates, ustar, inside };
}

// 平面格點（點資料），法向 normal 是 foam 座標軸之一
function gridSlice(c, sl, f, n1 = 120, n2 = 60) {
  const ax = sl.normal.map(Math.abs).indexOf(1);
  const [a, b] = [0, 1, 2].filter(i => i !== ax);
  const pts = [], polys = [], Uv = [], pv = [];
  for (let j = 0; j <= n2; j++) for (let i = 0; i <= n1; i++) {
    const q = sl.point.slice();
    q[a] = c.domain.min[a] + (c.domain.max[a] - c.domain.min[a]) * i / n1;
    q[b] = c.domain.min[b] + (c.domain.max[b] - c.domain.min[b]) * j / n2;
    pts.push(...q); Uv.push(...f.U(q)); pv.push(f.p(q));
  }
  for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) {
    const k = j * (n1 + 1) + i;
    // 每 7 格放一組三角形，測多邊形扇形化
    if ((i + j) % 7 === 0) polys.push([k, k + 1, k + n1 + 2], [k, k + n1 + 2, k + n1 + 1]);
    else polys.push([k, k + 1, k + n1 + 2, k + n1 + 1]);
  }
  return { points: pts, polys, pointData: { p: { components: 1, values: pv }, U: { components: 3, values: Uv } } };
}

// 方向盒的 6 個面細分成小四邊形，cell 資料：p（運動壓力）、U（0）
function patchSurface(c, plate, f, nu = 16, nv = 6) {
  const { center, axes, half } = plate.o.foamBox;
  const Uref = c.flow.Uref, q = 0.5 * Uref * Uref;
  const pts = [], polys = [], pv = [], Uv = [];
  const faces = [];
  for (const k of [0, 1, 2]) for (const s of [-1, 1]) faces.push({ k, s });
  for (const { k, s } of faces) {
    const [i1, i2] = [0, 1, 2].filter(i => i !== k);
    const n = axes[k].map(x => x * s);
    const m1 = k === 1 ? nu : 2, m2 = k === 1 ? nv : 2;
    const base = pts.length / 3;
    for (let b = 0; b <= m2; b++) for (let a = 0; a <= m1; a++) {
      const ta = -1 + 2 * a / m1, tb = -1 + 2 * b / m2;
      const p = [0, 1, 2].map(x => center[x] + n[x] * half[k] + axes[i1][x] * ta * half[i1] + axes[i2][x] * tb * half[i2]);
      pts.push(...p);
    }
    for (let b = 0; b < m2; b++) for (let a = 0; a < m1; a++) {
      const kk = base + b * (m1 + 1) + a;
      // OpenFOAM 慣例：邊界面的法向朝流體外（也就是朝障礙物裡面）
      const quad = [kk, kk + 1, kk + m1 + 2, kk + m1 + 1];
      polys.push(v3.dot(v3.cross(axes[i1], axes[i2]), n) < 0 ? quad : quad.reverse());
      // 面上位置的 Cp：迎風（n·(-x) > 0）正壓，越靠前緣越大；背面負壓
      const facing = -n[0];
      const tb = -1 + 2 * (b + 0.5) / m2;
      const cp = facing > 0.05 ? (0.55 + 0.35 * (1 - tb) / 2) * facing : facing < -0.05 ? (-0.45 - 0.25 * (1 + tb) / 2) * -facing : -0.3;
      pv.push(cp * plate.shelter * q); Uv.push(0, 0, 0);
    }
  }
  return { points: pts, polys, cellData: { p: { components: 1, values: pv }, U: { components: 3, values: Uv } }, force: integrateForce(pts, polys, pv) };
}

function integrateForce(pts, polys, pv, rho = 1.225) {
  const F = [0, 0, 0];
  polys.forEach((poly, i) => {
    const P = poly.map(k => [pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]]);
    let A = [0, 0, 0];
    for (let j = 1; j + 1 < P.length; j++) A = v3.add(A, v3.scale(v3.cross(v3.sub(P[j], P[0]), v3.sub(P[j + 1], P[0])), 0.5));
    for (let k = 0; k < 3; k++) F[k] += pv[i] * rho * A[k]; // 面法向朝障礙物裡面：F = Σ p ρ Sf（和 OpenFOAM forces 相同）
  });
  return F;
}

function streamlines(c, f, nSteps = 160) {
  const s = c.sampling.streamSeeds;
  const pts = [], lines = [], Uv = [], pv = [];
  for (let k = 0; k < s.nPoints; k++) {
    let q = s.start.map((a, i) => a + (s.end[i] - a) * (k + 0.5) / s.nPoints);
    const line = [];
    for (let n = 0; n < nSteps; n++) {
      const u = f.U(q), sp = Math.hypot(...u);
      if (sp < 1e-3 || q[0] > c.domain.max[0]) break;
      line.push(pts.length / 3); pts.push(...q); Uv.push(...u); pv.push(f.p(q));
      const h = 0.35;
      const mid = q.map((x, i) => x + 0.5 * h * u[i] / sp);
      const um = f.U(mid), sm = Math.hypot(...um) || sp;
      q = q.map((x, i) => x + h * um[i] / sm);
    }
    if (line.length > 1) lines.push(line);
  }
  return { points: pts, lines, pointData: { U: { components: 3, values: Uv }, p: { components: 1, values: pv } } };
}

const fmtN = v => (Number.isInteger(v) ? String(v) : v.toExponential(6));

export function writeSyntheticResults(caseDir, input, { endTime = 800, binaryStreamlines = true } = {}) {
  const c = normalize(input);
  const f = syntheticField(c);
  const pp = join(caseDir, 'postProcessing');
  const put = (rel, data) => { const p = join(pp, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); };
  const T = String(endTime);
  put('SYNTHETIC.txt', '解析式假流場（test/synth-results.mjs），不是 CFD 結果。\n');

  for (const sl of c.sampling.slices) put(`surfaces/${T}/${sl.name}.vtk`, writeVtk({ title: sl.name, ...gridSlice(c, sl, f) }));
  const forces = {};
  for (const pl of f.plates.filter(p => p.o.report)) {
    const s = patchSurface(c, pl, f);
    forces[pl.o.name] = s.force;
    put(`surfaces/${T}/patch_${pl.o.name}.vtk`, writeVtk({ title: `patch_${pl.o.name}`, points: s.points, polys: s.polys, cellData: s.cellData }));
  }
  if (c.sampling.streamSeeds) put(`sets/streamLines/${T}/track0.vtk`, writeVtk({ title: 'streamLines', binary: binaryStreamlines, ...streamlines(c, f) }));

  // 力：收斂曲線 F(t) = F∞(1 - e^(-t/150)) ＋衰減振盪
  const times = []; for (let t = 10; t <= endTime; t += 10) times.push(t);
  const curve = (F, t) => F.map((x, k) => x * (1 - Math.exp(-t / 150)) * (1 + 0.04 * Math.sin(t / 23 + k) * Math.exp(-t / 300)));
  for (const [name, F] of Object.entries(forces)) {
    if (name === 'inverter') {
      const rows = times.map(t => { const v = curve(F, t); return `${t}\t((${v.map(fmtN).join(' ')}) (${v.map(x => fmtN(x * 0.02)).join(' ')}) (0 0 0)) ((0 0 0) (0 0 0) (0 0 0))`; });
      put(`forces_${name}/0/forces.dat`, `# Force\n# CofR   : (0 0 0)\n#\n# Time\tforces(pressure viscous porous) moment(pressure viscous porous)\n${rows.join('\n')}\n`);
    } else {
      const rows = times.map(t => { const v = curve(F, t), vis = v.map(x => x * 0.02); return [t, ...v.map((x, k) => x + vis[k]), ...v, ...vis].map(fmtN).join('\t'); });
      put(`forces_${name}/0/force.dat`, `# Force\n# CofR                : (0 0 0)\n#\n# Time\ttotal_x\ttotal_y\ttotal_z\tpressure_x\tpressure_y\tpressure_z\tviscous_x\tviscous_y\tviscous_z\n${rows.join('\n')}\n`);
    }
  }

  // 探針
  const probes = c.sampling.probes;
  const head = probes.map((p, i) => `# Probe ${i} (${p.point.join(' ')})`).join('\n') + `\n#     Probe ${probes.map((_, i) => i).join(' ')}\n#      Time\n`;
  const pRows = times.map(t => [t, ...probes.map(p => fmtN(f.p(p.point) * (1 - Math.exp(-t / 150))))].join(' '));
  const uRows = times.map(t => `${t} ${probes.map(p => `(${f.U(p.point).map(x => fmtN(x * (1 - 0.3 * Math.exp(-t / 150)))).join(' ')})`).join(' ')}`);
  put('probes/0/p', head + pRows.join('\n') + '\n');
  put('probes/0/U', head + uRows.join('\n') + '\n');

  // y+ 與殘差
  const yRows = [...c.obstacles.map(o => o.name), 'ground'].map((n, i) => `${endTime}\t${n}\t${(0.8 + i * 0.1).toFixed(3)}\t${(180 + 20 * i).toFixed(3)}\t${(45 + 5 * i).toFixed(3)}`);
  put('yPlus/0/yPlus.dat', `# y+ ()\n# Time\tpatch\tmin\tmax\taverage\n${yRows.join('\n')}\n`);
  const rRows = []; for (let t = 1; t <= endTime; t++) { const r = 1e-1 * Math.exp(-t / 90) + 2e-5; rRows.push(`${t}\tsmoothSolver\t${fmtN(r)}\t${fmtN(r / 10)}\t2\tsmoothSolver\t${fmtN(r * 0.8)}\t${fmtN(r / 12)}\t2\tGAMG\t${fmtN(r * 3)}\t${fmtN(r / 5)}\t6`); }
  put('residuals/0/solverInfo.dat', `# Solver information\n# Time\tU_solver\tUx_initial\tUx_final\tUx_iters\tk_solver\tk_initial\tk_final\tk_iters\tp_solver\tp_initial\tp_final\tp_iters\n${rRows.join('\n')}\n`);

  return { forces, config: c };
}
