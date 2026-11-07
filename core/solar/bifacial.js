// 雙面板背面日射：2D 無限長排的視角因子模型（infinite sheds 的簡化版）。
// 假設：各排相同、無限長、地面平坦（Lambertian 反射）、天空散射等向；不含支架遮擋、板面透光與排間板面互反射
// （這兩項由呼叫端用 structureShade 係數處理，常見 5～10%）。與 pvlib.bifacial.infinite_sheds（isotropic）比對見 README。
// 2D 剖面：s 軸 = 水平、指向板面朝向（surfaceAzimuth）；y 軸往上；各排中心在 (i·pitch, height)。
import * as dm from '../math/dmath.js';
import { D2R } from './spa.js';

/**
 * @param p { tilt（度）, surfaceAzimuth（度）, zenith, azimuth（太陽，度）, ghi, dni, dhi, albedo = 0.25,
 *            gcr, height（排中心離地高）, width = 1（板寬，height 用同單位）, nGround = 120, nRear = 12, nAngles = 180,
 *            ground = 'uniform'（預設：地面取平均亮度，與 pvlib infinite_sheds 相同，已交叉驗證）| 'resolved'（地面亮度逐點、含排下陰影；背面通常再低 5～10%） }
 * @returns {{ rear, rearSky, rearGround, rearBeam, groundAvg, groundShaded, profile: Float64Array(nRear) }}
 */
export function rearIrradiance(p) {
  const { tilt, surfaceAzimuth, zenith, azimuth, dni, dhi, albedo = 0.25, gcr, height, width = 1, nGround = 120, nRear = 12, nAngles = 180, ground = 'uniform', beamOnly = false } = p;
  const pitch = width / gcr, b = tilt * D2R;
  const ux = dm.cos(b), uy = -dm.sin(b);          // 沿板寬（往前下方）
  const nfx = dm.sin(b), nfy = dm.cos(b);         // 正面法向
  // 太陽在剖面上的方向（忽略沿排方向的分量）
  const sz = dm.sin(zenith * D2R), cz = dm.cos(zenith * D2R), dsx = sz * dm.cos((azimuth - surfaceAzimuth) * D2R);
  const sunUp = zenith < 90 && cz > 0;
  const dl = dm.hypot3(dsx, cz), sdx = dsx / dl, sdy = cz / dl;
  const K = 40;   // 左右各看幾排（低太陽角時陰影很長）
  // 第 i 排的線段端點
  const seg = i => { const cx = i * pitch; return [cx + width / 2 * ux, height + width / 2 * uy, cx - width / 2 * ux, height - width / 2 * uy]; };
  // 2D 射線與線段：回傳 t（>1e-9）或 Infinity
  const raySeg = (ox, oy, dx, dy, s) => {
    const ex = s[2] - s[0], ey = s[3] - s[1], den = dx * ey - dy * ex;
    if (den === 0) return Infinity;
    const wx = s[0] - ox, wy = s[1] - oy, t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
    return t > 1e-9 && u >= 0 && u <= 1 ? t : Infinity;
  };
  const blockedByRows = (ox, oy, dx, dy, skip = null) => {
    for (let i = -K; i <= K; i++) { if (i === skip) continue; if (raySeg(ox, oy, dx, dy, seg(i)) !== Infinity) return true; }
    return false;
  };
  // 地面一個週期內各點的日射：直達（未被遮）＋天空散射（2D 視角因子，扣掉各排擋住的角度區間）
  const Eg = new Float64Array(nGround); let shaded = 0, sum = 0;
  for (let k = 0; k < (beamOnly ? 0 : nGround); k++) {
    const x = (k + 0.5) / nGround * pitch;
    let beam = 0;
    if (sunUp) { if (blockedByRows(x, 0, sdx, sdy)) shaded++; else beam = dni * cz; }
    // 各排對此點張開的角度區間（ψ 由天頂量起，往 +s 為正）
    const iv = [];
    for (let i = -K; i <= K; i++) {
      const s = seg(i), a1 = dm.atan2(s[0] - x, s[1]), a2 = dm.atan2(s[2] - x, s[3]);
      iv.push(a1 < a2 ? [a1, a2] : [a2, a1]);
    }
    iv.sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1]);
    let blocked = 0, cs = -Infinity, ce = -Infinity;
    for (const [s0, e0] of iv) {
      if (s0 > ce) { if (ce > cs) blocked += (dm.sin(ce) - dm.sin(cs)) / 2; cs = s0; ce = e0; } else if (e0 > ce) ce = e0;
    }
    if (ce > cs) blocked += (dm.sin(ce) - dm.sin(cs)) / 2;
    Eg[k] = beam + dhi * (1 - blocked);
    sum += Eg[k];
  }
  const groundAvg = beamOnly ? 0 : sum / nGround;
  if (ground === 'uniform') Eg.fill(groundAvg);
  // 背面：沿板寬取 nRear 點，背面半球分 nAngles 個角度（每格權重 = 精確的餘弦積分）
  const nrx = -nfx, nry = -nfy;
  const prof = new Float64Array(nRear); let rs = 0, rg = 0, rb = 0;
  const cosRear = sunUp ? -(nfx * sz * dm.cos((azimuth - surfaceAzimuth) * D2R) + nfy * cz) : 0;   // 3D 背面入射餘弦（水平分量沿板面朝向）
  for (let m = 0; m < nRear; m++) {
    const f = (m + 0.5) / nRear - 0.5, ox = f * width * ux + nrx * 1e-6, oy = height + f * width * uy + nry * 1e-6;
    let es = 0, eg = 0;
    for (let j = 0; j < (beamOnly ? 0 : nAngles); j++) {
      const p0 = -Math.PI / 2 + j * Math.PI / nAngles, p1 = p0 + Math.PI / nAngles, w = (dm.sin(p1) - dm.sin(p0)) / 2, ph = (p0 + p1) / 2;
      // 方向 = 背面法向旋轉 ph
      const dx = nrx * dm.cos(ph) - nry * dm.sin(ph), dy = nrx * dm.sin(ph) + nry * dm.cos(ph);
      if (blockedByRows(ox, oy, dx, dy, 0)) continue;   // 看到鄰排（不計互反射）
      if (dy < 0) {   // 打到地面
        const t = -oy / dy; let x = (ox + dx * t) % pitch; if (x < 0) x += pitch;
        const k = Math.min(nGround - 1, Math.floor(x / pitch * nGround));
        eg += w * albedo * Eg[k];
      } else es += w * dhi;
    }
    let eb = 0;
    if (cosRear > 0 && !blockedByRows(ox, oy, sdx, sdy, 0)) eb = dni * cosRear;
    prof[m] = es + eg + eb; rs += es; rg += eg; rb += eb;
  }
  return { rear: (rs + rg + rb) / nRear, rearSky: rs / nRear, rearGround: rg / nRear, rearBeam: rb / nRear, groundAvg, groundShaded: sunUp ? shaded / nGround : 1, profile: prof };
}

/**
 * 全年迴圈用的快速版（地面 'uniform'）：幾何視角因子依傾角分箱（tiltStep 度，取箱中心）快取，
 * 地面直達的未遮比例用解析式（與 pvlib _unshaded_ground_fraction 相同），背面直達只在太陽在板背面時做 2D 射線。
 * @param g { gcr, height, width = 1, tiltStep = 0.5 }
 * @returns {{ rear(p) → { rear, groundAvg }, size }}  p = { tilt, surfaceAzimuth, zenith, azimuth, dni, dhi, albedo }
 */
export function createRearModel({ gcr, height, width = 1, tiltStep = 0.5, ...opts }) {
  const cache = new Map();
  const vf = tilt => {
    const k = Math.round(tilt / tiltStep);
    let v = cache.get(k);
    if (!v) {
      const r = rearIrradiance({ ...opts, tilt: k * tiltStep, surfaceAzimuth: 180, zenith: 90, azimuth: 0, ghi: 1, dni: 0, dhi: 1, albedo: 1, gcr, height, width, ground: 'uniform' });
      v = { Gs: r.groundAvg, Fs: r.rearSky, Fg: r.groundAvg > 0 ? r.rearGround / r.groundAvg : 0 };
      cache.set(k, v);
    }
    return v;
  };
  return {
    get size() { return cache.size; },
    rear({ tilt, surfaceAzimuth, zenith, azimuth, dni, dhi, albedo = 0.25 }) {
      const v = vf(tilt), cz = dm.cos(zenith * D2R);
      let fBeam = 0;
      if (zenith <= 87 && cz > 0) {
        const tanPsi = dm.tan(zenith * D2R) * dm.cos((azimuth - surfaceAzimuth) * D2R);
        fBeam = 1 - Math.min(1, gcr * Math.abs(dm.cos(tilt * D2R) + dm.sin(tilt * D2R) * tanPsi));
      }
      const groundAvg = fBeam * dni * cz + dhi * v.Gs;
      let beam = 0;
      const cosRear = -(dm.sin(tilt * D2R) * dm.sin(zenith * D2R) * dm.cos((azimuth - surfaceAzimuth) * D2R) + dm.cos(tilt * D2R) * cz);
      if (cosRear > 0 && dni > 0 && zenith < 90) beam = rearIrradiance({ ...opts, tilt, surfaceAzimuth, zenith, azimuth, ghi: 0, dni, dhi: 0, albedo: 0, gcr, height, width, beamOnly: true }).rearBeam;
      return { rear: albedo * groundAvg * v.Fg + dhi * v.Fs + beam, groundAvg };
    },
  };
}
