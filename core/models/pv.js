// 光伏共用模型（core 1.20.2，REQUESTS「太陽能板、光伏支架與組串式變流器的共用模型」）：
//   pvModule        單片太陽能板（鋁框、電池片貼圖、背面接線盒）；座標：中心在原點，受光面朝 +Y，長邊沿 Z、短邊沿 X
//   pvArray         大量板片的 InstancedMesh：直接吃 core/solar 陣列配置的板片 { o, a, b }（a 長邊、b 短邊、a × b 受光面法向），
//                   日照計算與 3D 顯示用同一份配置；update(modules) 給追日轉動時更新
//   stringInverter  組串式變流器（壁掛機箱、顯示窗、狀態燈、散熱鰭片、底部接頭）；背面在 z = 0、正面朝 +Z、底在 y = 0（電控元件的慣例）
//   光伏支架用 core/structure 的 pvFixedRack／pvTracker（依地形逐支計算構件），不另做一份。
// 電池片貼圖用 DataTexture 產生（不需要 document，Node 與瀏覽器相同）。
import * as THREE from 'three';
import { block, cylinder } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { defaults } from './util.js';

const group = (name, id) => { const g = new THREE.Group(); g.name = name; g.userData.coreModel = id; return g; };

// 電池片貼圖：cells = [沿短邊, 沿長邊] 片數；halfCut 時長邊中間多一條間隙（半片板）。快取同樣參數的貼圖
const TEX = new Map();
function cellTexture(cells = [6, 24], halfCut = true) {
  const key = `${cells}|${halfCut}`; if (TEX.has(key)) return TEX.get(key);
  const nx = cells[0], nz = cells[1], px = 12, W = nx * px, H = nz * px, data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const ci = i % px, cj = j % px, k = (j * W + i) * 4;
    const gap = ci === 0 || cj === 0 || (halfCut && j === H / 2);                           // 片與片之間的白色背板
    const bus = !gap && (ci === 4 || ci === 8);                                              // 匯流條（沿長邊兩條）
    const v = gap ? [196, 204, 214] : bus ? [120, 130, 146] : [22 + (cj & 1) * 3, 38 + (ci & 1) * 2, 74];
    data[k] = v[0]; data[k + 1] = v[1]; data[k + 2] = v[2]; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  TEX.set(key, tex); return tex;
}
const faceMaterial = (cells, halfCut) => new THREE.MeshStandardMaterial({ map: cellTexture(cells, halfCut), roughness: 0.32, metalness: 0.15 });

export const pvModule = {
  meta: {
    id: 'pv-module', name: '太陽能板（單片，鋁框）', category: '光伏', source: 'PV DEMO（2026-11-04）',
    params: {
      L: { value: 2278, min: 1500, max: 2500, step: 1, unit: 'mm', label: '長邊' },
      W: { value: 1134, min: 900, max: 1400, step: 1, unit: 'mm', label: '短邊' },
      T: { value: 35, min: 25, max: 45, step: 1, unit: 'mm', label: '框高' },
    },
    options: { cells: '[沿短邊, 沿長邊] 片數（預設 [6, 24]）', halfCut: '半片板（預設 true，長邊中間多一條間隙）', frame: '鋁框寬（預設 30 mm）', name: 'root 的名稱（預設 pv-module）' },
    usage: "import { pvModule } from '@core/models/pv.js';\nconst m = pvModule.create({ L: 2278, W: 1134 }); m.root.position.set(x, y, z); parent.add(m.root);   // 受光面朝 +Y，長邊沿 Z",
  },
  create(p = {}) {
    const P = { ...defaults(pvModule.meta), ...p }, f = P.frame ?? 30, T = P.T, root = group(P.name ?? 'pv-module', 'pv-module');
    const alu = MAT.alu, back = MAT.cap;
    // 鋁框：長邊兩支、短邊兩支（短邊夾在長邊之間，不重疊）
    for (const s of [-1, 1]) block(root, [f, T, P.L], [s * (P.W / 2 - f / 2), 0, 0], alu).name = 'frame long';
    for (const s of [-1, 1]) block(root, [P.W - 2 * f - 2, T, f], [0, 0, s * (P.L / 2 - f / 2)], alu).name = 'frame short';   // 和長邊留 1 mm
    // 玻璃＋電池片的疊層：上緣比框低 3 mm（框唇擋住），四周和框留 1 mm
    const lam = new THREE.Mesh(new THREE.BoxGeometry(P.W - 2 * f - 2, 4, P.L - 2 * f - 2),
      [back, back, faceMaterial(P.cells, P.halfCut ?? true), back, back, back]);
    lam.position.y = T / 2 - 5; lam.castShadow = lam.receiveShadow = true; lam.name = 'laminate'; root.add(lam);
    // 背面接線盒（貼在疊層背面）
    block(root, [120, 20, 160], [0, T / 2 - 8 - 10, P.L / 2 - f - 220], MAT.black).name = 'junction box';   // 和疊層背面留 1 mm
    return { root, laminate: lam };
  },
};

/**
 * 大量板片：modules 是 core/solar 陣列配置的板片 [{ o, a, b }]（solar 的 trackerArray().pose(θ)、fixedArray().modules、
 * structure 的 solarFrame().modules(layout, θ)）。受光面就在 { o, a, b } 那個平行四邊形上，板厚往背面長。
 * @returns {{ mesh, update(modules), count }}
 */
export function pvArray(parent, modules, { T = 35, cells = [6, 24], halfCut = true, name = 'pv array' } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1), side = MAT.alu;
  const mesh = new THREE.InstancedMesh(geo, [side, side, faceMaterial(cells, halfCut), MAT.cap, side, side], modules.length);
  mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = false; mesh.userData.coreModel = 'pv-array';   // 薄板接收陰影會自己遮自己；遮陰用 core/solar 算
  const M = new THREE.Matrix4(), A = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), C = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), R = new THREE.Matrix4();
  function update(list) {
    list.forEach((m, i) => {
      A.set(...m.a); B.set(...m.b); N.crossVectors(A, B).normalize();
      const la = A.length(), lb = B.length();
      C.set(...m.o).addScaledVector(A, 0.5).addScaledVector(B, 0.5).addScaledVector(N, -T / 2);   // 受光面在平行四邊形上
      R.makeBasis(B.clone().divideScalar(lb), N, A.clone().divideScalar(la)); Q.setFromRotationMatrix(R);   // (b, n, a)：行列式為正
      M.compose(C, Q, S.set(lb, T, la)); mesh.setMatrixAt(i, M);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
  }
  update(modules); parent?.add(mesh);
  return { mesh, update, count: modules.length };
}

// 狀態燈的材質要各自一份（亮暗由 set 切換，不能改到共用的 MAT）
const led = color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.4 });
const STATES = ['standby', 'run', 'fault'];

export const stringInverter = {
  meta: {
    id: 'string-inverter', name: '組串式變流器（壁掛）', category: '光伏', source: 'PV DEMO（2026-11-04）',
    params: {
      kw: { value: 50, min: 10, max: 125, step: 5, unit: 'kW', label: '額定' },
    },
    states: { state: { value: 1, min: 0, max: 2, step: 1, label: '狀態（0 待機、1 運轉、2 故障）' } },
    options: { name: 'root 的名稱（預設 string-inverter）' },
    usage: "import { stringInverter } from '@core/models/pv.js';\nconst inv = stringInverter.create({ kw: 50 }); inv.root.position.set(x, y, z); parent.add(inv.root);   // 背面在 z = 0、正面朝 +Z\ninv.set({ state: 'run' });   // 'standby'｜'run'｜'fault'，或 0／1／2",
  },
  create(p = {}) {
    const P = { ...defaults(stringInverter.meta), ...p }, root = group(P.name ?? 'string-inverter', 'string-inverter');
    // 尺寸隨額定放大（示意：50 kW 約 700 × 580 × 290 mm）
    const k = Math.cbrt(P.kw / 50), Wd = Math.round(700 * k), H = Math.round(580 * k), D = Math.round(290 * k), z0 = 30;
    block(root, [Wd * 0.9, H * 0.8, z0 - 1], [0, H * 0.55, (z0 - 1) / 2], MAT.steelDark).name = 'mounting bracket';   // 和機身背面留 1 mm            // 背後的掛架
    const body = block(root, [Wd, H, D], [0, H / 2 + 60, z0 + D / 2], MAT.cabinet); body.name = 'inverter body';
    // 側面散熱鰭片（貼在機身兩側）
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) block(root, [18, H * 0.7, 6], [s * (Wd / 2 + 10), H / 2 + 60, z0 + 30 + i * (D - 60) / 5], MAT.alu).name = 'heat sink fin';
    // 正面：顯示窗與三顆狀態燈（離機身正面 1 mm，避免重合面）
    const zf = z0 + D;
    block(root, [Wd * 0.34, H * 0.16, 3], [-Wd * 0.18, H * 0.72 + 60, zf + 2.5], MAT.screen).name = 'display';
    const lamps = { standby: led(0xffb020), run: led(0x3dd68c), fault: led(0xff4d4d) };
    STATES.forEach((s, i) => { const m = cylinder(root, 9, 4, [Wd * 0.12 + i * 34, H * 0.72 + 60, zf + 3], lamps[s], 'z', 16); m.name = `led ${s}`; });
    // 底部的直流輸入與交流輸出接頭
    for (let i = 0; i < 8; i++) cylinder(root, 11, 30, [-Wd * 0.38 + i * Wd * 0.09, 60 - 16, z0 + D * 0.55], MAT.black, 'y', 14).name = 'dc connector';
    cylinder(root, 22, 40, [Wd * 0.36, 60 - 21, z0 + D * 0.55], MAT.steelDark, 'y', 20).name = 'ac gland';
    function set(s = {}) {
      if (s.state == null) return;
      const name = typeof s.state === 'number' ? STATES[Math.max(0, Math.min(2, Math.round(s.state)))] : s.state;
      for (const [k2, m] of Object.entries(lamps)) m.emissiveIntensity = k2 === name ? 1.6 : 0;
    }
    set({ state: P.state ?? 1 });
    return { root, set, body };
  },
};
