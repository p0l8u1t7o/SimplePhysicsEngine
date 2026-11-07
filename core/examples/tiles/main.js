// 3D Tiles 範例（core/geo/tiles.js）：合成的 tileset（data/，make-tileset.mjs 產生）放進案場座標。
// 紅色標竿：建物中心的 ENU 點 → ECEF → 經緯度 → site.fromLatLon（精確）；圖磚的建物應該正好包住它。
// 網址 ?mode=rigid 改用剛體轉換（ENU 切平面；這份資料只有 ±100 m，和精確轉換只差幾 mm）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { twd97, createSiteFrame, geodeticToECEF } from '@core/geo/coords.js';
import { createTiles, siteFromECEFExact } from '@core/geo/tiles.js';

const $ = id => document.getElementById(id), qp = new URLSearchParams(location.search);
const GEOID = 20, site = createSiteFrame({ crs: twd97(), origin: { E: 182000, N: 2543000, H: 30 } });
if (qp.get('mode') === 'rigid') $('mode').value = 'rigid';

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fb8cc);
const camera = new THREE.PerspectiveCamera(45, 1, 100, 2e6); camera.position.set(-90000, 70000, 110000);
const controls = new OrbitControls(camera, $('c')); controls.target.set(20000, 0, -10000); controls.update();
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(50000, 120000, 80000); scene.add(sun);
scene.add(new THREE.GridHelper(200000, 20, 0x30404c, 0x4c5c68));                       // 案場格線（10 m）

// 建物中心：ENU（東 40、北 30）在橢球面上的點 → ECEF → 精確案場位置
const { lat, lon, H } = site.origin, D = Math.PI / 180, p = lat * D, l = lon * D, o = geodeticToECEF(lat, lon, H + GEOID);
const enu = (e, n, u) => [o.x - Math.sin(l) * e - Math.sin(p) * Math.cos(l) * n + Math.cos(p) * Math.cos(l) * u, o.y + Math.cos(l) * e - Math.sin(p) * Math.sin(l) * n + Math.cos(p) * Math.sin(l) * u, o.z + Math.cos(p) * n + Math.sin(p) * u];
const target = siteFromECEFExact(site, ...enu(40, 30, 0), { geoidOffset: GEOID });
const pole = new THREE.Mesh(new THREE.CylinderGeometry(300, 300, 30000, 16), new THREE.MeshStandardMaterial({ color: 0xd03030, emissive: 0x401010 }));
pole.position.set(target[0], target[1] + 8000, target[2]); scene.add(pole);

let tiles = null, loaded = 0;
function load() {
  if (tiles) { scene.remove(tiles.group); tiles.dispose(); }
  loaded = 0;
  tiles = createTiles('./data/tileset.json', site, { camera, renderer, geoidOffset: GEOID, exact: $('mode').value === 'exact', errorTarget: 4 });
  tiles.tiles.addEventListener('load-model', () => { loaded++; stats(); });
  scene.add(tiles.group);
}
function stats() {
  $('stats').innerHTML = [
    ['案場原點', `TWD97 E ${site.origin.E}、N ${site.origin.N}、正高 ${site.origin.H} m`],
    ['大地起伏 N', `${GEOID} m（橢球高 − 正高）`],
    ['子午線收斂角', `${site.convergence.toFixed(3)}°（方格北和真北的差）`],
    ['已載入圖磚', `${loaded}`],
    ['建物中心（標竿）', `x ${(target[0] / 1000).toFixed(3)}、z ${(target[2] / 1000).toFixed(3)} m`],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}
$('mode').addEventListener('input', load);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize(); load(); stats();
renderer.setAnimationLoop(() => { controls.update(); tiles?.update(); renderer.render(scene, camera); });
window.sim = { get ready() { return loaded > 0; }, get tiles() { return tiles; }, site, target, get loaded() { return loaded; } };
