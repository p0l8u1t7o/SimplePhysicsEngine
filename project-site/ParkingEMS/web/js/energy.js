// 全天 EMS 調度模型（示意）：每 15 分鐘一步，連續模擬 4 天、取已進入穩態的第 3 天顯示。
// 規則照提案第 10、11 頁：
//   離峰：夜泊 AC 直接用離峰電（不經儲能），剩餘契約容量再補儲能到目標 SOC；
//   白天：光電優先供負載，剩餘先充儲能、再輸出（旗艦型）；
//   半尖峰／尖峰：儲能削峰，市電取電超過門檻的部分由儲能補；
//   儲能功率不足或 SOC 偏低時，依公告規則降低充電功率（不承諾所有車位同時滿載）。
// 時段、費率、充電需求與設備容量都是假設，只示意調度邏輯，不代表台電現行方案或投資報價。
import { SITES } from './sites.js';

export const DT = .25;                 // h
export const STEPS = 24 / DT;          // 96
export const ETA = Math.sqrt(.9);      // 往返效率 90%（提案第 18 頁）→ 充、放各 √0.9
export const SOC_MAX = .95;
export const periodOf = h => { h = ((h % 24) + 24) % 24; return h < 9 || h >= 22 ? 'off' : h < 16 ? 'half' : 'peak'; };
export const PERIOD_NAME = { off: '離峰', half: '半尖峰', peak: '尖峰' };
export const PERIOD_BANDS = [[0, 9, 'off'], [9, 16, 'half'], [16, 22, 'peak'], [22, 24, 'off']];
// 各場型在尖峰時把市電取電壓到契約容量的這個比例以下（其餘由儲能補，SOC 夠才補）
const SHAVE_PEAK = { flagship: .25, mixed: .15, urban: .6 };

// ---------------------------------------------------------------- 充電需求（假設；每天重複）
// ch：充電樁；a／d：到場與離場時刻（h，超過 24 表示隔天）；kwh：需求電量；
// start：智慧排程最早開始時刻（夜泊住戶排到 22:00 離峰）；hero：客戶情境示範的那一台
const S = (ch, a, d, kwh, o = {}) => ({ ch, a, d, kwh, ...o });
export const SESSIONS = {
  flagship: [
    S('AC1', 7.5, 17.5, 22), S('AC1', 18.5, 22, 10),
    S('AC2', 8, 18, 25),
    S('AC3', 9, 12.5, 12), S('AC3', 13, 17, 15), S('AC3', 19, 21.5, 9),
    S('AC4', 7.8, 17, 20),
    S('AC5', 10, 14, 14), S('AC5', 15, 19, 14),
    S('AC6', 8.5, 18.2, 24),
    S('AC7', 11, 15.5, 16), S('AC7', 17, 21, 12),
    S('AC8', 9.5, 17.5, 18),
    S('DC1', 7.5, 8.1, 28), S('DC1', 9, 9.6, 26), S('DC1', 11.2, 11.8, 30), S('DC1', 13, 13.5, 22), S('DC1', 16.4, 17, 30),
    S('DC1', 17.6, 18.2, 32), S('DC1', 19, 19.6, 28), S('DC1', 20.5, 21, 24),
    S('DC2', 8.3, 8.9, 25), S('DC2', 10.4, 11, 27), S('DC2', 13.9, 14.65, 34, { hero: true }), S('DC2', 16.8, 17.4, 30),
    S('DC2', 18, 18.6, 28), S('DC2', 19.4, 20, 26), S('DC2', 21.2, 21.7, 22),
  ],
  mixed: [
    // 夜泊住戶：排程到 22:00 離峰直充；AC7、AC10 是急需補電、到場就充
    // EMS 依離場時間錯開開始時刻，避免 22:00 同時起充超過契約容量
    S('AC1', 18.2, 31, 18, { start: 22 }), S('AC2', 19, 30.5, 22, { start: 22 }), S('AC3', 18.6, 32, 15, { start: 23.5 }),
    S('AC4', 20.1, 31.5, 20, { start: 22.5 }), S('AC5', 19, 31.5, 20, { start: 22, hero: true }), S('AC6', 21, 30.8, 12, { start: 23 }),
    S('AC7', 18.8, 32.2, 24), S('AC8', 19.6, 31.2, 16, { start: 22.5 }), S('AC9', 20.5, 30.2, 14, { start: 23 }), S('AC10', 18.4, 31.8, 18),
    // 日間購物、洽公（AC 為主）
    S('AC1', 9.2, 11.8, 8), S('AC1', 12.5, 15.2, 9), S('AC2', 10, 12.6, 8), S('AC2', 14.2, 17.4, 10), S('AC3', 9.6, 12.2, 7), S('AC3', 13.4, 16.6, 9),
    S('AC4', 10.8, 13.4, 8), S('AC4', 15, 17.6, 9), S('AC5', 9, 11.4, 7), S('AC5', 12.4, 15.6, 10), S('AC5', 16.2, 18.4, 7), S('AC6', 11.2, 14.4, 9),
    S('AC6', 15.6, 18.6, 9), S('AC7', 9.8, 12.8, 9), S('AC7', 13.6, 16.8, 9), S('AC8', 10.4, 13, 8), S('AC8', 14, 17.2, 10), S('AC9', 11.6, 14.2, 8),
    S('AC9', 15.2, 18, 9), S('AC10', 9.4, 12, 7), S('AC10', 12.8, 16, 10),
  ],
  urban: [
    S('DC1', 7.2, 7.7, 20), S('DC1', 8.5, 9, 22), S('DC1', 10, 10.5, 18), S('DC1', 12.1, 12.6, 20), S('DC1', 13.5, 14, 18), S('DC1', 15.2, 15.7, 22),
    S('DC1', 17, 17.5, 25), S('DC1', 18, 18.6, 28), S('DC1', 19.1, 19.6, 25), S('DC1', 20.2, 20.8, 26), S('DC1', 21.5, 22, 20),
    S('DC2', 7.8, 8.3, 18), S('DC2', 9.4, 9.9, 20), S('DC2', 11.3, 11.8, 22), S('DC2', 12.9, 13.4, 18), S('DC2', 14.6, 15.1, 20), S('DC2', 16.3, 16.9, 22),
    S('DC2', 17.6, 18.25, 26, { hero: true }), S('DC2', 18.7, 19.3, 25), S('DC2', 19.7, 20.3, 28), S('DC2', 20.8, 21.3, 22), S('DC2', 22.2, 22.7, 18),
    S('AC1', 8.5, 18, 20), S('AC2', 9, 17.5, 18),
    S('DC3', 8, 8.5, 20, { expand: true }), S('DC3', 11.8, 12.3, 18, { expand: true }), S('DC3', 16.6, 17.1, 22, { expand: true }),
    S('DC3', 18.2, 18.8, 26, { expand: true }), S('DC3', 19.6, 20.2, 24, { expand: true }), S('DC3', 21, 21.5, 20, { expand: true }),
  ],
};

// 晴天光電出力（kW）：6～18 點，午間少量雲遮（示意）
export function pvAt(kwp, h) {
  h = ((h % 24) + 24) % 24;
  if (!kwp || h <= 6 || h >= 18) return 0;
  const s = Math.sin(Math.PI * (h - 6) / 12) ** 1.3;
  const cloud = 1 - .18 * Math.exp(-(((h - 13.3) / .35) ** 2)) - .1 * Math.exp(-(((h - 15.4) / .25) ** 2));
  return kwp * .8 * s * cloud;
}
const baseAt = (site, h) => { h = ((h % 24) + 24) % 24; return site.base + (h < 6 || h >= 18 ? 1.5 : 0); };   // 營運基載＋夜間照明

export function simulate(siteId, { expanded = false } = {}) {
  const site = SITES[siteId];
  const bess = site.bess.filter(b => expanded || !b.expand), P = bess.reduce((s, b) => s + b.kw, 0), E = bess.reduce((s, b) => s + b.kwh, 0);
  const chargers = site.chargers.filter(c => expanded || !c.expand), kwOf = Object.fromEntries(chargers.map(c => [c.id, c.kw]));
  const DAYS = 4, base = SESSIONS[siteId].filter(s => kwOf[s.ch] && (expanded || !s.expand));
  // 每天重複：第 d 天的場次時間加 24·d
  const inst = [];
  for (let d = 0; d < DAYS; d++) base.forEach((s, i) => inst.push({ ...s, id: i, day: d, A: s.a + 24 * d, D: s.d + 24 * d, S: (s.start != null ? (s.start < s.a ? s.start + 24 : s.start) : s.a) + 24 * d, got: 0, log: [] }));
  const kwp = site.pv?.kwp || 0, contract = expanded && site.contractExpanded || site.contract, target = site.socTarget, socMin = site.socMin;
  // 需求電量不超過「功率 × 可充時間」的 92%（短停留的 DC 場次）
  for (const s of inst) s.kwh = Math.min(s.kwh, kwOf[s.ch] * (s.D - Math.max(s.A, s.S)) * .92);
  const rows = [];
  let soc = .5;
  for (let k = 0; k < DAYS * STEPS; k++) {
    const H = k * DT, h = H % 24, period = periodOf(h);
    // 這一步內實際可充電的時段 [c0, c1]（到場、排程開始、離場不必落在 15 分鐘格點上）
    const act = inst.filter(s => s.A < H + DT - 1e-9 && H < s.D - 1e-9);
    for (const s of act) {
      s.c0 = Math.max(H, s.A, s.S); s.c1 = Math.min(H + DT, s.D); s.ov = Math.max(0, s.c1 - s.c0) / DT;
      s.req = s.ov > 0 && s.got < s.kwh - 1e-6 ? Math.min(kwOf[s.ch], (s.kwh - s.got) / (DT * s.ov)) : 0;
    }
    const evReq = act.reduce((x, s) => x + s.req * s.ov, 0), pv = pvAt(kwp, h), bl = baseAt(site, h);
    const net = evReq + bl - pv;
    const room = Math.max(0, (SOC_MAX - soc) * E / ETA / DT), avail = Math.max(0, (soc - socMin) * E * ETA / DT);
    let chg = 0, dis = 0, chgPv = 0;
    if (net < 0) chg = chgPv = Math.min(P, -net, room);                                // 光電剩餘先充儲能
    if (period === 'off') {
      const want = soc < target ? Math.min(P, (target - soc) * E / ETA / DT) : 0;
      chg = Math.max(chg, Math.min(want, room, Math.max(0, contract - Math.max(net, 0))));   // 契約容量先給夜泊直充，剩的才補儲能
    } else {
      const cap = (period === 'peak' ? SHAVE_PEAK[siteId] : site.shaveHalf) * contract;
      if (net > cap) dis = Math.min(P, net - cap, avail);
    }
    let grid = net + chg - dis, scale = 1, limited = false;
    if (grid > contract) {                                                             // 超過契約容量：先多放電、再少充、最後限 EV 功率
      const more = Math.min(P - dis, avail - dis, grid - contract); if (more > 0) { dis += more; grid -= more; }
      if (grid > contract && chg > chgPv) { const cut = Math.min(chg - chgPv, grid - contract); chg -= cut; grid -= cut; }
      if (grid > contract && evReq > 0) { const ev = Math.max(0, evReq - (grid - contract)); scale = ev / evReq; grid = contract; limited = true; }
    }
    if (chg > 0 && dis > 0) { const m = Math.min(chg, dis); chg -= m; dis -= m; chgPv = Math.min(chgPv, chg); }
    for (const s of act) { s.p = s.req * scale; s.got += s.p * DT * s.ov; s.log.push([k, s.p, s.got, s.c0, s.c1]); }
    const ev = evReq * scale;
    const pvToLoad = Math.min(pv, ev + bl), pvToBess = Math.min(chgPv, Math.max(0, pv - pvToLoad)), pvOut = Math.max(0, pv - pvToLoad - pvToBess);
    rows.push({ k, h, period, pv, base: bl, evReq, ev, chg, chgPv: pvToBess, chgGrid: chg - pvToBess, dis, grid, export: pvOut, soc, limited,
      perCharger: Object.fromEntries(chargers.map(c => [c.id, act.filter(s => s.ch === c.id).reduce((x, s) => x + s.p * s.ov, 0)])) });
    soc = Math.min(SOC_MAX, Math.max(0, soc + (chg * ETA - dis / ETA) * DT / E));
  }
  // 第 3 天（index 2）起連續兩天（住商型的夜泊情境會跨到隔天早上）
  const day = rows.slice(2 * STEPS, 4 * STEPS).map(r => ({ ...r, h: r.k * DT - 48 }));
  const sum = f => day.slice(0, STEPS).reduce((s, r) => s + f(r) * DT, 0);
  const peakNoBess = Math.max(...day.slice(0, STEPS).map(r => r.evReq + r.base - r.pv));
  const gridKwh = sum(r => Math.max(0, r.grid)), offKwh = sum(r => r.period === 'off' ? Math.max(0, r.grid) : 0);
  const kpi = {
    ev: sum(r => r.ev), evReq: sum(r => r.evReq), pv: sum(r => r.pv), pvExport: sum(r => r.export), bessIn: sum(r => r.chg), bessOut: sum(r => r.dis),
    grid: gridKwh, offShare: gridKwh ? offKwh / gridKwh : 0, peakGrid: Math.max(...day.slice(0, STEPS).map(r => r.grid)), peakNoBess,
    limitHours: day.slice(0, STEPS).filter(r => r.limited).length * DT, sessions: base.length, cycles: E ? sum(r => r.dis) / E : 0,
    socRange: [Math.min(...day.slice(0, STEPS).map(r => r.soc)), Math.max(...day.slice(0, STEPS).map(r => r.soc))],
    unmet: inst.filter(s => s.day === 2).reduce((x, s) => x + Math.max(0, s.kwh - s.got), 0),
  };
  kpi.pvSelf = kpi.pv ? 1 - kpi.pvExport / kpi.pv : 0;
  // 第 3 天能看到的場次：前一天跨夜的（day 1）與當天的（day 2），時間換算到第 3 天的 0～24 h
  const visible = inst.filter(s => (s.day === 1 && s.D > 48) || s.day === 2).map(s => ({ ...s, a: s.A - 48, d: s.D - 48, start: s.S - 48 }));
  const at = h => {
    const f = Math.max(0, Math.min(2 * STEPS - 1, h / DT)), i = Math.min(2 * STEPS - 2, Math.floor(f)), u = f - i, a = day[i], b = day[i + 1];
    const out = { h, period: periodOf(h), limited: a.limited };
    for (const key of ['pv', 'base', 'evReq', 'ev', 'chg', 'chgPv', 'chgGrid', 'dis', 'grid', 'export', 'soc']) out[key] = a[key] + (b[key] - a[key]) * u;
    out.perCharger = Object.fromEntries(Object.keys(a.perCharger).map(id => [id, a.perCharger[id] + (b.perCharger[id] - a.perCharger[id]) * u]));
    return out;
  };
  // 某時刻（第 3 天的 h）每支充電樁上的場次：{ s, frac（已充電量比例）, p（kW） }
  const sessionAt = h => {
    const out = {};
    for (const s of visible) if (s.a <= h && h < s.d) {
      const H = h + 48, rec = s.log.filter(([k]) => k * DT <= H + 1e-9).at(-1);
      const got = rec ? rec[2] - rec[1] * (rec[4] - rec[3]) + rec[1] * Math.max(0, Math.min(rec[4], H) - rec[3]) : 0;
      out[s.ch] = { s, got: Math.max(0, got), frac: Math.min(1, Math.max(0, got) / s.kwh), p: rec && H >= rec[3] - 1e-9 && H < rec[4] ? rec[1] : 0 };
    }
    return out;
  };
  return { site: siteId, P, E, contract, kwp, day, at, sessionAt, kpi, sessions: visible, expanded };
}
