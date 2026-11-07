// 展示：起伏地形上的固定式支架與單軸追日、清洗水管（1D 水力）、直流電纜槽（電壓降）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pvFixedRack, pvTracker } from '@core/structure/build.js';
import { groupLoads } from '@core/structure/loads.js';
import { routePipe, routeToLink } from '@core/piping/route.js';
import { solveNetwork, lpm, water } from '@core/piping/hydraulics.js';
import { stringDrop } from '@core/piping/cable.js';
import { routeChecks, hydraulicChecks, voltageDropChecks } from '@core/piping/checks.js';
import { createPipeBatch, routeTray, PIPE_MAT } from '@core/piping/build.js';
import { PIPE_SCH40 } from '@core/piping/sizes.js';

// 地形（mm）：緩坡＋起伏
const height = (x, z) => 700 * Math.sin(x / 9000) + 450 * Math.cos(z / 6500 + .7) + .025 * x - .03 * z;

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.shadowMap.enabled = true; view.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xbfd3e3);
const camera = new THREE.PerspectiveCamera(40, 1, 100, 500000); camera.position.set(-22000, 26000, 42000);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(30000, 0, -8000); controls.update();
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(20000, 60000, 40000); sun.target.position.set(30000, 0, -8000);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -60000, right: 60000, top: 60000, bottom: -60000, near: 1000, far: 200000 });
scene.add(sun, sun.target);

// 地形網格
{
  const g = new THREE.PlaneGeometry(110000, 60000, 220, 120); g.rotateX(-Math.PI / 2); g.translate(30000, 0, -10000);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a9a6a, roughness: .95 })); m.receiveShadow = true; scene.add(m);
}

// 鋼構
const rack = pvFixedRack.create({ rows: 3, tablesPerRow: 1, across: 20, tilt: 20, origin: [0, 0], height });
const trk = pvTracker.create({ rows: 3, across: 40, origin: [30000, 0], follow: 'terrain', height });
scene.add(rack.root, trk.root);

// 清洗水管：水池 → 沿固定式第一列前方，管中心離地 500，DN50 冷彎
const along = (x, z, h = 500) => [x, height(x, z) + h, z];
const pipePts = [along(-6000, 3500, 300), along(-3000, 2500), along(4000, 2500), along(11000, 2500), along(18000, 2500), along(23000, 2500)];
const pipe = routePipe(pipePts, { size: 'DN50', bendType: 'pipe-bend' });
// 1D 水力：三個清洗噴頭（各 40 L/min、要 1.5 bar），水池水面高程＝地面 + 1 m
const D = PIPE_SCH40.DN50.ID / 1000, link = routeToLink(pipe);
const segLen = i => pipe.segments[i].length / 1000;
const nodes = [
  { id: '水池', z: (height(-6000, 3500) + 1000) / 1000 },
  { id: '噴頭1', z: pipePts[2][1] / 1000, demand: lpm(40), pMin: 1.5e5 },
  { id: '噴頭2', z: pipePts[3][1] / 1000, demand: lpm(40), pMin: 1.5e5 },
  { id: '噴頭3', z: pipePts[5][1] / 1000, demand: lpm(40), pMin: 1.5e5 },
];
const hyd = solveNetwork({
  nodes, fluid: water(25), source: { node: '水池', suction: nodes[0].z },
  links: [
    { id: 'L1', from: '水池', to: '噴頭1', L: segLen(0) + segLen(1), D, eps: link.eps, bends: link.bends.slice(0, 2), fittings: ['entrance-sharp', 'valve-ball'] },
    { id: 'L2', from: '噴頭1', to: '噴頭2', L: segLen(2), D, eps: link.eps, fittings: ['tee-line-flanged'] },
    { id: 'L3', from: '噴頭2', to: '噴頭3', L: segLen(3) + segLen(4), D, eps: link.eps, bends: link.bends.slice(3), fittings: ['tee-line-flanged'] },
  ],
});
// 直流電纜槽：追日區西側往南到變流器
const trayPts = [along(29000, 300, 300), along(29000, -11000, 300), along(26000, -14000, 300), [26000, height(26000, -14000) + 1200, -14000]];
const tray = routePipe(trayPts, { size: 'TRAY-200x75', minR: 300 });
const strings = trk.layout.rows.map(r => ({ id: `${r.id} 組串`, ...stringDrop({ modules: 20, vmp: 44.1, imp: 13.15, length: (tray.developed + trk.layout.summary.axisLength / 2) / 1000, cable: 'PV-6', T: 70 }) }));

const pipes = createPipeBatch({ material: PIPE_MAT.pvc }).add(pipe).build();
scene.add(pipes, routeTray(tray, { width: 200, height: 75 }));

// 面板
const row = r => `<tr><td class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'}</td><td>${r.group}｜${r.name}</td><td class="n">${r.value}</td></tr>`;
const loads = groupLoads(rack.layout, { V: 32.5, sk: 0 });
document.getElementById('out').innerHTML = `
  <h2>固定式 ${rack.summary.modules} 片、${rack.summary.kWp} kWp、GCR ${rack.summary.gcr}</h2>
  <table>${rack.bom.byProfile.map(b => `<tr><td>${b.profile}</td><td class="n">${b.count} 支</td><td class="n">${b.lengthM} m</td><td class="n">${b.kg} kg</td></tr>`).join('')}
  <tr><th>合計</th><th></th><th class="n">${rack.bom.total.lengthM} m</th><th class="n">${rack.bom.total.kg} kg</th></tr></table>
  <h2>追日 ${trk.summary.modules} 片、${trk.summary.kWp} kWp</h2>
  <table>${trk.bom.byProfile.map(b => `<tr><td>${b.profile}</td><td class="n">${b.count} 支</td><td class="n">${b.lengthM} m</td><td class="n">${b.kg} kg</td></tr>`).join('')}</table>
  <h2>風載估算（V = 32.5 m/s，${loads.note}）</h2>
  <div>q = ${loads.wind.q.toFixed(0)} Pa；第一張桌上揚 ${loads.groups[0].windUpKN} kN、每樁淨上揚 ${loads.groups[0].perPile.netUplift} kN</div>
  <h2>清洗水管 DN50：展開 ${(pipe.developed / 1000).toFixed(2)} m、泵揚程 ${hyd.pump.head.toFixed(1)} m、${(hyd.pump.flow * 60000).toFixed(0)} L/min、軸功率 ${hyd.pump.shaftW.toFixed(0)} W</h2>
  <h2>檢查</h2>
  <table>${[...rack.checks(), ...trk.checks(), ...routeChecks(pipe, { height, minClear: 300 }, '清洗水管'), ...hydraulicChecks(hyd), ...routeChecks(tray, { height, minClear: 100, cable: 'PV-6' }, '電纜槽'), ...voltageDropChecks(strings)].map(row).join('')}</table>`;

const ang = document.getElementById('ang');
ang.oninput = () => { trk.set({ angle: +ang.value }); document.getElementById('angV').textContent = ang.value; };
window.demo = { rack, trk, pipe, tray, hyd, strings };

function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
