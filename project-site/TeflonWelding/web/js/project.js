// 專案介面：網頁（main.js）與 core 統一檢查共用。網址參數 ?plan=roll|turntable|cobot 切換方案。
// 流程：上料定位 → 開 V 槽 → 焊條熔接 → 削平 → 焊帶熔接 → 兆赫波檢測 → 卸料；每道製程換一次工具，依序做縱縫、下環縫、上環縫。
// 手臂一律 J1 與桶軸同軸、從人孔伸入（伸直穿過人孔，進桶後展開到退刀姿態）；環縫由桶轉（A、B）或 J1 繞圈（C）完成，縱縫由載具沿桶軸移動完成。
import * as THREE from 'three';
import { createTimeline, linear } from '@core/anim/track.js';
import { TANK, NECK_CLEAR, SEAMS, PROCESS, TOOLS, PLANS, DEMO, LINER_R, seamLength } from './spec.js';
import { createTank, wallAt } from './tank.js';
import { createTools, rackSlot, RACK_DEPTH } from './tools.js';
import { createWelderArm, STOW } from './robot.js';
import { buildPlan } from './plans.js';
import { MAT } from '@core/geom/materials.js';
import { block } from '@core/geom/shapes.js';

export { PLANS };
export const STATIONS = ['上料定位', ...PROCESS.map(p => p.name), '卸料'];
const FIELD = { groove: 'g', rod: 'r', flat: 'f', belt: 'b', thz: 'i' };
const CIRC_START = Math.PI / 2;                     // 環縫起點（桶座標方位）：離縱縫 90°，不在 T 形接頭起焊
const D = 180 / Math.PI;

export function createProject({ scene, plan: planKey = 'roll' }) {
  const meta = PLANS[planKey] || PLANS.roll;
  const plan = buildPlan(meta.key, scene);

  // ---------------------------------------------------------------- 桶
  const tank = createTank({ circStart: CIRC_START });
  tank.frame.userData.module = 'tank'; scene.add(tank.frame);
  tank.frame.position.copy(plan.frameW.pos); tank.frame.quaternion.copy(plan.frameW.quat);

  // ---------------------------------------------------------------- 手臂與載具
  const W = createWelderArm(meta.arm, plan.psi);
  const carrier = new THREE.Group(); carrier.name = 'carrier'; carrier.userData.module = 'robot'; carrier.add(W.yaw);
  const sOut = TANK.manway.top + W.stowLen + 60;                 // 伸直的手臂整支在人孔法蘭上方 60 mm
  const sMid = W.stowLen - 40;                                   // 伸直時工具尖端離下封頭最低點約 150 mm，在這裡展開
  const ctx = { tools: TOOLS, sOut };
  plan.build(carrier, ctx);
  const slots = ctx.slots;

  // 取放工具姿態：結合面對準格位（工具 +Z 朝下）；lift＝'arm' 時由手臂抬起、'carrier' 時由載具升起（RP.up mm，高過相鄰工具）
  const RP = plan.rackPose, LIFT = RP.up;
  const rack = W.solve([RP.r, RP.d, 0], RP.Z, RP.X, [W.poses.tuck.pose, W.poses.weldC.pose, { j1: 0, j2: 30, j3: 10, j4: 0, j5: 60, j6: 0 }, { j1: 0, j2: -20, j3: 60, j4: 0, j5: 40, j6: 0 }], W.cplg);
  const rackUp = RP.lift === 'arm' ? W.solve([RP.r - LIFT * RP.Z[0], RP.d - LIFT * RP.Z[1], 0], RP.Z, RP.X, [rack.pose], W.cplg) : rack;
  rackUp.pose = W.near(rackUp.pose, rack.pose);
  const poses = { ...W.poses, rack, rackUp };

  // 工具架格位：載具到格位、手臂在取放姿態時結合面的世界位置
  const toolsObj = createTools(), toolGroup = new THREE.Group(); toolGroup.name = 'tools'; toolGroup.userData.module = 'tools'; scene.add(toolGroup);
  for (const t of Object.values(toolsObj)) toolGroup.add(t.root);
  const slotM = {}, feet = [];
  TOOLS.forEach((t, i) => {
    plan.setCarrier(slots[i].s, slots[i].lat); W.set(rack.pose); scene.updateMatrixWorld(true);
    const m = W.cplg.matrixWorld.clone(); slotM[t.key] = m;
    const sg = rackSlot(plan.rackRoot, t.key); m.decompose(sg.position, sg.quaternion, sg.scale);
    sg.updateMatrixWorld(true); feet.push(new THREE.Vector3(-68, -138, RACK_DEPTH).applyMatrix4(sg.matrixWorld));
  });
  // 工具架層板與腳（層板頂面＝吊柱底板底面）
  {
    const bb = new THREE.Box3().setFromPoints(feet).expandByVector(new THREE.Vector3(140, 0, 140)), top = bb.min.y;
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    block(plan.rackRoot, [Math.max(sz.x, 200), 30, Math.max(sz.z, 200)], [c.x, top - 15, c.z], MAT.steelBlue).name = 'rack-shelf';
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) block(plan.rackRoot, [50, top - 30, 50], [c.x + sx * (Math.max(sz.x, 200) / 2 - 40), (top - 30) / 2, c.z + sz2 * (Math.max(sz.z, 200) / 2 - 40)], MAT.steelBlue).name = 'rack-leg';
  }

  // ---------------------------------------------------------------- 時間軸
  const tl = createTimeline();
  const home = { s: sOut, lat: slots[0].lat };
  const T = {
    load: tl.track('load', { k: 1, open: 1, clamp: 0 }),
    carrier: tl.track('carrier', home),
    arm: tl.track('arm', { ...STOW }),
    spin: tl.track('spin', { phi: 0 }),
    tool: tl.track('tool', { held: '', fx: 0 }),
  };
  for (const s of SEAMS) T[s.id] = tl.track('seam-' + s.id, { g: 0, r: 0, f: 0, b: 0, i: 0 });
  let t = 0;
  const go = (track, dur, vals, o = {}) => { const st = track.add(dur, vals, { at: t, ...o }); t = st.start + st.dur; return st; };
  const with_ = (track, dur, vals, o = {}) => track.add(dur, vals, { at: o.at ?? t - dur, ...o });     // 與上一個步驟同時（同一段時間）
  let station = 0;
  const A = (text, sub = '') => ({ action: text, sub, station });
  const pose = p => ({ ...p });
  const nearAngle = (target, cur) => target + 2 * Math.PI * Math.round((cur - target) / (2 * Math.PI));
  const j1Base = poses.weldC.pose.j1;

  // ---- S1 上料定位
  if (meta.key === 'roll') {
    go(T.load, 4, { k: 0 }, A('天車吊入桶（臥放），放進迴轉架下半環', '吊帶兩處、桶軸對準迴轉中心'));
    go(T.load, 1.6, { open: 0 }, A('上半環閉合', '開合式雙環，鉸鏈在側邊'));
    go(T.load, 1.2, { clamp: 1 }, A('夾緊螺桿夾住直筒', '每環 4 支，橡膠夾墊'));
  } else if (meta.key === 'turntable') {
    go(T.load, 4, { k: 0, open: 0 }, A('天車吊入桶（立放），桶腳落入轉台定位塊', '吊耳兩處'));
    go(T.load, 1, { clamp: 1 }, A('定位塊夾緊桶腳', '桶軸對準轉台中心'));
  } else {
    go(T.load, 4.5, { k: 0, open: 0 }, A('移動門架推到桶上方', '桶留在原地；門架橫跨桶身'));
    go(T.load, 1, { clamp: 1 }, A('定位腳下降、腳輪離地', '以人孔法蘭為基準對心（雷射十字）'));
  }

  // ---- 載具移動（B／C：橫移在高處做；A：只有軸向）
  const moveCarrier = (to, text, dur) => {
    const cur = T.carrier.state;
    if (Math.abs(cur.lat - to.lat) > 1) {
      const up = Math.max(cur.s, to.s, sOut);
      if (cur.s < up - 1) go(T.carrier, Math.max(.8, (up - cur.s) / 1200), { s: up }, A(text, '先升到人孔上方'));
      go(T.carrier, Math.max(1, Math.abs(cur.lat - to.lat) / 900), { lat: to.lat }, A(text));
      if (Math.abs(up - to.s) > 1) go(T.carrier, Math.max(.8, Math.abs(up - to.s) / 1200), { s: to.s }, A(text));
    } else go(T.carrier, dur ?? Math.max(.8, Math.abs(cur.s - to.s) / 900), { s: to.s }, A(text));
  };
  // 取／還工具（手臂在 rackUp 姿態、載具到格位）
  const atSlot = (i, text) => {
    const sl = slots[i], up = RP.lift === 'carrier' ? sl.s + LIFT : sl.s;
    if (T.arm.state.j3 !== rackUp.pose.j3 || T.arm.state.j2 !== rackUp.pose.j2) go(T.arm, 1.4, pose(rackUp.pose), A(text, '手臂轉到取放姿態'));
    moveCarrier({ s: up, lat: sl.lat }, text);
    if (RP.lift === 'carrier') go(T.carrier, DEMO.change * .6, { s: sl.s }, A(text, '下降到格位'));
    else go(T.arm, DEMO.change * .6, pose(rack.pose), A(text, '下降到格位'));
  };
  const leaveSlot = (text) => {
    if (RP.lift === 'carrier') go(T.carrier, DEMO.change * .6, { s: T.carrier.state.s + LIFT }, A(text, '上升離開托叉'));
    else go(T.arm, DEMO.change * .6, pose(rackUp.pose), A(text, '上升離開托叉'));
  };
  const lock = (key, text) => { go(T.tool, .5, { held: key }, A(text, key ? '快換盤鎖定' : '快換盤釋放')); };

  // ---- 每道製程
  PROCESS.forEach((P, pi) => {
    station = pi + 1;
    const i = TOOLS.findIndex(x => x.key === P.tool), tname = TOOLS[i].name;
    // 取工具
    atSlot(i, `取${tname}`); lock(P.tool, `取${tname}`); leaveSlot(`取${tname}`);
    // 伸直、到人孔上方、伸入
    go(T.arm, 1.4, pose(STOW), A('手臂伸直（穿人孔姿態）', `人孔襯裡後內徑 ${Math.round(NECK_CLEAR * 2)} mm`));
    moveCarrier({ s: sOut, lat: 0 }, '移到人孔上方');
    go(T.carrier, DEMO.enter, { s: sMid }, A('從人孔伸入桶內', '伸直狀態沿桶軸進入'));
    go(T.arm, DEMO.approach * 1.3, pose(poses.tuck.pose), A('在桶內展開到退刀姿態'));
    // 焊道
    for (const S of SEAMS) {
      const len = seamLength(S) / 1000, min = len / P.speed, label = `${P.name}：${S.name}`;
      const sub = `${P.note}｜實際 ${len.toFixed(2)} m、約 ${min.toFixed(1)} 分`;
      const circ = S.kind === 'circ', sStart = circ ? S.y + W.d : S.y0 + 16 + W.d, sEnd = circ ? sStart : S.y1 - 16 + W.d;
      // 定位：載具到焊道高度；A／B 桶轉到起點，C 由 J1 轉到起點
      const tgtTheta = circ ? CIRC_START : S.theta;                  // 起點方位
      const tuckAt = { ...poses.tuck.pose }, weldAt = { ...(circ ? poses.weldC.pose : poses.weldL.pose) };
      let phi0 = T.spin.state.phi;
      if (meta.spin === 'tank') {
        phi0 = nearAngle(tgtTheta - plan.psi, T.spin.state.phi);
        go(T.carrier, .9, { s: sStart }, A(`${label}：定位`, circ ? '載具到環縫高度' : '載具到縱縫起點'));
        if (Math.abs(phi0 - T.spin.state.phi) > 1e-3) with_(T.spin, .9, { phi: phi0 });
      } else {
        const off = (circ ? -Math.PI : tgtTheta - plan.psi) * D;      // C：J1 相對焊接姿態的偏移（環縫從 −180° 走到 +180°）
        tuckAt.j1 = j1Base + off; weldAt.j1 = j1Base + off;
        go(T.carrier, .9, { s: sStart }, A(`${label}：定位`, circ ? '載具到環縫高度' : '載具到縱縫起點'));
        with_(T.arm, .9, pose(tuckAt));
      }
      go(T.arm, DEMO.approach, pose(weldAt), A(`${label}：下刀`, '工具貼上焊道'));
      go(T.tool, 0, { fx: 1 });
      const dur = circ ? DEMO.circ : DEMO.long, field = FIELD[P.key];
      if (circ) {
        if (meta.spin === 'tank') go(T.spin, dur, { phi: phi0 + 2 * Math.PI }, { ...A(label, sub), ease: linear });
        else go(T.arm, dur, { j1: j1Base + 180 }, { ...A(label, sub + '｜J1 繞桶軸一圈'), ease: linear });
      } else go(T.carrier, dur, { s: sEnd }, { ...A(label, sub), ease: linear });
      with_(T[S.id], dur, { [field]: 1 }, { ease: linear });
      go(T.tool, 0, { fx: 0 });
      go(T.arm, DEMO.approach * .8, pose({ ...tuckAt, j1: T.arm.state.j1 }), A(`${label}：退刀`));
      if (meta.spin === 'j1') go(T.arm, .6, { j1: j1Base }, A(`${label}：退刀`, 'J1 回正'));
    }
    // 退出、還工具
    go(T.carrier, .9, { s: sMid }, A('回到展開位置'));
    go(T.arm, DEMO.approach * 1.3, pose(STOW), A('手臂伸直'));
    go(T.carrier, DEMO.enter, { s: sOut }, A('從人孔退出'));
    atSlot(i, `放回${tname}`); lock('', `放回${tname}`); leaveSlot(`放回${tname}`);
  });

  // ---- S7 卸料
  station = STATIONS.length - 1;
  go(T.arm, 1.4, pose(STOW), A('手臂伸直回原點'));
  moveCarrier(home, '載具回原點');
  if (meta.spin === 'tank') { const back = nearAngle(0, T.spin.state.phi); if (Math.abs(back - T.spin.state.phi) > 1e-3) go(T.spin, 1.5, { phi: back }, A('桶轉回上料角度')); }
  if (meta.key === 'roll') {
    go(T.load, 1, { clamp: 0 }, A('夾緊螺桿鬆開'));
    go(T.load, 1.4, { open: 1 }, A('上半環張開'));
    go(T.load, 3.5, { k: 1 }, A('天車吊出，送下一站（耐壓、火花測試）'));
  } else if (meta.key === 'turntable') {
    go(T.load, .8, { clamp: 0 }, A('定位塊鬆開'));
    go(T.load, 3.5, { k: 1, open: 1 }, A('天車吊出，送下一站（耐壓、火花測試）'));
  } else {
    go(T.load, .8, { clamp: 0 }, A('定位腳收起'));
    go(T.load, 4, { k: 1, open: 1 }, A('門架推往下一個桶'));
  }

  const total = tl.total;
  const stationStart = STATIONS.map((_, k) => Math.min(...tl.events.filter(e => e.station === k).map(e => e.start)));

  // ---------------------------------------------------------------- 套用時間 t
  let cutOn = false;
  const cutWorld = new THREE.Plane();
  function apply(time) {
    const st = tl.sample(time);
    plan.setLoad(st.load, tank);
    plan.setSpin(st.spin.phi, tank);
    plan.setCarrier(st.carrier.s, st.carrier.lat);
    W.set(st.arm);
    for (const s of SEAMS) tank.setSeam(s.id, st['seam-' + s.id]);
    scene.updateMatrixWorld(true);
    for (const [key, tool] of Object.entries(toolsObj)) {
      const m = st.tool.held === key ? W.cplg.matrixWorld : slotM[key];
      m.decompose(tool.root.position, tool.root.quaternion, tool.root.scale);
      tool.set(st.tool.held === key && st.tool.fx > .5);
    }
    if (cutOn) { cutWorld.copy(plan.cut).applyMatrix4(tank.frame.matrixWorld); tank.setCut(true, cutWorld); } else tank.setCut(false);
    return st;
  }
  function setCut(on) { cutOn = on; }

  // 目前焊點（給鏡頭追隨）：TCP 世界位置
  const focus = () => W.tcp.getWorldPosition(new THREE.Vector3());

  // ---------------------------------------------------------------- 配置檢核
  function layoutChecks() {
    const rows = [], fmt = v => (Math.round(v * 10) / 10).toString();
    for (const [k, name] of [['weldC', '環縫焊接'], ['weldL', '縱縫焊接'], ['tuck', '退刀'], ['rack', '工具架取放'], ['rackUp', '取放上升']]) {
      const p = poses[k];
      rows.push({ group: '手臂姿態', name: `${name}姿態 IK 收斂`, ok: p.err < .5 && p.ang < .5, value: `${fmt(p.err)} mm／${fmt(p.ang)}°` });
    }
    // 穿過人孔：伸直姿態下手臂＋工具（全部工具）的最大半徑
    const save = { ...T.arm.base };
    W.set(STOW); plan.setCarrier(sOut, 0); scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(W.root.matrixWorld).invert(), v = new THREE.Vector3();
    let rMax = 0;
    const scan = (o, m) => o.traverse(c => { if (!c.isMesh || c.userData.fx) return; let fx = false; for (let p = c; p; p = p.parent) if (p.userData.fx) fx = true; if (fx) return; const pos = c.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld).applyMatrix4(inv); rMax = Math.max(rMax, Math.hypot(v.x, v.z)); } });
    scan(W.root);
    let rTool = 0;
    for (const tool of Object.values(toolsObj)) {
      W.cplg.matrixWorld.decompose(tool.root.position, tool.root.quaternion, tool.root.scale); tool.root.updateMatrixWorld(true);
      const r0 = rMax; rMax = 0; scan(tool.root); rTool = Math.max(rTool, rMax); rMax = r0;
    }
    rows.push({ group: '人孔通過', name: `手臂伸直半徑 ≤ 人孔 ${fmt(NECK_CLEAR)} − 20`, ok: rMax <= NECK_CLEAR - 20, value: `${fmt(rMax)} mm` });
    rows.push({ group: '人孔通過', name: '工具最大半徑（伸直時）', ok: rTool <= NECK_CLEAR - 20, value: `${fmt(rTool)} mm` });
    rows.push({ group: '行程', name: '伸直進桶時工具尖端高於下封頭', ok: sMid - W.stowLen > -175 + 100, value: `${fmt(sMid - W.stowLen + 191)} mm` });
    if (meta.spin === 'j1') rows.push({ group: '手臂姿態', name: 'J1 繞 360° 在限位內', ok: j1Base - 180 >= W.arm.limits.j1[0] && j1Base + 180 <= W.arm.limits.j1[1], value: `${fmt(j1Base - 180)}～${fmt(j1Base + 180)}°` });
    W.set(save);
    return rows;
  }

  return {
    total, timeline: tl, apply, stationStart, STATIONS, meta, plan, tank, arm: W, tools: toolsObj, poses, slots, sOut, sMid, focus, setCut,
    layoutChecks,
    verify: {
      moduleOf: m => { for (let p = m; p; p = p.parent) if (p.userData.module) return p.userData.module; return 'misc'; },
      allow: [
        { why: '工具貼著襯裡與焊道作業（壓靴、刀具、壓輪接觸面）；桶內間隙由 tools/verify.mjs 的頂點半徑檢查負責', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'tools' && mb === 'tank') || (mb === 'tools' && ma === 'tank'); } },
        { why: '桶是中空迴轉體，有向包圍盒包住整個內部；手臂、載具在桶內的間隙由 tools/verify.mjs 逐頂點檢查', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'tank') !== (mb === 'tank') && ['robot', 'boom', 'gantry', 'tools'].includes(ma === 'tank' ? mb : ma) && ['shell', 'liner', 'manway', 'manway-liner'].includes((ma === 'tank' ? a : b).name); } },
        { why: '工具掛在手臂快換盤上（只限兩側快換盤的結合面）', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return ((ma === 'tools' && mb === 'robot') || (mb === 'tools' && ma === 'robot')) && (a.name === 'tool-coupling' || b.name === 'tool-coupling') && (a.name === 'atc-body' || b.name === 'atc-body' || a.name === 'flange' || b.name === 'flange'); } },
        { why: '工具放在工具架托叉上', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'tools' && mb === 'tool-rack') || (mb === 'tools' && ma === 'tool-rack'); } },
        { why: '迴轉架夾墊、轉台定位塊夾住桶身／桶腳', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'positioner' && mb === 'tank') || (mb === 'positioner' && ma === 'tank'); } },
        { why: '吊帶掛在桶身／吊耳上', test: (a, b, c) => { const ma = c.moduleOf(a), mb = c.moduleOf(b); return (ma === 'crane' && mb === 'tank') || (mb === 'crane' && ma === 'tank'); } },
      ],
      envelope: ['robot'],
    },
  };
}
