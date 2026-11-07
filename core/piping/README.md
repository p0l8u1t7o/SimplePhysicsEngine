# core/piping — 配管、導線管、電纜槽、1D 水力、電壓降（原型）

- 純計算（`sizes`、`route`、`hydraulics`、`cable`、`checks`）不依賴 three，Node 直接跑；3D 在 `build.js`。
- 決定性：沒有亂數、沒有時鐘；迭代（Colebrook、Hardy Cross）固定上限與收斂門檻。
- 單位：**幾何 mm**（和框架相同）；**水力全部 SI**（m、m³/s、Pa、m 水頭）；電壓降用 m、mm²、A、V、°C。`routeToLink` 負責 mm → m。

## 路徑：折線 → 直管＋彎

`routePipe(points, { size, kind, bendType, R, minR, stock, minSlope, maxSlope, flow, angleTol })`

- 每個轉角以半徑 R 的圓弧倒角：轉角 θ、切線長 `T = R·tan(θ/2)`、弧長 `R·θ`；90° 彎 T = R，L 形兩邊 L1、L2 的展開長度 = `L1 + L2 − 2R + πR/2`。
- R 預設為該尺寸的最小彎曲半徑；相鄰兩彎的切線長超過中間那段時兩彎等比例縮小（`bend.fit = false`，檢查列報出）。
- 回傳：`bends`（角度、R、切線長、弧長、起終點、圓心、法向、`plane`：horizontal／vertical-up／vertical-down／rolled）、`straights`（每段直管的起訖、長度、坡度）、`developed`（展開長度）、`totalBend`、`cuts`／`cutList`（切長清單）、`fittings`（配件數）、`slopes`（每段坡度是否符合）。
- 種類：
  - `pipe`＋`elbow-lr`／`elbow-sr`：直管各自切料（整支＋餘料，接頭 `coupling`），彎頭分 `elbow90`、`elbow45`、`elbowCut`（非標準角，要切角）。
  - `pipe`＋`pipe-bend`、`conduit`：整段連續、彎在管上成形，依庫存長度分支。導線管檢查兩拉線點之間彎曲合計 ≤ 360°。
  - `tray`：彎通依平面與角度計數（`tray-horizontal-90` 等），直段接頭 `splicePlate`。
- 坡度：`minSlope`／`maxSlope` 只套非垂直段；`flow: 'down'` 時沿點的順序只能往下（垂直段允許）。
- `pathPoints(route)`：沿實際路徑（直管＋圓弧）取樣；`groundClearance(route, height)`：管底對地面的最小淨空（負值＝埋設，另回報覆土 `minCover`）。
- `routeToLink(route)`：轉成水力管段（L m、D m、ε m、彎的 r/D）。

## 尺寸表（`sizes.js`，示意）

| 表 | 內容 | 來源 |
|---|---|---|
| `PIPE_SCH40` | DN15～DN150：OD、壁厚、內徑；彎曲半徑 `elbow-lr` = ASME B16.9 LR 90° 中心到端面（≈ 1.5 × NPS；½" 38、¾" 29 mm）、`elbow-sr` = 1.0 × NPS、`pipe-bend` = 3 × OD；粗糙度 0.045 mm | ASME B36.10M、ASME B16.9 |
| `CONDUIT_EMT` | ½"～2"：OD、壁厚；最小彎曲半徑（中心線）4"、5"、6"、8"、10"、12" | ANSI C80.3、NEC Chapter 9 Table 2（其他彎曲欄）、NEC 358.26 |
| `TRAY` | 100×50～600×150；標準彎 300 mm | 常見梯架／槽架規格 |
| `CABLE_PV` | 2.5～16 mm²：外徑（H1Z2Z2-K 型錄中間值）、20 °C 導體電阻（IEC 60228 第 5 類鍍錫銅最大值：8.21、5.09、3.39、1.95、1.24 Ω/km）、最小彎曲半徑 4 × 外徑 | IEC 60228、廠商型錄 |

| DN | NPS | OD | 壁厚 | LR R |
|---|---|---|---|---|
| 15 | ½ | 21.3 | 2.77 | 38 |
| 20 | ¾ | 26.7 | 2.87 | 29 |
| 25 | 1 | 33.4 | 3.38 | 38 |
| 32 | 1¼ | 42.2 | 3.56 | 48 |
| 40 | 1½ | 48.3 | 3.68 | 57 |
| 50 | 2 | 60.3 | 3.91 | 76 |
| 65 | 2½ | 73.0 | 5.16 | 95 |
| 80 | 3 | 88.9 | 5.49 | 114 |
| 100 | 4 | 114.3 | 6.02 | 152 |
| 150 | 6 | 168.3 | 7.11 | 229 |

## 1D 管網水力（`hydraulics.js`）

`solveNetwork({ nodes, links, source, fluid, method })`

- 節點 `{ id, z（m）, demand（流出 m³/s）, pMin（Pa） }`；管段 `{ id, from, to, L, D, eps, K, fittings, bends }`；水源 `{ node, head（m）｜pressure（Pa）, suction（m，給了才算泵）, eta }`。
- 節點水頭 `H = z + p/(ρg)`（不含速度頭）；from → to 流量為正。
- 沿程：Darcy–Weisbach `hf = f·(L/D)·V²/2g`；局部 `hm = ΣK·V²/2g`；f：層流 64/Re（Re < 2000）、紊流 Colebrook（預設，迭代到 1e-12）或 Swamee–Jain（顯式），2000～4000 線性內插（`regime: 'transitional'`，只當量級）。
- 樹狀：從水源 BFS 的生成樹累加下游需求。有迴路：每條弦一個迴路，Hardy Cross 迭代（數值微分，收斂到 |ΔQ| < 1e-10 m³/s），回報 `loopResidual`。
- 水源水頭沒給時取剛好滿足所有 `pMin` 的值（`source.requiredHead`、`governing` 為決定的節點）；給了 `suction` 時回報 `pump { head, flow, hydraulicW, shaftW }`。
- 局部損失 `K_FITTINGS`（Çengel & Cimbala《Fluid Mechanics》表 8-4 的典型值，示意）：90° 平滑彎（法蘭）0.3、（螺紋）0.9、45° 螺紋 0.4、斜接 90° 1.1、三通直流 0.2／0.9、分流 1.0／2.0、球閥 0.05、閘閥 0.2、球形閥 10、角閥 5、擺動逆止閥 2、入口（銳緣）0.5、出口 1.0。
- 彎管 `kBend(θ, r/D, fT)`：Crane TP-410 的 90° 彎 `K = fT × 係數(r/D)`（1:20、1.5:14、2:12、3:12、4:14、6:17、8:24、10:30…），其他角度依 θ/90 折算（近似）；fT = 完全紊流摩擦係數。
- 水的物性 `water(T)`：密度（Thiesen 型式公式）、黏度（Vogel 方程式），20 °C 為 998.2 kg/m³、1.002e-3 Pa·s。

## 電壓降（`cable.js`）

- 導體電阻 `R(T) = R20·(1 + α·(T − 20))`；R20 用 `CABLE_PV` 表值或 `ρ20·L/A`（銅 1/58、鋁 0.028264 Ω·mm²/m；α 銅 0.00393、鋁 0.00403）。
- 直流 `ΔV = 2·L·I·R'`；單相 `2·L·I·(R' cosφ + X' sinφ)`；三相 `√3·L·I·(R' cosφ + X' sinφ)`，X' 預設 0.08 Ω/km（示意）。
- `stringDrop({ modules, vmp, imp, length | route, slack, cable, T })`：組串電壓、ΔV、%、損失 W；`route` 給配管路徑時取展開長度 × slack。光伏線導體溫度預設 70 °C（示意）。

## 3D（`build.js`）

- `routeCurve(route)`：`CurvePath`（`LineCurve3`＋自訂 `ArcCurve3`），曲線長度＝展開長度。
- `routeTube(route, { radius })`：單一 `TubeGeometry` 網格（要流動貼圖時用）。
- `createPipeBatch().add(route).build()`：直管一種管徑一個 `InstancedMesh`（單位圓柱縮放），彎頭依（管徑, R, 角度）共用一份 `TorusGeometry` 再用 `InstancedMesh` 擺放。
- `trayGeometry(route, { width, height })`／`routeTray`：U 形斷面沿路徑掃掠（up 平行傳遞，垂直段不翻轉）。

## 檢查列（`checks.js`）

| 函式 | 項目 |
|---|---|
| `routeChecks(route, limits)` | 彎曲半徑 ≥ 最小值、相鄰彎之間有足夠直管、坡度（方向與最小坡度）、彎頭為標準角度、導線管彎曲合計 ≤ 360°、槽／管內線材彎曲半徑、對地淨空或埋管覆土（給 `height` 才查） |
| `hydraulicChecks(result, limits)` | 流速 0.3～3 m/s、各出水點壓力 ≥ 需求、迴路收斂、泵揚程上限 |
| `voltageDropChecks(items, { maxPct })` | 直流電壓降 ≤ 1.5 %（示意） |

## 測試

```powershell
node --import ./core/tools/register.mjs --test "TEMP/struct-dev/test/*.test.mjs"
```
