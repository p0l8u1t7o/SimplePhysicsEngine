// 機台描述檔（MD，zqs.machine-description/2.x）的唯讀索引：依 ID 查實體種類、所屬設備、感測器與 IO 的對應、致動器的動作與穩態。
// 只做孿生需要的查詢，不驗證 schema（握手前由 Automation-Schema 的 validateMachineDescription 驗證，見 core/tools/twin-schema.mjs）。

// 致動器 actions／states 省略時依 type 的預設（machine-description README §7）；actions[0] → 行程比例 1，actions[1] → 0
export const ACTUATOR_DEFAULTS = {
  airCylinder: { actions: ['extend', 'retract'], states: ['retracted', 'extended'] },
  gripper: { actions: ['close', 'open'], states: ['opened', 'closed'] },
  vacuum: { actions: ['on', 'off'], states: ['released', 'held'] },
  stopper: { actions: ['lower', 'raise'], states: ['raised', 'lowered'] },
  indicator: { actions: ['on'], states: ['off', 'on'] },
  buzzer: { actions: ['on'], states: ['off', 'on'] },
};

const KINDS = [['devices', 'device'], ['axes', 'axis'], ['io', 'io'], ['actuators', 'actuator'], ['sensors', 'sensor'], ['robots', 'robot']];

export function indexMd(md) {
  if (!md || typeof md !== 'object' || !md.machine) throw new Error('MD 缺少 machine');
  const major = /^zqs\.machine-description\/(\d+)\.\d+$/.exec(md.schema || '')?.[1];
  if (major !== '2') throw new Error(`MD 的 schema 必須是 zqs.machine-description/2.x，實際為 ${JSON.stringify(md.schema)}`);
  const byId = new Map(), kind = new Map();
  for (const [key, k] of KINDS) for (const e of md[key] || []) { byId.set(e.id, e); kind.set(e.id, k); }
  const list = key => md[key] || [];
  const actuators = list('actuators').map(a => {
    const d = ACTUATOR_DEFAULTS[a.type];
    const actions = a.actions || d?.actions, states = a.states || d?.states;
    if (!actions || !states || states.length !== 2) throw new Error(`致動器 ${a.id} 需要明寫 actions 與兩個 states`);
    return { ...a, actions, states };
  });
  const actuatorById = new Map(actuators.map(a => [a.id, a]));
  const sensorByIo = new Map(list('sensors').map(s => [s.io, s]));
  return {
    md, machine: md.machine,
    devices: list('devices'), axes: list('axes'), io: list('io'), actuators, sensors: list('sensors'), robots: list('robots'),
    actuator: id => actuatorById.get(id),
    get: id => byId.get(id),
    kindOf: id => kind.get(id) ?? null,
    sensorByIo: io => sensorByIo.get(io),
    // 實體所屬的設備（設備本身回傳自己）；commLoss 以設備為單位凍結
    deviceOf(id) { const k = kind.get(id); if (!k) return null; if (k === 'device') return id; return byId.get(id).device ?? null; },
    isPlcDevice: id => byId.get(id)?.category === 'Plc',
    hasCapability: (id, cap) => (byId.get(id)?.capabilities || []).includes(cap),
  };
}

// 致動器的動作 → 行程比例目標（actions[0] = 1、actions[1] = 0；不是它的動作回傳 null）
export function targetOf(actuator, action) {
  const i = actuator.actions.indexOf(action);
  return i < 0 ? null : i === 0 ? 1 : 0;
}

// 動作的全行程時間（s）；MD 沒寫時為 0（立即到位，例如指示燈）
export function travelTimeOf(actuator, action) {
  const t = actuator.travelTime?.[action];
  return typeof t === 'number' ? t : 0;
}
