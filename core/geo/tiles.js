// 3D Tiles 匯入（core 1.20.2）：空拍重建輸出的 Cesium 3D Tiles（tileset.json＋b3dm／glb 圖磚），用 vendor/3d-tiles-renderer 0.5.3 串流載入，
// 放到案場座標（mm、X 東、Y 上、Z 南，createSiteFrame）。壓縮的圖磚（DRACO 幾何、KTX2／Basis 貼圖、EXT_meshopt_compression）
// 用 vendor/addons 的解碼器（three r187 原樣），第一次遇到時才載入 wasm；KTX2 要給 renderer（偵測 GPU 支援的貼圖格式）。
//
//   const tiles = createTiles('./data/tileset.json', site, { camera, renderer, geoidOffset: 20.3, exact: true });
//   scene.add(tiles.group);
//   每格：tiles.update()（換相機、改畫布大小後也要呼叫）
//
// 座標：圖磚是 ECEF（地心，公尺，橢球高）。
//   剛體轉換（預設）：在案場原點做 ECEF → ENU，再轉方格北（子午線收斂角）、案場旋轉、尺度。ENU 是切平面，離原點越遠和投影座標差越多
//     （地球曲率約 d²／2R：300 m 約 7 mm、600 m 約 28 mm、1 km 約 78 mm，主要是高程）。
//   exact: true：每個圖磚載入時逐頂點換成「經緯度 → site.fromLatLon」的精確位置（約每 10 萬頂點 0.1～0.3 秒），
//     要符合高精度門檻（core/solar/precision.js：高程 ±30 mm）而案場超過約 500 m 時用它。
//   geoidOffset（m）：大地起伏 N（橢球高 − 正高）。案場高程是正高（TWD97 等），圖磚是橢球高，台灣約 17～25 m；沒給就當 0（高程會差 N）。
import * as THREE from 'three';
import { TilesRenderer } from '../vendor/3d-tiles-renderer/index.three.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ELLIPSOIDS, geodeticToECEF } from './coords.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const LIBS = new URL('../vendor/addons/libs/', import.meta.url).href;

/**
 * 圖磚用的 GLTFLoader：掛上 DRACO、KTX2、meshopt 解碼器（3d-tiles-renderer 從 manager 取 'path.gltf'／'draco.drc' 的處理器）。
 * decoders：{ draco = true, ktx2 = true, meshopt = true }；KTX2 沒給 renderer 時不掛（遇到 KTX2 貼圖會載入失敗並在主控台報錯）。
 * 回傳 dispose()：收掉解碼器的 Worker。
 */
export function installDecoders(manager, renderer, { draco = true, ktx2 = true, meshopt = true } = {}) {
  const gltf = new GLTFLoader(manager), out = [], GLTF_RE = /\.(gltf|glb)$/i, DRC_RE = /\.drc$/i;     // removeHandler 用同一個物件比對
  if (draco) {
    const d = new DRACOLoader(manager).setDecoderPath(LIBS + 'draco/gltf/');     // 預設用 wasm（只放了 wasm 版）
    gltf.setDRACOLoader(d); manager.addHandler(DRC_RE, d); out.push(d);
  }
  if (ktx2 && renderer) {
    const k = new KTX2Loader(manager).setTranscoderPath(LIBS + 'basis/').detectSupport(renderer);
    gltf.setKTX2Loader(k); out.push(k);
  }
  if (meshopt) gltf.setMeshoptDecoder(MeshoptDecoder);
  manager.addHandler(GLTF_RE, gltf);
  return { gltf, dispose() { for (const l of out) l.dispose(); manager.removeHandler(GLTF_RE); manager.removeHandler(DRC_RE); } };
}

/** ECEF（m）→ 經緯度、橢球高（Bowring 起始值＋疊代，mm 級） */
export function ecefToGeodetic(X, Y, Z, ellps = 'WGS84') {
  const E = ELLIPSOIDS[ellps] || ELLIPSOIDS.WGS84, a = E.a, f = E.f ?? 1 / E.rf, e2 = f * (2 - f), b = a * (1 - f), ep2 = (a * a - b * b) / (b * b);
  const p = Math.hypot(X, Y), th = Math.atan2(Z * a, p * b);
  let lat = Math.atan2(Z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3), h = 0;
  for (let k = 0; k < 3; k++) {
    const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(Z, p * (1 - e2 * N / (N + h)));
  }
  const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s);
  h = Math.abs(lat) < 1.4 ? p / Math.cos(lat) - N : Z / s - N * (1 - e2);
  return { lat: lat * R2D, lon: Math.atan2(Y, X) * R2D, h };
}

/**
 * ECEF（m）→ 案場（mm）的剛體轉換矩陣（float64 的 THREE.Matrix4；給 tiles.group.matrix 用）。
 * 水平尺度照案場座標的定義：ground: false 時方格距離 × 1000（ENU 距離 × 點尺度 k），ground: true 時 × 1000 ÷ 高程尺度。
 */
export function siteFromECEF(site, { geoidOffset = 0, ellps = 'WGS84' } = {}) {
  const { lat, lon, H } = site.origin, phi = lat * D2R, lam = lon * D2R;
  const o = geodeticToECEF(lat, lon, H + geoidOffset, ellps), X0 = o.X ?? o.x ?? o[0], Y0 = o.Y ?? o.y ?? o[1], Z0 = o.Z ?? o.z ?? o[2];
  const eE = [-Math.sin(lam), Math.cos(lam), 0], eN = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)], eU = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const g = (site.convergence ?? 0) * D2R, r = (site.rotation ?? 0) * D2R, cg = Math.cos(g), sg = Math.sin(g), cr = Math.cos(r), sr = Math.sin(r);
  const kH = site.combinedScale && site.scaleFactor ? site.combinedScale / site.scaleFactor : 1;
  const sh = site.ground ? 1000 / kH : 1000 * (site.scaleFactor ?? 1);
  // ENU 向量 → 方格（轉 −γ）→ 案場未旋轉 (x0 東, z0 南) → 案場旋轉
  const row = (fE, fN) => [0, 1, 2].map(k => fE * eE[k] + fN * eN[k]);
  const Ep = row(cg, -sg), Np = row(sg, cg);                     // E' = E cosγ − N sinγ；N' = E sinγ + N cosγ
  const x0 = Ep.map(v => v * sh), z0 = Np.map(v => -v * sh);       // x0 = E'，z0 = −N'
  const xr = [0, 1, 2].map(k => cr * x0[k] - sr * z0[k]), zr = [0, 1, 2].map(k => sr * x0[k] + cr * z0[k]), yr = eU.map(v => v * 1000);
  const t = rowV => -(rowV[0] * X0 + rowV[1] * Y0 + rowV[2] * Z0);
  return new THREE.Matrix4().set(xr[0], xr[1], xr[2], t(xr), yr[0], yr[1], yr[2], t(yr), zr[0], zr[1], zr[2], t(zr), 0, 0, 0, 1);
}

/** 單點 ECEF（m）→ 案場（mm）的精確位置（經緯度 → 投影座標） */
export function siteFromECEFExact(site, X, Y, Z, { geoidOffset = 0, ellps = 'WGS84' } = {}) {
  const g = ecefToGeodetic(X, Y, Z, ellps), p = site.fromLatLon(g.lat, g.lon, g.h - geoidOffset);
  return [p.x, p.y, p.z];
}

/**
 * @param url tileset.json 的網址
 * @param site createSiteFrame 的結果（要有 origin.lat／lon；TWD97 等投影座標系都可以）
 * @param o { camera, renderer, errorTarget = 6（螢幕誤差像素，越小越細）, geoidOffset = 0（m）, exact = false, ellps = 'WGS84', name = '3d-tiles',
 *            decoders = { draco, ktx2, meshopt }（預設都開；false 全關） }
 * @returns {{ tiles, group, update(), dispose(), matrix }}
 */
export function createTiles(url, site, { camera, renderer, errorTarget = 6, geoidOffset = 0, exact = false, ellps = 'WGS84', name = '3d-tiles', decoders = {} } = {}) {
  const tiles = new TilesRenderer(url);
  tiles.errorTarget = errorTarget;
  const dec = decoders === false ? null : installDecoders(tiles.manager, renderer, decoders);
  const group = tiles.group, M = siteFromECEF(site, { geoidOffset, ellps });
  group.name = name; group.matrixAutoUpdate = false; group.matrix.copy(M); group.updateMatrixWorld(true);
  group.userData.geo = 'tiles'; group.userData.noBom = '現場實景（空拍 3D Tiles）';
  if (camera) { tiles.setCamera(camera); if (renderer) tiles.setResolutionFromRenderer(camera, renderer); }
  if (exact) tiles.addEventListener('load-model', ({ scene }) => exactify(scene));
  const tmp = new THREE.Vector3(), inv = new THREE.Matrix4(), toEcef = new THREE.Matrix4(), full = new THREE.Matrix4();
  // 逐頂點：local → ECEF（圖磚自己的轉換，不含 group）→ 精確案場位置 → 回到 local（M × 圖磚轉換 的反矩陣）。
  // load-model 觸發時圖磚可能還沒掛到 group 底下（matrixWorld 不含 M），所以沿父物件逐層乘 matrix，到 group 為止
  function exactify(root) {
    root.traverse(m => {
      if (!m.isMesh || !m.geometry?.attributes?.position) return;
      const pos = m.geometry.attributes.position;
      toEcef.identity();
      for (let o = m; o && o !== group; o = o.parent) { o.updateMatrix(); toEcef.premultiply(o.matrix); }
      full.multiplyMatrices(M, toEcef); inv.copy(full).invert();
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i).applyMatrix4(toEcef);
        const s = siteFromECEFExact(site, tmp.x, tmp.y, tmp.z, { geoidOffset, ellps });
        tmp.set(s[0], s[1], s[2]).applyMatrix4(inv); pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      }
      pos.needsUpdate = true; m.geometry.computeBoundingSphere(); m.geometry.computeBoundingBox();
      m.userData.geo = 'tiles';
    });
  }
  return {
    tiles, group, matrix: M,
    update() { if (camera) { camera.updateMatrixWorld(); if (renderer) tiles.setResolutionFromRenderer(camera, renderer); } tiles.update(); },
    dispose() { tiles.dispose(); dec?.dispose(); },
  };
}
