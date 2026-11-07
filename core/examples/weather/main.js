// 天候範例（core/weather＋core/solar）：
//   大雪後放晴：降雪累積 → 夜間低溫 → 白天日射融雪、濕雪滑落；10° 與 35° 兩組比較積雪、覆蓋、發電損失與放晴時間。
//   午後雷雨：雨絲畫面、板面逕流（流量、水膜、集流時間）。
// 板面日射（POA）由 core/solar 算：SPA 太陽位置＋Ineichen 晴空＋Perez 斜面散射（下雪時改成陰天的散射）。
// 座標：X 往東、Y 往上、Z 往南，mm（core/solar 的慣例）；面板朝南。網址 ?sc=snow&h=40 指定情境與時間（小時）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as solar from '@core/solar/index.js';
import { snowOnPanels, snowSampler, createSnowCover } from '@core/weather/snow.js';
import { createPrecipView } from '@core/weather/precip.js';
import { snowLoad, velocityPressure, panelWindLoad } from '@core/weather/loads.js';
import { runoff } from '@core/weather/runoff.js';

const $ = id => document.getElementById(id), qp = new URLSearchParams(location.search);
const SITE = { lat: 43.06, lon: 141.35, elevation: 20, deltaT: 69.2, tz: 9 };
const MOD = { width: 1134, length: 2278 }, GAP = 20, PER = 6, UP = 2;               // 每台：寬向 6 片、沿斜面 2 片（直放）
const W = PER * MOD.width + (PER - 1) * GAP, L = UP * MOD.length + GAP, FRONT = 700;   // 台寬、斜面長、下緣離地（mm）
const GROUPS = [{ id: '10°', tilt: 10, x: -5200 }, { id: '35°', tilt: 35, x: 5200 }], ROWS = [0, 9000, 18000];
const EFF = 0.21, D2R = Math.PI / 180;
const fmtH = h => { const d = Math.floor(h / 24), r = h - d * 24, hh = Math.floor(r + 1e-9), mm = Math.round((r - hh) * 60) % 60; return { d, hh, mm, s: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` }; };

// ---------------------------------------------------------------- 情境
// 時間 h 從情境起點算（小時）；回傳 { snowfall（cm/h）, rain（mm/h）, temp（°C）, cloud（0 晴～1 陰）, month, day, hour, minute }
const SCENARIOS = {
  snow: {
    hours: 72, start: [1, 14, 0],
    at(h) {
      const tday = h % 24, day = Math.floor(h / 24);
      const snowing = h >= 4 && h < 16, cloud = h < 17 ? 1 : 0;
      const temp = h < 16 ? -3 : [-4, -4, -2][day] + 5 * Math.cos(2 * Math.PI * (tday - 14) / 24) - (h < 24 ? 3 : 0);
      return { snowfall: snowing ? 2.5 : 0, rain: 0, temp, cloud };
    },
  },
  rain: {
    hours: 4, start: [7, 15, 12],
    at(h) {
      const r = h < 1.5 || h > 3.2 ? 0 : h < 2 ? 50 * (h - 1.5) / 0.5 : h < 2.7 ? 50 : 50 * (3.2 - h) / 0.5;
      return { snowfall: 0, rain: r, temp: 29, cloud: h > 1.2 && h < 3.5 ? 1 : 0.2 };
    },
  },
};
function sunAt(sc, h) {
  const S = SCENARIOS[sc], [mo, da, h0] = S.start, abs = h0 + h, d = Math.floor(abs / 24), r = abs - d * 24, hh = Math.floor(r + 1e-9), mm = Math.round((r - hh) * 60) % 60;
  const u = solar.unixFromLocal(2026, mo, da + d, hh, mm, 0, SITE.tz);
  return solar.solarPosition(u, SITE);
}
// 板面日射：晴空 × (1 − 雲) 的直達＋Perez 散射，陰天只留散射（晴空 GHI 的 25%，各向同性）
function poaAt(sc, h, tilt) {
  const sp = sunAt(sc, h), w = SCENARIOS[sc].at(h);
  if (sp.apparentElevation <= 0) return { poa: 0, ghi: 0, sp };
  const z = sp.apparentZenith, cs = solar.clearSky(z, { altitude: SITE.elevation });
  const cosI = Math.max(0, solar.aoiProjection(tilt, 180, z, sp.azimuth)), am = solar.relativeAirmass(z);
  const clear = cs.dni * cosI + (solar.perez(tilt, 180, cs.dhi, cs.dni, 1361, z, sp.azimuth, am).total || 0) + cs.ghi * 0.6 * (1 - Math.cos(tilt * D2R)) / 2;
  const over = 0.25 * cs.ghi * (1 + Math.cos(tilt * D2R)) / 2;
  return { poa: clear * (1 - w.cloud) + over * w.cloud, ghi: cs.ghi * (1 - 0.75 * w.cloud), sp };
}

// 積雪模擬：每組（含地面 0°）各跑一次，因為板面日射依傾角不同。結果是決定性的（core/weather 與 core/solar 都用 dmath）
const SIM = {};
for (const sc of Object.keys(SCENARIOS)) {
  const S = SCENARIOS[sc], panels = [...GROUPS, { id: '地面', tilt: 0 }], res = {};
  for (const g of panels) {
    const r = snowOnPanels({ hours: S.hours, dt: 0.25, weather: t => ({ ...S.at(t), poa: g.tilt ? poaAt(sc, t, g.tilt).poa : poaAt(sc, t, 0).ghi }),
      panels: [{ id: g.id, tilt: g.tilt, surface: g.tilt ? 'glass' : 'membrane', strings: UP }] });
    // 72 小時發電（示意）：Σ POA × (1 − 損失) × 面積 × 效率
    const tl = r.panels[0].timeline; let e0 = 0, e1 = 0;
    for (let i = 0; i + 1 < tl.t.length; i++) { const p = poaAt(sc, tl.t[i], g.tilt).poa; e0 += p * 0.25; e1 += p * (1 - tl.loss[i]) * 0.25; }
    const area = W * L / 1e6;
    res[g.id] = { r, p: r.panels[0], sample: snowSampler(r, g.id), kWh: e0 * area * EFF / 1000, kWhSnow: e1 * area * EFF / 1000 };
  }
  SIM[sc] = res;
}

// 載重（估算，不隨時間）：ASCE 7-16 雪（地面雪 1.0 kN/m²）、台灣耐風規範形式的速度壓 × JIS 陣列係數
const Q = velocityPressure({ code: 'tw', V: 42.5, z: 3, exposure: 'C' });
const LOADS = Object.fromEntries(GROUPS.map(g => [g.id, { snow: snowLoad({ method: 'asce7', ground: 1.0, tilt: g.tilt }), wind: panelWindLoad({ q: Q.q, tilt: g.tilt, area: W * L / 1e6 }) }]));
const RUN = Object.fromEntries(GROUPS.map(g => [g.id, peak => runoff({ tilt: g.tilt, azimuth: 0, length: L, width: W, intensity: peak, n: 0.010 })]));

// ---------------------------------------------------------------- 場景
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, preserveDrawingBuffer: qp.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(), SKY_CLEAR = new THREE.Color(0x9fb8cc), SKY_GREY = new THREE.Color(0x8d949b), SKY_NIGHT = new THREE.Color(0x1b2430);
const camera = new THREE.PerspectiveCamera(40, 1, 100, 200000); camera.position.set(12000, 15000, 45000);
const controls = new OrbitControls(camera, $('c')); controls.target.set(-4500, 800, 7000); controls.maxPolarAngle = Math.PI * .48; controls.update();
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x4a5a44, .9), sunLight = new THREE.DirectionalLight(0xfff4e2, 2.4);
sunLight.castShadow = true; sunLight.shadow.mapSize.set(2048, 2048); sunLight.shadow.bias = -.0005;
Object.assign(sunLight.shadow.camera, { left: -22000, right: 22000, top: 22000, bottom: -22000, near: 1000, far: 200000 });
sunLight.target.position.set(0, 0, 9000); scene.add(hemi, sunLight, sunLight.target);

const grass = new THREE.Color(0x7f9465), white = new THREE.Color(0xeef2f6);
const groundMat = new THREE.MeshStandardMaterial({ color: grass, roughness: .95 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), groundMat); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground';
scene.add(ground);                                                                      // 地面積雪（0° 的模擬）只改地面顏色

const glass = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: .35, metalness: .25 }), steel = new THREE.MeshStandardMaterial({ color: 0x9aa3aa, metalness: .6, roughness: .45 });
const wet = new THREE.MeshStandardMaterial({ color: 0x9fc4e8, transparent: true, opacity: .35, roughness: .05, metalness: 0, depthWrite: false });
const tables = [];
for (const g of GROUPS) for (const z of ROWS) {
  const b = g.tilt * D2R, top = new THREE.Group();
  // 台的本地座標：原點在上緣中央的玻璃面，+z 沿斜面往下（朝南）、+y 是法向——和 createSnowCover 相同
  top.position.set(g.x, FRONT + L * Math.sin(b), z - L * Math.cos(b)); top.rotation.x = b; top.name = `table ${g.id} z=${z}`;
  for (let i = 0; i < PER; i++) for (let k = 0; k < UP; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(MOD.width, 40, MOD.length), glass);
    m.position.set(-W / 2 + MOD.width / 2 + i * (MOD.width + GAP), -20, MOD.length / 2 + k * (MOD.length + GAP)); m.castShadow = true; top.add(m);
  }
  const film = new THREE.Mesh(new THREE.BoxGeometry(W, 2, L), wet); film.position.set(0, 1, L / 2); film.visible = false; film.userData.weather = true; top.add(film);   // 雨天的水膜（示意）
  const cover = createSnowCover({ width: W, length: L, name: `snow ${g.id}` }); cover.mesh.material.emissive.set(0x2a2e33); top.add(cover.root);
  scene.add(top);
  // 前後立柱與橫梁（世界座標）
  for (const sx of [-W / 2 + 400, W / 2 - 400]) for (const [zz, hh] of [[z - 150, FRONT - 60], [z - L * Math.cos(b) + 150, FRONT + L * Math.sin(b) - 60]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(100, hh, 100), steel); post.position.set(g.x + sx, hh / 2, zz); post.castShadow = true; scene.add(post);
  }
  tables.push({ g, cover, film });
}
const precipArea = { min: [-16000, -6000], max: [16000, 24000] };
const snowView = createPrecipView({ kind: 'snow', area: precipArea, top: 9000, density: 3, wind: [300, 120], sway: 150 }, { size: 45 });
const rainView = createPrecipView({ kind: 'rain', area: precipArea, top: 9000, density: 6, wind: [500, 0], streak: 0.02 }, { opacity: 0.45 });
scene.add(snowView.root, rainView.root);

// ---------------------------------------------------------------- 一個時刻
let state = null, vis = 0;            // vis：雨雪畫面的時鐘（秒），播放時跟著真實時間走，拖時間軸時跟著小時數跳
function update() {
  const sc = $('sc').value, S = SCENARIOS[sc], h = Math.min(+$('t').value, S.hours), w = S.at(h), sim = SIM[sc];
  const abs = S.start[2] + h, f = fmtH(abs);
  $('clock').textContent = `第 ${f.d + 1} 天 ${f.s}`;
  const { sp } = poaAt(sc, h, 0), up = sp.apparentElevation > 0, sun = solar.sunVector(sp.apparentZenith, sp.azimuth);
  sunLight.position.set(sun[0] * 60000, Math.max(sun[1], .05) * 60000, sun[2] * 60000 + 9000);
  sunLight.intensity = up ? 2.4 * (1 - 0.85 * w.cloud) : 0; hemi.intensity = up ? .9 + .4 * w.cloud : .18;          // 陰天是明亮的散射光
  scene.background = (up ? SKY_GREY.clone().lerp(SKY_CLEAR, 1 - w.cloud) : SKY_NIGHT.clone());
  const now = {};
  for (const t of tables) { const s = sim[t.g.id].sample(h); t.cover.apply(s); t.film.visible = w.rain > 0.5; now[t.g.id] = s; }
  const gs = sim['地面'].sample(h); groundMat.color.copy(grass).lerp(white, gs.depth > 0.5 ? 0.85 : 0);
  snowView.root.visible = w.snowfall > 0; rainView.root.visible = w.rain > 0.5;
  snowView.apply(vis); rainView.apply(vis);
  const rows = [['氣溫／天空', `${w.temp.toFixed(1)} °C ／ ${!up ? '夜間' : w.cloud > .5 ? '陰' : '晴'}${w.snowfall ? `，降雪 ${w.snowfall} cm/h` : ''}${w.rain > .5 ? `，雨 ${w.rain.toFixed(0)} mm/h` : ''}`]];
  const groups = {};
  for (const g of GROUPS) {
    const s = now[g.id], R = sim[g.id], poa = poaAt(sc, h, g.tilt).poa, Ld = LOADS[g.id];
    groups[g.id] = { depth: s.depth, coverage: s.coverage, loss: s.loss, poa, energyLoss: R.p.energyLoss, clearedAt: R.p.clearedAt, kWh: R.kWh, kWhSnow: R.kWhSnow };
    rows.push([`<b>傾角 ${g.id}</b>`, `POA ${poa.toFixed(0)} W/m²`, 'h']);
    if (sc === 'snow') {
      rows.push(['積雪深／覆蓋', `${s.depth.toFixed(0)} mm ／ ${(s.coverage * 100).toFixed(0)}%`], ['目前發電損失', `${(s.loss * 100).toFixed(0)}%`],
        ['72 h 發電（示意）', `${R.kWhSnow.toFixed(1)}／${R.kWh.toFixed(1)} kWh·台（損失 ${(R.p.energyLoss * 100).toFixed(0)}%）`],
        ['放晴（雪滑落或融完）', R.p.clearedAt == null ? '72 h 內沒有' : `第 ${fmtH(S.start[2] + R.p.clearedAt).d + 1} 天 ${fmtH(S.start[2] + R.p.clearedAt).s}`],
        ['雪載重（ASCE 7-16，pg 1.0）', `${Ld.snow.sloped} kN/m²（Cs ${Ld.snow.slopeFactor}）`]);
    } else {
      const ro = RUN[g.id](Math.max(w.rain, 0)), pk = RUN[g.id](50);
      Object.assign(groups[g.id], { Q: ro.Q, depthFilm: ro.depth, tc: pk.tc });
      rows.push(['下緣流量／水膜', w.rain > .5 ? `${ro.Q.toFixed(3)} L/s ／ ${ro.depth.toFixed(2)} mm` : '—'],
        ['集流時間（50 mm/h）', `${pk.tc.toFixed(0)} s，流速 ${pk.velocity.toFixed(2)} m/s`],
        ['風載重（上揚，每台）', `${(Ld.wind.forceUp / 1000).toFixed(1)} kN（q ${Q.q} N/m²）`]);
      if (pk.warnings?.length) rows.push(['', pk.warnings.join('；'), 'sub']);
    }
  }
  state = { scenario: sc, hour: h, temp: w.temp, snowfall: w.snowfall, rain: w.rain, sunUp: up, groups, ground: gs };
  $('stats').innerHTML = rows.map(([k, v, c]) => c === 'h' ? `<dt class="h">${k.replace(/<\/?b>/g, '')}　<span style="font-weight:400;color:var(--mute)">${v}</span></dt>` : c === 'sub' ? `<dd class="sub">${v}</dd>` : `<dt>${k}</dt><dd>${v}</dd>`).join('')
    + '<dd class="sub">積雪、滑落、逕流是示意模型；雪與風載重是規範形式的估算（係數待核對），正式設計依案場規範與結構技師。</dd>';
  render();
}

function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? Math.min(75, 2 * Math.atan(Math.tan(20 * Math.PI / 180) / camera.aspect) * 180 / Math.PI) : 40;   // 直式畫面保持水平視野
  if (camera.aspect < 1) camera.setViewOffset(w, h, 0, h * 0.22, w, h); else camera.clearViewOffset();   // 直式：面板在下方，畫面往上挪
  camera.updateProjectionMatrix(); render();
}
function render() { renderer.render(scene, camera); }
controls.addEventListener('change', render);
function setScenario() { const S = SCENARIOS[$('sc').value]; $('t').max = S.hours; if (+$('t').value > S.hours) $('t').value = S.hours / 2; }
$('sc').addEventListener('input', () => { setScenario(); vis = +$('t').value * 10; update(); });
$('t').addEventListener('input', () => { vis = +$('t').value * 10; update(); });
let playing = false, last = 0;
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? '❚❚ 暫停' : '▶ 播放'; last = performance.now(); if (playing) requestAnimationFrame(tick); });
function tick(now) {
  if (!playing) return;
  const dt = Math.min(.1, (now - last) / 1000); last = now; vis += dt;
  const S = SCENARIOS[$('sc').value], rate = S.hours / 36;               // 36 秒播完整個情境
  let h = +$('t').value + dt * rate; if (h > S.hours) h = 0;
  $('t').value = h; update(); requestAnimationFrame(tick);
}
if (qp.has('sc') && SCENARIOS[qp.get('sc')]) $('sc').value = qp.get('sc');
setScenario();
if (qp.has('h')) $('t').value = qp.get('h');
vis = +$('t').value * 10;
addEventListener('resize', resize);
resize(); update();
// 檢查與截圖用：window.sim.state 是目前時刻的數字；summary 是整段情境的結果
window.sim = {
  get state() { return state; },
  set(h, sc) { if (sc) { $('sc').value = sc; setScenario(); } if (h != null) $('t').value = h; vis = +$('t').value * 10; update(); return state; },
  summary: Object.fromEntries(Object.entries(SIM).map(([sc, r]) => [sc, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { energyLoss: v.p.energyLoss, clearedAt: v.p.clearedAt, maxDepth: v.p.maxDepth, kWh: v.kWh, kWhSnow: v.kWhSnow }]))])),
  ready: true,
};
