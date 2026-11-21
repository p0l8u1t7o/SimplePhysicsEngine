// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 流程：入料讀碼（P0）→ ST1 法蘭面朝上旋轉取像（P1）→ 翻轉 180°（P2）→ ST2 開口朝上旋轉取像（P3）→ 分料 OK／NG（P4）。
// 步進移載每拍把各位置的工件同時往下游搬一格；動畫從空機開始連續投入 8 顆、跑 7 拍，第 4 拍起全線滿載（穩態 CT）。
import * as THREE from 'three';
import { std } from '@core/geom/materials.js';
import { floor } from '@core/geom/environment.js';
import { createTimeline, linear } from '@core/anim/track.js';
import { FACES, GRIP_BAND, bodyGeometry, subGeometry } from './body.js';
import { CAMERAS, JAWS, FINGERS, FLIP_FINGERS, TARGET_MMPX } from './optics-plan.js';
import { XFER, XFER_TIME, CT, PITCH, LIFT, LIFT_TIME, FLIP, INTAKE, SORT, RETURN, STATION_TIMES, SERVO_AXES, BOTTLENECK, PRE_ROTATE, ALIGN, stationTime, rotationAt, shotAt, SHOTS } from './sequence.js';
import { LINE, POS_NAMES, NG_Z, orientQ, worldBand, stationCenter, createPartInstance, buildFrame, buildConveyors, buildSorter, buildChuck, buildFlip, buildTransfer, FORK } from './machine.js';
import { buildOptics, buildIndicators, CAMERA_COLOR } from './optics-scene.js';
import { SUMMARY, FOOTPRINT } from './coverage-data.js';
import { bodyData } from './body.js';
import { decode } from './codec.js';

export const STATIONS = POS_NAMES;
export const N_CYCLES = 7, N_PARTS = 8, NG_PARTS = [2];       // 第 3 顆（編號 2）示範 NG 分料
// 來料角度不固定（示意的固定亂數，動畫每次相同）：P0 定位相機判角，ST1 夾頭預轉到這個角度再夾，拍完轉回 0° 出站
export const IN_ANGLE = [37, -112, 154, -58, 96, -143, 12, 71];
export const INTRO = INTAKE.convey + INTAKE.read;               // 第 1 顆入料讀碼
export const cycleStart = c => INTRO + c * CT;
const GROUP_COLOR = { A: 0x4dabf7, B: 0x9775fa, C: 0xf06595, D: 0xffa94d, E: 0x69db7c };

export function createProject({ scene }) {
  floor(scene, { size: [5200, 3600], cell: 200 });
  buildFrame(scene);
  const conv = buildConveyors(scene), sorter = buildSorter(scene, conv.outTop);
  const chuck1 = buildChuck(scene, 1, 'ST1'), chuck2 = buildChuck(scene, 3, 'ST2');
  const flip = buildFlip(scene), xfer = buildTransfer(scene);
  const optics = buildOptics(scene), indicators = buildIndicators(scene);

  // ---------------------------------------------------------------- 工件（共用一份網格）
  const geo = bodyGeometry(), mat = std(0xc9cfd4, .42, .55);
  const parts = Array.from({ length: N_PARTS }, (_, k) => {
    const p = createPartInstance(geo, mat, 'part'); scene.add(p.holder); p.k = k; return p;
  });
  // 站上工件的疊加層（效果）：檢測面上色、取像足跡；姿態跟著站上的工件
  const overlay = st => {
    const o = createPartInstance(new THREE.BufferGeometry(), mat, `overlay-${st}`); o.mesh.visible = false; scene.add(o.holder);
    Object.assign(o.holder.userData, { fx: true }); return o;
  };
  const ov = { ST1: overlay('ST1'), ST2: overlay('ST2') };
  const faceOverlay = {}, footMeshes = {};
  for (const st of ['ST1', 'ST2']) {
    const g = new THREE.Group(); g.name = `faces-${st}`; g.visible = false; ov[st].spin.add(g); g.position.z = ov[st].mesh.position.z; faceOverlay[st] = g;
    for (const f of FACES.filter(f => f.station === st)) {
      const m = new THREE.Mesh(subGeometry(faceTris(f.no), .04), new THREE.MeshBasicMaterial({ color: GROUP_COLOR[f.group], transparent: true, opacity: .55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.name = `face-${f.no}`; m.renderOrder = 6; g.add(m);
    }
  }
  for (const cam of CAMERAS) {
    const tris = decode(FOOTPRINT[cam.id].tris), masks = decode(FOOTPRINT[cam.id].masks), n = cam.frames || 1, list = [];
    const mat2 = new THREE.MeshBasicMaterial({ color: CAMERA_COLOR[cam.id], transparent: true, opacity: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let k = 0; k < n; k++) {
      const sel = []; for (let i = 0; i < tris.length; i++) if (masks[i] & (1 << k)) sel.push(tris[i]);
      const m = new THREE.Mesh(subGeometry(sel, .08), mat2); m.name = `foot-${cam.id}-${k}`; m.visible = false; m.renderOrder = 7;
      m.position.z = ov[cam.station].mesh.position.z; ov[cam.station].spin.add(m); list.push(m);
    }
    footMeshes[cam.id] = list;
  }
  scene.traverse(o => { if (o.name.startsWith('overlay-')) o.traverse(m => Object.assign(m.userData, { fx: true })); });

  // ---------------------------------------------------------------- 時間軸
  const tl = createTimeline();
  const tx = tl.track('xfer', { x: 0, lift: 0, out: 1, open: 1 });
  const tc = { ST1: tl.track('st1', { rot: 0, open: 0 }), ST2: tl.track('st2', { rot: 0, open: 0 }) };
  const tf = tl.track('flip', { ang: 180, open: 1 });                 // 起始：夾爪在上方（空），與穩態每拍開始時相同
  const ti = tl.track('intake', { s: 0, read: 0 });
  const ts = tl.track('sort', { push: 0, out: 0, ng: 0 });
  let st1Rot = 0;                                                     // ST1 夾頭的累計角度（每拍出站後是 360 的倍數）
  ti.add(INTAKE.convey, { s: 500 }, { action: '入料輸送：第 1 顆送到擋停', station: 0, ease: linear });
  ti.add(INTAKE.read, { read: 1 }, { action: 'P0 定位相機：判角＋讀 QR', sub: '開口側 3 耳輪廓判角度；序號＋流水號寫入檢測紀錄', station: 0 });
  ti.add(0, { read: 0, s: 0 });
  for (let c = 0; c < N_CYCLES; c++) {
    const T0 = cycleStart(c), sub = `第 ${c + 1} 拍`;
    // 移載段
    let t = T0;
    const at = {};
    for (const x of XFER) { at[x.key] = t; t += x.dur; }
    tx.add(.4, { out: 0 }, { at: at.forkIn, action: '夾叉伸入', sub: `${sub}：移載（全站停止）`, station: 1 });
    tx.add(.25, { open: 0 }, { at: at.forkClose, action: '夾叉閉合（夾 Ø100 法蘭側半段）', station: 1 });
    for (const st of ['ST1', 'ST2']) tc[st].add(.2, { open: 1 }, { at: at.release });
    tf.add(.2, { open: 1 }, { at: at.release });
    tx.add(LIFT_TIME, { lift: LIFT }, { at: at.lift, action: `移載上升 ${LIFT} mm`, station: 1 });
    tf.add(FLIP.turn, { ang: 0 }, { at: at.lift, action: '翻轉夾爪空回（經後側）', sub: '回到 0° 後移載才前進', station: 2 });
    tx.add(.7, { x: PITCH }, { at: at.move, action: `移載前進 ${PITCH} mm（P0→P1→P2→P3→P4）`, station: 2 });
    // ST1 夾頭空著時預轉：讓 3 爪對到這一顆（第 c 顆）的 0/120/240°
    let pre = st1Rot;
    if (c < N_PARTS) { const d = ((IN_ANGLE[c] - st1Rot) % 360 + 540) % 360 - 180; pre = st1Rot + d; tc.ST1.add(PRE_ROTATE, { rot: pre }, { at: at.move, action: `ST1 夾頭預轉 ${IN_ANGLE[c]}°（對準來料角度）`, station: 1 }); }
    tx.add(XFER.find(x => x.key === 'lower').dur, { lift: 0 }, { at: at.lower, action: '移載下降', station: 2 });
    for (const st of ['ST1', 'ST2']) tc[st].add(.25, { open: 0 }, { at: at.clamp, action: st === 'ST1' ? '夾頭閉合（3 爪夾開口側半段）' : '' });
    tf.add(.25, { open: 0 }, { at: at.clamp });
    tx.add(.2, { open: 1 }, { at: at.forkOpen, action: '夾叉張開', station: 2 });
    tx.add(.4, { out: 1 }, { at: at.forkOut, action: '夾叉退出', station: 2 });
    // 作業段
    const W = T0 + XFER_TIME;
    tx.add(RETURN, { x: 0 }, { at: W });
    // ST1：第 c 拍站上是第 c 顆
    if (c < N_PARTS) {
      tc.ST1.add(SHOTS.ST1.static, {}, { at: W, action: 'C1-1 頂視：光度立體 4 張＋亮場', sub: '面 1、4', station: 1 });
      tc.ST1.add(stationTime('ST1') - SHOTS.ST1.static, { rot: pre + 360 }, { action: 'ST1 旋轉 12 停取像（C1-2 面 2、C1-3 面 3、C1-4 反射鏡面 8、9）', sub: `每 30° 一張，${sub}`, station: 1, ease: linear, motion: (e, u) => ({ rot: pre + rotationAt('ST1', SHOTS.ST1.static + u * (stationTime('ST1') - SHOTS.ST1.static)) }) });
      const aligned = Math.round((pre + 360) / 360) * 360;
      tc.ST1.add(ALIGN, { rot: aligned }, { action: '出站轉正（轉回 0°）', station: 1 });
      st1Rot = aligned;
    }
    tf.add(FLIP.turn + FLIP.settle, { ang: 180 }, { at: W, action: c >= 1 ? '翻轉 180°（法蘭面朝上 → 開口朝上）' : '', station: 2 });
    if (c >= 2 && c - 2 < N_PARTS) {
      tc.ST2.add(SHOTS.ST2.static, {}, { at: W, action: 'C2-1 頂視同軸：杯底', sub: '面 7、10、12', station: 3 });
      tc.ST2.add(stationTime('ST2') - SHOTS.ST2.static, { rot: 360 }, { action: 'ST2 旋轉 12 停取像（C2-2 面 5、6，C2-4 面 11）', sub: `每 30° 一張，${sub}`, station: 3, ease: linear, motion: (e, u) => ({ rot: rotationAt('ST2', SHOTS.ST2.static + u * (stationTime('ST2') - SHOTS.ST2.static)) }) });
      tc.ST2.add(0, { rot: 0 });
    }
    if (c >= 3 && c - 3 < N_PARTS) {
      const k = c - 3, ng = NG_PARTS.includes(k);
      if (ng) {
        ts.add(SORT.ngPush, { push: NG_Z }, { at: W, action: `第 ${k + 1} 顆判 NG：推上 NG 輸送帶`, station: 4 });
        ts.add(SORT.ngBack, { push: 0 });
        ts.add(SORT.ng, { ng: 420 }, { at: W + SORT.ngPush, action: 'NG 輸送帶送到緩衝末端（可存 8～10 顆）', station: 4, ease: linear });
      }
      else { ts.add(SORT.ok, { out: 600 }, { at: W, action: `第 ${k + 1} 顆判 OK：出料輸送帶帶走`, station: 4, ease: linear }); ts.add(0, { out: 0 }); }
    }
    if (c + 1 < N_PARTS) {
      ti.add(INTAKE.convey, { s: 500 }, { at: W, action: `入料輸送：第 ${c + 2} 顆送到擋停`, station: 0, ease: linear });
      ti.add(INTAKE.read, { read: 1 }, { action: 'P0 定位相機：判角＋讀 QR', station: 0 });
      ti.add(0, { read: 0, s: 0 });
    }
    tx.hold(T0 + CT);
  }
  const total = cycleStart(N_CYCLES);

  // ---------------------------------------------------------------- 工件在時間 T 的位置
  const tmp = new THREE.Vector3();
  function cycleAt(T) { return T < INTRO ? -1 : Math.min(N_CYCLES - 1, Math.floor((T - INTRO) / CT)); }
  // 回傳 { where: 'park'|'intake'|位置編號, pos, q, spin, carried }
  function partState(k, T, S) {
    const enterEnd = k === 0 ? INTAKE.convey : cycleStart(k - 1) + XFER_TIME + INTAKE.convey;
    const enterStart = enterEnd - INTAKE.convey;
    if (T < enterStart) return null;
    if (T < enterEnd) {
      const s = (T - enterStart) / INTAKE.convey;
      return { pos: new THREE.Vector3(LINE.x[0] - 500 * (1 - s), LINE.band, 0), q: orientQ('ST1'), spin: IN_ANGLE[k], p: -1 };
    }
    const c = cycleAt(T), tau = T - cycleStart(Math.max(c, 0));
    if (c < k) return { pos: stationCenter(0), q: orientQ('ST1'), spin: IN_ANGLE[k], p: 0 };
    const pBefore = c - k, inXfer = tau < XFER_TIME;
    const p = inXfer ? pBefore : pBefore + 1;
    if (inXfer && pBefore <= 3) {
      const pos = stationCenter(pBefore).add(tmp.set(S.xfer.x, S.xfer.lift, 0));
      return { pos, q: pBefore >= 2 ? orientQ('ST2') : orientQ('ST1'), spin: pBefore === 0 ? IN_ANGLE[k] : 0, p: pBefore, carried: true };
    }
    if (p === 1) return { pos: stationCenter(1), q: orientQ('ST1'), spin: S.st1.rot % 360, p };
    if (p === 2) return { pos: stationCenter(2), q: orientQ('ST1', S.flip.ang), spin: 0, p };
    if (p === 3) return { pos: stationCenter(3), q: orientQ('ST2'), spin: S.st2.rot % 360, p };
    if (p === 4) {
      // 分料：只在第 c 拍（c = k+3）的作業段；之後離開機台
      const ng = NG_PARTS.includes(k), base = stationCenter(4);
      // NG 件推上 NG 輸送帶後留在緩衝末端（動畫只有一顆 NG）；OK 件由出料輸送帶帶走後離開畫面
      if (ng && (c > k + 3 || (c === k + 3 && !inXfer))) {
        const pushed = c > k + 3 || tau - XFER_TIME >= SORT.ngPush;
        return { pos: base.add(tmp.set(pushed ? (c > k + 3 ? 420 : S.sort.ng) : 0, 0, pushed ? -NG_Z : -S.sort.push)), q: orientQ('ST2'), spin: 0, p };
      }
      if (c > k + 3 || (c === k + 3 && tau >= XFER_TIME + STATION_TIMES.分料)) return null;
      if (c === k + 3 && !inXfer) return { pos: base.add(tmp.set(S.sort.out, 0, 0)), q: orientQ('ST2'), spin: 0, p };
      return { pos: base, q: orientQ('ST2'), spin: 0, p };
    }
    return null;
  }

  function apply(T) {
    const S = tl.sample(T), c = cycleAt(T), tau = c < 0 ? 0 : T - cycleStart(c), W = c < 0 ? Infinity : cycleStart(c) + XFER_TIME;
    xfer.set(S.xfer);
    chuck1.set(S.st1.rot % 360, S.st1.open); chuck2.set(S.st2.rot % 360, S.st2.open);
    flip.set(S.flip.ang, S.flip.open);
    sorter.set(S.sort.push);
    conv.inC.set({ s: S.intake.s }); conv.outC.set({ s: S.sort.out }); conv.ngC.set({ s: S.sort.ng });
    optics.locator.set(S.intake.read > .5 ? 1 : 0);
    const atStation = { ST1: null, ST2: null };
    for (const part of parts) {
      const st = partState(part.k, T, S);
      if (!st || st.hide) { Object.assign(part.holder.userData, { at: null, carried: false, lifted: false }); part.holder.visible = false; part.set(new THREE.Vector3(-3000 - part.k * 300, -1500, -2500), orientQ('ST1'), 0); continue; }
      part.holder.visible = true; part.set(st.pos, st.q, st.spin);
      Object.assign(part.holder.userData, { at: st.p, carried: !!st.carried, lifted: !!st.carried && S.xfer.lift > .5 });   // 干涉檢查的接觸放行用
      if (!st.carried && st.p === 1) atStation.ST1 = st;
      if (!st.carried && st.p === 3) atStation.ST2 = st;
    }
    // 取像：閃光、足跡、光度立體分區依序亮
    const tRel = T - W;
    for (const st of ['ST1', 'ST2']) {
      const s = atStation[st], o = ov[st];
      o.holder.visible = !!s;
      if (s) o.set(s.pos, s.q, s.spin);
    }
    for (const cam of CAMERAS) {
      const present = !!atStation[cam.station] && tRel >= 0 && tRel < CT;
      const k = present ? shotAt(cam.id, tRel) : -1, O = optics.cams[cam.id];
      footMeshes[cam.id].forEach((m, i) => { m.visible = i === k; });
      O.vc.set(k >= 0 ? 1 : 0);
      O.lights.forEach((L, i) => {
        // 光度立體：靜態取像期間依序亮 4 區（C1-1）；C2-2 的左右條形光在取像時亮
        let on = k >= 0;
        if (cam.id === 'C1-1' && k >= 0) on = Math.floor((tRel / SHOTS.ST1.static) * 5) % 5 === i || Math.floor((tRel / SHOTS.ST1.static) * 5) === 4;
        if (L.set) L.set({ light: on ? 1 : .08 }); else if (L.material) L.material.emissiveIntensity = on ? 1.4 : .05;
      });
    }
    indicators.tower.set(T < total - .01 ? 'green' : 'yellow');
    return S;
  }

  const stationStart = STATIONS.map((_, i) => {
    const ev = tl.events.filter(e => e.station === i); return ev.length ? Math.min(...ev.map(e => e.start)) : 0;
  });

  // ---------------------------------------------------------------- 空間與規格檢核（面板「空間檢核」與 tools/verify.mjs 共用）
  function layoutChecks() {
    const rows = [], F = SUMMARY.faces, C = SUMMARY.cameras;
    for (const f of FACES) rows.push({ group: '取像覆蓋', name: `面 ${f.no} ${f.name}（${F[f.no].cameras.join('、')}）`, ok: F[f.no].coverage >= 99 && F[f.no].lit >= 99, value: `${F[f.no].coverage}%／照明 ${F[f.no].lit}%` });
    for (const cam of CAMERAS) {
      const c = C[cam.id], worst = Math.max(...Object.values(c.perFace).map(s => s.mmpx?.[1] ?? 9));
      rows.push({ group: '解析度與景深', name: `${cam.id} 有效解析度 ≤ ${TARGET_MMPX} mm/px、景深 ${c.dof} mm ≥ 需求 ${c.span} mm`, ok: worst <= TARGET_MMPX && c.dof >= c.span, value: `${worst} mm/px、b ${c.bDesign} mm、F${c.N}` });
    }
    // 高反光加工面：每台相機每個面要「整面暗場」或「整面亮場」，不能有局部反光（亮斑、亮線）；反光散開 4° 為設計值、8° 為餘裕
    for (const cam of CAMERAS) for (const f of cam.faces) {
      const pf = C[cam.id].perFace[f];
      rows.push({ group: '反光', name: `${cam.id} 面 ${f} 沒有局部反光（散開 4°／8°）`, ok: pf.glare !== '局部反光' && pf.glare8 !== '局部反光', value: `${pf.glare}／${pf.glare8}` });
    }
    // 杯內照明：同軸（C2-1）入射角要小於面 12 外緣的近側上限 atan((14−13.25)/8.2)
    const lim12 = Math.atan((14 - 13.25) / 8.2) * 180 / Math.PI, inc12 = C['C2-1'].perFace[12].inc?.[1] ?? 99;
    rows.push({ group: '照明', name: `面 12 入射角 ≤ atan(R/H) = ${lim12.toFixed(1)}°（Ø28 孔底，只能同軸）`, ok: inc12 <= lim12, value: `${inc12}°` });
    const lim10 = Math.atan((46.8 - 17.05) / 55) * 180 / Math.PI, inc10 = C['C2-1'].perFace[10].inc?.[1] ?? 99;
    rows.push({ group: '照明', name: `面 10 入射角 ≤ ${lim10.toFixed(1)}°（凸台外緣、越過杯口凸緣）`, ok: inc10 <= lim10, value: `${inc10}°` });
    // 節拍與軸數
    rows.push({ group: '節拍', name: 'CT ≤ 15 s（規格）', ok: CT <= 15, value: `${CT.toFixed(1)} s` });
    rows.push({ group: '節拍', name: 'CT ≤ 12 s（挑戰）', ok: CT <= 12, value: `瓶頸 ${BOTTLENECK} ${STATION_TIMES[BOTTLENECK].toFixed(2)} s＋移載 ${XFER_TIME.toFixed(2)} s` });
    rows.push({ group: '節拍', name: '伺服軸 ≤ 6', ok: SERVO_AXES.length <= 6, value: `${SERVO_AXES.length} 軸` });
    // 夾持：只碰 Ø100 外圓帶、避開凹面板、同時夾同一顆的兩組夾具錯開
    const inPanel = a => { const x = ((a % 360) + 360) % 360; return x > GRIP_BAND.panel[0] - 10 && x < GRIP_BAND.panel[1] + 10; };
    const all = [...JAWS.angles, ...FINGERS.angles, ...FLIP_FINGERS.angles];
    rows.push({ group: '夾持', name: '夾點避開 150–210° 凹面板（含 ±10° 爪寬）', ok: !all.some(inPanel), value: all.join('／') + '°' });
    const inBand = z => z[0] >= GRIP_BAND.z[0] && z[1] <= GRIP_BAND.z[1];
    rows.push({ group: '夾持', name: '夾持高度都在 Ø100 外圓帶 Z −45 ~ −16 內', ok: [JAWS.z, FINGERS.z, FLIP_FINGERS.z].every(inBand), value: `${JAWS.z.join('~')}／${FINGERS.z.join('~')}／${FLIP_FINGERS.z.join('~')}` });
    const sep = (a, b) => a[1] <= b[0] || b[1] <= a[0];
    rows.push({ group: '夾持', name: '交接時兩組夾具分在帶的兩個半段（夾頭↔夾叉、翻轉↔夾叉）', ok: sep(JAWS.z, FINGERS.z) && sep(FLIP_FINGERS.z, FINGERS.z), value: '開口側半段／法蘭側半段' });
    // 抬升路徑淨空：ST1 光度立體環光、ST2 光度立體條光都要高過抬升中的工件
    const ringAt = CAMERAS.find(c => c.id === 'C1-1').light.at;
    const topST1 = LINE.band + worldBand('ST1', [-69, -69])[0] + LIFT, ringY = LINE.band + worldBand('ST1', [ringAt, ringAt])[0] - 9;
    rows.push({ group: '空間', name: 'ST1 環光下緣高過抬升中的工件頂', ok: ringY - topST1 >= 10, value: `${(ringY - topST1).toFixed(1)} mm` });
    const c22 = CAMERAS.find(c => c.id === 'C2-2'), psZ = c22.target[2] + c22.light.h;
    const topST2 = LINE.band + worldBand('ST2', [1.5, 1.5])[0] + LIFT, barY = LINE.band + worldBand('ST2', [psZ, psZ])[0] - 15;
    rows.push({ group: '空間', name: 'ST2 光度立體條光下緣高過抬升中的工件頂', ok: barY - topST2 >= 5, value: `${(barY - topST2).toFixed(1)} mm` });
    // ST1 反射鏡探頭：抬升後工件最低點（凸緣頂）要高過探頭最深處（鏡底）
    const m14 = CAMERAS.find(c => c.id === 'C1-4').mirror, mirrorDeep = m14.point[2] - m14.halfU * Math.SQRT1_2;
    const probeTop = LINE.band + worldBand('ST1', [mirrorDeep, mirrorDeep])[0], partBottom = LINE.band + worldBand('ST1', [1.5, 1.5])[0] + LIFT;
    rows.push({ group: '空間', name: 'ST1 抬升中的工件越過反射鏡探頭', ok: partBottom - probeTop >= 15, value: `${(partBottom - probeTop).toFixed(1)} mm` });
    rows.push({ group: '空間', name: 'ST1 反射鏡在杯內的最大半徑小於內壁 46.5 mm', ok: Math.hypot(m14.point[0] + m14.halfU * Math.SQRT1_2, m14.halfV) <= 44, value: `${Math.hypot(m14.point[0] + m14.halfU * Math.SQRT1_2, m14.halfV).toFixed(1)} mm` });
    return rows;
  }

  return {
    total, timeline: tl, apply, stationStart, parts, optics, footMeshes, faceOverlay, overlay: ov, cycleTime: CT,
    layoutChecks,
    verify: {
      dt: .08,
      skip: o => !!o.userData.fx,
      allow: [
        { why: '工件與夾持、承載件的接觸，只在工件確實在該位置時放行：夾頭爪頭（在 ST1／ST2 且未抬起）、翻轉指墊（在 P2 且未抬起）、移載指墊（搬運中或停在任一位置）、入料輸送與置中導引（P0）、出料與 NG 輸送、NG 推板（P4）。接觸件以 userData.contact 標記', test: (a, b, ctx) => {
          const part = [a, b].find(m => ctx.moduleOf(m) === 'part'), other = part === a ? b : a;
          if (!part || !other || !hasContact(other)) return false;
          const h = holderOf(part).userData, mod = ctx.moduleOf(other);
          if (mod === 'chuck-st1') return h.at === 1 && !h.lifted;
          if (mod === 'chuck-st2') return h.at === 3 && !h.lifted;
          if (mod === 'flip') return h.at === 2 && !h.lifted;
          if (mod === 'transfer') return h.at != null;
          if (mod === 'conveyors') return h.at === 0 || h.at === -1 || h.at === 4;
          if (mod === 'sorter') return h.at === 4;
          return false;
        } },
        { why: '工件彼此：停在機台外的待投入／已離開工件放在地面下方各自的位置，不會重疊；同一拍搬運時相鄰工件相距 450 mm', test: (a, b, ctx) => ctx.moduleOf(a) === 'part' && ctx.moduleOf(b) === 'part' && (!visibleChain(a) || !visibleChain(b)) },
        { why: '移載夾叉的夾臂在夾爪本體／夾叉樑上滑動開合（同一組夾爪）', test: (a, b) => [a, b].some(m => under(m, 'fork-arm')) && [a, b].some(m => under(m, 'fork-slide') && !under(m, 'fork-arm')) },
        { why: '翻轉夾指在 U 形本體上滑動開合（同一組夾爪）', test: (a, b) => [a, b].some(m => under(m, 'flip-finger')) && [a, b].some(m => under(m, 'flip-rotor') && !under(m, 'flip-finger')) },
      ],
      envelope: ['transfer', 'flip'],
    },
  };

}
function faceTris(no) {
  const out = [], { triFace, nt } = bodyData();
  for (let t = 0; t < nt; t++) if (triFace[t] === no) out.push(t);
  return out;
}
const hasContact = m => { for (let p = m; p; p = p.parent) if (p.userData?.contact) return true; return false; };
const holderOf = m => { let p = m; while (p.parent && p.name !== 'part') p = p.parent; return p; };
const under = (m, name) => { for (let p = m; p; p = p.parent) if (p.name === name) return true; return false; };
const visibleChain = m => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; };
