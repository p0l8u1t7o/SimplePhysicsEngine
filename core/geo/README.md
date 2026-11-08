# core/geo：案場座標、空拍地形、點雲與設計／現況比對

太陽能案場平台第一階段（2026-11-07 拍板，`PENDING.md` 第 5 節）。**空拍只匯入標準格式**（GeoTIFF 正射影像／DSM／DTM、LAS／LAZ、OBJ、3D Tiles）；照片處理交給外部的 OpenDroneMap（AGPL，獨立程序）或商用軟體（Pix4D、DJI Terra），平台不內建。

純 ES 模組：座標轉換、GeoTIFF、LAS、OBJ 都是自己寫的；只有 LAZ 解壓（`core/vendor/laz-perf`）與 3D Tiles 串流（`core/vendor/3d-tiles-renderer`，壓縮圖磚的解碼器在 `core/vendor/addons/`）用第三方程式（理由與評估見文末「第三方套件評估」）。其餘只依賴 `three`（只用長期穩定的 API，r160 與 r187 都測過）。

| 檔案 | 內容 |
|---|---|
| `coords.js` | 橫麥卡托（Krüger n⁶ 級數）、TWD97 TM2、UTM、EPSG 對照、ECEF／ENU、案場座標系 `createSiteFrame`、浮動原點 `createFloatingOrigin` |
| `geotiff.js` | GeoTIFF 讀取（`readGeoTIFF`、`readElevation`、`readOrthophoto`） |
| `terrain.js` | DSM／DTM → 分塊地形網格、`heightAt`／`surfaceAt`、正射影像貼圖 `applyOrthophoto` |
| `las.js` | LAS 1.2～1.4 讀取、`createPointCloud`（RGB／強度／分類／高度著色） |
| `laz.js` | LAZ：`readLAZ`（用 `vendor/laz-perf` 解壓後交給 `readLAS`，回傳結構相同）、`lazToLas`、`loadLazPerf` |
| `obj.js` | OBJ 實景網格（ODM、Pix4D、DJI Terra 的貼圖網格）：`readOBJ`（float64 解析、多邊形三角化、負索引、`offset`）、`readMTL`、`createOBJMesh`（減掉案場原點後分塊，每塊頂點相對塊中心存 Float32；`up: 'z'` 投影座標／`'y'` Y 朝上／`local`）。不用 three 的 OBJLoader：它直接把數十萬公尺的座標讀成 Float32，北距 254 萬公尺只剩 0.25 m 的解析度 |
| `tiles.js` | 3D Tiles（`vendor/3d-tiles-renderer` 0.5.3）：`createTiles(url, site, { camera, renderer, geoidOffset, exact })` 串流載入 tileset 放進案場座標；`siteFromECEF`（剛體：ENU 切平面＋收斂角＋尺度，離原點 d 的誤差約 d²／2R：600 m 約 28 mm）、`exact: true` 逐頂點換成經緯度 → 投影座標的精確位置；`geoidOffset` 是大地起伏 N（橢球高 − 正高，台灣約 17～25 m，沒有內建模型）；`ecefToGeodetic`。範例 `/core/examples/tiles/`。壓縮圖磚（DRACO、KTX2、meshopt；2026-11-08）由 `installDecoders` 在 `tiles.manager` 掛上解碼器，`createTiles` 的 `decoders` 選項可關掉個別解碼器 |
| `asbuilt.js` | 設計與現況比對：樁頂高程、平面偏移、排直線度、排距、支架傾角與方位（`layoutChecks` 格式） |
| `dronecam.js` | 空拍相機對位：GPS＋雲台姿態 → three.js 相機；DJI XMP／SRT 解析；視野角 |
| `index.js` | 全部匯出 |
| `test/` | `node --test`（8 個檔、39 項）；`tiff-writer.mjs` 產生合成 GeoTIFF，`fixtures/` 是 PROJ 參考座標與 laspy 寫的小 LAS／LAZ 檔，OBJ 用合成的 TWD97 網格 |

## 用法

```js
import { twd97, createSiteFrame, readGeoTIFF, readElevation, createTerrain, applyOrthophoto,
         readLAS, createPointCloud, measurePiles, asBuiltChecks } from '@core/geo/index.js';

export async function createProject({ scene }) {
  const site = createSiteFrame({ crs: twd97(), origin: { E: 182345.0, N: 2543210.0, H: 35.2 } });   // 原點放在案場中央
  const dsmBytes = await (await fetch('./data/dsm.tif')).arrayBuffer();
  const dem = await readElevation(dsmBytes, { maxSize: 2048 });          // 有 COG 縮圖就挑合適的那層
  const terrain = createTerrain(dem, site, { spacing: 500, nodata: 'fill' });
  await applyOrthophoto(terrain, readGeoTIFF(await (await fetch('./data/ortho.tif')).arrayBuffer()), site, { groundResolution: 50 });
  scene.add(terrain.root);
  // 樁腳貼齊看得到的地面用 surfaceAt；分析用 heightAt（原始 DSM 雙線性）
  const y = terrain.surfaceAt(12000, -3000);
  return { total: 10, apply() {}, verify: { skip: o => !!o.userData.geo } };
}
```

站裡的 `verify.skip` 要排除 `userData.geo`（地形、點雲不是設備）；地形與點雲的根群組已標 `userData.noBom`。

## 座標

### 案場座標系

框架慣例：**單位 mm、+X 東、+Y 上、+Z 南（北 = −Z）**，和 ParkingEMS 等站一致（`sites.js`：「北側是 −Z」）。

- 平面用投影的**方格座標**（TM2 或 UTM 公尺）相對原點；高程用 DSM 的高程（正高）相對原點高程。空拍成果（正射、DSM、點雲）都在方格座標，所以案場和資料一致。
- `rotation`（度）：案場再繞 +Y 轉，讓排列方向對齊 X 軸（正值：案場 +X 從東往北轉）。
- `ground: true`：除以原點的綜合尺度係數（點尺度 × 高程尺度），案場長度等於地面實長。TM2 在 23°N、120.3°E、高程 200 m 時綜合尺度 0.99993，1 km 方格距離和地面差約 68 mm，鋼構切長、管線長度要用地面長度時才開。
- **子午線收斂角**：`site.convergence`（度），真北 = 方格北逆時針轉 γ（中央經線以東為正，台灣西部約 −0.3°）。`directionFromAzimuth(真方位角)`、`azimuthOf(x, z)` 已經處理；`core/solar` 的太陽方位角要經過這兩個函式，否則遮陰方向會差 γ（排距 6 m 時約 3 cm）。
- 高程基準：DSM 的高程是什麼基準（TWVD2001 正高、EGM96、橢球高）由資料來源決定，案場只用相對高程，所以**同一案場的所有資料要同一個基準**。非 RTK 空拍的絕對高程誤差可達數公尺，要用地面控制點（GCP）校正。

| 函式 | 說明 |
|---|---|
| `transverseMercator({ lon0, lat0, k0, x0, y0, ellps })` | 通用橫麥卡托：`forward(lat, lon)`、`inverse(E, N)`、`convergence`、`scale` |
| `twd97(lon0 = 121)` | TWD97 TM2（EPSG:3826；澎湖 `twd97(119)` = EPSG:3825），GRS80、k0 0.9999、東偏 250 km |
| `utm(zone, south)`、`utmZone(lon)` | UTM（WGS84）；OpenDroneMap 預設輸出 UTM（台灣多半 51N = EPSG:32651，120°E 以西 50N） |
| `crsFromEPSG(code)` | 3826、3825、326xx、327xx；4326／3824 回傳 `{ geographic: true }`；其他（例如 TWD67）回傳 null |
| `createSiteFrame({ crs, origin, rotation, ground })` | `fromMap`／`toMap`、`fromLatLon`／`toLatLon`、`directionFromAzimuth`、`azimuthOf`、`convergence`、`scaleFactor`、`combinedScale` |
| `geodeticToECEF`、`ecefToENU` | 地心座標與區域 ENU |

TWD97 與 WGS84 視為同一基準（和 EPSG:3826 的 `towgs84=0` 相同）。TWD97 的參考時刻是 1997.0，台灣地殼每年移動數公分，和現在的 ITRF／WGS84 相差可達 1 m 以上；**同一案場的資料都用同一套成果**（RTK 基站接 TWD97 控制點，或全部用 ODM 的 UTM 成果）就不受影響，不要混用。

### 驗證

| 比對 | 點數 | 正算最大差 | 反算最大差 | 收斂角 | 尺度 |
|---|---|---|---|---|---|
| PROJ 9.8.1（pyproj 3.8.0）：TWD97 121（台灣本島 9×9 格） | 81 | 9.3e-7 mm | 1.7e-6 mm | 9.6e-11° | 1.1e-10 |
| 同上：TWD97 119（澎湖） | 16 | 1.4e-6 mm | 1.9e-6 mm | 7.2e-11° | 3.0e-11 |
| 同上：UTM 51N／50N／56S | 70 | 3.0e-6 mm | 4.6e-6 mm | 2.6e-10° | 1.1e-10 |
| Snyder《Map Projections: A Working Manual》p.269 UTM 算例（Clarke 1866） | 1 | < 0.1 m（書上給到 0.1 m） | | | |

proj4js 2.22.0 和 PROJ 的差在同一量級（≤ 2.8e-6 mm）。參考值在 `test/fixtures/proj-ref.json`（由開發工具 `proj-ref.py` 產生，見文末），測試不需要 pyproj。

## 浮動原點（km 級案場的 float32 精度）

問題：GPU 用 float32（24 位元尾數）。mm 單位下，5 km 的頂點量化間隔 0.5 mm、10 km 是 1 mm；若直接用 TM2 北距當座標（2.6e9 mm）就是 256 mm，畫面會抖。`float32Spacing(v)` 可以查任何量級的間隔。

做法分三層：

1. **案場原點放在案場中央**（`createSiteFrame` 的 `origin`），所有幾何都用相對原點的 mm。絕對方格座標只出現在 float64 的 JS 計算裡，不進 GPU。
2. **分塊**：地形每塊 ≤ 128 格、點雲每 50 m 一塊，頂點座標相對塊中心，塊的位置放在 `Object3D.position`。three.js 在 CPU 上以 float64 算 `modelViewMatrix = camera.matrixWorldInverse × object.matrixWorld`，所以塊離原點多遠都不影響精度，頂點的量化只看塊的大小（64 m 塊 → 4 µm）。這一層已經解決絕大多數情況，**案場 ≤ 約 8 km 不需要第 3 層**。
3. **重定原點**（`createFloatingOrigin({ root, camera, controls, threshold = 2e6, step = 1e5 })`）：shader 裡用世界座標的東西（陰影貼圖座標、環境反射、`worldPosition`）仍是 float32。相機離目前原點超過 `threshold`（2 km）時，把 `root`（案場內容的根群組）、相機、`controls.target` 一起平移，平移量取 `step`（100 m）的整數倍。`toSite`／`toRender` 換算座標，`onShift` 通知標籤等依世界座標的東西。
   - 決定性：平移量只由相機位置決定；`apply(t)`、檢查工具不呼叫 `update()`，看到的永遠是原始案場座標。截圖前呼叫 `reset()`。
   - 相機不能是 `root` 的子物件；陰影相機的範圍要跟著相機（舞台本來就這樣做）。

## GeoTIFF

```js
const tif = readGeoTIFF(arrayBuffer);        // 只解析檔頭與 IFD
tif.image                                     // 主影像：width、height、samplesPerPixel、compression、transform、epsg、crs、nodata…
tif.overviews                                 // COG 縮圖（由大到小，transform 已換算）
await tif.image.readRaster({ window: [x0, y0, x1, y1], samples: [0], width, height });   // 給 width/height 時逐塊方框縮小
await readElevation(input, { maxSize, window, band })    // → { width, height, data: Float32Array（NoData = NaN）, transform, crs, epsg, pixelSize }
await readOrthophoto(input, { maxSize, window })         // → RGBA Uint8ClampedArray
```

`transform` 是仿射 `[a, b, c, d, e, f]`：`X = a·col + b·row + c`、`Y = d·col + e·row + f`，以**像素角點**為整數座標（像素 (i, j) 的中心是 (i + 0.5, j + 0.5)）；PixelIsPoint 的檔案已經換算成角點。

| 項目 | 支援 | 不支援（丟出清楚的錯誤） |
|---|---|---|
| 檔案 | TIFF、BigTIFF；II／MM；多 IFD（COG 縮圖，排除遮罩 IFD） | — |
| 排列 | strip、tile；chunky（PlanarConfig 1）、planar（2）；稀疏圖塊（byte count 0） | 每個波段位元數不同 |
| 樣本 | uint8／int8／uint16／int16／uint32／int32／float32／float64 | float16、1～4 位元 |
| 壓縮 | 無（1）、LZW（5）、Deflate（8、32946，用內建 `DecompressionStream`）、PackBits（32773）、JPEG（7，2026-11-08：8 位元灰階或 RGB／YCbCr，`JPEGTables` 合併後交給瀏覽器的 `createImageBitmap`；Node 要 `setJpegDecoder(fn)` 給解碼函式，否則丟出說明錯誤） | 舊式 JPEG（6）、WebP、ZSTD、LERC → `gdal_translate -co COMPRESS=DEFLATE -co PREDICTOR=2/3 -co TILED=YES` |
| 預測器 | 2（水平差分，8／16／32 位元）、3（浮點，依 libtiff 的位元組平面順序） | 64 位元整數的預測器 2 |
| 地理參考 | ModelTiepoint＋ModelPixelScale、ModelTransformation（含旋轉）、PixelIsArea／PixelIsPoint、`GDAL_NODATA` | GCP 多點（只用第一個 tiepoint） |
| 座標系 | EPSG（3826、3825、326xx、327xx、4326）、使用者自訂橫麥卡托（ProjCoordTrans = 1，公尺） | 其他投影、非公尺單位 |

驗證（開發工具，見文末）：

- 480 種組合（4 種壓縮 × strip／tile × 兩種位元組順序 × 5 種樣本 × 預測器 × TIFF／BigTIFF × planar）寫出再讀回，逐像素相同；同一批交給 geotiff.js 3.0.5 讀，小端序全部一致。
- 大端序＋預測器的 64 個組合 geotiff.js 讀出來不同：它先套預測器再換位元組順序，和 libtiff 相反（`src/predictor.js` 直接在原始緩衝區上用主機序的 `Uint16Array`）。用 tifffile 2026.10.15 交叉驗證 36 個預測器檔（含大端序）全部和本讀取器一致；Pillow 13.0.0（libtiff）在 Deflate／LZW 小端序與大端序 uint16 也一致（Pillow 自己的 PackBits 路徑不套預測器、大端序 float32 讀錯，是 Pillow 的限制）。
- Chrome 157 無頭模式冒煙測試（`browser-smoke.html`）：Deflate／LZW／PackBits＋預測器解碼、地形、貼圖都正常。
- JPEG 圖塊（2026-11-08）：Node 測試用假的編解碼器驗表的合併、邊緣圖塊、灰階條帶；Chrome 157 用 canvas 編出真的 JPEG（品質 0.95、YCbCr）讀回，平均差 1.1、最大 5 個灰階。JPEG 是失真壓縮，不同瀏覽器的反 DCT 可能差 1～2 個灰階，只用在正射影像。

效能（Node 26，`bench.mjs`）：3000² DSM（5 cm、Deflate＋預測器 3、256 圖塊，2.6 MB）全解析度讀取 349 ms、縮到 1500² 433 ms；6000² RGB 正射（44 MB）貼成 2048² 單張 2.2 s、9 張 1024² 分塊 2.5 s。

整個檔案要先讀進記憶體（`ArrayBuffer`）。數 GB 的正射影像請先用 `gdaladdo` 建縮圖（COG）或用 `gdal_translate -outsize` 縮小；用 HTTP Range 只讀需要的圖塊是之後的工作。

## 地形

```js
const terrain = createTerrain(dem, site, { spacing: 1000, bounds, nodata: 'hole' | 'fill' | 數字, chunkCells: 128, material });
terrain.root            // THREE.Group，子物件是分塊網格（名稱 `terrain i-j`，16 位元索引）
terrain.heightAt(x, z)  // 原始 DSM 雙線性內插（案場 mm），NoData 附近只用有效點，範圍外 NaN
terrain.surfaceAt(x, z) // 和畫面三角網一致的高度（放樁腳、支架落地用）
terrain.grid            // { x0, z0, nx, nz, spacing, heights }；stats：vertices、triangles、holes、filled、chunks
```

- 格點對齊 `spacing` 的整數倍，不同次匯入的格點一致；只有算術，重建結果逐位元相同（測試有雜湊比對）。
- 法向量用整片格網的中央差分，塊與塊之間沒有接縫。
- DSM 與案場投影不同（例如 DSM 是 UTM 51N、案場用 TWD97）時自動經過經緯度轉換（測試：同一斜面兩種投影，高度差 < 1 mm）。
- `rasterSampler(raster, site)` 可以單獨用（不建網格，只查高度）。

正射影像 `applyOrthophoto(terrain, tif, site, { groundResolution, maxSize = 4096, tileSize = 1024, makeMaterial })`：

- 整片需要的像素（範圍 ÷ `groundResolution`）≤ `maxSize` → 一張 2 的次方貼圖，所有塊共用材質；
- 否則每塊各讀自己的視窗（≤ `tileSize`，2 的次方），每塊一個材質。挑最小但仍夠用的 COG 縮圖層，逐圖塊縮小，記憶體只用一個 TIFF 圖塊加輸出。
- 貼圖 `flipY = false`（第 0 列 = 北緣），`SRGBColorSpace`、mipmap、各向異性 4。

## 點雲（LAS）

```js
const las = readLAS(bytes, { maxPoints: 2e6, classes: [2, 6] });   // 等間隔抽樣（決定性）、分類篩選
// → { header（version、format、scale、offset、crs…）, count, x, y, z（投影座標 m）, intensity, classification, returnNumber, rgb, rgbBits, gpsTime }
const pc = createPointCloud(las, site, { colorBy: 'rgb' | 'intensity' | 'classification' | 'height', size: 2, chunk: 50000 });
scene.add(pc.root);     // pc.positions（Float64Array，案場 mm）給 asbuilt 用
```

- LAS 1.2、1.3、1.4，點格式 0～10（含額外位元組的長記錄）；座標系從 VLR 讀（GeoKey 34735 或 WKT 2112，含 EVLR）；點雲投影和案場不同時自動轉換。
- 顏色存成線性 Uint16 正規化（6 bytes／點）；RGB 自動判斷 8／16 位元；分類用 ASPRS 標準配色。
- 驗證：laspy 2.7.0 寫的 5 個檔（1.2 格式 1、3；1.4 格式 6、7、8＋額外位元組；EPSG 3826 與 32651）讀回 xyz、強度、分類、回波、RGB、分類統計全部相同。
- **LAZ**（core 1.20.0）：`readLAS` 遇到 LAZ 會丟出錯誤並說明轉檔方式（`pdal translate in.laz out.las`、`laszip`）；要直接讀就用 `laz.js` 的 `await readLAZ(bytes, { maxPoints, classes })`（第一次呼叫時才載入 wasm，回傳和 `readLAS` 相同）。驗證：laspy／lazrs 壓的 LAZ 和同一份 LAS 逐點相同（`test/las.test.mjs`）。

## 設計與現況比對

```js
const piles = measurePiles(design, { positions: pc.positions } /* 或 { heightAt: terrain.heightAt, resolution: 50 } */, { searchRadius: 300, topBand: 30 });
const rows = asBuiltChecks(piles, { tables, site, tol: { height: 30, plan: 50, straightness: 50, spacing: 50, azimuthDeg: 0.5, tiltDeg: 1, aspectDeg: 2 } });
// rows：[{ group, name, ok, value, note, dev, tol, kind }]，可以直接放進 layoutChecks；summarize(rows) 統計
```

- `design`：`[{ id, row, x, z, top }]`（設計樁頂 y）。點雲用搜尋半徑內 98 百分位當樁頂、樁頂帶內點的重心當平面位置；DSM 用最大值。比周圍低點高不到 `minRise`（200 mm）視為找不到（缺樁、遮蔽）。**樁位比對要在上板之前的空拍做**，上板後樁頂被模組遮住。
- 排：主成分擬合直線 → 直線度、方向；相鄰排重心到前一排直線的垂直距離 → 排距。
- 支架：`tables: [{ id, points, tiltDeg, aspectDeg }]`，`fitPlane` 擬合板面（`pointsInFootprint` 取出範圍內的點）→ 傾角與朝向（下坡方向的真方位角，已含收斂角）。

合成情境（`test/asbuilt-scenario.mjs`：3 排 × 6 支、26,343 點、雜訊 3 mm，埋入 5 種偏差）的輸出（`asbuilt-example.mjs`，7 ms）：

```
✓ 樁 R1-P1 樁頂高程 | 0 mm | 容許 ±30 mm
✗ 樁 R1-P5 平面偏移 | 80 mm（東 80、南 0） | 容許 50 mm
✗ 樁 R2-P3 樁頂高程 | +46 mm | 容許 ±30 mm
✗ 樁 R3-P1 平面偏移 | 120 mm（東 0、南 120） | 容許 50 mm      （R3 整排南移，P1～P5 都列出）
✗ 樁 R3-P6 找到 | 找不到 | 搜尋範圍內沒有明顯高起的樁頂（遮蔽、雜草或尚未施工）
✓ 排 R1 直線度 | 0 mm | 樁位到擬合直線的最大距離，容許 50 mm
✓ 排 R1–R2 排距 | 6000 mm（設計 6000，0） | 容許 ±50 mm
✗ 排 R2–R3 排距 | 6120 mm（設計 6000，+120） | 容許 ±50 mm
✓ 支架 R1 傾角 | 15.00°（設計 15.0°，0.00°） | 擬合 2511 點、殘差 RMS 3.0 mm，容許 ±1°
✓ 支架 R1 方位 | 180.0°（設計 180.0°） | 板面朝向（下坡方向的真方位角），容許 ±2°
✗ 支架 R2 傾角 | 17.00°（設計 15.0°，+2.00°） | 擬合 2511 點、殘差 RMS 3.0 mm，容許 ±1°
共 49 列、10 列不合格
```

## 空拍相機對位（選用）

`droneCameraPose({ lat, lon, alt | relAlt, yaw, pitch, roll }, site, { altitude, geoidN, takeoffH, yawOffset, camera })` → `{ position, quaternion, forward, up }`，給 `camera` 時直接設定。`fieldOfView({ focal35, aspect })` 或 `({ focalMm, sensorWidth, sensorHeight })` → `{ hfov, vfov }`（PerspectiveCamera 用 vfov）。

假設（DJI 慣例）：

- 雲台角是 NED 機體座標的 Z-Y-X 歐拉角：`GimbalYawDegree` 從真北順時針、`GimbalPitchDegree` 0 = 水平、−90 = 天底、`GimbalRollDegree` 右側向下為正；天底且 yaw 0 時畫面上方朝真北（測試用投影驗證）。
- yaw 視為相對真北的絕對角；若實測有固定偏差（台灣磁偏角約 −4.5°）用 `yawOffset`。
- 高度：`AbsoluteAltitude` 的基準因機型而異（多數非 RTK 機型是 EGM96 正高、RTK 機型可能是橢球高），非 RTK 時誤差可達 ±10 m。建議 `altitude: 'relative'`＋`takeoffH`（起飛點地面高程，用 `terrain.heightAt` 取）。橢球高用 `altitude: 'ellipsoidal', geoidN`（台灣大地起伏約 17～27 m）。
- 不處理鏡頭畸變（先用 XMP 的 `DewarpData` 或 OpenCV 去畸變）、GPS 天線到鏡頭的偏移（10～20 cm）、影片與 SRT 的時間偏移。
- 欄位：照片 XMP 的 `drone-dji:GpsLatitude`、`GpsLongitude`（舊韌體拼成 `GpsLongtitude`）、`AbsoluteAltitude`、`RelativeAltitude`、`Gimbal{Yaw,Pitch,Roll}Degree`、`Flight{Yaw,Pitch,Roll}Degree`、`CalibratedFocalLength`（像素）、`CalibratedOpticalCenterX/Y`、`RtkFlag`（50 = 固定解）、`RtkStd{Lon,Lat,Hgt}`、`DewarpData`（`parseDJIXMP`、`extractXMP`）；影片 SRT 的 `latitude`、`longitude`、`rel_alt`、`abs_alt`、部分機型的 `gb_yaw`／`gb_pitch`／`gb_roll`，舊格式 `GPS(lon,lat,alt)`（`parseDJISRT`）。

## 第三方套件評估

| 套件 | 版本／授權 | 大小與格式 | 建議 |
|---|---|---|---|
| proj4js | 2.22.0（2026-08）／MIT | `dist/proj4.js` 128 KB，UMD（非 ESM），依賴 mgrs、wkt-parser | **不需要**。自寫 TM 和 PROJ 相差 < 5e-6 mm；只有要 TWD67（七參數）或其他投影時再考慮（屆時 TWD67↔TWD97 也可以只加 Helmert 轉換） |
| geotiff.js | 3.0.5（2026-03）／MIT | `dist-browser/geotiff.js` 540 KB 壓縮 UMD（掛 `globalThis.GeoTIFF`）；ESM 版有 8 個裸套件依賴（pako、lerc、zstddec、quick-lru、web-worker、xml-utils、float16、parse-headers），沒有打包器不能直接用 | **自寫**（`geotiff.js` 約 25 KB 原始碼）。geotiff.js 的優點是 JPEG／LERC／ZSTD 與 HTTP Range，但體積大、要打包，且大端序＋預測器有錯 |
| laz-perf | 0.0.7（2025-02）／Apache-2.0 | Emscripten 膠水 88 KB＋WASM 212 KB；CJS／UMD，用 `document.currentScript` 找 .wasm，非 ESM | **已放進 vendor**（core 1.20.0，`core/vendor/laz-perf/`；ODM 預設輸出 LAZ）。做法同 Rapier：`core/vendor/laz-perf/laz-perf.mjs` = `lib/web/laz-perf.js` 後面加 `export default createLazPerf;`，WASM 以 base64 內嵌並用 `wasmBinary` 傳入（單檔約 375 KB，單一 HTML 匯出也能用），附 LICENSE＋README；`core/geo/laz.js` 用 `LASZip` 解成和 `readLAS` 相同的結構。已在 Node 驗證：laspy／lazrs 壓的 LAS 1.4 格式 7（5000 點）解出來和 LAS 版逐點相同，含初始化 14 ms（`try-lazperf.cjs`） |
| 3d-tiles-renderer（NASA-AMMOS） | 0.5.4（2026-11-03）／Apache-2.0 | ESM、沒有打包也能跑：`build/index.three.js`＋兩個 renderer 區塊約 131 KB（未壓縮），外掛區塊 311 KB；裸匯入只有 `three`、`three/addons/loaders/GLTFLoader.js`、`three/addons/utils/BufferGeometryUtils.js`（外掛另需 `postprocessing/Pass.js`），importmap 解得到；向量圖磚與 PMTiles 外掛動態載入 `@mapbox/vector-tile`、`pbf`、`pmtiles`（不用就不會載入） | **已放進 vendor**（0.5.3，2026-11-08，`core/vendor/3d-tiles-renderer/` 保留原始區塊檔名；three r187 升級後）。peer `three >= 0.167`，它從 `three` 匯入的名稱 r187 全部都有；r187 的 `GLTFLoader`、`BufferGeometryUtils`、`DRACOLoader`、`KTX2Loader` 與解碼器放在 `core/vendor/addons/`。0.5.4 發布不到兩週，先用 0.5.3（2026-09-18） |

上表的套件與交叉驗證（PROJ 參考座標、GeoTIFF 480 種組合對 tifffile／libtiff、laspy 寫的 LAS／LAZ 逐點比對、3d-tiles-renderer 需要的 three 匯出名稱）是 2026-11-07～08 開發時在本機原型資料夾做的；原型與下載的套件已在 2026-11-08 清掉，結果已固定成下方的測試與 `test/fixtures/`。要重新比對時照上表的版本重新下載。

## 測試

```powershell
node --import ./core/tools/register.mjs --test "core/geo/test/*.test.mjs"
```

8 個檔、39 項（也是 `check.mjs` 的 core `engineering` 檢查的一部分）：座標（PROJ 167 點、Snyder 算例、案場座標、旋轉與收斂角、ground、ECEF、浮動原點）、GeoTIFF（LZW／PackBits 往返、壓縮 × 排列 × 位元組順序 × 預測器 × BigTIFF、地理參考四種寫法、視窗與縮圖、NoData、JPEG 圖塊、錯誤訊息）、地形（雙線性、分塊、決定性雜湊、NoData 三種處理、跨投影、正射兩種模式）、LAS（laspy 檔、抽樣、LAZ、點雲）、OBJ（float64 解析、分塊）、3D Tiles（ECEF → 案場座標）、比對（擬合、點雲與 DSM 兩種來源）、相機（天底投影、yaw／pitch／roll、高度基準、XMP／SRT、視野角）。three r160 與 r187 都通過。
