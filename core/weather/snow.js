// 斜放 PV 面板上的積雪（示意模型）：降雪累積、靜摩擦判斷會不會滑、Marion 式的逐時滑落、融雪、發電損失。
// 用途是方案比較（傾角、面板表面、地點的降雪型態），不是精確預測；參數都可以改，預設值的來源寫在 README。
//
//   const r = snowOnPanels({ panels, weather, hours, dt })
//   r.panels[k] = { id, tilt, timeline: { t, swe, depth, coverage, loss, sliding }, energyLoss, hoursCovered, clearedAt, slideTilt }
//   slideCheck({ tilt, surface, swe, wet })     單一狀態會不會滑（驅動剪應力 vs 摩擦＋附著），以及臨界傾角
//   snowSampler(r, id)(t)                       任一時間（h）的 { swe, depth, coverage, loss }（線性內插）
//   createSnowCover({ width, length })          three.js：面板本地座標的積雪塊（x 沿寬、z 沿斜面往下、y 是面板法向），apply({ depth, coverage })
//
// 單位：時間 h、雪水當量 SWE mm（= kg/m²）、雪深 mm、溫度 °C、日射 W/m²（面板面 POA）、降雪 cm/h（水平地面的新雪深）、角度度。
// 模型（每個時間步 dt）：
//   1. 降雪：新雪 SWE = 降雪 × 10 × ρ_new／1000 × cos(傾角)（水平通量落在斜面上要乘 cosβ）。有降雪時整片蓋滿（coverage = 1），新舊雪平均到整片。
//   2. 密實：密度往 settledDensity 靠，時間常數 settleHours；雪深 = SWE ÷ 密度。
//   3. 融雪：ddf × max(T, 0)（度時法）＋ (1 − albedo) × POA × 3600 ÷ 334000（日射融雪，T > −5 °C 才算），單位 mm SWE/h。
//   4. 滑落：先看「濕」——Marion 等（2013，NREL）的溫度條件 T > −POA／80，或正在融雪；
//      再看力平衡：σ = SWE × g（Pa），驅動 σ sinβ > 摩擦 μ σ cosβ ＋ 附著 τ（濕的時候 μ = muWet、τ = 0；乾的時候 μ = muDry、τ = adhesion）。
//      兩個都成立時 coverage 每小時減少 slideRate × sinβ（Marion 的滑落係數 0.197；雪從下緣滑出，上方先露出）。
//   5. 損失：被蓋住的列（strings，沿斜面方向堆疊的組串數，pvlib dc_loss_nrel 的寫法）＝ ceil(coverage × strings) ÷ strings，
//      乘上雪的遮光比例 1 − exp(−雪深 ÷ transmission)（薄雪會透一點光，示意）。
import * as THREE from 'three';
import { dsin, dcos, dexp } from '../physics/collide.js';     // 決定性版本：Node 的檢查與網頁顯示的數字逐位元相同

const G = 9.81, LF = 334000, D2R = Math.PI / 180;
// 面板表面（示意值；文獻量到的雪—玻璃摩擦係數範圍很大，0.05～0.6，依溫度與雪質）
export const SURFACES = {
  glass: { label: '玻璃（PV 面板）', muDry: 0.5, muWet: 0.2, adhesion: 30 },
  metal: { label: '金屬浪板', muDry: 0.4, muWet: 0.15, adhesion: 20 },
  membrane: { label: '防水膜（PVC／TPO）', muDry: 0.55, muWet: 0.25, adhesion: 30 },
  shingle: { label: '瀝青瓦', muDry: 0.9, muWet: 0.6, adhesion: 80 },
};

// 單一狀態的力平衡：swe（mm = kg/m²）、wet（有融水膜）；回傳驅動、阻力（Pa）、會不會滑、這個 SWE 下的臨界傾角
export function slideCheck({ tilt, surface = 'glass', swe = 20, wet = true, surfaces = SURFACES }) {
  const s = typeof surface === 'object' ? surface : surfaces[surface];
  if (!s) throw new Error(`slideCheck：沒有這種表面 ${surface}`);
  const mu = wet ? s.muWet : s.muDry, tau = wet ? 0 : s.adhesion, sigma = swe * G, b = tilt * D2R;
  const drive = sigma * dsin(b), resist = mu * sigma * dcos(b) + tau;
  // 臨界傾角：sinβ − μ cosβ = τ／σ 的最小解（二分）
  let lo = 0, hi = 90;
  if (dsin(hi * D2R) - mu * dcos(hi * D2R) <= tau / Math.max(sigma, 1e-9)) lo = hi = Infinity;
  else for (let k = 0; k < 50; k++) { const m = (lo + hi) / 2; (dsin(m * D2R) - mu * dcos(m * D2R) > tau / Math.max(sigma, 1e-9) ? hi = m : lo = m); }
  return { drive, resist, slides: swe > 0 && drive > resist, criticalTilt: hi === Infinity ? null : Math.round(hi * 10) / 10, mu, adhesion: tau };
}

// 氣象輸入：函式 t => { snowfall, temp, poa }，或逐時陣列 [{ snowfall, temp, poa }]（第 k 筆代表 k ～ k + 1 小時）
const weatherFn = w => typeof w === 'function' ? w : t => w[Math.min(w.length - 1, Math.max(0, Math.floor(t)))] || { snowfall: 0, temp: 0, poa: 0 };

export function snowOnPanels(spec) {
  const dt = spec.dt ?? 0.25, hours = spec.hours ?? (Array.isArray(spec.weather) ? spec.weather.length : 48), steps = Math.round(hours / dt);
  const wx = weatherFn(spec.weather), surfaces = { ...SURFACES, ...(spec.surfaces || {}) };
  const rhoNew = spec.density ?? 120, rhoSet = spec.settledDensity ?? 300, tauSet = spec.settleHours ?? 48, slideRate = spec.slideRate ?? 0.197;
  const albedo = spec.albedo ?? 0.8, ddf = spec.ddf ?? 0.15, marionM = spec.marionM ?? -80, trans = spec.transmission ?? 10;
  const out = [];
  for (const p of spec.panels) {
    // 傾角：數字、函式 t => 度、或逐時陣列（第 k 筆是 k～k+1 小時）。追日陣列用逐時轉角，收藏策略在 snowLossSeries 組好
    const tiltAt = typeof p.tilt === 'function' ? p.tilt : Array.isArray(p.tilt) || ArrayBuffer.isView(p.tilt) ? (t => p.tilt[Math.min(p.tilt.length - 1, Math.max(0, Math.floor(t + 1e-9)))]) : (() => p.tilt);
    const tilt0 = tiltAt(0), surf = typeof p.surface === 'object' ? p.surface : surfaces[p.surface ?? 'glass'], strings = p.strings ?? 1;
    if (!surf) throw new Error(`snowOnPanels：面板 ${p.id} 的表面 ${p.surface} 不存在`);
    const T = new Float64Array(steps + 1), SWE = new Float64Array(steps + 1), DEP = new Float64Array(steps + 1), COV = new Float64Array(steps + 1), LOSS = new Float64Array(steps + 1), SL = new Uint8Array(steps + 1);
    const TL = new Float64Array(steps + 1);
    let swe = 0, rho = rhoNew, cov = 0, eSum = 0, lossSum = 0, covered = 0, clearedAt = null, everCovered = false;
    const lossOf = () => cov <= 0 || swe <= 0 ? 0 : Math.ceil(cov * strings - 1e-9) / strings * (1 - dexp(-(swe / rho * 1000) / trans));
    for (let s = 0; s <= steps; s++) {
      const t = s * dt, w = wx(t), poa = Math.max(0, w.poa ?? 0), temp = w.temp ?? 0, fall = Math.max(0, w.snowfall ?? 0);
      const tilt = Math.abs(tiltAt(t)), b = tilt * D2R; TL[s] = tilt;
      T[s] = t; SWE[s] = swe * cov; DEP[s] = cov > 0 ? swe / rho * 1000 : 0; COV[s] = cov; LOSS[s] = lossOf();
      if (s === steps) break;
      eSum += poa * dt; lossSum += poa * LOSS[s] * dt; if (cov > 0 && swe > 0) covered += dt;
      // 1. 降雪：平均到整片
      if (fall > 0) {
        const add = fall * 10 * rhoNew / 1000 * dcos(b) * dt, old = swe * cov;
        const tot = old + add; rho = tot > 0 ? (old * rho + add * rhoNew) / tot : rhoNew;
        // 密度依質量加權：舊雪密、新雪鬆
        swe = tot; cov = 1; everCovered = true;
      }
      // 2. 密實
      rho += (rhoSet - rho) * Math.min(1, dt / tauSet);
      // 3. 融雪
      const melt = cov > 0 ? (ddf * Math.max(temp, 0) + (temp > -5 ? (1 - albedo) * poa * 3600 / LF : 0)) * dt : 0;
      if (melt > 0) swe = Math.max(0, swe - melt);
      // 4. 滑落
      const wet = temp > -poa / -marionM || melt > 0;
      const chk = cov > 0 && swe > 0 ? slideCheck({ tilt, surface: surf, swe, wet }) : null;
      if (chk?.slides) { cov = Math.max(0, cov - slideRate * dsin(b) * dt); SL[s] = 1; }
      if ((swe <= 1e-6 || cov <= 1e-6) && cov + swe > 0) { swe = 0; cov = 0; rho = rhoNew; }
      if (everCovered && cov === 0 && clearedAt == null) clearedAt = t + dt;
      if (cov > 0) clearedAt = null;
    }
    const wetCrit = slideCheck({ tilt: Math.abs(tilt0), surface: surf, swe: 20, wet: true }).criticalTilt;
    out.push({ id: p.id, tilt: typeof p.tilt === 'number' ? p.tilt : null, surface: p.surface ?? 'glass', strings, timeline: { t: T, swe: SWE, depth: DEP, coverage: COV, loss: LOSS, sliding: SL, tilt: TL },
      energyLoss: eSum > 0 ? lossSum / eSum : 0, hoursCovered: covered, clearedAt, maxDepth: Math.max(...DEP), slideTilt: wetCrit });
  }
  return { dt, hours, panels: out, model: 'snow-marion-friction（示意）' };
}

/**
 * 全年發電的積雪損失（接 core/solar 的 simulate({ hourlyLoss })）：天候檔逐時 → snowOnPanels → 每筆的平均損失。
 *   weather：core/solar 的 readEPW／readCSV 結果（tempAir；降雪用 snowfall（cm/h）欄，沒有就用 snowDepth（cm）的增量，增量 ≥ threshold 才算降雪）
 *   poa：每筆的板面日射（W/m²；通常是先跑一次 simulate({ keepHourly: true }) 的 hourly.poa）
 *   tilt：傾角（度）：固定式給數字；追日給逐時陣列（例如 simulate({ keepHourly: true }) 的 hourly.theta，NaN 當 0、取絕對值）
 *   stowAngle（可省略）：追日的防雪收藏——有降雪的小時轉到這個角度，讓雪不積或滑落
 *   surface、strings（沿斜面的組串數）
 * 回傳 { loss: Float64Array（0～1）, panel（snowOnPanels 的結果：energyLoss、hoursCovered…）, snowfall }
 *   const r0 = simulate({ weather, site, system, keepHourly: true });
 *   const snow = snowLossSeries({ weather, poa: r0.hourly.poa, tilt: 25 });
 *   const r1 = simulate({ weather, site, system, hourlyLoss: snow.loss });   // r1.annual.hourlyLossKWh 是積雪損失
 */
export function snowLossSeries({ weather, poa, tilt, stowAngle = null, surface = 'glass', strings = 1, dt = 0.25, threshold = 1, ...opts }) {
  const n = poa.length, sub = Math.round(1 / dt), snowfall = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (weather.snowfall) snowfall[i] = Math.max(0, weather.snowfall[i] || 0);
    else if (weather.snowDepth && i > 0) { const d = weather.snowDepth[i] - weather.snowDepth[i - 1]; snowfall[i] = Number.isFinite(d) && d >= threshold ? d : 0; }
  }
  const temp = i => Number.isFinite(weather.tempAir?.[i]) ? weather.tempAir[i] : 0;
  // 逐時傾角：NaN（夜間收回）當 0；有 stowAngle 時，下雪的那幾小時轉到收藏角
  const hourly = typeof tilt === 'number' ? Float64Array.from({ length: n }, () => tilt) : Float64Array.from(tilt, v => Number.isFinite(v) ? Math.abs(v) : 0);
  if (stowAngle != null) for (let i = 0; i < n; i++) if (snowfall[i] > 0) hourly[i] = stowAngle;
  const r = snowOnPanels({ ...opts, hours: n, dt, weather: t => { const i = Math.min(n - 1, Math.floor(t + 1e-9)); return { snowfall: snowfall[i], temp: temp(i), poa: poa[i] || 0 }; },
    panels: [{ id: 'series', tilt: typeof tilt === 'number' && stowAngle == null ? tilt : hourly, surface, strings }] });
  const L = r.panels[0].timeline.loss, loss = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < sub; k++) s += L[i * sub + k]; loss[i] = s / sub; }
  return { loss, panel: r.panels[0], snowfall };
}

export function snowSampler(r, id) {
  const p = r.panels.find(x => x.id === id); if (!p) throw new Error(`snowSampler：沒有面板 ${id}`);
  const tl = p.timeline, n = tl.t.length;
  return t => {
    const f = Math.max(0, Math.min(n - 1, t / r.dt)), i = Math.floor(f), j = Math.min(n - 1, i + 1), u = f - i, L = a => a[i] + (a[j] - a[i]) * u;
    return { swe: L(tl.swe), depth: L(tl.depth), coverage: L(tl.coverage), loss: L(tl.loss) };
  };
}

// 面板本地座標的積雪塊：x 沿寬（置中）、z 沿斜面（0 是上緣，length 是下緣）、y 是法向（0 是玻璃面）。雪從下緣往上蓋 coverage × length
export function createSnowCover({ width = 1000, length = 2000, color = 0xf4f7fb, name = 'snow-cover' } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, -0.5);          // 原點在下緣、玻璃面
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 }));
  mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.weather = true; mesh.userData.nonSolid = '板面積雪';
  const root = new THREE.Group(); root.name = name; root.add(mesh);
  function apply({ depth = 0, coverage = 0 } = {}) {
    const on = depth > 0.5 && coverage > 1e-3;
    mesh.visible = on; if (!on) return;
    mesh.scale.set(width, depth, coverage * length); mesh.position.set(0, 0, length);
  }
  apply();
  return { root, mesh, apply, dispose() { geo.dispose(); mesh.material.dispose(); } };
}
