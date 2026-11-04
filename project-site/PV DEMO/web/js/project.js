// 專案介面：網頁（main.js）與 core 統一檢查共用。規格見 core/README.md「專案介面」。
// 屋頂型光伏電場的一天（春分、真太陽時 5:36～18:36 壓縮成約 1 分鐘）：日出併網 → 上午爬升 → 正午峰值 → 雲層遮蔽 → 午後下降 → 日落日結。
// 每片板依太陽方向算斜面日射，遮蔭（塔樓、前排、雲影）以板中心的射線判定；三台組串式變流器各接一區陣列。
import * as THREE from 'three';
import { createTimeline, linear } from '@core/anim/track.js';
import { floor } from '@core/geom/environment.js';
import { H, LAYOUT, STATIONS } from './layout.js';
import { sunAt, poa, southNormal, rayHitsBox, cloudShadowAt, sawtoothShadowOnSlope, SITE, D2R } from './solar.js';
import { ROOF, createBuilding, createSawtooth, createSawRails, createRackSteel, createPanels, createTower, createPower, createGridPoint, createSurroundings, createCloud } from './models.js';

export { LAYOUT, STATIONS, H };
const L = LAYOUT, M = L.module;
const clamp01 = v => Math.max(0, Math.min(1, v));
export const fmtHour = h => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- 板片清單（位置、法向、所屬變流器、可能遮擋它的矩形）
const SAW_TILT = Math.atan2(L.saw.rise, L.saw.run), SAW_SLOPE = Math.hypot(L.saw.run, L.saw.rise);
const RACK_TILT = L.rack.tilt * D2R, RACK_DEPTH = L.rack.rows * M.L + (L.rack.rows - 1) * M.gap, RACK_WIDTH = L.rack.cols * M.W + (L.rack.cols - 1) * M.gap;
const rackAt = (zf, s) => [ROOF + L.rack.edgeY + s * Math.sin(RACK_TILT), zf - s * Math.cos(RACK_TILT)];
export const TABLES = L.rack.zf.flatMap((zf, row) => L.rack.xc.map(xc => ({ xc, zf, row })));

// 矩形遮擋物：center、u／v 單位向量與半長、法向 n
const rect = (c, u, hu, v, hv) => ({ c, u, hu, v, hv, n: [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]] });
function rayHitsRect(p, d, r) {
  const den = r.n[0] * d[0] + r.n[1] * d[1] + r.n[2] * d[2]; if (Math.abs(den) < 1e-9) return false;
  const t = (r.n[0] * (r.c[0] - p[0]) + r.n[1] * (r.c[1] - p[1]) + r.n[2] * (r.c[2] - p[2])) / den; if (t <= 1) return false;
  const q = [p[0] + d[0] * t - r.c[0], p[1] + d[1] * t - r.c[1], p[2] + d[2] * t - r.c[2]];
  return Math.abs(q[0] * r.u[0] + q[1] * r.u[1] + q[2] * r.u[2]) <= r.hu && Math.abs(q[0] * r.v[0] + q[1] * r.v[1] + q[2] * r.v[2]) <= r.hv;
}

function buildPanels() {
  const out = [], s = L.saw, sn = Math.sin(SAW_TILT), cs = Math.cos(SAW_TILT), nSaw = southNormal(SAW_TILT / D2R);
  const xs = (x0, x1, n) => { const w = n * M.W + (n - 1) * M.gap, a = (x0 + x1) / 2 - w / 2 + M.W / 2; return Array.from({ length: n }, (_, i) => a + i * (M.W + M.gap)); };
  // 鋸齒屋面：第 i 排的前一排（南側）北立面是它的遮擋物
  s.zs.forEach((zs, i) => {
    const occ = i ? [rect([(s.x0 + s.x1) / 2, ROOF + s.rise / 2, zs], [1, 0, 0], (s.x1 - s.x0) / 2, [0, 1, 0], s.rise / 2)] : [];
    for (let r = 0; r < s.rows; r++) {
      const sc = SAW_SLOPE - s.topMargin - M.L / 2 - r * (M.L + M.gap);
      for (const x of xs(s.x0, s.x1, s.cols)) out.push({ zone: 'saw', row: i, inv: i < 2 ? 0 : 1, tilt: SAW_TILT, n: nSaw, occ,
        pos: [x, ROOF + sc * sn + s.standoff * cs, zs - sc * cs + s.standoff * sn] });
    }
  });
  // 鋼架斜置陣列：前一排三座桌台的板面是遮擋物
  const nRack = southNormal(L.rack.tilt), v = [0, Math.sin(RACK_TILT), -Math.cos(RACK_TILT)];
  const tableRect = tb => { const [y, z] = rackAt(tb.zf, RACK_DEPTH / 2); return rect([tb.xc, y, z], [1, 0, 0], RACK_WIDTH / 2, v, RACK_DEPTH / 2); };
  for (const tb of TABLES) {
    const occ = TABLES.filter(o => o.row === tb.row - 1).map(tableRect);
    for (let r = 0; r < L.rack.rows; r++) {
      const [y, z] = rackAt(tb.zf, M.L / 2 + r * (M.L + M.gap));
      for (const x of xs(tb.xc - RACK_WIDTH / 2, tb.xc + RACK_WIDTH / 2, L.rack.cols)) out.push({ zone: 'rack', row: tb.row, inv: 2, tilt: RACK_TILT, n: nRack, occ, pos: [x, y, z] });
    }
  }
  return out;
}
export const PANELS = buildPanels();
const TOWER_BOX = [[L.tower.x0, ROOF, L.tower.z0], [L.tower.x1, ROOF + L.tower.h, L.tower.z1]];
export const KWP = PANELS.length * M.wp / 1000;
export const INV_KWP = L.inverters.map((_, i) => PANELS.filter(p => p.inv === i).length * M.wp / 1000);

// ---------------------------------------------------------------- 發電：某時刻（hour）、雲位置（cloud = null 表示無雲）
export function powerAt(hour, cloud = null) {
  const sun = sunAt(hour), n = L.inverters.length;
  const inv = L.inverters.map(() => ({ dc: 0, ac: 0, poa: 0, panels: 0, shaded: 0 }));
  const ref = poa(southNormal(SAW_TILT / D2R), sun);                          // 日射計（與鋸齒屋面同傾角、不受遮蔭）
  const cs = cloud && sun.el > 0 ? cloudShadowAt(cloud, sun, ROOF + 1500) : null, C = L.cloud;
  for (const p of PANELS) {
    const I = inv[p.inv]; I.panels++;
    let shade = 0;
    if (sun.el > 0) {
      if (rayHitsBox(p.pos, sun.dir, TOWER_BOX) || p.occ.some(r => rayHitsRect(p.pos, sun.dir, r))) shade = 1;
      if (cs) shade = Math.max(shade, .92 * clamp01((C.r + C.soft - Math.hypot(p.pos[0] - cs[0], p.pos[2] - cs[1])) / (2 * C.soft)));
    }
    if (shade > .5) I.shaded++;
    const g = poa(p.n, sun, shade); I.poa += g; I.dc += g / 1000 * M.wp / 1000 * L.pr.dc;
  }
  let dc = 0, ac = 0;
  inv.forEach((I, i) => {
    I.poa /= I.panels; I.on = sun.el > 0 && I.poa > L.pr.start;
    I.ac = I.on ? Math.min(I.dc * L.pr.inv, L.inverters[i].kw) : 0; if (!I.on) I.dc = Math.min(I.dc, .05 * INV_KWP[i]);
    I.state = sun.el <= 0 ? 'night' : I.on ? 'grid' : 'standby';
    dc += I.dc; ac += I.ac;
  });
  return { hour, sun, ref, inv, dc, ac, cloudShadow: cs, shaded: inv.reduce((a, I) => a + I.shaded, 0), n };
}

// ---------------------------------------------------------------- 時間軸（一天的時刻與雲的位置）
function createDay() {
  const tl = createTimeline();
  const day = tl.track('day', { h: 5.6 }), cloud = tl.track('cloud', { x: L.cloud.x0 });
  const go = (dur, h, action, sub, station) => day.add(dur, { h }, { action, sub, station, ease: linear });
  go(4, 6.3, '黎明：天色漸亮', '日射量低於啟動值，三台變流器待機', 0);
  go(3, 6.8, '變流器自檢、併網', '直流電壓達啟動值，絕緣檢測後併入市電', 0);
  go(5, 8.0, '早晨發電', '太陽由正東升起，塔樓陰影落在鋼架陣列東側', 0);
  go(10, 11.0, '上午：發電量爬升', '入射角變小，斜面日射逐步接近 1000 W/m²', 1);
  go(8, 12.6, '正午：峰值發電', '太陽在正南；鋸齒屋面下緣留空，前排屋脊陰影不落在板面', 2);
  const c = go(12, 14.0, '雲層通過：發電驟降', '雲影由西往東掃過陣列，三台變流器依序下降後回升', 3);
  cloud.add(c.dur, { x: L.cloud.x1 }, { at: c.start, ease: linear });
  go(10, 17.0, '午後：發電量下降', '太陽西斜，鋼架陣列後排開始被前排遮蔭', 4);
  go(5, 18.0, '日落：變流器停機', '日射量不足，變流器離網待機', 5);
  go(4, 18.6, '日結：今日發電量', '監控系統彙整發電量與等效日照時數', 5);
  return tl;
}

export function createProject({ scene }) {
  const tl = createDay(), total = tl.total;
  floor(scene, { size: [320000, 260000], color: 0x5f646a, roughness: .95, grid: false });
  const building = createBuilding(scene); createSawtooth(building);
  const pv = new THREE.Group(); pv.name = 'pv'; scene.add(pv);
  createSawRails(pv); createRackSteel(pv, TABLES);
  createPanels(pv, 'pv modules', PANELS.map(p => ({ pos: p.pos, tilt: p.tilt })));
  createTower(scene);
  const power = createPower(scene);
  createGridPoint(scene);
  createSurroundings(scene);
  const cloudObj = createCloud(scene);

  const cloudAt = st => (st.cloud.x > L.cloud.x0 && st.cloud.x < L.cloud.x1) ? { x: st.cloud.x, y: L.cloud.y, z: L.cloud.z } : null;
  // 累積發電量表：固定步長積分（apply(t) 只查表，倒退、跳站與連續播放一致）
  const DT = .05, N = Math.ceil(total / DT) + 1, Et = new Float64Array(N), Ei = L.inverters.map(() => new Float64Array(N)), curve = [];
  let prev = null;
  for (let i = 0; i < N; i++) {
    const t = Math.min(total, i * DT), st = tl.sample(t), p = powerAt(st.day.h, cloudAt(st));
    if (prev) {
      const dh = st.day.h - prev.hour;
      Et[i] = Et[i - 1] + (p.ac + prev.ac) / 2 * dh;
      Ei.forEach((E, k) => E[i] = E[i - 1] + (p.inv[k].ac + prev.inv[k].ac) / 2 * dh);
    }
    if (i % 4 === 0 || i === N - 1) curve.push({ t, h: st.day.h, ac: p.ac, clear: cloudAt(st) ? powerAt(st.day.h).ac : p.ac });
    prev = p;
  }
  const lookup = (A, t) => { const f = clamp01(t / total) * (N - 1), i = Math.min(N - 2, Math.floor(f)), u = f - i; return A[i] + (A[i + 1] - A[i]) * u; };

  const SCREEN = { grid: [0x2a8fd0, .9], standby: [0xb87a10, .5], night: [0x000000, 0] }, LED = { grid: 0x3dd68c, standby: 0xffb020, night: 0x000000 };
  function apply(t) {
    const st = tl.sample(t), cloud = cloudAt(st), p = powerAt(st.day.h, cloud);
    cloudObj.visible = !!cloud; if (cloud) cloudObj.position.set(cloud.x, cloud.y, cloud.z);
    const energy = lookup(Et, t), invE = Ei.map(E => lookup(E, t));
    power.inv.forEach((v, i) => {
      const s = p.inv[i].state; v.screenMat.emissive.setHex(SCREEN[s][0]); v.screenMat.emissiveIntensity = SCREEN[s][1];
      v.ledMat.emissive.setHex(LED[s]); v.ledMat.emissiveIntensity = s === 'night' ? 0 : 1;
      const on = p.inv[i].ac > .2;
      power.dc[i].setFlow(on); power.dc[i].tick(invE[i] * .12);
      power.ac[i].setFlow(on); power.ac[i].tick(invE[i] * .12);
    });
    power.grid.setFlow(p.ac > .2); power.grid.tick(energy * .04);
    return { t, hour: st.day.h, ...p, cloud, energy, invE, kwp: KWP };
  }

  // 冬至正午太陽高度（排距與前排遮蔭的設計檢核）
  const winterNoon = sunAt(12, SITE.winterDecl).el;
  const rackShadowNeed = RACK_DEPTH * Math.cos(RACK_TILT) + RACK_DEPTH * Math.sin(RACK_TILT) / Math.tan(winterNoon);
  const rackPitch = L.rack.zf[0] - L.rack.zf[1];
  const sawShadow = sawtoothShadowOnSlope(L.saw.rise, SAW_TILT / D2R, winterNoon), sawBare = SAW_SLOPE - L.saw.topMargin - L.saw.rows * M.L - (L.saw.rows - 1) * M.gap;
  const b = L.building, inner = [b.x0 + b.parapet.t, b.x1 - b.parapet.t, b.z0 + b.parapet.t, b.z1 - b.parapet.t];
  const edge = Math.min(...PANELS.map(p => Math.min(p.pos[0] - inner[0], inner[1] - p.pos[0], p.pos[2] - inner[2], inner[3] - p.pos[2]))) - M.L / 2;
  const T = L.tower, towerGap = Math.min(...PANELS.map(p => Math.max(T.x0 - p.pos[0], p.pos[0] - T.x1, T.z0 - p.pos[2], p.pos[2] - T.z1))) - M.L / 2;
  const invKw = L.inverters.reduce((a, v) => a + v.kw, 0);

  return {
    total, timeline: tl, apply, stationStart: tl.stationStart, curve, panels: PANELS, kwp: KWP, invKwp: INV_KWP, invKw,
    layoutChecks: () => [
      { group: '配置', name: `模組 ${PANELS.length} 片，裝置容量`, ok: true, value: `${KWP.toFixed(1)} kWp` },
      { group: '配置', name: '直流／交流容量比 1.0～1.3', ok: KWP / invKw >= 1 && KWP / invKw <= 1.3, value: (KWP / invKw).toFixed(2) },
      { group: '配置', name: '板緣距女兒牆內側 ≥ 600 mm（維修通道）', ok: edge >= 600, value: `${Math.round(edge)} mm` },
      { group: '配置', name: '板緣距塔樓 ≥ 600 mm', ok: towerGap >= 600, value: `${Math.round(towerGap)} mm` },
      { group: '遮蔭', name: '鋼架排距 ≥ 冬至正午無遮蔭所需', ok: rackPitch >= rackShadowNeed, value: `${rackPitch} ／ ${Math.round(rackShadowNeed)} mm` },
      { group: '遮蔭', name: '鋸齒屋面：冬至正午前排陰影 < 斜面下緣留空', ok: sawShadow < sawBare, value: `${Math.round(sawShadow)} ／ ${Math.round(sawBare)} mm` },
    ],
    verify: {
      skip: o => o.userData.decor === true,
      allow: [],
    },
  };
}
