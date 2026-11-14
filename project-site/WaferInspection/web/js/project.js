// 專案介面（網頁 main.js 與 core 統一檢查共用）：createProject({ scene, mode, scenario, params }) → { total, apply(t), layoutChecks, verify, … }。
// 不碰 DOM。場景狀態只由時間 t 與建立時的參數決定；參數改了就重新建立（main.js 重新載入頁面），不留舊的 wafer map 或判定。
//   mode：'compact' 精簡展示（只掃中央幾列，其餘標「展示略過」）、'full' 完整掃描
//   scenario：'clean'、'line'、'particle'、'defocus'（spec.js 的 SCENARIOS）
//   params：覆寫 spec.js 的 PARAMS（網址參數）；非法時不執行掃描，估算顯示待確認
import * as THREE from 'three';
import { floor } from '@core/geom/environment.js';
import { PARAMS, SCENARIOS, LAYOUT, Y, IMAGES_PER_POS, resolveParams, missingOf } from './spec.js';
import { opticsOf, estimate, lineScanCompare } from './budget.js';
import { scanPlan, coverage, wastedArea, dieCount, compactList } from './scan-plan.js';
import { inspectAll, mergeCandidates, reviewList, scoreAgainstTruth } from './inspection-sim.js';
import { buildSchedule, createSequence, exposureCue, STATIONS, LOAD } from './sequence.js';
import { createWafer } from './wafer.js';
import { createMachine } from './machine.js';

export { STATIONS, SCENARIOS, PARAMS };
export const MODES = { compact: '精簡展示', full: '完整掃描' };
// 排程需要的參數：缺任何一個就不能算週期（顯示待確認，不當成 0）
const NEEDED = ['waferD', 'edgeExcl', 'dieW', 'dieH', 'camPx', 'camH', 'camV', 'camBits', 'camBuffer', 'mag', 'fNum', 'wd', 'dfRingD', 'dfHeight', 'defect', 'pxPerDefect',
  'overlap', 'vMax', 'aMax', 'settle', 'expBF', 'expDF', 'lightSwitch', 'procImg', 'procThreads', 'afPoints', 'afTime', 'reviewImgs', 'compactRows', 'flatness', 'waferT'];

export function createProject({ scene, mode = 'compact', scenario = 'line', params = {}, textureSize = 2048 } = {}) {
  mode = MODES[mode] ? mode : 'compact';
  const scId = SCENARIOS[scenario] ? scenario : 'line', sc = SCENARIOS[scId];
  const R = resolveParams(params), missing = missingOf(R.p, NEEDED);
  const ok = !R.errors.length && !missing.length;
  const p = ok ? R.p : resolveParams({}).p;                    // 非法或缺值時，機台幾何用預設值畫，但不執行掃描
  const optics = ok ? opticsOf(p) : null;
  const plan = ok ? scanPlan(p, optics.fov) : { valid: false, reason: R.errors.length ? '參數檢核失敗：' + R.errors.join('；') : `缺少必要參數（待確認）：${missing.join('、')}`, positions: [], rows: [] };
  const valid = plan.valid;

  // ---------------------------------------------------------------- 模擬檢測：相機模擬（讀 A）→ 演算法（B）→ 複檢清單（C 的來源）
  const ins = valid ? inspectAll(plan, p, sc, optics.dof) : { per: [], plane: null, afPts: [] };
  const all = valid ? plan.positions.map(q => q.k) : [];
  const list = !valid ? [] : mode === 'full' ? all : compactList(plan, p.compactRows);
  const lastAt = l => l.length ? [plan.positions[l.at(-1)].x, plan.positions[l.at(-1)].y] : [0, 0];
  const candidates = valid ? mergeCandidates(ins.per, list) : [];
  const review = valid ? reviewList(plan, ins.per, list, candidates, lastAt(list)) : [];
  const ctxOf = (l, rev) => ({ p, plan, optics, list: l, review: rev, afPts: ins.afPts, plane: ins.plane || undefined });
  // 工程估算一律用完整掃描（與播放模式無關）；精簡模式另外排一份給動畫
  const candFull = valid ? (mode === 'full' ? candidates : mergeCandidates(ins.per, all)) : [];
  const reviewFull = valid ? (mode === 'full' ? review : reviewList(plan, ins.per, all, candFull, lastAt(all))) : [];
  const schedFull = valid ? buildSchedule(ctxOf(all, reviewFull)) : null;
  const sched = !valid ? null : mode === 'full' ? schedFull : buildSchedule(ctxOf(list, review));
  const cov = valid ? coverage(plan) : { ratio: null }, covMode = valid ? (mode === 'full' ? cov : coverage(plan, new Set(list))) : { ratio: null };
  const est = valid ? estimate(p, optics, plan, schedFull, { cov, dies: dieCount(p), wasted: wastedArea(plan), review: reviewFull }) : { valid: false, reason: plan.reason };
  const lineScan = valid ? lineScanCompare(p, optics, plan) : null;
  const score = valid ? scoreAgainstTruth(sc, candidates, ins.per, list, plan) : { rows: [], extra: [] };

  // ---------------------------------------------------------------- 時序（無效參數時只有一步「不執行」）
  const schedule = sched || { steps: [{ station: 0, start: 0, dur: 2, action: '參數檢核失敗：不執行掃描', sub: plan.reason, values: { mode: 'invalid', phase: '參數檢核失敗' }, extra: { ev: true } }], total: 2, posTime: new Map(), revTime: [] };
  const sequence = createSequence(schedule), total = sequence.total;
  const reviewStart = sequence.stationStart[4] && review.length ? sequence.stationStart[4] : Infinity;

  // ---------------------------------------------------------------- 場景
  const { mesh: floorMesh, grid } = floor(scene, { size: [6000, 5000], cell: 250 });
  const wafer = createWafer(p, plan, textureSize);
  const machine = createMachine(scene, p, { waferGroup: wafer.group });
  wafer.setup({ list, posTime: schedule.posTime, per: ins.per, candidates, review, revTime: schedule.revTime, inList: new Set(list), scenario: sc, reviewStart });
  // 目前視野（固定在光軸下，跟著相機，不跟著晶圓）
  const fovGroup = new THREE.Group(); fovGroup.name = 'fov outline'; fovGroup.userData.fx = true; scene.add(fovGroup);
  const fovLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd34d, depthWrite: false }));
  if (valid) { const [w, h] = plan.fov; fovLine.geometry.setFromPoints([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => new THREE.Vector3(x, 0, -y))); }
  fovLine.position.y = machine.surf + .45; fovLine.userData.fx = true; fovGroup.add(fovLine);
  const FOV_COLOR = { move: 0x8a96a3, settle: 0xffa42b, wait: 0xffa42b, expBF: 0xfff3b0, expDF: 0x8fd0ff, switch: 0xffd34d, review: 0xff9a3c, af: 0x7fe3ff, align: 0x7fe3ff };

  let hmiKey = '';
  function apply(t, opts = {}) {
    const T = Number.isFinite(t) ? THREE.MathUtils.clamp(t, 0, total) : 0;
    const cur = sequence.sample(T), s = cur.state;
    machine.setStage(s.sx, s.sy, s.th, s.z);
    machine.setLight(s.light, s.vac, exposureCue(T, s, schedule.posTime.get(s.pos)));
    machine.setHood(opts.hood ?? 'glass');
    fovLine.material.color.set(FOV_COLOR[s.mode] ?? 0x8a96a3); fovGroup.visible = valid && opts.view?.fov !== false;
    wafer.update(T, s, opts.view || {});
    const doneN = list.filter(k => schedule.posTime.get(k)?.done <= T).length, end = T >= total - 1e-9;
    const key = `${s.phase}|${doneN}|${end}`;
    if (key !== hmiKey) {
      hmiKey = key;
      machine.panelHmi.drawText(['晶圓表面 AOI（SIM）', s.phase, valid ? `取像 ${doneN}／${list.length}` : '參數檢核失敗', mode === 'compact' ? '精簡展示：非整片檢測' : end ? '完成：待人工確認' : '完整掃描']);
      machine.tower.set(!valid ? 'red' : end ? 'yellow' : s.vac ? 'green' : 'yellow');
    }
    return cur;
  }

  // ---------------------------------------------------------------- 某時刻已經發生的結果（UI 與檢查共用；倒退時未發生的自然不在裡面）
  function resultsAt(T) {
    const done = list.filter(k => schedule.posTime.get(k)?.done <= T + 1e-9);
    const judged = list.filter(k => schedule.posTime.get(k)?.result <= T + 1e-9);
    const cands = candidates.filter(c => c.parts.some(x => schedule.posTime.get(x.k)?.result <= T + 1e-9));
    const quality = judged.filter(k => ins.per[k].status === 'recheck' || ins.per[k].status === 'missing');
    const reviewed = review.filter((_, i) => schedule.revTime[i] && schedule.revTime[i].done <= T + 1e-9);
    return { done, judged, cands, quality, reviewed, complete: mode === 'full' && valid && done.length === all.length };
  }

  // ---------------------------------------------------------------- 檢查
  const sxs = [], sys = [];
  for (const st of schedule.steps) if (st.values.sx != null) { sxs.push(st.values.sx); sys.push(st.values.sy); }
  const travelOk = sxs.every(x => Math.abs(x) <= LAYOUT.travel.x + 1e-6) && sys.every(y => y >= LAYOUT.travel.zMin - 1e-6 && y <= LAYOUT.travel.zMax + 1e-6);
  const gapRing = machine.ringY - machine.surf, fovDiag = valid ? Math.hypot(...plan.fov) / 2 : 0;
  const interlock = valid ? list.every(k => { const t = schedule.posTime.get(k); return t.exp[0] >= t.settleEnd - 1e-9 && t.exp[2] >= t.exp[1] - 1e-9 && t.done === t.exp[3]; }) : true;
  const layoutChecks = () => [
    { group: '機構', name: '平台行程涵蓋取像、對位、對焦、複檢與取放片位', ok: travelOk, value: `X ±${LAYOUT.travel.x}、Z ${LAYOUT.travel.zMin}～+${LAYOUT.travel.zMax} mm` },
    { group: '機構', name: '暗場環形光底面離晶圓表面 ≥ 5 mm', ok: gapRing >= 5 - 1e-6, value: `${gapRing.toFixed(1)} mm` },
    { group: '光學', name: '環形光內徑大於視野對角（不擋視野）', ok: machine.rIn > fovDiag + 5, value: `內徑半徑 ${machine.rIn.toFixed(0)} mm／視野半對角 ${fovDiag.toFixed(1)} mm` },
    { group: '光學', name: '鏡頭前緣到晶圓表面＝WD', ok: Math.abs(machine.lensFront - machine.surf - p.wd) < 1e-6, value: `${p.wd} mm` },
    { group: '光學', name: '缺陷像素數（只代表幾何取樣，不等於可檢出）', ok: !valid || optics.defectPx >= p.pxPerDefect, value: valid ? `${optics.defectPx.toFixed(2)} px ≥ ${p.pxPerDefect}` : '待確認' },
    { group: '光學', name: '景深涵蓋晶圓平面度（展示假設）', ok: !valid || optics.dof >= p.flatness, value: valid ? `${(optics.dof * 1000).toFixed(0)} µm vs ${(p.flatness * 1000).toFixed(0)} µm` : '待確認' },
    { group: '掃描', name: '有效區覆蓋率（完整掃描）＝100%', ok: !valid || cov.ratio === 1, value: valid ? `${(cov.ratio * 100).toFixed(2)}%` : '待確認' },
    { group: '掃描', name: '明暗場張數＝位置數 × 2', ok: !valid || list.length * IMAGES_PER_POS === sequence.seq.steps.filter(x => x.station === 3 && (x.end.mode === 'expBF' || x.end.mode === 'expDF')).length, value: valid ? `${list.length} 位置 × ${IMAGES_PER_POS}` : '—' },
    { group: '掃描', name: '停拍互鎖：停穩後才曝光，暗場曝光結束才算完成', ok: interlock, value: valid ? `${list.length} 個位置` : '—' },
    ...(mode === 'compact' && valid ? [{ group: '掃描', name: '精簡模式：略過的位置不算已取像（非整片檢測）', ok: true, value: `${list.length}／${all.length} 個位置` }] : []),
    ...(!valid ? [{ group: '參數', name: '參數檢核', ok: false, value: plan.reason }] : []),
  ];

  // 模組：scene 第一層群組；光學頭隨 Z 滑座、晶圓隨平台
  const nonPhysical = new Set([floorMesh, grid]);
  return {
    total, apply, sequence, events: sequence.events, stationStart: sequence.stationStart, layoutChecks, resultsAt,
    p, src: R.src, errors: R.errors, missing, valid, mode, scenarioId: scId, scenario: sc, optics, plan, list, all, per: ins.per, plane: ins.plane, afPts: ins.afPts,
    candidates, review, schedule, est, cov: covMode, covFull: cov, lineScan, score, wafer, machine,
    cycleTime: est.valid ? est.cycle : undefined,
    verify: {
      skip: o => nonPhysical.has(o),
      allow: [],
    },
  };
}
export { LOAD, Y };
