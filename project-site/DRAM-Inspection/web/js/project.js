// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 一片載台（主機板 PCB，4 個 SOCAMM 槽位）的完整節拍：載台進站定位 → Tray 上面檢查 → SCARA 依序植入 4 片 interposer（底面 3D 掃描、覆拍修正、
// 三點入位高度）→ 4 片 SOCAMM（離子風刀、底面檢查、髒污件 IPA 擦拭＋吹乾 10 s＋複檢）→ 鎖附模組逐槽壓持、三螺絲預鎖＋終鎖 → 出站。
// 所有時間由 core 的時間軸（createTimeline）決定：倒播、跳播結果相同。數字都是示意值。
import * as THREE from 'three';
import { createDetails } from './details.js';
import { createElectrical } from './electrical.js';
import { createTimeline } from '@core/anim/track.js';
import { floor } from '@core/geom/environment.js';
import { MAT } from '@core/geom/materials.js';
import { createBoard, createCarrier, createInterposer, createSocamm, createScrew, createTray, SLOTS, MOD, INT, SOC, SCREW, TRAY, TRAY_SEAT, CARRIER, pocketZ, FIDUCIALS } from './parts.js';
import { LAY, LIFT, PCB_TOP, INT_Y, SOC_Y, SOC_TOP, CARRIER_D, LOCK, MAG, magRail, buildFrame, buildIndicators, buildConveyor, buildTrayLane, buildStations, buildLocker } from './machine.js';
import { createRobot, ikWorld, fkWorld, ptpTime, OFF } from './robot.js';
import { HSR065 } from '@core/models/robots/denso-hsr065.js';

export { LAY };
export const STATIONS = ['載台進站定位', 'Tray 上面檢查', 'interposer 取放', 'SOCAMM 清潔取放', '壓持鎖附', '出站'];
export const SCENARIOS = {
  ok: { name: '全部良品（穩態節拍基準）', dirty: [], stillDirty: [], badPin: [] },
  clean: { name: 'SOCAMM #2 髒污 → IPA 擦拭吹乾後複檢 OK', dirty: [1], stillDirty: [], badPin: [] },
  'ng-clean': { name: 'SOCAMM #2 清潔後仍髒污 → NG 盒，改取備品', dirty: [1], stillDirty: [1], badPin: [] },
  'ng-pin': { name: 'interposer #3 底面 PIN 歪斜 → NG 盒，改取備品', dirty: [], stillDirty: [], badPin: [2] },
};
// 鎖附參數（示意，待實物與螺絲規格確認）：預鎖 600 rpm 到貼合（低扭力）、終鎖 60 rpm 到目標扭力
export const TORQUE = { preRpm: 600, preNm: .08, finRpm: 60, finNm: .20, finTurn: .12, preTurns: 9 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;
const STEP = t => (t > 0 ? 1 : 0);
const SAFE_D3 = 20;                                   // 手臂移動高度：法蘭 1090（TCP 約 1012）

export function createProject({ scene, scenario = 'clean' } = {}) {
  const SC = SCENARIOS[scenario] || SCENARIOS.clean;
  floor(scene, { size: [4200, 3600], cell: 200 });
  const frame = buildFrame(scene), ind = buildIndicators(scene), conv = buildConveyor(scene);
  const lanes = { I: buildTrayLane(scene, 'I'), S: buildTrayLane(scene, 'S') };
  const st = buildStations(scene), locker = buildLocker(scene), robot = createRobot(scene);
  const elec = createElectrical(scene, { robot });

  // ---------------------------------------------------------------- 產品
  const carrier = createCarrier(CARRIER_D); scene.add(carrier);
  const board = createBoard(); scene.add(board);
  // Tray：每道 3 盤（A 在叉板上使用中、B／C 滿盤在料倉第 1、2 層；第 0 層空著等 A 用完送回）。
  // A 只剩這片載台要用的數量（4 片＋本情境會用到的備品），取完就自動換盤
  const need = { I: 4 + SC.badPin.length, S: 4 + SC.stillDirty.length };
  const trays = {}, spec = { I: [], S: [] };
  for (const kind of ['I', 'S']) {
    trays[kind] = ['A', 'B', 'C'].map(n => { const t = createTray(`tray-${kind}-${n}`, kind === 'I' ? 'INTERPOSER TRAY' : 'SOCAMM TRAY'); scene.add(t); return t; });
    for (let k = 0; k < need[kind]; k++) spec[kind].push({ tray: 0, pocket: k });          // 從靠手臂的格位開始用
    for (const tr of [1, 2]) for (let k = 0; k < TRAY.pockets; k++) spec[kind].push({ tray: tr, pocket: k });
  }
  const ints = spec.I.map((_, n) => { const p = createInterposer('interposer-' + (n + 1)); scene.add(p); return p; });
  const socs = spec.S.map((_, n) => { const p = createSocamm('socamm-' + (n + 1), { dirty: SC.dirty.includes(n) }); scene.add(p.root); return p; });
  const screws = Array.from({ length: 12 }, (_, n) => { const s = createScrew(`screw-${Math.floor(n / 3) + 1}-${n % 3 + 1}`); scene.add(s); return s; });

  const details = createDetails({ scene, ints, st, locker });

  // ---------------------------------------------------------------- 時間軸
  const tl = createTimeline();
  const insp = [];                                     // 檢查與量測紀錄（影像追溯）：{ t, cam, part, item, result, value }
  const heights = [];                                  // 入位高度：{ t, slot, kind, values }
  const screwLog = [];                                 // 每顆螺絲：{ slot, hole, pre:[t0,t1], fin:[t0,t1] }
  const reach = [];                                    // 手臂作業點（layoutChecks）
  // 載台、Tray、站、鎖附
  const cv = tl.track('conv', { cx: -760, s: 0, stopUp: 1, up: 0 });
  const tI = tl.track('trayI', { z: LAY.tray.load, laser: 0, flash: 0 });
  const tS = tl.track('trayS', { z: LAY.tray.load, flash: 0 });
  const sta = tl.track('st', { prof: 0, cam: 0, blow: 0, wipeUp: 0, tape: 0, drop: 0, dry: 0 });
  const lk = tl.track('lock', { x: LAY.locker.park, press: 0, nz: LOCK.feedZ, ny: 0, dy: 0, turns: 0, beam: 0 });
  // 零件：loc ＝ tray／A／B／slot／free（自由落下到 NG 盒）／hidden
  const pI = ints.map((_, n) => tl.track('i' + n, { loc: 'tray', tr: spec.I[n].tray, k: spec.I[n].pocket, slot: -1, x: 0, y: 0, z: 0, yaw: 0 }));
  const pS = socs.map((_, n) => tl.track('s' + n, { loc: 'tray', tr: spec.S[n].tray, k: spec.S[n].pocket, slot: -1, x: 0, y: 0, z: 0, yaw: 0, press: 0, dirty: SC.dirty.includes(n) ? 'y' : 'n' }));
  // 升降料倉（e：升降量）與每個 Tray 的位置（fork 叉板上／mag 料倉第 lvl 層）
  const elev = { I: tl.track('elevI', { e: -MAG.lift }), S: tl.track('elevS', { e: -MAG.lift }) };
  const trT = {}; for (const kind of ['I', 'S']) trT[kind] = [0, 1, 2].map(j => tl.track(`tr${kind}${j}`, { loc: j ? 'mag' : 'fork', lvl: j }));
  const pW = screws.map((_, n) => tl.track('w' + n, { loc: 'hidden', rem: TORQUE.preTurns, rot: 0, slot: -1, hole: -1 }));

  // ---- 1. 載台進站：輸送 → 止擋 → 頂升定位（定位銷插入、載台上推靠壓邊）
  const inDur = 2.6;
  cv.add(inDur, { cx: LAY.work, s: 760 }, { action: '載台進站', sub: '邊皮帶輸送，止擋升起', station: 0 });
  cv.add(.7, { up: 1 }, { action: '頂升定位', sub: '定位銷插入載台襯套孔、上推 0.9 mm 靠壓邊（不從側邊推）', station: 0 });
  const tLocated = cv.t;
  // ---- 2. Tray 上面檢查：抽屜從裝盤位經檢查橋到取料位（頂面 PIN 3D＋鍍金接點 2D／SOCAMM 正面 2D）
  // 抽屜從裝盤位（前門）往後送，所有格位依序通過檢查橋（橋在 Z 645）
  const scanA = LAY.tray.load, scanB = LAY.tray.scan - TRAY.d / 2 - 8;
  tI.add(.5, { laser: 1 }, { action: 'interposer Tray 送入', sub: '抽屜伺服滑台；檢查橋 3D 雷射開啟', station: 1, ease: STEP });
  tI.add(3.0, { z: scanB }, { action: 'interposer 頂面掃描', sub: '大視野 3D 線雷射：8 格頂面 PIN 尖端高度、歪斜與平整度；2D 同軸光拍鍍金接點', station: 1, ease: t => t });
  tI.add(0, { laser: 0 });
  tI.add(.6, { z: LAY.tray.pick }, { action: 'interposer Tray 到取料位', station: 1 });
  tS.add(.5, {}, { action: 'SOCAMM Tray 送入', sub: '抽屜伺服滑台', station: 1 });
  tS.add(3.0, { z: scanB, flash: 1 }, { action: 'SOCAMM 正面檢查', sub: '2D 相機＋雙側低角度條形光，逐格拍正面外觀', station: 1, ease: t => t });
  tS.add(0, { flash: 0 });
  tS.add(.6, { z: LAY.tray.pick }, { action: 'SOCAMM Tray 到取料位', station: 1 });
  // 掃描時每格通過檢查橋的時間 → 檢查紀錄
  const scanLog = (kind, trayIdx, t0) => spec[kind].forEach((sp, n) => {
    if (sp.tray !== trayIdx) return;
    const tt = t0 + (scanA - (LAY.tray.scan - pocketZ(sp.pocket))) / (scanA - scanB) * 3.0;
    if (kind === 'I') insp.push({ t: +tt.toFixed(2), cam: 'TOP-3D', part: `INT-${n + 1}`, item: '頂面 PIN 高度／歪斜、平整度', result: 'OK', value: `共面度 ${(18 + (n * 7) % 11)} µm` });
    else insp.push({ t: +(tt + .02).toFixed(2), cam: 'TOP-2D', part: `SOC-${n + 1}`, item: '正面外觀', result: 'OK', value: '刮傷 0、異物 0' });
  });
  scanLog('I', 0, .5); scanLog('S', 0, .5);
  // 換盤：空盤送回料倉第 0 層 → 料倉上升托離叉板 → 叉板退出 → 料倉下降一層（滿盤對準叉板）→ 叉板伸入 → 料倉下降、滿盤落在叉板 → 掃描 → 取料位
  function exchange(kind, at) {
    const tt = kind === 'I' ? tI : tS, el = elev[kind], [A, B] = trT[kind], nm = kind === 'I' ? 'interposer' : 'SOCAMM', so = { station: kind === 'I' ? 2 : 3 };
    const s1 = tt.add(1.0, { z: LAY.tray.load }, { at, action: `${nm} 空 Tray 回料倉`, sub: '本盤已取完，抽屜把空盤送回升降料倉第 0 層', ...so });
    const s2 = el.add(.5, { e: MAG.lift }, { at: s1.start + s1.dur, action: '料倉上升，空盤上架', sub: '層架托條把空盤托離叉板 3 mm', ...so });
    A.add(0, { loc: 'mag', lvl: 0 }, { at: s2.start + s2.dur / 2 });
    const s3 = tt.add(.6, { z: LAY.tray.out }, { at: s2.start + s2.dur, action: '叉板退出料倉', ...so });
    const s4 = el.add(.9, { e: -MAG.pitch + MAG.lift }, { at: s3.start + s3.dur, action: '料倉下降一層', sub: '第 1 層滿盤對準叉板高度（空盤移到下方，等人員取出）', ...so });
    const s5 = tt.add(.6, { z: LAY.tray.load }, { at: s4.start + s4.dur, action: '叉板伸入滿盤下方', ...so });
    const s6 = el.add(.5, { e: -MAG.pitch - MAG.lift }, { at: s5.start + s5.dur, action: '滿盤落在叉板', sub: '料倉再下降 6 mm，叉板真空吸附', ...so });
    B.add(0, { loc: 'fork', lvl: 1 }, { at: s6.start + s6.dur / 2 });
    const k = kind === 'I' ? 'laser' : 'flash';
    const s7 = tt.add(.3, { [k]: 1 }, { at: s6.start + s6.dur, action: `新 ${nm} Tray 上面檢查`, sub: kind === 'I' ? '頂面 PIN 3D＋鍍金接點 2D' : '正面 2D', ...so, ease: STEP });
    tt.add(3.0, { z: scanB }, { ease: t => t }); tt.add(0, { [k]: 0 });
    tt.add(.6, { z: LAY.tray.pick }, { action: `新 ${nm} Tray 到取料位`, ...so });
    scanLog(kind, 1, s7.start + s7.dur - .5);
  }
  const lastPick = { I: 0, S: 0 };

  // ---- 3. SCARA
  const home = V(LAY.st.camI[0], 0, LAY.st.camI[1]);
  const yAt = (key, d3) => fkWorld({ j1: 0, j2: 0, d3, j4: 0 }, key).p.y;
  let elbow = 1;                                       // 肘向：interposer（西側）+1、SOCAMM（東側）−1；換向時先經過伸直的過渡點
  let q = ikWorld('A', V(home.x, yAt('A', SAFE_D3), home.z), 0, { j1: 0, j2: 0, d3: 0, j4: 0 }, elbow);
  const rb = tl.track('robot', { ...q, A: 0, B: 0, gA: 0, gB: 0, flash: 0, beamLen: 0 });
  let cur = { A: 0, B: 0 };
  const solve = (key, p, yaw, label) => {
    const qn = ikWorld(key, p, yaw, q, elbow);
    reach.push({ label, key, p: p.toArray().map(v => +v.toFixed(1)), ok: !!qn, j2: qn ? qn.j2 / D2R : null });
    if (!qn) throw new Error(`SCARA 到不了 ${label}：${p.toArray().map(Math.round)}`);
    return qn;
  };
  const moveJ = (qn, dur, extra = {}, o = {}) => { const s = rb.add(dur ?? ptpTime(q, qn), { ...qn, ...extra }, o); q = qn; return s; };
  const hold = (dur, extra = {}, o = {}) => rb.add(dur, extra, { ease: STEP, ...o });
  const up = (o = {}, extra = {}) => { if (q.d3 > SAFE_D3 + .01) moveJ({ ...q, d3: SAFE_D3 }, Math.max(.18, 1.875 * (q.d3 - SAFE_D3) / HSR065.speed.d3 * 1.2), extra, o); else if (Object.keys(extra).length) hold(.2, extra, o); };
  // 移到目標上方（安全高度），然後下降：先快速到 +slow，最後 slow mm 慢速
  function goTo(key, p, yaw, label, o = {}, { slow = 6, slowDur = .3, ext } = {}) {
    up();
    const above = solve(key, V(p.x, yAt(key, SAFE_D3), p.z), yaw, label);
    const extra = ext ? { A: ext === 'A' ? 1 : 0, B: ext === 'B' ? 1 : 0 } : {};
    moveJ(above, Math.max(ptpTime(q, above), ext && !cur[ext] ? .35 : 0), extra, o);
    if (ext) cur = { A: +(ext === 'A'), B: +(ext === 'B') };
    const near = solve(key, p.clone().add(V(0, slow, 0)), yaw, label);
    moveJ(near, Math.max(.15, 1.875 * Math.abs(near.d3 - q.d3) / HSR065.speed.d3 * 1.2));
    const at = solve(key, p, yaw, label);
    moveJ(at, slowDur, {}, { ease: t => t });
    return at;
  }
  // 沿直線移動（掃描、擦拭）：每個取樣點即時逆解，路徑 fn(e) → 世界座標
  function line(key, fn, yaw, dur, o = {}, extra = {}) {
    const q0 = { ...q };
    const solveAt = e => { const p = fn(e), qn = ikWorld(key, p, yaw, q0, elbow); if (!qn) throw new Error('直線段到不了 ' + p.toArray().map(Math.round)); return qn; };
    const qEnd = solveAt(1);
    reach.push({ label: o.label || o.action || '直線段', key, p: fn(.5).toArray().map(v => +v.toFixed(1)), ok: true, j2: solveAt(.5).j2 / D2R });
    const s = rb.add(dur, { ...qEnd, ...extra }, { ...o, ease: t => t, motion: e => { const qe = solveAt(e); return { j1: qe.j1, j2: qe.j2, d3: qe.d3, j4: qe.j4 }; } });
    q = qEnd; return s;
  }
  // 換肘向：先到輸送線東側上方、手臂幾乎伸直的過渡點（J2 ≈ 0），避免在兩個作業區之間甩臂
  function flip(sign, o = {}) {
    if (Math.sign(q.j2) === sign) { elbow = sign; return; }
    up();
    const dir = V(.62, 0, -.785).normalize(), via = V(LAY.robot.x, yAt('cam', SAFE_D3), LAY.robot.z).add(dir.multiplyScalar(640));
    elbow = sign;
    const qv = solve('cam', via, q.j1 + q.j2 + q.j4 + Math.PI, '換肘向過渡點');
    moveJ(qv, null, {}, o);
  }
  const head = { I: 'A', S: 'B' };
  const top = { I: INT.t, S: SOC.t };                  // 夾持時零件頂面到零件原點
  const tray = { I: lanes.I, S: lanes.S };
  const trayPick = (kind, n) => V(LAY.lane[kind], LAY.trayBottom + .05 + TRAY_SEAT + (kind === 'I' ? INT.bossH : 0) + .02 + top[kind], LAY.tray.pick + pocketZ(spec[kind][n].pocket));
  const slotPt = (k, y) => V(LAY.work + SLOTS[k], y, 0);
  const holeW = (k, i) => V(LAY.work + SLOTS[k], 0, -MOD.holes[i]);

  // 取料（三孔頭下降、漲緊銷插入、夾持）
  function pick(kind, k, partTrack, station) {
    const h = head[kind], p = trayPick(kind, k);
    goTo(h, p, 0, `${kind} Tray 第 ${spec[kind][k].pocket + 1} 格`, { action: `取 ${kind === 'I' ? 'interposer' : 'SOCAMM'} #${k + 1}`, sub: `${kind === 'I' ? 'A' : 'B'} 頭伸出，三孔頭下到 Tray`, station }, { ext: h });
    const g = hold(.3, { ['g' + h]: 1 }, { action: '三孔漲緊夾持', sub: '漲緊銷插入三個孔、肩部壓在孔周（不碰 PIN 區）', station });
    partTrack.add(0, { loc: h }, { at: g.start + g.dur });
    up({ action: '取起', station });
    lastPick[kind] = rb.t;
  }
  function release(h, partTrack, loc, extra = {}, o = {}) {
    const g = hold(.25, { ['g' + h]: 0 }, o);
    partTrack.add(0, { loc, ...extra }, { at: g.start });
    return g;
  }
  // 上視相機覆拍（取起後修正位置）＋底面外觀
  function upCam(kind, partName, station, recheck = false) {
    const h = head[kind], [x, z] = LAY.st[kind === 'I' ? 'camI' : 'camS'];
    const p = V(x, st.camFront + 75 + (kind === 'I' ? INT.pin + INT.t : SOC.t), z);
    goTo(h, p, 0, `上視相機 ${kind}`, { action: `${recheck ? '複檢' : '覆拍'} ${partName}`, sub: kind === 'I' ? '上視 20 MP：三孔位置修正量、底面外觀' : '上視 20 MP：底面焊墊髒污、刮傷；三孔位置修正量', station }, { slow: 4, slowDur: .2 });
    const s = hold(.18, { flash: 1 }, { action: '取像', sub: '同軸＋環形光頻閃', station });
    sta.add(0, { cam: kind === 'I' ? 1 : 2 }, { at: s.start }); sta.add(0, { cam: 0 }, { at: s.start + s.dur });
    hold(.05, { flash: 0 });
    return s;
  }

  // ---- 3a. interposer × 4
  const intForSlot = [];
  let nextI = 0;
  const tStartRobot = Math.max(tI.end, 0);
  rb.add(0, {}, { at: tStartRobot });
  rb.hold(tStartRobot);
  for (let slot = 0; slot < 4; slot++) {
    let k, okPart = false;
    while (!okPart) {
      k = nextI++;
      const P = pI[k], name = `interposer #${k + 1}`;
      pick('I', k, P, 2);
      // 底面 3D 掃描：零件沿 X 飛越朝上的線雷射（PIN 尖端高度、歪斜、整片平整度）
      const [px, pz] = LAY.st.prof, yScan = st.profWin + 47.5 + INT.pin + INT.t;
      goTo('A', V(px - 60, yScan, pz), 0, '底面 3D 起點', { action: `${name} 底面 3D 掃描`, sub: '飛越朝上的 3D 線雷射', station: 2 }, { slow: 4, slowDur: .2 });
      const sc = line('A', e => V(px - 60 + 120 * e, yScan, pz), 0, 1.2, { action: `${name} 底面 PIN 掃描`, sub: 'PIN 尖端高度／歪斜、三凸點與整片平整度（上下兩面合併判定）', station: 2 });
      sta.add(0, { prof: 1 }, { at: sc.start }); sta.add(0, { prof: 0 }, { at: sc.start + sc.dur });
      const bad = SC.badPin.includes(slot) && !intForSlot.some(v => v.retried === slot);
      insp.push({ t: +(sc.start + sc.dur).toFixed(2), cam: 'UP-3D', part: `INT-${k + 1}`, item: '底面 PIN 尖端／平整度', result: bad ? 'NG' : 'OK', value: bad ? 'PIN 歪斜 0.11 mm（門檻 0.05）' : `共面度 ${22 + (k * 5) % 9} µm` });
      if (bad) {
        const n = LAY.st.ngI;
        goTo('A', V(n[0], 906, n[1]), 0, 'NG 盒 I', { action: `${name} 送 NG 盒`, sub: 'PIN 歪斜，不得組裝', station: 2 }, { slow: 4, slowDur: .2 });
        const r = release('A', P, 'free', { x: n[0], y: 906 - INT.t, z: n[1], yaw: 0 });
        P.add(.3, { y: st.ng.I.y + INT.bossH + .05 }, { at: r.start + .02, ease: t => t * t });
        up();
        intForSlot.push({ retried: slot });
        continue;
      }
      upCam('I', name, 2);
      insp.push({ t: +rb.t.toFixed(2), cam: 'UP-2D', part: `INT-${k + 1}`, item: '底面外觀＋位置修正', result: 'OK', value: `ΔX ${(.03 + k * .011).toFixed(3)} ΔY ${(-.02 + k * .007).toFixed(3)} Δθ ${(.05 - k * .02).toFixed(2)}°` });
      okPart = true;
    }
    // 第一片之前：下視相機讀 PCB 基準點，建立板座標（載台已定位）
    if (slot === 0) {
      rb.hold(tLocated);
      FIDUCIALS.slice(0, 2).forEach(([fx, fz], n) => {
        const p = V(LAY.work + fx, PCB_TOP + 45, fz);
        up();
        const qa = solve('cam', V(p.x, yAt('cam', SAFE_D3), p.z), 0, `基準點 ${n + 1}`);
        moveJ(qa, null, {}, { action: `讀 PCB 基準點 ${n + 1}`, sub: '下視相機建立 PCB 基準座標（取代機構靠邊定位）', station: 2 });
        const qb = solve('cam', p, 0, `基準點 ${n + 1}`);
        moveJ(qb, .25);
        const s = hold(.15, { flash: 1 }, { action: `基準點 ${n + 1} 取像`, station: 2 }); hold(.05, { flash: 0 });
        insp.push({ t: +(s.start + s.dur).toFixed(2), cam: 'DOWN-2D', part: 'PCB', item: `基準點 ${n + 1}`, result: 'OK', value: n ? '板座標 θ 0.021°' : `X ${(.08).toFixed(2)} Y ${(-.05).toFixed(2)} mm` });
      });
    }
    // 放到槽位（以基準點與覆拍結果修正）：慢速下降，三凸點入孔
    const P = pI[k];
    goTo('A', slotPt(slot, INT_Y + INT.t), Math.PI / 2, `槽位 ${slot + 1}`, { action: `interposer → 槽位 ${slot + 1}`, sub: '修正後座標下降，三凸點對入 PCB 孔', station: 2 }, { slow: 8, slowDur: .45 });
    hold(.2, {}, { action: '輕壓保持', sub: '下壓 0.2 s 讓凸點入孔，不推靠邊', station: 2 });
    release('A', P, 'slot', { slot }, { action: '鬆開', sub: '漲緊銷收縮，A 頭上升並縮回', station: 2 });
    up({}, { A: 0 }); cur.A = 0;
    // 三點入位高度（雷射位移計，三孔附近）
    const vals = [];
    MOD.holes.forEach((hx, i) => {
      const w = holeW(slot, i).add(V(0, INT_Y + INT.t + 50, i === 1 ? 6 : 0));
      const qa = solve('laser', w, -Math.PI / 2, `入位高度 ${slot + 1}-${i + 1}`);
      moveJ(qa, i === 0 ? null : .3, {}, i === 0 ? { action: `interposer ${slot + 1} 入位高度`, sub: '雷射位移計量三孔附近高度與段差，判斷凸點是否脫孔', station: 2 } : {});
      hold(.12, { beamLen: 50 }); hold(.02, { beamLen: 0 });
      vals.push(+(1.552 + ((slot * 3 + i) * 7 % 5) * .002).toFixed(3));
    });
    heights.push({ t: +rb.t.toFixed(2), slot, kind: 'interposer 入位（板面到頂面）', values: vals, limit: '1.55 ± 0.02 mm' });
    up();
    intForSlot.push({ slot, k });
  }

  // ---- 3b. SOCAMM × 4（雙頭：B 頭伸出、A 頭縮回）
  const socPlaced = [];
  let nextS = 0;
  exchange('I', lastPick.I);
  flip(-1, { action: '手臂換肘向', sub: '經過輸送線東側上方的伸直姿態，改用東側作業的肘向', station: 3 });
  for (let slot = 0; slot < 4; slot++) {
    let k, okPart = false;
    while (!okPart) {
      k = nextS++;
      const P = pS[k], name = `SOCAMM #${k + 1}`;
      pick('S', k, P, 3);
      // 離子風刀：底面焊墊掠過朝上的風刀
      const [bx, bz] = LAY.st.blow, yb = st.blowY + 8 + SOC.t;
      goTo('B', V(bx - 55, yb, bz), Math.PI, '離子風刀', { action: `${name} 氣吹清潔`, sub: '離子風刀吹底面焊墊（去微粒、除靜電）', station: 3 }, { slow: 4, slowDur: .2 });
      const bl = line('B', e => V(bx - 55 + 110 * e, yb, bz), Math.PI, 1.0, { action: `${name} 氣吹`, station: 3 });
      sta.add(0, { blow: 1 }, { at: bl.start }); sta.add(0, { blow: 0 }, { at: bl.start + bl.dur });
      let s = upCam('S', name, 3);
      const dirty = SC.dirty.includes(k);
      insp.push({ t: +(s.start + s.dur).toFixed(2), cam: 'UP-2D', part: `SOC-${k + 1}`, item: '底面焊墊外觀', result: dirty ? '髒污' : 'OK', value: dirty ? '焊墊異物 3 處（≥ 0.3 mm）' : '異物 0' });
      if (dirty) {
        // IPA 擦拭：擦拭帶滴 IPA，零件底面壓在擦拭墊上來回兩次，擦拭帶前進一格
        const [wx, wz] = LAY.st.wipe, yw = st.wipe.padTop + 1.5 - .1 + SOC.t;
        goTo('B', V(wx, yw, wz), 0, 'IPA 擦拭', { action: `${name} IPA 擦拭`, sub: '無塵擦拭帶滴 IPA，擦拭墊上升貼合', station: 3 }, { slow: 6, slowDur: .35 });
        const pre = sta.add(.4, { drop: 1, wipeUp: 1 }, { at: rb.t - .35 });
        sta.add(0, { drop: 0 }, { at: pre.start + pre.dur });
        const w = line('B', e => V(wx + 20 * Math.sin(e * Math.PI * 4), yw, wz), 0, 2.4, { action: `${name} 擦拭 2 往返`, sub: '±20 mm、擦拭帶每次前進 1 格（不重複使用）', station: 3 });
        sta.add(w.dur, { tape: 1 }, { at: w.start, ease: t => t });
        sta.add(.3, { wipeUp: 0 }, { at: w.start + w.dur });
        // 吹乾 10 s
        const [dx, dz] = LAY.st.dry, yd = st.dry.partY + SOC.t;
        goTo('B', V(dx, yd, dz), 0, '吹乾槽', { action: `${name} 吹乾`, sub: '兩側離子暖風對吹底面 10 s（IPA 揮發）', station: 3 }, { slow: 6, slowDur: .3 });
        const d = hold(10, {}, { action: `${name} 吹乾 10 s`, sub: '離子暖風，吹乾後複檢', station: 3 });
        sta.add(0, { dry: 1 }, { at: d.start }); sta.add(0, { dry: 0 }, { at: d.start + d.dur });
        const still = SC.stillDirty.includes(k);
        if (!still) P.add(0, { dirty: 'n' }, { at: w.start + w.dur * .5 });
        s = upCam('S', name, 3, true);
        insp.push({ t: +(s.start + s.dur).toFixed(2), cam: 'UP-2D', part: `SOC-${k + 1}`, item: '清潔後複檢', result: still ? 'NG' : 'OK', value: still ? '殘留異物 1 處 → 不良品區' : '異物 0' });
        if (still) {
          const n = LAY.st.ngS;
          goTo('B', V(n[0], 906, n[1]), 0, 'NG 盒 S', { action: `${name} 送 NG 盒`, sub: '清潔後仍髒污', station: 3 }, { slow: 4, slowDur: .2 });
          const r = release('B', P, 'free', { x: n[0], y: 906 - SOC.t, z: n[1], yaw: 0 });
          P.add(.3, { y: st.ng.S.y + .05 }, { at: r.start + .02, ease: t => t * t });
          up();
          continue;
        }
      }
      insp.push({ t: +rb.t.toFixed(2), cam: 'UP-2D', part: `SOC-${k + 1}`, item: '位置修正', result: 'OK', value: `ΔX ${(-.02 + k * .009).toFixed(3)} ΔY ${(.015 + k * .006).toFixed(3)}` });
      okPart = true;
    }
    const P = pS[k];
    goTo('B', slotPt(slot, SOC_Y(0) + SOC.t), Math.PI / 2, `槽位 ${slot + 1}`, { action: `SOCAMM → 槽位 ${slot + 1}`, sub: '三孔對準 interposer 孔，輕放在 PIN 上（尚未壓縮）', station: 3 }, { slow: 8, slowDur: .45 });
    const r = release('B', P, 'slot', { slot }, { action: '鬆開', sub: '輕放，等鎖附模組壓持', station: 3 });
    up({}, { B: 0 }); cur.B = 0;
    socPlaced.push({ slot, k, tPlaced: r.start, tLeft: rb.t });
  }
  exchange('S', lastPick.S);
  // ---- 3c. 手臂回東側待命（鎖附模組在槽位上方作業時，手臂不跨越它的 X 位置；下一片的 interposer 在載台交換後再取）
  {
    const [x, z] = LAY.st.camS;
    up();
    const qa = solve('B', V(x, yAt('B', SAFE_D3), z), 0, '東側待命');
    moveJ(qa, null, {}, { action: '手臂待命（東側）', sub: '鎖附模組作業中，手臂不跨越槽位', station: 3 });
  }
  const tRobotDone = rb.t;

  // ---- 4. 鎖附：槽位 k 在 SCARA 放好 SOCAMM k+1 並離開之後開始（相鄰槽位不同時作業）
  let tLock = 0, lx = LAY.locker.park, wn = 0, turnsAcc = 0;
  const lkAdd = (dur, v, o = {}) => { const s = lk.add(dur, v, o); return s; };
  for (let slot = 0; slot < 4; slot++) {
    const gate = (socPlaced[Math.min(slot + 1, 3)] || {}).tLeft ?? 0;
    const startAt = Math.max(gate, lk.t);
    const x = LAY.work + SLOTS[slot], P = pS[socPlaced[slot].k];
    lkAdd(Math.max(.4, Math.abs(x - lx) / 400), { x, nz: LOCK.feedZ, ny: 0 }, { at: startAt, action: `鎖附模組 → 槽位 ${slot + 1}`, sub: 'X 軸伺服；起子停在取釘座上方', station: 4 });
    lx = x;
    const pr = lkAdd(.5, { press: 1 }, { action: `槽位 ${slot + 1} 壓持`, sub: '4 爪壓在 DRAM 上，SOCAMM 壓縮 interposer PIN（防回彈脫孔）', station: 4 });
    P.add(pr.dur, { press: 1 }, { at: pr.start });
    const gb = lkAdd(.35, { beam: 1 }, { action: '入位確認', sub: '3 支雷射量三孔附近板間距離（SOCAMM 頂面到 PCB）', station: 4, ease: STEP });
    lkAdd(0, { beam: 0 });
    heights.push({ t: +(gb.start + gb.dur).toFixed(2), slot, kind: 'SOCAMM 壓持後板間距離', values: [0, 1, 2].map(i => +(2.703 + ((slot + i) * 3 % 5) * .002).toFixed(3)), limit: '2.70 ± 0.03 mm' });
    // 預鎖：中間孔 → 兩端
    const order = [1, 0, 2];
    const logs = {};
    for (const i of order) {
      const n = slot * 3 + i, W = pW[n];
      // 取釘：吹送到取釘座 → 起子下降、真空吸釘 → 上升
      const f0 = lkAdd(.25, { nz: LOCK.feedZ, ny: 0, dy: 0 }, { action: `取螺絲 ${slot + 1}-${i + 1}`, sub: '吹送供料到取釘座，起子真空吸附', station: 4 });
      W.add(0, { loc: 'feed', slot, hole: i }, { at: f0.start });
      const dyPick = locker.feedTop + SCREW.headH - locker.tipSeat;
      lkAdd(.18, { ny: 1, dy: dyPick });
      const vac = lkAdd(.1, {}, { sub: '真空檢知 OK', ease: STEP });
      W.add(0, { loc: 'bit' }, { at: vac.start + vac.dur });
      lkAdd(.15, { ny: 0, dy: dyPick });
      // 移到孔位 → 下降（螺絲尖端入孔）→ 預鎖旋入
      lkAdd(.25, { nz: -MOD.holes[i], dy: TORQUE.preTurns * SCREW.pitch }, { action: `預鎖 ${slot + 1}-${i + 1}`, sub: `${TORQUE.preRpm} rpm 旋入，到貼合（約 ${TORQUE.preNm} N·m）`, station: 4 });
      lkAdd(.18, { ny: 1 });
      const drive = lkAdd(TORQUE.preTurns / (TORQUE.preRpm / 60), { turns: turnsAcc + TORQUE.preTurns, dy: 0 }, { ease: t => t });
      W.add(0, { loc: 'hole', rem: TORQUE.preTurns, rot: turnsAcc }, { at: drive.start });
      W.add(drive.dur, { rem: 0, rot: turnsAcc + TORQUE.preTurns }, { at: drive.start, ease: t => t });
      turnsAcc += TORQUE.preTurns;
      logs[i] = { slot, hole: i, n, pre: [drive.start, drive.start + drive.dur] };
      lkAdd(.18, { ny: 0, dy: 0 });
      wn++;
    }
    // 終鎖：中間孔 → 兩端，低速到目標扭力
    for (const i of order) {
      const W = pW[slot * 3 + i];
      lkAdd(.22, { nz: -MOD.holes[i] }, { action: `終鎖 ${slot + 1}-${i + 1}`, sub: `${TORQUE.finRpm} rpm 到 ${TORQUE.finNm} N·m，記錄扭力-角度曲線與轉數`, station: 4 });
      lkAdd(.18, { ny: 1 });
      const dur = TORQUE.finTurn / (TORQUE.finRpm / 60) + .25;
      const fin = lkAdd(dur, { turns: turnsAcc + TORQUE.finTurn }, { ease: t => Math.min(1, t * 1.25) });
      W.add(fin.dur, { rot: W.state.rot + TORQUE.finTurn }, { at: fin.start, ease: t => Math.min(1, t * 1.25) });
      turnsAcc += TORQUE.finTurn;
      logs[i].fin = [fin.start, fin.start + fin.dur];
      lkAdd(.18, { ny: 0 });
    }
    for (const i of [0, 1, 2]) screwLog.push(logs[i]);
    const ru = lkAdd(.4, { press: 0 }, { action: `槽位 ${slot + 1} 放開壓持`, station: 4 });
    void ru;
    const gc = lkAdd(.35, { beam: 1 }, { action: '鎖附後複檢', sub: '三點板間距離（螺絲鎖固後不回彈）', station: 4, ease: STEP });
    lkAdd(0, { beam: 0 });
    heights.push({ t: +(gc.start + gc.dur).toFixed(2), slot, kind: '鎖附後板間距離', values: [0, 1, 2].map(i => +(2.701 + ((slot * 2 + i) * 3 % 4) * .002).toFixed(3)), limit: '2.70 ± 0.03 mm' });
    insp.push({ t: +(gc.start + gc.dur).toFixed(2), cam: 'NUTRUNNER', part: `槽位 ${slot + 1}`, item: '三螺絲終鎖', result: 'OK', value: `${TORQUE.finNm.toFixed(2)} N·m ×3、轉數 ${(TORQUE.preTurns + TORQUE.finTurn).toFixed(2)}` });
    tLock = lk.t;
  }
  lkAdd(Math.abs(LAY.locker.park - lx) / 400 + .3, { x: LAY.locker.park, nz: LOCK.feedZ }, { action: '鎖附模組回待機位', station: 4 });
  // ---- 5. 出站：頂升下降、止擋下降、輸送到下游（維持原軌道交接）
  const tOut = Math.max(lk.t, tLock);
  cv.add(.6, { up: 0 }, { at: tOut, action: '頂升下降', sub: '載台回到邊皮帶上', station: 5 });
  cv.add(.4, { stopUp: 0 }, { action: '止擋下降', station: 5 });
  cv.add(2.8, { cx: 820, s: 760 + 820 }, { action: '載台出站', sub: '原軌道交接到下一製程', station: 5, ease: t => t * t * (3 - 2 * t) });
  cv.add(.4, { stopUp: 1 });
  const total = tl.total;

  // ---------------------------------------------------------------- 套用時間 t
  const tmpQ = new THREE.Quaternion();
  function partWorld(kind, s, obj, R) {
    const yawSlot = Math.PI / 2;
    if (s.loc === 'tray') {
      const w = R.tray[kind][s.tr];
      obj.position.set(w.x, w.y + TRAY_SEAT + (kind === 'I' ? INT.bossH : 0) + .02, w.z + pocketZ(s.k));
      obj.rotation.set(0, 0, 0);
    } else if (s.loc === 'A' || s.loc === 'B') {
      const f = fkWorld(R.q, s.loc);
      obj.position.set(f.p.x, f.p.y - top[kind], f.p.z); obj.rotation.set(0, f.yaw, 0);
    } else if (s.loc === 'slot') {
      const y = kind === 'I' ? INT_Y : SOC_Y(s.press);
      obj.position.set(R.cx + SLOTS[s.slot], y - LIFT + R.lift, 0); obj.rotation.set(0, yawSlot, 0);
    } else if (s.loc === 'free') {
      obj.position.set(s.x, s.y, s.z); obj.rotation.set(0, s.yaw, 0);
    }
    obj.visible = s.loc !== 'hidden';
  }
  function apply(t) {
    const S = tl.sample(t);
    const C = S.conv, lift = C.up * LIFT;
    conv.set({ s: C.s, stopUp: C.stopUp, up: C.up });
    carrier.position.set(C.cx, LAY.conv.top + lift, 0);
    board.position.set(C.cx, LAY.conv.top + lift + CARRIER.t + CARRIER.standoff, 0);
    lanes.I.set({ z: S.trayI.z, e: S.elevI.e, laser: S.trayI.laser, flash: S.trayI.laser });
    lanes.S.set({ z: S.trayS.z, e: S.elevS.e, flash: S.trayS.flash });
    // Tray 世界位置：叉板上（底面 = 叉板頂 + 0.05）或料倉第 lvl 層（底面 = 層架頂 + 0.05）
    const trayAt = {};
    for (const kind of ['I', 'S']) trayAt[kind] = [0, 1, 2].map(j => {
      const ts = S[`tr${kind}${j}`], z = kind === 'I' ? S.trayI.z : S.trayS.z, e = kind === 'I' ? S.elevI.e : S.elevS.e;
      const w = ts.loc === 'fork' ? { x: LAY.lane[kind], y: LAY.trayBottom + .05, z } : { x: LAY.lane[kind], y: magRail(ts.lvl, e) + .05, z: LAY.tray.load };
      trays[kind][j].position.set(w.x, w.y, w.z); return w;
    });
    st.set(S.st);
    const r = S.robot; robot.set(r);
    locker.set(S.lock);
    const RR = { q: r, cx: C.cx, lift, tray: trayAt };
    ints.forEach((o, k) => partWorld('I', S['i' + k], o, RR));
    socs.forEach((o, k) => { const s = S['s' + k]; partWorld('S', s, o.root, RR); o.dirt.visible = s.dirty === 'y'; });
    details.set(S);
    locker.group.updateMatrixWorld(true);
    const tip = locker.bitTip();
    screws.forEach((w, n) => {
      const s = S['w' + n];
      w.visible = s.loc !== 'hidden';
      if (s.loc === 'feed') { w.position.set(S.lock.x, locker.feedTop, LOCK.feedZ); w.rotation.set(0, 0, 0); }
      else if (s.loc === 'bit') { w.position.set(tip.x, tip.y - SCREW.headH, tip.z); w.rotation.set(0, S.lock.turns * Math.PI * 2, 0); }
      else if (s.loc === 'hole') { const h = holeW(s.slot, s.hole); w.position.set(C.cx + h.x - LAY.work, SOC_TOP(1) - LIFT + lift + s.rem * SCREW.pitch, h.z); w.rotation.set(0, s.rot * Math.PI * 2, 0); }
    });
    ind.tower.set(t < total - 3.6 ? 'green' : 'yellow');
    return S;
  }
  apply(0);

  // ---------------------------------------------------------------- 節拍
  // 穩態每片載台（示意估算）：定位完成 → 鎖附結束，加上載台交換（出站 3.8 s＋進站定位 3.3 s）；手臂在進站時先取第一片 interposer
  const swap = inDur + .7 + 3.8;
  const cycle = {
    total, robot: tRobotDone - tStartRobot, lockEnd: tLock,
    steady: +(tLock - Math.max(tLocated, rb.steps.find(s => /基準點/.test(s.action))?.start ?? tLocated) + swap).toFixed(1),
    lockPerSlot: +((tLock - lk.steps.find(s => s.action === '鎖附模組 → 槽位 1').start) / 4).toFixed(1),
  };
  cycle.perModule = +(cycle.steady / 4).toFixed(1);

  // ---------------------------------------------------------------- 檢查
  const layoutChecks = () => {
    const rows = [];
    const bad = reach.filter(r => !r.ok);
    rows.push({ group: 'SCARA', name: `作業點都在 HSR065 可達範圍（${reach.length} 點）`, ok: !bad.length, value: bad.length ? bad[0].label : '全部可達' });
    const j2max = Math.max(...reach.map(r => Math.abs(r.j2 ?? 0)));
    rows.push({ group: 'SCARA', name: 'J2 摺角 ≤ 120°（避開基座柱干涉區）', ok: j2max <= 120, value: `${j2max.toFixed(1)}°` });
    const W = LAY.x1 - LAY.x0, D = LAY.z1 - LAY.z0;
    rows.push({ group: '配置', name: '機台占地（不含輸送伸出段）', ok: W <= 1600 && D <= 1500, value: `${W} × ${D} mm` });
    rows.push({ group: '配置', name: '輸送面高度 900 mm（SMT 標準）', ok: LAY.conv.top === 900, value: `${LAY.conv.top} mm` });
    const gap = Math.min(...socPlaced.slice(1).map((p, i) => { const s = lk.steps.find(x => x.action === `鎖附模組 → 槽位 ${i + 1}`); return s ? s.start - p.tLeft : 99; }));
    rows.push({ group: '時序', name: '鎖附只在相鄰槽位的 SOCAMM 放好、手臂離開後開始', ok: gap >= -1e-6, value: `${gap.toFixed(2)} s` });
    rows.push({ group: '時序', name: '吹乾時間 ≥ 10 s', ok: rb.steps.filter(s => s.action?.includes('吹乾 10 s')).every(s => s.dur >= 10), value: '10 s' });
    rows.push({ group: '節拍', name: '每片載台（4 組）穩態節拍（示意）', ok: true, value: `${cycle.steady} s／片（${cycle.perModule} s／組）` });
    return rows;
  };
  const stationStart = tl.stationStart;
  const product = m => { for (let p = m; p; p = p.parent) if (p.userData.product) return p.userData.product; return null; };
  const isScrew = m => { for (let p = m; p; p = p.parent) if (p.name?.startsWith('screw-')) return true; return false; };
  const under = (m, name) => { for (let p = m; p; p = p.parent) if (p.name === name) return true; return false; };
  const either = (a, b, fa, fb) => (fa(a) && fb(b)) || (fa(b) && fb(a));
  const isBoard = m => under(m, 'board') || under(m, 'carrier');
  const isHead = m => under(m, 'head-A') || under(m, 'head-B');
  const isTray = m => { for (let p = m; p; p = p.parent) if (p.userData.trayObj) return true; return false; };
  return {
    total, timeline: tl, apply, stationStart, cycle, insp: insp.sort((a, b) => a.t - b.t), heights, screwLog, scenario: SC,
    robot, locker, lanes, st, conv, board, ints, socs, screws, reach, trays, spec, elec,
    layoutChecks,
    verify: {
      dt: .1,
      // 花鍵軸頂端的限位環（共用模型內部）：手臂下降量約 106 mm 時頂面和 J3／J4 馬達蓋頂面同高，取樣剛好落在那一刻會被當成重合面；
      // 花鍵軸頂面在下降量約 105.5 mm 時也和馬達蓋頂面同高；兩者都在手臂最上方、不會碰到任何設備，從檢查排除（已登記 core/REQUESTS.md）
      skip: o => o === robot.arm.shaft.children[1] || o === robot.arm.shaft.children[0],
      moduleOf: m => product(m) ? 'product' : isScrew(m) ? 'screws' : undefined,
      thresholds: { product: { tol: .05, dist: .01, area: 2 }, screws: { tol: .05, dist: .01, area: 2 } },
      allow: [
        { why: '零件放在 Tray 格內（凸點與底面落在支撐環上、漲緊銷伸入支撐環中心）', test: (a, b) => either(a, b, m => !!product(m), isTray) },
        { why: 'Tray 坐在抽屜叉板上，或被料倉層架托條托住（交換時兩者交接）', test: (a, b) => either(a, b, isTray, m => under(m, 'tray-fork') || under(m, 'tray-magazine')) },
        { why: '三孔頭夾持零件：漲緊銷插入零件孔、肩部壓在孔周', test: (a, b) => either(a, b, m => !!product(m), isHead) },
        { why: '組裝疊層：interposer 凸點入 PCB 孔、PIN 壓在焊墊上；SOCAMM 壓在 interposer PIN 上（PIN 尖端插入 0.05～0.3 mm 代表接觸與壓縮）', test: (a, b) => either(a, b, m => !!product(m), m => !!product(m) || isBoard(m)) },
        { why: 'SOCAMM 底面壓在 IPA 擦拭墊上；NG 件落在 NG 盒底', test: (a, b) => either(a, b, m => !!product(m), m => under(m, 'wipe-pad') || under(m, 'stations')) },
        { why: '壓持爪 PU 墊壓在 DRAM 頂面（userData.contact）', test: (a, b) => either(a, b, m => !!product(m), m => !!m.userData.contact) },
        { why: '螺絲：在取釘座、吸在起子尖端、穿過 SOCAMM／interposer 孔鎖入 PCB 背面螺帽', test: (a, b) => either(a, b, isScrew, m => under(m, 'locker') || !!product(m) || isBoard(m)) },
        { why: '載台跨在邊皮帶上、被定位銷與支撐條頂起靠上壓邊、東端靠止擋', test: (a, b) => either(a, b, isBoard, m => under(m, 'conveyor')) },
        { why: 'PCB 放在載台支撐柱上、板邊壓爪', test: (a, b) => (under(a, 'board') && under(b, 'carrier')) || (under(b, 'board') && under(a, 'carrier')) },
      ],
      envelope: ['robot'],
      // 配線動態取樣：外露線路與拖鏈對會動的機構（手臂、鎖附頭、Tray 叉板與料倉、頂升板）
      cables: {
        interval: .5,
        obstacles: () => {
          const out = [], add = o => o?.traverse(m => { if (m.isMesh && !m.userData.routingHardware && !m.userData.fx) out.push(m); });
          add(robot.root); add(locker.head); add(conv.group.getObjectByName('locate-lift'));
          for (const ln of Object.values(lanes)) { add(ln.nest); add(ln.shelf); }
          return out;
        },
      },
    },
  };
}
export { MAT };
