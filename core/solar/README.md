# core/solar：日照、遮陰與發電

太陽能案場評估用的共用模組（core 1.19.0）：NREL SPA 太陽位置、固定式與單軸追日（含回溯、坡地 cross-axis）、逐片／逐旁路二極體區段的射線遮陰（自寫 BVH）、Perez 斜面日射、雙面背面日射、PVWatts 全年發電。純 ES 模組、沒有 npm 套件、不依賴 three.js（只用鴨子型別讀 `BufferGeometry`）。**Node 與瀏覽器逐位元相同**（見「決定性」）。範例 `/core/examples/solar/`；站層檢查是 `verify.solar`（`core/verify/solar.mjs`，見 `core/README.md`「檢查」）。

## 檔案

| 檔案 | 內容 |
|---|---|
| `spa.js` | NREL SPA（Reda & Andreas 2004）、ΔT、日期換算（不經過 `Date`）、入射角、太陽向量 |
| `spa-tables.js` | SPA 週期項表（`tools/solar-pvlib/gen-spa-tables.py` 由 pvlib 產生，勿手改） |
| `tracking.js` | 單軸追日（pvlib `singleaxis` 同式）、坡地軸傾角與 cross-axis tilt、板面朝向與法向、1D 排間遮陰（pvlib `shaded_fraction1d` 同式） |
| `irradiance.js` | 大氣層外日射、空氣質量、Ineichen–Perez 晴空、台灣 Linke 濁度、Erbs／DISC 分解、等向／Hay–Davies／Perez 斜面轉換、地面反射、IAM（physical、ASHRAE、Martin–Ruiz 與其散射版） |
| `linke-tw.js` | 台灣範圍（21.5～26.5°N、118～122.5°E）每月 Linke 濁度（`tools/solar-pvlib/gen-linke-tw.py` 由 pvlib 的全球表切出，54 KB） |
| `shading.js` | 三角形收集（陣列、`BufferGeometry`、`Mesh`、`InstancedMesh`）、BVH（分箱 SAH、refit）、板片取樣與旁路二極體區段、地平線輪廓、天空視角因子、太陽位置分箱快取 |
| `layout.js` | 追日陣列與固定傾角桌台的板片配置（給遮陰與 3D 擺放共用）、冬至排距 |
| `bifacial.js` | 雙面板背面日射（2D 無限長排視角因子）與全年迴圈用的快取版 |
| `energy.js` | 天候檔（EPW、TMY3、CSV）、電池溫度（SAPM、Faiman）、PVWatts 直流與變流器（含截峰）、旁路二極體部分遮陰、全年模擬、PR |
| `precision.js` | 高精度門檻常數 `SITE_PRECISION`（平面 ±50 mm、高程 ±30 mm、太陽位置 ±0.01°、全年發電和 pvlib 相差 < 2%），檢查與測試一律引用它 |
| `hash.js` | 決定性檢查用的 Float64 雜湊 |
| `index.js` | 公開 API |

## 慣例

- **場景座標**：X 往東、Y 往上、Z 往南（右手系），長度 mm（與舊 PV DEMO 相同）。`sunVector(zenith, azimuth)` 回傳「從地面指向太陽」的單位向量。
- **角度**：公開 API 一律用度。方位角由正北順時針（東 90、南 180、西 270），與 pvlib 相同。日射與遮陰用**視天頂角**（`apparentZenith`，含大氣折射）。
- **追日轉角**：沿 `axisAzimuth` 看，右手定則；軸朝南時正值 = 板面轉向西。`gcr` = 垂直於軸的板寬 ／ 水平排距。坡地用 `calcCrossAxisTilt` 算 `crossAxisTilt` 再傳給 `singleAxis`。
- **板片**：平行四邊形 `{ o, a, b }`（角點、長邊向量、短邊向量），法向 = a × b（受光面）。旁路二極體預設 3 個、沿 b 等分成長條（直式 60／72 片板）；`halfCut: true` 時每段分上下兩半並聯。
- **時間**：內部用 UTC Unix 秒（可帶小數）；天候檔是當地標準時間（不處理夏令時間），逐時資料的時間標記是「該小時結束」，太陽位置取區間中點（`label: 'end'` → −30 分）。
- **單位**：日射 W/m²、溫度 °C、風速 m/s、氣壓 Pa、功率 W、能量 kWh。

## API 摘要

```js
import * as solar from '@core/solar/index.js';

// 太陽位置
const u = solar.unixFromLocal(2026, 12, 21, 9, 30, 0, 8);                     // 台灣時間 → UTC 秒
const sp = solar.solarPosition(u, { lat: 23.0, lon: 120.2, elevation: 15, deltaT: 69.2 });
// → { zenith, apparentZenith, elevation, apparentElevation, azimuth, declination, hourAngle, equationOfTime, earthSunDistance, deltaT }
const sun = solar.sunVector(sp.apparentZenith, sp.azimuth);                  // 場景向量

// 追日
const tr = solar.singleAxis(sp.apparentZenith, sp.azimuth, { axisAzimuth: 180, maxAngle: 60, gcr: 0.4, backtrack: true, crossAxisTilt: 0 });
// → { theta, ideal, tilt, surfaceAzimuth, aoi, backtracking }

// 斜面日射
const poa = solar.poaIrradiance({ tilt: tr.tilt, azimuth: tr.surfaceAzimuth, zenith: sp.apparentZenith, sunAzimuth: sp.azimuth,
  dni, ghi, dhi, dniExtra: solar.extraRadiation(doy), airmass: solar.relativeAirmass(sp.apparentZenith), albedo: 0.2, model: 'perez' });

// 遮陰：陣列 → 三角形 → BVH → 逐片
const arr = solar.trackerArray({ rows: 20, modulesPerRow: 60, module: { length: 2384, width: 1134 }, pitch: 2384 / 0.4 });
const list = solar.createTriangleList();
solar.modulesToTriangles(arr.pose(0), list);
list.addObject(terrainMesh);                                                 // three.js 物件（先 updateMatrixWorld(true)）
const bvh = solar.buildBVH(list.positions, list.owners);
const mods = arr.pose(tr.theta);
bvh.refit(fullPositions);                                                    // 追日轉動後只 refit（順序同建樹時）
const r = solar.shadeModule(bvh, solar.moduleLayout({ ...mods[0], samples: [12, 3], diodes: 3 }), sun);
// → { area（被遮面積比例）, blocks: Float64Array(3)（各二極體區段的直達可用比例） }

// 全年
const w = solar.readEPW(text);                                               // 或 readTMY3、readCSV
const res = solar.simulate({ weather: w, site: { lat, lon, elevation, tz: 8 },
  system: { mount: { type: 'singleAxis', gcr: 0.4, maxAngle: 60 }, pdc0: 1e6, inverter: { pdc0: 8e5 }, losses: solar.pvwattsLosses(),
            bifacial: { bifaciality: 0.7, height: 2000, width: 2384 } },
  shading: { strings, blocksPerString: 3, evaluate: ctx => cache.get(ctx.zenith, ctx.azimuth) } });
// → { annual: { acKWh, dcKWh, poaKWhm2, rearKWhm2, pr, specificYield, shadeLossPct, clipLossPct, … }, monthly, hourly? }
```

額外的逐時損失（積雪等）用 `hourlyLoss`（Float64Array 或 `(i, { poa, tCell }) => 比例`），在遮陰之後、變流器之前扣，`annual.hourlyLossKWh` 是扣掉的直流電量（不算進 `shadeKWh`）；沒給時結果不變。積雪損失用 `weather/snow.js` 的 `snowLossSeries`（EPW 的第 30 欄雪深由 `readEPW` 讀成 `snowDepth`）：

```js
const r0 = solar.simulate({ weather: w, site, system, keepHourly: true });
const snow = snowLossSeries({ weather: w, poa: r0.hourly.poa, tilt: 25 });
const r1 = solar.simulate({ weather: w, site, system, hourlyLoss: snow.loss });   // r1.annual.hourlyLossKWh
```

### 部分遮陰模型（`bypassMismatch`）

一串板的每個旁路二極體區段 k 有日射 E_k（直達 × 區段可用比例 ＋ 散射）。電流 ∝ 日射、每段電壓視為相同，電流低於串電流的區段被旁路（電壓 0，忽略約 0.5 V 的二極體壓降）。MPPT 取 `max_j E_(j)·j / N`（E 由大到小）。全部相同時等於平均；一段被遮時整串跟著掉或把那段旁路，取較好者。區段的直達可用比例以「最暗的一格」為準（串聯電池的電流由最被遮的那片決定）；半片板兩半並聯取平均。`model: 'linear'` 是面積比例模型（對照用）。

結果：直式 1P 追日下緣一條陰影 → 三段同時變暗（只剩散射）；半片板 → 損失約一半。這是排間遮陰最主要的非線性效應。

## 精度（與 pvlib 0.16.1 交叉驗證，`validate.py` → `compare.mjs`）

| 項目 | 筆數 | 最大誤差 | 門檻 |
|---|---|---|---|
| SPA 視天頂角／方位角（13 地點含台灣 8 處、1990～2040、兩組氣壓溫度、ΔT 固定與自動） | 39,000 | 2.8e-13° ／ 2.6e-12° | 0.001° |
| SPA 均時差 | 39,000 | 7.3e-12 分 | — |
| NREL 論文範例（天頂、方位、入射角） | 3 | 2.0e-6°（論文只列到 1e-5°） | 5e-5° |
| 單軸追日 theta／傾角／朝向／AOI（5 種配置 × 3 種坡地，全年逐時） | 66,225 | 5.8e-11° | 1e-9° |
| 坡地軸傾角、cross-axis tilt | 20 | 0 | — |
| 1D 排間遮陰 | 8,830 | 1.2e-15 | — |
| Perez／Hay–Davies／等向 斜面總日射 | 3,000 × 3 | 2.3e-13 W/m² | 1e-8 |
| Erbs、DISC、大氣層外日射、空氣質量 | 18,000 | 6.1e-12 | 1e-8 |
| Ineichen 晴空、台灣 Linke 濁度 | 3,014 | 3.4e-13 W/m²、8.9e-16 | — |
| IAM（physical、ASHRAE、Martin–Ruiz、散射） | 617 | 1.1e-16 | — |
| SAPM、Faiman 溫度；PVWatts 直流、變流器、損失 | 2,001 | 1.4e-14 | — |
| **全年發電量**（合成台南 EPW、pvlib 內附 TMY3；固定 20° 與追日） | 4 系統 | **相對 3.1e-15** | 2% |
| 逐時交流功率（1 MWp） | 35,040 | 1.3e-9 W | — |
| 雙面背面（`ground: 'uniform'`）vs `infinite_sheds` 等向 | 120 | 0.56 W/m²（總和比 1.0001） | — |

說明：
- 誤差幾乎都是浮點捨入，因為公式與運算順序照 pvlib；「與 pvlib < 2%」的門檻實際上餘裕很大，可以改成檢查模型以外的差異（天候資料、設定）。
- 雙面 `ground: 'resolved'`（地面亮度逐點、含排正下方的陰影）比 pvlib 低約 7%（120 組總和），最大差 50 W/m²；pvlib 假設地面亮度均勻。預設用 `'uniform'`（已驗證），`'resolved'` 是較保守的選項。
- 3D BVH 遮陰對 pvlib 1D 模型（真追日、平地、冬至全天）：最大差 ≤ 1 個取樣格（24 格取 1/24）。

## 決定性

- 不用 `Math.random`、`Date`、`performance.now`；不依賴 `Map`／物件的疊代順序（快取以箱中心計算，與查詢順序無關）。
- **V8 不同版本的 `Math.sin/cos/tan/atan/atan2/asin/acos/exp/log/cbrt` 結果末位不同**：實測 Node 26.13 與 Chrome 157 在 2 萬個輸入中有 3～19% 差 1 ulp（`Math.pow`、`sqrt` 相同）。只靠「都是 V8」無法保證 Node 與網頁逐位元相同。
- 因此全部超越函式改用 `core/math/dmath.js`（fdlibm 5.3 移植；sin、cos、tan、asin、acos、atan、atan2、exp、log、pow，只用 IEEE-754 精確運算）：與 Node 26 的 V8（fdlibm 版）在 4.4 萬個輸入上逐位元相同（`exp(1)` 依 V8 回傳 `Math.E`），大引數（> 8.2e5 弧度）用 BigInt 精確取餘；整數次方用二進位乘法，非整數次方 `exp(y·log x)`。
- `test/determinism.test.mjs`：靜態檢查（core/solar 不得出現 `Math.sin(`…、`**`、時鐘、亂數）＋ dmath 黃金雜湊。
- `browser-check.mjs`：同一份工作量（SPA 6,000 筆、追日＋Perez＋晴空 3,000 筆、BVH 遮陰 36 個太陽位置、全年雙面發電）在 Node 26.13 與 Chrome 157 的雜湊相同。改用 dmath 前 SPA、追日、發電三項都不同。

## 效能（單執行緒、開發機）

| 項目 | 結果 |
|---|---|
| SPA 一次 | 5.7 µs（全年 8,760 筆 56 ms） |
| 全年發電迴圈（無遮陰） | 9 ms；含雙面 203 ms |
| BVH 建樹（10,000 片＝2 萬三角形 ＋ 地形 8 萬 ＋ 建物） | 130 ms；refit 7.7 ms |
| 射線 | 4.0～4.6 M 條/s |
| 10,000 片 × 36 射線（12×3），一個太陽位置 | 78 ms |
| 全年逐時（白天 4,273 小時） | 5.6 分 |
| 太陽分箱 1°×2°（1,167 箱） | 1.5 分 |
| 太陽分箱 2°×4°（582 箱）、每片 12 射線 | 0.3 分 |

建議的取樣策略：
1. **太陽位置分箱**（`createSunBinCache`，天頂 1°、方位 2°）：遮陰只與太陽方向有關（追日轉角也只由太陽方向決定），全年 4,000 多小時縮成約 1,200 次；箱中心造成的誤差在陰影邊緣 1 格取樣以內。互動預覽用 2°×4°。
2. **每片取樣**：直式板 `[12, 3]`（沿長邊 12 格對應電池列、每個二極體區段 1 條）就能分辨「下緣一條陰影」；評估報告用 `[24, 6]`。
3. **只算會被遮的板**：先用 1D 模型或前一箱結果篩出可能被遮的排，其餘直接 `blocks = 1`（未實作，可再快 3～5 倍）。
4. **多執行緒**：分箱彼此獨立，可以分給 Worker（各 Worker 一份 BVH）；結果依箱編號合併，仍然決定性。
5. 結果存成每箱每片的 `Uint8`（區段遮陰），1,200 箱 × 1 萬片 × 3 段 ≈ 36 MB；網頁只讀不算。

## 限制與假設

- **ΔT**：預設用 Espenak–Meeus 多項式（與 pvlib 相同），2026 年估 75.4 s、實測約 69 s。ΔT 只影響星曆時間（太陽黃經每秒約 1.1e-5°），差 6 s 在台灣造成太陽方向的夾角 < 0.0001°（天頂角差也 < 0.0001°），遠在高精度門檻 ±0.01° 以內；方位角在太陽接近天頂時會放大（夏至正午天頂角 0.3° 時差 0.012°），但那是方位角在天頂附近沒有意義，不是位置誤差（`test/precision.test.mjs` 用夾角量）；要求更嚴時傳實測值（IERS Bulletin A / USNO），例如 `deltaT: 69.2`。真正影響較大的是時間本身：輸入是 UTC，與 UT1 的差（|DUT1| < 0.9 s）造成時角誤差最多約 0.004°；天候檔時間標記錯 1 分鐘就是 0.25°，比模型誤差大得多。
- **天候資料**：本模組沒有內建台灣實測 TMY（案場天候檔用根目錄 `tools/weather/fetch-tmy.mjs` 從 PVGIS 下載）。可用來源：PVGIS（SARAH-3 涵蓋亞洲，TMY 下載為 EPW/CSV）、NSRDB Himawari（亞洲）、中央氣象署測站（只有 GHI 時用 Erbs／DISC 分解）、Meteonorm（商用）。驗證用的是決定性的合成台南 EPW（晴空 × 雲量因子，非真實氣候）與 pvlib 內附的美國 TMY3。
- **Linke 濁度**：只內建台灣範圍；其他地區請直接給 `tl`。
- **部分遮陰**：電流 ∝ 日射、區段電壓相同、忽略二極體壓降與 MPPT 電壓窗；每串一個 MPPT（多串並聯同一 MPPT 的失配未計）。精細 I-V 需要單二極體模型（之後可加）。
- **散射遮蔽**：近處遮擋的天空視角因子（`skyViewFactor`）要由呼叫端傳進 `evaluate` 的 `sky`；地形地平線只擋直達（`createHorizon` / `horizonFromBVH`），遠地平線對散射的影響未計。
- **雙面**：2D 無限長排、地面平坦、天空等向；不含支架遮擋（用 `structureShade`）、板面透光與排間互反射。
- **BVH**：雙面三角形、射線起點沿法向偏移 1 mm（`eps`）並略過板片自己（owner）；km 級場景用 mm 時 Float64 精度足夠，但 three.js 的 `BufferGeometry` 是 Float32（3 km 處約 0.25 mm），地形請以場地原點為中心。
- **地平線二分搜尋**只適用高度場（地形）；懸空物（橋、雲）請用射線直接判定。
- **追日回溯在坡地**：每排坡度不同時，`crossAxisTilt` 要逐排給（原型的效能測試：地形起伏 ±3 m 的 600 m 場地用平地回溯，取樣的 24 個時刻平均約 2 成板片有遮陰，含低太陽角與建物）。

## 驗證工具

| 指令 | 內容 |
|---|---|
| `.venv\Scripts\python.exe tools\solar-pvlib\validate.py` | pvlib 參考值（含合成台南 EPW），寫到本機 `TEMP\solar-pvlib-ref\`；說明在 `tools/solar-pvlib/README.md` |
| `node --import ./core/tools/register.mjs tools/solar-pvlib/compare.mjs` | 與 pvlib 比對，印各項最大誤差與門檻 |
| `node --import ./core/tools/register.mjs --test "core/solar/test/*.test.mjs"` | 單元測試（SPA、追日回溯、3D 遮陰 vs 1D、坡地回溯、冬至排距、旁路、地平線、天空視角、天候檔、全年遮陰、雙面、決定性、高精度門檻、three.js、站層 `verify.solar`）；也是 core `engineering` 檢查的一部分 |
| `node --import ./core/tools/register.mjs core/solar/test/browser-check.mjs` | Node 與無頭 Chrome 逐位元比對（core `solar` 檢查） |
