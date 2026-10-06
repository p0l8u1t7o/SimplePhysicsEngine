// 剛體動力學（評估平台 Q8，core 1.13.0；2026-10-06 拍板：Rapier 決定性版，預先模擬、烘焙成軌跡，apply(t) 只取樣）。
// 用途：輸送物料流、掉落／滑槽／投料、料箱堆積與隨機取料、夾取穩定與加減速。現有站不強制改用。
//
//   const baked = await bake(spec)          固定步長模擬整段時間，記下每個物體的軌跡（決定性：同一份 spec 在瀏覽器與 Node 逐位元相同）
//   const at = sampler(baked); at(t)       任一時間的位置與姿態（線性內插＋四元數 nlerp），可以倒著拖
//   const view = createPhysicsView(baked)  three.js 網格：view.root 加進場景，view.apply(t) 更新（物體出生前、消失後隱藏）
//
// 單位：長度 mm、時間 s、質量 kg、密度 kg/m³、角度度；模擬內部換成公尺。y 軸朝上（和各站相同）。
// spec：
//   { duration, dt = 1/240, hz = 60（軌跡取樣率）, seed = 1, gravity = 9810,
//     statics:    [{ id, shape: 'box'|'cylinder'|'sphere', size: [x, y, z] | { r, h }, pos, rot, friction = 0.6, restitution = 0 }],   固定物（地面、牆、料箱、滑槽）
//     conveyors:  [{ id, size, pos, rot, speed: mm/s, dir = [1, 0, 0]（輸送帶自己的座標）, grip = 25 }],                            皮帶：接觸到的物體往 dir 帶到 speed
//     spawners:   [{ id, at, spread = [0, 0, 0], every, start = 0, count, spin = 180, velocity = [0, 0, 0],
//                    items: [{ shape, size, density = 1000, friction = 0.5, restitution = 0.1, color, weight = 1, name }] }],                依序產生物體（隨機挑 items、位置在 spread 內、轉 spin 度內，亂數由 seed 決定）
//     drops:      [{ id, t, pos, rot, velocity, item: { shape, size, density, friction, restitution, angularDamping, name, color } }],   指定時間、位置、速度投入（站的排程交給物理的工件）
//     sinks:      [{ id, min, max }],                                                                                                    物體中心進入就移除（被取走、掉出畫面）
//     kinematics: [{ id, shape, size, pose: t => ({ pos, rot }), friction = 0.8 }],                                                    照時間移動的治具（推桿、夾爪手指、吸盤）
//     holds:      [{ by: kinematics 的 id, from, to, radius = 60, offset }],                                                       吸附：from 時抓起離載具最近的物體，跟著載具動，to 時放開
//     grippers:   [{ id, pose: t => ({ pos, rot }), finger = [12, 50, 40], open = 40（手指內面到中心）, force = 20 N, closeAt, openAt, friction = 0.6, mass = 0.1 kg }] }   兩指夾爪（力控制，會滑）
import * as THREE from 'three';
import RAPIER from '../vendor/rapier/rapier.mjs';

const S = 0.001;                     // mm → m
let ready = null;
export const loadRapier = () => ready ||= RAPIER.init().then(() => RAPIER);

const rad = d => d * Math.PI / 180;
// 歐拉角（度，XYZ）→ 四元數 { x, y, z, w }
export function quatOf(rot = [0, 0, 0]) {
  const [x, y, z] = rot.map(v => rad(v) / 2), c = [Math.cos(x), Math.cos(y), Math.cos(z)], s = [Math.sin(x), Math.sin(y), Math.sin(z)];
  return { x: s[0] * c[1] * c[2] + c[0] * s[1] * s[2], y: c[0] * s[1] * c[2] - s[0] * c[1] * s[2], z: c[0] * c[1] * s[2] + s[0] * s[1] * c[2], w: c[0] * c[1] * c[2] - s[0] * s[1] * s[2] };
}
const qmul = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
const qinv = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qrot = (q, v) => { const p = qmul(qmul(q, { x: v.x, y: v.y, z: v.z, w: 0 }), qinv(q)); return { x: p.x, y: p.y, z: p.z }; };
// 決定性的亂數（mulberry32）
export function rng(seed = 1) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function colliderDesc(R, shape = 'box', size = [10, 10, 10]) {
  if (shape === 'sphere') return R.ColliderDesc.ball((size.r ?? size[0] / 2) * S);
  if (shape === 'cylinder') return R.ColliderDesc.cylinder((size.h ?? size[1]) / 2 * S, (size.r ?? size[0] / 2) * S);
  return R.ColliderDesc.cuboid(size[0] / 2 * S, size[1] / 2 * S, size[2] / 2 * S);
}
const vec = (p = [0, 0, 0]) => ({ x: p[0] * S, y: p[1] * S, z: p[2] * S });
// 查詢用的形狀（加大 margin mm）：生成前檢查位置有沒有被占住
function shapeOf(R, shape = 'box', size = [10, 10, 10], margin = 0) {
  if (shape === 'sphere') return new R.Ball(((size.r ?? size[0] / 2) + margin) * S);
  if (shape === 'cylinder') return new R.Cylinder(((size.h ?? size[1]) / 2 + margin) * S, ((size.r ?? size[0] / 2) + margin) * S);
  return new R.Cuboid((size[0] / 2 + margin) * S, (size[1] / 2 + margin) * S, (size[2] / 2 + margin) * S);
}

// FNV-1a：烘焙結果的雜湊（決定性比對用）
function fnv(h, bytes) { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; } return h; }
export function hashBaked(b) {
  let h = 2166136261;
  for (const x of [...b.bodies, ...b.kinematics]) { h = fnv(h, new TextEncoder().encode(`${x.id}|${x.born}|${x.died}`)); h = fnv(h, new Uint8Array(x.frames.buffer, x.frames.byteOffset, x.frames.byteLength)); }
  return h.toString(16).padStart(8, '0');
}

export async function bake(spec) {
  const R = await loadRapier(), t0 = Date.now();
  const dt = spec.dt ?? 1 / 240, hz = spec.hz ?? 60, duration = spec.duration ?? 10, steps = Math.round(duration / dt), every = Math.max(1, Math.round(1 / hz / dt));
  const nFrames = Math.floor(steps / every) + 1, random = rng(spec.seed ?? 1);
  const world = new R.World({ x: 0, y: -(spec.gravity ?? 9810) * S, z: 0 });
  world.timestep = dt;
  world.numSolverIterations = spec.iterations ?? 8;      // 求解器迭代（預設 4）：堆疊與落下撞擊時穿透比較小
  // 固定物、輸送帶
  for (const s of spec.statics || []) {
    const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(...Object.values(vec(s.pos))).setRotation(quatOf(s.rot)));
    world.createCollider(colliderDesc(R, s.shape, s.size).setFriction(s.friction ?? 0.6).setRestitution(s.restitution ?? 0), b);
  }
  // 輸送帶：速度型的 kinematic 剛體，速度 = 皮帶速度（摩擦用它的速度帶動物體）；每一步後放回原位，所以皮帶本身不會跑掉
  const belts = (spec.conveyors || []).map(c => {
    const q = quatOf(c.rot), dir = c.dir || [1, 0, 0], d = qrot(q, { x: dir[0], y: dir[1], z: dir[2] }), v = (c.speed ?? 0) * S, home = vec(c.pos);
    const body = world.createRigidBody(R.RigidBodyDesc.kinematicVelocityBased().setTranslation(home.x, home.y, home.z).setRotation(q).setLinvel(d.x * v, d.y * v, d.z * v));
    world.createCollider(colliderDesc(R, 'box', c.size).setFriction(c.friction ?? 0.9), body);
    return { ...c, body, home };
  });
  // 照時間移動的治具（kinematic）
  const grips = [];
  const kin = (spec.kinematics || []).map(k => {
    const p0 = k.pose(0), b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...Object.values(vec(p0.pos))).setRotation(quatOf(p0.rot)));
    world.createCollider(colliderDesc(R, k.shape, k.size).setFriction(k.friction ?? 0.8), b);
    return { ...k, body: b, frames: new Float32Array(nFrames * 7), born: 0, died: Infinity };
  });
  // 夾爪：載具照 pose(t) 移動（kinematic）；兩根手指是動態剛體，用滑軌關節接在載具上，closeAt～openAt 之間用 force（N）往內夾，
  // 其餘時間往外張。工件靠摩擦力被夾住，所以夾持力不夠、加速度太大時會滑（夾取穩定分析）。手指的軌跡和治具一起輸出（id：<夾爪>-左／-右）
  for (const g of spec.grippers || []) {
    const fs = g.finger || [12, 50, 40], open = g.open ?? 40, p0 = g.pose(0), q0 = quatOf(p0.rot);
    const carrier = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...Object.values(vec(p0.pos))).setRotation(q0));
    const vol = fs[0] * fs[1] * fs[2] * 1e-9, fingers = [-1, 1].map(s => {
      const off = qrot(q0, { x: s * (open + fs[0] / 2) * S, y: 0, z: 0 }), c = vec(p0.pos);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(c.x + off.x, c.y + off.y, c.z + off.z).setRotation(q0).setCcdEnabled(true));
      world.createCollider(colliderDesc(R, 'box', fs).setDensity((g.mass ?? 0.1) / vol).setFriction(g.friction ?? 0.6), body);
      const jd = R.JointData.prismatic({ x: s * (open + fs[0] / 2) * S, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      jd.limitsEnabled = true; jd.limits = s > 0 ? [-open * S, 0] : [0, open * S];
      world.createImpulseJoint(jd, carrier, body, true);
      return { s, body, frames: new Float32Array(nFrames * 7), id: `${g.id}-${s < 0 ? '左' : '右'}`, shape: 'box', size: fs, born: 0, died: Infinity };
    });
    const c = { id: g.id, body: carrier, frames: new Float32Array(nFrames * 7), born: 0, died: Infinity, pose: g.pose };
    grips.push({ g, carrier: c, fingers });
    kin.push(c, ...fingers);
  }
  const kinById = new Map(kin.map(k => [k.id, k]));
  // 空間查詢（生成前檢查位置）用的結構在 step 時才建：先走極短的一步，讓第一個物體生成前就看得到固定物
  world.timestep = 1e-6; world.step(); world.timestep = dt;
  for (const bt of belts) bt.body.setTranslation(bt.home, true);
  // 產生物體：事先排好時間表
  const queue = [];
  for (const sp of spec.spawners || []) for (let n = 0; n < (sp.count ?? 1); n++) queue.push({ sp, n, t: (sp.start ?? 0) + n * (sp.every ?? 1) });
  queue.sort((a, b) => a.t - b.t || a.sp.id.localeCompare(b.sp.id) || a.n - b.n);
  // 指定的投入（drops）：時間、位置、角度、速度、種類都由站的排程決定（例如分流帶尾端的工件交給物理），到時間一定生成、不等位置
  const drops = [...(spec.drops || [])].sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
  let di = 0;
  const bodies = [], live = [];
  const pick = items => { const tot = items.reduce((a, x) => a + (x.weight ?? 1), 0); let r = random() * tot; for (const x of items) { r -= x.weight ?? 1; if (r <= 0) return x; } return items[items.length - 1]; };
  let qi = 0, maxPen = 0, peakPen = 0;
  const holds = (spec.holds || []).map(h => ({ ...h, radius: h.radius ?? 60, state: 'wait', target: null, rel: null }));

  const record = f => {
    for (const x of live) { const t = x.body.translation(), q = x.body.rotation(); x.frames.set([t.x / S, t.y / S, t.z / S, q.x, q.y, q.z, q.w], f * 7); }
    for (const k of kin) { const t = k.body.translation(), q = k.body.rotation(); k.frames.set([t.x / S, t.y / S, t.z / S, q.x, q.y, q.z, q.w], f * 7); }
  };
  for (let s = 0; s <= steps; s++) {
    const t = s * dt;
    // 指定的投入：到時間就生成（同一步可以好幾個，位置由站負責不重疊）
    while (di < drops.length && drops[di].t <= t + 1e-9) {
      const d = drops[di++], it = d.item || {};
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...Object.values(vec(d.pos))).setRotation(quatOf(d.rot)).setLinvel(...Object.values(vec(d.velocity)))
        .setAngularDamping(it.angularDamping ?? 0.5).setCcdEnabled(true));
      world.createCollider(colliderDesc(R, it.shape, it.size).setDensity(it.density ?? 1000).setFriction(it.friction ?? 0.5).setRestitution(it.restitution ?? 0.1), body);
      const x = { id: String(d.id), spawner: 'drops', item: it.name || it.shape || 'box', shape: it.shape || 'box', size: it.size, color: it.color, body, born: Math.ceil(s / every) / hz, died: Infinity, frames: new Float32Array(nFrames * 7) };
      bodies.push(x); live.push(x);
    }
    // 到時間的物體出生
    while (qi < queue.length && queue[qi].t <= t + 1e-9) {
      const e = queue[qi], { sp, n } = e;
      // 第一次輪到時才抽種類、位置、角度（只抽一次，之後重試用同一組，亂數順序固定）
      if (!e.it) { const sprd = sp.spread || [0, 0, 0], spin = sp.spin ?? 180; e.it = pick(sp.items); e.pos = (sp.at || [0, 0, 0]).map((v, k) => v + (random() - 0.5) * sprd[k]); e.rot = [0, 1, 2].map(() => (random() - 0.5) * spin); }
      // 生成的位置被占住：被別的物體占住就等下一步再試（後面的也跟著等，保持順序）；只碰到固定物（例如轉了角度碰到皮帶）就往上抬 5 mm 再試
      let busy = false;
      for (let lift = 0; lift < 60; lift++) {
        let hitDyn = false, hitFix = false;
        world.intersectionsWithShape(vec(e.pos), quatOf(e.rot), shapeOf(R, e.it.shape, e.it.size, 2), c => { if (c.parent()?.isDynamic()) hitDyn = true; else hitFix = true; return !hitDyn; });
        if (hitDyn) { busy = true; break; }
        if (!hitFix) break;
        e.pos[1] += 5;
      }
      if (busy) break;
      qi++;
      const { it, pos, rot } = e;
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...Object.values(vec(pos))).setRotation(quatOf(rot)).setLinvel(...Object.values(vec(sp.velocity))).setAngularDamping(it.angularDamping ?? 0.5).setCcdEnabled(true));      // 角阻尼：模擬滾動阻力，圓柱不會一直滾
      world.createCollider(colliderDesc(R, it.shape, it.size).setDensity(it.density ?? 1000).setFriction(it.friction ?? 0.5).setRestitution(it.restitution ?? 0.1), body);
      const x = { id: `${sp.id}-${n + 1}`, spawner: sp.id, item: it.name || it.shape || 'box', shape: it.shape || 'box', size: it.size, color: it.color, body, born: Math.ceil(s / every) / hz, died: Infinity, frames: new Float32Array(nFrames * 7) };
      bodies.push(x); live.push(x);
      break;      // 一步最多生成一個：同一步生成的物體還不在空間查詢裡，連續生成會疊在一起
    }
    // 夾爪的手指：夾持中往內推 force，其他時間往外張（力的方向沿載具的 x 軸）
    for (const { g, carrier, fingers } of grips) {
      const closing = t >= (g.closeAt ?? 0) && t < (g.openAt ?? Infinity), q = carrier.body.rotation(), ax = qrot(q, { x: 1, y: 0, z: 0 }), F = g.force ?? 20;
      // 平行夾爪的兩指是同步的（齒條）：兩指中點相對載具的偏移用很硬的彈簧＋阻尼拉回中心，夾住的工件不會整組沿滑軌飄
      const cp = carrier.body.translation(), a = g.pose(t), b = g.pose(t + dt), cv = [0, 1, 2].map(k => (b.pos[k] - a.pos[k]) / dt * S);
      const off = f => { const p = f.body.translation(); return (p.x - cp.x) * ax.x + (p.y - cp.y) * ax.y + (p.z - cp.z) * ax.z; };
      const vel = f => { const v = f.body.linvel(); return (v.x - cv[0]) * ax.x + (v.y - cv[1]) * ax.y + (v.z - cv[2]) * ax.z; };
      const mid = (off(fingers[0]) + off(fingers[1])) / 2, vmid = (vel(fingers[0]) + vel(fingers[1])) / 2, center = -(2000 * mid + 20 * vmid) / 2;      // k、c 要配合 0.1 kg 的手指與 1/240 s 的步長（太硬會發散）
      for (const f of fingers) { const k = (closing ? -1 : 1) * f.s * F + center; f.body.resetForces(true); f.body.addForce({ x: ax.x * k, y: ax.y * k, z: ax.z * k }, true); }
    }
    // 治具：設定下一步的姿態
    for (const k of kin) { if (!k.pose) continue; const p = k.pose(t + dt); k.body.setNextKinematicTranslation(vec(p.pos)); k.body.setNextKinematicRotation(quatOf(p.rot)); }
    // 吸附：from 時抓最近的物體（改成 kinematic 跟著載具），to 時放開並給載具的速度
    for (const h of holds) {
      const k = kinById.get(h.by); if (!k) continue;
      if (h.state === 'wait' && t >= h.from) {
        const c = k.body.translation(); let best = null, bd = h.radius * S;
        for (const x of live) { const p = x.body.translation(), d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z); if (d < bd) { bd = d; best = x; } }
        h.state = 'held'; h.target = best;
        if (best) { const kq = k.body.rotation(), p = best.body.translation(), q = best.body.rotation(); h.rel = { p: qrot(qinv(kq), { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z }), q: qmul(qinv(kq), q) }; best.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true); best.held = h.by; }
      }
      if (h.state === 'held' && h.target) {
        const p = k.pose(t + dt), kq = quatOf(p.rot), off = qrot(kq, h.rel.p);
        h.target.body.setNextKinematicTranslation({ x: p.pos[0] * S + off.x, y: p.pos[1] * S + off.y, z: p.pos[2] * S + off.z });
        h.target.body.setNextKinematicRotation(qmul(kq, h.rel.q));
        if (t + dt >= h.to) {
          const a = k.pose(t), b = k.pose(t + dt);
          h.target.body.setBodyType(R.RigidBodyType.Dynamic, true);
          h.target.body.setLinvel({ x: (b.pos[0] - a.pos[0]) / dt * S, y: (b.pos[1] - a.pos[1]) / dt * S, z: (b.pos[2] - a.pos[2]) / dt * S }, true);
          h.target.held = null; h.state = 'done';
        }
      }
    }
    // 記錄這一刻（第 f 格 = 時間 f / hz 的狀態，在這一步模擬之前）
    if (s % every === 0) record(s / every);
    if (s === steps) break;
    world.step();
    // 輸送帶：皮帶這一步以皮帶速度移動（摩擦帶動上面的物體），步後放回原位
    for (const bt of belts) bt.body.setTranslation(bt.home, true);
    // 穿透深度（每 4 步取樣一次）：靜止接觸（兩邊都比 50 mm/s 慢，畫面上看得到）與瞬間撞擊（只當資訊）分開記
    if (s % 4 === 0) for (const x of live) {
      const c = x.body.collider(0), slow = b => { if (!b || !b.isDynamic()) return true; const v = b.linvel(); return Math.hypot(v.x, v.y, v.z) < 0.05; };
      world.contactPairsWith(c, o => world.contactPair(c, o, m => {
        for (let i = 0; i < m.numContacts(); i++) { const p = -m.contactDist(i); if (p > peakPen) peakPen = p; if (p > maxPen && slow(x.body) && slow(o.parent())) maxPen = p; }
      }));
    }
    // 進入 sink 的物體移除
    for (const sk of spec.sinks || []) for (let i = live.length - 1; i >= 0; i--) {
      const x = live[i]; if (x.held) continue;
      const p = x.body.translation(), P = [p.x / S, p.y / S, p.z / S];
      if (P.every((v, k) => v >= sk.min[k] && v <= sk.max[k])) { x.died = (Math.floor(s / every) + 1) / hz; x.sink = sk.id; world.removeRigidBody(x.body); live.splice(i, 1); }
    }
  }
  world.free();
  for (const x of [...bodies, ...kin]) { delete x.body; }
  const out = { spec, dt, hz, duration, frames: nFrames, bodies: bodies.map(({ held, ...x }) => x), kinematics: kin.map(({ pose, body, s, ...k }) => k),
    stats: { steps, bodies: bodies.length, maxPenetration: +(maxPen / S).toFixed(3), peakPenetration: +(peakPen / S).toFixed(3), ms: Date.now() - t0 } };
  out.stats.hash = hashBaked(out);
  return out;
}

// 取樣：t 時的 [{ id, visible, pos: [x, y, z], quat: [x, y, z, w] }]
export function sampler(b) {
  return t => {
    const f = Math.max(0, Math.min(b.frames - 1, t * b.hz)), i = Math.floor(f), j = Math.min(b.frames - 1, i + 1), u = f - i;
    return [...b.bodies, ...b.kinematics].map(x => {
      const visible = t >= x.born - 1e-9 && t < x.died - 1e-9;
      const lo = Math.max(i, Math.round(x.born * b.hz)), hi = Math.min(j, Math.max(lo, x.died === Infinity ? b.frames - 1 : Math.round(x.died * b.hz) - 1));
      const A = x.frames.subarray(Math.min(lo, hi) * 7, Math.min(lo, hi) * 7 + 7), B = x.frames.subarray(hi * 7, hi * 7 + 7), w = lo === hi ? 0 : u;
      const dot = A[3] * B[3] + A[4] * B[4] + A[5] * B[5] + A[6] * B[6], sg = dot < 0 ? -1 : 1;
      const q = [0, 1, 2, 3].map(k => A[3 + k] * (1 - w) + sg * B[3 + k] * w), l = Math.hypot(...q) || 1;
      return { id: x.id, visible, pos: [0, 1, 2].map(k => A[k] * (1 - w) + B[k] * w), quat: q.map(v => v / l), item: x.item };
    });
  };
}

// three.js 的顯示：每個物體一個網格（名稱 physics:<id>，userData.physics = true）；顏色用 items 的 color，沒寫就依種類給
const PALETTE = [0x4f8fd8, 0xe8a33d, 0x6cbf6a, 0xd85c5c, 0x9a7bd8, 0x45b5b0, 0xc9c26a];
export function createPhysicsView(b, { colors = {} } = {}) {
  const root = new THREE.Group(); root.name = 'physics'; root.userData.physics = true;
  const kinds = [...new Set(b.bodies.map(x => x.item))], mats = new Map();
  const mat = (key, color) => { if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .1 })); return mats.get(key); };
  const geo = (shape, size) => shape === 'sphere' ? new THREE.SphereGeometry(size.r ?? size[0] / 2, 20, 14) : shape === 'cylinder' ? new THREE.CylinderGeometry(size.r ?? size[0] / 2, size.r ?? size[0] / 2, size.h ?? size[1], 24) : new THREE.BoxGeometry(...size);
  const meshes = new Map();
  for (const x of b.bodies) {
    const m = new THREE.Mesh(geo(x.shape, x.size), mat(x.item, x.color ?? colors[x.item] ?? PALETTE[kinds.indexOf(x.item) % PALETTE.length]));
    m.name = `physics:${x.id}`; m.userData.physics = true; m.castShadow = true; m.visible = false; root.add(m); meshes.set(x.id, m);
  }
  const at = sampler(b);
  return {
    root, meshes,
    apply(t) {
      for (const s of at(t)) { const m = meshes.get(s.id); if (!m) continue; m.visible = s.visible; if (s.visible) { m.position.set(...s.pos); m.quaternion.set(...s.quat); } }
    },
    dispose() { for (const m of meshes.values()) m.geometry.dispose(); for (const m of mats.values()) m.dispose(); },
  };
}
