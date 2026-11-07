# 天候（core/weather，core 1.20.0）

太陽能案場平台第一階段的「天候」（2026-11-07 拍板）。分成畫面（雨、雪粒子）和工程數字（積雪、滑落、載重、逕流）；**工程數字都標「估算」或「示意」**，正式設計依案場適用的規範原文與結構技師。

| 檔案 | 內容 |
|---|---|
| `precip.js` | 雨、雪的畫面：每顆的位置是 (t, 編號, seed) 的解析函數，可以任意跳時間；風、陣風、雪花左右飄、雨絲 |
| `snow.js` | 斜放面板上的積雪：累積、密實、融雪、靜摩擦判斷是否滑落、Marion 式逐時滑落、發電損失；面板上的積雪塊顯示 |
| `loads.js` | 雪載重（ASCE 7-16、EN 1991-1-3、建築基準法形式）與風載重（ASCE 7-16、台灣耐風規範形式的速度壓 × 陣列係數） |
| `runoff.js` | 雨水逕流：最陡下坡方向、下緣流量與水膜、集流時間（運動波） |

範例頁 `/core/examples/weather/`：大雪後放晴（72 小時，10° 與 35° 比較積雪、滑落、發電損失、雪載重）與午後雷雨（雨絲、逕流、風載重），板面日射由 `core/solar` 算。

三角函數一律用 `core/physics/collide.js` 的 `dsin`／`dcos`／`dexp`（Node 與 Chrome 的 `Math.sin` 不保證逐位元相同，見 `physics/README.md`）。

## 雨、雪的畫面（`precip.js`）

```js
import { createPrecipView } from '@core/weather/precip.js';
const snow = createPrecipView({ kind: 'snow', area: { min: [-20000, -20000], max: [20000, 20000] }, top: 12000, intensity: 3,
  wind: [800, 200], gust: { amp: [600, 0], period: 8 }, floor: (x, z) => roofY(x, z) });
scene.add(snow.root);               // apply(t) 裡呼叫 snow.apply(t)
```

| 欄位 | 預設 | 內容 |
|---|---|---|
| `kind` | `'rain'` | `'rain'`（LineSegments 雨絲）或 `'snow'`（Points＋圓形貼圖） |
| `area`、`top`、`bottom` | ±5 m、6000、0 | 範圍（x、z）、生成與落地高度（mm） |
| `count`／`density`／`intensity` | 雨 40、雪 25 顆/m² | 沒給 `count` 用 `density × 面積`；`intensity`（mm/h）把密度乘 √(intensity ÷ 5)——**畫面密度，不是物理雨滴數** |
| `speed`、`jitter` | 雨 6500、雪 1000 mm/s；0.15 | 終端速度（2 mm 雨滴約 6.5 m/s、雪花約 1 m/s） |
| `wind`、`gust` | 0；無 | 水平風 [wx, wz] mm/s；陣風 `amp × sin(2πt／period)`，位移用解析積分 |
| `sway`、`swayHz`、`streak` | 120 mm、0.35 Hz、0.012 s | 雪花飄動幅度與頻率；雨絲長度 = 速度 × streak |
| `floor` | 無 | `(x, z) => y`：落到屋頂或地形下就藏起來（不累積、不濺起） |

每顆的規則：速度、相位固定；第 k 次落下的水平位置由 `hash(編號, k)` 決定（往上風挪半個漂移量，平均落在範圍內）。不碰撞、不累積，所以雨會穿過沒有給 `floor` 的屋頂。

## 面板積雪（`snow.js`，示意模型）

```js
import { snowOnPanels, snowSampler, createSnowCover } from '@core/weather/snow.js';
const r = snowOnPanels({ hours: 72, dt: 0.25, weather: t => ({ snowfall /* cm/h */, temp /* °C */, poa /* W/m² */ }),
  panels: [{ id: '10°', tilt: 10 }, { id: '40°', tilt: 40, surface: 'glass', strings: 1 }] });
r.panels[1]   // { timeline: { t, swe, depth, coverage, loss, sliding }, energyLoss, hoursCovered, clearedAt, maxDepth, slideTilt }
const cover = createSnowCover({ width: 1134, length: 2278 }); panelGroup.add(cover.root);   // 面板本地座標：x 沿寬、z 沿斜面往下、y 法向
cover.apply(snowSampler(r, '40°')(hour));
```

模型（每 dt 小時）：
1. **降雪**：新雪 SWE = 降雪（cm/h）× 10 × ρ_new（120 kg/m³）／1000 × cosβ（水平通量落在斜面）；有降雪時整片蓋滿。
2. **密實**：密度以 48 h 時間常數靠向 300 kg/m³；雪深 = SWE ÷ 密度。
3. **融雪**：0.15 mm/(°C·h) × max(T, 0)（度時法）＋ (1 − 反照率 0.8) × POA × 3600 ÷ 334 000（T > −5 °C）。
4. **滑落**：要「濕」（Marion 等 2013 的 T > −POA／80，或正在融雪）而且力平衡成立：σ sinβ > μ σ cosβ + τ（σ = SWE × g；濕用 `muWet`、τ = 0，乾用 `muDry` 與 `adhesion`）。成立時 coverage 每小時減少 0.197 × sinβ（Marion 的滑落係數，pvlib `snow.coverage_nrel` 同一式）。
5. **損失**：ceil(coverage × strings) ÷ strings（pvlib `dc_loss_nrel` 的寫法；`strings` 是沿斜面堆疊的組串數，直放單片預設 1）× (1 − e^(−雪深／10 mm))（薄雪透光，示意）。`energyLoss` 是以 POA 加權的平均。

表面（`SURFACES`，可以用 `surfaces` 覆寫）：玻璃 μ 乾 0.5／濕 0.2、附著 30 Pa；金屬浪板 0.4／0.15／20；防水膜 0.55／0.25／30；瀝青瓦 0.9／0.6／80。文獻的雪—玻璃摩擦係數 0.05～0.6，依溫度與雪質，**這組是示意值**：濕玻璃臨界角 atan 0.2 ≈ 11.3°，所以 10° 不滑、40° 會滑；乾雪在 40° 要 SWE > 12 mm（約 10 cm 新雪）才會整片滑下。

`slideCheck({ tilt, surface, swe, wet })` 單獨算一個狀態的驅動、阻力與臨界傾角。

**全年發電的積雪損失**：`snowLossSeries({ weather, poa, tilt, surface, strings })` 把天候檔逐時跑一次 `snowOnPanels`，回傳每筆的平均損失 `loss`，交給 `core/solar` 的 `simulate({ hourlyLoss })`（範例見 `solar/README.md`）。降雪用天候的 `snowfall`（cm/h），沒有就用 `snowDepth`（cm，EPW 第 30 欄）的增量（≥ `threshold` 1 cm 才算）。追日的傾角會變，這裡只接受固定傾角：用下雪時的收藏角或平均傾角。

限制：面板下緣的雪堆（落在地上堆高後擋住滑落）、風吹雪、雪簷、面板發熱（逆偏壓融雪）都沒有；同一片的雪深視為均勻。

## 雪、風載重（`loads.js`，估算）

```js
snowLoad({ method: 'asce7', ground: 1.0 /* pg kN/m² */, tilt: 30 })        // → { flat 0.84, slopeFactor 0.727, sloped 0.611, perPanelArea, normal, tangential }
snowLoad({ method: 'en1991', ground: 1.0 /* sk */, tilt: 40 })
snowLoad({ method: 'jis', depth: 50 /* cm */, unitWeight: 20, tilt: 30 })
const q = velocityPressure({ code: 'tw', V: 42.5, z: 3, exposure: 'C' }).q   // 836 N/m²
panelWindLoad({ q, tilt: 20, area: 2.58 })                                   // → { Cdown 0.83, Cup 1.03, down, up（N/m²）, forceDown, forceUp（N） }
```

| 項目 | 公式 | 待核對 |
|---|---|---|
| ASCE 7-16 雪 | pf = 0.7 Ce Ct Is pg；ps = Cs pf；Cs：光滑（PV 玻璃）在 Ct ≤ 1.0／1.1／≥ 1.2 時 5°／10°／15° 以下為 1、70° 為 0；不光滑 30°／37.5°／45° | ASCE 7-22 改了雪載重圖與部分係數 |
| EN 1991-1-3 雪 | s = μ1 Ce Ct sk；μ1 = 0.8（≤ 30°）、0.8(60 − α)／30、0（≥ 60°） | 下緣有擋雪時不得折減 |
| 建築基準法形式雪 | S = Cs P Zs；P = 20（多雪區 30）N/m²/cm；Cs = √cos(1.5β)（β ≤ 60°） | JIS C 8955:2017 對架台的規定 |
| ASCE 7-16 速度壓 | q = 0.613 Kz Kzt Kd Ke V²；Kz = 2.01 (z／zg)^(2／α)，z ≥ 4.57 m | |
| 台灣耐風規範形式速度壓 | q = 0.06 K(z) Kzt (I V10)² kgf/m²；K(z) = 2.774 (z／zg)^(2α)；A／B／C：α 0.32／0.25／0.15、zg 500／400／300 m | **最小高度 zs（暫定 18／9／4.5 m）**、各地 V10 |
| 陣列淨風壓 | p = q G C；JIS C 8955 地面型陣列 正壓 0.65 + 0.009θ、負壓 0.71 + 0.016θ（θ 15～45°） | 用 ASCE 的 q 時要換 G = 0.85 與 ASCE 開放式單斜屋頂的 CN |

單位：雪 kN/m²（`sloped` 是每 m² 水平投影，`perPanelArea` 每 m² 面板），風壓 N/m²，力 N。結果都帶 `estimate: true` 和 `note`（用了哪個公式）。

## 雨水逕流（`runoff.js`，示意）

```js
runoff({ tilt: 20, azimuth: 180, length: 2278, width: 1134, intensity: 50, n: 0.010 })
// → { dir（最陡下坡單位向量）, S, Q 0.032 L/s, q（每 m 寬）, depth 0.16 mm, velocity 0.18 m/s, tc 12 s, drain, warnings }
```

- 流向：重力扣掉法向分量 d = g − (g·n) n；`azimuth` 是面板朝向（下坡方向）的方位角，0 = +z、90 = +x（站點的南北方向由專案決定）。
- 流量：合理化公式 Q = C i A ÷ 3600（A 用水平投影面積）；下緣水膜用寬淺水流的 Manning 式；集流時間用運動波（Ragan & Duru 1972 SI 形式）tc = 6.99 (nL)^0.6 ／ (i^0.4 S^0.3) 分鐘；雨停後的排乾時間取同量級。
- Manning n：玻璃 0.010、金屬 0.012、防水膜 0.013、髒污面板 0.015。傾角 < 5° 時回傳提醒（自清差、下緣積水）。
- `panelRunoff(panels, i)`：多片加總流量、取最長集流時間。一排面板串接時把 `length` 加總當一片。

限制：沒有邊框擋水、面板之間的縫、排水溝容量；不算清洗與髒污損失（之後接 `core/solar` 的發電量時再做）。
