// 本站製程檢查（三個方案各跑一次）：
//   1. 焊道跟隨：每道製程走焊道時，工具 TCP 與焊道上「目前進度點」的距離 ≤ 2 mm（環縫轉桶／J1 繞圈、縱縫載具移動的同步是否正確）
//   2. 桶內間隙：沿動畫取樣，手臂、載具、工具的每個頂點不得進入桶壁（襯裡表面到 SUS 外表面）；工具在 TCP 60 mm 內的接觸部位除外
//   3. 兆赫波 NG 處：補焊、複檢在全線檢測之後，TCP 跟著缺陷段
//   4. 製程順序：每道焊道的相機定位 → 開槽 → 焊條 → 削平（刮平）→ 焊帶 → 檢測依序完成，結束時全部 = 1
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { seamPath, wallAt } from '../web/js/tank.js';
import { PROCESS, FIELD, THZ, cycleEstimate, seamLength } from '../web/js/spec.js';

const CIRC_START = Math.PI / 2;
const out = { ok: true, plans: {}, estimate: cycleEstimate() };
out.estimate = { metres: +out.estimate.metres.toFixed(2), hours: +(out.estimate.sum / 60).toFixed(2) };

// 每個方案跑預設排版，再跑一次極端排版（環縫在可調範圍兩端、兩道縱縫）
const EXTREME = { c1: 0, c2: 99999, nl: 2 };                     // 夾到各方案可調範圍的兩端
for (const [plan, opts] of ['roll', 'turntable', 'cobot'].flatMap(k => [[k, {}], [k + '·極端排版', EXTREME]])) {
  const scene = new THREE.Scene(), p = createProject({ scene, plan: plan.split('·')[0], ...opts }), failures = [], SEAMS = p.seams;
  const tl = p.timeline, v = new THREE.Vector3(), v2 = new THREE.Vector3(), tcp = new THREE.Vector3();

  // ---- 1. 焊道跟隨
  let follow = 0;
  for (const S of SEAMS) {
    const at = seamPath(S, CIRC_START);
    for (const st of tl.tracks['seam-' + S.id].steps.filter(s => s.dur > 0)) {
      for (const u of [.05, .25, .5, .75, .95]) {
        p.apply(st.start + u * st.dur); scene.updateMatrixWorld(true);
        const want = p.tank.spin.localToWorld(at(u).p.clone()), got = p.arm.tcp.getWorldPosition(tcp), e = got.distanceTo(want);
        follow = Math.max(follow, e);
        if (e > 2) { failures.push(`焊道跟隨：${S.name} t=${(st.start + u * st.dur).toFixed(2)} 偏差 ${e.toFixed(1)} mm`); break; }
      }
    }
  }

  // 補焊與複檢：只走缺陷前後 THZ.repairHalf mm，TCP 也要跟著焊道
  {
    const DS = SEAMS.find(s => s.id === THZ.defect.seam), at = seamPath(DS, CIRC_START), half = THZ.repairHalf / seamLength(DS);
    for (const st of tl.tracks.repair.steps.filter(s => s.dur > 0)) for (const k of [.1, .5, .9]) {
      p.apply(st.start + k * st.dur); scene.updateMatrixWorld(true);
      const u = THZ.defect.u - half + 2 * half * k, e = p.arm.tcp.getWorldPosition(tcp).distanceTo(p.tank.spin.localToWorld(at(u).p.clone()));
      follow = Math.max(follow, e); if (e > 2) { failures.push(`補焊／複檢跟隨偏差 ${e.toFixed(1)} mm`); break; }
    }
    const thzEnd = Math.max(...SEAMS.map(S => tl.tracks['seam-' + S.id].steps.filter(x => x.end.i === 1 && x.dur > 0).map(x => x.start + x.dur)).flat());
    const rs = tl.tracks.repair.steps.filter(x => x.dur > 0);
    if (rs.length !== 2 || rs[0].start < thzEnd || rs[1].start < rs[0].start + rs[0].dur) failures.push('補焊應在兆赫波全線檢測之後、複檢在補焊之後');
    const fin = tl.sample(p.total).repair; if (fin.r < 1 || fin.c < 1) failures.push('補焊或複檢未完成');
  }

  // ---- 2. 桶內間隙（桶座標：半徑 r、高度 y 對照 wallAt）
  const movers = [p.arm.root, ...Object.values(p.tools).map(t => t.root)];
  scene.traverse(o => { if (['boom', 'gantry', 'robot'].includes(o.userData.module) && o.parent === scene) movers.push(o); });
  const meshes = []; for (const m of movers) m.traverse(c => { if (!c.isMesh) return; for (let q = c; q; q = q.parent) if (q.userData.fx) return; if (!meshes.includes(c)) meshes.push(c); });
  const isTool = new Set(); for (const t of Object.values(p.tools)) t.root.traverse(c => isTool.add(c));
  let minGap = Infinity, worst = null, hits = 0;
  const dt = .1, inv = new THREE.Matrix4();
  for (let t = 0; t <= p.total; t += dt) {
    p.apply(t); scene.updateMatrixWorld(true); inv.copy(p.tank.frame.matrixWorld).invert(); p.arm.tcp.getWorldPosition(tcp);
    for (const m of meshes) {
      const pos = m.geometry.attributes.position, tool = isTool.has(m);
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (tool && v.distanceTo(tcp) < 60) continue;
        const l = v2.copy(v).applyMatrix4(inv), w = wallAt(l.y); if (!w) continue;
        const r = Math.hypot(l.x, l.z);
        if (r < w[0]) { const gap = w[0] - r; if (gap < minGap) { minGap = gap; worst = { t: +t.toFixed(1), mesh: m.name || m.parent?.name, y: Math.round(l.y) }; } }
        else if (r <= w[1] + 2) { hits++; if (hits <= 5) failures.push(`桶內間隙：t=${t.toFixed(1)} ${m.name || m.parent?.name || m.geometry.type} 進入桶壁（y=${Math.round(l.y)}、r=${Math.round(r)}，壁 ${Math.round(w[0])}～${Math.round(w[1])}）`); }
      }
    }
  }
  if (hits > 5) failures.push(`桶內間隙：另有 ${hits - 5} 個取樣點進入桶壁`);

  // ---- 3. 製程順序與完成
  const fin = tl.sample(p.total);
  for (const S of SEAMS) {
    const s = fin['seam-' + S.id];
    if (PROCESS.some(P => s[FIELD[P.key]] < 1)) failures.push(`製程未完成：${S.name}`);
    const starts = PROCESS.map(P => tl.tracks['seam-' + S.id].steps.find(x => x.end[FIELD[P.key]] === 1 && x.dur > 0)?.start ?? Infinity);
    if (starts.some((x, i) => i && x < starts[i - 1])) failures.push(`製程順序錯：${S.name}`);
  }
  const layout = p.layoutChecks().filter(r => !r.ok).map(r => `配置：${r.name} ${r.value}`);
  failures.push(...layout);

  out.plans[plan] = { ok: !failures.length, total: +p.total.toFixed(1), follow: +follow.toFixed(2), minGapInside: Number.isFinite(minGap) ? +minGap.toFixed(1) : null, tightest: worst, failures };
  if (failures.length) out.ok = false;
}

mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
