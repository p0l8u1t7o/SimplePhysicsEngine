# core/physics：剛體動力學（Rapier 決定性版）

評估平台 Q8（2026-10-06，core 1.13.0）。拍板：**Rapier 決定性版放 `core/vendor/rapier/`；預先模擬、烘焙成軌跡，`apply(t)` 只取樣**（播放列可以拖、倒著拖，決定性檢查照常）。用途：輸送物料流、掉落／滑槽／投料、料箱堆積與隨機取料、夾取穩定與加減速。**現有站不強制改用**。

範例與說明：`/core/examples/physics/`（四個情境，選情境、播放、拖曳時間軸，右上角是分析數字），設定在 `examples/physics/scenarios.js`，照抄改尺寸就能用。

## 用法

```js
import { bake, createPhysicsView } from '@core/physics/physics.js';
import { flowStats } from '@core/physics/analysis.js';

export async function createProject({ scene, headless }) {
  const baked = await bake(spec);                 // 固定步長模擬整段時間（幾百 ms），瀏覽器與 Node 逐位元相同
  const view = createPhysicsView(baked);          // 每個物體一個網格（名稱 physics:<id>），出生前與消失後隱藏
  scene.add(view.root);
  return {
    total, apply(t) { view.apply(t); /* 其他動作 */ },
    physics: baked,                               // 給 check.mjs 的 physics 檢查（可以是陣列）
    verify: { physics: { restTol: 8, budgetMs: 10000 } },   // 可省略
  };
}
```

`createProject` 可以是 `async`（檢查程式會 `await`）。網頁裡烘焙一次就好，之後只取樣；烘焙時間幾百 ms，所以不需要另外存快取，單一 HTML 匯出會把 `rapier.mjs` 一起內嵌（約 4.4 MB），離線也能播放。

## spec（長度 mm、時間 s、質量 kg、密度 kg/m³、角度度，y 朝上）

| 欄位 | 內容 |
|---|---|
| `duration`、`dt`（預設 1/240）、`hz`（軌跡取樣率，預設 60）、`seed`、`gravity`（預設 9810）、`iterations`（求解器迭代，預設 8） | 模擬設定 |
| `statics: [{ id, shape: 'box'｜'cylinder'｜'sphere', size, pos, rot, friction, restitution }]` | 固定物：地面、牆、料箱、滑槽、護欄（`size` 方塊是 `[x, y, z]`，圓柱 `{ r, h }`，球 `{ r }`） |
| `conveyors: [{ id, size, pos, rot, speed, dir = [1, 0, 0], friction }]` | 輸送帶：速度型的 kinematic 剛體，速度 = 皮帶速度，靠摩擦帶動上面的物體；每一步後放回原位 |
| `spawners: [{ id, at, spread, every, start, count, spin, velocity, items: [{ name, shape, size, density, friction, restitution, angularDamping = 0.5, color, weight }] }]` | 依序產生物體：隨機挑 `items`（`weight` 加權）、位置在 `spread` 內、轉 `spin` 度內（亂數由 `seed` 決定）。生成的位置被別的物體占住就等下一步（照順序）；只碰到固定物就往上抬 5 mm；一步最多生成一個 |
| `sinks: [{ id, min, max }]` | 物體中心進入這個方塊就移除（被取走、掉出畫面） |
| `kinematics: [{ id, shape, size, pose: t => ({ pos, rot }), friction }]` | 照時間移動的治具（推桿、擋板、吸盤載具） |
| `holds: [{ by, from, to, radius = 60 }]` | 吸附：`from` 時抓起離載具 `by` 最近的物體，跟著載具動，`to` 時放開並給載具的速度 |
| `grippers: [{ id, pose, finger = [12, 50, 40], open = 40, force = 20, closeAt, openAt, friction = 0.6, mass = 0.1 }]` | 兩指平行夾爪：載具照 `pose(t)` 移動；手指是動態剛體，用滑軌關節接在載具上，`closeAt`～`openAt` 之間每指用 `force`（N）往內夾，兩指中點用彈簧阻尼保持同步。工件只靠摩擦被夾住，所以夾持力不夠、加速度太大時會滑 |

## 結果（`bake` 回傳）

`{ spec, dt, hz, duration, frames, bodies: [{ id, item, shape, size, color, born, died, frames }], kinematics: [{ id, shape, size, frames }], stats }`

- `frames` 是 `Float32Array`，每格 7 個數（位置 mm、四元數）；第 f 格是時間 f / hz 的狀態。
- `stats`：`bodies`、`steps`、`maxPenetration`（靜止接觸的最大穿透：兩邊都比 50 mm/s 慢的接觸，畫面上看得到的）、`peakPenetration`（含瞬間撞擊，只當資訊）、`ms`、`hash`（軌跡的雜湊，決定性比對用）。
- `sampler(baked)(t)`：任一時間的 `[{ id, visible, pos, quat }]`（線性內插、四元數 nlerp）。

## 分析（`analysis.js`）

| 函式 | 用途 |
|---|---|
| `flowStats(b, { axis, at, from, to, region })` | 物料流：通過 `axis = at` 那條線的件數、每分鐘產能、間隔，以及 `region` 內的平均密度（件／m） |
| `settleTime(b, { speed = 5, ids })` | 全部（或指定的）物體都慢於 `speed` mm/s 的時間 |
| `landings(b, { region })` | 每個物體第一次進入落點區的時間與位置 |
| `pileStats(b, t, { region, approachDeg = 30, clearance = 40 })` | 料箱：箱內件數、堆高、可以從正上方抓的件（上下軸和垂直方向夾角 ≤ approachDeg、上方沒有別的件擋） |
| `slip(b, bodyId, kinId, { from, to })` | 夾取穩定：物體在夾爪（載具）座標裡的最大位移與結束時的位移 |

## 檢查

- 站的 `physics` 檢查（`check.mjs` 內建，快速）：`project.physics` 的每份烘焙再烘焙一次雜湊要相同（沒有用 `Math.random` 或時間）、靜止接觸穿透 ≤ `restTol`（預設 8 mm）、烘焙時間 ≤ `budgetMs`（預設 10 s）。沒有用物理的站略過。
- 全場干涉（`scene`）：祖先有 `userData.physics` 的網格（`createPhysicsView` 的網格都有），和任何零件的穿插門檻放寬到 `restTol`（接觸本來就有幾 mm 的穿透）。
- core 的 `physics`：`examples/physics/check.mjs` 在 Node 烘焙四個情境兩次逐位元相同、無頭 Chrome 烘焙的雜湊和 Node 相同，並檢查分析數字（物料流有通過、滑槽全部落進料箱、料箱有可抓取的件、夾持力 20 N 夾得住、3 N 會掉）。

## 線材、軟管（`rope.js`，XPBD，core 1.17.0）

不載入 Rapier 的純 JS 位置式動力學：錨點釘在會動的位置（手臂工具端、拖鏈出口、電盤接頭），中間受重力下垂、跟著擺動，被地面、方塊、圓柱、球擋住。一樣是烘焙一次、`apply(t)` 只取樣。

```js
import { bakeRope, createRopeView, ropeStats } from '@core/physics/rope.js';
const rope = bakeRope({ name: '手臂電纜', length: 1800, segments: 30, radius: 6, duration: total,
  anchors: [{ at: 0, pos: [0, 1200, 0] }, { at: 1, pos: t => toolEnd(t) }],            // pos 可以是固定點或 t => [x, y, z]
  colliders: [{ shape: 'plane', y: 0 }, { shape: 'box', size: [200, 400, 300], pos: [500, 200, 0] }] });
const view = createRopeView(rope, { color: CABLE.power }); scene.add(view.root);     // apply(t) 裡呼叫 view.apply(t)
// project.physics 放 rope（可以和剛體的烘焙一起放陣列）：physics 檢查會重烘比雜湊，並檢查線長
```

| 欄位 | 內容 |
|---|---|
| `length`、`segments`（預設 24）、`radius`（預設 5） | 線長 mm、分段數、管半徑（碰撞與顯示） |
| `dt`（1/240）、`substeps`（8）、`iterations`（每子步 4）、`hz`（60） | 子步比多迭代有效：1/240 s × 40 次迭代仍有 5% 伸長，8 子步 × 4 次只剩 0.5% |
| `stretch`（0）、`bend`（0.1）、`damping`（2／s）、`friction`（0.4）、`settle`（1.5 s） | 拉伸柔度（0 = 不可伸長）、彎曲柔度（越大越軟；氣管 0.3、粗電纜 0.02 左右）、阻尼、接觸摩擦、t = 0 前先靜置的時間 |
| `anchors: [{ at: 0～1, pos }]` | 釘住的位置（沿線長的比例；至少兩個） |
| `colliders` | `plane`（`y`）、`box`（`size`、`pos`、`rot`）、`sphere`（`r`、`pos`）、`cylinder`（`r`、`h`、`pos`，軸沿 y） |

結果的 `stats`：`maxStretch`（整段時間的最大伸長率）、`minY`、`maxPenetration`、`hash`；`ropeStats(rope)` 另外算最大下垂。`physics` 檢查對線材多一項：**最大伸長率超過 `verify.physics.stretchTol`（預設 3%）就失敗**——兩端在某個時刻比線長還遠，實機上線會被扯，要加長線或改走線。範例：`/core/examples/physics/?s=cable`（線長 1.8 m 伸長 0.5%；改成 1.1 m 時 13%，檢查會擋）。

限制：線和線之間不互相碰撞；不算扭轉；彎曲是「隔一點的距離」近似，不是真的彎曲剛性，彎曲半徑限制要另外檢查。


## 布料與粒子流體（`cloth.js`、`fluid.js`、`collide.js`，core 1.20.0）


和 `rope.js` 同一套用法：**烘焙一次、`apply(t)` 只取樣**，可以拖、倒著拖；Node 與瀏覽器逐位元相同（`stats.hash`）；不載入 Rapier。

| 檔案 | 內容 |
|---|---|
| `collide.js` | 布料與流體共用的碰撞形狀（plane、box＋rot、sphere、直立 cylinder、開口方槽 `tank`、圓桶 `drum`；`pos` 可以是 `t => [x, y, z]`）、連續碰撞、決定性的 `dsin`／`dcos`／`dexp`、`rng`、`fnv` |
| `cloth.js` | XPBD 布料、薄膜、軟墊：`bakeCloth`、`clothSampler`、`clothStats`、`createClothView` |
| `fluid.js` | Position-Based Fluids（Macklin & Müller 2013）：`bakeFluid`、`fluidSampler`、`fluidStats`、`createFluidView` |

### 決定性：時間函式裡不要用 `Math.sin`

2026-11-07 實測 Node 26.13（V8 14.6）與 Chrome 157 的 `Math.sin`、`Math.cos`、`Math.exp`、`Math.atan2` 有 3～15% 的輸入差 1 ulp（`pow`、`hypot`、`sqrt` 相同）。烘焙只要用到一次，雜湊就不同。

- 解算器本身只用加減乘除與 `Math.sqrt`；旋轉矩陣（`rot`）改用 `collide.js` 的 `dsin`／`dcos`（fdlibm 多項式，只用四則運算，誤差 < 1e-14）。
- **站裡寫的 `pos(t)`、`move(t)`、風速函式要用 `dsin`／`dcos`**，不要用 `Math.sin`。
- 影響現有 core：`rope.js` 註解寫「錨點函式裡的 Math.sin 在 Node 與瀏覽器實測相同」不再成立（範例的 `cable` 只用 `smooth()`，所以檢查還是過）；`physics.js` 的 `quatOf` 也用 `Math.cos`／`sin`（現有 check 會過，代表用到的角度剛好相同）。建議 core 一起改用 `dsin`／`dcos`（rope 的雜湊不變，剛體情境有 `rot` 的可能變）。

### 布料 `bakeCloth(spec)`

```js
import { bakeCloth, createClothView, clothStats } from '@core/physics/cloth.js';
import { dsin } from '@core/physics/collide.js';
const tarp = bakeCloth({ name: '篷布', size: [1800, 1600], segments: [36, 32], origin: [0, 1100, 0], duration: total,
  pins: [{ corners: true, move: t => [0, -250 * smooth(t / 1.5), 0], until: 2 }],          // 四角吊著往下，2 s 放開
  wind: { velocity: t => [900 * dsin(t), 0, 0], drag: 1 },
  colliders: [{ shape: 'plane', y: 0 }, { shape: 'box', size: [1000, 700, 800], pos: [0, 350, 0] }] });
const view = createClothView(tarp, { color: 0x2f7d5b }); scene.add(view.root);          // apply(t) 裡呼叫 view.apply(t)
// project.physics 放 tarp（可以和剛體、線材的烘焙放同一個陣列）
```

| 欄位 | 內容 |
|---|---|
| `size: [U, V]`、`segments: [nu, nv]`（20 × 20）、`origin`、`axes`（`'xz'` 水平、`'xy'`／`'zy'` 直立，或 `{ u, v }`） | 布的尺寸、網格、中心、方向；節點 (i, j) 的編號 = j × (nu + 1) + i |
| `thickness`（3） | 碰撞半厚 mm |
| `dt`（1/240）、`substeps`（8）、`iterations`（每子步 2）、`hz`（60） | 和線材一樣，**子步比迭代有效**：小布 8 → 16 子步伸長 1.7% → 0.85%，2 → 4 次迭代幾乎不變 |
| `stretch`（0）、`shear`（0.001）、`bend`（1） | 拉伸、剪切（對角）、彎曲（隔一點）柔度；布 1～10、軟墊 0.01～0.1 |
| `damping`（1／s）、`friction`（0.5）、`gravity`、`settle`（0 s） | |
| `pins: [{ node \| nodes \| edge: 'u0'\|'u1'\|'v0'\|'v1' \| corners, pos?, move?, until? }]` | `pos`（單一節點的絕對位置，可為函式）、`move`（整組相對起始位置的位移函式）、`until` 之後放開 |
| `colliders` | `collide.js` 的形狀；會動的碰撞體（`pos` 是函式）摩擦以碰撞體為參考（被移動的板子帶著走） |
| `wind: { velocity, drag = 2 }` | 每個節點依面積加權法向受「法向相對風速 × drag」的加速度 |
| `selfCollision: true | { radius }` | 自我碰撞：不相鄰的節點（靜止時距離 ≥ 2·radius）保持 2·radius；radius 預設 0.45 × 格距；空間雜湊、依節點編號順序（決定性）。摺疊、堆疊時才開：600 mm 布對摺的測試慢約 3.4 倍，上層停在下層上方約 2·radius（不開時大部分節點穿下去貼地）。stats 多 `selfRadius`、`selfMin` |

結果：`{ kind: 'cloth', data（Float32，frames × 節點 × 3）, segments, stats: { nodes, constraints, steps, maxStretch, minY, maxPenetration, hash, ms } }`；`clothStats(b, { region })` 另外給結束時的外框與落在 region 的節點比例。

限制：自我碰撞只在節點之間（`selfCollision`），網格的邊與面沒有連續碰撞，摺得很快或格子很粗時還是可能穿過；碰撞以節點計（細的邊角會從網格之間穿過，`thickness` 要大於物體的尖角）；彎曲是「隔一點的距離」近似；沒有撕裂。

### 流體 `bakeFluid(spec)`

```js
import { bakeFluid, createFluidView, fluidStats } from '@core/physics/fluid.js';
const fluid = bakeFluid({ name: '注入方槽', spacing: 10, duration: 5, max: 4000,
  emitters: [{ type: 'nozzle', pos: [0, 500, 0], dir: [0, -1, 0], speed: 1500, flow: 40, stop: 3 }],     // 40 L/min 注入 3 s
  colliders: [{ shape: 'tank', size: [300, 300, 200], wall: 10, pos: [0, 0, 0] }],
  kill: [{ min: [-1e5, -1e5, -1e5], max: [1e5, -200, 1e5] }], contain: { min: [-150, -1, -100], max: [150, 400, 100] } });
const view = createFluidView(fluid, { mode: 'spheres' }); scene.add(view.root);
fluidStats(fluid, t, { region }) // → { count, outside, volumeL, level（體積 ÷ 面積）, surface（95 百分位的 y） }
```

| 欄位 | 內容 |
|---|---|
| `spacing`（10 mm）、`kernel`（2 × spacing） | 一顆粒子 = spacing³ 的液體（10 mm → 1 mL；35 mm → 43 mL，5000 顆約 200 L） |
| `dt`（1/120）、`substeps`（1）、`iterations`（3）、`hz`（30） | 1/120 s 單步在 1.5～3.5 m/s 的注入下不漏（有連續碰撞）；1/60 s 會穿過 10 mm 的壁 |
| `max`（5000） | 同時存在的上限，到了就停止注入（`stats.capped`） |
| `viscosity`（XSPH 0.02）、`vorticity`（0；50～500 mm/s 量級）、`relax`（0.05）、`clamp`（0.2 × spacing）、`friction`（0.1）、`wallDensity`（true） | `clamp` 限制每輪修正量（不然衝擊處會像彈簧一樣把粒子彈出槽外）；`wallDensity` 補上牆後的密度（不然粒子擠向牆、液位矮 20%） |
| `emitters` | `nozzle`：`pos`、`dir`、`speed`，以及 `radius`／`rate`（顆／s）／`flow`（L/min）其一、`start`、`stop`、`count`；給 `rate`／`flow` 時層距微調，流量剛好符合。`fill`：`min`、`max` 方塊排滿（初始液體） |
| `colliders`、`kill: [{ min, max }]`、`bounds` | 碰撞、移除區（排水口、掉出畫面）、離開就移除的範圍 |
| `contain`（選用） | 容器內部；檢查提案會用它算「留在容器內的比例」 |

結果：`{ kind: 'fluid', data, lo, offsets（每格記錄編號 [lo, lo + n) 的位置，中間被移除的填 NaN）, emitted, stats: { particles, alive, peak, killed, capped, steps, avgDensityError, maxDensityError, neighborOverflow, maxPenetration, emitters: [{ radius, perLayer, rate, flowLmin }], hash, ms } }`。

演算法：每步 預測 → 密集格子（格邊 = 核半徑／2，同一列五格在排序後連續）找鄰居、範圍太大時退回空間雜湊（都依粒子編號，順序固定）→ 3 輪單向密度約束（只在壓縮時推開，Poly6 密度、Spiky 梯度）＋牆面密度＋修正上限＋碰撞（上一步所在的一側推出、薄板與圓桶壁的連續碰撞）→ 速度 → XSPH →（選用）渦度補償。

烘焙時間（本機 24 執行緒，**背景有完整檢查在跑**，單執行緒）：

| 情境 | 粒子 | 長度 | 烘焙 |
|---|---|---|---|
| 注入方槽（範例 `fill`） | 2000 | 5 s | 1.7 s（Chrome 1.8 s） |
| 注入方槽 60 L/min × 4 s | 4000 | 6 s | 3.9 s |
| 注入方槽 60 L/min × 5 s | 5000 | 10 s | 10.2 s |
| 小情境（斜噴嘴＋初始液塊＋渦度） | 約 800 | 1.5 s | 0.23 s |

大約 2 µs／粒子・步。網頁上超過 3 s 的烘焙建議放 Web Worker（決定性不受影響）。

**休眠**（`sleep: { speed = 15, fraction = 0.01, after = 0.5 }`，預設關，2026-11-08）：注入都結束、碰撞面都不動，而且相鄰兩個記錄格之間比 `speed`（mm/s）快的粒子不超過 `fraction`、連續 `after` 秒，就停止模擬，之後的格沿用停下時的狀態（`stats.sleptAt`）。用格間位移而不是子步速度判斷：PBF 靜置後子步的 v 還有幾十 mm/s 的約束雜訊，表面也有少數粒子一直以 10～20 mm/s 微動。範例 `fill` 延長到 8 s 時在 5.7 s 停下，表面高度和不休眠差 0.01 mm、烘焙時間少約 25%。

精度（範例 `fill`）：平均壓縮誤差 1.0%；表面（95 百分位粒子中心＋半顆）比「體積 ÷ 面積」矮約 7%（自由表面的粒子缺鄰居、離散）。牆面密度關掉時矮 20%。

限制：這是畫面用的粒子，不是 CFD（流量、壓降用 1D 管網水力；流場用外部 OpenFOAM）；沒有表面張力（單向約束、不黏）；粒子太少時液面是一顆顆的（螢幕空間流體的外觀不在範圍內）；圓桶的壁與底板、圓柱的上下面有連續碰撞（2026-11-08；方塊三軸都有），圓柱的側面沒有（細桿被快粒子橫向穿過時會漏）；牆面密度把碰撞面當局部平面，內角會重複計算一點（往內推得稍多）。

## 限制

- 遊戲物理引擎的接觸模型：堆疊與撞擊時有幾 mm 的穿透；細長或很薄的物體要注意（固定物不要比 10 mm 薄）。
- 皮帶是摩擦帶動，橫躺的圓柱會滾動（中心速度比皮帶慢），這是真的會發生的；不想滾就把 `spin` 調小讓它立著或順著皮帶方向。
- 換 Rapier 版本後軌跡會變（雜湊不同），範例的檢查只比 Node 與瀏覽器、前後兩次是否相同，不鎖定固定的雜湊。
