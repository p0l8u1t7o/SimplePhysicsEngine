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

## 限制

- 遊戲物理引擎的接觸模型：堆疊與撞擊時有幾 mm 的穿透；細長或很薄的物體要注意（固定物不要比 10 mm 薄）。
- 皮帶是摩擦帶動，橫躺的圓柱會滾動（中心速度比皮帶慢），這是真的會發生的；不想滾就把 `spin` 調小讓它立著或順著皮帶方向。
- 換 Rapier 版本後軌跡會變（雜湊不同），範例的檢查只比 Node 與瀏覽器、前後兩次是否相同，不鎖定固定的雜湊。
