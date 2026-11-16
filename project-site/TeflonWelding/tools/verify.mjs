// 本站製程檢查（四個方案各跑一次）：
//   1. 焊道跟隨：工具在作業（fx）時，TCP 與焊道上「目前進度點」的距離 ≤ 2 mm（環縫轉桶／J1 繞圈、縱縫載具移動的同步；含 NG 後的續焊段與回程吸屑）
//   2. 桶內間隙：沿動畫取樣，手臂、載具、工具的每個頂點不得進入桶壁（襯裡表面到 SUS 外表面）；工具在 TCP 60 mm 內的接觸部位除外
//   3. 兆赫波 NG 處：人工補修、自動複檢在全線檢測之後，補修時手臂不在桶內，複檢時 TCP 跟著補修段
//   4. 製程順序：每道焊道的相機定位 → 開槽 → 焊條 → 削平（刮平）→ 焊帶 → 檢測依序完成，結束時全部 = 1（雙工位第 2 線接手前的工序由人員做，不排序）
//   5. 雙工位互鎖：同一支工具不會同時在兩線手上；工具架移動時沒有手臂在取放姿態
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { seamPath, wallAt } from '../web/js/tank.js';
import { PROCESS, FIELD, THZ, cycleEstimate, dualEstimate, seamLength } from '../web/js/spec.js';

const CIRC_START = Math.PI / 2;
const est = cycleEstimate(), dualEst = dualEstimate(undefined, { n: 20 });
const out = { ok: true, plans: {}, estimate: { metres: +est.metres.toFixed(2), hours: +(est.sum / 60).toFixed(2), dualHoursPerTank: +(dualEst.perTank / 60).toFixed(2) } };

// 每個方案跑預設排版，再跑一次極端排版（環縫在可調範圍兩端、兩道縱縫）
const EXTREME = { c1: 0, c2: 99999, nl: 2 };                     // 夾到各方案可調範圍的兩端
// 快速檢查只跑預設排版；tools/verify-extreme.mjs（完整檢查）跑極端排版
const EXTREME_ONLY = process.env.TW_VERIFY === 'extreme';
for (const [plan, opts] of ['roll', 'dual', 'turntable', 'cobot'].map(k => EXTREME_ONLY ? [k + '·極端排版', EXTREME] : [k, {}])) {
  const scene = new THREE.Scene(), p = createProject({ scene, plan: plan.split('·')[0], ...opts }), failures = [], SEAMS = p.seams;
  const tl = p.timeline, v = new THREE.Vector3(), v2 = new THREE.Vector3(), tcp = new THREE.Vector3();
  const FIELDS = [...Object.values(FIELD), 'v'];

  // ---- 1. 焊道跟隨（每一線）
  let follow = 0;
  for (const cell of p.cells) {
    const tool = tl.tracks[cell.pf + 'tool'], working = t => tool.sample(t).fx > .5;
    for (const S of SEAMS) {
      const at = seamPath(S, CIRC_START), tr = tl.tracks[cell.pf + 'seam-' + S.id];
      for (const st of tr.steps.filter(s => s.dur > 0)) {
        const f = FIELDS.find(k => st.end[k] !== st.initial[k]); if (!f) continue;
        for (const u of [.05, .25, .5, .75, .95]) {
          const t = st.start + u * st.dur; if (!working(t)) continue;
          p.apply(t); scene.updateMatrixWorld(true);
          const want = cell.tank.spin.localToWorld(at(tr.sample(t)[f]).p.clone()), e = cell.arm.tcp.getWorldPosition(tcp).distanceTo(want);
          follow = Math.max(follow, e);
          if (e > 2) { failures.push(`焊道跟隨：第 ${cell.k + 1} 線 ${S.name}（${f}）t=${t.toFixed(2)} 偏差 ${e.toFixed(1)} mm`); break; }
        }
      }
    }
  }

  // ---- 3. 兆赫波 NG：人工補修（手臂退出）→ 自動複檢只走缺陷前後 THZ.repairHalf mm，TCP 要跟著焊道
  {
    const cell = p.cells[0], rep = tl.tracks[cell.pf + 'repair'];
    const DS = SEAMS.find(s => s.id === THZ.defect.seam), at = seamPath(DS, CIRC_START), half = THZ.repairHalf / seamLength(DS);
    const rs = rep.steps.filter(x => x.dur > 0), chk = rs.find(s => s.end.c === 1), man = rs.find(s => s.end.r === 1);
    if (chk) for (const k of [.1, .5, .9]) {
      p.apply(chk.start + k * chk.dur); scene.updateMatrixWorld(true);
      const u = THZ.defect.u - half + 2 * half * k, e = cell.arm.tcp.getWorldPosition(tcp).distanceTo(cell.tank.spin.localToWorld(at(u).p.clone()));
      follow = Math.max(follow, e); if (e > 2) { failures.push(`複檢跟隨偏差 ${e.toFixed(1)} mm`); break; }
    }
    const thzEnd = Math.max(...SEAMS.map(S => tl.tracks[cell.pf + 'seam-' + S.id].steps.filter(x => x.end.i === 1 && x.dur > 0).map(x => x.start + x.dur)).flat());
    if (rs.length !== 2 || !man || !chk || man.start < thzEnd || chk.start < man.start + man.dur) failures.push('人工補修應在兆赫波全線檢測之後、複檢在補修之後');
    const fin = tl.sample(p.total)[cell.pf + 'repair']; if (fin.r < 1 || fin.c < 1) failures.push('補修或複檢未完成');
    if (man) for (const k of [.2, .5, .8]) { const c = tl.tracks[cell.pf + 'carrier'].sample(man.start + k * man.dur); if (c.s < cell.sOut - 1 && Math.abs(c.lat) < 1) { failures.push('人員補修時手臂仍在桶內'); break; } }
  }

  // ---- 2. 桶內間隙（桶座標：半徑 r、高度 y 對照 wallAt；每一線的桶都查）
  const movers = [...p.cells.map(c => c.arm.root), ...Object.values(p.tools).map(t => t.root)];
  scene.traverse(o => { if (['boom', 'gantry', 'robot'].includes(o.userData.module) && o.parent === scene) movers.push(o); });
  const meshes = []; for (const m of movers) m.traverse(c => { if (!c.isMesh) return; for (let q = c; q; q = q.parent) if (q.userData.fx) return; if (!meshes.includes(c)) meshes.push(c); });
  const isTool = new Set(); for (const t of Object.values(p.tools)) t.root.traverse(c => isTool.add(c));
  let minGap = Infinity, minNeckGap = Infinity, worst = null, hits = 0;
  const dt = .1, invs = p.cells.map(() => new THREE.Matrix4()), tcps = p.cells.map(() => new THREE.Vector3());
  for (let t = 0; t <= p.total; t += dt) {
    p.apply(t); scene.updateMatrixWorld(true);
    p.cells.forEach((c, i) => { invs[i].copy(c.tank.frame.matrixWorld).invert(); c.arm.tcp.getWorldPosition(tcps[i]); });
    for (const m of meshes) {
      const pos = m.geometry.attributes.position, tool = isTool.has(m);
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (tool && tcps.some(q => v.distanceTo(q) < 60)) continue;
        for (let ci = 0; ci < invs.length; ci++) {
          const l = v2.copy(v).applyMatrix4(invs[ci]), w = wallAt(l.y); if (!w) continue;
          const r = Math.hypot(l.x, l.z);
          if (r < w[0]) { const gap = w[0] - r; if (l.y > 1290) minNeckGap = Math.min(minNeckGap, gap); if (gap < minGap) { minGap = gap; worst = { t: +t.toFixed(1), ...(p.dual ? { line: ci + 1 } : {}), mesh: m.name || m.parent?.name, y: Math.round(l.y) }; } }
          else if (r <= w[1] + 2) { hits++; if (hits <= 5) failures.push(`桶內間隙：t=${t.toFixed(1)} 第 ${ci + 1} 線 ${m.name || m.parent?.name || m.geometry.type} 進入桶壁（y=${Math.round(l.y)}、r=${Math.round(r)}，壁 ${Math.round(w[0])}～${Math.round(w[1])}）`); }
        }
      }
    }
  }
  if (hits > 5) failures.push(`桶內間隙：另有 ${hits - 5} 個取樣點進入桶壁`);
  if (plan.startsWith('cobot') && minGap < 15) failures.push(`C 案間隙 ${minGap.toFixed(1)} mm 小於 15 mm`);

  // ---- 4. 製程順序與完成（每一線）
  const fin = tl.sample(p.total);
  for (const cell of p.cells) for (const S of SEAMS) {
    const s = fin[cell.pf + 'seam-' + S.id], tr = tl.tracks[cell.pf + 'seam-' + S.id];
    if (PROCESS.some(P => s[FIELD[P.key]] < 1)) failures.push(`製程未完成：第 ${cell.k + 1} 線 ${S.name}`);
    const starts = PROCESS.map(P => tr.steps.find(x => x.end[FIELD[P.key]] === 1 && x.dur > 0)?.start ?? Infinity).filter(Number.isFinite);
    if (starts.some((x, i) => i && x < starts[i - 1])) failures.push(`製程順序錯：第 ${cell.k + 1} 線 ${S.name}`);
  }

  // ---- 5. 雙工位互鎖
  if (p.dual) {
    for (let t = 0; t <= p.total; t += .1) {
      const held = p.cells.map(c => tl.tracks[c.pf + 'tool'].sample(t).held).filter(Boolean);
      if (new Set(held).size !== held.length) { failures.push(`互鎖：t=${t.toFixed(1)} 同一支工具在兩線`); break; }
    }
    for (const st of tl.tracks.shuttle.steps.filter(s => s.dur > 0)) for (const k of [.2, .5, .8]) {
      const t = st.start + k * st.dur;
      for (const c of p.cells) { const a = tl.tracks[c.pf + 'arm'].sample(t), r = c.poses.rack.pose; if (Math.abs(a.j2 - r.j2) < .5 && Math.abs(a.j3 - r.j3) < .5) failures.push(`互鎖：t=${t.toFixed(1)} 工具架移動時第 ${c.k + 1} 線在取放姿態`); }
    }
  }
  failures.push(...p.layoutChecks().filter(r => !r.ok).map(r => `配置：${r.name} ${r.value}`));

  out.plans[plan] = { ok: !failures.length, total: +p.total.toFixed(1), follow: +follow.toFixed(2), minGapInside: Number.isFinite(minGap) ? +minGap.toFixed(1) : null, minNeckGap: Number.isFinite(minNeckGap) ? +minNeckGap.toFixed(1) : null, seamLayout: { c1: p.layout.c1, c2: p.layout.c2, nl: p.layout.nl }, ...(p.dual ? { handoff: p.handoff } : {}), tightest: worst, failures };
  console.log(`${plan}: ${failures.length ? 'FAIL' : 'PASS'}，桶內 ${minGap.toFixed(1)} mm，人孔區 ${minNeckGap.toFixed(1)} mm`);
  if (failures.length) out.ok = false;
}

mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL(EXTREME_ONLY ? '../review/verification-extreme.json' : '../review/verification.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);
