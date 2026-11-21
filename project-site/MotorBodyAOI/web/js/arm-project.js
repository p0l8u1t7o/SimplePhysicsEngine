// 手臂持件方案（R5，?plan=arm）的專案介面：與 project.js 相同（total、apply、layoutChecks、verify），另附 shots（每一張）、queue（影像佇列與判定）。
// 流程（一顆一拍，全部串在手臂上）：入料取件 → 開口側①反射鏡探頭 → ②同軸＋孔壁 → ③外側 → 換夾台翻轉 → 法蘭側①頂視＋止口 → ② Ø22 軸孔 → OK／NG 出料帶。
// 手臂姿態在建立時用 IK 解一次（core 的 VS-068 模型），動畫只在關節角之間插值；直線段（沿工件軸進出）取 5 點各解 IK。
import * as THREE from 'three';
import { floor } from '@core/geom/environment.js';
import { std } from '@core/geom/materials.js';
import { createTimeline, linear } from '@core/anim/track.js';
import { FACES, GRIP_BAND, bodyGeometry, subGeometry, bodyData } from './body.js';
import { JAWS, FINGERS, BAND_CENTER, TARGET_MMPX } from './optics-plan.js';
import { RIG, ARM_CAMERAS } from './arm-optics.js';
import { CELL, SEGMENTS, STEPS, STEP_AT, ARM_CT, DECIDE_AT, ARM_AXES, RECIPE, RAMP_DEG, layout, poseO, poseF, poseAt, partDir, segmentTiming, segmentShots, exposureLimit, camOf } from './arm-plan.js';
import { buildArmFrame, buildArm, buildStand, buildArmConveyors, buildArmOptics, buildArmIndicators, PICK_BAND, OUT_BAND, GRIPPER, ARM_COLOR } from './arm-cell.js';
import { createPartInstance } from './machine.js';
import { ARM_SUMMARY, ARM_FOOTPRINT } from './coverage-data.js';
import { decode } from './codec.js';
import { DEMO, isNg, defectMesh, makeSeer } from './defects.js';
import { simulateQueue, partVerdicts, PROC_MS } from './inspect-queue.js';

export const ARM_STATIONS = ['入料取件', '開口側拍攝', '換夾翻轉', '法蘭側拍攝', '出料 OK／NG'];
export const N_PARTS_ARM = 4;
export const IN_ANGLE_ARM = [37, -112, 154, -58];
const INTAKE = { convey: 1.5, center: .3, read: .2, open: .2 };
export const INTRO_ARM = INTAKE.convey + INTAKE.center + INTAKE.read + INTAKE.open;
export const armCycleStart = k => INTRO_ARM + k * ARM_CT;
const J = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'], D2R = Math.PI / 180;
const STAND_PART_YAW = 180;      // 換夾台：工件 90/270° 在旋轉軸（世界 X）上
const HI = 150;                  // 取放件的上方待命高度（沿工件軸）
const GROUP_COLOR = { A: 0x4dabf7, B: 0x9775fa, C: 0xf06595, D: 0xffa94d, E: 0x69db7c };

export function createArmProject({ scene }) {
  floor(scene, { size: [5200, 4200], cell: 200 });
  buildArmFrame(scene);
  const R = buildArm(scene), arm = R.arm, stand = buildStand(scene), conv = buildArmConveyors(scene);
  const optics = buildArmOptics(scene), indicators = buildArmIndicators(scene);
  const L = layout();

  // ---------------------------------------------------------------- 手臂姿態（IK）
  const toolQ = (T, side) => {
    const m = new THREE.Matrix4().extractRotation(T), X = new THREE.Vector3().setFromMatrixColumn(m, 0), Y = new THREE.Vector3().setFromMatrixColumn(m, 1), Z = new THREE.Vector3().setFromMatrixColumn(m, 2);
    if (side === 'F') { Y.negate(); Z.negate(); }
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  };
  const band = T => new THREE.Vector3(0, 0, BAND_CENTER).applyMatrix4(T);
  const deg = () => Object.fromEntries(J.map(n => [n, arm.q[n] / D2R]));
  const setDeg = p => { for (const n of J) arm.q[n] = p[n] * D2R; arm.apply(); };
  const REF = { j1: 0, j2: -20, j3: 20, j4: 0, j5: -70, j6: 0 };
  scene.updateMatrixWorld(true);
  const ikErr = [], mountQi = R.mount.getWorldQuaternion(new THREE.Quaternion()).invert();
  function solve(pos, quat, side, seed, label) {
    const marker = side === 'O' ? R.tcpO : R.tcpF, Lz = side === 'O' ? GRIPPER.tcpO : GRIPPER.tcpF;
    const flange = pos.clone().addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(quat), -Lz);
    // 幾何初始解在手臂座標（基座有轉向）下算
    const seeds = [seed, ...arm.seeds(R.mount.worldToLocal(flange.clone()), mountQi.clone().multiply(quat)).map(s => Object.fromEntries(J.map(n => [n, s[n] / D2R])))].filter(Boolean);
    // 肩部朝前（J1 對著目標）的解優先：肩部朝後翻過頭的解會掃過相機井
    const lp = R.mount.worldToLocal(pos.clone()), front = Math.atan2(-lp.z, lp.x) / D2R;
    let best = null;
    for (const s of seeds) {
      setDeg(s); arm.ik.solve(marker, pos, quat, 400);
      const e = marker.getWorldPosition(new THREE.Vector3()).distanceTo(pos);
      const a = 2 * Math.acos(Math.min(1, Math.abs(arm.tool.getWorldQuaternion(new THREE.Quaternion()).dot(quat)))) / D2R;
      const p = deg(), dist = seed ? J.slice(1, 5).reduce((m, n) => m + Math.abs(p[n] - seed[n]), 0) : 0;
      const dj1 = Math.abs(p.j1 - front);
      const score = e + a * 5 + dist * .002 + dj1 * .05;
      if (!best || score < best.score) best = { score, err: e, ang: a, pose: p };
    }
    ikErr.push({ label, err: best.err, ang: best.ang });
    return best.pose;
  }
  // J4、J6 取與參考最接近的等價角
  const near = (p, ref, keys = ['j4', 'j6']) => { const o = { ...p }; for (const n of keys) for (const k of [-720, -360, 360, 720]) { const v = o[n] + k; if (v >= arm.limits[n][0] && v <= arm.limits[n][1] && Math.abs(v - ref[n]) < Math.abs(o[n] - ref[n])) o[n] = v; } return o; };
  // 沿直線（同一姿態）取 5 點解 IK：回傳關節角陣列（含兩端）
  function line(posA, posB, quat, side, seed, label) {
    const out = []; let s = seed;
    for (let i = 0; i <= 4; i++) { const p = posA.clone().lerp(posB, i / 4); s = near(solve(p, quat, side, s, `${label} ${i}/4`), s); out.push(s); }
    return out;
  }
  const up = (p, h) => p.clone().add(new THREE.Vector3(0, h, 0));
  // 路徑點：{ pos（TCP）, q（工具姿態）, side（夾法）, pose（關節角） }
  const wp = (pos, q, side, seed, label) => ({ pos, q, side, pose: near(solve(pos, q, side, seed, label), seed) });
  // 長距離移動：起點抬高 h → 終點上方 h → 終點（避免關節插值時工件或夾爪往下掃到相機、光源、換夾台）
  function transit(A, B, h, label) {
    const [ha, hb] = Array.isArray(h) ? h : [h, h];
    const a = wp(up(A.pos, ha), A.q, A.side, A.pose, `${label} 抬高`), b = wp(up(B.pos, hb), B.q, B.side, B.pose, `${label} 終點上方`);
    return [near(a.pose, A.pose), near(b.pose, B.pose)];
  }

  // 拍攝段：第 0 張的姿態 → 選起始張 k0 與 J6 的等價角，讓整段（加速 30°＋12 張 330°＋減速 30°）都在 J6 ±355° 內
  const segPose = {}, k0Of = {};
  let prev = REF;
  for (const s of SEGMENTS) {
    const T = L.segT[s.id], q = toolQ(T, s.side), base = solve(band(T), q, s.side, prev, `拍攝段 ${s.id}`);
    const sg = s.side === 'O' ? 1 : -1;
    let pick = null;
    for (let k0 = 0; k0 < 12; k0++) for (const r of [-720, -360, 0, 360, 720]) {
      const start = base.j6 + r + sg * 30 * k0, pre = start - sg * RAMP_DEG, end = pre + sg * (360 + 2 * RAMP_DEG);
      if (Math.min(pre, end) < -355 || Math.max(pre, end) > 355) continue;
      const cost = Math.abs(pre - prev.j6);
      if (!pick || cost < pick.cost) pick = { k0, pre, end, cost };
    }
    k0Of[s.id] = pick.k0;
    const pos = band(T), pre = { ...base, j6: pick.pre }, end = { ...base, j6: pick.end };
    segPose[s.id] = { base, pre, end, sg, T, q, A: { pos, q, side: s.side, pose: pre }, Z: { pos, q, side: s.side, pose: end } };
    prev = end;
  }
  // 拍攝段之外的取放姿態
  const pickT = k => poseO([CELL.pick[0], PICK_BAND, CELL.pick[2]], IN_ANGLE_ARM[k]);
  const standO = poseO(CELL.stand, STAND_PART_YAW), standF = poseF(CELL.stand, 0);
  const outT = ng => poseF([(ng ? CELL.ngOut : CELL.okOut)[0], OUT_BAND, (ng ? CELL.ngOut : CELL.okOut)[2]], 0);
  const plan = { pick: [], out: {}, via: {} };
  for (let k = 0; k < N_PARTS_ARM; k++) {
    const T = pickT(k), q = toolQ(T, 'O'), p = band(T);
    const hi = wp(up(p, HI), q, 'O', segPose.O1.pre, `取件上方 ${k + 1}`);
    plan.pick.push({ hi, down: line(up(p, HI), p, q, 'O', hi.pose, `取件 ${k + 1}`) });
  }
  const o1 = segPose.O1, o1hiPos = up(band(o1.T), 160);
  plan.o1in = line(o1hiPos, band(o1.T), o1.q, 'O', o1.pre, 'O1 進').map(p => ({ ...p, j6: o1.pre.j6 }));
  plan.o1out = line(band(o1.T), o1hiPos, o1.q, 'O', o1.end, 'O1 出').map(p => ({ ...p, j6: o1.end.j6 }));
  const o1top = { pos: o1hiPos, q: o1.q, side: 'O', pose: plan.o1in[0] }, o1topEnd = { pos: o1hiPos, q: o1.q, side: 'O', pose: plan.o1out[4] };
  {
    const qO = toolQ(standO, 'O'), pO = band(standO), qF = toolQ(standF, 'F'), pF = band(standF);
    const SH = 220;     // 換夾台上方：要高過翻轉中的 U 形框（半徑 150）
    plan.standHiO = wp(up(pO, SH), qO, 'O', segPose.O3.end, '換夾台上方（法蘭側夾）');
    plan.standO = line(up(pO, SH), pO, qO, 'O', plan.standHiO.pose, '換夾台放');
    plan.standHiF = wp(up(pF, SH), qF, 'F', plan.standHiO.pose, '換夾台上方（開口側夾）');
    plan.standF = line(up(pF, SH), pF, qF, 'F', plan.standHiF.pose, '換夾台取');
  }
  for (const ng of [false, true]) {
    const T = outT(ng), q = toolQ(T, 'F'), p = band(T);
    const hi = wp(up(p, HI), q, 'F', segPose.F2.end, `出料上方 ${ng ? 'NG' : 'OK'}`);
    plan.out[ng] = { hi, down: line(up(p, HI), p, q, 'F', hi.pose, `出料 ${ng ? 'NG' : 'OK'}`) };
  }
  // 長距離移動的抬高路徑點（起點上方、終點上方）
  const S_ = segPose;
  plan.via.toO1 = plan.pick.map((P, k) => transit(P.hi, o1top, 60, `取件 ${k + 1} → O1`));
  plan.via.toO2 = transit(o1topEnd, S_.O2.A, 120, 'O1 → O2');
  plan.via.toO3 = transit(S_.O2.Z, S_.O3.A, 120, 'O2 → O3');
  plan.via.toStand = transit(S_.O3.Z, plan.standHiO, [200, 40], 'O3 → 換夾台');
  plan.via.toF1 = transit(plan.standHiF, S_.F1.A, [40, 150], '換夾台 → F1');
  plan.via.toF2 = transit(S_.F1.Z, S_.F2.A, 120, 'F1 → F2');
  plan.via.toOut = { false: transit(S_.F2.Z, plan.out[false].hi, 150, 'F2 → 出料 OK'), true: transit(S_.F2.Z, plan.out[true].hi, 150, 'F2 → 出料 NG') };
  plan.via.toPick = ng => plan.pick.map((P, k) => transit(plan.out[ng].hi, P.hi, 120, `出料 → 取件 ${k + 1}`));
  plan.via.toPickOK = plan.via.toPick(false); plan.via.toPickNG = plan.via.toPick(true);
  const HOME = plan.pick[0].hi.pose;

  // ---------------------------------------------------------------- 工件、缺陷、取像足跡
  const geo = bodyGeometry(), mat = std(0xc9cfd4, .42, .55);
  const NG_SET = new Set(Object.entries(DEMO.arm).filter(([, ds]) => ds.some(isNg)).map(([k]) => +k));
  const parts = Array.from({ length: N_PARTS_ARM }, (_, k) => {
    const p = createPartInstance(geo, mat, 'part'); scene.add(p.holder); p.k = k;
    p.defects = (DEMO.arm[k] || []).map(d => { const m = defectMesh(d); p.mesh.add(m); return m; });
    return p;
  });
  const ov = createPartInstance(new THREE.BufferGeometry(), mat, 'overlay-arm'); ov.mesh.visible = false; scene.add(ov.holder);
  const faceOverlay = new THREE.Group(); faceOverlay.name = 'faces-arm'; faceOverlay.visible = false; ov.spin.add(faceOverlay); faceOverlay.position.z = ov.mesh.position.z;
  const triOf = no => { const out = [], { triFace, nt } = bodyData(); for (let t = 0; t < nt; t++) if (triFace[t] === no) out.push(t); return out; };
  for (const f of FACES) {
    const m = new THREE.Mesh(subGeometry(triOf(f.no), .04), new THREE.MeshBasicMaterial({ color: GROUP_COLOR[f.group], transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.name = `face-${f.no}`; m.renderOrder = 6; faceOverlay.add(m);
  }
  const footMeshes = {};
  for (const cam of ARM_CAMERAS) {
    const tris = decode(ARM_FOOTPRINT[cam.id].tris), masks = decode(ARM_FOOTPRINT[cam.id].masks), n = cam.frames || 1, list = [];
    const m2 = new THREE.MeshBasicMaterial({ color: ARM_COLOR[cam.rig], transparent: true, opacity: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let k = 0; k < n; k++) {
      const sel = []; for (let i = 0; i < tris.length; i++) if (masks[i] & (1 << k)) sel.push(tris[i]);
      const m = new THREE.Mesh(subGeometry(sel, .08), m2); m.name = `foot-${cam.id}-${k}`; m.visible = false; m.renderOrder = 7;
      m.position.z = ov.mesh.position.z; ov.spin.add(m); list.push(m);
    }
    footMeshes[cam.id] = list;
  }
  ov.holder.traverse(m => Object.assign(m.userData, { fx: true }));

  // ---------------------------------------------------------------- 時間軸
  const tl = createTimeline();
  const ta = tl.track('arm', { ...HOME }), tg = tl.track('grip', { open: 1 }), tsd = tl.track('stand', { ang: 0, open: 1 });
  const ti = tl.track('intake', { s: 0, center: 1, read: 0 }), tok = tl.track('ok', { s: 0 }), tng = tl.track('ng', { s: 0 });
  const st = (i, extra = {}) => ({ station: i, ...extra });
  // exact：拍攝段的起始姿態（J6 已選好等價角，不能再換 ±360°）
  const moveTo = (pose, dur, o = {}, exact = false) => ta.add(dur, exact ? { ...pose } : near(pose, ta.state), o);
  // 經抬高路徑點：30% 抬高、40% 橫移、30% 下到終點
  const viaTo = (via, pose, dur, o = {}, exact = false) => { const { at, ...txt } = o; ta.add(dur * .3, near(via[0], ta.state), { ...o, ease: linear }); ta.add(dur * .4, near(via[1], ta.state), { ...txt, ease: linear }); ta.add(dur * .3, exact ? { ...pose } : near(pose, ta.state), txt); };
  const lineTo = (poses, dur, o = {}, exact = false) => { const { at, ...txt } = o, n = poses.length - 1; poses.slice(1).forEach((p, i) => ta.add(dur / n, exact ? { ...p } : near(p, ta.state), { ...(i ? txt : o), ease: linear })); };
  // 入料：第 k 顆送到取件位、V 形塊置中、定位相機判角讀碼、V 形塊退開
  const intake = (k, at) => {
    ti.add(INTAKE.convey, { s: 600 }, { at, action: `入料輸送：第 ${k + 1} 顆送到取件位`, ...st(0), ease: linear });
    ti.add(INTAKE.center, { center: 0 }, { action: 'V 形塊置中（夾 Ø100 帶法蘭側半段）', ...st(0) });
    ti.add(INTAKE.read, { read: 1 }, { action: 'P0 定位相機：判角＋讀 QR（手臂取件前預轉 J6）', ...st(0) });
    ti.add(INTAKE.open, { read: 0, center: 1 }, { action: 'V 形塊退開', ...st(0) });
    ti.add(0, { s: 0 });
  };
  intake(0, 0);
  moveTo(plan.pick[0].hi.pose, 1, { at: INTRO_ARM - 1, action: '手臂到取件位上方（J6 預轉對準來料角度）', ...st(0) });
  const ngOf = k => NG_SET.has(k);
  let ngCount = 0;
  for (let k = 0; k < N_PARTS_ARM; k++) {
    const T0 = armCycleStart(k), at = key => T0 + STEP_AT[key], dur = key => STEPS.find(s => s.key === key).dur, sub = `第 ${k + 1} 顆`;
    const P = plan.pick[k];
    lineTo(P.down, dur('pickDown'), { at: at('pickDown'), action: '下降取件', sub, ...st(0) });
    tg.add(dur('pickGrip'), { open: 0 }, { at: at('pickGrip'), action: '夾爪閉合（從法蘭側夾 Ø100 帶開口側半段）', sub, ...st(0) });
    lineTo([...P.down].reverse(), dur('pickUp'), { at: at('pickUp'), action: '上升', ...st(0) });
    if (k + 1 < N_PARTS_ARM) intake(k + 1, at('pickUp') + dur('pickUp') + .2);
    viaTo(plan.via.toO1[k], plan.o1in[0], dur('toO1'), { at: at('toO1'), action: '移到反射鏡探頭上方', ...st(1) }, true);
    lineTo(plan.o1in, dur('O1in'), { at: at('O1in'), action: '杯口罩住探頭（沿工件軸下降）', ...st(1) }, true);
    for (const s of SEGMENTS) {
      const sp = segPose[s.id], tm = segmentTiming(s), key = s.id;
      if (s.id === 'O2' || s.id === 'O3' || s.id === 'F2') viaTo(plan.via[`to${s.id}`], sp.pre, dur(`to${s.id}`), { at: at(`to${s.id}`), action: STEPS.find(x => x.key === `to${s.id}`).name, ...st(s.side === 'O' ? 1 : 3) }, true);
      if (s.id === 'F1') {
        viaTo(plan.via.toF1, sp.pre, dur('toF1'), { at: at('toF1'), action: '移到法蘭側拍攝位①', ...st(3) }, true);
      }
      const t0 = at(key), sg = sp.sg, pre = sp.pre.j6, w = s.speed, acc = tm.accel, run = tm.run;
      // 第 6 軸飛拍：靜態張 → 加速 30° → 等速 330°（12 個位置）→ 減速 30°
      const prof = u => { const t = u * tm.rotate; if (t < acc) return w / acc * t * t / 2; if (t < acc + run) return RAMP_DEG + w * (t - acc); const r = t - acc - run; return RAMP_DEG + 330 + w * r - w / acc * r * r / 2; };
      if (tm.tStatic > 0) ta.add(tm.tStatic, {}, { at: t0, action: `靜態取像（${s.name}）`, sub: '分區環形光 4 區＋亮場', ...st(s.side === 'O' ? 1 : 3) });
      ta.add(tm.rotate + (tm.perPos - 1) / tm.fps, { j6: sp.end.j6 }, {
        at: t0 + tm.tStatic, action: `飛拍 ${s.name}`, sub: `J6 等速 ${w}°/s、每 30° 一組，逐張控光`, ...st(s.side === 'O' ? 1 : 3), ease: linear,
        motion: (e, t = 1) => ({ j6: pre + sg * prof(Math.min(1, t * (tm.rotate + (tm.perPos - 1) / tm.fps) / tm.rotate)) }),
      });
      if (s.id === 'O1') lineTo(plan.o1out, dur('O1out'), { at: at('O1out'), action: '沿工件軸上升離開探頭', ...st(1) }, true);
      if (s.id === 'O3') {
        viaTo(plan.via.toStand, plan.standO[0], dur('toStand'), { at: at('toStand'), action: '移到換夾台上方', ...st(2) });
        lineTo(plan.standO, dur('standDown'), { at: at('standDown'), action: '下降放入換夾台', ...st(2) });
        tsd.add(dur('standClamp'), { open: 0 }, { at: at('standClamp'), action: '換夾台夾指閉合（夾帶法蘭側半段）', ...st(2) });
        tg.add(dur('release'), { open: 1 }, { at: at('release'), action: '夾爪張開', ...st(2) });
        lineTo([...plan.standO].reverse(), dur('standUp'), { at: at('standUp'), action: '上升讓出翻轉空間', ...st(2) });
        tsd.add(dur('flip'), { ang: -180 }, { at: at('flip'), action: '換夾台翻轉 180°（經下方；氣動旋轉缸）', sub: '手臂同時轉 J6、改用開口側夾的 TCP', ...st(2) });
        moveTo(plan.standF[0], dur('flip'), { at: at('flip') });
        lineTo(plan.standF, dur('regripDown'), { at: at('regripDown'), action: '下降（從開口側）', ...st(2) });
        tg.add(dur('regrip'), { open: 0 }, { at: at('regrip'), action: '夾爪閉合', ...st(2) });
        tsd.add(dur('standOpen'), { open: 1 }, { at: at('standOpen'), action: '換夾台夾指張開', ...st(2) });
        lineTo([...plan.standF].reverse(), dur('regripUp'), { at: at('regripUp'), action: '上升', ...st(2) });
        tsd.add(.5, { ang: 0 }, { at: at('regripUp') + dur('regripUp') + .1, action: '換夾台轉回（空）', ...st(2) });
      }
    }
    // 出料：途中取判定結果（DECIDE_AT），走 OK 或 NG 帶
    const ng = ngOf(k), O = plan.out[ng].down;
    viaTo(plan.via.toOut[ng], O[0], dur('toOut'), { at: at('toOut'), action: `移到出料：判 ${ng ? 'NG → NG 輸送帶' : 'OK → 出料輸送帶'}`, sub: '影像判定在搬運途中就緒', ...st(4) });
    lineTo(O, dur('outDown'), { at: at('outDown'), action: '下降放件', ...st(4) });
    tg.add(dur('outOpen'), { open: 1 }, { at: at('outOpen'), action: '夾爪張開', ...st(4) });
    lineTo([...O].reverse(), dur('outUp'), { at: at('outUp'), action: '上升', ...st(4) });
    const tOut = at('outUp') + dur('outUp');
    if (ng) { tng.add(.6, { s: 150 * (ngCount + 1) }, { at: tOut, action: `第 ${k + 1} 顆 NG：NG 輸送帶前進一格（緩衝）`, ...st(4), ease: linear }); ngCount++; }
    else { tok.add(1.2, { s: 700 }, { at: tOut, action: `第 ${k + 1} 顆 OK：出料輸送帶帶走`, ...st(4), ease: linear }); tok.add(0, { s: 0 }); }
    if (k + 1 < N_PARTS_ARM) viaTo((ng ? plan.via.toPickNG : plan.via.toPickOK)[k + 1], plan.pick[k + 1].hi.pose, dur('toPick'), { at: at('toPick'), action: '回到取件位上方（J6 預轉對準下一顆）', ...st(0) });
    else viaTo((ng ? plan.via.toPickNG : plan.via.toPickOK)[0], HOME, dur('toPick'), { at: at('toPick'), action: '回到待命位', ...st(0) });
  }
  const total = Math.max(tl.total, armCycleStart(N_PARTS_ARM) + .2);

  // ---------------------------------------------------------------- 每一張與影像佇列
  const seer = makeSeer(ARM_FOOTPRINT), shots = [];
  for (let k = 0; k < N_PARTS_ARM; k++) for (const s of SEGMENTS) for (const sh of segmentShots(s, k0Of[s.id])) {
    const cam = camOf(sh.cam), hit = (DEMO.arm[k] || []).filter(d => cam.faces.includes(d.face) && seer(cam.id, d, sh.k));
    shots.push({ ...sh, t: armCycleStart(k) + STEP_AT[s.id] + sh.t, part: k, rig: cam.rig, defects: hit, cost: PROC_MS[cam.sensor] / 1000, ng: hit.some(isNg) });
  }
  shots.sort((a, b) => a.t - b.t);
  const images = simulateQueue(shots.map(s => ({ ...s, defect: s.defects.length > 0 })));
  const needAt = k => armCycleStart(k) + DECIDE_AT;
  const verdicts = partVerdicts(images, needAt);
  const queue = { images, verdicts, needAt, decideLabel: '手臂往出料移動到一半（OK／NG 帶分岔前）' };

  // ---------------------------------------------------------------- 工件狀態
  const tmp = new THREE.Vector3(), qTmp = new THREE.Quaternion(), qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  const standQO = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(standO));
  function partState(k, T, S) {
    const T0 = armCycleStart(k), at = key => T0 + STEP_AT[key], end = key => at(key) + STEPS.find(s => s.key === key).dur;
    const convStart = k === 0 ? 0 : armCycleStart(k - 1) + STEP_AT.pickUp + STEPS.find(s => s.key === 'pickUp').dur + .2;
    const yaw = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(pickT(k)));
    if (T < convStart) return null;
    if (T < convStart + INTAKE.convey) return { pos: new THREE.Vector3(CELL.pick[0] - 600 + S.intake.s, PICK_BAND, CELL.pick[2]), q: yaw, where: 'in' };
    if (T < end('pickGrip')) return { pos: new THREE.Vector3(CELL.pick[0], PICK_BAND, CELL.pick[2]), q: yaw, where: 'in' };
    if (T < end('standClamp')) { R.tcpO.getWorldPosition(tmp); R.arm.tool.getWorldQuaternion(qTmp); return { pos: tmp.clone(), q: qTmp.clone(), where: 'held', side: 'O' }; }
    if (T < end('regrip')) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), S.stand.ang * D2R).multiply(standQO);
      return { pos: stand.center.clone(), q, where: 'stand' };
    }
    if (T < end('outOpen')) { R.tcpF.getWorldPosition(tmp); R.arm.tool.getWorldQuaternion(qTmp); return { pos: tmp.clone(), q: qTmp.clone().multiply(qFlip), where: 'held', side: 'F' }; }
    const ng = ngOf(k), base = new THREE.Vector3(...(ng ? CELL.ngOut : CELL.okOut)); base.y = OUT_BAND;
    const qOut = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(outT(ng)));
    if (ng) { const idx = [...NG_SET].sort().indexOf(k); return { pos: base.add(tmp.set(Math.max(0, S.ng.s - 150 * idx), 0, 0)), q: qOut, where: 'out' }; }
    const tOut = end('outUp');
    if (T < tOut) return { pos: base, q: qOut, where: 'out' };
    if (T < tOut + 1.2) return { pos: base.add(tmp.set(S.ok.s, 0, 0)), q: qOut, where: 'out' };
    return null;
  }

  // ---------------------------------------------------------------- 套用時間 T
  const lightOf = {};
  for (const cam of ARM_CAMERAS) {
    const u = optics.cams[cam.id], rigU = optics.rigs[cam.rig], ls = u.lights;
    lightOf[cam.id] = ch => {
      if (cam.light.kind === 'psSide') return ch.startsWith('左') ? [ls[0]] : ch.startsWith('右') ? [ls[1]] : [rigU.vc];
      if (cam.light.kind === 'lensRing') return [rigU.vc];
      if (cam.id === 'R1-1') return ch.startsWith('分區') ? ls.slice(0, 4) : ls.slice(4);
      return ls;
    };
  }
  let lastShot = null;
  const shotNow = T => { let lo = 0, hi = shots.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (shots[m].t <= T) { i = m; lo = m + 1; } else hi = m - 1; } return i; };
  function apply(T) {
    const S = tl.sample(T);
    setDeg(S.arm); R.setOpen(S.grip.open);
    stand.set(S.stand.ang, S.stand.open);
    conv.setCenter(S.intake.center);
    conv.inC.set({ s: S.intake.s }); conv.okC.set({ s: S.ok.s }); conv.ngC.set({ s: S.ng.s });
    optics.locator.set({ light: S.intake.read > .5 ? 1 : .05 });
    scene.updateMatrixWorld(true);
    let held = null;
    for (const p of parts) {
      const s = partState(p.k, T, S);
      if (!s) { Object.assign(p.holder.userData, { where: null }); p.holder.visible = false; p.set(new THREE.Vector3(-3000 - p.k * 300, -1500, -2500), new THREE.Quaternion(), 0); continue; }
      p.holder.visible = true; p.set(s.pos, s.q, 0); Object.assign(p.holder.userData, { where: s.where, side: s.side ?? null });
      if (s.where === 'held') held = { p, s };
    }
    ov.holder.visible = !!held; if (held) ov.set(held.s.pos, held.s.q, 0);
    // 取像：最近 50 ms 內的張數亮燈、顯示足跡
    for (const list of Object.values(footMeshes)) for (const m of list) m.visible = false;
    for (const cam of ARM_CAMERAS) for (const l of optics.cams[cam.id].lights) setLight(l, .06);
    for (const r of Object.values(optics.rigs)) r.vc?.set({ light: .05 });
    const i = shotNow(T); lastShot = i >= 0 ? shots[i] : null;
    for (let j = i; j >= 0 && T - shots[j].t < .05; j--) {
      const sh = shots[j], cam = camOf(sh.cam);
      if (sh.k >= 0) footMeshes[sh.cam][sh.k].visible = true; else if (!cam.frames) footMeshes[sh.cam][0].visible = true;
      for (const l of lightOf[sh.cam](sh.ch)) setLight(l, Math.min(1.6, .5 + sh.bright / 300));
      optics.rigs[cam.rig].vc?.set({ light: 1 });
    }
    indicators.tower.set(T < total - .01 ? 'green' : 'yellow');
    return S;
  }
  function setLight(l, v) { if (l?.set && l.root) l.set({ light: Math.min(1, v) }); else if (l?.material) l.material.emissiveIntensity = v; }

  const stationStart = tl.stationStart;

  // ---------------------------------------------------------------- 檢核
  function layoutChecks() {
    const rows = [], F = ARM_SUMMARY.faces, C = ARM_SUMMARY.cameras;
    for (const f of FACES) rows.push({ group: '取像覆蓋', name: `面 ${f.no} ${f.name}（${F[f.no].cameras.join('、')}）`, ok: F[f.no].coverage >= 99 && F[f.no].lit >= 99, value: `${F[f.no].coverage}%／照明 ${F[f.no].lit}%` });
    for (const cam of ARM_CAMERAS) {
      const c = C[cam.id], worst = Math.max(...Object.values(c.perFace).map(s => s.mmpx?.[1] ?? 9));
      rows.push({ group: '解析度與景深', name: `${cam.id} 有效解析度 ≤ ${TARGET_MMPX} mm/px、景深 ${c.dof} mm ≥ 需求 ${c.span} mm`, ok: worst <= TARGET_MMPX && c.dof >= c.span, value: `${worst} mm/px、b ${c.bDesign} mm、F${c.N}` });
      for (const f of cam.faces) {
        const pf = c.perFace[f];
        rows.push({ group: '反光', name: `${cam.id} 面 ${f} 沒有局部反光（散開 4°／8°）`, ok: pf.glare !== '局部反光' && pf.glare8 !== '局部反光', value: `${pf.glare}／${pf.glare8}` });
        rows.push({ group: '刀紋', name: `${cam.id} 面 ${f} 主影像沒有刀紋亮帶（12°／20°）`, ok: pf.groove !== '刀紋亮帶' && pf.groove20 !== '刀紋亮帶', value: `${pf.groove}／${pf.groove20}` });
      }
    }
    // 同一台實體相機的各筆設定：感測器、焦距、視野必須相同
    for (const [rig, Rg] of Object.entries(RIG)) {
      const cs = ARM_CAMERAS.filter(c => c.rig === rig), same = cs.every(c => c.sensor === Rg.sensor && c.f === Rg.f && c.fovH === Rg.fovH);
      rows.push({ group: '相機共用', name: `${rig} ${Rg.name}：${cs.map(c => c.id).join('、')} 同一組鏡頭與視野`, ok: same, value: `${Rg.sensor}／${Rg.f} mm／${Rg.fovH} mm` });
    }
    // 飛拍：每筆光源配方的脈寬 ≤ 拖影 0.5 px 的曝光上限
    for (const r of RECIPE.filter(x => !x.statics)) {
      const lim = exposureLimit(r.cam);
      rows.push({ group: '飛拍', name: `${r.cam} ${r.ch}：脈寬 ${r.pulse} µs ≤ 拖影 0.5 px 上限`, ok: r.pulse <= lim.us, value: `上限 ${lim.us} µs（線速 ${lim.v} mm/s）` });
    }
    // 手臂：IK 誤差、J6 掃描範圍
    const worstIk = ikErr.reduce((m, e) => e.err + e.ang > m.err + m.ang ? e : m, { err: 0, ang: 0, label: '' });
    rows.push({ group: '手臂', name: `所有姿態 IK 誤差 ≤ 0.5 mm／0.5°（${ikErr.length} 個點）`, ok: ikErr.every(e => e.err <= .5 && e.ang <= .5), value: `最差 ${worstIk.label} ${worstIk.err.toFixed(2)} mm／${worstIk.ang.toFixed(2)}°` });
    for (const s of SEGMENTS) { const sp = segPose[s.id]; rows.push({ group: '手臂', name: `${s.id} J6 飛拍掃描（${360 + 2 * RAMP_DEG}°）在 ±360° 內`, ok: Math.max(Math.abs(sp.pre.j6), Math.abs(sp.end.j6)) <= 355, value: `${sp.pre.j6.toFixed(0)}° → ${sp.end.j6.toFixed(0)}°` }); }
    for (const s of SEGMENTS.filter(x => x.from)) rows.push({ group: '手臂', name: `${s.id} 工件軸對鉛直的傾角（由 ${s.from} 位置反推）`, ok: s.tilt <= 35, value: `${s.tilt.toFixed(1)}°` });
    // 夾持
    const inBand = z => z[0] >= GRIP_BAND.z[0] && z[1] <= GRIP_BAND.z[1], sep = (a, b) => a[1] <= b[0] || b[1] <= a[0];
    rows.push({ group: '夾持', name: '夾爪與換夾台夾指都在 Ø100 外圓帶內、分在兩個半段', ok: inBand(JAWS.z) && inBand(FINGERS.z) && sep(JAWS.z, FINGERS.z), value: `${JAWS.z.join('~')}／${FINGERS.z.join('~')}` });
    // 節拍與判定
    rows.push({ group: '節拍', name: 'CT ≤ 15 s（規格）', ok: ARM_CT <= 15, value: `${ARM_CT.toFixed(1)} s` });
    rows.push({ group: '節拍', name: 'CT ≤ 12 s（挑戰，參考）', ok: ARM_CT <= 12, info: true, value: `${ARM_CT.toFixed(1)} s，全部動作串在同一支手臂上` });
    rows.push({ group: '節拍', name: '伺服軸 ≤ 6', ok: true, value: '6 軸（都在手臂）' });
    const minSlack = Math.min(...verdicts.map(v => v.slack));
    rows.push({ group: '判定', name: `每顆的判定在分料點前就緒（${queue.decideLabel}）`, ok: minSlack >= 0, value: `最少提前 ${minSlack.toFixed(2)} s` });
    rows.push({ group: '判定', name: '示範缺陷判定正確（NG 件判 NG、未達門檻判 OK）', ok: verdicts.every(v => v.ng === NG_SET.has(v.part)), value: verdicts.map(v => `${v.part + 1}:${v.ng ? 'NG' : 'OK'}`).join(' ') });
    return rows;
  }

  return {
    plan: 'arm', total, timeline: tl, apply, stationStart, parts, optics, footMeshes, faceOverlay: { arm: faceOverlay }, overlay: { arm: ov }, cycleTime: ARM_CT,
    shots, queue, segPose, k0Of, ikErr, arm: R, NG_SET, viewCamOf: id => (optics.cams[id]?.viewCam) || optics.rigs[camOf(id).rig].viewCam,
    get lastShot() { return lastShot; },
    layoutChecks,
    verify: {
      dt: .08,
      skip: o => !!o.userData.fx,
      allow: [
        { why: '工件與夾持、承載件的接觸，只在工件確實在該位置時放行：手臂夾爪爪頭（被手臂夾著）、換夾台指墊（在換夾台）、入料輸送與置中 V 形塊（在入料）、出料與 NG 輸送（已放到出料）。接觸件以 userData.contact 標記', test: (a, b, ctx) => {
          const part = [a, b].find(m => ctx.moduleOf(m) === 'part'), other = part === a ? b : a;
          if (!part || !other || !hasContact(other)) return false;
          const h = holderOf(part).userData, mod = ctx.moduleOf(other);
          if (mod === 'robot') return h.where === 'held';
          if (mod === 'stand') return h.where === 'stand' || h.where === 'held';
          if (mod === 'conveyors') return h.where === 'in' || h.where === 'out' || h.where === 'held';
          return false;
        } },
        { why: '工件彼此：停在機台外的待投入／已離開工件放在地面下方各自的位置，不會重疊', test: (a, b, ctx) => ctx.moduleOf(a) === 'part' && ctx.moduleOf(b) === 'part' && (!visibleChain(a) || !visibleChain(b)) },
        { why: '夾爪 3 爪在夾爪本體上滑動開合（同一組夾爪）', test: (a, b) => [a, b].some(m => under(m, 'grip-slide')) && [a, b].some(m => under(m, 'gripper') && !under(m, 'grip-slide')) },
        { why: '換夾台夾指在夾指氣缸內滑動（同一組）', test: (a, b) => [a, b].some(m => under(m, 'stand-finger')) && [a, b].some(m => under(m, 'stand-rotor') && !under(m, 'stand-finger')) },
        { why: '置中 V 形塊的推桿在氣缸內滑動', test: (a, b) => [a, b].every(m => under(m, 'centering')) },
      ],
      envelope: ['robot'],
    },
  };
}
const hasContact = m => { for (let p = m; p; p = p.parent) if (p.userData?.contact) return true; return false; };
const holderOf = m => { let p = m; while (p.parent && p.name !== 'part') p = p.parent; return p; };
const under = (m, name) => { for (let p = m; p; p = p.parent) if (p.name === name) return true; return false; };
const visibleChain = m => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; };
