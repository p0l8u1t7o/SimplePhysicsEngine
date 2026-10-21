// Twin Protocol 工作階段引擎（SPE 端，server）：一則訊息進、一串訊息出，傳輸層只負責收送與關閉
// （與 AutoSequence 假 SPE 的 ITwinServerEngine.Handle 同形，可以逐則對照 FakeSpe/ModelSpe.cs）。
// 純模組：不 import node:*、不碰 DOM、不 import Automation-Schema（驗證函式由呼叫端注入 schema），瀏覽器與 Node 都能載入。
//
// 決定性（twin-protocol README §4.1）：鎖步只依 tick 帶來的整數 tUs 推進，不讀掛鐘、不用亂數；同一串輸入訊息得到逐位元相同的輸出。
// 即時模式的掛鐘由呼叫端以 pollRealtime(nowUs) 傳入，本檔不讀時鐘。
//
//   const prepared = prepareTwin({ md, twin });                 // 啟動時一次：MD 索引、綁定解析（unbound、bindings）
//   const session = createTwinSession({ prepared, mdHash, schema, software, maxLine, options });   // 每條連線一個
//   for (const out of session.receive(line)) send(out);         // 一行文字（已分框）；或 session.handle(msg)
//   if (session.closed) close();                                 // fatal error 或 bye 之後
//
// 鎖步 tick(n) 的處理（SPE 開發計畫 4.1 設計要點 5）：依接收順序套用暫存的 cmd／fault（時間 t_{n-1}，被拒的回 non-fatal error）
// → 故障生效／解除（from、until ≤ t_{n-1}）→ 軸、致動器、機器人推進到 t_n → 到期的排程事件（曝光、工件）→ 站的場景（幾何感測器）
// → 感測器 → DI（sensorStuck 覆寫輸出、再套 io.logic）→ 增量 state → 送出 [error]* → state(n)? → event(n)* → tickAck(n)。
import { indexMd } from './md.js';
import { resolveBindings, buildView } from './binding.js';
import { createAxis, trapezoid } from './dynamics/axis.js';
import { createActuator, driveFromOutput } from './dynamics/actuator.js';
import { createRobot } from './dynamics/robot.js';
import { sensorOutput, isGeometric } from './sensors.js';
import { DEFAULT_MAX_LINE, parseMessage } from './framing.js';
import { applyTransfers } from './workpieces.js';

export const PROTO = 'zqs.twin/2.0';
const PROTO_RE = /^zqs\.twin\/(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SUPPORTED_MINOR = 0;

// 站的設定預設值（與假 SPE 的 mgpc.fake-spe.json 相同的意義）
const CONFIG = { exposureDelay: 0.05, homeDuration: 0.5, taskDefault: 2, taskDuration: {}, switches: {}, collisionEvery: 0.02 };

// 各 op 可用的實體種類
const OP_KINDS = {
  move_abs: ['axis'], move_rel: ['axis'], enable: ['axis'], home: ['axis'], clear_error: ['axis'],
  stop: ['axis', 'robot'], set: ['io'], move: ['robot'], task: ['robot'], light: ['device'], barcode: ['device'], vision: ['device'],
};
const OP_CAPABILITY = { light: 'light', barcode: 'barcode_reader', vision: 'vision_station' };
// 故障種類可用的目標種類
const FAULT_KINDS = {
  sensorStuck: ['sensor', 'io'], actuatorStuck: ['actuator'], followingError: ['axis'], axisFault: ['axis'], robotFault: ['robot'], commLoss: ['device'],
};

const sortedEntries = map => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// 啟動時一次：MD 索引與綁定（場景建立、MD 載入、綁定解析都要在接受連線之前完成，Hub 的握手逾時預設 5 s）
export function prepareTwin({ md, twin }) {
  const index = indexMd(md);
  const bound = resolveBindings(index, twin);
  return { index, bound, twin, config: { ...CONFIG, ...(twin.config || {}) } };
}

export function createTwinSession({ prepared, mdHash, schema = null, software = { name: 'SPE core/twin', version: '0.1.0' }, maxLine = null, options = {} }) {
  const { index, bound, twin, config } = prepared;
  const unbound = new Set(bound.unbound);
  const homeUs = Math.round(config.homeDuration * 1e6), exposureUs = Math.round(config.exposureDelay * 1e6), collideUs = Math.max(1, Math.round(config.collisionEvery * 1e6));
  const geometric = bound.sensors.some(b => isGeometric(b.md));
  const geometryKeys = twin.geometryKeys || null;

  let helloDone = false, closed = false, realtime = false, tolerant = false;
  let peerMaxLine = DEFAULT_MAX_LINE, stateRate = 50, lastTick = 0, lastUs = 0;
  let axes, actuators, robots, reported, reportedDi, pending, scheduled, faults, frozen, stuckIo, lights, workpieces, order, lastGeometry, activePairs, lastCollideUs, exposures;

  // ---------------------------------------------------------------- 初始狀態（每條連線都從站的初始狀態開始）
  function reset() {
    axes = new Map(bound.axes.map(b => [b.md.id, createAxis(b.md, b.initial)]));
    actuators = new Map(bound.actuators.map(b => [b.md.id, createActuator(b.md, b.initial)]));
    robots = new Map(bound.robots.map(b => [b.md.id, createRobot(b.md, b.initial)]));
    reported = { axes: new Map(), actuators: new Map(), robots: new Map() };
    reportedDi = new Map(); pending = []; scheduled = []; faults = []; frozen = new Set(); stuckIo = new Map();
    lights = new Map(); workpieces = []; order = 0; lastGeometry = null; activePairs = new Set(); lastCollideUs = -1; exposures = new Map();
    lastTick = 0; lastUs = 0;
    twin.resetWorkpieces?.();
  }
  reset();

  const isFrozen = device => !!device && frozen.has(device);
  const railOf = r => (r.md.railAxis && axes.has(r.md.railAxis) ? axes.get(r.md.railAxis).state().pos : undefined);
  const error = (code, msg, fatal, refSeq) => {
    if (fatal) closed = true;
    const e = { t: 'error', code, msg: String(msg).slice(0, 2000), fatal };
    if (refSeq !== undefined) e.refSeq = refSeq;
    return e;
  };
  const event = (k, n, time, fields) => ({ t: 'event', k, ...(n !== undefined ? { n } : {}), time, ...fields });

  // ---------------------------------------------------------------- 目前的 MD 值 → 站的 view（場景值）
  function values() {
    const v = { axes: {}, actuators: {}, robots: {} };
    for (const [id, a] of axes) v.axes[id] = a.state().pos;
    for (const [id, a] of actuators) v.actuators[id] = a.pos;
    for (const [id, r] of robots) v.robots[id] = r.q;
    return v;
  }
  function view() {
    const out = buildView(bound, values());
    out.lights = Object.fromEntries(sortedEntries(lights));
    out.di = Object.fromEntries(sortedEntries(reportedDi));
    out.workpieces = workpieces.map(w => ({ ...w }));
    out.exposures = Object.fromEntries(sortedEntries(exposures));   // 設備 → 最近一次曝光的時刻（µs），觀看端用來閃光
    out.timeUs = lastUs;
    return out;
  }
  // 幾何感測器：只有 geometryKeys（站提供；沒有時是全部鍵）的值改變時才重新套用場景；
  // 站提供 applyGeometry(view) 時只更新感測器會看到的物件（每個 tick 都可能呼叫，整個場景的 apply 太慢）
  function applyScene(force = false) {
    const fn = twin.applyGeometry || twin.apply;
    if (!geometric || !fn) return;
    const v = buildView(bound, values());
    const sig = JSON.stringify(geometryKeys ? geometryKeys.map(k => v.keys[k] ?? v.paths[k] ?? null) : v);
    if (!force && sig === lastGeometry) return;
    lastGeometry = sig;
    if (force && twin.apply) twin.apply(v); else fn(v);
  }

  // 感測器 → DI；回傳有變化者（commLoss 的設備凍結它的 DI）
  function computeDi() {
    applyScene();
    const changes = new Map(), ctx = { actuators, axes, switches: config.switches, sense: twin.sense, workpieces };
    for (const io of index.io) {
      if (io.dir !== 'DI') continue;
      if (isFrozen(io.device) && reportedDi.has(io.id)) continue;
      const sensor = index.sensorByIo(io.id);
      let out = sensor && !unbound.has(sensor.id) ? sensorOutput(sensor, ctx) : false;
      if (stuckIo.has(io.id)) out = stuckIo.get(io.id);
      const level = io.logic === 'inverted' ? !out : out;
      if (reportedDi.get(io.id) !== level) { reportedDi.set(io.id, level); changes.set(io.id, level); }
    }
    return changes;
  }

  function snapshot() {
    const pick = (models, rep, fn) => Object.fromEntries(sortedEntries(models).map(([id, m]) => [id, rep.get(id) ? JSON.parse(rep.get(id)) : fn(m)]));
    return {
      t: 'snapshot', n: lastTick, tUs: lastUs, time: lastUs / 1e6,
      axes: pick(axes, reported.axes, a => a.state()),
      di: Object.fromEntries(sortedEntries(reportedDi)),
      ai: {},
      actuators: pick(actuators, reported.actuators, a => a.state()),
      robots: pick(robots, reported.robots, r => r.state(railOf(r))),
      workpieces: workpieces.map(w => ({ wp: w.wp, kind: w.kind, holder: w.holder })),
      faults: faults.filter(f => f.active).map(f => f.msg.fid),
    };
  }

  // ---------------------------------------------------------------- 握手
  function builtinHello(msg) {
    const m = typeof msg.proto === 'string' ? PROTO_RE.exec(msg.proto) : null;
    if (!m) return { ok: false, code: 'BAD_MESSAGE', message: 'proto 格式不對' };
    if (Number(m[1]) !== 2) return { ok: false, code: 'PROTO_MAJOR_MISMATCH', message: `主版號 ${m[1]} 與支援的 2 不相容` };
    if (msg.mdHash !== mdHash) return { ok: false, code: 'MD_HASH_MISMATCH', message: `mdHash ${msg.mdHash} 與本方的 ${mdHash} 不符` };
    return { ok: true, compat: Number(m[2]) > SUPPORTED_MINOR ? 'newer-minor' : 'same' };
  }
  function hello(msg) {
    if (msg.role !== 'hub') return [error('BAD_MESSAGE', 'hello.role 必須是 hub', true)];
    const check = schema?.checkHello ? schema.checkHello(msg, { mdHash }) : builtinHello(msg);
    if (!check.ok) return [error(check.code || 'BAD_MESSAGE', check.message, true)];
    if (msg.mode !== 'lockstep' && msg.mode !== 'realtime') return [error('BAD_MESSAGE', 'hub 的 hello 必須有 mode', true)];
    if (!isNum(msg.dt)) return [error('BAD_MESSAGE', 'hub 的 hello 必須有 dt', true)];
    tolerant = check.compat === 'newer-minor';
    realtime = msg.mode === 'realtime';
    peerMaxLine = Number.isInteger(msg.maxLine) ? msg.maxLine : DEFAULT_MAX_LINE;
    stateRate = isNum(msg.stateRate) && msg.stateRate > 0 ? msg.stateRate : 50;
    reset();
    applyScene(true);
    computeDi();
    for (const [id, a] of axes) reported.axes.set(id, JSON.stringify(a.state()));
    for (const [id, a] of actuators) reported.actuators.set(id, JSON.stringify(a.state()));
    for (const [id, r] of robots) reported.robots.set(id, JSON.stringify(r.state(railOf(r))));
    helloDone = true;
    const reply = { t: 'hello', proto: PROTO, role: 'spe', mdHash, machine: index.machine.id };
    if (maxLine) reply.maxLine = maxLine;
    reply.software = software;
    Object.assign(reply, { station: twin.station, bindings: bound.bindings, unbound: [...bound.unbound] });
    return [reply, snapshot()];
  }

  // ---------------------------------------------------------------- cmd
  function validateCmd(cmd) {
    const args = cmd.args;
    if (!isObj(args)) return ['BAD_ARGS', 'args 必須是物件'];
    if (cmd.op === 'wp_spawn' || cmd.op === 'wp_remove') {
      if (cmd.id !== 'scene') return ['UNSUPPORTED_OP', '工件指令的目標是 scene'];
      if (typeof args.wp !== 'string' || (cmd.op === 'wp_spawn' && (typeof args.kind !== 'string' || typeof args.at !== 'string'))) return ['BAD_ARGS', '工件指令需要 wp（spawn 另需 kind、at）'];
      return null;
    }
    const kind = index.kindOf(cmd.id);
    if (!kind) return ['UNKNOWN_ID', `MD 沒有 ${cmd.id}`];
    if (unbound.has(cmd.id)) return ['UNSUPPORTED_OP', `${cmd.id} 沒有場景綁定（unbound）`];
    const device = index.deviceOf(cmd.id);
    if (isFrozen(device)) return ['DEVICE_OFFLINE', `設備 ${device} 離線（commLoss）`];
    const kinds = OP_KINDS[cmd.op];
    if (!kinds || !kinds.includes(kind)) return ['UNSUPPORTED_OP', `${cmd.id} 不支援 ${cmd.op}`];
    if (kind === 'axis' && !axes.has(cmd.id) || kind === 'robot' && !robots.has(cmd.id)) return ['UNSUPPORTED_OP', `${cmd.id} 沒有場景綁定`];
    if (cmd.op === 'set' && !['DO', 'AO'].includes(index.get(cmd.id).dir)) return ['UNSUPPORTED_OP', `${cmd.id} 不是輸出點`];
    if (OP_CAPABILITY[cmd.op] && !index.hasCapability(cmd.id, OP_CAPABILITY[cmd.op])) return ['UNSUPPORTED_OP', `${cmd.id} 沒有 ${OP_CAPABILITY[cmd.op]} 能力`];
    const bad = {
      move_abs: () => !isNum(args.pos), move_rel: () => !isNum(args.dist),
      enable: () => typeof args.value !== 'boolean',
      set: () => (index.get(cmd.id).dir === 'DO' ? typeof args.value !== 'boolean' : !isNum(args.value)),
      move: () => !['ptp', 'line'].includes(args.motion) || !isObj(args.target),
      task: () => !['start', 'stop', 'reset'].includes(args.action),
      light: () => typeof args.on !== 'boolean',
      barcode: () => args.action !== 'trigger', vision: () => args.action !== 'trigger',
      stop: () => args.mode !== undefined && !['controlled', 'immediate'].includes(args.mode),
    }[cmd.op];
    if (bad?.()) return ['BAD_ARGS', `${cmd.op} 的 args 不合規定`];
    if ((cmd.op === 'move_abs' || cmd.op === 'move_rel') && (args.v !== undefined && !(args.v > 0) || args.a !== undefined && !(args.a > 0))) return ['BAD_ARGS', 'v、a 必須大於 0'];
    return null;
  }

  function moveAxis(cmd, ax, target, v, a, nowUs, out) {
    const travel = ax.md.travel;
    if (!isNum(target) || target < travel[0] || target > travel[1]) { out.push(error('BAD_ARGS', `目標 ${target} 超出 ${ax.md.id} 的行程`, false, cmd.seq)); return false; }
    const speed = v ?? ax.md.vMax, accel = a ?? ax.md.aMax;
    if (!(speed > 0) || !(accel > 0)) { out.push(error('BAD_ARGS', 'v、a 必須大於 0', false, cmd.seq)); return false; }
    if (!ax.enabled) { out.push(error('BAD_ARGS', `${ax.md.id} 未啟用`, false, cmd.seq)); return false; }
    if (ax.fault !== null) { out.push(error('BAD_ARGS', `${ax.md.id} 故障中（${ax.fault}）`, false, cmd.seq)); return false; }
    ax.update(nowUs, homeUs);
    ax.stop = null; ax.home = null;
    ax.move = target === ax.pos ? null : trapezoid(nowUs, ax.pos, target, speed, accel);
    return true;
  }

  function moveRobot(cmd, rb, args, nowUs, out) {
    const speed = args.speed ?? 100;
    if (!(speed > 0) || speed > 100) { out.push(error('BAD_ARGS', 'speed 必須 0 < speed ≤ 100', false, cmd.seq)); return; }
    if (rb.fault !== null) { out.push(error('BAD_ARGS', `${rb.md.id} 故障中`, false, cmd.seq)); return; }
    rb.update(nowUs);
    const t = args.target;
    let q = null;
    if (Array.isArray(t.q)) {
      if (t.q.length !== rb.q.length || !t.q.every(isNum)) { out.push(error('BAD_ARGS', `q 必須有 ${rb.q.length} 個關節角`, false, cmd.seq)); return; }
      q = t.q;
    } else if (Array.isArray(t.pos) && Array.isArray(t.rot)) {
      if (twin.ik) {
        q = twin.ik(rb.md.id, { pos: t.pos, rot: t.rot, tool: t.tool, rail: t.rail ?? railOf(rb) }, rb.q);
        if (!q) { out.push(error('BAD_ARGS', '逆運動學無解（目標超出可達範圍）', false, cmd.seq)); return; }
      }
    } else { out.push(error('BAD_ARGS', 'target 需要 q 或 pos＋rot', false, cmd.seq)); return; }
    if (isNum(t.rail) && rb.md.railAxis && axes.has(rb.md.railAxis)) {
      const ax = axes.get(rb.md.railAxis);
      if (!moveAxis(cmd, ax, t.rail, ax.md.vMax * speed / 100, ax.md.aMax, nowUs, out)) return;
    }
    if (q) rb.moveJoints(q, speed, nowUs);
    else rb.start(rb.q, Math.ceil(1e6 / (speed / 100)), nowUs);   // 站沒有逆運動學：關節不變、忙碌 1 s（同假 SPE）
  }

  function execute(cmd, nowUs, out) {
    const args = cmd.args, ax = axes.get(cmd.id), rb = robots.get(cmd.id);
    switch (cmd.op) {
      case 'move_abs': moveAxis(cmd, ax, args.pos, args.v, args.a, nowUs, out); break;
      case 'move_rel': moveAxis(cmd, ax, ax.pos + args.dist, args.v, args.a, nowUs, out); break;
      case 'enable': ax.enabled = args.value; break;
      case 'home': ax.move = null; ax.stop = null; ax.homed = false; ax.home = { startUs: nowUs, from: ax.pos }; break;
      case 'clear_error': ax.fault = null; break;
      case 'stop':
        if (ax) {
          if (!ax.move && !ax.home) break;
          ax.update(nowUs, homeUs); ax.move = null; ax.home = null;
          if (args.mode === 'immediate' || ax.vel === 0) { ax.vel = 0; ax.stop = null; }
          else ax.stop = { startUs: nowUs, pos: ax.pos, vel: ax.vel, decel: ax.md.aMax };
        } else { rb.update(nowUs); rb.halt(); if (rb.task === 'running') rb.task = 'stopped'; }
        break;
      case 'set': {
        const io = index.get(cmd.id);
        if (io.dir === 'DO' && io.drives && actuators.has(io.drives.actuator)) driveFromOutput(actuators.get(io.drives.actuator), io.drives.action, args.value, nowUs);
        break;
      }
      case 'move': moveRobot(cmd, rb, args, nowUs, out); break;
      case 'task':
        rb.update(nowUs);
        if (args.action === 'start') {
          if (!rb.md.tasks?.some(t => t.name === args.name)) { out.push(error('BAD_ARGS', `沒有任務 ${args.name}`, false, cmd.seq)); break; }
          if (rb.fault !== null) { out.push(error('BAD_ARGS', `${rb.md.id} 故障中`, false, cmd.seq)); break; }
          rb.task = 'running'; rb.taskName = args.name;
          rb.taskEndUs = nowUs + Math.round((config.taskDuration[args.name] ?? config.taskDefault) * 1e6);
        } else if (args.action === 'stop') { if (rb.task === 'running') rb.task = 'stopped'; rb.halt(); }
        else { rb.fault = null; rb.task = 'idle'; }
        break;
      case 'light': lights.set(cmd.id, { on: args.on, ...(args.channel !== undefined ? { channel: args.channel } : {}), ...(args.level !== undefined ? { level: args.level } : {}) }); break;
      case 'barcode': schedule(nowUs + exposureUs, { k: 'exposure', id: cmd.id }); break;
      case 'vision': schedule(nowUs + exposureUs, { k: 'exposure', id: cmd.id, ...(args.shot !== undefined ? { shot: args.shot } : {}) }); break;
      case 'wp_spawn':
        if (workpieces.some(w => w.wp === args.wp)) { out.push(error('BAD_ARGS', `工件 ${args.wp} 已存在`, false, cmd.seq)); break; }
        workpieces.push({ wp: args.wp, kind: args.kind, holder: args.at });
        twin.spawnWorkpiece?.(args.wp, args.kind, args.at);
        schedule(Math.max(nowUs, lastUs), { k: 'workpiece', action: 'spawned', wp: args.wp, holder: args.at });
        break;
      case 'wp_remove': {
        const i = workpieces.findIndex(w => w.wp === args.wp);
        if (i < 0) { out.push(error('BAD_ARGS', `工件 ${args.wp} 不存在`, false, cmd.seq)); break; }
        workpieces.splice(i, 1);
        twin.removeWorkpiece?.(args.wp);
        schedule(Math.max(nowUs, lastUs), { k: 'workpiece', action: 'removed', wp: args.wp });
        break;
      }
    }
  }
  const schedule = (timeUs, fields) => scheduled.push({ timeUs, order: order++, fields });

  // ---------------------------------------------------------------- fault
  function applyFault(f, active, nowUs) {
    const m = f.msg, id = m.id, p = m.params || {};
    switch (m.kind) {
      case 'sensorStuck': {
        const io = index.kindOf(id) === 'sensor' ? index.get(id).io : id;
        if (active && typeof p.value === 'boolean') stuckIo.set(io, p.value); else stuckIo.delete(io);
        break;
      }
      case 'actuatorStuck': {
        const a = actuators.get(id); a.update(nowUs);
        a.stuck = !active ? null : isNum(p.pos) ? p.pos : p.at === a.md.states[0] ? 0 : p.at === a.md.states[1] ? 1 : 0.5;
        break;
      }
      case 'followingError': {
        const ax = axes.get(id); ax.update(nowUs, homeUs);
        if (active) {
          const limit = ax.md.followingErrorLimit;
          if (!isNum(limit) || Math.abs(p.error) > limit) { ax.fault = 'FOLLOWING_ERROR'; ax.halt(); } else ax.following = p.error;
        } else { ax.following = 0; if (ax.fault === 'FOLLOWING_ERROR') ax.fault = null; }
        break;
      }
      case 'axisFault': {
        const ax = axes.get(id); ax.update(nowUs, homeUs);
        if (active) { ax.fault = p.code ?? 'AXIS_FAULT'; ax.halt(); } else ax.fault = null;
        break;
      }
      case 'robotFault': {
        const rb = robots.get(id); rb.update(nowUs);
        if (active) { rb.fault = p.code ?? 'ROBOT_FAULT'; rb.task = 'error'; rb.halt(); } else rb.fault = null;
        break;
      }
      case 'commLoss': if (active) frozen.add(id); else frozen.delete(id); break;
    }
  }

  function validateFault(m) {
    const kind = index.kindOf(m.id);
    if (!kind) return ['UNKNOWN_ID', `故障目標 ${m.id} 不在 MD 裡`];
    if (!(FAULT_KINDS[m.kind] || []).includes(kind)) return ['UNSUPPORTED_OP', `${m.kind} 不能注入到 ${m.id}`];
    if (unbound.has(m.id)) return ['UNSUPPORTED_OP', `${m.id} 沒有場景綁定（unbound）`];
    if (m.kind === 'commLoss' && index.isPlcDevice(m.id)) return ['UNSUPPORTED_OP', `${m.id} 是 PLC 設備：PLC 端故障由 Hub 的虛擬 PLC 注入`];
    if (kind === 'axis' && !axes.has(m.id) || kind === 'actuator' && !actuators.has(m.id) || kind === 'robot' && !robots.has(m.id)) return ['UNSUPPORTED_OP', `${m.id} 沒有場景綁定`];
    if (kind === 'io' && index.get(m.id).dir !== 'DI' && index.get(m.id).dir !== 'AI') return ['UNSUPPORTED_OP', `${m.id} 不是輸入點`];
    const p = m.params || {};
    if (m.kind === 'sensorStuck' && typeof p.value !== 'boolean' && !isNum(p.value)) return ['BAD_ARGS', 'sensorStuck 需要 params.value'];
    if (m.kind === 'followingError' && !isNum(p.error)) return ['BAD_ARGS', 'followingError 需要 params.error'];
    if (m.kind === 'actuatorStuck' && !isNum(p.pos) && typeof p.at !== 'string') return ['BAD_ARGS', 'actuatorStuck 需要 params.at 或 params.pos'];
    if (faults.some(f => f.msg.fid === m.fid)) return ['BAD_ARGS', `故障 ${m.fid} 已存在`];
    return null;
  }

  // 套用一則 cmd／fault（鎖步：tick 開始時；即時：收到時）；被拒的放進 out（non-fatal error），解除事件放進 events
  function apply(m, nowUs, out, events, n, time) {
    if (m.t === 'fault') {
      if (m.action === 'clear') {
        const i = faults.findIndex(f => f.msg.fid === m.fid);
        if (i < 0) { out.push(error('UNKNOWN_ID', `沒有故障 ${m.fid}`, false, m.seq)); return; }
        const f = faults[i]; faults.splice(i, 1);
        if (f.active) { applyFault(f, false, nowUs); events.push(event('fault', n, time, { fid: f.msg.fid, status: 'cleared', id: f.msg.id })); }
        return;
      }
      const bad = validateFault(m);
      if (bad) { out.push(error(bad[0], bad[1], false, m.seq)); return; }
      faults.push({ msg: m, active: false, fromUs: isNum(m.from) ? Math.round(m.from * 1e6) : -Infinity, untilUs: isNum(m.until) ? Math.round(m.until * 1e6) : null });
      return;
    }
    const bad = validateCmd(m);
    if (bad) { out.push(error(bad[0], bad[1], false, m.seq)); return; }
    execute(m, nowUs, out);
  }

  // ---------------------------------------------------------------- 推進 (t0, t1]
  function advance(t0, t1, n, out, events) {
    const time = t1 / 1e6;
    for (const f of [...faults]) {
      if (!f.active && f.fromUs <= t0) { f.active = true; applyFault(f, true, t0); events.push(event('fault', n, time, { fid: f.msg.fid, status: 'active', id: f.msg.id })); }
      else if (f.active && f.untilUs !== null && f.untilUs <= t0) {
        f.active = false; applyFault(f, false, t0); faults.splice(faults.indexOf(f), 1);
        events.push(event('fault', n, time, { fid: f.msg.fid, status: 'cleared', id: f.msg.id }));
      }
    }
    for (const ax of axes.values()) if (!isFrozen(ax.md.device)) ax.update(t1, homeUs);
    for (const a of actuators.values()) a.update(t1);
    for (const rb of robots.values()) if (!isFrozen(rb.md.device)) rb.update(t1);
    // 到期的排程事件（tick 開始時套用的指令所引起的事件，時間記為本 tick 的 t1：事件落在 (t0, t1]）
    const due = scheduled.filter(s => s.timeUs <= t1).sort((a, b) => a.timeUs - b.timeUs || a.order - b.order);
    if (due.length) scheduled = scheduled.filter(s => s.timeUs > t1);
    for (const s of due) if (s.fields.k === 'exposure') exposures.set(s.fields.id, s.timeUs <= t0 && t1 > t0 ? t1 : s.timeUs);
    for (const s of due) events.push(event(s.fields.k, n, (s.timeUs <= t0 && t1 > t0 ? t1 : s.timeUs) / 1e6, Object.fromEntries(Object.entries(s.fields).filter(([k]) => k !== 'k'))));
    // 工件持有權轉移（站的 transfers 規則；S6）
    const ctx = { state: id => actuators.get(id)?.stateName ?? null, pos: id => axes.get(id)?.state().pos ?? null, di: id => reportedDi.get(id) ?? null };
    for (const m of applyTransfers(workpieces, twin.transfers, ctx)) {
      twin.moveWorkpiece?.(m.wp, m.holder);
      events.push(event('workpiece', n, time, { action: 'transferred', wp: m.wp, holder: m.holder }));
    }
    // 即時干涉（站的 collide；S5）：以虛擬時間格點降頻（collisionEvery 秒），一對開始干涉時送一次，分開後再干涉才再送
    if (twin.collide && Math.floor(t1 / collideUs) !== Math.floor(lastCollideUs / collideUs)) {
      lastCollideUs = t1;
      if (twin.apply) { twin.apply(buildView(bound, values())); lastGeometry = null; }
      const now = new Set();
      for (const c of twin.collide()) {
        const key = c.a + '\n' + c.b;
        now.add(key);
        if (!activePairs.has(key)) events.push(event('collision', n, time, { a: c.a, b: c.b, depth: c.depth }));
      }
      activePairs = now;
    }
    lastUs = t1;
    const di = computeDi();
    const diff = (models, rep, fn, skip) => {
      const changed = [];
      for (const [id, m] of sortedEntries(models)) {
        if (skip?.(m)) continue;
        const s = fn(m), j = JSON.stringify(s);
        if (rep.get(id) !== j) { rep.set(id, j); changed.push([id, s]); }
      }
      return changed;
    };
    const ax = diff(axes, reported.axes, a => a.state(), a => isFrozen(a.md.device));
    const ac = diff(actuators, reported.actuators, a => a.state());
    const rb = diff(robots, reported.robots, r => r.state(railOf(r)), r => isFrozen(r.md.device));
    if (ax.length + ac.length + rb.length + di.size > 0 || realtime) {
      const s = { t: 'state' };
      if (n !== undefined) { s.n = n; s.tUs = t1; }
      s.time = time;
      if (ax.length) s.axes = Object.fromEntries(ax);
      if (di.size) s.di = Object.fromEntries(sortedEntries(di));
      if (ac.length) s.actuators = Object.fromEntries(ac);
      if (rb.length) s.robots = Object.fromEntries(rb);
      out.push(s);
    }
    out.push(...events);
  }

  function tick(msg) {
    if (msg.n !== lastTick + 1 || !Number.isInteger(msg.tUs) || msg.tUs <= lastUs || !isNum(msg.dt) || msg.tUs !== lastUs + Math.round(msg.dt * 1e6))
      return [error('OUT_OF_ORDER', `tick ${msg.n}（tUs ${msg.tUs}）不接在 tick ${lastTick}（tUs ${lastUs}）之後`, true)];
    const out = [], events = [], t0 = lastUs, n = msg.n, time = msg.tUs / 1e6;
    for (const m of pending) apply(m, t0, out, events, n, time);
    pending = [];
    lastTick = n;
    advance(t0, msg.tUs, n, out, events);
    if (options.noAckAt !== n) out.push({ t: 'tickAck', n });   // --test-hook no-ack-at:<n>（TWIN-AC-05 的驗法）
    return out;
  }

  // ---------------------------------------------------------------- 訊息分派
  function handle(msg) {
    if (closed) return [];
    if (!helloDone) {
      if (msg.t === 'hello') return hello(msg);
      if (msg.t === 'bye' || msg.t === 'error') { if (msg.t === 'bye' || msg.fatal) closed = true; return []; }
      return [error('NOT_READY', `握手完成前收到 ${msg.t}`, true)];
    }
    switch (msg.t) {
      case 'tick':
        if (realtime) return [error('UNEXPECTED', '即時模式不使用 tick', false)];
        return tick(msg);
      case 'cmd':
      case 'fault':
        if (realtime) { const out = [], events = []; apply(msg, lastUs, out, events, undefined, lastUs / 1e6); return [...out, ...events]; }
        pending.push(msg);
        return [];
      case 'snapshot':
        if (msg.request !== true) return [error('BAD_MESSAGE', 'Hub 只能送 snapshot 要求（request: true）', false, msg.seq)];
        return [snapshot()];
      case 'bye': closed = true; return [{ t: 'bye', reason: 'done' }];
      case 'error': if (msg.fatal) closed = true; return [];
      case 'hello': return [error('BAD_MESSAGE', '握手已完成', true)];
      case 'state': case 'event': case 'tickAck':
        return [error('BAD_MESSAGE', `${msg.t} 只能由 SPE 送出`, false)];
      default:
        return tolerant ? [] : [error('UNKNOWN_TYPE', `不認得的訊息種類 ${msg.t}`, false)];
    }
  }

  // 一行文字（已分框）→ 解析、驗證（握手前一律驗證；之後只在 options.validate 時驗證）→ handle
  function receive(line) {
    if (closed) return [];
    const r = parseMessage(line);
    if (r.error) return [error(r.error.code, r.error.msg, true)];
    const msg = r.msg;
    if (schema?.validateTwinMessage && (!helloDone || options.validate)) {
      const v = schema.validateTwinMessage(msg, { tolerant });
      if (v.ignored) return [];
      if (!v.valid) {
        const detail = v.errors?.[0] ? `${v.errors[0].path} ${v.errors[0].message}` : '';
        if (!helloDone) return [error(v.code === 'PROTO_MAJOR_MISMATCH' ? 'PROTO_MAJOR_MISMATCH' : v.code === 'BAD_JSON' ? 'BAD_JSON' : 'BAD_MESSAGE', `握手階段的訊息不合 schema：${detail}`, true)];
        return [error(v.code === 'UNKNOWN_TYPE' ? 'UNKNOWN_TYPE' : 'BAD_MESSAGE', `訊息不合 schema，已丟棄：${detail}`, false, Number.isInteger(msg.seq) && msg.seq > 0 ? msg.seq : undefined)];
      }
    } else if (typeof msg.t !== 'string') return [error('BAD_MESSAGE', '缺少字串欄位 t', !helloDone)];
    return handle(msg);
  }

  // 即時模式：推進到 nowUs（工作階段開始起算的掛鐘 µs）並回傳該時刻的 state（沒有變化也送，兼作心跳）與事件
  function pollRealtime(nowUs) {
    if (!helloDone || !realtime || closed) return [];
    const out = [];
    advance(lastUs, Math.max(nowUs, lastUs), undefined, out, []);
    return out;
  }

  return {
    handle, receive, pollRealtime, view,
    get closed() { return closed; },
    get ready() { return helloDone; },
    get realtime() { return realtime; },
    get peerMaxLine() { return peerMaxLine; },
    get stateRate() { return stateRate; },
    get tick() { return lastTick; },
    get timeUs() { return lastUs; },
  };
}
