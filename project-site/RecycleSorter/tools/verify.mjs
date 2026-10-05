// 本專案的製程規則檢查（proposal §5.6）：通用的干涉、閃爍、倒序一致由 core 統一檢查負責。
//   node --import ../../core/tools/register.mjs tools/verify.mjs
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createProject } from '../web/js/project.js';
import { LAYOUT } from '../web/js/layout.js';
import { CT, BELT_V, TOTAL, CHAPTERS, MIX, mixedCT, perHour, ABB_CT, ABB_PHASES, PRE_ROLL, laneAt, leadOf } from '../web/js/schedule.js';
import { deltaIK } from '../web/js/delta.js';

const L = LAYOUT, scene = new THREE.Scene(), project = createProject({ scene });
const { jobs, missed, items, timing } = project;
const failures = [], notes = [];
const F = (ok, msg) => { if (!ok) failures.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const world = it => it.grp.getWorldPosition(new THREE.Vector3());
const at = t => { const st = project.apply(t); scene.updateMatrixWorld(true); return st; };

// ---------------------------------------------------------------- 1. 節拍
// 2026-10-05 補上前段（既有 ABB 分選站）後，播放時間多 24 s、製程時間後移 PRE_ROLL；54 s 之後就是原本 30 s 之後的後段
F(TOTAL === 120, `動畫總長 ${TOTAL} s 與企劃的 120 s（前段 24 s＋原 96 s）不符`);
F(near(timing.tau(54), 20.1 + PRE_ROLL, 1e-6), `後段起點的製程時間 ${timing.tau(54).toFixed(3)} s 與原時間軸（20.1 s＋後移 ${PRE_ROLL} s）對不上`);
F(CT <= 1.4 + 1e-9, `節拍 ${CT} s 超過規格 1.4 s`);
const gaps = project.ctGaps;
F(Math.min(...gaps) >= CT - 1e-3, `取放間隔 ${Math.min(...gaps).toFixed(3)} s 小於節拍 ${CT} s`);
const burst = gaps.filter(g => near(g, CT, .02)).length;
F(burst >= 5, `連續運轉段只有 ${burst} 個 1.40 s 間隔，不足以展示滿載節拍`);
notes.push(`取放 ${jobs.length} 趟，連續 ${burst + 1} 抓的相鄰間隔為 ${CT.toFixed(2)} s`);
notes.push(`跨帶（B）單趟節拍 ${Math.max(...project.metrics.ctB).toFixed(2)} s，同側（A）${Math.min(...project.metrics.ctA).toFixed(2)} s`);

// 承諾產能以混合料流加權平均計（已拍板 ct-mixed）
const tp = project.throughput;
F(Math.abs(tp.ct.AA - CT) <= .01, `同類連抓節拍 ${tp.ct.AA.toFixed(3)} s 與規格 ${CT} s 不符`);
F(tp.ct.BB >= tp.ct.AA, `跨帶節拍 ${tp.ct.BB} s 不應小於同類節拍 ${tp.ct.AA} s`);
F(tp.mixed > tp.ct.AA && tp.mixed < tp.ct.BB, `加權平均節拍 ${tp.mixed} s 應落在 ${tp.ct.AA}…${tp.ct.BB} s 之間`);
F(Math.abs(tp.mixed - mixedCT(tp.ct)) < 1e-3, '加權平均節拍與 mixedCT() 不一致');
F(tp.hour === perHour(tp.mixed), '承諾產能與加權平均節拍不一致');
F(tp.pitch >= Math.ceil(CT * BELT_V), `加權節拍對應的目標間距 ${tp.pitch} mm 不應小於同類連抓的 ${CT * BELT_V} mm`);
notes.push(`四種轉移節拍 AA ${tp.ct.AA} / AB ${tp.ct.AB} / BA ${tp.ct.BA} / BB ${tp.ct.BB} s`);
notes.push(`混合料流（食品 ${Math.round(MIX.food * 100)}%）加權平均 ${tp.mixed} s／瓶，稼動 ${Math.round(MIX.uptime * 100)}% → 約 ${tp.hour} 瓶/小時；目標間距需 ≥ ${tp.pitch} mm`);

// ---------------------------------------------------------------- 2. 類別與投放目的地一致
for (const job of jobs) {
  const want = job.ref.cls === 'food' ? 'A' : 'B';
  F(job.dest === want, `工件 ${job.ref.id}（${job.ref.kind}／${job.ref.cls}）投放到 ${job.dest} 帶，應為 ${want} 帶`);
}
F(jobs.every(j => j.ref.cls !== 'other'), '非目標物被排入取放工單');

// ---------------------------------------------------------------- 3. 抓取瞬間吸盤面與工件頂面的距離
for (const job of jobs) {
  const st = at(timing.timeAt(job.grabTau));
  const p = world(job.ref), top = p.y + job.ref.H, d = st.tcp.p.y - top;
  F(d >= 0 && d < 5, `工件 ${job.ref.id} 抓取瞬間吸盤面與頂面距離 ${d.toFixed(2)} mm（需 0…5 mm）`);
  const inWin = p.x >= L.pick.x[0] - 1 && p.x <= L.pick.x[1] + 1 && p.z >= L.pick.z[0] - 1 && p.z <= L.pick.z[1] + 1;
  F(inWin, `工件 ${job.ref.id} 抓取點 (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) 落在追蹤窗口外`);
}

// ---------------------------------------------------------------- 4. 投放位置：落在正確的分流帶上
for (const job of jobs) {
  const d = job.dest === 'A' ? L.divA : L.divB;
  const st = at(timing.timeAt(job.landTau + .02));
  const p = world(job.ref);
  F(near(p.y, d.top + 2, 6), `工件 ${job.ref.id} 落料高度 ${p.y.toFixed(0)} 不在 ${job.dest} 帶面 ${d.top}`);
  F(p.x >= Math.min(...d.x) - 10 && p.x <= Math.max(...d.x) + 10, `工件 ${job.ref.id} 落料 X ${p.x.toFixed(0)} 超出 ${job.dest} 帶範圍`);
  F(Math.abs(p.z - d.z) <= d.width / 2, `工件 ${job.ref.id} 落料 Z ${p.z.toFixed(0)} 超出 ${job.dest} 帶寬`);
  F(st.counts[job.dest] >= 1, `落料後 ${job.dest} 帶計數未增加`);
}

// ---------------------------------------------------------------- 5. 收料箱定位：每件最後都在對應的收料箱內
for (const job of jobs) {
  at(TOTAL - .01);
  const p = world(job.ref), bn = job.dest === 'A' ? L.binA : L.binB, [bx, , bd] = L.bin;
  F(Math.abs(p.x - bn.x) <= bx / 2 && Math.abs(p.z - bn.z) <= bd / 2 && p.y < 300,
    `工件 ${job.ref.id} 結束時不在 ${job.dest} 收料箱內（${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}）`);
}

// ---------------------------------------------------------------- 6. 非目標物：全程留在主帶，從末端離場
const beltTop = L.belt.top, others = items.filter(it => it.cls === 'other');
for (let t = 0; t <= TOTAL; t += .25) {
  at(t);
  for (const it of others) {
    if (!it.grp.visible) continue;
    const p = world(it);
    F(near(p.y, beltTop + 2, 1), `t=${t.toFixed(1)}s 非目標物 ${it.id} 離開帶面（Y ${p.y.toFixed(1)}）`);
    F(Math.abs(p.z - L.belt.z) <= L.belt.width / 2, `t=${t.toFixed(1)}s 非目標物 ${it.id} 超出帶寬（Z ${p.z.toFixed(0)}）`);
  }
  if (failures.length > 6) break;
}
const exitTau = it => (L.belt.x[1] - it.off) / BELT_V;
notes.push(`非目標物 ${others.length} 件，${others.filter(it => exitTau(it) <= timing.tauTotal).length} 件在動畫結束前由末端離場`);

// ---------------------------------------------------------------- 7. 漏抓目標：必須存在、從末端離場並觸發警報
F(missed.length >= 1, '沒有示意「目標物間距不足導致漏抓」的情形');
for (const m of missed) {
  const want = (L.pick.cx - m.item.off) / BELT_V;
  F(m.grabTau >= want - 1e-6, `漏抓判定時間異常（工件 ${m.item.id}）`);
  F(exitTau(m.item) <= timing.tauTotal, `漏抓的工件 ${m.item.id} 在動畫結束前沒有流到末端，警報不會出現`);
}
const endState = at(TOTAL - .01);
F(endState.alarm && endState.counts.missed === missed.length, `結束時漏抓警報狀態不正確（missed=${endState.counts.missed}）`);

// ---------------------------------------------------------------- 8. 導料板：工件全程在兩段導料板的通道內
// 通道（開口與中心線）由 schedule.js 的 laneAt() 定義，板面也是照它畫的；寬度取工件前緣所在的位置。
for (let t = 0; t <= TOTAL; t += .5) {
  at(t);
  for (const it of items) {
    if (!it.grp.visible) continue;
    const p = world(it); if (Math.abs(p.y - (beltTop + 2)) > 1) continue;      // 只看還在主帶上的
    const { gap, center } = laneAt(p.x + leadOf(it)), room = (gap - it.extent) / 2;
    F(Math.abs(p.z - center) <= room - L.guide.margin / 2 + .5, `t=${t.toFixed(1)}s 工件 ${it.id} 超出導料板通道（Z ${p.z.toFixed(0)}、中心 ${center.toFixed(0)}、可用 ±${room.toFixed(0)}）`);
  }
  if (failures.length > 10) break;
}

// ---------------------------------------------------------------- 9. 前段 ABB：先到先抓、沒空就放行；抓到的放上既有分類帶
const AB = L.abb, { abbJobs, passed, front } = project;
const PRE = ABB_PHASES.slice(0, 3).reduce((s, p) => s + p.dur, 0);
F(abbJobs.length >= 10, `前段 ABB 只抓 ${abbJobs.length} 件，不足以展示第一道分選`);
F(passed.length >= 10, `前段只放行 ${passed.length} 件，不足以展示後段補抓`);
// 後段的工單必須和補上前段之前完全相同（工件編號不變），而且一件工件只會被一支手臂抓
const REAR_IDS = [9, 10, 12, 14, 16, 17, 18, 19, 20, 21, 22, 23], MISS_IDS = [24];
F(JSON.stringify(jobs.map(j => j.ref.id)) === JSON.stringify(REAR_IDS), `後段工單的工件 ${jobs.map(j => j.ref.id)} 與原本的 ${REAR_IDS} 不同`);
F(JSON.stringify(missed.map(m => m.item.id)) === JSON.stringify(MISS_IDS), `後段漏抓的工件 ${missed.map(m => m.item.id)} 與原本的 ${MISS_IDS} 不同`);
F(items.every(it => !(it.job && it.abbJob)), '有工件同時排進前段與後段的工單');
F(passed.every(it => it.job || missed.some(m => m.item === it)), '有放行的目標後段沒有接手');
F(items.filter(it => it.cls !== 'other').every(it => it.abbJob || it.pass), '有目標物既沒被 ABB 抓、也沒記錄放行');
for (const job of abbJobs) {
  const it = job.item, st = at(timing.timeAt(job.grabTau)), p = world(it);
  const d = st.abb.p.y - (p.y + it.H);
  F(d >= 0 && d < 5, `ABB 抓工件 ${it.id} 的瞬間吸嘴口與頂面距離 ${d.toFixed(2)} mm（需 0…5 mm）`);
  F(Math.abs(p.x - AB.x) <= AB.window + 1, `ABB 抓工件 ${it.id} 的位置 X ${p.x.toFixed(0)} 在抓取窗口 ${AB.x} ±${AB.window} 之外`);
  F(Math.hypot(st.abb.p.x - p.x, st.abb.p.z - p.z) < 1, `ABB 抓工件 ${it.id} 時吸嘴沒有對在工件上方`);
  F((it.cls === 'food') === (job.zone.key === 'food'), `工件 ${it.id}（${it.cls}）放到分類帶的${job.zone.key === 'food' ? '食品' : '非食品'}段`);
  // 放料後落在對的那一段分類帶上、而且往帶尾走
  at(timing.timeAt(job.landTau + .02)); const q = world(it), SO = AB.sort;
  F(near(q.y, SO.top + 2, 6) && q.x >= job.zone.x[0] && q.x <= job.zone.x[1] && Math.abs(q.z - front.sortZ) <= SO.width / 2, `工件 ${it.id} 沒有落在分類帶上（${q.x.toFixed(0)}, ${q.y.toFixed(0)}, ${q.z.toFixed(0)}）`);
  F((job.zone.exit - job.rel.x) * job.zone.dir > 0, `工件 ${it.id} 的分類帶方向與帶尾位置不一致`);
}
for (let i = 1; i < abbJobs.length; i++) F(abbJobs[i].grabTau - abbJobs[i - 1].grabTau >= ABB_CT - 1e-6, `ABB 第 ${i} 與 ${i + 1} 趟只隔 ${(abbJobs[i].grabTau - abbJobs[i - 1].grabTau).toFixed(3)} s，小於單趟 ${ABB_CT} s`);
// 放行必須是真的來不及：目標離開窗口時，上一趟放完料再趕過來（接近＋下降＋吸附）還到不了
for (const it of passed) F(it.pass.busyUntil + PRE > it.pass.leave, `工件 ${it.id} 離開窗口（${it.pass.leave.toFixed(2)} s）前 ABB 其實來得及（${(it.pass.busyUntil + PRE).toFixed(2)} s）`);
// ABB 姿態：逆解全程有效；結束時抓走的工件都在對應的收料籃裡
for (let t = 0; t <= TOTAL; t += .2) { const st = at(t); if (!deltaIK(front.toPlatform(st.abb.p.x, st.abb.p.y, st.abb.p.z), AB.delta)) { F(false, `t=${t.toFixed(1)}s ABB 逆解失敗`); break; } }
at(TOTAL - .01);
for (const job of abbJobs) {
  const p = world(job.item), [kx, ky, kz] = AB.sort.bin, bx = job.zone.slots[1].x;
  F(Math.abs(p.x - bx) <= kx / 2 && Math.abs(p.z - front.sortZ) <= kz / 2 && p.y < ky, `工件 ${job.item.id} 結束時不在分類帶帶尾的收料箱內（${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}）`);
}
notes.push(`前段 ABB 抓 ${abbJobs.length} 件（單趟 ${ABB_CT} s、最短間隔 ${Math.min(...project.abbMetrics.gaps).toFixed(2)} s），放行 ${passed.length} 件 → 後段補抓 ${jobs.length}、漏抓 ${missed.length}`);

// ---------------------------------------------------------------- 10. 段落與排程一致
for (const ch of CHAPTERS) F(ch.t[1] > ch.t[0], `段落 ${ch.id} 時間區間無效`);
F(CHAPTERS.at(-1).t[1] === TOTAL, '最後一段沒有結束在動畫總長');
F(project.bad.length === 0, `逆解失敗：${project.bad.join('；')}`);

const result = {
  ok: !failures.length, total: TOTAL, ct: CT, mixedCT: tp.mixed, perHour: tp.hour,
  jobs: jobs.length, missed: missed.length, burstIntervals: burst, abbJobs: abbJobs.length, passed: passed.length, abbCT: ABB_CT,
  transitions: tp.ct, metrics: project.metrics, notes, failures,
};
mkdirSync(new URL('../review/', import.meta.url), { recursive: true });
writeFileSync(new URL('../review/verification.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, metrics: undefined }, null, 2));
process.exit(result.ok ? 0 : 1);
