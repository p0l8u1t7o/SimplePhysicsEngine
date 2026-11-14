// 本站自有檢查：通用的干涉、閃爍、倒序一致由 core 統一檢查負責，這裡查製程與資料的規則。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
// 項目：倒序與跳播一致、未取像不得顯示完成、倒退清除未發生的結果、圓形邊界與覆蓋、明暗場張數、參數變更後重算、
//       停拍互鎖、模擬真值與演算法候選分離、非法參數／缺值／缺圖／失焦、平台行程與光學間隙、估算與時序一致。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { SCENARIOS, resolveParams } from '../web/js/spec.js';
import { detect, renderTile, inspectAll } from '../web/js/inspection-sim.js';
import { opticsOf } from '../web/js/budget.js';
import { scanPlan, coverage } from '../web/js/scan-plan.js';

const rows = [];
const check = (group, name, ok, value = '') => rows.push({ group, name, ok: !!ok, value: String(value) });
const build = o => createProject({ scene: new THREE.Scene(), ...o });

// 畫面上可見的結果（從場景物件讀，不是從資料讀）
function visible(pr) {
  return {
    cells: [...pr.wafer.state],
    B: pr.candidates.filter(c => c.mark.visible).map(c => c.id),
    C: pr.review.filter(it => it.markC.visible).map(it => it.ref),
    stage: [pr.machine.xCar.position.x, pr.machine.yCar.position.z, pr.machine.rotor.rotation.y].map(v => +v.toFixed(6)),
    light: [pr.machine.beamBF.visible, pr.machine.beamDF.visible],
  };
}

for (const [mode, scenario] of [['compact', 'line'], ['full', 'particle'], ['compact', 'defocus'], ['compact', 'clean']]) {
  const pr = build({ mode, scenario }), tag = `${mode}/${scenario}`, T = pr.total;
  const times = Array.from({ length: 61 }, (_, i) => T * i / 60);

  // ---- 倒序與跳播一致（狀態與畫面）
  const fwd = times.map(t => { pr.apply(t); return JSON.stringify([pr.sequence.sample(t).state, visible(pr)]); });
  const rev = [...times].reverse().map(t => { pr.apply(t); return JSON.stringify([pr.sequence.sample(t).state, visible(pr)]); }).reverse();
  const order = times.map((_, i) => (i * 37) % times.length);
  const jump = []; for (const i of order) { pr.apply(times[i]); jump[i] = JSON.stringify([pr.sequence.sample(times[i]).state, visible(pr)]); }
  check(tag, '倒序、跳播與順序播放的狀態和畫面相同', fwd.every((s, i) => s === rev[i] && s === jump[i]), `${times.length} 個時間點`);

  // ---- 未取像不得顯示完成；倒退後未發生的結果清除
  let badDone = 0, badB = 0, badC = 0;
  for (const t of [...times, ...times.slice().reverse()]) {
    pr.apply(t); const v = visible(pr);
    v.cells.forEach((st, k) => {
      const pt = pr.schedule.posTime.get(k), shown = ['done', 'candidate', 'recheck', 'missing'].includes(st);
      if (shown && !(pt && pt.done <= t + 1e-9)) badDone++;
      if (!pr.list.includes(k) && st !== 'skipped') badDone++;
      if (['candidate', 'recheck', 'missing'].includes(st) && !(pt.result <= t + 1e-9)) badDone++;
    });
    for (const c of pr.candidates) if (c.mark.visible !== c.parts.some(x => pr.schedule.posTime.get(x.k).result <= t + 1e-9)) badB++;
    pr.review.forEach((it, i) => { if (it.markC.visible !== (pr.schedule.revTime[i].done <= t + 1e-9)) badC++; });
  }
  check(tag, '未取像的位置不顯示完成；結果在處理完成後才出現', badDone === 0, `違規 ${badDone}`);
  check(tag, '倒退時間後清除尚未發生的候選（B）與待人工確認（C）', badB === 0 && badC === 0, `B ${badB}、C ${badC}`);
  pr.apply(T); const rEnd = pr.resultsAt(T);
  check(tag, mode === 'compact' ? '精簡模式結束時不得宣稱整片完成' : '完整掃描結束時整片已取像', mode === 'compact' ? !rEnd.complete && rEnd.done.length < pr.all.length : rEnd.complete, `${rEnd.done.length}／${pr.all.length}`);
  check(tag, '略過的位置沒有候選、沒有複檢', pr.candidates.every(c => c.parts.every(x => pr.list.includes(x.k))) && pr.review.every(it => pr.list.includes(it.k)), '');

  // ---- 明暗場張數與位置數一致
  const exp = m => pr.sequence.seq.steps.filter(s => s.station === 3 && s.end.mode === m).length;
  check(tag, '明場張數＝暗場張數＝取像位置數', exp('expBF') === pr.list.length && exp('expDF') === pr.list.length, `${exp('expBF')}／${exp('expDF')}／${pr.list.length}`);
  check(tag, '影格總數＝位置×2＋對位 2＋複檢×每處張數', pr.schedule.frames === pr.list.length * 2 + 2 + pr.review.length * pr.p.reviewImgs, `${pr.schedule.frames}`);

  // ---- 停拍互鎖：停穩後才曝光、曝光期間平台不動、暗場結束才算完成
  let bad = 0;
  for (const k of pr.list) {
    const t = pr.schedule.posTime.get(k), q = pr.plan.positions[k];
    if (t.exp[0] < t.settleEnd - 1e-9 || t.exp[2] < t.exp[1] || t.done !== t.exp[3]) bad++;
    for (const tt of [t.exp[0], (t.exp[0] + t.exp[1]) / 2, t.exp[1] - 1e-6, (t.exp[2] + t.exp[3]) / 2, t.exp[3] - 1e-6]) {
      const s = pr.sequence.sample(tt).state;
      if (Math.abs(s.sx - q.x) > 1e-6 || Math.abs(s.sy - q.y) > 1e-6 || !['expBF', 'expDF', 'switch', 'wait'].includes(s.mode)) bad++;
    }
    const pre = pr.sequence.sample(t.settleEnd - 1e-4).state;
    if (pre.mode !== 'settle' || pre.light !== 'off') bad++;
  }
  check(tag, '停拍互鎖（停穩前不曝光、曝光時平台靜止）', bad === 0, `違規 ${bad}`);

  // ---- 行程與光學間隙
  for (const r of pr.layoutChecks()) if (!r.ok) check(tag, 'layout：' + r.name, false, r.value);
}

// ---- 圓形邊界與掃描覆蓋（獨立重算，不用 project 的結果）
{
  const { p } = resolveParams({}), o = opticsOf(p), plan = scanPlan(p, o.fov);
  const outside = plan.positions.filter(q => { const dx = Math.max(Math.abs(q.x) - o.fov[0] / 2, 0), dy = Math.max(Math.abs(q.y) - o.fov[1] / 2, 0); return dx * dx + dy * dy >= plan.Rv ** 2; });
  check('覆蓋', '每個取像位置都和有效圓相交', outside.length === 0, `${plan.positions.length} 個位置`);
  const fine = coverage(plan, null, 0.5);
  check('覆蓋', '有效圓（含邊界一圈）逐點 100% 覆蓋', fine.ratio === 1, `${(fine.ratio * 100).toFixed(3)}%、${fine.samples} 點`);
  const area = Math.PI * plan.Rv ** 2 / (plan.step[0] * plan.step[1]);
  check('覆蓋', '位置數不是面積相除（包含邊緣補位）', plan.positions.length > area, `${plan.positions.length} > 面積相除 ${area.toFixed(0)}`);
  const drop = plan.positions.slice(0, -1).map(q => q.k);
  check('覆蓋', '少一個位置時覆蓋率檢查抓得到缺口', coverage(plan, new Set(drop)).ratio < 1, '對照組');
}

// ---- 參數變更後重算、不留舊結果
{
  const a = build({}), aSnap = JSON.stringify([a.plan.positions.length, a.est.cycle, a.candidates.map(c => c.id)]);
  const b = build({ params: { mag: 2, camIf: '10GigE' } });
  check('參數', '倍率 2× 時視野、位置數、週期重新計算', b.plan.positions.length > a.plan.positions.length * 3 && b.est.cycle !== a.est.cycle && b.wafer.state.length === b.plan.positions.length,
    `${a.plan.positions.length} → ${b.plan.positions.length} 位置；${a.est.cycle.toFixed(0)} → ${b.est.cycle.toFixed(0)} s`);
  check('參數', '建立新專案不影響前一個的結果', JSON.stringify([a.plan.positions.length, a.est.cycle, a.candidates.map(c => c.id)]) === aSnap, '');
  const full = build({ mode: 'full', scenario: 'line' });
  check('估算', '完整掃描的動畫總長＝整片週期估算', Math.abs(full.total - full.est.cycle) < 1e-6, `${full.total.toFixed(2)} s`);
  check('估算', '估算分項加總＝整片週期', Math.abs(full.est.breakdown.reduce((s, x) => s + x.s, 0) - full.est.cycle) < 1e-6, '');
  const c1 = build({ scenario: 'line' }), c2 = build({ scenario: 'line' });
  check('情境', '同一情境重建兩次，候選完全相同（固定資料、無亂數）', JSON.stringify(c1.candidates.map(c => [c.id, c.box])) === JSON.stringify(c2.candidates.map(c => [c.id, c.box])), `${c1.candidates.length} 個候選`);
}

// ---- 模擬真值（A）與演算法候選（B）分離
{
  const src = detect.toString();
  check('資料分離', 'detect() 只收影像，程式碼不讀缺陷清單或情境', detect.length === 2 && !/defect|SCENARIO|scenario|truth/.test(src), `參數 ${detect.length} 個`);
  const { p } = resolveParams({}), o = opticsOf(p), plan = scanPlan(p, o.fov);
  const clean = inspectAll(plan, p, SCENARIOS.clean, o.dof);
  check('資料分離', '無注入缺陷時演算法不產生候選', clean.per.every(r => r.status === 'ok'), `${clean.per.filter(r => r.status !== 'ok').length} 個非良品位置`);
  const pr = build({ scenario: 'particle' });
  const miss = pr.score.rows.filter(r => r.result === 'SIM 漏檢');
  check('資料分離', '候選來自影像：低對比顆粒（A5）沒有被「讀真值」補上', miss.some(r => r.id === 'A5'), miss.map(r => r.id).join(' '));
  const truthBoxes = SCENARIOS.particle.defects.map(d => JSON.stringify([d.at[0] - d.r, d.at[1] - d.r, d.at[0] + d.r, d.at[1] + d.r]));
  check('資料分離', '候選外框不是真值的複本', pr.candidates.every(c => !truthBoxes.includes(JSON.stringify(c.box))), '');
  // 同一張影像：把情境的缺陷改掉，演算法結果不變（它只看影像）
  const q = plan.positions.find(q => Math.abs(q.x - (-18)) < o.fov[0] / 2 && Math.abs(q.y - 6.5) < o.fov[1] / 2);
  const shot = renderTile(q.x, q.y, plan.fov, p, { defects: SCENARIOS.particle.defects, ref: true }); const { ref, ...img } = shot;
  const r1 = JSON.stringify(detect(img, ref)), saved = SCENARIOS.particle.defects; SCENARIOS.particle.defects = [];
  const r2 = JSON.stringify(detect(img, ref)); SCENARIOS.particle.defects = saved;
  check('資料分離', '改掉真值後同一張影像的演算結果不變', r1 === r2 && JSON.parse(r1).status === 'candidate', JSON.parse(r1).status);
}

// ---- 非法參數、缺值、缺圖、失焦
{
  const bad = build({ params: { mag: -1 } });
  check('異常', '非法參數：不排掃描，估算顯示待確認（不是 0）', !bad.valid && !bad.est.valid && bad.cycleTime === undefined && bad.list.length === 0 && bad.layoutChecks().some(r => !r.ok), bad.plan.reason);
  const nan = build({ params: { overlap: 'abc' } });
  check('異常', '非數字參數被擋下', !nan.valid && nan.errors.length > 0, nan.errors[0] || '');
  const miss = build({ params: { settle: null } });
  check('異常', '缺少必要參數：顯示待確認', !miss.valid && /待確認/.test(miss.plan.reason), miss.plan.reason);
  const defocus = build({ scenario: 'defocus', mode: 'full' });
  const st = s => defocus.per.filter(r => r.status === s).length;
  check('異常', '缺圖的位置判待複檢（不判良品）', st('missing') > 0 && defocus.review.some(it => it.type === 'missing'), `${st('missing')} 個`);
  check('異常', '失焦／照明不足的位置判待複檢', st('recheck') > 0 && defocus.per.filter(r => r.status === 'recheck').every(r => r.blobs.length === 0), `${st('recheck')} 個`);
  const warp = SCENARIOS.defocus.defects.find(d => d.kind === 'warp');
  const inWarp = defocus.plan.positions.filter(q => Math.hypot(q.x - warp.at[0], q.y - warp.at[1]) < warp.r * 0.5);
  check('異常', '翹曲中心的位置都沒有判良品', inWarp.length > 0 && inWarp.every(q => defocus.per[q.k].status !== 'ok'), `${inWarp.length} 個`);
  const nullImg = detect({ bf: null, df: new Float32Array(4), w: 2, h: 2 }, { bf: new Float32Array(4), df: new Float32Array(4), w: 2, h: 2 });
  check('異常', '影像為空時 detect 回報缺圖', nullImg.status === 'missing', nullImg.reasons[0]);
}

const failures = rows.filter(r => !r.ok);
const result = { ok: !failures.length, checks: rows.length, failures: failures.map(r => `${r.group}：${r.name}（${r.value}）`), rows };
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
for (const r of rows) console.log(`${r.ok ? '✓' : '✗'} [${r.group}] ${r.name}${r.value ? '：' + r.value : ''}`);
console.log(JSON.stringify({ ok: result.ok, checks: rows.length, failures: failures.length }));
process.exit(result.ok ? 0 : 1);
