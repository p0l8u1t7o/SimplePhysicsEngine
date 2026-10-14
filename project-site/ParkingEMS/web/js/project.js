// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 停車場光儲充能源服務：三種標準場型（?site=flagship｜mixed｜urban），各自一條時間軸：
// 現況 → 建置（吊車吊裝、分區施工）→ 系統聯測 → 全天 EMS 調度（24 h 壓成 36 s）→ 客戶停車充電；都會型另有模組擴充。
// 配置在 sites.js、調度模型在 energy.js、排程在 sequence.js、場地在 lot.js、設備與車輛在 models.js。
import * as THREE from 'three';
import { tube, flowTexture } from '@core/geom/shapes.js';
import { siteOf, chargerPose, STALL, CAR, SITES } from './sites.js';
import { simulate, PERIOD_NAME, SESSIONS } from './energy.js';
import { createSequence, hourAt, segmentAt, timeOfHour, DRIVE, STATIONS } from './sequence.js';
import { createLot, gateGeom } from './lot.js';
import { M, CAR_COLORS, createCar, createParkedFleet, createACCharger, createDCCharger, createBESS, createCabinet, createTransformer, createInverter, createFence, createCrane, createCarport } from './models.js';
import { bezier, makePath, legsAt, yawOf, smoothstep, rounded } from './paths.js';
import { createDetails } from './details.js';
import { wheelTravel, transactionAt, displaySoc } from './detail-state.js';
import { createConstructionDetails } from './construction-details.js';

export { STATIONS, SITES };
const grp = (name, parent) => { const g = new THREE.Group(); g.name = name; parent?.add(g); return g; };
const clamp01 = u => Math.max(0, Math.min(1, u));
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const under = re => m => { for (let p = m; p; p = p.parent) if (re.test(p.name)) return true; return false; };
const pair = (a, b, f, g) => (f(a) && g(b)) || (f(b) && g(a));
const carRoot = m => { for (let p = m; p; p = p.parent) if (/^(ev |hero car)/.test(p.name) && p.parent?.name === 'cars') return p; return null; };
const isCar = under(/^(ev |hero car)/), isCable = under(/^ev cable/), isHook = under(/^crane hook$/);
const isCharger = under(/^charger /), isLifted = under(/^(carport (column|beam) \d+|bess \d+|msb|transformer|charger DC\d)$/);
export const fmtHour = h => { const m = Math.round((((h % 24) + 24) % 24) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// 停車需求（背景車位的占用率，依時段；假設）
const OCC = {
  flagship: h => .22 + .6 * Math.exp(-(((h - 13) / 4.6) ** 2)) + .12 * Math.exp(-(((h - 19.5) / 1.8) ** 2)),
  mixed: h => .45 + .35 * (h < 7.5 || h > 19 ? 1 : 0) + .18 * Math.exp(-(((h - 13) / 3) ** 2)),
  urban: h => .3 + .58 * Math.exp(-(((h - 13.5) / 5) ** 2)),
};
// 白天亮度（0 夜～1 日）：日出 6 點、日落 18 點，前後各 40 分鐘漸變
export const daylight = h => { h = ((h % 24) + 24) % 24; return clamp01(Math.min((h - 5.6) / .9, (18.4 - h) / .9)); };

export function createProject({ scene, site: siteId = 'flagship' } = {}) {
  const site = siteOf(siteId), L = site.lot;
  const sim = simulate(site.id), simX = site.id === 'urban' ? simulate(site.id, { expanded: true }) : null;
  const seq = createSequence(site);
  const lot = createLot(scene, site);
  const reg = {};                                       // 構件：key → { obj, base: { pos, scale }, cy }
  const add = (key, obj) => { reg[key] = { obj, pos: obj.position.clone(), scale: obj.scale.clone() }; return obj; };

  // ---------------------------------------------------------------- 光電車棚（旗艦型）
  let carport = null, inverter = null;
  if (site.carport) {
    carport = createCarport('carport', site.carport); scene.add(carport.root);
    carport.foundations.forEach((g, i) => add(`footing${i}`, g));
    carport.columns.forEach((g, i) => add(`column${i}`, g));
    carport.beams.forEach((g, i) => add(`beam${i}`, g));
    carport.bays.forEach((g, i) => add(`bay${i}`, g));
    inverter = createInverter('pv inverter'); inverter.root.position.set(site.carport.cols[3], 1800, site.carport.zLine + 150); carport.root.add(inverter.root);
    add('inverter', inverter.root);
  }

  // ---------------------------------------------------------------- 能源區：儲能、配電盤、變壓器、EMS
  const energy = grp('energy', scene);
  const bess = site.bess.map((b, i) => { const m = createBESS(`bess ${i}`, b); m.root.position.set(b.x, 0, b.z); m.root.rotation.y = b.yaw || 0; energy.add(m.root); add(`bess${i}`, m.root); return m; });
  const msb = createCabinet('msb', { size: site.msb.size, label: '低壓配電盤＋電表' }); msb.root.position.set(site.msb.x, 0, site.msb.z); msb.root.rotation.y = site.msb.yaw || 0; energy.add(msb.root); add('msb', msb.root);
  const ems = createCabinet('ems', { size: [700, 1800, 600], label: 'EMS', screen: true, mat: M.cabinetDark }); ems.root.position.set(site.ems.x, 0, site.ems.z); ems.root.rotation.y = site.ems.yaw || 0; energy.add(ems.root); add('ems', ems.root);
  let transformer = null;
  if (site.transformer) { transformer = createTransformer('transformer', site.transformer); transformer.root.position.set(site.transformer.x, 0, site.transformer.z); energy.add(transformer.root); add('transformer', transformer.root); }
  // 能源區基座（住商、都會先澆基座再吊儲能櫃）：用一塊獨立的基座顯示澆置
  if (site.id !== 'flagship') {
    const padG = grp('bess footing', energy), b0 = site.bess[0];
    padG.position.set(b0.x, 0, b0.z); padG.rotation.y = b0.yaw || 0;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(b0.size[0] + 1300, 60, b0.size[2] + 1300), M.concrete); pad.position.y = -30 + 1; pad.name = 'yard slab'; pad.receiveShadow = true; padG.add(pad);
    add('bessPad', padG);
  }
  if (lot.noise.length) { const ng = grp('noise walls', lot.root); for (const w of lot.noise) ng.attach(w); add('noise', ng); }

  // ---------------------------------------------------------------- 充電樁
  const chargerG = grp('chargers', scene);
  const chargers = site.chargers.map(c => {
    const m = c.type === 'DC' ? createDCCharger(`charger ${c.id}`, { kw: c.kw }) : createACCharger(`charger ${c.id}`, { mount: c.mount === 'column' ? 'column' : 'post' });
    const p = chargerPose(site, c); m.root.position.set(p.x, p.y, p.z); m.root.rotation.y = p.yaw; chargerG.add(m.root); add(c.id, m.root);
    return { c, m, pose: p };
  });
  // DC 預留（住商）：基座＋管線出口＋標示
  if (site.reserved) for (const r of site.reserved) {
    const g = grp('dc reserve', chargerG), p = chargerPose(site, { ...r, mount: 'post' });
    const S = r.stall, head = S.dir > 0 ? S.z + STALL.d / 2 : S.z - STALL.d / 2;
    g.position.set(S.x, 0, head + 700 * S.dir);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(1000, 150, 800), M.concrete); pad.position.y = 75; pad.name = 'reserve pad'; pad.castShadow = pad.receiveShadow = true; g.add(pad);
    for (const x of [-200, 200]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 300, 12), M.lineYellow); c.position.set(x, 300, 0); c.name = 'reserve conduit'; g.add(c); }
    add('reserve', g);
  }
  if (lot.evPaint) add('evPaint', lot.evPaint.parent);
  if (lot.evPaintX) add('evPaintX', lot.evPaintX.parent);

  // ---------------------------------------------------------------- 施工：圍籬、放樣樁、吊車
  const works = grp('construction', scene);
  const zoneRect = {
    flagship: [[L.x0 + 6000 - 400, -13400], [L.halfX + 400, -13400], [L.halfX + 400, -2600], [L.x0 + 6000 - 400, -2600]],
    mixed: [[L.x0 + 6000 + 3 * STALL.w, L.z0 - 1500], [L.x0 + 6000 + 15 * STALL.w, L.z0 - 1500], [L.x0 + 6000 + 15 * STALL.w, L.rows[0].z1 + 300], [L.x0 + 6000 + 3 * STALL.w, L.rows[0].z1 + 300]],
    urban: [[L.x0 + 6000 + 9 * STALL.w, L.z0 - 1800], [site.yard.x1 + 300, L.z0 - 1800], [site.yard.x1 + 300, L.z1 + 1200], [L.x0 + 6000 + 9 * STALL.w, L.z1 + 1200]],
  }[site.id];
  const fence = createFence('work fence', zoneRect); works.add(fence.root); add('fence', fence.root);
  if (site.id === 'urban') { const f2 = createFence('work fence 2', [[site.lot.east.x0 + 200, L.z0 - 1800], [site.yard.x1 + 300, L.z0 - 1800], [site.yard.x1 + 300, L.z0 + 9000], [site.lot.east.x0 + 200, L.z0 + 9000]]); works.add(f2.root); add('fence2', f2.root); }
  if (site.id === 'flagship') { const Y = site.yard; const f3 = createFence('yard work fence', [[Y.x0 - 1500, Y.z0 - 800], [Y.x1 + 600, Y.z0 - 800], [Y.x1 + 600, Y.z1 + 800], [Y.x0 - 1500, Y.z1 + 800]]); fence.root.add(f3.root); }
  // 放樣樁：車棚柱位、能源區角點、充電樁位置
  const stakePts = [...(site.carport ? site.carport.cols.map(x => [x, site.carport.zLine]) : []), [site.yard.x0 + 800, site.yard.z0 + 800], [site.yard.x1 - 800, site.yard.z0 + 800], [site.yard.x1 - 800, site.yard.z1 - 800], [site.yard.x0 + 800, site.yard.z1 - 800], ...chargers.map(k => [k.pose.x, k.pose.z])];
  const stakes = new THREE.InstancedMesh(new THREE.CylinderGeometry(40, 40, 900, 8), M.stake, stakePts.length);
  stakePts.forEach(([x, z], i) => stakes.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 450, z))); stakes.name = 'survey stakes'; works.add(stakes); add('stakes', stakes);
  const C = seq.crane, crane = createCrane('crane', { boom: C.boom, scale: C.scale }); works.add(crane.root);

  // ---------------------------------------------------------------- 管線與能量流（效果，不進干涉檢查）
  const flows = grp('energy flows', scene); flows.userData.fx = true;
  const msbFront = site.msb.yaw ? [site.msb.x - 900, site.msb.z] : [site.msb.x, site.msb.z + 900];
  const spineX = L.east.xc;
  const routes = [];
  const route = (id, kind, pts, color, o = {}) => routes.push({ id, kind, pts, color, ...o });
  route('grid', 'grid', [[site.pole.x, site.pole.z], [site.pole.x, msbFront[1] + 300], [msbFront[0] + 300, msbFront[1] + 300]], 0x4aa8ff);
  if (site.carport) { const cp = site.carport; route('pv', 'pv', [[cp.cols[3], cp.zLine + 400], [spineX + 300, cp.zLine + 400], [spineX + 300, msbFront[1] - 300], [msbFront[0] - 300, msbFront[1] - 300]], 0xf5c400); }
  site.bess.forEach((b, i) => route(`bess${i}`, 'bess', [[msbFront[0] + 150 * i, msbFront[1]], [b.x - (b.yaw ? 1300 : 0), msbFront[1]], [b.x - (b.yaw ? 1300 : 0), b.z]], 0x3dd68c, { expand: b.expand, index: i }));
  chargers.forEach(({ c, pose }, i) => {
    const off = (i - chargers.length / 2) * 140, sx = spineX - 600 + off;
    const lineZ = c.mount === 'column' ? pose.z + (pose.z < site.carport.zLine ? -350 : 350) : pose.z;
    route(c.id, 'ev', [[msbFront[0] - 500 + off * .3, msbFront[1]], [sx, msbFront[1]], [sx, lineZ], [pose.x, lineZ]], c.type === 'DC' ? 0x34e0d0 : 0x7fe08a, { expand: c.expand, charger: c.id });
  });
  const flowMeshes = routes.map((r, i) => {
    const y = 40 + (i % 6) * 22;
    const pts = rounded(r.pts, 800, 300).map(([x, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0);
    const len = curve.getLength(), geo = new THREE.TubeGeometry(curve, Math.max(16, Math.round(len / 500)), 55, 6, false);
    const tex = flowTexture(r.color); tex.repeat.set(len / 1800, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x5c656d, transparent: true, opacity: .55, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = `flow ${r.id}`; mesh.renderOrder = 3; flows.add(mesh);
    return { r, mesh, mat, tex, count: geo.index.count, len };
  });

  // ---------------------------------------------------------------- 車輛：背景停車（InstancedMesh）、充電格的車、客戶車輛
  const chargeKeys = new Set([...site.chargers.map(c => `${c.stall.row},${c.stall.j}`), ...(site.reserved || []).map(r => `${r.stall.row},${r.stall.j}`)]);
  const fleetStalls = L.stalls.filter(s => !chargeKeys.has(`${s.row},${s.j}`));
  const fleet = createParkedFleet('parked fleet', fleetStalls.length); scene.add(fleet.root);
  const carsG = grp('cars', scene);
  const parkYaw = S => yawOf(0, S.dir);
  const evCars = chargers.map(({ c, pose }, i) => {
    const car = createCar(`ev ${c.id}`, CAR_COLORS[(i * 3 + 1) % CAR_COLORS.length]); carsG.add(car.root);
    const S = c.stall, aZ = S.aisleZ;
    // 從車道靠該排的那一半開進來（兩側車位同時進車時不在同一條線上）
    const lane = aZ + S.dir * 1300;
    const pts = bezier([S.x - 7500, lane], [S.x - 3500, lane], [S.x, S.z - S.dir * 3500], [S.x, S.z]);
    return { c, car, path: makePath(pts), pose };
  });
  const hero = createCar('hero car', 0x2aa59a); carsG.add(hero.root);
  // 充電線：停妥後從槍座拉到車的充電口（離充電樁近的那一側）
  const cables = grp('cables', scene);
  const _v = new THREE.Vector3();
  const cableFor = (k, car) => {
    const S = k.c.stall; car.root.position.set(S.x, 0, S.z); car.root.rotation.set(0, parkYaw(S), 0); car.root.updateMatrixWorld(true);
    k.m.root.updateMatrixWorld(true);
    const out = k.m.root.localToWorld(k.m.outlet.clone());
    const side = car.portWorld(1).distanceTo(out) < car.portWorld(-1).distanceTo(out) ? 1 : -1, port = car.portWorld(side);
    const mid = out.clone().lerp(port, .5); mid.y = Math.min(out.y, port.y) - 350;
    const t = tube(cables, [out.toArray(), [(out.x * 2 + port.x) / 3, mid.y + 120, (out.z * 2 + port.z) / 3], mid.toArray(), [(out.x + port.x * 2) / 3, mid.y + 150, (out.z + port.z * 2) / 3], port.toArray()], 22, M.cableBlack, 24);
    t.name = `ev cable ${k.c.id}`; return { mesh: t, side };
  };
  const cableOf = Object.fromEntries(evCars.map(k => [k.c.id, cableFor({ ...k, m: chargers.find(x => x.c === k.c).m }, k.car)]));
  const details = createDetails({ scene, site, seq, hero, chargers, cableOf, lot, flows: flowMeshes, carport });
  const constructionDetails = createConstructionDetails({scene,site,seq,reg,flows:flowMeshes,crane});

  // ---------------------------------------------------------------- 時刻 t → 場景
  const _hook = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const presentation = { time: 0 };
  const ease = smoothstep, outBack = u => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2;
  const liftPos = (L1, u) => {
    const [px, py, pz] = L1.pick, [tx, ty, tz] = L1.target, cy = Math.max(py, ty) + L1.clear;
    if (u < .25) { const e = ease(u / .25); return [px, py + (cy - py) * e, pz]; }
    if (u < .75) { const e = ease((u - .25) / .5); return [px + (tx - px) * e, cy, pz + (tz - pz) * e]; }
    const e = ease((u - .75) / .25); return [tx, cy + (ty - cy) * e, tz];
  };
  const craneStation = t => {
    const C0 = seq.crane.at;
    let k = 0;
    for (const m of seq.craneMoves) {
      if (t >= m.t1) { k = m.to; continue; }
      if (t > m.t0) {
        const a = C0[m.from], b = C0[m.to], pts = [[a.x, a.z], ...(m.via || []), [b.x, b.z]], path = makePath(rounded(pts, 5000));
        const u = ease((t - m.t0) / (m.t1 - m.t0)), p = path.at(path.length * u);
        return { x: p.x, z: p.z, yaw: p.yaw, moving: true };
      }
      break;
    }
    return { ...C0[k], moving: false };
  };
  function applyBuilds(t) {
    for (const b of seq.builds) {
      const R = reg[b.key]; if (!R) continue;
      const o = R.obj, u = b.t1 > b.t0 ? clamp01((t - b.t0) / (b.t1 - b.t0)) : 1;
      // 樑下線槽在模組放妥後才安裝，不能跟著屋面從上方穿過主樑。
      for(const child of o.children)if(child.userData.installAfterPlacement)child.visible=u>=1;
      o.position.copy(R.pos); o.scale.copy(R.scale);
      if (b.mode === 'show') { o.visible = t >= b.t0 && t < b.t1; continue; }
      o.visible = t >= b.t0;
      if (!o.visible) continue;
      if (b.mode === 'rise') o.scale.y = Math.max(1e-3, ease(u));
      else if (b.mode === 'drop') o.position.y = R.pos.y + (b.dy || 1500) * (1 - ease(u));
      else if (b.mode === 'pop') { const s = Math.max(.01, outBack(u)); o.scale.setScalar(s); }
    }
  }
  function applyCrane(t) {
    const on = seq.craneShow.some(([a, b]) => t >= a && t < b);
    crane.root.visible = on; if (!on) return;
    const st = craneStation(t);
    crane.root.position.set(st.x, 0, st.z); crane.root.rotation.set(0, st.yaw, 0); crane.root.updateMatrixWorld(true);
    const lifts = seq.lifts;
    const act = lifts.find(l => t >= l.t0 && t <= l.t1);
    let hookW;
    if (act) {
      const p = liftPos(act, (t - act.t0) / (act.t1 - act.t0));
      const R = reg[act.key]; R.obj.position.set(...p);
      hookW = _hook.set(p[0], p[1] + act.top, p[2]);
    } else {
      const prev = [...lifts].reverse().find(l => l.t1 < t), next = lifts.find(l => l.t0 > t);
      const top = l => new THREE.Vector3(l.target[0], l.target[1] + l.top, l.target[2]), pick = l => new THREE.Vector3(l.pick[0], l.pick[1] + l.top, l.pick[2]);
      if (st.moving || (prev && next && prev.at !== next.at) || (!prev && !next)) {
        // 移車或沒有吊裝：吊鉤收在車頭前上方
        hookW = crane.root.localToWorld(new THREE.Vector3(2600 * C.scale, 5200 * C.scale, 0));
      } else if (prev && next) {
        const u = ease(clamp01((t - prev.t1) / Math.max(.05, next.t0 - prev.t1))), a = top(prev), b = pick(next);
        hookW = a.lerp(b, u); hookW.y += Math.sin(Math.PI * u) * 1800;
      } else if (prev) { const a = top(prev); a.y += Math.min(2500, (t - prev.t1) * 3000); hookW = a; }
      else { const b = pick(next); b.y += Math.min(2500, (next.t0 - t) * 3000); hookW = b; }
    }
    crane.aim(crane.root.worldToLocal(hookW.clone()));
  }
  const simAt = t => (simX && segmentAt(seq, t)?.expanded) ? simX : sim;
  function applyCars(t, h, S) {
    const op = t >= seq.opStart, seg = segmentAt(seq, t), ses = op ? S.sessionAt(h) : {};
    const r = S.at(h);
    const expandBuilt = site.chargers.filter(c => c.expand).every(c => reg[c.id] && t >= (seq.builds.find(b => b.key === c.id)?.t1 ?? 0));
    for (const k of evCars) {
      const s = ses[k.c.id], car = k.car, cab = cableOf[k.c.id];
      let vis = !!s && !s.s.hero && (!k.c.expand || expandBuilt), drive = 1;
      if (vis && seg) {
        if (s.s.a >= seg.h0) { const ta = timeOfHour(seg, s.s.a); drive = clamp01((t - ta) / DRIVE); }
        if (s.s.d <= seg.h1) { const td = timeOfHour(seg, s.s.d); drive = Math.min(drive, clamp01((td - t) / DRIVE)); }
      }
      car.root.visible = vis; cab.mesh.visible = false;
      if (!vis) { car.setCharging(0, 'off'); car.setDetail(); continue; }
      const p = k.path.at(k.path.length * ease(drive));
      car.root.position.set(p.x, 0, p.z); car.root.rotation.set(0, drive >= 1 ? parkYaw(k.c.stall) : p.yaw, 0);
      car.root.userData.driving = drive < 1;
      const plugged = drive >= 1;
      cab.mesh.visible = plugged;
      const state = !plugged ? 'off' : s.p > .05 ? (r.limited && s.p < k.c.kw - .3 ? 'limit' : 'charging') : s.frac >= .995 ? 'done' : 'wait';
      car.setCharging(cab.side, state);
      car.setDetail({distance:k.path.length * ease(drive),night:1-daylight(h),moving:drive<1,side:cab.side,open:plugged});
    }
    // 客戶車輛
    const H = seq.hero, onHero = t >= H.t0 && t <= H.t1;
    hero.root.visible = onHero; const hc = cableOf[H.chId];
    if (onHero) {
      const p = legsAt(H.legs, t);
      hero.root.position.set(p.x, 0, p.z); hero.root.rotation.set(0, p.yaw, 0);
      hero.root.userData.driving = false;   // 客戶車輛照實際路權檢查
      const plugged = t >= H.plugT + 1.05 && t < H.unplugT, hs = ses[H.chId];
      if (plugged) hc.mesh.visible = true;
      const state = !plugged ? 'off' : hs && hs.s.hero && hs.p > .05 ? (r.limited && hs.p < H.ch.kw - .3 ? 'limit' : 'charging') : hs && hs.s.hero && hs.frac < .995 ? 'wait' : 'done';
      hero.setCharging(hc.side, state);
      hero.setDetail({distance:wheelTravel(H.legs,t),night:1-daylight(h),moving:p.moving,reverse:!!p.leg?.path.reverse,
        brake:(!p.moving&&(t<H.tPark+.6||t>=H.revT0-.6)) || (p.moving&&!!p.leg&&t>p.leg.t1-.35),side:hc.side,
        open:Math.min(clamp01((t-H.plugT+1.7)/.5),clamp01((H.unplugT+1.2-t)/.5))});
    } else { hero.setCharging(0, 'off'); hero.setDetail(); }
    // 充電樁燈號與畫面
    for (const k of chargers) {
      const built = reg[k.c.id].obj.visible;
      const s = ses[k.c.id], hs = s && s.s.hero;
      const occupied = s && (hs ? onHero && t >= H.tPark : evCars.find(e => e.c === k.c).car.root.visible);
      const plugged = s && (hs ? t >= H.plugT + 1.05 && t < H.unplugT : cableOf[k.c.id].mesh.visible);
      const state = !built || !op ? (t >= (seq.builds.find(b => b.key === 'test')?.t0 ?? Infinity) && built ? 'idle' : 'off') : plugged ? (s.p > .05 ? (r.limited && s.p < k.c.kw - .3 ? 'limit' : 'charging') : s.frac >= .995 ? 'idle' : 'wait') : 'idle';
      k.m.set(state);
      k.state = state; k.session = plugged ? s : null; k.occupied = !!occupied;
      const transaction = k.c.id === H.chId ? transactionAt(H,t,s) : '';
      if (k.m.screen) k.m.screen.draw(`${state}|${transaction}|${s?.p?.toFixed(1)}|${s?.got?.toFixed(1)}|${s?.frac?.toFixed(2)}|${s?.s.start > h ? fmtHour(s.s.start) : ''}`, (c, w, hh) => drawChargerScreen(c, w, hh, k, state, s, h, transaction));
    }
  }
  function drawChargerScreen(c, w, h, k, state, s, hour, transaction) {
    const bgc = { charging: '#0f3d63', limit: '#5a3d0a', wait: '#4a3a10', idle: '#0e3326', off: '#111' }[state] || '#111';
    c.fillStyle = bgc; c.fillRect(0, 0, w, h); c.fillStyle = '#e9f2f6'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const big = Math.round(h * .26), small = Math.round(h * .15);
    c.font = `bold ${small}px sans-serif`; c.fillText(`${k.c.id} · ${k.c.type} ${k.c.kw} kW`, w / 2, h * .17);
    c.font = `bold ${big}px sans-serif`;
    const main = { charging: `${s ? s.p.toFixed(1) : 0} kW`, limit: `限功率 ${s ? s.p.toFixed(0) : 0} kW`, wait: s && s.s.start > hour ? `排程 ${fmtHour(s.s.start)}` : '等待中', idle: '可使用', off: '' }[state];
    c.font = `bold ${transaction ? small : big}px sans-serif`;
    c.fillText(transaction || main, w / 2, h * .43);
    const handshake = ['確認費率（示意）', '授權', '啟動成功'].includes(transaction);
    if (handshake) {
      c.font = `${Math.round(h*.12)}px sans-serif`; c.fillStyle = '#9feacb';
      c.fillText('依畫面確認操作（示意）',w/2,h*.7);
    } else if (s && (transaction || state === 'charging' || state === 'limit' || state === 'wait')) {
      c.font = `${Math.round(h*.12)}px sans-serif`; c.fillStyle='#9feacb';
      c.fillText(`${s.p.toFixed(1)} kW · ${s.got.toFixed(1)} kWh`,w/2,h*.67);
      c.fillText(`SOC ${displaySoc(s.got).toFixed(0)}%（示意）`,w/2,h*.87);
    }
    else { c.font = `${small}px sans-serif`; c.fillStyle = '#9fc'; c.fillText(state === 'idle' ? '費率依現場公告（示意）' : '', w / 2, h * .8); }
  }
  function applyFleet(t, h) {
    const op = t >= seq.opStart, occ = OCC[site.id](op ? ((h % 24) + 24) % 24 : 10.5);
    const zones = seq.zones.filter(z => t >= z.t0 && t < z.t1);
    fleet.set(fleetStalls.map((s, i) => ({ x: s.x + (hash(i) - .5) * 160, z: s.z + (hash(i + 99) - .5) * 200, yaw: parkYaw(s) + (hash(i + 7) - .5) * .05, on: hash(i + 31) < occ && !zones.some(z => z.test(s)) })));
  }
  function applyGate(t) {
    const G = seq.hero.gates, g = lot.gate;
    const openOf = w => t < w.open[0] ? 0 : t < w.open[1] ? ease((t - w.open[0]) / (w.open[1] - w.open[0])) : t < w.close[0] ? 1 : t < w.close[1] ? 1 - ease((t - w.close[0]) / (w.close[1] - w.close[0])) : 0;
    g.entry.set(openOf(G.entry)); g.exit.set(openOf(G.exit));
    g.lprIn.flash(t >= G.lprIn[0] && t < G.lprIn[1]); g.lprOut.flash(t >= G.lprOut[0] && t < G.lprOut[1]);
    return { entry: openOf(G.entry), exit: openOf(G.exit) };
  }
  function applyFlows(t, h, S) {
    const test = seq.builds.find(b => b.key === 'test'), conduit = seq.builds.find(b => b.key === 'conduits'), conduitX = seq.builds.find(b => b.key === 'conduitsX');
    const r = S.at(h), op = t >= seq.opStart, testing = test && t >= test.t0 && t < test.t1;
    const expanded = S === simX;
    const out = {};
    for (const f of flowMeshes) {
      const R = f.r, cb = R.expand ? conduitX : conduit, u = cb ? clamp01((t - cb.t0) / (cb.t1 - cb.t0)) : 1;
      f.mesh.visible = !!cb && t >= cb.t0;
      f.mesh.geometry.setDrawRange(0, Math.floor(f.count * u / 3) * 3);
      let p = 0;
      if (op) {
        if (R.kind === 'grid') p = r.grid;
        else if (R.kind === 'pv') p = r.pv;
        else if (R.kind === 'bess') { const n = site.bess.filter(b => !b.expand || expanded).length; p = (R.expand && !expanded) ? 0 : (r.chg - r.dis) / n; }
        else p = r.perCharger[R.charger] ?? 0;
      }
      const live = op ? Math.abs(p) > .3 : testing;
      out[R.id] = p;
      f.power = p;
      if (live) {
        f.mat.map = f.tex; f.mat.color.setHex(0xffffff); f.mat.opacity = op ? Math.min(1, .45 + Math.abs(p) / 60) : .5 + .4 * Math.sin(t * 9) ** 2;
        f.tex.offset.x = -(p >= 0 ? 1 : -1) * t * 1.6;
      } else { f.mat.map = null; f.mat.color.setHex(0x5c656d); f.mat.opacity = .5; }
      f.mat.needsUpdate = true;
    }
    return out;
  }

  function apply(t) {
    presentation.time = t;
    const h = hourAt(seq, t), S = simAt(t), r = S.at(Math.max(0, h));
    applyBuilds(t);
    applyCrane(t);
    applyCars(t, h, S);
    applyFleet(t, h);
    const gate = applyGate(t);
    const flowsNow = applyFlows(t, h, S);
    // 夜間照明（路燈、建物窗格）
    const day = daylight(h), night = 1 - day;
    M.lamp.emissiveIntensity = night * 2.4;
    for (const m of lot.buildings) m.emissiveIntensity = night * .3;
    M.pv.emissiveIntensity = .15 + .35 * day;
    for (const b of bess) b.set(t < seq.opStart ? (reg[`bess${bess.indexOf(b)}`].obj.visible && t >= (seq.builds.find(x => x.key === 'test')?.t0 ?? 1e9) ? 'idle' : 'off') : r.dis > .5 ? 'charging' : r.chg > .5 ? 'wait' : 'idle');
    inverter?.set(t >= seq.opStart ? (r.pv > 1 ? 'idle' : 'off') : 'off');
    msb.set(t >= seq.opStart ? 'idle' : 'off'); ems.set(t >= seq.opStart ? 'idle' : 'off');
    details.apply(t,h,r,S,day);
    constructionDetails.apply(t);
    ems.screen?.draw(`${Math.round(r.soc * 100)}|${t >= seq.opStart}|${PERIOD_NAME[r.period]}|${r.grid.toFixed(0)}|${S.contract}|${r.limited}`, (c, w, hh) => {
      c.fillStyle = '#0b1c26'; c.fillRect(0, 0, w, hh); c.fillStyle = '#e8f2f6'; c.font = 'bold 34px sans-serif'; c.textAlign = 'left';
      c.fillText('EMS', 18, 42); c.font = '28px sans-serif'; c.fillText(t >= seq.opStart ? `${PERIOD_NAME[r.period]} · SOC ${Math.round(r.soc * 100)}%` : '聯測中', 18, 100);
      c.fillStyle = '#244'; c.fillRect(18, 130, w - 36, 34); c.fillStyle = '#3dd68c'; c.fillRect(18, 130, (w - 36) * r.soc, 34);
      c.fillStyle = '#9cc'; c.font = '24px sans-serif'; c.fillText(`市電 ${r.grid.toFixed(0)} kW／契約 ${S.contract} kW`, 18, 210);
      c.fillStyle=r.limited?'#ffbc5e':'#75edb0'; c.font='22px sans-serif'; c.fillText(r.limited?'限功率：啟用（示意）':'限功率：未觸發',18,245);
    });
    // ---- 面板用的狀態
    const H = seq.hero, hs = S.sessionAt(h)[H.chId];
    const ev = chargers.filter(k => k.state === 'charging' || k.state === 'limit').length;
    presentation.hour = h; presentation.day = day; presentation.period = r.period; presentation.op = t >= seq.opStart;
    presentation.energy = { ...r, P: S.P, E: S.E, contract: S.contract, kwp: S.kwp, active: ev, total: chargers.filter(k => reg[k.c.id].obj.visible).length };
    presentation.flows = flowsNow; presentation.gate = gate; presentation.sim = S;
    const mine = hs && hs.s.hero ? hs : null;
    presentation.hero = t >= H.t0 && t <= H.t1 ? {
      phase: t < H.tPark ? 'in' : t < H.plugT+1.05 ? 'park' : t < H.unplugT ? 'charge' : t < H.revT0 ? 'unplug' : 'out',
      transaction: transactionAt(H,t,mine),
      kwh: t < H.plugT + 1.05 ? 0 : mine ? mine.got : t >= H.unplugT ? heroKwh : 0, p: mine && t >= H.plugT + 1.05 && t < H.unplugT ? mine.p : 0, need: heroNeed, ch: H.ch,
      limited: !!mine && r.limited && mine.p > .05 && mine.p < H.ch.kw - .3, wait: !!mine && mine.p <= .05 && mine.frac < .995 && t >= H.plugT,
    } : null;
    presentation.chargers = chargers.map(k => ({ id: k.c.id, type: k.c.type, kw: k.c.kw, state: k.state, p: k.session?.p || 0, built: reg[k.c.id].obj.visible }));
    return presentation;
  }
  const heroSes = sim.sessions.find(s => s.hero) || simX?.sessions.find(s => s.hero), heroNeed = heroSes?.kwh ?? 0, heroKwh = heroSes ? Math.min(heroSes.kwh, heroSes.got) : 0;
  apply(0);

  // ---------------------------------------------------------------- 空間檢核
  function layoutChecks() {
    const rows = [], n = L.stalls.length, k = sim.kpi;
    const [lo, hi] = { flagship: [100, Infinity], mixed: [50, 99], urban: [20, 49] }[site.id];
    rows.push({ group: '場型', name: `車位數符合${site.name}分級（${site.cls}）`, ok: n >= lo && n <= hi, value: `${n} 格` });
    rows.push({ group: '場型', name: '車道寬 ≥ 6 m、車位 2.5 × 5.0 m（假設）', ok: true, value: `${STALL.w / 1000} × ${STALL.d / 1000} m` });
    // 入口：等候車輛（車頭距閘桿 0.8 m）車尾不占用街道
    const G = gateGeom(site), rear = G.armIn + 800 + CAR.len;
    rows.push({ group: '入口', name: '閘門等候車輛不占用街道', ok: rear <= site.entrance.zStreet, value: `餘 ${((site.entrance.zStreet - rear) / 1000).toFixed(1)} m` });
    if (site.entrance.narrow) rows.push({ group: '入口', name: '狹長入口每向車道 ≥ 2.3 m（車寬 1.82 m）', ok: (site.entrance.lane[1] - site.entrance.lane[0] - G.isl) / 2 >= 2300, value: `${((site.entrance.lane[1] - site.entrance.lane[0] - G.isl) / 2000).toFixed(2)} m` });
    if (site.carport) {
      const cp = site.carport, clear = Math.min(carport.roofY(cp.z0), carport.roofY(cp.z1)) - 505;
      rows.push({ group: '光電', name: `模組 ${cp.nx * cp.ny} 片 × ${cp.mod.kw * 1000} Wp`, ok: Math.abs(cp.kwp - 100) < 5, value: `${cp.kwp} kWp` });
      rows.push({ group: '光電', name: '車棚樑下淨高 ≥ 2.5 m', ok: clear >= 2500, value: `${(clear / 1000).toFixed(2)} m` });
      rows.push({ group: '光電', name: '立柱不侵入停車空間（柱寬 300、車側餘 340）', ok: 150 < (STALL.w - CAR.w) / 2, value: `餘 ${((STALL.w - CAR.w) / 2 - 150)} mm` });
    }
    // 儲能櫃與最近車位的距離（假設門檻 3 m，實際依消防審查與設備條件）
    const dist = Math.min(...site.bess.map(b => Math.min(...L.stalls.map(s => {
      const [w, , d] = b.size, ex = (b.yaw ? d : w) / 2, ez = (b.yaw ? w : d) / 2;
      const dx = Math.max(0, Math.abs(s.x - b.x) - ex - STALL.w / 2), dz = Math.max(0, Math.abs(s.z - b.z) - ez - STALL.d / 2);
      return Math.hypot(dx, dz);
    }))));
    rows.push({ group: '儲能', name: '儲能櫃與最近車位間距 ≥ 3 m（假設，依消防審查）', ok: dist >= 3000, value: `${(dist / 1000).toFixed(1)} m` });
    rows.push({ group: '調度', name: `市電取電 ≤ 契約容量 ${sim.contract} kW`, ok: k.peakGrid <= sim.contract + .01, value: `峰值 ${k.peakGrid.toFixed(0)} kW（無儲能 ${k.peakNoBess.toFixed(0)}）` });
    rows.push({ group: '調度', name: `SOC 維持 ${Math.round(site.socMin * 100)}～95%`, ok: k.socRange[0] >= site.socMin - 1e-6 && k.socRange[1] <= .95 + 1e-6, value: `${Math.round(k.socRange[0] * 100)}～${Math.round(k.socRange[1] * 100)}%` });
    rows.push({ group: '調度', name: '充電需求滿足率 ≥ 97%', ok: k.ev / k.evReq >= .97, value: `${(k.ev / k.evReq * 100).toFixed(1)}%（限功率 ${k.limitHours} h）` });
    rows.push({ group: '調度', name: '儲能每日循環 ≤ 1', ok: k.cycles <= 1, value: `${k.cycles.toFixed(2)} 次／日` });
    if (simX) rows.push({ group: '擴充', name: `擴充後（${simX.P} kW／${simX.E} kWh、契約 ${simX.contract} kW）限功率時數下降`, ok: simX.kpi.limitHours <= k.limitHours, value: `${k.limitHours} → ${simX.kpi.limitHours} h；日充電 ${k.ev.toFixed(0)} → ${simX.kpi.ev.toFixed(0)} kWh` });
    rows.push({ group: '憑證', name: site.pv ? '合格光電可評估憑證（1,000 度 1 張）' : '市電儲能不產生憑證', ok: true, value: site.pv ? `約 ${Math.floor(k.pv * 365 / 1000)} 張／年（未扣躉售與資格）` : '—' });
    // 吊車：每次吊裝的起吊點與放置點都在作業半徑內、吊鉤低於臂頭
    const save = { p: crane.root.position.clone(), r: crane.root.rotation.clone() };
    let worst = 0, bad = 0;
    for (const l of seq.lifts) {
      const st = seq.crane.at[l.at];
      crane.root.position.set(st.x, 0, st.z); crane.root.rotation.set(0, st.yaw, 0); crane.root.updateMatrixWorld(true);
      for (const p of [l.pick, l.target]) {
        const a = crane.aim(crane.root.worldToLocal(new THREE.Vector3(p[0], Math.max(l.pick[1], l.target[1]) + l.clear + l.top, p[2])));
        worst = Math.max(worst, a.radius); if (!a.ok) bad++;
      }
    }
    crane.root.position.copy(save.p); crane.root.rotation.copy(save.r);
    rows.push({ group: '施工', name: `吊裝都在吊車作業半徑內（伸臂 ${(seq.crane.boom / 1000).toFixed(0)} m）`, ok: bad === 0, value: `${seq.lifts.length} 次吊裝、最大半徑 ${(worst / 1000).toFixed(1)} m` });
    apply(presentation.time);
    return rows;
  }

  const skipDecor = o => o.userData.decor === true || o.userData.operatorProxy === true;
  return {
    total: seq.total, timeline: seq.tl, events: seq.tl.events, stationStart: seq.tl.stationStart, stations: seq.stations,
    apply, layoutChecks, presentation, site, sim, simX, seq, lot, crane, chargers, evCars, hero, carport, bess, msb, ems, transformer, flows: flowMeshes, details, constructionDetails,
    verify: {
      skip: skipDecor,
      allow: [
        { why: '充電線一端插在車的充電口、另一端在充電樁槍座', test: (a, b) => pair(a, b, isCable, m => isCar(m) || isCharger(m)) },
        { why: '吊鉤掛著吊裝中的構件', test: (a, b) => pair(a, b, isHook, isLifted) },
        // 全天調度把 24 h 壓成 36 s，充電格的進出車只示意占用時段，車道上的會車不做路權模擬；停妥的車之間仍然檢查
        { why: '縮時段充電格車輛進出時的會車（示意）', test: (a, b) => { const A = carRoot(a), B = carRoot(b); return !!A && !!B && A !== B && (A.userData.driving === true || B.userData.driving === true); } },
        { why: '吊車鋼索穿過吊鉤（同一組吊具）', test: (a, b) => isHook(a) && isHook(b) },
      ],
      dt: .1,
    },
  };
}
