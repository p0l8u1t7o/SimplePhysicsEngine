// 風、雪載重「估算」（示意）：給評估階段抓量級用，不是規範檢核，也不代表符合任何國家的建築或結構規範。
// 正式設計要由結構技師依案場所在地的規範（台灣：建築物耐風設計規範、建築物基礎構造設計規範等）計算，
// 並考慮地況、高度、地形放大、陣風反應、列與列的遮蔽、追日支架的動態不穩定（扭轉顫振、渦振）與載重組合。
//
// 單位：風速 m/s、壓力 Pa（另給 kN/m²）、雪載 kN/m²、面積 m²、力 kN。
//
// 風：q = ½·ρ·V²·ce（ce 為使用者給的暴露／陣風放大係數，預設 1，這裡不推算地況）；
//     板面淨壓 p = q·cf，cf 取 EN 1991-1-4:2005 表 7.6 單坡雨庇（下方淨空、阻塞 φ = 0）整體力係數（示意，使用前請對照原表）。
// 雪：EN 1991-1-3:2003 單坡屋頂形狀係數 μ1（0～30° 為 0.8，30～60° 線性降到 0，≥ 60° 為 0）；
//     s = μ1·Ce·Ct·sk（水平投影面），換到板面：每 m² 板面的垂直力 s·cosα，法向分量 s·cos²α、沿板面分量 s·sinα·cosα。
export const ESTIMATE = '估算（示意），非規範檢核';
export const RHO_AIR = 1.225;      // kg/m³，15 °C 海平面

// EN 1991-1-4 表 7.6（φ = 0）：傾角 α → [正壓 cf, 負壓（上揚）cf]（示意）
export const CF_MONOSLOPE = [
  [0, .2, -.5], [5, .4, -.7], [10, .5, -.9], [15, .7, -1.0], [20, .8, -1.1], [25, 1.0, -1.2], [30, 1.2, -1.3],
];
export function cfMonoslope(tiltDeg) {
  const a = Math.min(30, Math.abs(tiltDeg)), T = CF_MONOSLOPE;
  for (let i = 0; i < T.length - 1; i++) if (a <= T[i + 1][0]) {
    const t = (a - T[i][0]) / (T[i + 1][0] - T[i][0]);
    return { down: T[i][1] + t * (T[i + 1][1] - T[i][1]), up: T[i][2] + t * (T[i + 1][2] - T[i][2]), clipped: Math.abs(tiltDeg) > 30 };
  }
  return { down: T.at(-1)[1], up: T.at(-1)[2], clipped: Math.abs(tiltDeg) > 30 };
}

export function windPressure({ V, tilt, ce = 1, rho = RHO_AIR, cf = null }) {
  const q = .5 * rho * V * V * ce, c = cf ?? cfMonoslope(tilt);
  return { note: ESTIMATE, q, qKN: q / 1000, cfDown: c.down, cfUp: c.up, down: q * c.down, up: q * c.up, clipped: !!c.clipped };
}

export function snowMu1(tiltDeg) {
  const a = Math.abs(tiltDeg);
  return a <= 30 ? .8 : a >= 60 ? 0 : .8 * (60 - a) / 30;
}
export function snowOnPlane({ sk, tilt, Ce = 1, Ct = 1 }) {
  const mu = snowMu1(tilt), s = mu * Ce * Ct * sk, c = Math.cos(tilt * Math.PI / 180), si = Math.sin(tilt * Math.PI / 180);
  return { note: ESTIMATE, mu, s, perPlane: s * c, normal: s * c * c, parallel: s * si * c };
}

// 一張桌（固定式）或一列（追日）的載重量級：layout 是 layoutFixedRack／layoutTracker 的結果
//   site: { V（基本風速 m/s）, ce, sk（地面雪載 kN/m²）, Ce, Ct, stowAngle（追日收折角，度，預設 maxAngle）}
// 回傳每張桌：面積、自重（模組＋鋼材）、風下壓／上揚合力、雪、每支樁平均反力（自重＋雪、自重＋上揚，未加分項係數）
export function groupLoads(layout, site = {}) {
  const g = 9.80665, P = layout.params, M = P.module, modArea = M.L * M.W / 1e6;
  const tilt = layout.kind === 'fixed' ? P.tilt : (site.stowAngle ?? P.maxAngle);
  const w = site.V ? windPressure({ V: site.V, tilt, ce: site.ce ?? 1 }) : null;
  const sn = site.sk ? snowOnPlane({ sk: site.sk, tilt: layout.kind === 'fixed' ? P.tilt : 0, Ce: site.Ce, Ct: site.Ct }) : null;
  const groups = new Map();
  const key = layout.kind === 'fixed' ? m => m.table : m => m.row;
  for (const m of layout.modules) { const k = key(m); const o = groups.get(k) ?? { id: k, modules: 0, steelKg: 0, piles: 0 }; o.modules++; groups.set(k, o); }
  for (const m of layout.members) {
    const k = layout.kind === 'fixed' ? m.table : `R${m.row + 1}`, o = groups.get(k); if (!o) continue;
    o.steelKg += m.kg; if (m.kind === 'pile') o.piles++;
  }
  const rows = [...groups.values()].map(o => {
    const area = o.modules * modArea, dead = (o.modules * M.kg + o.steelKg) * g / 1000;
    const down = w ? w.down * area / 1000 : 0, up = w ? w.up * area / 1000 : 0;   // 法向，kN（上揚為負）
    const snow = sn ? sn.perPlane * area : 0;                                        // 垂直，kN
    const cosT = Math.cos(tilt * Math.PI / 180);
    return {
      id: o.id, area: Math.round(area * 100) / 100, deadKN: r2(dead), windDownKN: r2(down), windUpKN: r2(up), snowKN: r2(snow), piles: o.piles,
      perPile: {
        deadSnow: r2((dead + snow) / o.piles),
        deadWindDown: r2((dead + down * cosT) / o.piles),
        netUplift: r2((dead + up * cosT) / o.piles),          // 負值＝樁要抗拔
      },
    };
  });
  return { note: ESTIMATE + '；反力為平均分配、未加分項係數與載重組合，只看量級', tilt, wind: w, snow: sn, groups: rows };
}
const r2 = v => Math.round(v * 100) / 100;
