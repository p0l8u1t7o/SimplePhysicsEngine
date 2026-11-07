// 組串與交流線路的電壓降（示意估算）。單位：長度 m（單程）、截面 mm²、電流 A、電壓 V、溫度 °C、電阻 Ω。
//
// 導體電阻：R(T) = R20 · (1 + α·(T − 20))
//   R20：有給線材（CABLE_PV 的 r20，Ω/km，IEC 60228 第 5 類鍍錫銅最大值）就用表值，否則 ρ20 · L / A
//   ρ20：銅 1/58 Ω·mm²/m（IEC 60028 退火銅 0.017241）、鋁 0.028264（IEC 60889）；α：銅 0.00393、鋁 0.00403 /°C
// 直流（兩條導體）：ΔV = 2 · L · I · R'；單相交流：ΔV = 2 · L · I · (R' cosφ + X' sinφ)；三相：ΔV = √3 · L · I · (R' cosφ + X' sinφ)
//   X' 預設 0.08 Ω/km（示意，單芯併行敷設的量級）；交流不計集膚效應。
// 光伏線在日照下的導體溫度常到 70～90 °C，預設 T = 70（示意）。
import { size } from './sizes.js';

export const CONDUCTOR = Object.freeze({
  Cu: { rho20: 1 / 58, alpha: .00393 },
  Al: { rho20: .028264, alpha: .00403 },
});

// 每公尺電阻 Ω/m（單一導體）
export function ohmPerM({ area, T = 20, material = 'Cu', r20 = null, cable = null }) {
  const C = cable ? size(cable) : null, A = area ?? C?.area, mat = CONDUCTOR[C?.material ?? material];
  const base = (r20 ?? C?.r20) != null ? (r20 ?? C.r20) / 1000 : mat.rho20 / A;
  return base * (1 + mat.alpha * (T - 20));
}

export function dcDrop({ I, V, length, ...cond }) {
  const r = ohmPerM(cond), R = 2 * length * r, dV = I * R;
  return { R, dV, pct: V ? dV / V * 100 : null, lossW: I * I * R, rPerKm: r * 1000 };
}

export function acDrop({ I, V, length, phases = 3, pf = .95, xPerKm = .08, ...cond }) {
  const r = ohmPerM(cond), x = xPerKm / 1000, sin = Math.sqrt(Math.max(0, 1 - pf * pf));
  const k = phases === 3 ? Math.sqrt(3) : 2, dV = k * length * I * (r * pf + x * sin);
  return { dV, pct: V ? dV / V * 100 : null, lossW: (phases === 3 ? 3 : 2) * I * I * r * length, rPerKm: r * 1000 };
}

// 組串：modules 片 × vmp，電流 imp；length 單程 m（可直接給配管路徑，自動取展開長度＋預留 slack）
export function stringDrop({ modules, vmp, imp, length = null, route = null, slack = 1.05, cable = 'PV-4', T = 70, jumper = 0 }) {
  const L = (length ?? route.developed / 1000) * slack + jumper;
  const V = modules * vmp, r = dcDrop({ I: imp, V, length: L, cable, T });
  return { modules, V, I: imp, length: L, cable, T, ...r, powerW: V * imp, lossPct: r.lossW / (V * imp) * 100 };
}
