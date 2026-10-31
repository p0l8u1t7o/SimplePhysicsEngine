// 動畫排程：每台設備與每個桶各有一條時間軌，依站位占用（流水線阻塞）推算交接時刻。
// 任一時刻的畫面完全由絕對時間決定，倒退、跳站與連續播放結果一致。
// 清洗線（龍門～秤重）沿用邏輯座標（layout.js 的 front／cell 框架）；AGV、北段輸送、填裝區、暫存區與倉庫用世界座標。
import * as THREE from 'three';
import { PALLET, DIRTY_ORDER, DRUM, AGV, FORK, PALLET_STATION, GANTRY, LYING, LABEL, UPENDER, UPRIGHT, DECAP, BOOTH, WASTE, WEIGH, AIR_KNIFE,
  FRAME, toWorld, CONV, OUTFEED, FILL, STAGING, ROAD3, ROAD5, WH_ZONES } from './layout.js';
import { D2R } from '@core/geom/shapes.js';
import { Track, smooth } from '@core/anim/track.js';
import { JOINTS, SPEED } from './robot.js';

export const STATIONS = [
  { id: 'agv', name: 'AGV 送待洗棧板', short: 'S1' }, { id: 'gantry', name: '龍門上料', short: 'S2' },
  { id: 'label', name: '側標讀碼', short: 'S3' }, { id: 'upender', name: '90° 翻桶', short: 'S4' }, { id: 'decap', name: '自動開蓋', short: 'S5' },
  { id: 'robot', name: '手臂清洗', short: 'S6' }, { id: 'waste', name: '廢液回收', short: 'S7' },
  { id: 'top', name: '頂面貼標', short: 'S8' }, { id: 'fill', name: '分線填裝', short: 'S9' }, { id: 'wipe', name: '擦拭放行', short: 'S10' },
  { id: 'stage', name: '組板入庫', short: 'S11' },
];
export const DRUM_IDS = [1, 2, 3, 4].map(i => `CTW-2610-${String(i).padStart(4, '0')}`);
export const PRE_ID = 'CTW-2610-0080';   // 組板位 A 上已有的成品桶（先前生產）
// 時間軌名稱：本棧板 4 桶＋組板位 A 的 1 桶
export const DRUM_KEYS = [...DRUM_IDS.map((_, k) => 'drum' + k), 'preA'];
const YAW0 = [217, 331, 83, 132];
// 桶內原化學品（側標讀碼後由 MES 帶出）：決定廢液進酸槽或鹼槽
export const CHEM = ['acid', 'alkali', 'acid', 'alkali'];
// 本次要填裝的液體（由條碼決定線別）：A → L1、B → L2
export const LIQUID = ['A', 'B', 'A', 'A'];
const RESIDUAL_G = [46, 38, 57, 41];   // 模擬的秤重殘水量（g）
const SLIP = [1.8, -2.4, .9, -1.3];     // 模擬翻桶與輸送時桶身轉動的角度（°），由開蓋站旋轉台微調
const wrap = a => ((a % 360) + 540) % 360 - 180;
const TANK_NAME = { WA: 'TK-WA 酸性廢液槽', WB: 'TK-WB 鹼性廢液槽', R: 'TK-R 回收槽' };
// 每次沖洗時間：兩支噴槍同時進水（2" 旋轉噴頭＋3/4" 直噴）
export const SPRAY_S = WASTE.rinseL / (BOOTH.flow.big + BOOTH.flow.small) * 60;
export const SPRAY_SINGLE_S = WASTE.rinseL / BOOTH.flow.big * 60;
// 填裝區靜態示意：L3 第 1、2 位與 L4 第 1 位生產中（灌裝槍插入）
export const BUSY = [[2, 0], [2, 1], [3, 0]];
// 世界座標輸送路線（drumWorld 的 route 模式用；createSequence 建立）
export const ROUTES = {};
const [STATION_WX, STATION_WZ] = toWorld('front', PALLET_STATION.x, PALLET_STATION.z);

export function createSequence({ robot }) {
  const T = {};
  const track = (name, base) => (T[name] = new Track(name, base));
  const W = WH_ZONES.pickDirty;
  const agv = track('agv', { x: W.x, z: W.z, yaw: 90, fork: FORK.lifted, moving: false });
  // 棧板：D 待洗棧板（動畫開始時在 AGV 上）、A 組板位 A
  const palD = track('palD', { mode: 'agv', at: '', x: 0, z: 0, yaw: 0 });
  const palA = track('palA', { mode: 'stage', at: 'A', x: 0, z: 0, yaw: 0 });
  const gantry = track('gantry', { x: GANTRY.home.x, z: GANTRY.home.z, y: GANTRY.safeY, tilt: 0, jaw: 0, rot: 0 });
  const labeler = track('labeler', { pad: 0, print: 0, spin: 0, flash: false });
  const upender = track('upender', { tilt: 0, clamp: 0 });
  const decap = track('decap', { hx: 0, hz: 0, hy: DECAP.safeY, spinBig: 0, spinSmall: 0, flash: false, clamp: 0, table: 0, caps: 0, heldBig: false, heldSmall: false });
  const grip = track('grip', { jaw: 0 });
  // lance：0 收回、1 噴洗深度、BOOTH.suckExt 伸到桶底抽液；lance2 為 3/4" 直噴頭
  const booth = track('booth', { lance: 0, lance2: 0, spray: false, vac: false, hot: false, knife: false, src: 'R', pour: '', pool: 0 });   // pour：倒液中的桶序（字串，不插值）
  const scale = track('scale', { on: false, lift: 0, g: 0 });
  const sump = track('sump', { level: 0, pump: false, dest: 'WA' });
  const makeup = track('makeup', { on: false });   // TK-F 液位控制補水（廠務自來水／RO）
  const tanks = track('tanks', Object.fromEntries(Object.entries(WASTE.tanks).map(([k, t]) => [k, t.init])));
  const topLab = track('topLab', { hx: 0, hz: 0, hy: 1, flash: false, label: false });
  const readers = track('readers', { top: false, check: false });
  // 填裝頭（每線每位一組）：e 灌裝槍插入量、sx 換位（0 灌裝、1 鎖蓋頭在桶塞上方）、cy 鎖蓋頭下降、spin 套筒轉數、btn 放行鈕
  const heads = FILL.lines.map((_, li) => FILL.pos.map((_, pi) => track(`h${li}${pi}`, { e: BUSY.some(([a, b]) => a === li && b === pi) ? 1 : 0, sx: 0, cy: 0, spin: 0, btn: false })));
  const wipers = FILL.lines.map((_, li) => track('wiper' + li, { x: FILL.wipers[li], z: FILL.pos[2], wipe: 0 }));
  const stg = track('stg', { x: STAGING.gantry.x0 + 1000, z: STAGING.z, y: STAGING.gantry.safeY, jaw: 0, rot: 45 });
  const drums = DRUM_IDS.map((id, k) => track('drum' + k, { mode: 'pallet', pal: 'D', slot: DIRTY_ORDER[k], yaw: YAW0[k], lx: LYING.place, uz: UPRIGHT.z0, route: '', s: 0, water: 0, film: 0, weighG: -1, lift: 0, capBig: true, capSmall: true, label: false, labelAng: 0, top: 0, read: false, rinse: 0, dry: false, torque: false, state: '倉庫：待洗棧板' }));
  const preA = track('preA', { mode: 'pallet', pal: 'A', slot: 0, yaw: 270, lx: 0, uz: 0, route: '', s: 0, water: 200, film: 0, weighG: 0, lift: 0, capBig: true, capSmall: true, label: true, labelAng: 0, top: 3, read: true, rinse: 3, dry: true, torque: true, state: '組板位 A（先前生產）' });
  const events = [];
  // 事件：與 core 排程同樣的介面 { time, dur, label, sub, station }（播放列的事件選單、上一步／下一步）
  const ev = (s, station, label) => { events.push({ time: s.start, dur: s.dur, label: label || s.action, sub: s.sub || '', station }); return s; };

  // ================================================================ S1 AGV：倉庫待洗棧板 → 道路 → 清洗區棧板站（由南側捲門駛入）
  // 方位 yaw：前進方向 (cos, −sin)；90 朝北、180 朝西、270 朝南。轉向取最近的角度（不繞遠路）
  const move = (to, o) => { const s = agv.state, d = Math.hypot(to.x - s.x, to.z - s.z); return agv.add(o.dur ?? d / (o.speed ?? AGV.speed) + 1.2, { ...to, moving: true }, o); };
  const turn = (yaw, extra = {}, o = {}) => { const y = agv.state.yaw + wrap(yaw - agv.state.yaw); return agv.add(Math.abs(y - agv.state.yaw) / AGV.turn + .8, { yaw: y, moving: true, ...extra }, o); };
  const fork = (v, o = {}) => agv.add(Math.abs(v - agv.state.fork) / AGV.lift + .5, { fork: v, moving: false }, o);
  const RZ = ROAD3.zc, RX = ROAD5.xc, pivotStation = STATION_WZ + AGV.palletX, nearDoor = 15900;
  agv.add(1, {}, { action: '待命：倉庫待洗區', sub: '已叉起一板待洗桶（田字型 4 桶）' });
  ev(move({ x: RX, z: RZ }, { action: 'AGV 出倉庫：沿 5 m 道路往北', sub: '倉庫北牆捲門 → 道路交叉口' }), 'agv', 'AGV 出倉庫送待洗棧板');
  turn(180, {}, { action: '道路交叉口原地轉向西' });
  move({ x: STATION_WX, z: RZ }, { action: '沿 3 m 道路往西', sub: '到清洗區南牆捲門前' });
  turn(90, { fork: PALLET_STATION.stand + FORK.lifted }, { action: '原地轉向北＋貨叉升高', sub: '對準清洗區捲門與龍門光柵入口；棧板底高過棧板座' });
  move({ x: STATION_WX, z: nearDoor }, { action: '駛入清洗區捲門' });
  move({ x: STATION_WX, z: pivotStation }, { speed: AGV.slow, action: '低速駛入棧板站', sub: '光柵屏蔽（muting）開啟' });
  agv.add(.4, { fork: PALLET_STATION.stand + FORK.deck, moving: false }, { action: '棧板落座' });
  palD.add(0, { mode: 'station' }, { at: agv.t });
  ev(agv.add(.5, { fork: PALLET_STATION.stand + FORK.deck - 60 }, { action: '貨叉脫離棧板' }), 'agv', 'AGV 將棧板放上棧板站');
  move({ x: STATION_WX, z: nearDoor }, { speed: AGV.slow, action: '倒車退出龍門區', sub: '退出後光柵恢復，龍門才允許動作' });
  const tAgvOut = agv.t;
  move({ x: STATION_WX, z: RZ }, { action: '倒車到道路' });
  fork(AGV.travel, { action: '貨叉降至行駛高度' });
  agv.add(.5, { moving: false }, { action: '路邊待命', sub: '等待龍門取完 4 桶，空棧板送往填裝區' });

  // ================================================================ 流水線：逐桶推算
  const gp = GANTRY, hang = gp.hang, placePivot = LYING.place - hang;
  const dep = []; let upFree = 0, robotFree = 0, robotStart = null, tPickedClear = 0;
  const travelLy = d => Math.abs(d) / LYING.speed + 1, travelUp = d => Math.abs(d) / UPRIGHT.speed + 1;
  // 機器人位姿（固定物件，關節解快取在物件上）
  const V = (x, y, z) => new THREE.Vector3(x, y, z), E = V(1, 0, 0), S = V(0, 0, 1), UP = V(0, 1, 0), cy = UPRIGHT.top + DRUM.H / 2;
  // 抽殘水姿態：桶身朝 2" 桶口側傾 BOOTH.suckTilt，讓殘水集中到桶口正下方；以 2" 桶口不動為旋轉點
  const suckPose = (() => {
    const base = robot.poseDrum(V(...BOOTH.drum), UP, S), tilt = robot.poseDrum(V(...BOOTH.drum), UP, S, -BOOTH.suckTilt * D2R);
    const bung = V(DRUM.bungR, DRUM.H / 2 - 4, 0);
    const c = V(...BOOTH.drum).add(bung.clone().applyQuaternion(base.rot)).sub(bung.clone().applyQuaternion(tilt.rot));
    return robot.poseDrum(c, UP, S, -BOOTH.suckTilt * D2R);
  })();
  const P = {
    // 張開的夾爪前緣在桶中心前約 210 mm；退到 600 mm 外才不會碰到在取桶位等候的下一桶
    wait: robot.poseDrum(V(UPRIGHT.x - 600, cy, UPRIGHT.pick), UP, E),   // 與取桶預備點同高（再抬高腕部會太靠近基座）
    pre: robot.poseDrum(V(UPRIGHT.x - 600, cy, UPRIGHT.pick), UP, E),
    pick: robot.poseDrum(V(UPRIGHT.x, cy, UPRIGHT.pick), UP, E),
    lift: robot.poseDrum(V(UPRIGHT.x, cy + 250, UPRIGHT.pick), UP, E),
    // 過渡點：沖洗站東北外側，桶身留在圍籬內、隔間北面之外；進出沖洗站都經過這裡
    via: robot.poseDrum(V(10300, 1600, 13250), UP, V(1, 0, 1).normalize()),
    entry: robot.poseDrum(V(BOOTH.drum[0], 1600, BOOTH.entryZ), UP, S),
    u: robot.poseDrum(V(...BOOTH.drum), UP, S),
    pour: robot.poseDrum(V(...BOOTH.drum), UP, S, 190 * D2R),
    suck: suckPose,
    above: robot.poseDrum(V(UPRIGHT.x, cy + 250, UPRIGHT.place), UP, E),
    place: robot.poseDrum(V(UPRIGHT.x, cy, UPRIGHT.place), UP, E),
    retract: robot.poseDrum(V(UPRIGHT.x - 600, cy, UPRIGHT.place), UP, E),
  };
  // 搖晃：只繞夾爪軸（J6）來回滾轉 ±25°，3 個週期，振幅以正弦包絡起停；J6 峰值約 100°/s
  const shakeAt = e => robot.poseDrum(V(...BOOTH.drum), UP, S, 25 * D2R * Math.sin(Math.PI * e) * Math.sin(e * Math.PI * 2 * 3));
  const rsteps = []; let rpose = P.wait, rjoints = robot.solve(P.wait), rt = 0;
  const rAdd = (kind, to, dur, o = {}) => {
    const start = Math.max(o.at ?? rt, rt), j0 = rjoints, j1 = kind === 'path' ? j0 : robot.solve(to, j0);
    if (kind === 'ptp' && dur == null) dur = Math.max(1.2, ...JOINTS.map(n => Math.abs(j1[n] - j0[n]) / (SPEED[n] * D2R * (o.vf ?? .55)) * 1.875));
    const s = { track: 'robot', start, dur, kind, pose0: rpose, pose1: kind === 'path' ? rpose : to, j0, j1, motion: o.motion, action: o.action ?? '', sub: o.sub ?? '' };
    rsteps.push(s); rt = start + dur; if (kind !== 'path') { rpose = to; rjoints = j1; } return s;
  };

  for (let k = 0; k < 4; k++) {
    const d = drums[k], [sx, sz] = PALLET.slots[DIRTY_ORDER[k]], px = PALLET_STATION.x + sx, pz = PALLET_STATION.z + sz, prev = dep[k - 1] || {};   // 棧板朝向 0°
    const id = DRUM_IDS[k];
    // ---- S2 龍門：取桶 → 抬升 → 移出棧板範圍 → 等放料位空 → 邊移邊翻 90° → 放上 V 槽輥
    gantry.hold(tAgvOut + 1);
    // 夾爪轉到棧板外側的對角（窄爪不碰同板相鄰的桶）；方位與組板龍門的 jawRot 同一規則（這裡的爪在局部 ±Z）
    const jr = (sx > 0) === (sz > 0) ? 45 : -45;
    const g0 = gantry.add(Math.hypot(px - gantry.state.x, pz - gantry.state.z) / 600 + 1.2, { x: px, z: pz, y: gp.safeY, tilt: 0, jaw: 0, rot: jr }, { action: `移至第 ${k + 1} 桶上方`, sub: `${id}；夾爪轉 ${jr}° 對準對角` });
    if (k === 0) ev(g0, 'gantry', '龍門開始上料');
    gantry.add(2, { y: gp.pickY }, { action: '下降夾桶位', sub: '窄弧 PU 爪由對角兩側包覆桶身上半部，避開同板相鄰的桶' });
    gantry.add(1, { jaw: 1 }, { action: '夾爪夾緊', sub: '夾持確認後才抬升' });
    d.add(0, { mode: 'gantry', yaw: d.state.yaw - jr, state: '龍門夾持' }, { at: gantry.t });   // 桶跟著夾爪轉：世界方位 = yaw + rot
    gantry.add(2, { y: gp.safeY }, { action: '抬升至安全高度', sub: `翻轉軸 ${gp.safeY} mm；桶底高於相鄰桶頂` });
    gantry.add(1.2, { rot: 0 }, { action: '夾爪轉回', sub: '桶跟著轉，翻桶方向不變' });
    gantry.add(1.5, { x: 4900 }, { action: '沿 X 移出棧板範圍', sub: '先平移再翻轉，避免掃到相鄰桶' });
    tPickedClear = gantry.t;
    gantry.hold(prev.place != null ? prev.place + 3.2 : 0);
    ev(gantry.add(3.5, { x: placePivot, z: LYING.z, tilt: 1 }, { action: '邊移邊翻轉 90°', sub: '桶頂朝西、桶底朝東（配合翻桶機方向）' }), 'gantry', `${id} 翻轉放倒`);
    gantry.add(2.5, { y: gp.placeY }, { action: '下降至 V 槽滾輪', sub: `水平沙漏形滾輪，桶中心高 ${LYING.y} mm` });
    gantry.add(1, { jaw: 0 }, { action: '夾爪鬆開' });
    d.add(0, { mode: 'lying', lx: LYING.place, state: '橫躺輸送' }, { at: gantry.t });
    gantry.add(2, { y: gp.safeY }, { action: '夾爪上升', sub: '放料位交給輸送' });
    const r = { placed: gantry.t };
    if (k === 3) gantry.add(3, { x: gp.home.x, z: gp.home.z, tilt: 0 }, { action: '回原點', sub: '4 桶上料完成' });

    // ---- 輸送：放料位 → 貼標站
    r.place = Math.max(r.placed, prev.label ?? 0);
    d.add(travelLy(LYING.label - LYING.place), { lx: LYING.label, state: '往貼標站' }, { at: r.place });
    // ---- S3 貼標＋讀碼
    labeler.hold(d.t);
    // 到位辨識：斜拍桶頂端面找 2" 桶塞（桶蓋未拆，白蓋對藍桶頂），算出要轉的角度，一次轉到定位再確認
    // 2" 桶塞在桶局部 +X；橫躺時貼標方位 labelAng = −yaw，要讓 labelAng = 90° + 規定角度
    const bungNow = wrap(d.state.yaw + 90), toTarget = wrap(-90 - LABEL.angle - d.state.yaw);
    const p0 = labeler.add(.5, { flash: true }, { action: '相機到位辨識', sub: `2" 桶塞目前在標籤基準 ${bungNow.toFixed(0)}°，需轉 ${toTarget.toFixed(0)}°（模擬）` });
    if (k === 0) ev(p0, 'label', '貼標站：相機辨識桶塞方位');
    labeler.add(.1, { flash: false });
    const rr = labeler.add(Math.abs(toTarget) / LABEL.rotSpeed + .8, { spin: labeler.state.spin + toTarget / 90 }, { action: '旋轉輥轉到貼標方位', sub: `標籤中心對 2" 桶塞 ${LABEL.angle}°（客戶規定）` });
    d.add(rr.dur, { yaw: d.state.yaw + toTarget }, { at: rr.start });
    labeler.add(.4, { flash: true }, { action: '確認到位', sub: '再取像一次：偏差 0.4°，允收 ±' + LABEL.tol + '°（模擬）' });
    labeler.add(.1, { flash: false });
    labeler.add(1.8, { print: 1 }, { action: '列印識別標籤', sub: `${id}｜QR＋桶號` });
    labeler.add(1.2, { pad: 1 }, { action: '貼標頭推出', sub: '吸附標籤推向桶身南側' });
    // 貼附當下桶面朝南的局部方位
    const qLy = yaw => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw * D2R));
    const dl = S.clone().applyQuaternion(qLy(d.state.yaw).invert()), labelAng = Math.atan2(dl.x, dl.z) / D2R;
    d.add(0, { label: true, labelAng, state: '已貼標' }, { at: labeler.t });
    labeler.add(.4, { print: 0 }, { action: '壓貼', sub: '標籤 100×150 mm，貼於桶身中段' });
    labeler.add(1, { pad: 0 }, { action: '貼標頭退回' });
    // 轉 ±90° 讓標籤朝上給相機
    const upLocal = yaw => UP.clone().applyQuaternion(qLy(yaw).invert());
    const lblVec = new THREE.Vector3(Math.sin(labelAng * D2R), 0, Math.cos(labelAng * D2R));
    const spin = [90, -90].find(sg => upLocal(d.state.yaw + sg).dot(lblVec) > .99) ?? 90;
    const rs = labeler.add(1.6, { spin: labeler.state.spin + spin / 90 }, { action: '旋轉輥帶動桶身', sub: '標籤轉到正上方' });
    d.add(1.6, { yaw: d.state.yaw + spin }, { at: rs.start });
    ev(labeler.add(.9, { flash: true }, { action: '同一相機貼後檢查', sub: `QR ${id} 讀取 OK；標籤中心對 2" 桶塞 ${(LABEL.angle + .4).toFixed(1)}°，允收 ±${LABEL.tol}°（模擬）` }), 'label', `${id} 讀碼與位置檢查`);
    d.add(0, { read: true, chem: CHEM[k] }, { at: labeler.t });
    labeler.add(.2, { flash: false }, { action: '讀碼完成' });
    // 出站方位：轉到立起後 2" 桶塞朝北（yaw = 90°），開蓋站只需微調
    const toExit = wrap(-90 - d.state.yaw);
    const ex = labeler.add(Math.abs(toExit) / LABEL.rotSpeed + .6, { spin: labeler.state.spin + toExit / 90 }, { action: '轉到出站方位', sub: '翻正後 2" 桶塞朝向開蓋站基準方位，開蓋站只需微調' });
    d.add(ex.dur, { yaw: d.state.yaw + toExit }, { at: ex.start });
    r.labelDone = labeler.t;
    // ---- 貼標站 → 緩衝位 → 翻桶機
    r.label = Math.max(r.labelDone, prev.buffer ?? 0);
    d.add(travelLy(LYING.buffer - LYING.label), { lx: LYING.buffer, state: '緩衝位' }, { at: r.label });
    r.buffer = Math.max(d.t, upFree, prev.upender ?? 0);
    d.add(travelLy(LYING.upender - LYING.buffer), { lx: LYING.upender, state: '進入翻桶機' }, { at: r.buffer });
    // ---- S4 翻桶
    upender.hold(d.t);
    const u0 = upender.add(.8, { clamp: 1 }, { action: '側夾夾緊', sub: '桶底靠緊翻轉靠板' });
    if (k === 0) ev(u0, 'upender', '翻桶機開始');
    d.add(0, { mode: 'upender', state: '翻桶中' }, { at: upender.t });
    ev(upender.add(4, { tilt: 1 }, { action: '翻轉 90°', sub: '以桶底下緣為軸，桶口朝上' }), 'upender', `${id} 翻正`);
    upender.add(.6, { clamp: 0 }, { action: '側夾鬆開' });
    r.upender = Math.max(upender.t, prev.decap ?? 0);
    d.add(0, { mode: 'upright', uz: UPRIGHT.z0, yaw: d.state.yaw + 180, state: '立放輸送' }, { at: r.upender });
    d.add(travelUp(DECAP.z - UPRIGHT.z0), { uz: DECAP.z, yaw: d.state.yaw + SLIP[k] }, { at: r.upender });   // 翻桶與輸送讓桶身轉動數度
    upender.add(3.5, { tilt: 0 }, { at: r.upender + 2.5, action: '翻轉台復歸' });
    upFree = upender.t;
    // ---- S5 開蓋
    decap.hold(d.t);
    const c0 = decap.add(.8, { clamp: 1 }, { action: '定心夾持', sub: id });
    if (k === 0) ev(c0, 'decap', '開蓋站開始');
    const bungAt = ((d.state.yaw % 360) + 360) % 360;
    const delta = wrap(90 - d.state.yaw);
    decap.add(1, { flash: true }, { action: '頂視相機確認桶蓋與偏差', sub: `兩個桶蓋都在；2" 桶塞偏離北側 ${(-delta).toFixed(1)}°（模擬）` });
    decap.add(.2, { flash: false });
    const rt0 = decap.add(Math.abs(delta) / 30 + .6, { table: decap.state.table + delta }, { action: '旋轉台微調', sub: `修正 ${delta.toFixed(1)}°（貼標站已轉到出站方位，微調範圍 ±5°）` });
    d.add(rt0.dur, { yaw: d.state.yaw + delta }, { at: rt0.start });
    const capTop = UPRIGHT.top + DRUM.H / 2 + 463 + 12;
    for (const [key, hx, hz, binX, name] of [['Big', 90, -200, DECAP.bin.x - UPRIGHT.x + 90, '2"'], ['Small', -90, 200, DECAP.bin.x - UPRIGHT.x - 90, '3/4"']]) {
      decap.add(1.6, { hx, hz, hy: DECAP.safeY }, { action: `鎖付軸移至 ${name} 桶塞` });
      decap.add(1, { hy: capTop - 40 }, { action: '套筒下降套住桶蓋' });
      const sp = decap.add(2.4, { ['spin' + key]: decap.state['spin' + key] + 1, hy: capTop - 25 }, { action: `反轉拆下 ${name} 桶蓋`, sub: '扭力監控；蓋子隨套筒內撐爪帶出' });
      if (k === 0 && key === 'Big') ev(sp, 'decap', '拆 2" 桶蓋');
      d.add(0, { ['cap' + key]: false }, { at: decap.t }); decap.add(0, { ['held' + key]: true });
      decap.add(.9, { hy: DECAP.safeY }, { action: '帶蓋上升' });
      decap.add(1.6, { hx: binX, hz: 0 }, { action: '移至桶蓋收集桶' });
      decap.add(.8, { hy: 1150 }, { action: '下降' });
      decap.add(.4, { ['held' + key]: false, caps: decap.state.caps + 1 }, { action: '鬆開桶蓋' });
      decap.add(.6, { hy: DECAP.safeY });
    }
    decap.add(1.2, { hx: 0, hz: 0 }, { action: '鎖付軸回原點' });
    decap.add(.6, { clamp: 0 }, { action: '鬆開定心夾' });
    d.add(0, { state: '桶口已開' }, { at: decap.t });
    r.decap = Math.max(decap.t, prev.pick ?? 0);
    d.add(travelUp(UPRIGHT.pick - DECAP.z), { uz: UPRIGHT.pick, state: '待手臂取桶' }, { at: r.decap });
    const tAtPick = d.t;

    // ---- S6 手臂清洗：從取桶位取下 → 沖洗站 → 放回同一條線的放回位
    const tRobot = Math.max(tAtPick, robotFree);
    if (robotStart == null) robotStart = tRobot;
    const a0 = rAdd('lin', P.pre, 1.2, { at: tRobot, action: '接近取桶位', sub: '夾爪張開，沿 +X 前進' });
    if (k === 0) ev(a0, 'robot', '手臂開始取桶');
    rAdd('lin', P.pick, 1.6, { action: '夾爪包覆桶身' });
    grip.hold(rt); grip.add(1, { jaw: 1 }, { action: '夾爪夾緊' }); rt = grip.t;
    d.add(0, { mode: 'robot', state: '手臂夾持' }, { at: rt });
    rAdd('lin', P.lift, 1, { action: '抬升 250 mm', sub: '桶底高過輸送側導引' });
    r.pick = rt;
    rAdd('ptp', P.via, null, { action: '移到沖洗站東北過渡點', sub: '桶身避開圍籬東南角與隔間' });
    rAdd('ptp', P.entry, null, { action: '轉向沖洗站', sub: '關節同步插值（PTP），桶身停在隔間開口外' });
    const en = rAdd('lin', P.u, 1.8, { action: '送入沖洗站', sub: '2" 與 3/4" 桶口對準兩支噴槍' });
    ev(en, 'robot', `${id} 進入沖洗站`);
    for (let c = 1; c <= 3; c++) {
      const src = c === 1 ? 'R' : 'F', dest = c < 3 ? (CHEM[k] === 'acid' ? 'WA' : 'WB') : 'R';
      booth.hold(rt);
      booth.add(1, { lance: 1, lance2: 1, src }, { action: `第 ${c} 次沖洗：兩支噴槍伸入桶口`, sub: '2" 旋轉噴頭、3/4" 直噴頭同時伸入約 140 mm' });
      const sp = booth.add(SPRAY_S, { spray: true }, { action: `第 ${c} 次沖洗：雙孔同時進水 ${SPRAY_S.toFixed(1)} s`, sub: `${WASTE.rinseL} L ＝ 2" ${BOOTH.flow.big}＋3/4" ${BOOTH.flow.small} L/min（單孔需 ${SPRAY_SINGLE_S.toFixed(0)} s）；水源 ${src === 'R' ? 'TK-R 回收水' : 'TK-F 清水'}` });
      if (c === 1 && k === 0) ev(sp, 'waste', '沖洗水由 TK-R 供應');
      d.add(0, { rinse: c, state: `第 ${c} 次沖洗` }, { at: sp.start }); d.add(SPRAY_S, { water: WASTE.rinseL }, { at: sp.start });
      tanks.add(SPRAY_S, { [src]: tanks.state[src] - WASTE.rinseL }, { at: sp.start, action: `P-1 供水 ${src === 'R' ? 'TK-R' : 'TK-F'} → 噴槍` });
      if (src === 'F') { tanks.add(4, { F: tanks.state.F + WASTE.rinseL }, { at: sp.start + SPRAY_S, action: 'TK-F 液位補水' }); makeup.add(4, { on: true }, { at: sp.start + SPRAY_S, action: '廠務清水補入 TK-F' }); makeup.add(0, { on: false }); }
      booth.add(1, { spray: false, lance: 0, lance2: 0 }, { action: '噴槍退回' });
      rt = booth.t;
      rAdd('path', null, 5, { motion: shakeAt, action: `第 ${c} 次搖晃`, sub: '繞夾爪軸來回滾轉 ±25°，殘液沖刷桶壁' });
      rAdd('lin', P.pour, 2.2, { action: `第 ${c} 次倒液：翻轉 190°`, sub: '2" 桶口轉到最低點出水，3/4" 在上方當通氣口' });
      booth.hold(rt);
      const pr = booth.add(BOOTH.pourS, { pour: String(k), pool: 1 }, { action: `倒入集液漏斗 → ${TANK_NAME[dest]}`, sub: `3/4" 通氣不咕嚕，約 ${BOOTH.pourS} s（不通氣約 ${BOOTH.pourNoVentS} s）` });
      d.add(BOOTH.pourS, { water: c < 3 ? 0 : BOOTH.residualL, film: c < 3 ? 0 : BOOTH.filmG }, { at: pr.start });
      if (k === 0 && c === 1) ev(pr, 'waste', '倒液進集液漏斗');
      sump.add(BOOTH.pourS, { level: 1, dest }, { at: pr.start });
      booth.add(.1, { pour: '', pool: 0 });
      const pm = sump.add(3, { pump: true, level: 0 }, { action: `P-2 送液 → ${TANK_NAME[dest]}`, sub: dest === 'R' ? 'V-3 切到回收槽' : `依桶號判定${CHEM[k] === 'acid' ? '酸性' : '鹼性'}，V-3／V-4 切換去向` });
      tanks.add(3, { [dest]: tanks.state[dest] + WASTE.rinseL }, { at: pm.start, action: `集液槽 → ${TANK_NAME[dest]}` });
      if (k === 0 && c === 3) ev(pm, 'waste', '末道沖洗水回收至 TK-R');
      sump.add(0, { pump: false });
      rt = Math.max(rt, pr.start + BOOTH.pourS);
      if (c < 3) rAdd('lin', P.u, 2, { action: '轉回桶口朝上' });
    }
    // ---- 末道倒液後：轉正微傾，2" 噴槍伸到桶底，以負壓抽乾殘水
    rAdd('path', null, 2, { motion: () => P.pour, action: '倒置滴乾', sub: '桶口朝下停留 2 s' });
    rAdd('lin', P.suck, 2.4, { action: '轉正並朝 2" 側微傾', sub: `傾 ${BOOTH.suckTilt}°，殘水集中到 2" 桶口正下方` });
    booth.hold(rt);
    booth.add(2.2, { lance: BOOTH.suckExt }, { action: '抽液管伸到桶底', sub: '2" 噴槍長行程伸入，吸口距桶底約 15 mm' });
    const vs = booth.add(BOOTH.vacS, { vac: true }, { action: '負壓抽乾殘水', sub: `真空泵 VP-1 抽約 ${BOOTH.residualL} L 殘水 → 集液槽 → TK-R；目標殘水 < 50 mL` });
    if (k === 0) ev(vs, 'waste', '負壓抽乾桶內殘水');
    d.add(BOOTH.vacS, { water: 0 }, { at: vs.start });
    sump.add(BOOTH.vacS, { level: .3, dest: 'R' }, { at: vs.start });
    // 內壁附著水：熱風由 3/4" 進、桶底負壓持續抽，水膜與水氣一起帶走
    booth.add(1, { lance2: 1 }, { action: '3/4" 噴槍切換熱風並伸入', sub: `HB-1 熱風機 ${BOOTH.hotAirC}°C 乾燥空氣` });
    const hd = booth.add(BOOTH.dryS, { hot: true }, { action: '熱風吹乾＋負壓抽氣', sub: `熱風由 3/4" 進、2" 桶底負壓抽出，帶走內壁約 ${BOOTH.filmG} g 附著水與水氣` });
    if (k === 0) ev(hd, 'waste', '熱風吹乾內壁附著水');
    d.add(BOOTH.dryS, { film: RESIDUAL_G[k], dry: true, state: '熱風吹乾' }, { at: hd.start });
    booth.add(2, { hot: false, vac: false, lance: 0, lance2: 0 }, { action: '熱風、負壓停止，噴槍收回' });
    sump.add(1.5, { pump: true, level: 0 }, { action: 'P-2 送液 → TK-R' }); sump.add(0, { pump: false });
    rt = booth.t;
    rAdd('lin', P.u, 1.5, { action: '轉正' });
    d.add(0, { state: '清洗完成' }, { at: rt });
    // 退出時通過開口風刀，吹掉桶外表水珠
    booth.hold(rt); const kn = booth.add(AIR_KNIFE.sec, { knife: true }, { action: '風刀吹乾桶外表', sub: '開口兩側風刀，手臂帶桶通過時吹掉外表水珠' }); booth.add(0, { knife: false });
    if (k === 0) ev(kn, 'robot', '退出時風刀吹外表');
    rAdd('lin', P.entry, AIR_KNIFE.sec, { at: kn.start, action: '退出沖洗站', sub: '通過開口風刀' });
    r.placeFree = prev.handoff ?? 0;
    rAdd('ptp', P.via, null, { action: '退到過渡點', sub: '先離開隔間東北角再轉回產線' });
    rAdd('ptp', P.above, null, { at: r.placeFree, action: '轉回產線放回位', sub: '關節同步插值（PTP）' });
    rAdd('lin', P.place, 1.2, { action: '下降放回輸送線' });
    grip.hold(rt); grip.add(.8, { jaw: 0 }, { action: '夾爪鬆開' }); rt = grip.t;
    d.add(0, { mode: 'upright', uz: UPRIGHT.place, yaw: 90, state: '已洗淨' }, { at: rt });
    ev(rAdd('lin', P.retract, 1, { action: '夾爪退出' }), 'robot', `${id} 放回輸送線`);
    // 秤重段：殘水 = 秤重 − 桶號建檔的空桶重，< 100 g 才放行（NG 時手臂夾回補吹）
    const lu = scale.add(WEIGH.liftS, { lift: 1 }, { at: rt + 1, action: '梳齒秤台頂升', sub: `從滾筒縫隙頂起 ${WEIGH.lift} mm，把桶托離輸送` });
    d.add(WEIGH.liftS, { lift: WEIGH.lift, state: '秤重中' }, { at: lu.start });
    const wg = scale.add(WEIGH.sec, { on: true, g: RESIDUAL_G[k] }, { action: '秤重確認乾燥', sub: `讀數穩定後計算：殘水 ${RESIDUAL_G[k]} g < ${WEIGH.limitG} g，放行（模擬）` });
    if (k === 0) ev(wg, 'robot', '秤重確認殘水 < 100 g');
    const ld = scale.add(WEIGH.liftS, { on: false, lift: 0 }, { action: '秤台下降', sub: '桶回到滾筒上' });
    d.add(WEIGH.liftS, { lift: 0 }, { at: ld.start });
    d.add(0, { weighG: RESIDUAL_G[k], state: '秤重 OK' }, { at: scale.t });
    d.add(travelUp(UPRIGHT.handoff - UPRIGHT.place), { uz: UPRIGHT.handoff, state: '送往頂面貼標' }, { at: scale.t });
    r.handoff = d.t;
    d.add(0, { mode: 'route', route: 'in' + k, s: 0, state: '北段輸送' }, { at: r.handoff });
    rAdd('ptp', P.wait, null, { action: '回到取桶等待點', vf: .7 });
    robotFree = rt;
    dep.push(r);
  }

  // ================================================================ 清洗完 → 頂面貼標 → 讀碼 → 轉角 → 三碼比對分線 → 填裝鎖蓋 → 擦拭放行 → 集貨 → 組板
  const spd = CONV.speed, [hx, hz] = toWorld('cell', UPRIGHT.x, UPRIGHT.handoff), [pickX, pickZ] = STAGING.pick;
  const along = pts => { const S = [0]; for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return S; };
  const go = (d, S, j, o) => d.add(Math.abs(S[j] - d.state.s) / spd + 1, { s: S[j] }, o);
  const lineNext = FILL.lines.map(() => 0), lineClear = FILL.lines.map(() => 0), palNext = { A: STAGING.preload.A, B: STAGING.preload.B };
  const HX = [0, 165, -165];   // 3 張頂標在世界 X 的偏移（桶方位 270°：桶局部 z → 世界 −x）
  const G = STAGING.gantry, deckY = PALLET.H + DRUM.H / 2, convY = CONV.top + DRUM.H / 2;
  // 組板龍門夾爪方位：爪朝棧板外側與對角，避開同板相鄰的桶
  const jawRot = ([sx, sz]) => (sx > 0) === (sz > 0) ? -45 : 45;
  let tAfull = null;
  dep.forEach((r, k) => {
    const d = drums[k], id = DRUM_IDS[k], liq = LIQUID[k], li = FILL.liquids.indexOf(liq), lx = FILL.lines[li], pi = lineNext[li]++, pz = FILL.pos[pi];
    const inPts = [[hx, hz], [hx, OUTFEED.topLabel], [hx, OUTFEED.topRead], [hx, FILL.distZ], [FILL.reader, FILL.distZ], [lx, FILL.distZ], [lx, pz]];
    ROUTES['in' + k] = inPts; const S = along(inPts);
    // ---- S8 頂面貼標（旋蓋面 3 張：1 張無條碼＋2 張條碼，條碼與側標同一讀值）
    go(d, S, 1, { action: '北段輸送 → 頂面貼標站' });
    topLab.hold(d.t);
    for (let n = 0; n < 3; n++) {
      const p = topLab.add(.9, { hx: HX[n], hy: 1, flash: true, label: false }, { action: `列印第 ${n + 1} 張頂標`, sub: n ? `條碼 ${id}（與側標同值）` : '品名／警示標（無條碼）' });
      if (k === 0 && n === 0) ev(p, 'top', '頂面貼標開始（3 張）');
      topLab.add(.3, { flash: false, label: true }, { action: '貼標頭吸附標籤' });
      topLab.add(.8, { hy: 0 }, { action: '下壓貼附', sub: '避開 2" 與 3/4" 桶塞' });
      d.add(0, { top: n + 1 }, { at: topLab.t });
      topLab.add(.3, { label: false }); topLab.add(.6, { hy: 1 }, { action: '貼標頭上升' });
    }
    topLab.add(.8, { hx: 0 }, { action: '貼標頭回原點' });
    d.add(0, { state: '頂標 3 張完成' }, { at: topLab.t });
    d.hold(topLab.t);
    go(d, S, 2, { action: '往貼後讀碼' });
    readers.hold(d.t);
    const rt1 = readers.add(1.2, { top: true }, { action: '貼後讀碼：頂面 2 碼', sub: `${id} × 2，與側標一致（模擬）` });
    if (k === 0) ev(rt1, 'top', `${id} 頂標讀碼`);
    readers.add(0, { top: false });
    d.hold(readers.t);
    go(d, S, 3, { action: '往北側轉角' });
    d.add(1.5, { state: '轉角直角移載' }, { action: '直角移載：轉往西' });
    go(d, S, 4, { action: '分線輸送（穿過共用牆進填裝區）', sub: '往三碼比對站' });
    d.add(0, { state: '三碼比對' });
    readers.hold(Math.max(readers.t, d.t));
    const ck = readers.add(1.5, { check: true }, { action: '三碼比對', sub: `頂 2 碼＋側 1 碼皆為 ${id} → 一致，放行；液體 ${liq} → L${li + 1}（模擬）` });
    ev(ck, 'fill', `${id} 三碼一致 → L${li + 1}`);
    readers.add(0, { check: false });
    d.add(0, { read: true }, { at: readers.t }); d.hold(readers.t);
    go(d, S, 5, { action: `往 L${li + 1} 分岐` });
    d.add(1.5, { state: `轉入 L${li + 1}` }, { action: '直角移載：轉往南' });
    go(d, S, 6, { action: `到 L${li + 1} 第 ${pi + 1} 位`, sub: '區段式輸送，各位獨立' });
    d.add(0, { state: `L${li + 1} 第 ${pi + 1} 位 · 待填裝` });
    // ---- S9 填裝（各位獨立啟動）＋鎖蓋扭力
    const h = heads[li][pi]; h.hold(d.t);
    h.add(FILL.lanceS, { e: 1 }, { action: '灌裝槍下降插入 2" 桶口', sub: '3/4" 桶口開著當通氣口' });
    const fl = h.add(FILL.fillS, {}, { action: `秤重式灌裝 200 L（液體 ${liq}）`, sub: `3 分鐘／桶（手稿）；同線其他填裝位各自運轉` });
    if (k === 0) ev(fl, 'fill', `${id} 開始填裝`);
    d.add(FILL.fillS, { water: 200, state: `填裝中（液體 ${liq}）` }, { at: fl.start });
    h.add(FILL.lanceS, { e: 0 }, { action: '灌裝槍上升', sub: '槍口滴液盤接住殘滴' });
    h.add(1.5, { sx: 1 }, { action: '填裝頭換位', sub: '鎖蓋頭移到 2" 與 3/4" 桶塞上方' });
    h.add(1, { cy: 1 }, { action: '鎖蓋頭下降', sub: '套筒帶新桶蓋（桶蓋供料方式待確認）' });
    d.add(0, { capBig: true, capSmall: true, state: '鎖蓋中' }, { at: h.t });
    h.add(3, { spin: h.state.spin + 2.5 }, { action: '同時鎖緊 2" 與 3/4" 桶蓋' });
    const tq = h.add(1, {}, { action: '扭力檢測', sub: `${FILL.torque.big}；${FILL.torque.small}` });
    if (k === 0) ev(tq, 'fill', '鎖蓋扭力檢測（2 種扭力）');
    d.add(0, { torque: true, state: '扭力 OK · 待擦拭' }, { at: h.t });
    h.add(1, { cy: 0 }, { action: '鎖蓋頭上升' }); h.add(1.5, { sx: 0 }, { action: '填裝頭復位' });
    // ---- S10 擦拭放行（每線 1 人巡迴）
    const wp = wipers[li]; wp.hold(Math.max(wp.t, h.t - 4));
    wp.add(Math.abs(pz - wp.state.z) / 1000 + 1, { z: pz }, { action: `走到第 ${pi + 1} 位`, sub: '東側走道' });
    wp.add(1.2, { x: lx + FILL.wipeDx }, { action: '走近桶旁', sub: '桶間站位' });
    const wi = wp.add(FILL.wipeS, { wipe: 1 }, { action: '擦拭桶身', sub: '擦去灌裝溢滴，確認標籤與桶蓋' });
    if (k === 0) ev(wi, 'wipe', `${id} 人員擦拭桶身`);
    d.add(0, { state: '擦拭中' }, { at: wi.start });
    wp.add(0, { wipe: 0 });
    wp.add(1.2, { x: FILL.wipers[li] }, { action: '退回走道' });
    h.hold(wp.t); const bt = h.add(.8, { btn: true }, { action: '放行確認', sub: '擦拭完成，人員按放行鈕' });
    wp.add(.8, {}, { action: '按放行鈕' });
    if (k === 0) ev(bt, 'wipe', '按放行鈕確認');
    h.add(.4, { btn: false });
    // ---- 放行 → 集貨輸送 → 暫存區取料位
    const exPts = [[lx, pz], [lx, FILL.collectZ], [pickX, pickZ]]; ROUTES['ex' + k] = exPts; const SE = along(exPts);
    const tRel = Math.max(h.t, lineClear[li]);
    d.add(0, { route: 'ex' + k, s: 0, state: '放行 → 集貨輸送' }, { at: tRel });
    go(d, SE, 1, { action: '往集貨輸送', sub: '下游各位已清空' });
    lineClear[li] = d.t;
    d.add(1.5, { state: '轉入集貨輸送' }, { action: '直角移載：轉往西' });
    go(d, SE, 2, { action: '集貨輸送 → 暫存區取料位' });
    d.add(0, { state: '取料位 · 等組板龍門' });
    // ---- S11 組板：龍門夾桶 → 同液體的棧板
    const slot = palNext[liq]++, [sx, sz] = PALLET.slots[slot], tx = STAGING.pallets[liq] + sx, tz = STAGING.z + sz, rot = jawRot([sx, sz]);
    stg.hold(Math.max(stg.t, d.t));
    const g0 = stg.add(Math.hypot(pickX - stg.state.x, pickZ - stg.state.z) / 600 + 1.2, { x: pickX, z: pickZ, y: G.safeY, rot }, { action: '移到取料位上方', sub: id });
    if (k === 0) ev(g0, 'stage', '組板龍門取桶');
    stg.add(1.8, { y: convY }, { action: '下降夾桶位' });
    stg.add(1, { jaw: 1 }, { action: '夾爪夾緊' });
    d.add(0, { mode: 'stg', state: '組板龍門夾持' }, { at: stg.t });
    stg.add(1.8, { y: G.safeY }, { action: '抬升', sub: '桶底高過棧板上的桶 100 mm 以上' });
    stg.add(Math.hypot(tx - pickX, tz - pickZ) / 600 + 1.2, { x: tx, z: tz }, { action: `移到組板 ${liq} 第 ${slot + 1} 格`, sub: '同液體同板（田字型 2×2）' });
    stg.add(2, { y: deckY }, { action: '下降放上棧板' });
    stg.add(1, { jaw: 0 }, { action: '夾爪鬆開' });
    d.add(0, { mode: 'pallet', pal: liq, slot, yaw: 270, state: `組板 ${liq} · ${palNext[liq]}/4` }, { at: stg.t });
    stg.add(1.8, { y: G.safeY }, { action: '夾爪上升' });
    if (liq === 'A' && palNext.A === 4) tAfull = stg.t;
  });
  stg.add(3, { x: G.x0 + 1000, z: STAGING.z, rot: 45 }, { action: '組板龍門回原點' });

  // ================================================================ AGV：空棧板 → 填裝區空棧板位 → 倉庫充電；組板 A 滿板 → 倉庫成品 A
  const [EX, AX] = [STAGING.pallets.E, STAGING.pallets.A], pivotStage = STAGING.z + AGV.palletX, stageDoor = 16000;
  agv.hold(tPickedClear + 1);
  ev(move({ x: STATION_WX, z: nearDoor }, { action: '駛入清洗區取空棧板', sub: '龍門已離開棧板範圍' }), 'agv', 'AGV 空棧板送填裝區');
  fork(PALLET_STATION.stand + FORK.entry, { action: '貨叉對準空棧板' });
  move({ x: STATION_WX, z: pivotStation }, { speed: AGV.slow, action: '低速插入空棧板', sub: '光柵屏蔽' });
  agv.add(.4, { fork: PALLET_STATION.stand + FORK.deck, moving: false }, { action: '貨叉接觸空棧板' });
  palD.add(0, { mode: 'agv' }, { at: agv.t });
  agv.add(.5, { fork: PALLET_STATION.stand + FORK.lifted }, { action: '抬起空棧板' });
  move({ x: STATION_WX, z: nearDoor }, { speed: AGV.slow, action: '倒車退出龍門區' });
  move({ x: STATION_WX, z: RZ }, { action: '倒車到道路' });
  turn(180, {}, { action: '原地轉向西' });
  move({ x: EX, z: RZ }, { action: '沿 3 m 道路往西', sub: '到填裝區南牆捲門（空棧板位）' });
  turn(90, {}, { action: '原地轉向北' });
  move({ x: EX, z: stageDoor }, { action: '駛入填裝區捲門' });
  move({ x: EX, z: pivotStage }, { speed: AGV.slow, action: '低速駛入空棧板位' });
  agv.add(.4, { fork: FORK.deck, moving: false }, { action: '空棧板落地' });
  palD.add(0, { mode: 'stage', at: 'E' }, { at: agv.t });
  ev(agv.add(.5, { fork: FORK.deck - 60 }, { action: '貨叉脫離', sub: '空棧板留給組板重複使用' }), 'agv', '空棧板放到填裝區空棧板位');
  move({ x: EX, z: stageDoor }, { speed: AGV.slow, action: '倒車退出' });
  move({ x: EX, z: RZ }, { action: '倒車到道路' });
  fork(AGV.travel, { action: '貨叉降至行駛高度' });
  turn(0, {}, { action: '原地轉向東' });
  move({ x: RX, z: RZ }, { action: '沿 3 m 道路往東', sub: '回倉庫' });
  turn(270, {}, { action: '原地轉向南' });
  move({ x: RX, z: WH_ZONES.aisleZ }, { action: '駛入倉庫' });
  turn(180, {}, { action: '原地轉向西' });
  move({ x: AGV.charger.x, z: WH_ZONES.aisleZ }, { action: '駛到充電位' });
  agv.add(.5, { moving: false }, { action: '待命：充電中', sub: '等待組板 A 滿板' });
  // ---- 組板 A 滿板 → 倉庫成品 A
  agv.hold(tAfull + 1);
  const drop = WH_ZONES.drop.A, pivotDrop = drop.z - AGV.palletX;
  ev(turn(0, {}, { action: '接到任務：組板 A 滿板入庫', sub: '原地轉向東' }), 'stage', 'AGV 取組板 A 滿板');
  move({ x: RX, z: WH_ZONES.aisleZ }, { action: '駛到倉庫門內' });
  turn(90, {}, { action: '原地轉向北' });
  move({ x: RX, z: RZ }, { action: '出倉庫到道路交叉口' });
  turn(180, {}, { action: '原地轉向西' });
  move({ x: AX, z: RZ }, { action: '沿 3 m 道路往西', sub: '到填裝區南牆捲門（組板 A）' });
  turn(90, { fork: FORK.entry }, { action: '原地轉向北', sub: '貨叉降到插入高度' });
  move({ x: AX, z: stageDoor }, { action: '駛入填裝區捲門' });
  move({ x: AX, z: pivotStage }, { speed: AGV.slow, action: '低速插入棧板', sub: '組板龍門已回原點' });
  agv.add(.4, { fork: FORK.deck, moving: false }, { action: '貨叉接觸棧板' });
  palA.add(0, { mode: 'agv' }, { at: agv.t });
  ev(agv.add(.6, { fork: FORK.lifted }, { action: '抬起滿板（4 桶約 900 kg）' }), 'stage', '叉起組板 A 滿板');
  move({ x: AX, z: stageDoor }, { speed: AGV.slow, action: '倒車退出' });
  move({ x: AX, z: RZ }, { action: '倒車到道路' });
  turn(0, {}, { action: '原地轉向東' });
  move({ x: RX, z: RZ }, { action: '沿 3 m 道路往東', sub: '回倉庫' });
  turn(270, {}, { action: '原地轉向南' });
  move({ x: RX, z: WH_ZONES.aisleZ }, { action: '駛入倉庫' });
  turn(0, {}, { action: '原地轉向東' });
  move({ x: drop.x, z: WH_ZONES.aisleZ }, { action: '沿主通道到成品 A 區' });
  turn(270, {}, { action: '原地轉向南' });
  move({ x: drop.x, z: pivotDrop }, { speed: AGV.slow, action: '低速駛入儲位' });
  agv.add(.4, { fork: FORK.deck, moving: false }, { action: '棧板落地' });
  palA.add(0, { mode: 'wh', x: drop.x, z: drop.z, yaw: agv.state.yaw - 90 }, { at: agv.t });
  for (const d of [...drums.filter((_, k) => LIQUID[k] === 'A'), preA]) d.add(0, { state: '倉庫成品 A' }, { at: agv.t });
  ev(agv.add(.5, { fork: FORK.deck - 60 }, { action: '貨叉脫離', sub: '成品 A 入庫完成' }), 'stage', '成品 A 入庫完成');
  move({ x: drop.x, z: WH_ZONES.aisleZ }, { speed: AGV.slow, action: '倒車退出' });
  fork(AGV.travel, { action: '貨叉降至行駛高度' });
  agv.add(.5, { moving: false }, { action: '待命' });

  // ---------------------------------------------------------------- 取樣
  const robotSample = Tm => {
    let s = null; for (let i = rsteps.length - 1; i >= 0; i--) if (rsteps[i].start <= Tm) { s = rsteps[i]; break; }
    if (!s) { robot.setJoints(robotHome); return { step: null }; }
    const t = s.dur > 0 ? Math.min(1, (Tm - s.start) / s.dur) : 1, e = smooth(t);
    if (t >= 1 || s.kind === 'ptp') {
      const j = {}; for (const n of JOINTS) j[n] = s.j0[n] + (s.j1[n] - s.j0[n]) * (t >= 1 ? 1 : e);
      robot.setJoints(j); return { step: Tm < s.start + s.dur ? s : null, pose: t >= 1 ? s.pose1 : null };
    }
    let pose, seed = {};
    if (s.kind === 'path') { pose = s.motion(e); for (const n of JOINTS) seed[n] = s.j0[n]; }
    else { pose = { target: s.pose0.target.clone().lerp(s.pose1.target, e), rot: s.pose0.rot.clone().slerp(s.pose1.rot, e) }; for (const n of JOINTS) seed[n] = s.j0[n] + (s.j1[n] - s.j0[n]) * e; }
    const r = robot.track(pose, seed); return { step: s, pose, err: r.err };
  };
  const robotHome = robot.solve(P.wait);
  const total = Math.max(...Object.values(T).map(t => t.end), rt) + 2;
  events.sort((a, b) => a.time - b.time);
  const stationStart = Object.fromEntries(STATIONS.map(s => [s.id, events.find(e => e.station === s.id)?.time ?? 0]));

  function sample(Tm) {
    const st = {}; for (const [k, t] of Object.entries(T)) st[k] = t.sample(Tm);
    const r = robotSample(Tm);
    return { time: Tm, st, robot: r };
  }
  function activity(Tm) {
    const out = {}; for (const [k, t] of Object.entries(T)) { const s = t.active(Tm); if (s && s.action) out[k] = s; }
    const r = rsteps.find(s => s.start <= Tm && Tm < s.start + s.dur); if (r) out.robot = r;
    return out;
  }
  return { sample, activity, tracks: T, robotSteps: rsteps, events, total, stationStart, poses: P, robotStart, dep };
}

// ---------------------------------------------------------------- 由狀態推算世界座標（主程式與驗證共用）
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), Yax = new THREE.Vector3(0, 1, 0), Zax = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
// 框架矩陣：front 平移、cell 旋轉 180° 後平移
export const FRAME_M = {
  front: new THREE.Matrix4().makeTranslation(FRAME.front.x, 0, FRAME.front.z),
  cell: new THREE.Matrix4().makeTranslation(FRAME.cell.x, 0, FRAME.cell.z).multiply(new THREE.Matrix4().makeRotationY(Math.PI)),
};
const FRAME_Q = { front: new THREE.Quaternion(), cell: new THREE.Quaternion().setFromAxisAngle(Yax, Math.PI) };
const toFrame = (f, out) => { out.pos.applyMatrix4(FRAME_M[f]); out.q.premultiply(FRAME_Q[f]); return out; };
export function palletWorld(p, agvState) {
  const at = (x, y, z, yaw) => ({ pos: new THREE.Vector3(x, y, z), yaw });
  if (p.mode === 'station') return at(STATION_WX, PALLET_STATION.stand, STATION_WZ, 0);
  if (p.mode === 'stage') return at(STAGING.pallets[p.at], 0, STAGING.z, 0);
  if (p.mode === 'wh') return at(p.x, 0, p.z, p.yaw);
  const a = agvState, y = a.yaw * D2R;
  // 棧板底樑沿 Z（朝向 0°），AGV 朝北（90°）叉起，所以棧板方位 = AGV 方位 − 90°
  return at(a.x + Math.cos(y) * AGV.palletX, a.fork - FORK.deck, a.z - Math.sin(y) * AGV.palletX, a.yaw - 90);
}
const STATIC_PALLET = { B: { mode: 'stage', at: 'B' } };
// 沿世界座標路線取點
function routePoint(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az);
    if (s <= L || i === pts.length - 1) { const u = L ? Math.min(1, s / L) : 0; return [ax + (bx - ax) * u, az + (bz - az) * u]; }
    s -= L;
  }
  return pts[0];
}
// 回傳桶中心位置與姿態（key：drum0–3、preA；robotTcp：cell 邏輯座標的手臂 TCP 矩陣，僅 robot 模式需要）
// logical：清洗線上的桶回傳框架內的邏輯座標（tools/verify.mjs 的手臂、龍門檢查用），其他模式回傳 hidden
export function drumWorld(key, st, robotTcp, { logical = false } = {}) {
  const d = st[typeof key === 'number' ? 'drum' + key : key], pos = new THREE.Vector3(), q = new THREE.Quaternion(), out = { pos, q };
  const frame = f => logical ? out : toFrame(f, out);
  switch (d.mode) {
    case 'hidden': case 'gone': return { pos: pos.set(0, -5000, 0), q, hidden: true };
    case 'pallet': {
      if (logical) return { pos: pos.set(0, -5000, 0), q, hidden: true };
      const pw = palletWorld(STATIC_PALLET[d.pal] ?? st['pal' + d.pal], st.agv), [sx, sz] = PALLET.slots[d.slot], c = Math.cos(pw.yaw * D2R), s = Math.sin(pw.yaw * D2R);
      pos.set(pw.pos.x + sx * c + sz * s, pw.pos.y + PALLET.H + DRUM.H / 2, pw.pos.z - sx * s + sz * c);
      q.setFromAxisAngle(Yax, (d.yaw + pw.yaw) * D2R); return out;
    }
    case 'gantry': {
      const g = st.gantry, a = g.tilt * Math.PI / 2;
      pos.set(g.x + Math.sin(a) * GANTRY.hang, g.y - Math.cos(a) * GANTRY.hang, g.z);
      q.setFromAxisAngle(Zax, a).multiply(_q.setFromAxisAngle(Yax, (d.yaw + (g.rot || 0)) * D2R)); return frame('front');
    }
    case 'lying':
      pos.set(d.lx, LYING.y, LYING.z); q.setFromAxisAngle(Zax, Math.PI / 2).multiply(_q.setFromAxisAngle(Yax, d.yaw * D2R)); return frame('front');
    case 'upender': {
      const a = -st.upender.tilt * Math.PI / 2, [px, py, pz] = UPENDER.pivot, rx = LYING.upender - px, ry = LYING.y - py;
      pos.set(px + rx * Math.cos(a) - ry * Math.sin(a), py + rx * Math.sin(a) + ry * Math.cos(a), pz);
      q.setFromAxisAngle(Zax, a).multiply(_q.setFromAxisAngle(Zax, Math.PI / 2)).multiply(_q2.setFromAxisAngle(Yax, d.yaw * D2R)); return frame('front');
    }
    case 'upright': pos.set(UPRIGHT.x, UPRIGHT.top + DRUM.H / 2 + (d.lift || 0), d.uz); q.setFromAxisAngle(Yax, d.yaw * D2R); return frame('cell');
    case 'robot': robotTcp.decompose(pos, q, _s); return frame('cell');
    case 'route': {
      if (logical) return { pos: pos.set(0, -5000, 0), q, hidden: true };
      const [x, z] = routePoint(ROUTES[d.route], d.s); pos.set(x, CONV.top + DRUM.H / 2, z); q.setFromAxisAngle(Yax, 270 * D2R); return out;
    }
    case 'stg': {
      if (logical) return { pos: pos.set(0, -5000, 0), q, hidden: true };
      pos.set(st.stg.x, st.stg.y, st.stg.z); q.setFromAxisAngle(Yax, 270 * D2R); return out;
    }
  }
  return out;
}
