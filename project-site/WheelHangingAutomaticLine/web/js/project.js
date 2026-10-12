// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 輪框吊掛線手臂下掛：清洗線吊掛線以 4 cm/s 不停線，FANUC R-2000iC/165F 以手臂搭載的雙眼相機追蹤輪框，
// 粗取像辨識輪型 → 精取像修正 → 盲區直線接近夾取 → 上抬拉出吊桿 → 翻轉疊放棧板（2×2 每層、層間隔板）。
// 配置與尺寸在 layout.js，排程在 sequence.js，吊掛線在 line.js，手臂與夾爪在 robot.js。
import * as THREE from 'three';
import { createCell, createSheet, placeOnPallet } from './cell.js';
import { createLine, hookX, modelOf } from './line.js';
import { createRobot, HELD, RATING } from './robot.js';
import { createWheel } from './wheel.js';
import { createSequence, trackPose, linPose, frontOf, STATIONS, PLAN, SHEET, SHEET_YAW, sheetRackY } from './sequence.js';
import { WHEELS, OD_MAX, LINE, PICK, GRIP, STEREO, OBS, FINE, BAYS, SHEETS, PALLET, hangY, slotOf, sheetTopY } from './layout.js';

export { STATIONS };

const under = re => m => { for (let p = m; p; p = p.parent) if (re.test(p.name)) return true; return false; };
const named = re => m => re.test(m.name);
const pair = (a, b, f, g) => (f(a) && g(b)) || (f(b) && g(a));
// 只認輪框本身的群組（示範輪框、吊鉤上的、棧板上的）；夾爪、台車輪等名稱含 wheel 的零件不算
const isWheel = under(/^(wheel \d+|hook wheel [A-C]|pallet wheel [AB]\d+)$/), isSheet = named(/^layer sheet$/);

export function createProject({ scene }) {
  const cell = createCell(scene);
  const line = createLine(scene);
  const robot = createRobot(scene);
  const wheels = PLAN.map((p, k) => { const w = createWheel(p.spec, `wheel ${k}`); scene.add(w); return w; });
  const sheet = createSheet(scene, 'sheet 0');
  const { seq, poses, track, cycle, REL } = createSequence(robot);

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const presentation = { signals: [], lines: [], vision: null, bays: {} };
  let hmiKey = '';
  function apply(t) {
    const smp = seq.sample(t), st = smp.state, step = smp.step;
    let q = st.q;
    if (step.robot === 'track') q = robot.track(trackPose(step, t, smp.e), st.q);
    else if (step.robot === 'lin' && smp.u > 0 && smp.u < 1) q = robot.track(linPose(step, smp.e), st.q);
    robot.setJoints(q);
    robot.setDetail({ width: st.width, vac: st.vac, strobe: st.strobe, dist: st.dist, pattern: st.pattern });
    line.set(t);

    // ---- 示範輪框：吊鉤上 → 手臂上（夾爪座標）→ 棧板上
    robot.tcp.getWorldPosition(_p); robot.tool.getWorldQuaternion(_q);
    PLAN.forEach((p, k) => {
      const w = wheels[k], where = st['lam' + k];
      if (where === 'hook') { w.position.set(hookX(p.j, t), hangY(p.spec), LINE.z); w.quaternion.identity(); }
      else if (where === 'robot') { w.quaternion.copy(_q).multiply(HELD); w.position.copy(_p).add(new THREE.Vector3(0, -p.spec.w / 2, 0).applyQuaternion(_q)); }
      else placeOnPallet(w, BAYS[where], p.idx, p.spec);
    });
    // ---- 示範隔板：隔板架最上面一張 → 吸盤 → 棧板 A 第 4 層底板
    if (st.sheet0 === 'rack') { sheet.position.set(SHEETS.x, sheetRackY(), SHEETS.z); sheet.quaternion.setFromAxisAngle(UP, SHEET_YAW.rack); }
    else if (st.sheet0 === 'robot') {
      sheet.position.copy(robot.tool.localToWorld(robot.cupLip.clone().add(new THREE.Vector3(0, 0, PALLET.sheet / 2))));
      sheet.quaternion.copy(_q).multiply(HELD);
    } else { const b = BAYS.A; sheet.position.set(b.x, sheetTopY(SHEET.layer, PLAN[0].spec) - PALLET.sheet / 2, b.z); sheet.quaternion.setFromAxisAngle(UP, SHEET_YAW.A); }

    // ---- 感測、訊號與 HMI（只由時間決定）
    const atSensor = line.hooks.some(h => { const m = modelOf(h.j); return m && Math.abs(h.root.position.x - PICK.sensorX) < WHEELS[m].od / 2; });
    line.sensor.set(atSensor); line.beam.material.color.set(atSensor ? 0xffb020 : 0xff3030);
    for (const l of line.lights) l.set(st.strobe > .5 ? 1 : .12);
    const k = step.track ? PLAN.indexOf(step.track.p) : -1, tracking = step.robot === 'track';
    const counts = { A: BAYS.A.n + PLAN.filter((p, i) => p.bay === 'A' && st['lam' + i] === 'A').length, B: BAYS.B.n + PLAN.filter((p, i) => p.bay === 'B' && st['lam' + i] === 'B').length };
    const held = PLAN.findIndex((_, i) => st['lam' + i] === 'robot');
    const sig = {
      sensor: atSensor, tracking, trigger: st.strobe > .5, pattern: st.pattern > .5,
      gripped: held >= 0, vac: st.vac > .5,
    };
    presentation.signals = [
      ['到位光電（吊鉤＋輪框）', sig.sensor], ['輸送追蹤中（Line Tracking）', sig.tracking], ['取像觸發（頻閃同步）', sig.trigger],
      ['圖案投影（選配）', sig.pattern], ['夾持確認（伺服力矩）', sig.gripped], ['隔板真空', sig.vac],
    ].map(([label, on]) => ({ label, on }));
    presentation.bays = counts;
    // 視覺量測（示意）：取像那一步顯示輪型、外徑、中心、軸偏與可信度
    const p = k >= 0 ? PLAN[k] : null;
    presentation.vision = p && (step.action.includes('取像') || step.action.startsWith('辨識') || step.action === '更新夾取點') ? (() => {
      const c = frontOf(p, t), wob = Math.sin(1.7 * k + 2.3) * .4;
      return { model: p.spec.name, od: (p.spec.od + wob).toFixed(1), center: [c.x, c.y, c.z - p.spec.w / 2].map(v => v.toFixed(1)), tilt: (Math.abs(wob) * .8).toFixed(2), score: (.96 - .02 * k).toFixed(2), fine: step.station === 1 };
    })() : null;
    const done = t >= seq.total - 1e-6;
    const lines = ['輪框下掛　自動運轉', done ? '完成：回取像待命位' : step.action, p ? `追蹤：${p.spec.name}（吊鉤 #${p.j + 101}）` : '追蹤：—',
      `棧板 A ${counts.A}／20　B ${counts.B}／20`, `線速 40 mm/s　追蹤窗 ${PICK.window.join('～')} mm`];
    const key = lines.join('|');
    if (key !== hmiKey) { cell.hmi.drawText(lines); hmiKey = key; }
    presentation.lines = lines;
    cell.tower.set(done || t < .5 ? 'yellow' : 'green');
    return st;
  }
  apply(0);

  // ---------------------------------------------------------------- 空間檢核
  function layoutChecks() {
    const save = { ...robot.q }, rows = [];
    const reach = (name, pose) => {
      const r = robot.solve(pose, save), ok = r.err.position <= 1 && r.err.angle <= .1;
      rows.push({ group: '手臂可達', name, ok, value: ok ? `誤差 ${r.err.position.toFixed(2)} mm` : `差 ${r.err.position.toFixed(1)} mm／${r.err.angle.toFixed(2)}°` });
    };
    // 追蹤窗兩端：最大款（C，外徑 600）的取像位與夾取位都要可達
    const C = { j: 0, spec: WHEELS.C };
    // 粗取像在窗口起點開始；精取像、夾取、拉出最早約在起點下游 70、280、330 mm（輪框持續前進）
    const at = x => new THREE.Vector3(x, hangY(WHEELS.C), LINE.z + WHEELS.C.w / 2), [w0, w1] = PICK.window;
    for (const [name, rel, x] of [['粗取像', REL.obs, w0], ['精取像', REL.fine, w0 + 70], ['夾取', REL.grip, w0 + 280], ['拉出', REL.pull, w0 + 330],
      ['粗取像（最晚）', REL.obs, PICK.obsLatest], ['夾取', REL.grip, w1], ['拉出', REL.pull, w1]])
      reach(`窗口 ${x} mm ${name}（C 款）`, { target: at(x).add(rel.off), rot: rel.rot });
    for (const [key, b] of Object.entries(BAYS)) for (const i of [0, 3, 16, 19]) {
      const spec = WHEELS[b.model], s = slotOf(b, i, spec);
      reach(`棧板 ${key} 第 ${s.layer + 1} 層第 ${i % 4 + 1} 格`, { target: new THREE.Vector3(s.x, s.y + spec.w / 2, s.z), rot: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0) });
    }
    const worst = Math.max(...poses.map(([, , j]) => j.err.position));
    rows.push({ group: '手臂可達', name: `排程內 ${poses.length} 個位姿`, ok: worst <= 1, value: `最大誤差 ${worst.toFixed(2)} mm` });
    robot.setJoints(save);
    const heavy = Math.max(...Object.values(WHEELS).map(w => w.kg));
    rows.push({ group: '負載', name: `最重輪框＋夾爪 ≤ ${RATING.payload} kg`, ok: heavy + GRIP.kg <= RATING.payload, value: `${(heavy + GRIP.kg).toFixed(1)} kg` });
    // 視野：粗取像距離下雙眼共同視野要涵蓋最大外徑＋擺動餘裕 ±50
    const d = OBS.dist + 60, fw = d * STEREO.sensor[0] / STEREO.focal - STEREO.baseline, fh = d * STEREO.sensor[1] / STEREO.focal;
    rows.push({ group: '視覺', name: `粗取像共同視野 ≥ ${OD_MAX + 100} mm`, ok: Math.min(fw, fh) >= OD_MAX + 100, value: `${Math.round(fw)} × ${Math.round(fh)} mm` });
    const dz = d * d * (.25 * STEREO.sensor[0] / STEREO.px[0]) / (STEREO.focal * STEREO.baseline);
    rows.push({ group: '視覺', name: '深度解析（1/4 像素視差）≤ 1 mm', ok: dz <= 1, value: `${dz.toFixed(2)} mm @ ${d} mm` });
    rows.push({ group: '視覺', name: '取像時輪框位移（300 µs 曝光）', ok: true, value: `${(LINE.v * 300e-6).toFixed(3)} mm` });
    // 追蹤：夾緊時輪框在窗內；節拍 ≤ 吊鉤間隔
    const inWin = PLAN.every(p => hookX(p.j, p.gripT) >= PICK.window[0] && p.releaseX <= PICK.window[1]);
    rows.push({ group: '追蹤', name: '夾取到拉出都在追蹤窗內', ok: inWin, value: PLAN.map(p => `${Math.round(hookX(p.j, p.gripT))}～${Math.round(p.releaseX)}`).join('／') });
    const limit = LINE.pitch / LINE.v;
    rows.push({ group: '節拍', name: `平均節拍 ≤ 吊鉤間隔 ${limit} s`, ok: cycle <= limit, value: `${cycle.toFixed(1)} s／個（含隔板）` });
    return rows;
  }

  return {
    total: seq.total, sequence: seq, timeline: seq, apply, layoutChecks, stationStart: seq.stationStart,
    cycleTime: cycle, robot, line, cell, wheels, sheet, presentation, plan: PLAN, track,
    verify: {
      allow: [
        { why: '輪框中心孔靠在吊桿 PU 護套上（吊掛中、上抬前）', test: (a, b) => pair(a, b, isWheel, named(/^hook (sleeve|bar|tip|joint)$/)) },
        { why: 'PU 指墊夾住輪框外緣', test: (a, b) => pair(a, b, isWheel, named(/^finger pad$/)) },
        { why: '輪框背面輪緣坐在隔板上；隔板鋪在下一層輪框正面輪緣上', test: (a, b) => pair(a, b, isWheel, isSheet) },
        { why: '隔板疊在隔板架上、被吸盤吸住', test: (a, b) => pair(a, b, isSheet, named(/^(sheet stack|suction cup)$/)) },
        { why: '隔板鋪在棧板面上', test: (a, b) => pair(a, b, isSheet, named(/^pallet deck$/)) },
      ],
      dt: .1,
      envelope: ['robot'],
    },
  };
}
