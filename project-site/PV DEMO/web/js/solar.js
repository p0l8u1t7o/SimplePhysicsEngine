// 日照與發電模型（純函式，網頁、core 統一檢查與 tools/verify.mjs 共用）。
// 座標：X 往東、Y 往上、Z 往南；時間用真太陽時（12:00 太陽在正南）。
// 初步模型：晴空直達日射用 Meinel 大氣衰減，散射取直達的固定比例；不含溫度、灰塵與逐片失配，綜合損失併入 PR。
export const D2R = Math.PI / 180;
export const SITE = {
  lat: 23,                 // 北緯（台灣中南部的概略值）
  decl: 0,                 // 太陽赤緯：0 = 春分（日出約 6:00、日落約 18:00）
  winterDecl: -23.44,      // 冬至赤緯（排距與前排遮蔭的檢核用）
};

// 太陽位置：回傳高度角 el、方位角 az（由北順時針，rad）與指向太陽的單位向量 dir
export function sunAt(hour, decl = SITE.decl, lat = SITE.lat) {
  const H = (hour - 12) * 15 * D2R, d = decl * D2R, p = lat * D2R;
  const sinEl = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H), el = Math.asin(sinEl);
  // 方位角：東 = 90°、南 = 180°、西 = 270°
  const cosAz = (Math.sin(d) - sinEl * Math.sin(p)) / (Math.cos(el) * Math.cos(p));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))); if (H > 0) az = 2 * Math.PI - az;
  const dir = [Math.cos(el) * Math.sin(az), sinEl, -Math.cos(el) * Math.cos(az)];
  return { el, az, dir };
}

// 晴空日射（W/m²）：直達法線 DNI 與水平散射 DHI
export function clearSky(el) {
  if (el <= 0) return { dni: 0, dhi: 0 };
  const am = 1 / Math.max(Math.sin(el), .035);
  const dni = 1353 * Math.pow(.7, Math.pow(am, .678));
  return { dni, dhi: .1 * dni + 8 * Math.sin(el) };
}

// 斜面日射（W/m²）：normal 為板面法向單位向量；shade 0～1 是直達光被遮的比例（雲影、建物陰影）
export function poa(normal, sun, shade = 0) {
  const { dni, dhi } = clearSky(sun.el), d = sun.dir;
  const cosI = Math.max(0, normal[0] * d[0] + normal[1] * d[1] + normal[2] * d[2]);
  const sky = (1 + normal[1]) / 2;                  // 天空視角因子（等向散射）
  return dni * cosI * (1 - shade) + dhi * sky * (1 - .4 * shade);
}

// 傾角 tilt（度）、面向正南的板面法向
export const southNormal = tilt => [0, Math.cos(tilt * D2R), Math.sin(tilt * D2R)];

// 射線對軸對齊方塊（AABB）：從 p 沿 dir 出發是否被擋；box = [[x0,y0,z0],[x1,y1,z1]]
export function rayHitsBox(p, dir, box) {
  let t0 = 1e-3, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / dir[k];
    let a = (box[0][k] - p[k]) * inv, b = (box[1][k] - p[k]) * inv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t1 < t0) return false;
  }
  return true;
}

// 雲影中心：雲在高度 cloudY、水平位置 (cx, cz)，沿太陽方向投到高度 y 的平面
export function cloudShadowAt(cloud, sun, y) {
  const k = (cloud.y - y) / Math.max(sun.dir[1], .05);
  return [cloud.x - sun.dir[0] * k, cloud.z - sun.dir[2] * k];
}

// 鋸齒屋面前排陰影：前一排屋脊（高 rise）在正午沿坡面投下的陰影長度（坡面距離，mm）
export function sawtoothShadowOnSlope(rise, slopeTilt, sunEl) {
  const d = rise / (Math.tan(sunEl) + Math.tan(slopeTilt * D2R));   // 水平距離
  return d / Math.cos(slopeTilt * D2R);
}
