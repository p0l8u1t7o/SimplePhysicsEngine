// 專案介面：網頁（main.js）與 core 統一檢查共用。網址參數 ?plan=roll|dual|turntable|cobot 切換方案（A 採用、A2 雙工位評估、B／C 參考）。
// 流程：上料定位 → 相機定位（取像＋軌跡規劃）→ 開 V 槽（CNC 刀頭＋回程吸屑）→ 焊條熔接（5 kgf 下壓＋UV 線雷射）→ 削平（刮平）→ 焊帶熔接 → 兆赫波檢測 → NG 補修與複檢 → 卸料；
// 每道製程換一次工具，依序做縱縫、下環縫、上環縫。生產時是完整的桶，手臂只從人孔進出；畫面的透視、剖切只是觀看方式。
// 手臂一律 J1 與桶軸同軸、從人孔伸入（伸直穿過人孔，進桶後展開到退刀姿態）；環縫由桶轉（A、B）或 J1 繞圈（C）完成，縱縫由載具沿桶軸移動完成。
// NG（2026-11-11 客戶反饋）：工序 4 UV 線雷射判 NG → 停焊、切斷焊條、退出、通知人員 → 人員刨除不良段 → 復歸後從斷點續焊；
// 兆赫波判 NG → 通知人員人工補修 → 自動複檢。
// 雙工位（A2）：每一線是一個「工位」（桶、迴轉架、X 軸、手臂各一套），兩線共用一組工具與穿梭工具架。
// 排程用資源互鎖：每支工具、工具架同一時間只給一線；每次推進時間最早的那一線（先到先用），等待時在事件列標示。
import * as THREE from 'three';
import { createTimeline, linear } from '@core/anim/track.js';
import { TANK, NECK_CLEAR, PROCESS, TOOLS, PLANS, DEMO, FIELD, THZ, HOT_AIR, ROD_WELD, ROD_NG, DUAL, seamLength, makeSeams, seamLayout } from './spec.js';
import { createTank } from './tank.js';
import { createTools, rackSlot, RACK_DEPTH } from './tools.js';
import { createWelderArm, STOW } from './robot.js';
import { buildPlan } from './plans.js';
import { MAT, std } from '@core/geom/materials.js';
import { block, cylinder } from '@core/geom/shapes.js';
import { addArmServices, addPeripheryDetails, addExtraction } from './details.js';
import { estimatePayload, combinePayloads } from '@core/robot/payload.js';

export { PLANS };
export const STATIONS = ['上料定位', ...PROCESS.map(p => p.name), 'NG 補修與複檢', '卸料'];
const CIRC_START = Math.PI / 2;                     // 環縫起點（桶座標方位）：離縱縫 90°，不在 T 形接頭起焊
const D = 180 / Math.PI;
const RES_NAME = k => k === 'rack' ? '穿梭工具架' : TOOLS.find(t => 'tool:' + t.key === k)?.name ?? k;

// 人員（示意，不採購）：NG 時到人孔旁接手；平常隱藏
function makeWorker(scene, pos, rotY) {
  const w = new THREE.Group(); w.name = 'operator'; w.userData.module = 'operator'; w.userData.noBom = '人員示意（不採購）';
  const cloth = std(0x2f5f8f, .8, 0), skin = std(0xd9b08c, .7, 0), helmet = MAT.yellow, dark = std(0x30343a, .8, 0);
  for (const x of [-70, 70]) block(w, [110, 820, 140], [x, 410, 0], dark);
  block(w, [360, 580, 220], [0, 1110, 0], cloth);
  block(w, [380, 40, 230], [0, 900, 0], std(0xe8c33a, .6, 0));                     // 反光背心下緣
  for (const x of [-215, 215]) block(w, [80, 560, 100], [x, 1110, 60], cloth);
  cylinder(w, 60, 70, [0, 1435, 0], skin, 'y', 12);
  const head = new THREE.Mesh(new THREE.SphereGeometry(105, 16, 12), skin); head.position.set(0, 1560, 0); w.add(head);
  const hat = new THREE.Mesh(new THREE.SphereGeometry(118, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet); hat.position.set(0, 1585, 0); w.add(hat);
  w.position.copy(pos); w.rotation.y = rotY; w.visible = false; scene.add(w);
  return w;
}

// c1／c2／nl：焊道排版（環縫高度、縱縫條數；見 spec.js seamLayout，超出範圍會夾回）；handoff：雙工位第 2 線的接手點（spec.js DUAL.handoffs）
export function createProject({ scene, plan: planKey = 'roll', c1, c2, nl, handoff }) {
  const meta = PLANS[planKey] || PLANS.roll;
  const layout = seamLayout({ c1, c2, nl }, meta.arm), SEAMS = makeSeams(layout, meta.arm);
  const plan = buildPlan(meta.key, scene);
  const cellPlans = plan.cells || [plan], dual = cellPlans.length > 1;
  const handoffKey = dual && DUAL.handoffs[handoff] ? handoff : dual ? DUAL.handoff : 'all';
  const tl = createTimeline();

  // ---------------------------------------------------------------- 工具（一組，所有工位共用）
  const toolsObj = createTools(), toolGroup = new THREE.Group(); toolGroup.name = 'tools'; toolGroup.userData.module = 'tools'; scene.add(toolGroup);
  for (const t of Object.values(toolsObj)) toolGroup.add(t.root);

  // ---------------------------------------------------------------- 工位：桶、手臂與載具、時間軌
  function makeCell(cp, k) {
    const pf = k ? `L${k + 1}:` : '';
    const tank = createTank({ circStart: CIRC_START, seams: SEAMS, craneLugs: cp.key === 'turntable' });
    tank.frame.userData.module = 'tank'; scene.add(tank.frame);
    tank.frame.position.copy(cp.frameW.pos); tank.frame.quaternion.copy(cp.frameW.quat);
    if (k) tank.frame.name = 'tank-' + (k + 1);
    const W = createWelderArm(meta.arm, cp.psi);
    const carrier = new THREE.Group(); carrier.name = 'carrier'; carrier.userData.module = 'robot'; carrier.add(W.yaw);
    const sOut = TANK.manway.top + W.stowLen + 60;                 // 伸直的手臂整支在人孔法蘭上方 60 mm
    const sMid = W.stowLen - 40;                                   // 伸直時工具尖端離下封頭最低點約 150 mm，在這裡展開
    const ctx = { tools: TOOLS, sOut };
    cp.build(carrier, ctx);
    // 取放工具姿態：結合面對準格位（工具 +Z 朝下）；lift＝'arm' 時由手臂抬起、'carrier' 時由載具升起（RP.up mm，高過相鄰工具）
    const RP = cp.rackPose;
    const rack = W.solve([RP.r, RP.d, 0], RP.Z, RP.X, [W.poses.tuck.pose, W.poses.weldC.pose, { j1: 0, j2: 30, j3: 10, j4: 0, j5: 60, j6: 0 }, { j1: 0, j2: -20, j3: 60, j4: 0, j5: 40, j6: 0 }], W.cplg);
    const rackUp = RP.lift === 'arm' ? W.solve([RP.r - RP.up * RP.Z[0], RP.d - RP.up * RP.Z[1], 0], RP.Z, RP.X, [rack.pose, { ...rack.pose, j2: rack.pose.j2 - 30, j3: rack.pose.j3 + 40 }, { ...rack.pose, j2: rack.pose.j2 - 50, j3: rack.pose.j3 + 70 }, W.poses.tuck.pose], W.cplg) : rack;
    rackUp.pose = W.near(rackUp.pose, rack.pose);
    addArmServices(W.arm, meta.key === 'cobot');
    const updateExtraction = addExtraction(scene, cp, dual && k === 1 ? 1 : -1);
    // 人員站在人孔旁（A 案：人孔朝 −X，人員在桶外側；B／C：人孔朝上，人員在轉台／門架旁）
    const wpos = cp.key === 'roll' ? new THREE.Vector3(-1150, 0, cp.frameW.pos.z + 1250) : cp.key === 'turntable' ? new THREE.Vector3(1300, 0, 1250) : new THREE.Vector3(-1300, 0, 1600);
    const worker = makeWorker(scene, wpos, cp.key === 'roll' ? -Math.PI / 2 : -Math.PI * .75);
    const T = {
      load: tl.track(pf + 'load', { k: 1, open: 1, clamp: 0 }),
      carrier: tl.track(pf + 'carrier', { s: sOut, lat: ctx.slots[0].lat }),
      arm: tl.track(pf + 'arm', { ...STOW }),
      spin: tl.track(pf + 'spin', { phi: 0 }),
      tool: tl.track(pf + 'tool', { held: '', fx: 0, mode: 0, cut: 0, ng: 0 }),
      repair: tl.track(pf + 'repair', { r: 0, c: 0 }),             // 兆赫波 NG 處人工補修（r）與自動複檢（c）進度
      alarm: tl.track(pf + 'alarm', { a: 0 }),                     // 1＝NG 停機、通知人員
      op: tl.track(pf + 'op', { v: 0 }),                           // 人員在場（示意）
    };
    for (const s of SEAMS) T[s.id] = tl.track(pf + 'seam-' + s.id, { ...Object.fromEntries(Object.values(FIELD).map(f => [f, 0])), v: 0 });
    return { k, pf, cp, tank, W, arm: W, carrier, sOut, sMid, slots: ctx.slots, RP, poses: { ...W.poses, rack, rackUp }, T, worker, updateExtraction, t: 0, station: 0, home: { s: sOut, lat: ctx.slots[0].lat } };
  }
  const cells = cellPlans.map(makeCell);
  const C0 = cells[0];
  const updatePeriphery = addPeripheryDetails(scene, plan.periphery, meta.key, dual ? { fenceZ: -DUAL.lineZ - 2100 } : {});

  // ---------------------------------------------------------------- 工具架（共用）：格位以第 1 工位的取放姿態決定；雙工位時工具架在穿梭座上（rackRoot 會沿 Z 移動）
  plan.setShuttle?.(0);
  const slotLocal = {}, slotGroup = {}, feet = [];
  TOOLS.forEach((t, i) => {
    C0.cp.setCarrier(C0.slots[i].s, C0.slots[i].lat); C0.W.set(C0.poses.rack.pose); scene.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(plan.rackRoot.matrixWorld).invert().multiply(C0.W.cplg.matrixWorld); slotLocal[t.key] = m;
    const sg = rackSlot(plan.rackRoot, t.key); m.decompose(sg.position, sg.quaternion, sg.scale); slotGroup[t.key] = sg;
    sg.updateMatrixWorld(true); feet.push(new THREE.Vector3(-68, -138, RACK_DEPTH).applyMatrix4(sg.matrixWorld));
  });
  // 工具架層板與腳（層板頂面＝吊柱底板底面）；雙工位時腳站在穿梭座上，地面有兩支 Z 向軌道
  {
    const bb = new THREE.Box3().setFromPoints(feet).expandByVector(new THREE.Vector3(140, 0, 140)), top = bb.min.y, y0 = plan.rackFloor ?? 0;
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()), W = Math.max(sz.x, 200), Dz = Math.max(sz.z, 200);
    block(plan.rackRoot, [W, 30, Dz], [c.x, top - 15, c.z], MAT.steelBlue).name = 'rack-shelf';
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) block(plan.rackRoot, [50, top - 30 - y0, 50], [c.x + sx * (W / 2 - 40), (top - 30 + y0) / 2, c.z + sz2 * (Dz / 2 - 40)], MAT.steelBlue).name = 'rack-leg';
    if (plan.shuttle) {
      block(plan.rackRoot, [W + 40, 50, Dz + 40], [c.x, y0 - 25, c.z], MAT.steelDark).name = 'shuttle-base';
      for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) block(plan.rackRoot, [80, 18, 70], [c.x + sx * (W / 2 - 60), 30, c.z + sz2 * (Dz / 2 - 40)], MAT.steel).name = 'shuttle-bogie';
      const rails = new THREE.Group(); rails.name = 'shuttle-rail'; rails.userData.module = 'shuttle-rail'; scene.add(rails);
      const z0 = c.z - Dz / 2 - 200, z1 = c.z + plan.shuttle.travel + Dz / 2 + 200;
      for (const sx of [-1, 1]) block(rails, [50, 20, z1 - z0], [c.x + sx * (W / 2 - 60), 10, (z0 + z1) / 2], MAT.steelDark).name = 'shuttle-rail';
      block(rails, [260, 220, 260], [c.x + W / 2 + 230, 110, z0 + 200], MAT.steelDark).name = 'shuttle-drive';
    }
  }

  // ---------------------------------------------------------------- 排程（資源互鎖）
  const res = new Map();                                  // 資源名稱 → { holder, freeAt }
  const shuttle = plan.shuttle ? tl.track('shuttle', { z: 0 }) : null;
  const acq = name => ({ op: 'acq', name });
  const rel = (cell, name) => { const R = res.get(name); if (R?.holder === cell) { R.holder = null; R.freeAt = cell.t; } };

  function program(cell) {
    const { T, W, cp, RP, poses, slots, sOut, sMid, k } = cell;
    const go = (track, dur, vals, o = {}) => { const st = track.add(dur, vals, { at: cell.t, ...o }); cell.t = st.start + st.dur; return st; };
    const with_ = (track, dur, vals, o = {}) => track.add(dur, vals, { at: o.at ?? cell.t - dur, ...o });     // 與上一個步驟同時（同一段時間）
    const A = (text, sub = '') => ({ action: dual ? `第 ${k + 1} 線｜${text}` : text, sub, station: cell.station });
    cell.A = A;
    const pose = p => ({ ...p });
    const nearAngle = (target, cur) => target + 2 * Math.PI * Math.round((cur - target) / (2 * Math.PI));
    const j1Base = poses.weldC.pose.j1;

    // ---- 載具移動（B／C：橫移在高處做；A：只有軸向）
    const moveCarrier = (to, text, dur) => {
      const cur = T.carrier.state;
      if (Math.abs(cur.lat - to.lat) > 1) {
        const up = Math.max(cur.s, to.s, sOut);
        if (cur.s < up - 1) go(T.carrier, Math.max(.8, (up - cur.s) / 1200), { s: up }, A(text, '先升到人孔上方'));
        go(T.carrier, Math.max(1, Math.abs(cur.lat - to.lat) / 900), { lat: to.lat }, A(text));
        if (Math.abs(up - to.s) > 1) go(T.carrier, Math.max(.8, Math.abs(up - to.s) / 1200), { s: to.s }, A(text));
      } else if (Math.abs(cur.s - to.s) > .5) go(T.carrier, dur ?? Math.max(.8, Math.abs(cur.s - to.s) / 900), { s: to.s }, A(text));
    };
    // 取／還工具（手臂在 rackUp 姿態、載具到格位）
    // A 案（手臂抬起）：先以目前姿態（夾著工具時是伸直、工具高過工具架）移到格位上方，再轉到取放姿態，不讓吊著的工具掃過相鄰工具
    const atSlot = (i, text) => {
      const sl = slots[i], up = RP.lift === 'carrier' ? sl.s + RP.up : sl.s;
      const toRack = () => { if (T.arm.state.j3 !== poses.rackUp.pose.j3 || T.arm.state.j2 !== poses.rackUp.pose.j2) go(T.arm, 1.4, pose(poses.rackUp.pose), A(text, '手臂轉到取放姿態')); };
      if (RP.lift === 'arm') { moveCarrier({ s: up, lat: sl.lat }, text); toRack(); }
      else { toRack(); moveCarrier({ s: up, lat: sl.lat }, text); }
      if (RP.lift === 'carrier') go(T.carrier, DEMO.change * .6, { s: sl.s }, A(text, '下降到格位'));
      else go(T.arm, DEMO.change * .6, pose(poses.rack.pose), A(text, '下降到格位'));
    };
    const leaveSlot = (text) => {
      if (RP.lift === 'carrier') go(T.carrier, DEMO.change * .6, { s: T.carrier.state.s + RP.up }, A(text, '上升離開托叉'));
      else go(T.arm, DEMO.change * .6, pose(poses.rackUp.pose), A(text, '上升離開托叉'));
    };
    const lock = (key, text) => { go(T.tool, .5, { held: key }, A(text, key ? '快換盤鎖定' : '快換盤釋放')); };
    const shuttleHere = () => {
      if (!shuttle) return;
      const z = plan.shuttle.z[k];
      if (Math.abs(shuttle.state.z - z) > .5) { const st = shuttle.add(1.6, { z }, { at: cell.t, ...A(`穿梭工具架移到第 ${k + 1} 線`, '工具架互鎖：一次只服務一線') }); cell.t = st.start + st.dur; }
    };

    // ---- 一道焊道走一趟（u0～u1 為焊道參數範圍，局部複檢、續焊只走一段）：定位 → 下刀 → 加工 → 退刀
    // prog：要推進的進度（track、field、to＝結束值，預設 u1）；mode：工具模式（開槽 1＝回程吸屑）
    const seamPass = (S, { u0 = 0, u1 = 1, label, sub, dur, prog, mode = 0, keepOn = false }) => {
      const circ = S.kind === 'circ', yAt = u => S.y0 + 16 + (S.y1 - S.y0 - 32) * u;
      const sStart = circ ? S.y + W.d : yAt(u0) + W.d, sEnd = circ ? sStart : yAt(u1) + W.d;
      const theta0 = circ ? CIRC_START + 2 * Math.PI * u0 : S.theta;          // 起點方位
      const tuckAt = { ...poses.tuck.pose }, weldAt = { ...(circ ? poses.weldC.pose : poses.weldL.pose) };
      let phi0 = T.spin.state.phi, j10 = j1Base;
      if (meta.spin === 'tank') {
        phi0 = nearAngle(theta0 - cp.psi, T.spin.state.phi);
        go(T.carrier, .9, { s: sStart }, A(`${label}：定位`, circ ? '載具到環縫高度' : '載具到縱縫起點'));
        if (Math.abs(phi0 - T.spin.state.phi) > 1e-3) with_(T.spin, .9, { phi: phi0 });
      } else {
        // C：J1 相對焊接姿態的偏移（整圈環縫從 −180° 走到 +180°；縱縫取 ±180° 內）
        const off = circ ? -180 + 360 * u0 : Math.atan2(Math.sin(theta0 - cp.psi), Math.cos(theta0 - cp.psi)) * D;
        j10 = j1Base + off; tuckAt.j1 = j10; weldAt.j1 = j10;
        go(T.carrier, .9, { s: sStart }, A(`${label}：定位`, circ ? '載具到環縫高度' : '載具到縱縫起點'));
        with_(T.arm, .9, pose(tuckAt));
      }
      go(T.arm, DEMO.approach, pose(weldAt), A(`${label}：下刀`, '工具貼上焊道'));
      go(T.tool, 0, { fx: 1, mode });
      if (circ) {
        if (meta.spin === 'tank') go(T.spin, dur, { phi: phi0 + 2 * Math.PI * (u1 - u0) }, { ...A(label, sub), ease: linear });
        else go(T.arm, dur, { j1: j10 + 360 * (u1 - u0) }, { ...A(label, sub + '｜J1 繞桶軸'), ease: linear });
      } else go(T.carrier, dur, { s: sEnd }, { ...A(label, sub), ease: linear });
      with_(prog.track, dur, { [prog.field]: prog.to ?? u1 }, { ease: linear });
      if (keepOn) return;                                                      // 停在焊道上（NG 處理接著做）
      go(T.tool, 0, { fx: 0, mode: 0 });
      go(T.arm, DEMO.approach * .8, pose({ ...tuckAt, j1: T.arm.state.j1 }), A(`${label}：退刀`));
      if (meta.spin === 'j1') go(T.arm, .6, { j1: j1Base }, A(`${label}：退刀`, 'J1 回正'));
    };
    const enter = () => {
      moveCarrier({ s: sOut, lat: 0 }, '移到人孔上方');
      go(T.carrier, DEMO.enter, { s: sMid }, A('從人孔伸入桶內', '伸直狀態沿桶軸進入'));
      go(T.arm, DEMO.approach * 1.3, pose(poses.tuck.pose), A('在桶內展開到退刀姿態'));
    };
    const exit = () => {
      go(T.carrier, .9, { s: sMid }, A('回到展開位置'));
      go(T.arm, DEMO.approach * 1.3, pose(STOW), A('手臂伸直'));
      go(T.carrier, DEMO.enter, { s: sOut }, A('從人孔退出'));
    };
    // ---- 取工具 → 依序執行 segs（{ in } 在桶內、{ out } 在桶外；切換時自動進出人孔）→ 還工具
    function* visit(toolKey, segs) {
      const i = TOOLS.findIndex(x => x.key === toolKey), tname = TOOLS[i].name;
      yield acq('tool:' + toolKey); yield acq('rack');
      shuttleHere(); atSlot(i, `取${tname}`); lock(toolKey, `取${tname}`); leaveSlot(`取${tname}`);
      go(T.arm, 1.4, pose(STOW), A('手臂伸直（穿人孔姿態）', `人孔襯裡後內徑 ${Math.round(NECK_CLEAR * 2)} mm`));
      moveCarrier({ s: sOut, lat: 0 }, '移到人孔上方');
      rel(cell, 'rack');
      let inside = false;
      for (const sg of segs) {
        if (sg.in) { if (!inside) enter(); sg.in(); inside = true; }
        else { if (inside) exit(); sg.out(); inside = false; }
      }
      if (inside) exit();
      yield acq('rack');
      shuttleHere(); atSlot(i, `放回${tname}`); lock('', `放回${tname}`); leaveSlot(`放回${tname}`);
      if (dual) moveCarrier(cell.home, '回到人孔前待命', 1.2);           // 讓出工具架給另一線
      rel(cell, 'rack'); rel(cell, 'tool:' + toolKey);
    }

    // ---- 工序 4：UV 線雷射判 NG → 停焊、切斷焊條、退出、通知人員 → 人員刨除不良段 → 復歸後從斷點續焊（模擬只在第 1 工位）
    const rodNG = k === 0 && SEAMS.find(s => s.id === ROD_NG.seam);
    const ngDeg = Math.round(ROD_NG.u * 360), cutU = ROD_NG.cut / (rodNG ? seamLength(rodNG) : 1);
    function rodSegments(P, list, label) {
      const pass = (S, o) => seamPass(S, { label: `${label}：${S.name}`, sub: o.sub ?? P.note, dur: o.dur, u0: o.u0, u1: o.u1, prog: { track: T[S.id], field: FIELD[P.key] }, keepOn: o.keepOn });
      const dur = S => (S.kind === 'circ' ? DEMO.circ : DEMO.long) * (P.demo ?? 1);
      if (!rodNG || !list.includes(rodNG)) return [{ in: () => list.forEach(S => pass(S, { dur: dur(S) })) }];
      const before = list.slice(0, list.indexOf(rodNG)), after = list.slice(list.indexOf(rodNG) + 1), S = rodNG;
      return [
        { in: () => {
          before.forEach(s => pass(s, { dur: dur(s) }));
          pass(S, { u1: ROD_NG.u, dur: dur(S) * ROD_NG.u, keepOn: true });
          go(T.tool, 1.2, { ng: 1 }, A(`UV 線雷射判 NG：${S.name} ${ngDeg}°`, `${ROD_NG.reason}：焊道寬度 6.2 mm（允收 ${ROD_WELD.window.width.join('～')} mm）→ 停止送料與行走`));
          go(T.tool, .8, { cut: 1, fx: 0 }, A('切斷焊條', '導管出口的氣動切刀切斷 PFA 焊條；熱風轉待機風量（不斷氣）'));
          go(T.alarm, 0, { a: 1 });
          go(T.arm, DEMO.approach * .8, pose(poses.tuck.pose), A('抬起退刀', '拖嘴離開焊道，焊條斷開不拖拉'));
        } },
        { out: () => {
          moveCarrier(cp.key === 'roll' ? { s: sOut + 700, lat: 0 } : { s: sOut, lat: slots[0].lat }, '退開，讓出人孔');
          go(T.alarm, 1.4, { a: 1 }, A('通知人員接手', `三色燈紅燈＋蜂鳴；HMI 與手機推播：工序 4／${S.name} ${ngDeg}°／UV 輪廓與影像`));
          go(T.op, .6, { v: 1 }, A('人員到位', '按暫停確認；桶停在 NG 位置'));
          go(T[S.id], 3.6, { r: ROD_NG.u - cutU }, A('人員處理', `刨除不良焊條約 ${ROD_NG.cut} mm、清理 V 槽；檢查焊條送料、熱風溫度與 ${ROD_WELD.press} kgf 下壓`));
          go(T.op, .6, { v: 0 }, A('人員離開', '退出光柵區'));
          go(T.tool, .9, { cut: 0, ng: 0 }, A('復歸', '重新穿入焊條、熱風回到設定值，人員按復歸'));
          go(T.alarm, 0, { a: 0 });
        } },
        { in: () => {
          pass(S, { u0: ROD_NG.u - cutU, dur: dur(S) * (1 - ROD_NG.u + cutU), sub: '從刨除處接續，起點與舊焊道重疊、熔平接頭' });
          after.forEach(s => pass(s, { dur: dur(s) }));
        } },
      ];
    }

    // ---- 第 2 線接手：人員已在線外做完前段工序（自動線接手前一律先相機定位）
    const from = k > 0 && handoffKey !== 'all' ? PROCESS.findIndex(p => p.key === handoffKey) : 0;
    const steps = PROCESS.filter((p, i) => i === 0 || i >= from);

    return (function* () {
      // ---- S1 上料定位
      cell.station = 0;
      if (from > 0) {
        const done = Object.fromEntries(PROCESS.slice(1, from).map(p => [FIELD[p.key], 1]));
        for (const S of SEAMS) T[S.id].add(0, { ...done, ...(done.g ? { v: 1 } : {}) }, { at: 0 });
        go(T.tool, .01, {}, A(`接手：${DUAL.handoffs[handoffKey]}`, '人員做完的前段工序不佔自動線；接手前先相機重新定位焊道'));
      }
      if (cp.key === 'roll') {
        go(T.load, 4, { k: 0 }, A('天車吊入桶（臥放），放進迴轉架下半環', '吊帶兩處、桶軸對準迴轉中心'));
        go(T.load, 1.6, { open: 0 }, A('上半環閉合', '開合式雙環，鉸鏈在側邊'));
        go(T.load, 1.2, { clamp: 1 }, A('夾緊螺桿夾住直筒', '每環 4 支，橡膠夾墊'));
      } else if (cp.key === 'turntable') {
        go(T.load, 4, { k: 0, open: 0 }, A('天車吊入桶（立放），桶腳落入轉台定位塊', '吊耳兩處'));
        go(T.load, 1, { clamp: 1 }, A('定位塊夾緊桶腳', '桶軸對準轉台中心'));
      } else {
        go(T.load, 4.5, { k: 0, open: 0 }, A('移動門架推到桶上方', '桶留在原地；門架橫跨桶身'));
        go(T.load, 1, { clamp: 1 }, A('定位腳下降、腳輪離地', '以人孔法蘭為基準對心（雷射十字）'));
      }

      // ---- 每道製程：全部焊道各走一趟
      for (const P of steps) {
        cell.station = PROCESS.indexOf(P) + 1;
        const label = P.name, dur = S => (S.kind === 'circ' ? DEMO.circ : DEMO.long) * (P.demo ?? 1);
        const passOf = (S, o = {}) => { const len = seamLength(S) / 1000, min = len / P.speed; return seamPass(S, { label: `${label}：${S.name}`, sub: `${P.note}｜實際 ${len.toFixed(2)} m、約 ${min.toFixed(1)} 分`, dur: dur(S), prog: { track: T[S.id], field: FIELD[P.key] }, ...o }); };
        let segs;
        if (P.key === 'groove') segs = [{ in: () => SEAMS.forEach(S => {
          passOf(S);
          seamPass(S, { label: `回程吸屑：${S.name}`, sub: '主軸停止，吸屑罩貼面回程，吸除 V 槽內殘屑；罩內吹氣把屑吹向吸口', dur: dur(S) * .45, prog: { track: T[S.id], field: 'v' }, mode: 1 });
        }) }];
        else if (P.key === 'rod') segs = rodSegments(P, SEAMS, label);
        else segs = [{ in: () => SEAMS.forEach(S => passOf(S)) }];
        if (P.key === 'scan') segs.push({ out: () => go(T.tool, DEMO.plan, {}, A('軌跡規劃', '由點雲算出各焊道的中心線與板邊高低差，產生各工具的軌跡（姿態、拖嘴角度、壓輪位置）；焊道上的藍線是規劃結果')) });
        yield* visit(P.tool, segs);
      }

      // ---- 兆赫波判定 NG → 通知人員人工補修 → 自動複檢（模擬：第 1 工位上環縫一處氣孔）
      cell.station = PROCESS.length + 1;
      if (k === 0) {
        const DS = SEAMS.find(s => s.id === THZ.defect.seam), du = THZ.defect.u, half = THZ.repairHalf / seamLength(DS);
        go(T.alarm, 0, { a: 1 });
        go(T.tool, 1.6, {}, A(`兆赫波判定 NG：${DS.name}一處多一道回波`, `位置約 ${Math.round(du * 360)}°（自起點）；回波落在焊條熔接層內、相位反轉 → 判定氣孔；其餘焊道 OK`));
        go(T.alarm, 1.2, { a: 1 }, A('通知人員接手', 'HMI 與手機推播：位置、A-scan／B-scan；手臂在工具架旁待命，人孔讓給人員'));
        go(T.op, .6, { v: 1 }, A('人員到位'));
        go(T.repair, 4.2, { r: 1 }, A('人員補修（缺陷前後各 60 mm）', '刨除缺陷段 → 手持熱風槍補焊條 → 削平 → 補焊帶；焊帶槍無法蓋住焊條層內的氣孔，所以要刨除重做'));
        go(T.op, .6, { v: 0 }, A('人員離開，按復歸'));
        go(T.alarm, 0, { a: 0 });
        yield* visit('thz', [
          { in: () => seamPass(DS, { u0: du - half, u1: du + half, label: `自動複檢：${DS.name}補修段`, sub: '兆赫波重新掃描補修段：多餘回波消失、覆蓋厚度在規格內 → OK', dur: 2.2, prog: { track: T.repair, field: 'c', to: 1 } }) },
          { out: () => go(T.tool, 1.5, {}, A('複檢 OK：全部焊道通過', '檢測紀錄（波形、B-scan、位置、補修紀錄）存檔，隨桶出貨')) },
        ]);
      }

      // ---- 卸料
      cell.station = STATIONS.length - 1;
      go(T.arm, 1.4, pose(STOW), A('手臂伸直回原點'));
      moveCarrier(cell.home, '載具回原點');
      if (meta.spin === 'tank') { const back = nearAngle(0, T.spin.state.phi); if (Math.abs(back - T.spin.state.phi) > 1e-3) go(T.spin, 1.5, { phi: back }, A('桶轉回上料角度')); }
      if (cp.key === 'roll') {
        go(T.load, 1, { clamp: 0 }, A('夾緊螺桿鬆開'));
        go(T.load, 1.4, { open: 1 }, A('上半環張開'));
        go(T.load, 3.5, { k: 1 }, A('天車吊出，送下一站（耐壓、火花測試）'));
      } else if (cp.key === 'turntable') {
        go(T.load, .8, { clamp: 0 }, A('定位塊鬆開'));
        go(T.load, 3.5, { k: 1, open: 1 }, A('天車吊出，送下一站（耐壓、火花測試）'));
      } else {
        go(T.load, .8, { clamp: 0 }, A('定位腳收起'));
        go(T.load, 4, { k: 1, open: 1 }, A('門架推往下一個桶'));
      }
    })();
  }

  // 執行排程：每次推進時間最早、可以動的那一線；要的資源被另一線拿著就等它放開（等待時間標在事件列）
  {
    const runs = cells.map(cell => ({ cell, gen: program(cell), want: null, done: false }));
    const blocked = r => r.want && res.get(r.want.name)?.holder && res.get(r.want.name).holder !== r.cell;
    for (let guard = 0; guard < 100000; guard++) {
      const live = runs.filter(r => !r.done);
      if (!live.length) break;
      const ready = live.filter(r => !blocked(r));
      if (!ready.length) throw new Error('排程死結：' + live.map(r => r.want?.name).join('、'));
      const r = ready.reduce((a, b) => (b.cell.t < a.cell.t ? b : a));
      if (r.want) {
        const R = res.get(r.want.name) ?? { holder: null, freeAt: 0 }; res.set(r.want.name, R);
        const t0 = r.cell.t, t1 = Math.max(t0, R.freeAt);
        if (t1 > t0 + 1e-6) { const st = r.cell.T.tool.add(t1 - t0, {}, { at: t0, ...r.cell.A(`等待${RES_NAME(r.want.name)}`, '另一線使用中（互鎖）') }); r.cell.t = st.start + st.dur; }
        R.holder = r.cell; r.want = null;
      }
      const n = r.gen.next();
      if (n.done) r.done = true; else r.want = n.value;
    }
  }

  // 小零件（外接球半徑 < 120 mm：螺栓、接頭、感測器、管夾）不投影：陰影貼圖每個投影網格多一次 draw call，手機幀率吃不消
  scene.updateMatrixWorld(true);
  const ws = new THREE.Vector3();
  scene.traverse(m => {
    if (!m.isMesh || !m.castShadow || !m.geometry) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    if (m.geometry.boundingSphere.radius * m.getWorldScale(ws).x < 120) m.castShadow = false;
  });
  // 周邊、護網、抽氣與管線（含手臂上的管束）不投影：畫面上陰影幾乎看不到，卻佔掉手機約兩成幀率
  scene.traverse(m => {
    if (!m.isMesh) return;
    let quiet = !!m.userData.routingHardware;
    for (let q = m; q && !quiet; q = q.parent) quiet = ['periphery', 'safety', 'extraction', 'operator', 'shuttle-rail'].includes(q.userData.module) || !!q.userData.routingHardware;
    if (quiet) m.castShadow = false;
  });

  const total = tl.total;
  const stationStart = STATIONS.map((_, k) => { const s = tl.events.filter(e => e.station === k && e.track.indexOf(':') < 0).map(e => e.start); return s.length ? Math.min(...s) : 0; });
  const DS = SEAMS.find(s => s.id === THZ.defect.seam), du = THZ.defect.u, half = THZ.repairHalf / seamLength(DS);

  // ---------------------------------------------------------------- 套用時間 t
  // 顯示方式：'xray' 透視（預設，完整的桶半透明）、'cut' 剖切（同切半展示品，僅示意）、'solid' 不透明
  let cutOn = false;
  const cutWorld = new THREE.Plane();
  const travelOf = (st, cell, field) => SEAMS.reduce((sum, seam) => sum + st[cell.pf + 'seam-' + seam.id][field] * seamLength(seam) / 1000, 0);
  function apply(time) {
    const st = tl.sample(time);
    for (const cell of cells) {
      const s = n => st[cell.pf + n];
      cell.cp.setLoad(s('load'), cell.tank);
      cell.cp.setSpin(s('spin').phi, cell.tank);
      cell.cp.setCarrier(s('carrier').s, s('carrier').lat);
      cell.W.set(s('arm'));
      for (const seam of SEAMS) cell.tank.setSeam(seam.id, s('seam-' + seam.id), s('tool'));
      cell.tank.setRepair(s('repair'), cell.k === 0 && s('seam-' + DS.id).i >= du);
      cell.worker.visible = s('op').v > .5;
      cell.updateExtraction(s('load').k);
    }
    if (shuttle) plan.setShuttle(st.shuttle.z);
    updatePeriphery(hmiState(st));
    scene.updateMatrixWorld(true);
    for (const [key, tool] of Object.entries(toolsObj)) {
      const holder = cells.find(c => st[c.pf + 'tool'].held === key), ts = holder && st[holder.pf + 'tool'];
      const m = holder ? holder.W.cplg.matrixWorld : slotGroup[key].matrixWorld;   // 放在格位上：直接用格位的世界矩陣（工具架穿梭時跟著走）
      m.decompose(tool.root.position, tool.root.quaternion, tool.root.scale);
      const field = FIELD[key === 'cam' ? 'scan' : key];
      const travel = cells.reduce((a, c) => a + travelOf(st, c, field) + (key === 'groove' ? travelOf(st, c, 'v') : 0), 0);
      tool.set(!!ts && ts.fx > .5, travel, { mode: ts?.mode ?? 0, cut: (ts?.cut ?? 0) > .5, ng: (ts?.ng ?? 0) > .5 });
    }
    if (cutOn) for (const cell of cells) { cutWorld.copy(cell.cp.cut).applyMatrix4(cell.tank.frame.matrixWorld); cell.tank.setCut(true, cutWorld); }
    else for (const cell of cells) cell.tank.setCut(false);
    return st;
  }
  // 電控櫃 HMI 與三色燈：任一線 NG 停機時紅燈
  function hmiState(st) {
    const alarm = cells.find(c => st[c.pf + 'alarm'].a > .5), busy = cells.some(c => st[c.pf + 'tool'].fx > .5);
    const q = v => Math.floor(v * 10) * 10;                    // 10% 一階：HMI 貼圖不必每格重畫上傳
    const ids = dual ? ['C2'] : ['L1', 'C1', 'C2'];
    const lines = cells.flatMap(c => ids.map(id => SEAMS.find(S => S.id === id)).map(S => { const s = st[c.pf + 'seam-' + S.id]; return `${dual ? `L${c.k + 1} ` : ''}${S.id}  V ${q(s.g)}%   PFA ${q(s.b)}%   THz ${q(s.i)}%`; }));
    const head = alarm ? `NG 停機：第 ${alarm.k + 1} 線，請人員接手` : busy ? '加工中・抽氣運轉' : '定位／換工具';
    return { alarm: !!alarm, busy, text: ['襯裡焊接 / 製程示意', head, ...lines, st['seam-' + DS.id].i >= du ? `${DS.id} 疑似氣孔：模擬標記` : 'THz：示意結果'] };
  }
  function setCut(on) { cutOn = on; }
  function setLook(mode) { cutOn = mode === 'cut'; for (const cell of cells) cell.tank.setGhost(mode === 'xray'); }

  // 兆赫波畫面用的狀態（第 1 工位）：正在掃描的焊道與位置（全線掃描或複檢）、缺陷是否已掃到、補修與複檢進度
  function thzAt(time) {
    const st = tl.sample(time), scanning = st.tool.held === 'thz' && st.tool.fx > .5, T = C0.T;
    let seam = null, u = 0, recheck = false;
    if (scanning) {
      for (const S of SEAMS) { const a = T[S.id].active(time); if (a && a.end.i === 1 && a.initial.i < 1) { seam = S; u = st['seam-' + S.id].i; } }
      const rc = T.repair.active(time); if (rc && rc.end.c === 1 && rc.initial.c < 1) { seam = DS; u = du - half + 2 * half * st.repair.c; recheck = true; }
    }
    return { st, scanning, seam, u, recheck, found: st['seam-' + DS.id].i >= du, repair: st.repair.r, checked: st.repair.c, defect: { seam: DS, u: du, half } };
  }
  // 工序 4 即時監控（第 1 工位）：UV 線雷射量到的焊道寬度與高度（示意值，依時間決定）、下壓力、NG 狀態
  function rodMonitor(time) {
    const st = tl.sample(time), ts = st.tool, on = ts.held === 'rod' && (ts.fx > .5 || ts.ng > .5);
    if (!on && !(ts.held === 'rod' && ts.cut > .5)) return null;
    const q = Math.floor(time * 4) / 4;                         // 每 0.25 s 一筆（面板不必每格重排）
    const w = ts.ng > .5 ? 6.2 : 9.1 + .35 * Math.sin(q * 7.3) + .15 * Math.sin(q * 19.1), h = ts.ng > .5 ? 2.1 : 3.5 + .2 * Math.sin(q * 5.1);
    return { width: w, height: h, press: ts.fx > .5 ? ROD_WELD.pressN : 0, temp: ts.fx > .5 ? HOT_AIR.temp : 0, ng: ts.ng > .5, cut: ts.cut > .5 };
  }

  // 目前焊點（給鏡頭追隨）：第 1 工位的 TCP 世界位置
  const focus = () => C0.W.tcp.getWorldPosition(new THREE.Vector3());

  // ---------------------------------------------------------------- 配置檢核（第 1 工位；雙工位的兩線相同）
  function layoutChecks() {
    const rows = [], fmt = v => (Math.round(v * 10) / 10).toString(), W = C0.W, poses = C0.poses;
    for (const [k, name] of [['weldC', '環縫焊接'], ['weldL', '縱縫焊接'], ['tuck', '退刀'], ['rack', '工具架取放'], ['rackUp', '取放上升']]) {
      const p = poses[k];
      rows.push({ group: '手臂姿態', name: `${name}姿態 IK 收斂`, ok: p.err < .5 && p.ang < .5, value: `${fmt(p.err)} mm／${fmt(p.ang)}°` });
    }
    // 穿過人孔：伸直姿態下手臂＋工具（全部工具）的最大半徑
    const save = { ...C0.T.arm.base };
    W.set(STOW); C0.cp.setCarrier(C0.sOut, 0); scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(W.root.matrixWorld).invert(), v = new THREE.Vector3();
    let rMax = 0;
    const scan = (o) => o.traverse(c => { if (!c.isMesh || c.userData.fx) return; let fx = false; for (let p = c; p; p = p.parent) if (p.userData.fx) fx = true; if (fx) return; const pos = c.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld).applyMatrix4(inv); rMax = Math.max(rMax, Math.hypot(v.x, v.z)); } });
    scan(W.root);
    let rTool = 0;
    for (const tool of Object.values(toolsObj)) {
      W.cplg.matrixWorld.decompose(tool.root.position, tool.root.quaternion, tool.root.scale); tool.root.updateMatrixWorld(true);
      const r0 = rMax; rMax = 0; scan(tool.root); rTool = Math.max(rTool, rMax); rMax = r0;
    }
    rows.push({ group: '人孔通過', name: `手臂伸直半徑 ≤ 人孔 ${fmt(NECK_CLEAR)} − 20`, ok: rMax <= NECK_CLEAR - 20, value: `${fmt(rMax)} mm` });
    rows.push({ group: '人孔通過', name: '工具最大半徑（伸直時）', ok: rTool <= NECK_CLEAR - 20, value: `${fmt(rTool)} mm` });
    rows.push({ group: '行程', name: '伸直進桶時工具尖端高於下封頭', ok: C0.sMid - W.stowLen > -175 + 100, value: `${fmt(C0.sMid - W.stowLen + 191)} mm` });
    if (meta.spin === 'j1') rows.push({ group: '手臂姿態', name: 'J1 繞 360° 在限位內', ok: poses.weldC.pose.j1 - 180 >= W.arm.limits.j1[0] && poses.weldC.pose.j1 + 180 <= W.arm.limits.j1[1], value: `${fmt(poses.weldC.pose.j1 - 180)}～${fmt(poses.weldC.pose.j1 + 180)}°` });
    W.set(save);
    return rows;
  }

  // 動力學檢查用的負載：快換盤（W.arm.tool 底下）＋這時候夾著的工具，整段每秒取一次、取最重的一刻（第 1 工位）
  function heaviestPayload() {
    let best = null;
    for (let t = 0; t <= total; t += 1) {
      apply(t);
      const held = tl.sample(t).tool.held;
      const p = combinePayloads(estimatePayload(C0.W.arm.tool), held && toolsObj[held] ? estimatePayload(toolsObj[held].root, { frame: C0.W.arm.tool }) : null);
      if (!best || p.mass > best.mass) best = { ...p, note: `${p.note}；最重時夾著 ${held || '無'}（t=${t} s）` };
    }
    return best;
  }

  return {
    total, timeline: tl, seams: SEAMS, layout, apply, thzAt, rodMonitor, stationStart, STATIONS, meta, plan, cells, dual, handoff: handoffKey,
    tank: C0.tank, arm: C0.W, tools: toolsObj, poses: C0.poses, slots: C0.slots, sOut: C0.sOut, sMid: C0.sMid, focus, setCut, setLook,
    layoutChecks,
    verify: {
      // 管線與線夾（cable() 的走線五金）不進全場干涉：數量多、全掛在會動的手臂上，會讓檢查慢到 CI 逾時；
      // 桶內與人孔頸的管線間隙由 tools/verify.mjs 逐頂點檢查（含手臂上的管束）
      skip: o => !!o.userData.routingHardware,
      moduleOf: m => { for (let p = m; p; p = p.parent) if (p.userData.module) return p.userData.module; return 'misc'; },
      allow: [
        { why: '工具貼著襯裡與焊道作業（壓靴、刀具、壓輪接觸面）；桶內間隙由 tools/verify.mjs 的頂點半徑檢查負責', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'tools' && mb === 'tank') || (mb === 'tools' && ma === 'tank'); } },
        { why: '桶是中空迴轉體，有向包圍盒包住整個內部；手臂、載具在桶內的間隙由 tools/verify.mjs 逐頂點檢查', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'tank') !== (mb === 'tank') && ['robot', 'boom', 'gantry', 'tools'].includes(ma === 'tank' ? mb : ma) && ['shell', 'liner', 'manway', 'manway-liner'].includes((ma === 'tank' ? a : b).name); } },
        { why: '工具掛在手臂快換盤上（只限兩側快換盤的結合面）', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return ((ma === 'tools' && mb === 'robot') || (mb === 'tools' && ma === 'robot')) && (a.name === 'tool-coupling' || b.name === 'tool-coupling') && (a.name === 'atc-body' || b.name === 'atc-body' || a.name === 'flange' || b.name === 'flange'); } },
        { why: '工具放在工具架托叉上', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'tools' && mb === 'tool-rack') || (mb === 'tools' && ma === 'tool-rack'); } },
        { why: '迴轉環在托輪上滾動（滾動接觸；半環的包圍盒很大，停在某些角度時會被當成穿插）', test: (a, b) => { const n = [a.name, b.name]; return n.includes('support-roller') && n.some(x => x === 'ring-upper' || x === 'ring-lower'); } },
        { why: '迴轉架夾墊、轉台定位塊夾住桶身／桶腳', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'positioner' && mb === 'tank') || (mb === 'positioner' && ma === 'tank'); } },
        { why: '吊帶掛在桶身／吊耳上', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'crane' && mb === 'tank') || (mb === 'crane' && ma === 'tank'); } },
      ],
      envelope: ['robot'],
      // 手臂動力學（core/verify/dynamics.mjs，只警告）：只有 VS-068 的方案有動力學參數（COBOTTA PRO 900 還沒有，略過）。
      // 手臂倒裝在桶內（基座 Rx(π)），重力換到基座座標。負載由 3D 模型估（core/robot/payload.js）：工具座上的快換盤與管線＋當時夾著的工具，
      // 每秒取一次、用整個週期最重的那一刻（保守）；有實際重量時在工具模型上標 userData.mass。焊接下壓 5 kgf 與管束拉力不在內。
      dynamics: meta.arm !== 'vs068' ? undefined : {
        arms: [{ name: 'VS-068', spec: 'denso-vs068', payload: heaviestPayload, step: 0.05,
          sample: t => { apply(t); return { ...C0.W.arm.q }; },
          gravity: t => { apply(t); C0.W.arm.root.updateWorldMatrix(true, false); return new THREE.Vector3(0, -9.81, 0).applyQuaternion(C0.W.arm.root.getWorldQuaternion(new THREE.Quaternion()).invert()).toArray(); } }],
      },
    },
  };
}
