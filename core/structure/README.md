# core/structure — 參數化光伏鋼構（原型）

固定式支架與水平單軸追日支架，依地形逐支算出立柱（基樁）、斜樑、檁條、斜撐、扭力管、模組檁條的位置、切長、角度、重量與基樁埋深，彙總成 BOM；3D 用每種構件一個 `InstancedMesh`。

- 純計算（`profiles`、`members`、`rack`、`tracker`、`loads`、`checks`）不依賴 three，Node 直接跑；3D 在 `build.js`。
- 決定性：沒有亂數、沒有時鐘；同參數兩次結果逐位元相同。
- 單位：幾何 mm、Y 朝上；重量 kg；載重 Pa／kN。

## 座標與參數

- 列沿 +X。固定式的模組朝 +Z 傾斜（低邊在 +Z、往 −Z 升高），+Z 是受光方向；北半球案場把 root 轉到 +Z 朝南。第 r 列低邊在 `z = origin[1] − r·pitch`。
- 追日的轉軸沿 +X，在 `z = origin[1] − r·pitch`；轉角 φ > 0 時模組法向往 +Z 傾（右手定則繞 +X）。
- 地形 `height(x, z) → y`（mm）。

| 函式 | 用途 |
|---|---|
| `layoutFixedRack(params)` | 固定式：`module {L,W,T,kg,wp}`、`orientation`（portrait／landscape）、`up`（坡向片數）、`across`、`gap`、`tilt`、`clearance`（模組下緣最小離地）、`rows`、`tablesPerRow`、`pitch`、`tableGap`、`pileSpacing`、`overhang`、`posts`（1／2）、`postAt`、`purlinAt`、`purlinStock`、`maxRowSlope`、`braceFoot`、`rowBraces`、`pile {embed｜length, minEmbed, maxReveal}`、`profiles {pile, rafter, purlin, brace}`、`height` |
| `layoutTracker(params)` | 追日：`up`（1P／2P）、`across`、`pitch`（軸距）、`pileSpacing`、`overhang`、`maxAngle`、`clearance`（最大轉角時）、`pivot`、`bearingDrop`、`follow`（'line'／'terrain'）、`maxRowSlope`、`railsPerModule`、`pile`、`profiles {pile, tube, rail}`、`height` |
| `bom(members, { cutRound })` | 依斷面（`byProfile`）、依構件類型（`byKind`）彙總支數、總長 m、重量；`cuts` 是切長清單（進位到 cutRound） |
| `structureChecks(layout, limits)` | `layoutChecks` 列（見下） |
| `groupLoads(layout, site)`、`windPressure`、`snowOnPlane`、`cfMonoslope`、`snowMu1` | 風、雪載重**估算**（見下） |
| `rotatePoint(p, pivot, deg)` | 追日可動件轉角後的位置（不需要 three） |
| `pvFixedRack.create(p)`、`pvTracker.create(p)` | 照 core/models 的 `meta`＋`create` 慣例：回傳 `{ root, set, meshes, layout, members, bom, summary, meta, checks }`；追日 `set({ angle })` |
| `buildStructure(layout, opts)` | layout → 3D（`materials {galv, module}`、`modules: false`、`buried: false` 只畫外露段） |

### 依地形的算法

- **固定式**：每張桌是剛性平面。沿列坡度 `gx` 取桌中線地面的最小平方直線，限制在 ±`maxRowSlope`；桌面高度取「所有取樣點（框架位置與兩端 × 斜長 0、¼、½、¾、1）的模組下緣離地 ≥ clearance」的最小值。斜樑留在 YZ 鉛直面內，同一框架的前後樁在同一條 x 線上。
- **基樁**：樁頂跟著支架（斜樑下緣），地面跟著地形。`pile.embed` 給定 → 埋深固定、樁長 = 外露 + 埋深；`pile.length` 給定 → 樁長固定、埋深 = 樁長 − 外露（檢查 ≥ minEmbed）。
- **追日 'line'**：每列一直線（坡度＝地面擬合，限制在 ±maxRowSlope）；**'terrain'**：每支樁外露相同，樁之間是直線段，在軸承處轉折（回報每跨坡度與轉折角）。兩種都在兩端、每支樁、每片模組兩側邊取樣，保證轉 ±maxAngle 時模組下緣離地 ≥ clearance（最低點 = 軸高 + pivot·cosφ − S/2·sinφ，水平位置 = 軸 ± (pivot·sinφ + S/2·cosφ)）。
- **檁條**：沿列跨整張桌，超過 `purlinStock` 就分段，接頭靠到最近的斜樑。

### 構件紀錄

`{ id, kind, profile, a, b, up, length, angle, mid, kg, row, table, frame, … }`；基樁另有 `ground`、`top`、`reveal`、`embed`；追日可動件（tube、rail）有 `pivot { p, d }`。`InstancedMesh` 的 `userData.members` 是實例序號 → 構件 id，點選時可以查構件。

## 斷面表（`profiles.js`，示意）

面積由尺寸用公式算，`ref` 是型錄單位重，測試要求差 ≤ 1%。冷彎件：中線長 × t 扣掉每個彎角 (1 − π/4)(ro² − ri²)，ri = t、ro = 2t；H 型鋼：2·b·tf + (h − 2tf)·tw + 4(1 − π/4)·r²；圓管：π·t·(D − t)；密度 7850 kg/m³。

| id | 公式 kg/m | 型錄 kg/m | 來源 |
|---|---|---|---|
| C75×45×15×2.3 | 3.25 | 3.25 | JIS G3350 |
| C100×50×20×2.3 | 4.06 | 4.06 | JIS G3350 |
| C125×50×20×2.3 | 4.51 | 4.51 | JIS G3350 |
| C150×65×20×3.2 | 7.51 | 7.51 | JIS G3350 |
| Z120×50×20×2.0、Z150×60×20×2.3 | 3.88、5.32 | — | 光伏支架廠常見規格，無標準表 |
| H100×100×6×8 | 16.9 | 16.9 | JIS G3192 |
| H125×125×6.5×9 | 23.6 | 23.6 | JIS G3192 |
| H150×150×7×10 | 31.1 | 31.1 | JIS G3192 |
| H200×100×5.5×8 | 20.9 | 20.9 | JIS G3192 |
| □50×2.3、□75×3.2、□100×3.2、□125×4.5 | 3.34、7.01、9.52、16.6 | 同左 | JIS G3466 STKR |
| RHS100×50×2.3 | 5.14 | — | 公式 |
| ○114.3×4.5、○139.8×4.5 | 12.2、15.0 | 同左 | JIS G3444 STK |

正式選型以供應商型錄與結構計算為準。

## 載重估算（`loads.js`）

**只是估算（示意），不是規範檢核，不代表符合任何規範。** 給評估階段抓量級。

- 風：`q = ½·ρ·V²·ce`（ρ = 1.225，ce 由使用者給、預設 1，不推算地況）；板面淨壓 `q·cf`，cf 取 EN 1991-1-4:2005 表 7.6 單坡雨庇（φ = 0）整體力係數，0～30° 內插（使用前請對照原表）。
- 雪：EN 1991-1-3:2003 單坡 μ1（0～30° 0.8，30～60° 線性降到 0），`s = μ1·Ce·Ct·sk`（水平投影），板面每 m² 垂直力 `s·cosα`。
- `groupLoads` 給每張桌（每列）的面積、自重（模組＋鋼材）、風下壓／上揚、雪，以及每支樁的平均反力（未加分項係數、未做載重組合）。
- 沒有考慮：地況與高度係數、地形放大、陣風反應、前後列遮蔽、壓力中心偏心、追日支架的動態不穩定（扭轉顫振、渦振）。正式設計由結構技師依案場所在地規範計算。

## 檢查列（`structureChecks`）

| 項目 | 預設門檻 |
|---|---|
| 基樁埋深 ≥ minEmbed | 固定式 1200、追日 1500 mm |
| 基樁外露 ≤ maxReveal、外露 > 0 | 3000 mm |
| 模組下緣離地 ≥ clearance（追日為轉 ±maxAngle 時） | 600／500 mm |
| 斜樑下緣離地 | 150 mm |
| 地面沿列坡度 ≤ maxRowSlope（超過時桌面被限制） | 10 % |
| 框架間距／樁距 ≤ pileSpacing | 4000／7000 mm |
| 列間淨距、GCR | 0 mm、≤ 0.6 |
| 追日跟地形：軸承處轉折 | ≤ 1.5° |

## 測試

```powershell
node --import ./core/tools/register.mjs --test "TEMP/struct-dev/test/*.test.mjs"
```
