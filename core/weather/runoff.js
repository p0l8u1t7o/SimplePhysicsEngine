// 面板與屋面的雨水逕流估算：流向（沿最陡下坡）、下緣的流量與水膜、集流與排乾時間（運動波）。示意等級，給排水溝與清洗規劃用。
//
//   slopeDir({ tilt, azimuth } | { normal })     最陡下坡的單位向量（three.js 世界座標，y 朝上）、坡度 S = tanβ
//   runoff({ tilt, azimuth, length, width, intensity, n, C })
//     → { dir, S, area, Q（L/s，下緣總流量）, q（每 m 寬，L/s/m）, depth（下緣水膜，mm）, velocity（m/s）, tc（集流時間，s）, drain（雨停後排乾，s）, warnings }
//   panelRunoff(panels, intensity)              多片的總流量與最長集流時間（片與片之間沒有接力；一排面板串接時把 length 加總當一片）
//
// 單位：長度 mm（length、width）、降雨強度 mm/h、流量 L/s、時間 s、角度度。azimuth：面板朝向（下坡方向）的方位角，0 = +z（南向站點慣例由專案決定）、90 = +x。
// 公式：
//   流量（合理化公式）Q = C × i × A ÷ 3600（i mm/h、A m² → L/s）；
//   寬淺水膜的 Manning 式 q = (1／n) y^(5/3) S^(1/2) → 下緣水深 y = (q n ／ √S)^(3/5)，流速 = q ／ y；
//   集流時間（運動波，Ragan & Duru 1972 SI 形式）tc = 6.99 (n L)^0.6 ／ (i^0.4 S^0.3) 分鐘（L m、i mm/h）；雨停後的排乾時間取同量級（示意）。
//   n（Manning 粗糙係數）：玻璃 0.010、金屬板 0.012、防水膜 0.013、髒污的面板 0.015。C（逕流係數）：不透水面 0.95。
const D2R = Math.PI / 180;

export function slopeDir({ tilt = 0, azimuth = 0, normal } = {}) {
  let n = normal;
  if (!n) { const b = tilt * D2R, a = azimuth * D2R; n = [Math.sin(b) * Math.sin(a), Math.cos(b), Math.sin(b) * Math.cos(a)]; }   // 法向往下坡那一側傾
  const l = Math.hypot(...n); n = n.map(x => x / l);
  // 重力 (0, −1, 0) 去掉法向分量
  const gn = -n[1], d = [-gn * n[0], -1 - gn * n[1], -gn * n[2]], dl = Math.hypot(...d);      // d = g − (g·n) n
  const cosb = Math.abs(n[1]), S = Math.sqrt(Math.max(0, 1 - cosb * cosb)) / Math.max(cosb, 1e-9);
  return { dir: dl < 1e-9 ? [0, 0, 0] : d.map(x => x / dl), S, tilt: Math.acos(Math.min(1, cosb)) / D2R };
}

export function runoff({ tilt = 15, azimuth = 0, normal, length = 2000, width = 1000, intensity = 30, n = 0.010, C = 0.95 } = {}) {
  const { dir, S: S0, tilt: beta } = slopeDir({ tilt, azimuth, normal }), warnings = [];
  if (beta < 5) warnings.push(`傾角 ${beta.toFixed(1)}° < 5°：雨水自清效果差，下緣邊框容易積水、積灰（示意門檻）`);
  const S = Math.max(S0, 1e-3), L = length / 1000, B = width / 1000, area = L * B * 1;              // 斜面面積（雨量以水平投影計，見下）
  const Ah = area * Math.cos(beta * D2R);                                                       // 水平投影面積：降雨量是對水平面量的
  const Q = C * intensity * Ah / 3600, q = Q / B / 1000;                                           // L/s；q 換成 m²/s（每 m 寬）
  const y = (q * n / Math.sqrt(S)) ** 0.6, vel = y > 0 ? q / y : 0;
  const tc = intensity > 0 ? 6.99 * (n * L) ** 0.6 / (intensity ** 0.4 * S ** 0.3) * 60 : Infinity;
  return { dir, S: Math.round(S0 * 1e4) / 1e4, tilt: beta, area: Math.round(area * 1000) / 1000, Q: Math.round(Q * 1e4) / 1e4, q: Math.round(Q / B * 1e4) / 1e4,
    depth: Math.round(y * 1e3 * 1000) / 1000, velocity: Math.round(vel * 1000) / 1000, tc: Math.round(tc * 10) / 10, drain: Math.round(tc * 10) / 10,
    unit: { Q: 'L/s', q: 'L/s/m', depth: 'mm', velocity: 'm/s', tc: 's' }, estimate: true, warnings };
}

export function panelRunoff(panels, intensity = 30) {
  const rows = panels.map(p => ({ id: p.id, ...runoff({ ...p, intensity }) }));
  return { rows, Q: Math.round(rows.reduce((a, r) => a + r.Q, 0) * 1e4) / 1e4, tc: Math.max(...rows.map(r => r.tc)), warnings: rows.flatMap(r => r.warnings.map(w => `${r.id}：${w}`)) };
}
