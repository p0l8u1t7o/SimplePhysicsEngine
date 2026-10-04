# 第二段範例：電控、電盤、配線、相機子畫面、視覺疊圖

第一段（場景、排程、視角、播放列、手機版面）完成後，第二段加上電控配置、電盤、外露線路與拖鏈、相機與相機子畫面、視覺疊圖。
這個範例接在 `core/template` 的「輸送線＋龍門」場景上，`check.mjs` 會讓它跟著 core 一起檢查（`core · examples`），所以照抄一定能過檢查。

| 檔案 | 內容 |
|---|---|
| `segment2.js` | `SCHEDULE`（背板元件表）與 `createSegment2(scene, { gantry, cab, cam })`：電盤櫃、背板、穿板接頭、拖鏈、外露線路、相機與立柱 |
| `check.mjs` | 單獨建場景、台車走完行程，跑電控與配線檢查 |

## 1. 場景（`web/js/electrical.js`＋`project.js`）

把 `segment2.js` 複製成專案的 `web/js/electrical.js`，**import 改成 `@core/…`**（範例在 core 裡面，用的是相對路徑）：

```js
import { component } from '@core/electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryGland, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, carrier, CABLE } from '@core/electrical/cable-routing.js';
import { create as visionCamera } from '@core/models/camera.js';
```

再依配置改座標、元件表與走線。`project.js` 裡：

```js
const elec = createSegment2(scene, { gantry, cab: { center: [1600, 450, -500], size: [600, 900, 400] }, cam: { at: [-600, 1250, 0], postZ: 450 } });
// apply(t)：拖鏈跟著軸走（超出 min～max 會丟錯），光源依取像時機亮
elec.set({ x: G.x - g.cx, light: 取像中 ? 1 : .15 });
// 回傳值加上 visionCamera: elec.camera，verify 加上配線動態取樣：
verify: {
  cables: { obstacles: () => [/* 會動的機構與要讓開的固定件的 Mesh，不含線材本身 */], interval: .2 },
}
```

| 元件 | 寫法與規則 |
|---|---|
| 電盤櫃 | `cabinetShell(parent, 名稱, { center, size, entries: [{ x, z, hole, wire }], thickness })`：中空櫃、可拆門（剖視時隱藏）、頂板真的開孔。`entries` 用櫃內座標 |
| 背板 | `controlPanel(parent, 名稱, { center, width, height, backZ, schedule })`：`backZ` 是櫃背板內面，背板中心離它 42 mm（固定柱）。頂端 0.3×高是端子台（`ports` 12 個），元件列放在它下面 |
| 元件表 | `schedule = [{ y, items: [component({ id, kind, title, size: [W,H,D], role, category, source, description, model }) …] }]`：一列寬度總和（含 14 mm 間隔）< 背板寬 × 0.83。`source` 是上游元件 id，櫃內連線會自動從它拉過來 |
| 穿板接頭 | `entryGland(parent, 名稱, { at: [x, 櫃頂, z], hole, wire, thickness })`：線要從接頭中心垂直穿過（`panelFeed` 從櫃頂上方 40 mm 往下） |
| 外露線路 | `cable(parent, 名稱, 點列, { radius, color: CABLE.power｜signal｜air, clips })`：固定線。沿機構面、地面或線槽（`cableTray`）走，**不要懸空**；線端 10 mm 可以插進接頭 |
| 拖鏈 | `carrier(parent, 名稱, { origin, axis, rise, fixed, min, max, radius, width })`：定長 U 形拖鏈，放在會動那一軸的父物件下，`set(軸位置)`。放大包圍盒（半寬＋3 mm）要讓開安裝面 |
| 落地設備 | 手臂控制器等放在櫃外的元件，規格寫 `free: true`（`robotController` 另有現成外形） |

`kind`（外觀）：`isolator` `breaker` `psu` `safety` `contactor` `plc` `io` `switch` `light` `ipc` `drive` `valve` `gateway` `robot`。
`role`（`electricalActivity` 依主時間軸亮燈）：`power` `control` `network` `safety` 常亮；`motion` 動作中亮；`vision` 取像時亮；`io` 有動作就亮；`force` `vacuum` 依動作名稱。
`category`（櫃內連線顏色，`CIRCUITS`）：`ac` `dc` `network` `safety` `signal`。
型號沒指定時 `model` 用預設的「配置估算，型號待選」，說明裡標「示意」。

## 2. 相機（`core/models/camera.js`）

```js
const cam = visionCamera({ sensorW: 8.8, sensorH: 6.6, focal: 16, ring: 60 });   // 2/3" 感光元件、16 mm 鏡頭、環形光源
cam.root.position.set(x, 鏡頭前緣高度, z); scene.add(cam.root);                 // 光軸是本地 −Y（朝下）；斜看或朝上時旋轉 root
cam.fieldOfView(工作距離)  // → [寬, 高] mm，標在子畫面標題，讓使用者知道視野
```

常見感光元件（寬×高 mm）：1/2" 6.4×4.8、1/1.8" 7.2×5.4、2/3" 8.8×6.6、1.1" 14.1×10.3。視野要涵蓋工件加上定位誤差。相機要有支架（立柱、懸臂、吊板）接到結構上，不能懸空；相機線接到電盤（例如 `IPC1`）。

## 3. 網頁（`main.js`、`index.html`）

```js
import { createElectricalInspector } from '@core/electrical/electrical-inspector.js';
import { setElectricalCutaway } from '@core/electrical/electrical-cabinet.js';
import { routingLegend } from '@core/electrical/cable-routing.js';
import { createVisionOverlay, objectRegion } from '@core/ui/vision-overlay.js';

// 視角：加一個 electrical（看得到背板），setView 裡 setElectricalCutaway(scene, name === 'electrical') 讓櫃門在這個視角打開
const electrical = createElectricalInspector({ scene, camera, controls, canvas, onEnter: () => setView('electrical', true), onExit: () => setView('iso', true), title: '專案名稱' });
routingLegend();                                   // 右下角線材顏色說明
const vcam = project.visionCamera, vision = createVisionOverlay();

function render() {                                // stage.loop 的 render
  electrical.update({ time: player.T, playing: player.playing, action: 目前動作, motion: true, vision: 取像中 });
  workspace.renderCamera({ renderer, scene, camera: vcam.camera, aspect: vcam.aspect, vision,
    title: `上視相機 f${vcam.params.focal} · 視野 ${vcam.fieldOfView(450).map(Math.round).join('×')} mm`, result: 目前動作,
    marks: { title: '尺寸檢查', state: 取像中 ? '取像' : '等待', time: player.T,
      marks: 取像中 ? [{ points: objectRegion(工件), status: 'ok', label: '工件 OK' }] : [] } });   // status：ok｜ng｜pending｜preview
  workspace.renderOverview(renderer, scene);
}
```

`index.html` 的 `.views` 加 `<button data-view="electrical">電盤配線</button>`。範本原本的「取料位相機」換成模型裡的 `cam.camera`；多台相機用 `workspace.setSources([{ id, label }…])` 做來源選單。疊圖是模擬，標籤寫「SIM／示意」，不要寫成實測結果。

## 4. 檢查

`check.mjs` 內建的 `electrical`（快速檢查就會跑；場景沒有電控就略過）：

| 失敗訊息 | 意思與改法 |
|---|---|
| `Body outside cabinet` | 元件機身不完全在電盤櫃內：加大櫃子或移動背板；櫃外設備寫 `free: true` |
| `Body overlap` | 兩個元件機身重疊：調整列高 `y` 或分成多列 |
| `Wire crosses body` | 櫃內連線穿過其他元件：調整元件順序（上游放同一列左側）或列距 |
| `Declared hole is filled`、`Gland is not hollow`、`No continuous cable fitting the gland` | 接頭與開孔沒對齊，或沒有線從接頭中心垂直穿過 |
| `Cable … expanded mesh bounds` | 某條線路或拖鏈在某個時間點碰到 `verify.cables.obstacles` 裡的零件：改走線，或把拖鏈抬離安裝面 |
| `… equipment does not fit panel width` | 一列太寬：分列或加寬背板（建立場景時就會丟錯） |

不要為了過檢查把零件從 `obstacles` 拿掉；那等於用 allow 蓋掉真的干涉。
