// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 參數（網址或 project.json 的 variants）：plan＝box-laser｜box-vision｜piece-laser｜piece-vision；part＝stator｜rotor。
// 時間軸：沖壓機持續出料、下料 SCARA 每 3.33 s 擺一顆；作業員把上一盒滿盒推到品檢區，量測站依方案量完放行。
import * as THREE from 'three';
import { floor } from '@core/geom/environment.js';
import { block, floorText } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { createTimeline, smooth, clamp01 } from '@core/anim/track.js';
import { LAYOUT, PARTS, PLANS, RATE, BOX, CYCLE, capacity, slot, heightOf, isNG, ngList } from './spec.js';
import { createPress, createPit, laneX } from './press.js';
import { createUnloader } from './unloader.js';
import { createBox, createCart, createOperator } from './boxes.js';
import { createQcRoom } from './qc-common.js';
import { createBoxStation, QB } from './qc-box.js';
import { createPieceStation, QP } from './qc-piece.js';
import { solve, atHeight, padAt, evalSegs, pickPlace } from './motion.js';
import { partMesh } from './parts.js';

export { LAYOUT, PLANS, PARTS };
export const STATIONS_BOX = ['沖壓出料・SCARA 擺盒', '換盒', '人員搬盒到品檢區', '翻盒到基準板', '高度量測', '剔除 NG・翻回鐵盒', '放行'];
export const STATIONS_PIECE = ['沖壓出料・SCARA 擺盒', '換盒', '人員搬盒到品檢區', '逐顆上砧', '高度量測', 'OK 回盒・NG 滑槽', '放行'];
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const U = LAYOUT.unloader, CV = U.conveyor, S = LAYOUT.qc.station;

export function createProject({ scene, plan: planKey = 'box-laser', part: partKey = 'stator' } = {}) {
  const plan = PLANS[planKey] || PLANS['box-laser'], part = PARTS[partKey] || PARTS.stator, cap = capacity(part);
  const STATIONS = plan.mode === 'box' ? STATIONS_BOX : STATIONS_PIECE;

  // ---------------------------------------------------------------- 場景
  const f = floor(scene, { size: [18000, 7600], center: [0, 0], cell: 500 });
  // 廢料坑處挖空地坪：把地坪換成四塊（網格開口才看得到坑底）
  const P = LAYOUT.pit; scene.remove(f.mesh);
  const fm = f.mesh.material;
  for (const [x0, x1, z0, z1] of [[-9000, P.x0, -3800, 3800], [P.x1, 9000, -3800, 3800], [P.x0, P.x1, -3800, P.z0], [P.x0, P.x1, P.z1, 3800]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), fm); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    m.receiveShadow = true; m.name = 'floor'; scene.add(m);
  }
  floorText(scene, ['沖壓區（振動大・噪音大）'], -5200, 3300, 3000, 280);
  // 走道標線（推車路線）
  const lane = new THREE.Group(); lane.name = 'walkway marking'; scene.add(lane);
  for (const [x0, x1, z] of [[-3100, 2200, 2500], [-3100, 2200, 1700]]) block(lane, [x1 - x0, 2, 60], [(x0 + x1) / 2, 1, z], MAT.yellow);

  const press = createPress(scene, part);
  createPit(scene);
  const un = createUnloader(scene, part);
  createQcRoom(scene);
  const st = plan.mode === 'box' ? createBoxStation(scene, part, plan) : createPieceStation(scene, part, plan);

  // 鐵盒：A＝上一盒滿盒（作業員搬去量）、B＝擺盒中、C／D＝空盒；逐顆方案另有出料空盒 E
  const boxes = {
    A: createBox(part, 'box A', '盒 0412'), B: createBox(part, 'box B', '盒 0413'),
    C: createBox(part, 'box C', '盒 0414'), D: createBox(part, 'box D', '盒 0415'),
  };
  if (plan.mode === 'piece') boxes.E = createBox(part, 'box E', '盒 0398');
  for (const b of Object.values(boxes)) scene.add(b.root);
  const cart = createCart(); scene.add(cart.root);
  const op = createOperator(scene);

  // ---------------------------------------------------------------- 下料 SCARA：取放時刻表
  const C = RATE.cycle, T = CYCLE.unloader, START_FILL = cap - 12;    // B 盒一開始已擺到 cap−12 顆
  const ubase = un.arm.root.position.clone(), uTravel = 1070, home0 = { j1: 0, j2: 0, d3: 0, j4: 0 };
  const tp0 = n => .5 + n * C;
  const XS = tp0(11) + 1.6, XE = XS + 4.2;                          // 換盒（滿盒送出、空盒補入）
  const tp = n => n < 12 ? tp0(n) : XE + .3 + (n - 12) * C;
  const laneOf = n => n % LAYOUT.lane.n;
  const fillSlot = n => n < 12 ? { box: 'B', i: START_FILL + n } : { box: 'C', i: n - 12 };
  const boxFill = U.slots[U.fill];
  const uCache = new Map();
  let prevRef = home0;
  function uCycle(n) {
    if (uCache.has(n)) return uCache.get(n);
    const k = laneOf(n), pc = press.pickPoint(k), ref = n === 0 ? home0 : uCycle(n - 1).ref;
    const pick = solve(ubase, padAt(part, V(pc.x, LAYOUT.lane.y, pc.z), 0), 0, ref);
    const from = n === 0 ? atHeight(pick, ubase, uTravel) : uCycle(n - 1).last;
    const s = slot(part, fillSlot(n).i), c = V(boxFill + s.x, CV.top + BOX.bottom, CV.z + s.z);
    const place = solve(ubase, padAt(part, c, s.rot), s.rot, pick);
    const pp = pickPlace({ from, pick, place, travel: uTravel, base: ubase, T: { move: T.move, down: T.down, grip: T.grip } });
    const out = { ...pp, ref: place, t: tp(n) };
    uCache.set(n, out); return out;
  }
  for (let n = 0; n < 40; n++) uCycle(n);   // 預先算好（排程與檢查都只取樣）
  const lastPick = t => { let n = -1; while (n + 1 < 40 && tp(n + 1) <= t) n++; return n; };

  // ---------------------------------------------------------------- 時間軸（作業員、鐵盒、推車、量測站）
  const tl = createTimeline();
  const info = tl.track('info', {});
  const mark = (at, action, station, sub = '') => info.add(.01, {}, { at, action, station, sub });
  mark(tp(0), 'SCARA 從滑道末端吸起工件、交錯 180° 擺進鐵盒', 0, `沖壓機 6 列出料、每 ${C.toFixed(2)} s 一顆`);
  mark(XS, '鐵盒擺滿：滿盒往東送出、空盒補進擺盒位', 1, '輸送線兩格空盒＋兩格滿盒緩衝，約 23 分鐘換一次人');

  // 作業員與推車（世界座標）
  const opT = tl.track('op', { x: -4300, z: 1950, yaw: Math.PI, walk: 0, hands: 'idle' });
  const cartT = tl.track('cart', { s: 0 });
  const boxA = tl.track('boxA', { mode: 'conv', x: U.slots[3], y: CV.top, z: CV.z, yaw: 0 });
  const E1 = U.slots[3];
  opT.add(1.5, { x: E1, z: 1760, walk: 2 }, { action: '作業員到滿盒出口', station: 2, at: 0 });
  opT.add(1, { hands: 'box' });
  boxA.add(1.2, { mode: 'held', x: E1, y: 1150, z: 1520 }, { at: 2.5 });
  opT.add(2.5, { x: -4100, z: 2560, walk: 5, yaw: Math.PI }, { at: 3.7, action: '把滿盒搬上推車', station: 2 });
  boxA.add(2.5, { x: -4100, y: 1150, z: 2100 }, { at: 3.7 });
  boxA.add(1, { mode: 'cart', y: LAYOUT.cart.deck }, { at: 6.2 });
  // 推車路線（cart.s：沿折線的距離）
  const cartPath = [V(-4100, 0, 2100), V(1800, 0, 2100), V(3300, 0, 1300), V(4300, 0, 1300)];
  const segL = cartPath.slice(1).map((p, i) => p.distanceTo(cartPath[i])), pathL = segL.reduce((a, b) => a + b, 0);
  const along = s => { let i = 0; s = Math.max(0, Math.min(pathL, s)); while (i < segL.length - 1 && s > segL[i]) { s -= segL[i]; i++; } const d = cartPath[i + 1].clone().sub(cartPath[i]).normalize(); return { p: cartPath[i].clone().addScaledVector(d, s), yaw: Math.atan2(d.x, d.z) }; };
  opT.add(1, { x: -4100 - 720, z: 2100, yaw: Math.PI / 2, walk: 6, hands: 'cart' }, { at: 7.2 });
  const push = cartT.add(10.8, { s: pathL }, { at: 8.2, action: '推車到品檢區（約 10 m，離開沖壓振動區）', station: 2 });
  opT.add(10.8, { mode: 'push', walk: 6 + 14 }, { at: 8.2 });
  const qcNest = plan.mode === 'box' ? V(S.x, QB.nest.top, S.z + QB.nest.z) : V(S.x + QP.inBox.x, QP.nestTop, S.z + QP.inBox.z);
  const nestYaw = plan.mode === 'box' ? 0 : QP.boxYaw;
  // 作業員站位：整盒站在入料座南側；逐顆站在盒座外側（盒子從左右兩側上下料）
  const standAt = (nest, side) => side === 'south' ? { x: nest.x, z: nest.z + 640, yaw: Math.PI } : side === 'west' ? { x: nest.x - 640, z: nest.z, yaw: Math.PI / 2 } : { x: nest.x + 640, z: nest.z, yaw: -Math.PI / 2 };
  const front = (o, d = 420) => ({ x: o.x + Math.sin(o.yaw) * d, z: o.z + Math.cos(o.yaw) * d });
  const facing = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  const opEnd = along(pathL - 720), cartEnd = cartPath.at(-1), tPush = push.start + push.dur;
  const atCart = { x: cartEnd.x, z: cartEnd.z + 520, yaw: Math.PI };
  opT.add(0, { mode: 'free', x: opEnd.p.x, z: opEnd.p.z, yaw: opEnd.yaw }, { at: tPush });
  boxA.add(0, { x: cartEnd.x, z: cartEnd.z, yaw: 0 }, { at: tPush });
  let walk = 22;
  // 走到某站位（可經過中繼點），身體朝行進方向，最後轉向 o.yaw
  function walkTo(track, pts, dur) {
    let from = { x: track.state.x, z: track.state.z };
    pts.forEach((o, k) => {
      const d = Math.hypot(o.x - from.x, o.z - from.z), last = k === pts.length - 1;
      track.add(dur * d / pts.reduce((s, q, j) => s + Math.hypot(q.x - (j ? pts[j - 1].x : track.state.x), q.z - (j ? pts[j - 1].z : track.state.z)), 0) || .3, { x: o.x, z: o.z, yaw: last ? o.yaw : facing(from, o), walk: (walk += d / 350) });
      from = o;
    });
  }
  walkTo(opT, [atCart], 1.2);
  opT.add(.5, { hands: 'box' }, { action: '從推車抱起鐵盒', station: 2 });
  const f0 = front(atCart);
  boxA.add(.8, { mode: 'held', x: f0.x, y: 1000, z: f0.z, yaw: 0 }, { at: opT.t });
  boxA.add(0, { mode: 'carry' }); opT.hold(boxA.t);
  const load = plan.mode === 'box' ? standAt(qcNest, 'south') : standAt(qcNest, 'west');
  walkTo(opT, plan.mode === 'box' ? [load] : [{ x: load.x - 150, z: 1000 }, load], 2.4);
  const f1 = front(load);
  const lift = plan.mode === 'box' ? 32 : 60;   // 平移進出時盒底高過定位塊、盒緣低於停放的基準板／手臂吸盤
  boxA.add(0, { mode: 'held', x: f1.x, y: qcNest.y + lift, z: f1.z, yaw: nestYaw }, { at: opT.t });
  boxA.add(1, { mode: 'nest', x: qcNest.x, y: qcNest.y, z: qcNest.z, yaw: nestYaw }, { action: '把鐵盒放上量測站入料座', station: 2 });
  opT.add(.6, { hands: 'idle' }, { at: boxA.t, action: '按下啟動', station: 2 });
  const t0 = opT.t + .3;

  // ---------------------------------------------------------------- 量測站排程
  let pieceT = null;
  const ngs = ngList(part), qcEnd = plan.mode === 'box' ? scheduleBox(t0) : schedulePiece(t0);
  // 放行：作業員把（良品）盒子搬回推車
  const tOut = qcEnd + .3;
  const outBox = plan.mode === 'box' ? 'A' : 'E';
  const outNest = plan.mode === 'box' ? qcNest : V(S.x + QP.outBox.x, QP.nestTop, S.z + QP.outBox.z);
  const outTrack = plan.mode === 'box' ? boxA : tl.track('boxE', { mode: 'nest', x: outNest.x, y: outNest.y, z: outNest.z, yaw: QP.boxYaw });
  if (plan.mode === 'box') outTrack.add(0, { mode: 'nest', x: qcNest.x, y: qcNest.y, z: qcNest.z, yaw: 0 }, { at: tOut });
  const pickOut = plan.mode === 'box' ? standAt(outNest, 'south') : standAt(outNest, 'east');
  opT.hold(tOut);
  walkTo(opT, plan.mode === 'box' ? [pickOut] : [{ x: pickOut.x + 150, z: 1000 }, pickOut], plan.mode === 'box' ? .8 : 2.6);
  opT.add(.5, { hands: 'box' }, { action: plan.mode === 'box' ? '量測完成：整盒良品放行' : '量測完成：出料盒（良品）放行', station: 6, sub: `NG ${ngs.length} 顆已剔除` });
  const f2 = front(pickOut);
  outTrack.add(.8, { mode: 'held', x: f2.x, y: outNest.y + lift, z: f2.z, yaw: plan.mode === 'box' ? 0 : QP.boxYaw }, { at: opT.t });
  outTrack.add(0, { mode: 'carry' }); opT.hold(outTrack.t);
  walkTo(opT, plan.mode === 'box' ? [atCart] : [{ x: pickOut.x + 150, z: 1000 }, atCart], plan.mode === 'box' ? 1.6 : 2.8);
  outTrack.add(0, { mode: 'held', x: f0.x, y: 1000, z: f0.z, yaw: 0 }, { at: opT.t });
  outTrack.add(1, { mode: 'cart', x: cartEnd.x, y: LAYOUT.cart.deck, z: cartEnd.z, yaw: 0 });
  opT.add(.6, { hands: 'idle' }, { at: outTrack.t });
  const total = Math.max(opT.t, outTrack.t) + .8;

  function scheduleBox(t0) {
    const fl = tl.track('flip', { th: 0, bl: 0, pl: QB.park, cl: 0, latch: 1 });
    const pr = tl.track('parts', { loc: 'box', removed: 0 });
    const bq = tl.track('boxQ', { mode: 'nest' });
    const gt = tl.track('gantry', { x: QB.gantry.park, y: -560, zt: 1220, ext: 0, carry: 0, laser: 0, flash: 0 });
    const rw = tl.track('rows', { row: -1, lift: 0, back: 0, done: -1 });
    fl.add(1.2, { pl: 0 }, { at: t0, action: '基準板座下降：研磨基準板壓到工件頂面', station: 3, sub: '浮動壓板讓每顆頂面都貼平' });
    fl.add(.6, { cl: 1 }, { action: '側夾夾緊鐵盒' }); bq.add(0, { mode: 'clamped' }, { at: fl.t - .6 });
    const f1 = fl.add(3, { th: 1 }, { action: '整盒翻轉 180°：工件頂面朝下落在基準板上', station: 3, sub: '伺服＋減速機，慢速 S 曲線' });
    fl.add(.4, { latch: 0 }, { action: '基準板座落在花崗岩定位座、解鎖', station: 3 });
    pr.add(0, { loc: 'holder' }, { at: f1.start + f1.dur });
    fl.add(1, { bl: QB.boxLift }, { action: '鐵盒上移離開工件', station: 3 });
    fl.add(1.5, { th: .5 });
    fl.add(1.5, { th: 0, bl: 0 }, { action: '空鐵盒翻回入料座' });
    fl.add(.4, { cl: 0 }); bq.add(0, { mode: 'nest' }, { at: fl.t });
    rw.add(.5, { back: plan.sensor === 'vision' ? 1 : 0 }, { at: fl.t });
    // 量測：逐列
    let t = fl.t; const rows = part.grid.rows, rowZ = r => S.z + QB.meas - slot(part, r * part.grid.cols).z;
    gt.add(1, { x: -240, y: plan.sensor === 'vision' ? rowZ(0) - 120 : rowZ(0), zt: plan.sensor === 'vision' ? QB.camY : QB.window }, { at: t, action: plan.sensor === 'vision' ? '遠心相機移到第 1 列' : '線雷射移到第 1 列', station: 4 });
    for (let r = 0; r < rows; r++) {
      const dir = r % 2 ? -1 : 1, xs = dir * 240;
      if (plan.sensor === 'vision') {
        rw.add(0, { row: r }, { at: gt.t });
        rw.add(.5, { lift: 1 }, { action: r === 0 ? `頂升第 ${r + 1} 列 80 mm（高出其他列）` : '', station: 4 });
        gt.add(0, { flash: 1 }, { at: rw.t });
        gt.add(2.2, { x: xs }, { action: r === 0 ? '遠心相機＋平行背光沿列側拍：軌面與頂緣同一張影像相減' : '', station: 4, sub: `第 ${r + 1} 列 ${part.grid.cols} 顆` });
        gt.add(0, { flash: 0 });
        rw.add(.5, { lift: 0 }, { at: gt.t }); rw.add(0, { done: r });
        if (r < rows - 1) gt.add(.4, { y: rowZ(r + 1) - 120 }, { at: rw.t });
      } else {
        gt.add(0, { laser: 1 }, { at: gt.t });
        gt.add(1.8, { x: xs }, { action: r === 0 ? '藍光線雷射掃描：每趟同時看到工件面與兩側基準板面' : '', station: 4, sub: `第 ${r + 1} 列 ${part.grid.cols} 顆` });
        gt.add(0, { laser: 0 }); rw.add(0, { done: r }, { at: gt.t });
        if (r < rows - 1) gt.add(.4, { y: rowZ(r + 1) }, { at: gt.t });
      }
    }
    rw.add(.5, { back: 0 }, { at: gt.t });
    // NG 剔除
    ngs.forEach((i, k) => {
      const s = slot(part, i), x = s.x - 90, z = S.z + QB.meas - s.z;
      gt.add(1, { x, y: z, zt: 1144.5 }, { at: gt.t, action: k === 0 ? `龍門吸盤剔除 NG（共 ${ngs.length} 顆）` : '', station: 5, sub: `第 ${s.r + 1} 列第 ${s.c + 1} 顆 ${heightOf(part, i).toFixed(3)} mm` });
      gt.add(.25, { ext: 1 }); gt.add(0, { carry: 1 }); gt.add(.1, {}); pr.add(0, { removed: k + 1 }, { at: gt.t });
      gt.add(.25, { ext: 0 });
      gt.add(1, { x: QB.bin.x - 90, y: S.z + QB.bin.z, zt: 1180 });
      gt.add(0, { carry: 0, bin: k + 1 }); gt.add(.15, {});
    });
    gt.add(1, { x: QB.gantry.park, y: -560, zt: 1220 }, { at: gt.t, action: '龍門回停放位（離開翻轉區）', station: 5 });
    // 翻回
    t = gt.t;
    fl.add(.4, { cl: 1 }, { at: t, action: '夾住空鐵盒、翻到量測區罩住工件', station: 5 }); bq.add(0, { mode: 'clamped' }, { at: t });
    fl.add(1.5, { th: .5, bl: QB.boxLift }); fl.add(1.5, { th: 1 });
    fl.add(1, { bl: 0 }, { action: '鐵盒下降罩住工件' });
    fl.add(.4, { latch: 1 }, { action: '基準板座上鎖' });
    const f2 = fl.add(3, { th: 0 }, { action: '整組翻回：工件落回盒底', station: 5 });
    pr.add(0, { loc: 'box' }, { at: f2.start + f2.dur });
    fl.add(1, { pl: QB.park }, { action: '基準板座上升、鬆開側夾', station: 5 });
    fl.add(.4, { cl: 0 }); bq.add(0, { mode: 'nest' }, { at: fl.t });
    return fl.t;
  }

  // 逐顆：前 5 顆真實速度，其餘快轉
  function schedulePiece(t0) {
    const cyc = CYCLE.piece[plan.sensor], K = 5, FF = 18;
    const rate = (cap * cyc - K * cyc) / FF, t1 = t0 + K * cyc, tEnd = t1 + FF;
    pieceT = { t0, t1, tEnd, cyc, rate };
    tl.track('piece', {}).add(tEnd - t0, {}, { at: t0 });
    mark(t0, 'SCARA 從入料盒吸起第 1 顆、放上量測砧', 3, `每顆 ${cyc.toFixed(2)} s（${(60 / cyc).toFixed(1)} 顆／分 ≥ 18）`);
    mark(t0 + 1.42, plan.sensor === 'vision' ? '兩組正交遠心相機拍側面輪廓' : '量測頭滑入：一點量頂面、一點量砧面', 4);
    mark(t0 + (plan.sensor === 'vision' ? 1.99 : 2.2), 'OK 放回出料盒同一格、NG 丟進滑槽', 5);
    mark(t1, `快轉：其餘 ${cap - K} 顆（實際約 ${((cap - K) * cyc / 60).toFixed(1)} 分鐘）`, 4);
    return tEnd;
  }
  const tau = t => !pieceT || t < pieceT.t0 ? -1 : t < pieceT.t1 ? t - pieceT.t0 : Math.min(cap * pieceT.cyc, (pieceT.t1 - pieceT.t0) + (t - pieceT.t1) * pieceT.rate);

  // 逐顆的取放（站內 SCARA）：每顆兩段 pickPlace（入料盒 → 砧、砧 → 出料盒或 NG 滑槽）
  const pCache = new Map();
  const pbase = plan.mode === 'piece' ? st.arm.root.position.clone().add(st.root.position) : null;
  const pTravel = 1100, home1 = { j1: 0, j2: 0, d3: 0, j4: 0 }, PIECE_T = { move: .32, down: .1, grip: .06 };
  function boxPartCenter(b, i) {
    const s = slot(part, i), y = Math.sin(QP.boxYaw), c = Math.cos(QP.boxYaw);
    return { c: V(S.x + b.x + s.x * c + s.z * y, QP.nestTop + BOX.bottom, S.z + b.z - s.x * y + s.z * c), yaw: QP.boxYaw + s.rot };
  }
  function pCycle(n) {
    if (pCache.has(n)) return pCache.get(n);
    const prev = n === 0 ? null : pCycle(n - 1), ref = prev ? prev.ref : home1;
    const src = boxPartCenter(QP.inBox, n), ng = isNG(part, heightOf(part, n));
    const anvil = V(S.x + QP.anvil.x, QP.anvil.top, S.z + QP.anvil.z);
    const pick = solve(pbase, padAt(part, src.c, src.yaw), src.yaw, ref);
    const onA = solve(pbase, padAt(part, anvil, src.yaw), src.yaw, pick);
    const dst = ng ? { c: V(S.x + QP.ng.x, QP.ng.y - part.h, S.z + QP.ng.z), yaw: src.yaw } : boxPartCenter(QP.outBox, n);
    const place = solve(pbase, padAt(part, dst.c, dst.yaw), dst.yaw, onA);
    const up = q => atHeight(q, pbase, pTravel), pa = up(pick), an = up(onA), pl = up(place);
    const from = prev ? prev.last : pa, M = PIECE_T, meas = plan.sensor === 'vision' ? .25 : .46;
    let t = 0; const segs = [], marks = {};
    const seg = (dur, a, b, hold, key) => { segs.push({ t0: t, t1: t + dur, a, b, hold }); if (key) marks[key] = t + dur / 2; t += dur; };
    seg(M.move, from, pa); seg(M.down, pa, pick); seg(M.grip, pick, pick, true, 'grip'); seg(M.down, pick, pa);
    // 放上砧後抬到等待高度（量測頭從下方滑入），量完再下降取回
    const anW = atHeight(onA, pbase, QP.heads.wait);
    seg(M.move, pa, an); seg(M.down, an, onA); seg(M.grip, onA, onA, false, 'onAnvil'); seg(M.down, onA, anW);
    const m0 = t; seg(meas, anW, anW); marks.measure = [m0, t];
    seg(M.down, anW, onA); seg(M.grip, onA, onA, true, 'regrip'); seg(M.down, onA, an);
    seg(M.move, an, pl); seg(M.down, pl, place); seg(M.grip, place, place, false, 'release'); seg(M.down, place, pl);
    const out = { segs, ref: place, ng, last: pl, marks, end: t };
    pCache.set(n, out); return out;
  }
  if (plan.mode === 'piece') for (let n = 0; n < cap; n++) pCycle(n);

  // ---------------------------------------------------------------- apply(t)
  const qBox = new THREE.Quaternion(), qx = new THREE.Quaternion(), X = V(1, 0, 0), Y = V(0, 1, 0);
  const hinge = V(S.x, QB.hinge, S.z);
  let opPose = { x: 0, z: 0, yaw: 0 };
  const poseOf = B => B.mode === 'carry' ? { x: opPose.x + Math.sin(opPose.yaw) * 420, y: 1000, z: opPose.z + Math.cos(opPose.yaw) * 420, yaw: opPose.yaw } : B;
  function placeBox(b, s) {
    b.root.position.set(s.x, s.y, s.z); b.root.quaternion.setFromAxisAngle(Y, s.yaw || 0);
  }
  function apply(t) {
    const smp = tl.sample(t);
    press.set(t);
    // ---- 下料 SCARA
    const n = lastPick(t);
    let q = n < 0 ? atHeight(uCycle(0).segs[0].a, ubase, uTravel) : null, hold = false;
    if (n >= 0) { const c = uCycle(n); ({ q, hold } = evalSegs(c.segs, t - c.t, { q: c.segs[0].a, hold: false })); }
    un.arm.setJoints(q); un.tool.set({ hold });
    // 滑道：每列已取走的顆數與往前推進量
    for (let k = 0; k < LAYOUT.lane.n; k++) {
      let picked = 0, adv = 0;
      for (let m = k; m <= n; m += LAYOUT.lane.n) {
        const c = uCycle(m); if (t >= c.t + c.marks.grip) picked++;
        adv += smooth(clamp01((t - (c.t + c.marks.lifted)) / .8));
      }
      press.setLane(k, picked, adv);
    }
    // 下料區鐵盒：擺盒數量與輸送位置
    let placedB = START_FILL, placedC = 0;
    for (let m = 0; m <= n; m++) { const c = uCycle(m); if (t >= c.t + c.marks.release) { if (fillSlot(m).box === 'B') placedB++; else placedC++; } }
    const roll = smooth(clamp01((t - XS - .3) / 3.2)), pitch = U.slots[1] - U.slots[0];
    boxes.B.load.set({ to: placedB }); boxes.C.load.set({ to: placedC }); boxes.D.load.set({ to: 0 });
    placeBox(boxes.B, { x: U.slots[2] + roll * pitch, y: CV.top, z: CV.z });
    placeBox(boxes.C, { x: U.slots[1] + roll * pitch, y: CV.top, z: CV.z });
    placeBox(boxes.D, { x: U.slots[0] + roll * pitch, y: CV.top, z: CV.z });
    un.conv.set({ s: roll * pitch });
    const stopDown = t > XS && t < XS + 3.8 ? 0 : 1;
    un.stops.forEach((s, i) => s.set(i < 2 ? stopDown : 1));
    // ---- 作業員、推車、盒 A
    const O = smp.op, cs = smp.cart.s, cp = along(cs);
    cart.root.position.copy(cp.p); cart.root.rotation.y = cp.yaw - Math.PI / 2;
    let ox = O.x, oz = O.z, oyaw = O.yaw;
    if (O.mode === 'push') { const b = along(cs - 720); ox = b.p.x; oz = b.p.z; oyaw = b.yaw; }
    opPose = { x: ox, z: oz, yaw: oyaw };
    const A = smp.boxA, cartTop = () => ({ x: cp.p.x, y: LAYOUT.cart.deck, z: cp.p.z, yaw: cp.yaw - Math.PI / 2 });
    let aPose = A.mode === 'cart' && O.mode === 'push' ? cartTop() : poseOf(A);
    placeBox(boxes.A, aPose);
    // ---- 量測站
    let hands = null;
    if (plan.mode === 'box') applyBox(t, smp); else applyPiece(t, smp);
    // 作業員手部：抱盒時在盒子短邊、推車時在推把
    const handOn = obj => { const p = obj.root.position, yaw = obj.root.rotation.y || 0, c = Math.cos(yaw), s = Math.sin(yaw); return [-1, 1].map(k => V(p.x + k * 235 * c, p.y + 70, p.z - k * 235 * s)); };
    const outB = boxes[outBox];
    if (O.hands === 'box') hands = handOn(t >= tOut ? outB : boxes.A);
    if (O.hands === 'cart' || O.mode === 'push') { const h = cp.p.clone().addScaledVector(V(Math.sin(cp.yaw), 0, Math.cos(cp.yaw)), -360); const sd = V(Math.cos(cp.yaw), 0, -Math.sin(cp.yaw)); hands = [-1, 1].map(k => h.clone().addScaledVector(sd, k * 160).setY(LAYOUT.cart.deck + 300)); }
    op.set({ x: ox, z: oz, yaw: oyaw, hands, walk: O.walk });
    return smp;
  }

  function applyBox(t, smp) {
    const F = smp.flip, th = F.th, R = st;
    R.flip.rotation.x = -Math.PI * th;
    R.boxCarrier.position.y = F.bl;
    R.pads.forEach(p => p.g.position.set(p.s * (226 + 15 * (1 - F.cl)), 15, QB.nest.z));
    // 基準板座
    const latched = F.latch >= .5, thE = latched ? th : 1, plE = latched ? F.pl : 0;
    qx.setFromAxisAngle(X, -Math.PI * thE);
    R.holder.quaternion.copy(qx);
    R.holder.position.copy(V(0, 7 + plE, QB.nest.z).applyQuaternion(qx)).add(V(0, QB.hinge, 0));
    // 盒 A（到站後）
    if (t >= 23 + 1.2 && smp.boxQ.mode === 'clamped') {
      qx.setFromAxisAngle(X, -Math.PI * th);
      const p = V(0, -40 + F.bl, QB.nest.z).applyQuaternion(qx).add(hinge);
      boxes.A.root.position.copy(p); boxes.A.root.quaternion.copy(qx);
    }
    // 工件：在盒內或在基準板上
    const removed = new Set(ngs.slice(0, smp.parts.removed));
    const Rw = smp.rows, done = Rw.done;
    const ngShown = new Set(ngs.filter(i => slot(part, i).r <= done));
    if (smp.parts.loc === 'holder') {
      boxes.A.load.set({ to: 0 });
      const lift = Array.from({ length: part.grid.rows }, (_, r) => r === Rw.row ? -QB.rowLift * Rw.lift : 0);
      R.holderLoad.set({ to: cap, hide: removed, lift, ng: ngShown });
      R.rails.forEach((rg, r) => { rg.position.y = lift[r]; });
    } else {
      R.holderLoad.set({ to: 0 });
      R.rails.forEach(rg => { rg.position.y = 0; });
      boxes.A.load.set({ to: cap, hide: removed });
    }
    // 頂升銷、背光
    R.pins.forEach((c, r) => c.set({ ext: r === Rw.row ? Rw.lift : 0 }));
    if (R.back) { R.back.position.set(0, 976 + 140 * Rw.back, -160); }
    // 龍門
    const G = smp.gantry;
    R.xAxis.set({ pos: G.x - 100 });
    R.yCar.position.z = (G.y - S.z) - QB.gantry.z;
    R.zCar.position.y = G.zt - 900;
    R.col.position.x = G.x;
    R.pick.position.y = -40 * G.ext;
    R.ngPart.visible = G.carry > .5;
    R.binParts.forEach((m, k) => { m.visible = k < (G.bin || 0); });
    if (R.laser) R.laser.set({ laser: G.laser });
    if (R.cam) R.cam.set(G.flash ? 1 : 0);
  }

  function applyPiece(t, smp) {
    const R = st, tt = tau(t), cyc = pieceT.cyc;
    const nIdx = tt < 0 ? -1 : Math.min(cap - 1, Math.floor(tt / cyc)), phi = tt < 0 ? 0 : tt - nIdx * cyc;
    let q = atHeight(pCycle(0).segs[0].a, pbase, QP.heads.wait), hold = false;
    if (nIdx >= 0) ({ q, hold } = evalSegs(pCycle(nIdx).segs, phi, { q: pCycle(nIdx).segs[0].a, hold: false }));
    R.arm.setJoints(q); R.tool.set({ hold });
    // 工件數量
    let picked = 0, outN = 0, onAnvil = false, measuring = false, ngIn = 0;
    if (nIdx >= 0) {
      const c = pCycle(nIdx), M = c.marks;
      picked = nIdx + (phi >= M.grip ? 1 : 0);
      onAnvil = phi >= M.onAnvil && phi < M.regrip;
      measuring = phi >= M.measure[0] && phi < M.measure[1];
      outN = nIdx + (phi >= M.release ? 1 : 0);
    }
    ngIn = ngs.filter(i => i < outN).length;
    boxes.A.load.set({ from: picked, to: cap });
    boxes.E.load.set({ to: outN, hide: new Set(ngs) });
    R.onAnvil.visible = onAnvil;
    if (onAnvil) { const src = boxPartCenter(QP.inBox, nIdx); R.onAnvil.rotation.y = src.yaw; }
    R.binParts.forEach((m, k) => { m.visible = k < ngIn; });
    if (R.heads) {
      const c = nIdx >= 0 ? pCycle(nIdx).marks.measure : [0, 0], e = !measuring ? 0 : Math.min(1, (phi - c[0]) / .18, (c[1] - phi) / .18);
      R.heads.position.set(QP.anvil.x, 0, QP.heads.park - (QP.heads.park - QP.heads.measure) * smooth(clamp01(e)));
      R.beams.forEach(b => { const len = b.top ? QP.heads.y - (QP.anvil.top + part.h) : QP.heads.y - QP.anvil.top; b.m.scale.y = Math.max(1, len); b.m.position.y = QP.heads.y - len / 2; b.m.visible = measuring && e >= 1 - 1e-6; });
    }
    R.cams.forEach(c => c.set(measuring ? 1 : 0));
    // 出料盒 E
    const E = smp.boxE; if (E) placeBox(boxes.E, poseOf(E));
  }

  // ---------------------------------------------------------------- 站別、空間檢核、檢查設定
  const stationStart = STATIONS.map((_, k) => Math.min(...tl.events.filter(e => e.station === k).map(e => e.start), total));
  const results = Array.from({ length: cap }, (_, i) => ({ i, h: heightOf(part, i), ng: isNG(part, heightOf(part, i)) }));
  const cycleQc = plan.mode === 'box' ? qcEnd - t0 : cap * CYCLE.piece[plan.sensor];
  function layoutChecks() {
    const F = U.frame, P = LAYOUT.pit, [gx0, gx1, gz0, gz1] = P.grate;
    const feet = [];
    for (const z of F.feetZ) for (const x of [F.x0 + 70, U.scara.x, F.x1 - 70]) feet.push([x, z]);
    const onBeam = feet.every(([, z]) => P.joints.includes(z));
    const offGrate = feet.every(([x, z]) => !(x > gx0 - 60 && x < gx1 + 60 && z > gz0 - 60 && z < gz1 + 60));
    const Q = LAYOUT.qc, dist = Math.hypot(S.x - LAYOUT.press.x, S.z - LAYOUT.press.z);
    const qcOffPit = Q.x0 > P.x1;
    const rate = 60 / (cycleQc / cap);
    return [
      { group: '下料', name: '節拍：SCARA 取放一顆 ≤ 3.33 s', ok: uCycle(1).end <= C, value: `${uCycle(1).end.toFixed(2)} s／${C.toFixed(2)} s` },
      { group: '下料', name: '調整腳全部落在蓋板支撐樑上', ok: onBeam, value: `${feet.length} 支` },
      { group: '下料', name: '不壓在落料網格上', ok: offGrate, value: '網格保持可落料' },
      { group: '下料', name: '空盒＋滿盒緩衝（人員多久換一次盒）', ok: true, value: `${(4 * cap * C / 60).toFixed(0)} 分鐘` },
      { group: '量測', name: '品檢站離沖壓機 ≥ 8 m、不在廢料坑上', ok: dist >= 8000 && qcOffPit, value: `${(dist / 1000).toFixed(1)} m` },
      { group: '量測', name: '量測產能 ≥ 18 顆／分', ok: rate >= RATE.perMin, value: `${rate.toFixed(1)} 顆／分（每盒 ${(cycleQc / 60).toFixed(1)} 分）` },
      { group: '量測', name: 'NG 全部被剔除', ok: true, value: `${ngs.length} 顆` },
    ];
  }

  // 已量測的顆數（依量測順序＝格位編號）與正在量的那一顆
  function measured(t) {
    if (plan.mode === 'box') {
      const smp = tl.sample(t), d = smp.rows.done, cols = part.grid.cols, act = tl.tracks.gantry.active(t);
      const scanning = act && /掃描|側拍|^$/.test(act.action) && (smp.gantry.laser > .5 || smp.gantry.flash > .5);
      const row = d + 1, u = scanning ? clamp01((t - act.start) / act.dur) : 0;
      const k = scanning ? Math.min(cols, Math.floor(u * cols)) : 0, col = c => (row % 2 ? cols - 1 - c : c);
      const cur = scanning && k < cols ? row * cols + col(k) : -1;
      const has = i => { const r = Math.floor(i / cols), c = i % cols; return r <= d || (scanning && r === row && (row % 2 ? cols - 1 - c : c) < k); };
      return { count: (d + 1) * cols + k, current: cur, row: scanning ? row : -1, has };
    }
    const tt = tau(t); if (tt < 0) return { count: 0, current: -1, has: () => false };
    const cyc = pieceT.cyc, n = Math.min(cap - 1, Math.floor(tt / cyc)), M = pCycle(n).marks, phi = tt - n * cyc;
    const count = Math.min(cap, n + (phi >= M.measure[1] ? 1 : 0));
    return { count, current: phi >= M.measure[0] && phi < M.measure[1] ? n : -1, has: i => i < count };
  }

  return {
    total, timeline: tl, apply, stationStart, STATIONS, plan, part, results, ngs, cap, cycleQc, t0, tOut, measured,
    press, unloader: un, station: st, boxes, cart, operator: op, layoutChecks,
    focus: t => (t < 24 ? boxes.A.root.position.clone().add(V(0, 120, 0)) : V(S.x, 1050, S.z)),
    verify: {
      skip: o => o.userData?.operatorProxy || o.name === 'walkway marking' || o.name === 'floor',
      allow: [],
      envelope: ['unloader'],
    },
  };
}
