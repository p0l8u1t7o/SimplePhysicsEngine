// 日照遮陰範例（core/solar）：太陽位置（SPA）→ 追日轉角（含回溯）→ BVH 逐片遮陰 → 晴空日射與估計功率。
// 座標：X 往東、Y 往上、Z 往南，mm（core/solar 的慣例）。網址 ?h=8.5&d=12,21&bt=0 可以直接指定時間、日期、回溯。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as solar from '@core/solar/index.js';

const SITE = { lat: 23.0, lon: 120.2, elevation: 15, deltaT: 69.2, tz: 8 };
const MODULE = { length: 2384, width: 1134 }, GCR = 0.4, PITCH = MODULE.length / GCR, ROWS = 6, PER_ROW = 24;
const PDC_PER_MODULE = 540;                       // W（示意：540 W 級）
const $ = id => document.getElementById(id), qp = new URLSearchParams(location.search);

// ---------------------------------------------------------------- 場景
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, preserveDrawingBuffer: qp.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fb8cc);
const camera = new THREE.PerspectiveCamera(40, 1, 200, 400000); camera.position.set(-4000, 44000, 50000);   // 南方高處：早上、下午都看得到板面（背面是暗的）
const controls = new OrbitControls(camera, $('c')); controls.target.set(4000, 0, 2000); controls.maxPolarAngle = Math.PI * .48; controls.update();
const hemi = new THREE.HemisphereLight(0xdfeaff, 0x4a5a44, .9); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff4e2, 2.6); sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096);
Object.assign(sunLight.shadow.camera, { left: -45000, right: 45000, top: 45000, bottom: -45000, near: 1000, far: 300000 }); sunLight.shadow.bias = -.0004;
scene.add(sunLight, sunLight.target);

// 地面：西邊平、東邊緩升的小丘（早上的低角度陽光會被擋）
const ground = (x, z) => 2600 * Math.exp(-((x - 52000) ** 2 + (z + 4000) ** 2) / (2 * 14000 ** 2));
const terrain = (() => {
  const g = new THREE.PlaneGeometry(160000, 120000, 160, 120); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x7f9465, roughness: .95 })); m.receiveShadow = true; m.name = 'terrain';
  return m;
})();
// 東南側的塔樓（18 m），冬天早上會在陣列東南角投下陰影
const tower = new THREE.Mesh(new THREE.BoxGeometry(9000, 18000, 9000), new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: .8 }));
tower.position.set(26000, 9000, 22000); tower.castShadow = tower.receiveShadow = true; tower.name = 'tower';
scene.add(terrain, tower);

// ---------------------------------------------------------------- 陣列與 BVH
const arr = solar.trackerArray({ rows: ROWS, modulesPerRow: PER_ROW, module: MODULE, pitch: PITCH, height: 1800, axisAzimuth: 180 });
const list = solar.createTriangleList();
solar.modulesToTriangles(arr.pose(0), list);
const nModTri = arr.count * 18;                                       // modulesToPositions 每片 6 個頂點 × 3
scene.updateMatrixWorld(true); list.addObject(tower); list.addObject(terrain);
const bvh = solar.buildBVH(list.positions, list.owners);
const staticPart = Float64Array.from(list.positions.slice(nModTri)), full = new Float64Array(list.positions.length);
full.set(staticPart, nModTri);

// 模組：每片一個實例（薄方塊），顏色依被遮比例
const modGeo = new THREE.BoxGeometry(1, 1, 1), modMat = new THREE.MeshStandardMaterial({ roughness: .75, metalness: 0 });   // 粗一點：鏡面反光會蓋掉遮陰的顏色
const mods = new THREE.InstancedMesh(modGeo, modMat, arr.count); mods.castShadow = true; mods.receiveShadow = false; mods.name = 'modules'; scene.add(mods);   // 薄板接收陰影會自己遮自己（整片變黑）；遮陰已經用顏色表示
// 追日軸（每列一支扭力管）與基樁
for (const r of arr.rows) {
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, arr.rowLength, 16), new THREE.MeshStandardMaterial({ color: 0x9aa3aa, metalness: .6, roughness: .4 }));
  tube.rotation.x = Math.PI / 2; tube.position.set(...r.center); tube.castShadow = true; scene.add(tube);
  for (let k = 0; k <= 6; k++) {
    const z = r.center[2] - arr.rowLength / 2 + k * arr.rowLength / 6, h = r.center[1] - ground(r.center[0], z);
    const pile = new THREE.Mesh(new THREE.BoxGeometry(150, h, 150), tube.material); pile.position.set(r.center[0], ground(r.center[0], z) + h / 2, z); pile.castShadow = true; scene.add(pile);
  }
}
const M4 = new THREE.Matrix4(), basis = new THREE.Matrix4(), col = new THREE.Color(), C0 = new THREE.Color(0x2e6fb5), C1 = new THREE.Color(0xe0a43a), C2 = new THREE.Color(0xc0392b);
const shadeColor = s => s <= .5 ? col.copy(C0).lerp(C1, s * 2) : col.copy(C1).lerp(C2, (s - .5) * 2);

// ---------------------------------------------------------------- 一個時刻
let state = null;
function update() {
  const [mo, da] = $('day').value.split(',').map(Number), hour = +$('t').value, backtrack = $('mode').value === '1';
  const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
  $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const u = solar.unixFromLocal(2026, mo, da, hh, mm, 0, SITE.tz), sp = solar.solarPosition(u, SITE);
  const up = sp.apparentElevation > 0, sun = solar.sunVector(sp.apparentZenith, sp.azimuth);
  const tr = solar.singleAxis(sp.apparentZenith, sp.azimuth, { axisAzimuth: 180, maxAngle: 60, gcr: GCR, backtrack });
  const theta = up && Number.isFinite(tr.theta) ? tr.theta : 0, pose = arr.pose(theta);
  full.set(solar.modulesToPositions(pose)); bvh.refit(full);
  const layouts = pose.map(m => solar.moduleLayout({ ...m, samples: [12, 3], diodes: 3 }));
  const sh = up ? solar.shadeModules(bvh, layouts, sun) : { area: new Float64Array(arr.count).fill(1) };
  // 實例矩陣：方塊 X 沿 b（沿軸，寬）、Y 沿法向（40 mm 厚）、Z 沿 a（跨軸，長），中心 = o + (a + b)/2
  pose.forEach((m, i) => {
    const a = new THREE.Vector3(...m.a), b = new THREE.Vector3(...m.b), n = a.clone().cross(b).normalize().multiplyScalar(40);
    const c = new THREE.Vector3(...m.o).addScaledVector(a, .5).addScaledVector(b, .5);
    basis.makeBasis(b, n, a).setPosition(c); M4.copy(basis); mods.setMatrixAt(i, M4);   // (b, n, a) 行列式為正；(a, n, b) 是鏡射，正面會被剔除
    mods.setColorAt(i, up ? shadeColor(sh.area[i]) : col.set(0x34424e));
  });
  mods.instanceMatrix.needsUpdate = true; if (mods.instanceColor) mods.instanceColor.needsUpdate = true;
  // 太陽光：方向照 SPA；地平線下改成很暗的天光
  sunLight.position.set(sun[0] * 150000, Math.max(sun[1], .02) * 150000, sun[2] * 150000); sunLight.intensity = up ? 2.6 : 0;
  hemi.intensity = up ? .9 : .25;
  // 晴空日射與功率（示意）：板面直達 × (1 − 被遮) ＋ 散射；PVWatts 直流
  const cs = up ? solar.clearSky(sp.apparentZenith, { altitude: SITE.elevation }) : { ghi: 0, dni: 0, dhi: 0 };
  const cosI = up ? Math.max(0, solar.aoiProjection(tr.tilt, tr.surfaceAzimuth, sp.apparentZenith, sp.azimuth)) : 0;
  let dc = 0, shaded = 0, sum = 0;
  for (let i = 0; i < arr.count; i++) { const s = sh.area[i]; sum += s; if (s > .01) shaded++; dc += PDC_PER_MODULE * Math.max(0, cs.dni * cosI * (1 - s) + cs.dhi * .9) / 1000; }
  state = { hour, backtrack, elevation: sp.apparentElevation, azimuth: sp.azimuth, theta, ideal: tr.ideal, shaded, meanShade: sum / arr.count, ghi: cs.ghi, dc };
  $('stats').innerHTML = [
    ['太陽高度／方位', up ? `${sp.apparentElevation.toFixed(1)}° ／ ${sp.azimuth.toFixed(1)}°` : '地平線下'],
    ['追日轉角', up ? `${theta.toFixed(1)}°${backtrack && Math.abs(theta - tr.ideal) > .05 ? `（理想 ${tr.ideal.toFixed(1)}°，回溯中）` : ''}` : '收回 0°'],
    ['被遮的板片', `${shaded}／${arr.count} 片（平均 ${(sum / arr.count * 100).toFixed(1)}%）`],
    ['晴空 GHI', `${cs.ghi.toFixed(0)} W/m²`],
    ['陣列直流功率（示意）', `${(dc / 1000).toFixed(1)} kW（${(arr.count * PDC_PER_MODULE / 1000).toFixed(1)} kWp）`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  render();
}

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render(); }
function render() { renderer.render(scene, camera); }
controls.addEventListener('change', render);
for (const id of ['day', 'mode', 't']) $(id).addEventListener('input', update);
if (qp.has('h')) $('t').value = qp.get('h');
if (qp.has('d')) $('day').value = qp.get('d');
if (qp.has('bt')) $('mode').value = qp.get('bt') === '0' ? '0' : '1';
addEventListener('resize', resize);
resize(); update();
// 檢查與截圖用：window.sim.state 是目前時刻的數字
window.sim = { get state() { return state; }, set(h, d, bt) { if (h != null) $('t').value = h; if (d) $('day').value = d; if (bt != null) $('mode').value = bt ? '1' : '0'; update(); return state; }, ready: true };
