// core/geo/terrain.js：DSM／DTM 高程格網 → 案場座標的地形網格、高程查詢、正射影像貼圖。
// 決定性：只有算術、沒有亂數；格網原點對齊 spacing 的整數倍，同一份資料重建結果逐位元相同。
import * as THREE from 'three';
import { invertTransform } from './geotiff.js';

// 兩個投影是否相同（參數比對）
function sameCRS(a, b) {
  if (!a || !b) return true;               // 沒有座標系資訊時視為相同（由使用者負責）
  const p = a.params, q = b.params;
  if (!p || !q) return a === b;
  return p.lon0 === q.lon0 && p.lat0 === q.lat0 && p.k0 === q.k0 && p.x0 === q.x0 && p.y0 === q.y0 && p.ellps === q.ellps;
}

/**
 * 柵格（readElevation 的結果）在案場座標的取樣器。
 * 柵格與案場的投影不同時（例如 DSM 是 UTM 51N、案場用 TWD97）自動經過經緯度轉換。
 * @returns {{ heightAt(x, z): number, mapOf(x, z): {E, N}, siteOf(E, N, H): {x,y,z}, boundsSite: {x0,z0,x1,z1} }}
 */
export function rasterSampler(raster, site) {
  const { width: W, height: H, data, transform } = raster;
  const inv = invertTransform(transform);
  const same = sameCRS(raster.crs, site.crs);
  if (!same && (!raster.crs || raster.crs.geographic)) throw new Error('柵格是經緯度座標或座標系不明，請先投影成 TM／UTM');
  const mapOf = same ? (x, z) => site.toMap(x, 0, z)
    : (x, z) => { const g = site.toLatLon(x, 0, z); return raster.crs.forward(g.lat, g.lon); };
  const siteOf = same ? (E, N, h) => site.fromMap(E, N, h)
    : (E, N, h) => { const g = raster.crs.inverse(E, N); return site.fromLatLon(g.lat, g.lon, h); };
  const H0 = site.origin.H;

  /** 雙線性內插（像素中心為節點）；四個鄰點有 NaN 時以有效點加權，全部無效回傳 NaN。單位：案場 y（mm） */
  function heightAt(x, z) {
    const m = mapOf(x, z);
    const p = inv.toPixel(m.E, m.N);
    const u = p.col - 0.5, v = p.row - 0.5;
    if (u < -0.5 || v < -0.5 || u > W - 0.5 || v > H - 0.5) return NaN;
    const i0 = Math.max(0, Math.min(W - 1, Math.floor(u))), j0 = Math.max(0, Math.min(H - 1, Math.floor(v)));
    const i1 = Math.min(W - 1, i0 + 1), j1 = Math.min(H - 1, j0 + 1);
    const fx = Math.max(0, Math.min(1, u - i0)), fy = Math.max(0, Math.min(1, v - j0));
    const q = [[i0, j0, (1 - fx) * (1 - fy)], [i1, j0, fx * (1 - fy)], [i0, j1, (1 - fx) * fy], [i1, j1, fx * fy]];
    let s = 0, w = 0;
    for (const [i, j, k] of q) {
      const h = data[j * W + i];
      if (k > 0 && !Number.isNaN(h)) { s += h * k; w += k; }
    }
    if (w < 1e-9) {
      // 剛好落在節點上時權重可能為 0：退回最近點
      const h = data[Math.round(Math.max(0, Math.min(H - 1, v))) * W + Math.round(Math.max(0, Math.min(W - 1, u)))];
      return Number.isNaN(h) ? NaN : (h - H0) * 1000;
    }
    return (s / w - H0) * 1000;
  }

  // 柵格四角在案場座標的外包框
  const corners = [[0, 0], [W, 0], [0, H], [W, H]].map(([c, r]) => {
    const [a, b, cc, d, e, f] = transform;
    const s = siteOf(a * c + b * r + cc, d * c + e * r + f, H0);
    return s;
  });
  const boundsSite = {
    x0: Math.min(...corners.map(c => c.x)), x1: Math.max(...corners.map(c => c.x)),
    z0: Math.min(...corners.map(c => c.z)), z1: Math.max(...corners.map(c => c.z)),
  };
  return { heightAt, mapOf, siteOf, boundsSite };
}

// NoData 填補：反覆用 8 鄰點有效值的平均補洞（照順序掃描，結果決定性）
function fillHoles(h, nx, nz, maxIter = 64) {
  let filled = 0;
  for (let it = 0; it < maxIter; it++) {
    const next = h.slice();
    let changed = 0, remaining = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!Number.isNaN(h[k])) continue;
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if ((di || dj) && ii >= 0 && jj >= 0 && ii < nx && jj < nz && !Number.isNaN(h[jj * nx + ii])) { s += h[jj * nx + ii]; c++; }
      }
      if (c) { next[k] = s / c; changed++; } else remaining++;
    }
    h.set(next);
    filled += changed;
    if (!remaining || !changed) break;
  }
  return filled;
}

/**
 * 建立地形。
 * @param {object} dem readElevation() 的結果（{ width, height, data, transform, crs }）
 * @param {object} site createSiteFrame() 的結果
 * @param {object} [o]
 * @param {number} [o.spacing=1000] 網格間距（mm）
 * @param {{x0,z0,x1,z1}} [o.bounds] 範圍（案場 mm；預設為柵格的外包框）
 * @param {'hole'|'fill'|number} [o.nodata='hole'] 無資料：挖洞、用鄰點補、或填固定高度（案場 y，mm）
 * @param {number} [o.chunkCells=128] 每塊的格數（每邊）；每塊頂點 ≤ 129² 用 16 位元索引
 * @param {THREE.Material} [o.material] 預設 MeshStandardMaterial（灰綠）
 * @param {number} [o.maxVertices=4e6]
 */
export function createTerrain(dem, site, o = {}) {
  const spacing = o.spacing || 1000;
  const chunkCells = Math.min(255, o.chunkCells || 128);
  const sampler = rasterSampler(dem, site);
  const b = o.bounds || sampler.boundsSite;
  // 對齊 spacing 的整數倍（不同次匯入的格點一致）
  const gx0 = Math.ceil(b.x0 / spacing) * spacing, gz0 = Math.ceil(b.z0 / spacing) * spacing;
  const nx = Math.floor((b.x1 - gx0) / spacing) + 1, nz = Math.floor((b.z1 - gz0) / spacing) + 1;
  if (nx < 2 || nz < 2) throw new Error('地形範圍小於一格，請調小 spacing');
  if (nx * nz > (o.maxVertices || 4e6)) throw new Error(`地形頂點 ${nx * nz} 超過上限，請加大 spacing 或縮小範圍`);

  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = sampler.heightAt(gx0 + i * spacing, gz0 + j * spacing);
  let holes = 0;
  for (const h of heights) if (Number.isNaN(h)) holes++;
  const nodata = o.nodata ?? 'hole';
  let filled = 0;
  if (holes && nodata === 'fill') filled = fillHoles(heights, nx, nz);
  else if (holes && typeof nodata === 'number') for (let k = 0; k < heights.length; k++) if (Number.isNaN(heights[k])) { heights[k] = nodata; filled++; }

  const H = (i, j) => heights[j * nx + i];
  // 法向量用整片格網的中央差分（塊與塊之間沒有接縫）
  const normalAt = (i, j, out) => {
    const hl = H(Math.max(0, i - 1), j), hr = H(Math.min(nx - 1, i + 1), j);
    const hd = H(i, Math.max(0, j - 1)), hu = H(i, Math.min(nz - 1, j + 1));
    const c = H(i, j);
    const dx = ((Number.isNaN(hr) ? c : hr) - (Number.isNaN(hl) ? c : hl)) / ((Math.min(nx - 1, i + 1) - Math.max(0, i - 1)) * spacing);
    const dz = ((Number.isNaN(hu) ? c : hu) - (Number.isNaN(hd) ? c : hd)) / ((Math.min(nz - 1, j + 1) - Math.max(0, j - 1)) * spacing);
    const l = Math.hypot(dx, 1, dz);
    out[0] = Number.isFinite(dx) ? -dx / l : 0; out[1] = Number.isFinite(l) ? 1 / l : 1; out[2] = Number.isFinite(dz) ? -dz / l : 0;
  };

  const root = new THREE.Group();
  root.name = 'terrain';
  root.userData.geo = 'terrain';
  root.userData.noBom = '現場地形（空拍 DSM／DTM）';
  const material = o.material || new THREE.MeshStandardMaterial({ color: 0x8a9478, roughness: 0.95, metalness: 0 });
  const chunks = [];
  let triangles = 0;
  const nrm = [0, 0, 0];
  for (let cj = 0; cj < nz - 1; cj += chunkCells) for (let ci = 0; ci < nx - 1; ci += chunkCells) {
    const ci1 = Math.min(nx - 1, ci + chunkCells), cj1 = Math.min(nz - 1, cj + chunkCells);
    const w = ci1 - ci + 1, d = cj1 - cj + 1;
    // 塊中心當作物件位置，頂點座標相對中心（float32 精度只看塊的大小）
    const ox = gx0 + (ci + ci1) / 2 * spacing, oz = gz0 + (cj + cj1) / 2 * spacing;
    const pos = new Float32Array(w * d * 3), nor = new Float32Array(w * d * 3);
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 3, gi = ci + i, gj = cj + j;
      const h = H(gi, gj);
      pos[k] = gx0 + gi * spacing - ox; pos[k + 1] = Number.isNaN(h) ? 0 : h; pos[k + 2] = gz0 + gj * spacing - oz;
      normalAt(gi, gj, nrm);
      nor[k] = nrm[0]; nor[k + 1] = nrm[1]; nor[k + 2] = nrm[2];
    }
    const idx = [];
    for (let j = 0; j < d - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i, bb = a + 1, c = a + w + 1, dd = a + w;
      const ga = H(ci + i, cj + j), gb = H(ci + i + 1, cj + j), gc = H(ci + i + 1, cj + j + 1), gd = H(ci + i, cj + j + 1);
      // 對角線 a–c；法向朝 +Y：(a, c, b) 與 (a, dd, c)
      if (!Number.isNaN(ga) && !Number.isNaN(gc) && !Number.isNaN(gb)) idx.push(a, c, bb);
      if (!Number.isNaN(ga) && !Number.isNaN(gd) && !Number.isNaN(gc)) idx.push(a, dd, c);
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(w * d > 65535 ? idx : new THREE.BufferAttribute(new Uint16Array(idx), 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.name = `terrain ${ci / chunkCells}-${cj / chunkCells}`;
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.userData.geo = 'terrain';
    mesh.userData.cell = { ci, cj, ci1, cj1 };
    root.add(mesh);
    chunks.push(mesh);
    triangles += idx.length / 3;
  }

  /** 和畫面上的三角網一致的高度（對角線 a–c 切分）；放樁腳、支架落地用這個，貼齊看得到的地面 */
  function surfaceAt(x, z) {
    const u = (x - gx0) / spacing, v = (z - gz0) / spacing;
    if (u < 0 || v < 0 || u > nx - 1 || v > nz - 1) return NaN;
    const i = Math.min(nx - 2, Math.floor(u)), j = Math.min(nz - 2, Math.floor(v));
    const fx = u - i, fz = v - j;
    const a = H(i, j), c = H(i + 1, j + 1);
    return fx >= fz ? a + fx * (H(i + 1, j) - a) + fz * (c - H(i + 1, j))
      : a + fz * (H(i, j + 1) - a) + fx * (c - H(i, j + 1));
  }

  return {
    root, chunks, material,
    heightAt: sampler.heightAt,       // 原始 DSM 雙線性（分析用，比網格精細）
    surfaceAt,                         // 網格三角面（貼齊畫面）
    grid: { x0: gx0, z0: gz0, nx, nz, spacing, heights },
    bounds: { x0: gx0, z0: gz0, x1: gx0 + (nx - 1) * spacing, z1: gz0 + (nz - 1) * spacing },
    stats: { vertices: nx * nz, triangles, holes, filled, chunks: chunks.length },
    sampler,
  };
}

// ---------------------------------------------------------------- 正射影像
const pot = n => 2 ** Math.round(Math.log2(Math.max(1, n)));

function makeTexture(rgba, w, h) {
  const tex = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                         // 第 0 列（北緣）在 v = 0
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// 依柵格的仿射，替一塊網格算 uv
function setUV(mesh, transform, tw, th, mapOf) {
  const inv = invertTransform(transform);
  const pos = mesh.geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + mesh.position.x, z = pos.getZ(k) + mesh.position.z;
    const m = mapOf(x, z);
    const p = inv.toPixel(m.E, m.N);
    uv[2 * k] = p.col / tw; uv[2 * k + 1] = p.row / th;
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * 把正射影像貼到地形上。
 * - 整片需要的解析度 ≤ maxSize：一張貼圖（2 的次方），所有塊共用一個材質；
 * - 否則每塊各讀一個視窗（≤ tileSize，2 的次方），每塊自己的材質。COG 有縮圖時自動挑合適的那一層，逐圖塊縮小，
 *   記憶體只用一個 TIFF 圖塊加輸出。
 * @param {object} terrain createTerrain() 的結果
 * @param {object} tif readGeoTIFF() 的結果（正射影像）
 * @param {object} site
 * @param {object} [o]
 * @param {number} [o.groundResolution] 目標地面解析度（mm／像素；預設 = 地形 spacing / 4）
 * @param {number} [o.maxSize=4096] 單張貼圖上限
 * @param {number} [o.tileSize=1024] 分塊貼圖上限
 * @param {(tex)=>THREE.Material} [o.makeMaterial]
 */
export async function applyOrthophoto(terrain, tif, site, o = {}) {
  const img0 = tif.image;
  if (!img0.transform) throw new Error('正射影像沒有地理參考');
  const ortho = { crs: img0.crs, transform: img0.transform, width: img0.width, height: img0.height, data: null };
  const smp = rasterSampler({ ...ortho, data: new Float32Array(1) }, site);
  const res = o.groundResolution || terrain.grid.spacing / 4;
  const makeMat = o.makeMaterial || (map => new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }));
  const maxSize = o.maxSize || 4096, tileSize = o.tileSize || 1024;
  const spp = img0.samplesPerPixel;
  const samples = spp >= 4 ? [0, 1, 2, 3] : spp >= 3 ? [0, 1, 2] : [0];

  // 視窗（主影像像素）→ RGBA 貼圖
  async function windowTexture(win, outW, outH) {
    // 挑最接近需要的縮圖層：該層寬度 ≥ 輸出所需
    let img = img0, k = 1;
    for (const ov of tif.overviews) {
      const s = img0.width / ov.width;
      if ((win[2] - win[0]) / s >= outW) { img = ov; k = s; }
    }
    const w = [Math.floor(win[0] / k), Math.floor(win[1] / k), Math.min(img.width, Math.ceil(win[2] / k)), Math.min(img.height, Math.ceil(win[3] / k))];
    const r = await img.readRaster({ window: w, samples, width: outW, height: outH });
    const n = outW * outH, rgba = new Uint8Array(n * 4);
    const div = img.bitsPerSample === 16 ? 257 : 1;
    for (let i = 0; i < n; i++) {
      const p = i * r.samples;
      if (r.samples >= 3) { rgba[4 * i] = r.data[p] / div; rgba[4 * i + 1] = r.data[p + 1] / div; rgba[4 * i + 2] = r.data[p + 2] / div; }
      else rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = r.data[p] / div;
      rgba[4 * i + 3] = r.samples === 4 ? r.data[p + 3] / div : 255;
    }
    // 輸出格網的仿射：以主影像像素為準換算（縮圖層的取整誤差 ≤ 1 個縮圖像素）
    const [a, b, c, d, e, f] = img0.transform;
    const sx = (w[2] - w[0]) * k / outW, sy = (w[3] - w[1]) * k / outH;
    const transform = [a * sx, b * sy, c + a * w[0] * k + b * w[1] * k, d * sx, e * sy, f + d * w[0] * k + e * w[1] * k];
    return { tex: makeTexture(rgba, outW, outH), transform };
  }

  // 一塊網格對應的主影像像素視窗
  const inv = invertTransform(img0.transform);
  function windowOf(x0, z0, x1, z1) {
    const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => { const m = smp.mapOf(x, z); return inv.toPixel(m.E, m.N); });
    const c0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.col))) - 1), c1 = Math.min(img0.width, Math.ceil(Math.max(...pts.map(p => p.col))) + 1);
    const r0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.row))) - 1), r1 = Math.min(img0.height, Math.ceil(Math.max(...pts.map(p => p.row))) + 1);
    return c1 > c0 && r1 > r0 ? [c0, r0, c1, r1] : null;
  }

  const B = terrain.bounds;
  const wholeW = (B.x1 - B.x0) / res, wholeH = (B.z1 - B.z0) / res;
  const textures = [];
  if (Math.max(wholeW, wholeH) <= maxSize) {
    const win = windowOf(B.x0, B.z0, B.x1, B.z1);
    if (!win) throw new Error('正射影像和地形沒有重疊');
    const t = await windowTexture(win, Math.min(maxSize, pot(wholeW)), Math.min(maxSize, pot(wholeH)));
    const mat = makeMat(t.tex);
    for (const m of terrain.chunks) { setUV(m, t.transform, t.tex.image.width, t.tex.image.height, smp.mapOf); m.material = mat; }
    textures.push(t.tex);
    return { mode: 'single', textures, size: [t.tex.image.width, t.tex.image.height] };
  }
  const sp = terrain.grid.spacing;
  for (const m of terrain.chunks) {
    const { ci, cj, ci1, cj1 } = m.userData.cell;
    const x0 = B.x0 + ci * sp, x1 = B.x0 + ci1 * sp, z0 = B.z0 + cj * sp, z1 = B.z0 + cj1 * sp;
    const win = windowOf(x0, z0, x1, z1);
    if (!win) continue;
    const tw = Math.min(tileSize, pot((x1 - x0) / res)), th = Math.min(tileSize, pot((z1 - z0) / res));
    const t = await windowTexture(win, tw, th);
    setUV(m, t.transform, tw, th, smp.mapOf);
    m.material = makeMat(t.tex);
    textures.push(t.tex);
  }
  return { mode: 'tiled', textures, size: [tileSize, tileSize] };
}
