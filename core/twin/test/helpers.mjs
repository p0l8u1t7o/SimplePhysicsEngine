// core/twin 測試共用：合成 MD（fixture.md.json，涵蓋各種實體）、不依賴 three.js 的假站、Hub 端訊息產生器。
import { readFileSync } from 'node:fs';
import { prepareTwin, createTwinSession } from '../session.js';
import { loadSchemaIfPresent } from '../../tools/twin-schema.mjs';

export const FIXTURE_TEXT = readFileSync(new URL('./fixture.md.json', import.meta.url), 'utf8');
export const fixture = () => JSON.parse(FIXTURE_TEXT);
// validate.py hash 的結果（Automation-Schema 在時另以 mdHashOfText 核對）
export const FIXTURE_HASH = 'sha256:fd0cdfcad74ccc0acf508e260a649f859be6417976def10d051e50c50764f98f';

// Automation-Schema 在相鄰 checkout 時載入（不檢查 lock）；不在時為 null，需要它的測試略過（Q-22 = A）
export const AS = await loadSchemaIfPresent().catch(() => null);
export const schema = AS?.schema ?? null;
export const needSchema = schema ? {} : { skip: '找不到 Automation-Schema（相鄰 checkout）' };

// 假站：x 在 500 ± 5 mm 時 photoEye（sen-PART）ON
export function fakeTwin(extra = {}) {
  const applied = [];
  let last = null;
  return {
    station: 'TwinFixture',
    keys: ['x', 'rot', 'q.rail', 'cyl', 'grip', 'q'],
    setters: ['cell/lamp'],
    objects: { 'cell/x': {}, 'cell/r': {}, robot: {}, 'cell/cyl': {}, 'cell/grip': {}, 'cell/lamp': {}, 'cell/cam': {} },
    initialView: () => ({ keys: { x: 0, rot: 0, 'q.rail': 0, cyl: 0, grip: 0, q: [0, 0] }, paths: { 'cell/lamp': 0 } }),
    geometryKeys: ['x'],
    apply(v) { last = v; applied.push(v); },
    sense: sensor => sensor.id === 'sen-PART' && !!last && Math.abs(last.keys.x - 500) <= 5,
    config: { taskDuration: { PICK: 0.5 } },
    applied,
    ...extra,
  };
}

export function newSession({ md = fixture(), twin = fakeTwin(), options = {}, withSchema = false, mdHash = FIXTURE_HASH } = {}) {
  const prepared = prepareTwin({ md, twin });
  return createTwinSession({ prepared, mdHash, schema: withSchema ? schema : null, options });
}

export const hubHello = (over = {}) => ({ t: 'hello', proto: 'zqs.twin/2.0', role: 'hub', mdHash: FIXTURE_HASH, machine: 'mc-TwinFixture', mode: 'lockstep', dt: 0.001, ...over });

// 鎖步驅動：連續送 tick，回傳每個 tick 的輸出
export function driver(session) {
  let n = 0, tUs = 0, seq = 0;
  const api = {
    hello: (over) => session.handle(hubHello(over)),
    tick(dtUs = 1000) { n += 1; tUs += dtUs; return session.handle({ t: 'tick', n, tUs, time: tUs / 1e6, dt: dtUs / 1e6 }); },
    // 推進 seconds 秒（每 tick dtUs），回傳所有輸出
    run(seconds, dtUs = 10000) { const out = []; const end = tUs + Math.round(seconds * 1e6); while (tUs < end) out.push(...api.tick(Math.min(dtUs, end - tUs))); return out; },
    cmd(id, op, args = {}) { seq += 1; return session.handle({ t: 'cmd', seq, id, op, args }); },
    fault(msg) { seq += 1; return session.handle({ t: 'fault', seq, ...msg }); },
    snapshot() { seq += 1; return session.handle({ t: 'snapshot', request: true, seq }); },
    get seq() { return seq; }, get n() { return n; }, get tUs() { return tUs; },
  };
  return api;
}

// 輸出裡最後一則 snapshot／取某種訊息
export const ofType = (out, t) => out.filter(m => m.t === t);
export const lastSnapshot = s => ofType(s.handle({ t: 'snapshot', request: true }), 'snapshot')[0];
