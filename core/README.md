# core：3D 自動化動畫共用框架

本庫 `project-site/` 底下每個有 `web/index.html` 的資料夾都是一個展示專案（studio 工作區則是 `projects/`）。共用的程式、three.js、檢查工具與建置都放在這裡，各專案直接引用，不複製。

## 目錄

| 路徑 | 內容 |
|---|---|
| `vendor/` | three.js r160（`three.module.js`）與 addons，全站只有這一份 |
| `geom/` | `shapes.js`（統一形狀：block／blockBetween／cylinder／rod／tube／pipe／profile／rounded／bevelBox／screw／decal／plate／floorText）、`materials.js`（共用材質表 MAT）、`hardware.js`（倒角外殼、螺栓、腳座、馬達、感測器…）、`finish.js`、`surfaces.js`、`perforated.js` |
| `robot/` | `kinematics.js`：6 軸阻尼最小平方 IK（參數可調） |
| `models/` | 共用模型庫：每個模型有 `meta`（名稱、分類、可調參數、可動狀態、用法）與 `create(params) → { root, set(state) }`，在 `models/index.js` 登記；目錄頁 `/core/catalog/` 可預覽、調參與搜尋。共 80 個，清單見下方「共用模型」 |
| `migrations/` | 各版共用模型的換用對照（各站把自己畫的零件換成共用模型時照著改）：`1.10.0-vision.md`、`1.10.0-motion.md`、`1.10.0-equipment.md`、`1.10.0-transport.md`；1.9.0 的對照表在 `MIGRATION.md` |
| `catalog/` | 模型目錄頁（發布在 Pages） |
| `anim/` | `track.js`：時間軌與時間軸（`createTimeline`、`Track`、`smooth`），狀態只由時間決定；`sequence.js`：單一手臂的步驟序列；`arrival.js`：手臂到位閘門（播放時等手臂到位、逾時故障） |
| `electrical/` | 線材、拖鏈、電盤、電控元件（`component()` 元件表）與檢視器 |
| `examples/` | `segment2/`：第二段（電控、電盤、配線、相機子畫面、視覺疊圖）的完整範例與說明，跟著 core 一起檢查；新專案照 `examples/segment2/README.md` 做 |
| `optics/` | 機器視覺的光學計算（純函式：視野、倍率、每像素、最小缺陷、景深、運動模糊、行頻、像圈、接口、頻寬、打光）與 3D 配置檢視頁 `optics/view.html`；studio 的光學工作台、`vs3d optics eval`、相機模型共用，說明在 `optics/README.md` |
| `movie/` | 錄影程式（4K 取樣 1080p、絕對時間取樣、追焦運鏡），各專案以 `?movie` 呼叫 |
| `ui/` | `stage.js`（renderer／場景／相機／燈光／3D 標籤／視角轉場／畫面迴圈／`exposeSim`）、`player.js`（標準播放列）、`viewer-workspace`（相機視窗與焦點追隨，所有專案共用）、`vision-overlay` |
| `verify/` | 統一檢查：`scene.mjs`（全場干涉＋重合面閃爍）、`electrical.mjs`（電控配置）、`cables.mjs`（配線動態取樣）、`feedthroughs.mjs`（穿板孔）、`clearance.mjs`（有向包圍盒間距）、`determinism.mjs`（倒序一致）、`fingerprint.mjs`／`fingerprint-compare.mjs`（排程指紋，渲染補強前後比對）、`run.mjs`（執行入口）、`dom-stub.mjs` |
| `template/` | 新專案範本（`tools/new-project.mjs` 複製） |
| `tools/` | 伺服器、檢查執行器、截圖比對、場景傾印與比對（`scene-dump.mjs`）、效能量測（`perf-check.mjs`）、Pages 建置、成品匯出（`export.mjs`：網站壓縮檔、單一 HTML、MP4）、建立新專案、範圍檢查（`check-scope.mjs`、`scope-guard.mjs`、`install-hooks.mjs`）、用戶名稱檢查（`check-names.mjs`）、結構檢查（`check-structure.mjs`）（不發布） |
| `VERSION`、`REQUESTS.md` | core 版本號（語意化版本，改版紀錄在 `MIGRATION.md`）；子專案提出的 core 需求登記 |

## 新專案

```powershell
node core/tools/new-project.mjs MyStation "我的工作站" "首頁卡片上的一句說明"
```

範本已經接好標準版面（含手機／平板精簡版面與相機視窗）、舞台（`look`＋`extent`、`floor()`）、播放列、時間軸、`project.js` 與一支自有檢查，建好就能開啟、檢查，推送後自動出現在 Pages 首頁。之後在 `project.js` 建模型與時間軸，在 `main.js` 加視角與面板。

範本也帶出子專案規則：`AGENTS.md`（範圍、規格摘要、已拍板事項；建好後填入規格摘要）、`CLAUDE.md`（`@AGENTS.md`）、`.claude/settings.json`（寫檔關卡：從這個資料夾啟動的 Claude Code 只能改本站）。範圍規則見根目錄 `AGENTS.md`「範圍」。

## 引用方式

各專案 `index.html` 的 importmap：

```html
<script type="importmap">
{ "imports": {
    "three": "../core/vendor/three.module.js",
    "three/addons/": "../core/vendor/addons/",
    "@core/": "../core/"
} }
</script>
```

程式中寫 `import { block, cylinder } from '@core/geom/shapes.js'`、`import { MAT } from '@core/geom/materials.js'`。Node 端用 `core/tools/register.mjs` 解析相同名稱：

```powershell
node --import ../core/tools/register.mjs tools/verify.mjs      # 在專案資料夾
node core/tools/run.mjs <專案> tools/verify.mjs                 # 在 TestCode
```

## 網址（本機與 GitHub Pages 相同）

| 網址 | 來源 |
|---|---|
| `/` | 首頁（`tools/site.mjs` 依各專案 `project.json` 產生） |
| `/core/…` | `core/`（不含 tools） |
| `/<專案>/…` | `<專案>/web/…` |

```powershell
node core/tools/serve.mjs                 # http://127.0.0.1:8770/  首頁
node core/tools/serve.mjs Chemical        # 直接開某專案（名稱可只打開頭）
```

根目錄的 `scripts\start.ps1`（`-Station <名稱>` 直接開某一站）也是用它，停止用 `scripts\stop.ps1`。

## project.json

```json
{
  "title": "200L 化學桶自動清洗線",
  "summary": "首頁卡片上的一句說明",
  "order": 2,
  "coreVersion": "1.0.0",
  "checks": { "quick": ["tools/verify.mjs"], "full": ["tools/verify-gripper.mjs"] },
  "core": { "skip": [], "quick": [] },
  "shots": { "views": ["iso", "robot"], "skip": ["follow"] }
}
```

## 專案介面：`web/js/project.js`

網頁（`main.js`）與統一檢查用同一個函式建立場景，所以檢查的就是畫面上的幾何。

```js
export function createProject({ scene, headless }) {
  // 建立所有設備並加入 scene；不得碰 DOM（文字貼圖可用 canvas，Node 端有 dom-stub）
  return {
    total,                 // 動畫總長（秒）
    apply(t, opts) {},     // 把整個場景放到時間 t；必須只依 t 決定（倒序、跳播結果相同）
    layoutChecks() {},     // 選用：[{ group, name, ok, value, note }]
    verify: {              // 選用：全場檢查設定
      dt: .5,              //   動態取樣間隔（預設 total/400，至少 0.05 s）
      skip(obj) {},        //   非實體（尺寸標註、地面分區、天花板…）→ true
      moduleOf(mesh) {},   //   模組名稱（預設：scene 第一層子物件的 name）
      stationOf(mesh) {},  //   同模組再分工位；不同工位的固定件穿插也算相撞
      allow: [{ why, test(a, b, ctx) {} }],   // 允許的接觸，逐條寫原因；ctx.moduleOf(m)、ctx.bodyOf(m)
      envelope: ['robot'], //   回報這些模組的掃掠外圍（配置圍籬用）
    },
    // 其他給 main.js 用的物件（robot、sequence…）照常附上
  };
}
```

物件標記（`userData`）：

- `fx`：效果（噴霧、光束、氣流），不是實體，不檢查；
- `guide = 'id'`／`on = 'id'`：導軌與在其上滑行的移動件；
- `nested = 另一個關節物件`：套筒式伸縮（內外管）；
- `coreModel = 模型 id`：共用模型的根群組（模型自己標）。它只是包裝——走線把它的直接子網格當成 parent 的固定面，全場檢查判斷安裝關係時往上跳過它；
- `coreModelPart = 模型 id`：共用模型裡會動的子群組（模型自己標）；站可以把它改掛到自己的移動群組；
- `cableHost = false`：這個群組相對父群組會動，走線不拿它當線夾固定面（會移動的 root、被當關節用的可動件；模型有預設，站可以改）。

`window.sim` 至少提供：`seekTo(t)`、`setView(name, instant)`、`views`（視角名稱陣列）、`total`、`play()`、`pause()`。

## 共用模型（`core/models/`，80 個）

每個模型是 `{ meta, create(參數) → { root, params, 子物件…, set? } }`（較早的手臂、輸送線等是整個模組匯出 `meta`、`create`）。`meta.params` 是目錄頁可調的數值，`meta.options` 是程式才傳的選項，`meta.states` 是 `set()` 的狀態範圍，`meta.usage` 是用法範例。新增模型後在 `models/index.js` 登記，就會出現在目錄頁並納入 `models` 檢查。

| 分類 | 檔案與模型 |
|---|---|
| 機械手臂 | `robots/`：`fanuc-r2000ic.js`、`denso-vs068.js`、`denso-vm60b1.js`、`denso-cobotta-pro900.js`、`denso-hsr065.js`（SCARA）、`abb-irb360.js`（並聯手臂；另匯出 `createIRB360`、`deltaIK`） |
| 輸送 | `conveyor.js`：滾筒輸送線；`transport.js`：平皮帶輸送機 `beltConveyor`、邊皮帶雙軌輸送段 `edgeBeltConveyor`、V 槽滾輪輸送線 `vRollerConveyor`、止擋 `stopper`、萬向球旋轉台 `ballTurntable` |
| 供料 | `transport.js`：柔性供料盤 `flexFeeder` |
| 搬運 | `gantry.js`：兩軸龍門＋平行夾爪；`transport-handling.js`：塑膠棧板 `pallet`（大量靜態棧板用 `pallet.instances()`）、棧板穿梭車 `shuttleCar`、穿梭車密集架 `shuttleRack`、懸臂吊 `jibCrane`、平台台車 `dolly`、AGV 充電櫃 `agvCharger` |
| 物流、工件 | `agv-forklift.js`：平衡重式堆高 AGV；`drum-200l.js`：200 L 閉口 HDPE 桶 |
| 視覺 | `camera.js`：工業相機＋鏡頭＋環形光源（依感光元件與焦距決定外形與視角）；`vision.js`：逐件設定的工業相機 `visionCamera`、固定式讀碼器 `codeReader`、3D 線雷射輪廓儀 `laserProfiler`；`lights.js`：條形光 `barLight`、穹頂光 `domeLight` |
| 運動、夾持 | `motion.js`：線性模組／滑軌 `linearAxis`、Z-θ 主軸模組 `zThetaSpindle`、伺服鎖付軸 `nutrunner`、抽屜滑軌 `drawerSlide`、平行夾爪 `parallelGripper` |
| 氣動 | `motion.js`：氣缸 `airCylinder`、擺動式油壓／氣壓缸 `pivotCylinder`、氣動滑台 `slideTable`、浮動桿 `floatRod`、真空吸盤 `suctionCup`、真空發生器 `vacuumEjector`、電磁閥 `solenoidValve`、FRL 三點組 `frl` |
| 氣動與公用 | `equipment.js`：空壓機 `airCompressor`、儲氣筒 `airTank`、氣源分配座 `airManifold` |
| 標準件 | `hardware.js`：伺服馬達 `motor`、光電感測器 `sensor`、腳座 `foot`、壓力表 `gauge` |
| 指示與操作 | `indicators.js`：三色燈 `signalTower`、人機介面 `hmi`、急停按鈕 `estop`；`equipment.js`：操作電腦 `operatorPc`（另有會畫文字的小螢幕 `liveScreen`） |
| 感測與安全 | `sensors.js`：盒型光電感測器 `boxSensor`、安全光柵 `lightCurtain`、六軸力覺感測器 `ftSensor`；`equipment.js`：安全雷射掃描器 `safetyScanner`；`motion.js`：旋轉編碼器 `rotaryEncoder`、門互鎖開關 `doorSwitch`、荷重元 `loadCell` |
| 電控周邊 | `equipment.js`：櫃側散熱風扇 `cabinetFan`、教導器與掛座 `teachPendant`（控制器、I/O 模組等電控元件在 `core/electrical`，不在這裡） |
| 實驗室儀器 | `equipment-lab.js`：分析天平 `analyticalBalance`、自動進樣器 `autosampler`、電位滴定儀 `titrator`、機器人用移液模組 `pipetteModule`、移液吸頭 `pipetteTip`、廢液桶 `wasteCanister` |
| 製程設備 | `equipment-process.js`：貼標機 `labeler`、翻桶機 `upender`、秤重顯示器 `weighIndicator`、風刀 `airKnife`、沖洗噴槍 `sprayLance`、熱風機 `hotAirBlower`、真空泵 `vacuumPump`、PE 儲槽 `storageTank`、離心泵 `centrifugalPump`、氣動隔膜泵 `diaphragmPump`、切換閥 `valve`、清運接頭 `transferCoupling`；`equipment.js`：離子風嘴 `ionizer` |

模型的結構慣例（走線與全場檢查靠它）：

- 根群組標 `userData.coreModel = meta.id`，固定的實體網格**直接掛在 root 底下**；會動的部分放在子群組並回傳參考，`motion.js` 的可動子群組另外標 `userData.coreModelPart`。
- 走線（`cable(parent, …)`）的線夾固定面：`parent` 的直接子網格，加上 `parent` 底下模型 root 的直接子網格，加上站改掛到 `parent`（站自己的群組）底下的可動子群組的直接子網格；`userData.cableHost === false` 的群組不算。
- 全場檢查判斷「移動件裝在誰身上」時往上跳過模型的 root，所以把站內零件換成模型（多一層 root）不會改變放行範圍。
- 細節與各站換用時的注意事項見 `MIGRATION.md` 的 1.10.0 一段。

## 共用舞台（`core/ui/stage.js`）

```js
const stage = createStage({ canvas, exposure: .86, fog: [5000, 11000], logDepth: true,
  camera: { fov: 40, near: 2, far: 20000 }, controls: { minDistance: 8, maxDistance: 7000 },
  envLight: 220, sun: { position, target, shadow: { mapSize, camera, bias, normalBias } }, fill: { … },
  extraLights: [{ color, intensity, position, target, shadow }] });
stage.loop(dt => { /* 推進時間、更新面板 */ return changed; }, { render: drawEverything });
exposeSim({ seekTo, setView, views, total, play, pause, get T() { return T; } });
```

- 網址參數一致：`?shadow=0`、`?aa=0`、`?logdepth=0/1`、`?movie`（錄影：不跑迴圈、不聽 resize、強制對數深度）。
- `loop(tick, { render })`：多畫面專案（主畫面＋相機子畫面＋疊圖）傳自己的整格繪製；不傳則只畫主畫面。
- 錄影：`?movie` 時在 main.js 呼叫 `installMovie({...})`（`core/movie/movie.js`），各站的取樣、追焦、細節重播設定寫在專案裡；`?movie&auto` 自動開始輸出。`installMovie` 另有 `title`（片頭與段落標題）、`far`（廠房級的站）、`glandShots: false`（接頭不在桌板上的站）、`targetSeconds`（製程段壓到指定總長）；步驟可以帶 `offset`（這一步的鏡頭偏移，約 2 秒平滑過渡）與 `speed`（展示倍率）。
- 成品匯出總入口：`node core/tools/export.mjs <專案> [--zip] [--html] [--mp4] [--out 資料夾]`（不指定時輸出壓縮檔＋單一 HTML，預設 `TEMP/exports/`）。`--zip` 是首頁＋本站＋core 的網站壓縮檔，附 `open-demo.cmd`（雙擊用 Windows 內建 PowerShell 的本機伺服器 `tools/offline/serve.ps1` 開啟，客戶電腦不必安裝軟體）；匯出前後都做用戶名稱檢查，有名稱就不留下成品。zip 讀寫在 `tools/zip.mjs`（交接包也用）。
- MP4 匯出：`node core/tools/export-mp4.mjs <專案> [輸出資料夾]`（全自動：建單站網站副本、本機接收端、無頭 Chrome＋GPU、ffmpeg NVENC／libx264，結束時核對影格數；預設輸出 `TEMP/videos/<專案>-<日期>/`）。程式內用 `import { exportMp4 } from './export-mp4.mjs'`。
- 單一 HTML 匯出：`node core/tools/export-html.mjs <專案> [輸出檔] [--verify]`（預設 `TEMP/exports/<專案>.html`），模組、css、圖示與 `new URL('…', import.meta.url)` 資源全部內嵌，離線雙擊（file://）可開；`--verify` 用 Chrome／Edge 以 file:// 開啟，確認無錯誤、`window.sim` 可跳播、畫布有畫面。程式內用 `exportHtml(專案, 輸出檔)`、`verifyHtml(檔案)`。

## 統一寫法（新專案與既有專案都照這個）

| 項目 | 用法 |
|---|---|
| 形狀與材質 | `@core/geom/shapes.js`（block／cylinder／rod…，陣列參數）＋`@core/geom/materials.js` 的 `MAT`（含 `frame` 鋁擠型、`chrome`）與 `finished(MAT.alu, 'metal')`（帶細紋的快取複本）。常見材質用 MAT，產品專屬外觀才在專案自建 |
| 市購品 | 市購的元件與設備（三色燈、HMI、急停、感測器、相機與光源、氣缸與線性模組、夾爪、輸送機、泵與儀器…）用 `@core/models/` 的模型（`模型.create(參數) → { root, set, 子物件 }`，清單見下方「共用模型」），不要在站內重畫；加工件、支架、線材與產品留在站內。數值參數見 `meta.params`，材質、陣列、子物件等選項見 `meta.options`（子物件給 `false` 不裝）；外部傳入的材質原樣使用。狀態直接對應：`tower.set('green')`、`sensor.set(true)`、`ft.setForce(N)`、`bar.set({ light })`、`hmi.draw(fn)`／`drawText(lines)`、`cam.set(亮度)`、`cyl.set({ ext })`、`axis.set({ pos })`、`grip.set({ width })`、`stop.set(0 或 1)`、`conv.set({ s })`。站原本就有移動群組時，把模型回傳的可動子群組 `add` 進去（關節與每格改位置的程式不變）。既有站換用時照 `core/migrations/` 的對照 |
| 排程 | 單一手臂依序作業：`createStepSequence`（`@core/anim/sequence.js`；`discrete`、`latch`、`nested`、步驟 `ease`／`easeKeys`、`peek`、`mark`／`rollback`、`retime`）；多台設備並行：`createTimeline`（`@core/anim/track.js`；`Track.at(T)`）。兩者都提供 `events`、`stationStart`、`total` |
| 播放列 | `createPlayer`（`@core/ui/player.js`）綁定標準元素 `playBtn／restartBtn／speed／speedVal／timeline／clock／stepSelect／previous／next／loop`，事件選單用排程的 `events`；`apply(T, { seek, dt })`、`advance(T, dt)`（等手臂到位、故障停住）、`maxStep`（高倍速拆子步）、`onChange(T, state, { seek })`、`loop`、`<select>` 速度選單、`speed` 預設值；上一步：已播過目前步驟 0.5 s 以上回到步驟開頭，否則回到前一步 |
| 手臂到位 | `createArrivalGate`（`@core/anim/arrival.js`）：規則（`tolerance` 門檻、`contactPosition`、`timeout`、`maxStep`，或自訂 `blocked(e, step, atEnd)`）放在專案的 `sequence.js` 匯出（如 `ARRIVAL`），網頁與驗證腳本共用；專案提供 `error()`、`step()`、`sample(t)`、`update(h)` 與選用的額外故障 `fault()`（如 NG 停線）。`advance` 直接交給 `createPlayer`（子步、步驟終點等到位、終點前一點取樣、逾時停住），跳播時 `reset()`，面板讀 `waiting`／`fault`；Node 驗證腳本用 `step(t, h)` 逐子步驅動 |
| 3D 標籤 | `stage.addLabel(html, getPos, cls, { anchor: 'center' 或 'above', priority })`，每格 `stage.updateLabels(show)`；畫布在頁面中的偏移由 stage 處理。精簡版面（或畫布寬度 < 900 px）時重疊的標籤自動避讓（priority 大、先加入者優先；`declutter` 選項或 `?declutter=0/1` 可改） |
| 視角 | `VIEWS = { 名稱: [位置, 注視點] 或 () => [...] }`，切換用 `stage.goTo(位置, 注視點, instant, 秒)`；`stage.cancelTween()`、`stage.shiftView(位移)`（跟著輸送中的工件）。手機直向等窄畫布（寬高比 < 1.25）由 stage 自動拉遠（`narrowFit`，`?narrowfit=0` 關閉），視角照桌面寫即可；已自己依畫面比例取景的視角傳 `goTo(…, { fit: false })`，只想拉遠部分方向的傳 `{ fit: (倍數, 偏移) => 新偏移 }`（視角可回傳 `[位置, 注視點, 選項]`）。橫向手機的側欄與電控面板改為右側面板；精簡版面打開抽屜時，3D 畫面中心自動移到沒被遮住的區域（`camera.setViewOffset`，收起即還原） |
| 光源與地面 | `createStage({ look: 'cell' 或 'plant' 或 'studio', extent: { center, radius } })`：look 給配色、曝光與燈光強度，extent（場景中心與半徑，mm）推算太陽／補光位置、陰影範圍與霧；專案明確給的 `sun`／`fill`／`hemi`／`fog` 逐欄優先。地面用 `floor(g, { size, cell })`（`@core/geom/environment.js`，深色地坪＋格線，建在 project.js 的場景樹裡） |
| 小螢幕與觸控 | 版面骨架固定為 `#topbar`（`.brand`、`#stations`、`.views`）、`#side`／`#left`、`#bottombar`（`#playBtn`、`#timeline`、`#clock`、`.stepRow`），並呼叫 `createViewerWorkspace`：≤900 px、觸控平板 ≤1100 px 與橫向手機自動改精簡版面（☰ 製程與視角、⚙ 播放設定、工具列開側欄，畫布全寬），較大的觸控平板加大點按目標；專案 CSS 不要再寫隱藏或縮小這些區塊的窄螢幕規則 |
| 相機子畫面與焦點追隨 | `createViewerWorkspace`（`@core/ui/viewer-workspace.js`）：`renderCamera`（3D 相機）、`renderImage`（2D 示意影像）、`setSources`（來源選單＋自動切換）、`startFollowing`／`stopFollowing`，`focusOffset` 可為函式；`getFocus()` 回傳 null（目標離線）時保持視角，目標重新出現時平移回去 |
| window.sim | `exposeSim({ seekTo, setView, views, total, play, pause, … })` |
| 圖示 | 每頁 `<link rel="icon" href="../core/favicon.svg" type="image/svg+xml">` |

## 檢查

```powershell
node core/tools/check.mjs                  # 全部專案完整檢查
node core/tools/check.mjs Chemical         # 單一專案
node core/tools/check.mjs --quick          # 部署前快速檢查（GitHub Actions）
node core/tools/check.mjs --only scene     # 只跑某項
```

| 檢查 | 快速 | 內容 |
|---|---|---|
| `models`（core） | ✓ | 每個共用模型以預設參數建立，狀態走完全範圍，做干涉與重合面檢查（`core/review/models.json`） |
| `examples`（core） | ✓ | 第二段範例（`examples/segment2`）的電控與配線檢查 |
| `structure` | ✓ | 開發架構（不管專案是哪個工具做的）：`project.json` 合法且有 `title`、`summary`、`coreVersion`（語意化版本、不超過 `core/VERSION`）；`AGENTS.md`、`CLAUDE.md`（引用 `@AGENTS.md`）；本庫的站有 `.claude/settings.json` 寫檔關卡；`docs/` 被 git 忽略；`web/` 每個 HTML 連 `../core/favicon.svg`、importmap 的 `@core/` 指到 `../core/`。跑全部專案時另查 `project-site/` 底下沒有 `web/index.html` 的資料夾（`core · structure`）。pre-commit 也會檢查這次提交到的站 |
| `names` | ✓ | 專案資料夾（不含 `docs/`、`TEMP/`）不得出現用戶名稱；名單只放本機 `.private/client-names.txt`（studio 工作區是 `.studio/client-names.txt`），沒有名單就略過。pre-commit 也會掃要提交的內容 |
| `imports` | ✓ | 從 index.html 走遍 import 圖，找不到的檔案（部署後才會壞的路徑） |
| `determinism` | ✓ | 40 個時間點順序與倒序取樣，所有可見物件的世界矩陣必須相同 |
| `layout` | ✓ | `layoutChecks()` 全數通過 |
| `scene` | ✓ | 動態干涉、靜態架設相撞、重合面閃爍；結果寫入 `review/scene-verification.json/.txt` |
| `electrical` | ✓ | 場景有電控元件或電盤時：元件在櫃內、編號不重複、機身不重疊、櫃內連線不穿元件、穿板孔與接頭；`verify.cables` 有宣告時另做配線動態取樣（線路與拖鏈對障礙物）。結果寫入 `review/electrical-checks.json`；沒有電控就略過 |
| `ui` |  | 標準互動測試（`core/tools/ui-check.mjs`）：桌面、手機直向、手機橫向、觸控平板四種尺寸，檢查載入與主控台錯誤、版面不溢出、畫布面積、播放／暫停、上一步／下一步／步驟選單、視角按鈕與選單收合、側欄、標籤在畫布內且（精簡版面）不重疊、點按目標 ≥ 30 px、`?movie`；結果寫入 `review/ui-check.json`，`--shots 資料夾` 另存截圖；`project.json` 的 `ui.skip`／`ui.params` 可設定 |
| 專案自有 | 依 `checks` | `project.json` 的 `checks.quick`／`checks.full` |

場景傾印與比對（把站內零件換成共用模型、或改 core 的幾何之後，確認畫出來的東西沒變）：

```powershell
node core/tools/scene-dump.mjs <專案> --out TEMP/<名>-before.json     # 改之前
node core/tools/scene-dump.mjs <專案> --out TEMP/<名>-after.json      # 改之後
node core/tools/scene-dump.mjs --diff TEMP/<名>-before.json TEMP/<名>-after.json [--ignore-names] [--show 8] [--all]
```

傾印用網頁同一份 `project.js` 建場景（所有情境、預設 9 個時間點，`--times N` 可改），記下每個零件的幾何、頂點雜湊、世界矩陣（1e-6）、材質屬性、陰影旗標、可見性、名稱與 `routingHardware`，以及燈光與虛擬相機；同一時間點內排序，所以多一層群組或建立順序不同不算差異，同一份場景重跑的檔案逐位元組相同。比對列出每個情境、時間點缺少／多出／不同的零件與差在哪個欄位，走線五金另外統計；完全相同離開碼 0、有差異 1。`--ignore-names` 不比一般零件的名稱。它不比群組階層、`userData`、貼圖內容與時間點之間的動作，檢查與截圖仍然要跑。

另有兩個不在 check.mjs 裡、給 studio 渲染補強守門用的工具：`node core/tools/run.mjs <專案> ../core/verify/run.mjs fingerprint`（印出一行排程指紋 JSON）、`node core/tools/perf-check.mjs <專案> [--out 檔案]`（各視角三角面、draw call 與手機幀率）。

## 回歸比對（改共用模組或渲染時）

```powershell
node core/tools/shots.mjs --out TEMP/shots-base                          # 先拍基準
node core/tools/shots.mjs --out TEMP/shots-new --compare TEMP/shots-base # 改完比對
python core/tools/compare-review.py TEMP/review-base                     # review JSON 結果比對
```

截圖在同一台機器重拍差異為 0，超過門檻（預設 0.2% 像素）的會另存 `.diff.png`。

## GitHub Pages

`.github/workflows/static.yml` 會先跑 `check.mjs --quick`，再用 `tools/build-site.mjs _site` 建置。新增專案只要有 `web/index.html` 與 `project.json` 就會出現在首頁，不必改工作流程。
