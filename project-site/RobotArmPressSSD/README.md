# SSD USB 接頭壓合站：自動化方案 3D 模擬

取代影片中人員用壓板壓平 USB 接頭的作業：把前站放好、但可能翹起的 USB 接頭銀腳壓回 PCB 焊墊，再逐顆拍照確認貼合；不合格的原位補壓後複檢。

**多機種、共用治具**：
- 手臂上只有一套治具：DENSO VS-068 搭配 ATI 力覺感測器與 20MP 45° 斜視相機，快拆介面裝壓墊：
  - 有整排接頭的機種（8 顆、片距 21 mm）用 **8 頭整排壓墊**（標準），每頭獨立彈簧，一次壓一整排。
  - 只有單顆接頭的機種（例如 3.5 吋 SSD）快拆換單點彈簧壓頭。
- 換機種只換配方。固定的全局相機先拍整盤，找出每顆接頭的位置與方向。
- Three.js 與共用模組來自 `../../core`（`core/vendor`），可離線執行。

文件（本機 `docs/`，不進版控）：
- [多機種重新設計](docs/redesign-multi-product.md)：共用治具、配方、全局相機、節拍。
- [自動化方案規劃](docs/automation-plan.md)：現況分析、判定方法、風險與待確認。
- 用戶提供的照片與影片。

## 配方

| 配方 | 內容 | 資料來源 | 標準壓墊 | 規劃時間 | 單點逐顆（比較） |
|---|---|---|---|---|---|
| `usb-2x8` | USB 隨身碟 2×8 連板、USB-A | 照片目測 | 8 頭整排 | 20.6 s | 29.9 s |
| `usb-2x8-r90` | 同一連板、接頭轉 90° | 假設 | 8 頭整排 | 19.4 s | 30.0 s |
| `ssd35-usbc` | 3.5 吋 SSD ×2、USB-C、接頭朝左右 | 假設 | 單點（快拆） | 17.2 s | — |

規劃時間是一盤的流程（含每個配方示範的一次補壓），網頁上方也顯示同一個值；連續播放加上手臂到位等待約多 0.4～1.1 s（`review/verification.json`）。

## 流程

| 站別 | 動作 |
|---|---|
| S0 進板定位 | 前一盤出站 → 止擋上升 → 上游送板（軌寬依配方）→ 到位 → 頂升 3 mm |
| S1 全局定位 | 固定全局相機拍整盤 → 讀載盤碼、確認配方、找出接頭位置與方向 |
| S2 壓合 | 8 頭整排：每排一次「移至 → 接近 → 壓合 40 N → 保壓 0.5 s → 回升」；單點：逐顆（蛇行） |
| S3 相機檢查 | 同方向、同一直線上的接頭自動分組，每張最多 4 顆；J6 依接頭方向轉向 |
| S4 補壓判定 | 間隙超標的接頭原位補壓（8 頭時整排重壓，已貼平的由各頭彈簧吸收）→ 單獨複拍 → 結果彙整 |
| S5 出板 | 手臂回待命 → 頂升下降 → 止擋下降 → 送往迴焊爐 |

## 啟動

```powershell
node ../../core/tools/serve.mjs RobotArmPressSSD
# 或不自動開外部瀏覽器
node ../../core/tools/serve.mjs RobotArmPressSSD --no-open
```

開啟 [本地模擬](http://127.0.0.1:8770/RobotArmPressSSD/)，也可在根目錄執行 `scripts\start.cmd -Station RobotArmPressSSD`（`scripts\start.cmd -Site` 只開展示網站，`-All` 連 vs3d 介面一起開；所有專案共用 `core/tools/serve.mjs`，首頁 http://127.0.0.1:8770/ 列出全部專案）。ES module 需 HTTP，請勿直接用 `file://` 開啟 HTML。

## 操作

- 上方選單切換**機種配方**與**壓墊**。預設是配方的標準壓墊；有整排接頭的機種可改選「單點逐顆」比較時間，單顆機種不能選 8 頭。
- 站別按鈕跳至 S0–S5；S3 直接跳到第一次取像，讓 USB 出現在相機畫面。下拉選單可選任一步驟，搭配前後步與時間滑桿；速度滑桿 0.1～4×。
- 視角：全景、線材配置、電盤配線、輸送站、手臂、壓合特寫、檢查特寫、俯視、載盤近看、銀腳特寫；滑鼠可自由旋轉縮放。
  - 「載盤近看」「銀腳特寫」隨載盤移動；點右側接頭編號可對準該顆銀腳，視角依配方方向旋轉，用時間軸比較壓前與壓後。銀腳特寫是同一 3D 場景的觀察視角，不是相機影像。
  - 「電盤配線」會剖開櫃門，看穿板接頭、走線與電盤；切到其他視角就恢復。
- **相機子畫面**是相機實際看到的畫面（`web/js/camera-view.js` 決定來源）：
  - 全局定位、壓合與手臂移動時顯示固定全局相機，並標示畫面來源；載盤未到站時顯示等待訊息。
  - 手臂到達取像／判定位置後顯示手臂相機，標示每顆的模擬間隙與 OK／NG。
  - 維持 3:2 感光元件視野，可放大／縮小；標題及結果放在影像外，不遮住 USB。子畫面不畫 3D ROI 輔助框，曝光偏低以保留銀腳與外殼高光。
- **視覺標記**：相機畫面可開關檢測框、中心標記與結果（全局相機的 USB 編號與接頭定位框；手臂相機的銀腳區、間隙線、模型間隙與 OK／NG，`web/js/vision-results.js`），數值都是模擬；見 [相機視覺標記](../../tools/docs/vision-review.md)。
- 右側「USB 接頭」格依配方排列，顯示每顆狀態（翹起、壓合中、已壓合、貼合 OK、補壓中、NG）與模擬間隙。
- 「示意 NG」會讓回彈的那一顆補壓後仍未貼合，播放停在複檢並亮紅燈。
- **相機面板與視窗**：面板標題列可拖曳，右上角可放大、獨立開窗或隱藏；主畫面上方的 ◧／◨ 收合資訊，▣ 恢復相機面板，◎ 切換近距離產品追隨。獨立視窗共用主時間軸與檢測標記。共通說明見 [視窗操作](../../tools/docs/viewer-controls.md)，畫面見 [review/viewer-workspace.png](review/viewer-workspace.png)。
- **⚡ 電控規劃**：查看元件用途、功能連接及配置外形；支援剖視、透視、點選與特寫，顯示狀態共用主時間軸。
- 「匯出紀錄」產生 JSON：配方、壓墊、每顆的模擬間隙與狀態、取像事件。**無實拍影像、無實測力值、未接 MES。**

網址參數：
- `?recipe=ssd35-usbc`、`?insert=single`（整排機種改單點比較）、`?result=NG`
- `?pause&st=3&view=inspect`（直接看取像）；加 `t` 時以站別起點加秒數精確定位；`?step=` 指定步驟。
- `?pause&st=2&view=leads&focus=A1`、`?pause&st=2&view=product`
- `?cameraSize=large`（相機子畫面放大，例如 [放大相機預覽](http://127.0.0.1:8770/RobotArmPressSSD/?pause&st=3&view=inspect&cameraSize=large)）
- `?shadow=0`、`cam=x,y,z,tx,ty,tz`、`speed=2`（播放速度）、`t=秒`（未給 `st`／`step` 時為絕對時間）
- `?pause&movie`：展示影片模式。不跑一般畫面迴圈，改由 `core/movie/movie.js` 的 `installMovie` 依絕對時間逐格取樣（與 `project.apply` 同一路徑），提供預覽、鏡頭檢查與「輸出完整影片」。全自動輸出 MP4 用根目錄的 `node core/tools/export.mjs RobotArmPressSSD --mp4`。

主控台：`window.sim.seekTo(sec)`、`pause()`、`play()`、`setView(name)`、`steps`、`events`、`T`、`playing`。

## 建模

### 現場參考與外觀

參考 `docs` 中四張照片，以及 `810029093.711498.mp4`（約 9.6 秒，人員分兩排壓合、移開長條壓板、放行載盤）。

- 深色編織紋載盤、接頭沉槽、定位孔及盤號；PCB 銑槽、FR-4 板邊、走線、絲印、晶片引腳與被動元件金屬端帽。
- USB 外殼的穿透開孔、折邊、壓印點、內部舌片與接點；銀腳是彎折截面加平貼端，跟著翹起／下壓／回彈狀態，表面有細微金屬粗糙度。
- 焊墊上是灰色未迴焊錫膏（不規則細紋），不把未迴焊的接點畫成已焊好的錫角。
- 手臂外殼倒角、關節與工具螺絲、隨行程縮短的壓頭彈簧、相機鏡筒環及線纜；輸送軌螺絲與金屬紋理；作業區有局部光與陰影。
- 細節以程式生成並合併靜態網格（`core/geom/surfaces.js`，與快門站共用），可離線執行。

照片無法確定的尺寸、電路圖案及絲印是外觀示意，不是產品 CAD／Gerber。間隙與判定是模擬資料。

視覺驗收：[載盤近看](review/product-overview.png)、[壓前](review/leads-before.png)、[壓後](review/leads-after.png)、[相機檢查](review/camera-inspection.png)。

### 產品、手臂與運動

- **產品**：依配方建出載盤、板子、零件與接頭（USB-A、USB-C 型錄）。翹起角為示意值，以插頭尖端為支點；壓頭碰到後才被壓回。每個配方指定一顆「壓後回彈」的接頭，用來示範補壓。
- **手臂**：VS-068 用 core 模型（`core/models/robots/denso-vs068.js`），臂長 340＋340 mm 與關節範圍取型錄；基座到 J2 高度 345 mm、J5 到法蘭 80 mm、關節零點方向為假設值，需以 DENSO CAD 核對。
- **待命姿態**：起始及回待命時相機朝外、相機線纜走工具板外側，避開 J2 肩部與手腕轉動範圍；壓合及取像 TCP、鏡頭位置與視野不受影響。
- **運動**：
  - 自由移位走同步關節插值（PTP），時間依關節角度差自動算，速度上限取型錄的 50%。
  - 接近、接觸與回升走直線。
  - 逆解依流程順序挑離前一點最近的解（含手腕翻轉的等價解）。
- **力值**：由壓頭彈簧（2.5 N/mm）與單顆壓回力推算的示意值，上限 60 N。

## 檔案

| 檔案 | 用途 |
|---|---|
| `web/js/recipes.js` | 接頭型錄與機種配方（載盤、板子、接頭位置與方向、翹起示意、壓合力） |
| `web/js/product.js` | 依配方建出產品；壓點、對焦點、翹起角與間隙；編織／金屬／PCB 材質與靜態網格合併用 `core/geom/surfaces.js` |
| `web/js/cell.js` | 輸送段（後軌基準、前軌調寬）、止擋、頂升、全局相機、底櫃、外罩、電控箱與配線。市購品用 core 模型：邊皮帶輸送 `edgeBeltConveyor`、止擋 `stopper`（`transport.js`）；頂升氣缸 `airCylinder`、門開關 `doorSwitch`（`motion.js`）；全局相機 `visionCamera`（`vision.js`）、條形光 `barLight`（`lights.js`）、光電 `boxSensor`（`sensors.js`）；三色燈 `signalTower`、HMI `hmi`、急停 `estop`（`indicators.js`）。鋁擠型框架 `MAT.frame`、拋光銷 `MAT.chrome`、拉絲鋁軌與支撐板 `finished(MAT.alu, 'metal')`；綠色皮帶、PC 外罩、各段站名貼紙為本站外觀；地面用 `core/geom/environment.js` 的 `floor(g, { size: [9000, 6000], cell: 200 })` |
| `web/js/robot.js` | 手臂本體、限位、速度與 IK 在 core 模型（`createVS068`）；本檔放共用末端工具（快拆壓頭介面、力覺感測器 `ftSensor`、手腕斜視相機 `visionCamera`、手腕條形光 `barLight`）、TCP 與關節規劃（逆解選解、PTP、位姿快取）。手腕相機的標籤留在本站畫（core 模型在沒有 `document` 時不建標籤，已登記 `core/REQUESTS.md`） |
| `web/js/sequence.js` | 由配方產生流程、拍攝分組、接頭狀態與力值計算。步驟、快照插值、`stationStart`、`total`、`events` 用共用步驟序列 `core/anim/sequence.js` 的 `createStepSequence`；本檔只加手臂姿態層（建立每步時記下起訖姿態與 `motion`；逆解規劃後用序列的 `retime` 依關節角度差重排 PTP 步驟時間；接觸／接近限速）；另匯出手臂到位規則 `ARRIVAL`（門檻、逾時 8 s、子步 10 ms），`main.js` 與 `tools/verify.mjs` 共用 |
| `web/js/station.js` | 組裝整站並套用狀態（畫面與驗證共用） |
| `web/js/project.js` | 專案介面 `createProject`：依配方／壓墊建整站、ROI 框與流程；`apply(t)` 把流程狀態、手臂姿態、燈號與 ROI 放到時間 t；`layoutChecks` 與配線情境 `verify.cables`（全部配方 × 可用壓墊）。`main.js` 與 core 統一檢查共用 |
| `web/js/camera-view.js` | 相機子畫面的來源判斷（手臂相機只在取像姿態使用） |
| `web/js/vision-results.js` | 相機畫面的模擬檢測結果（`ssdResults`） |
| `web/js/main.js` | 配方選單、接頭狀態、相機子畫面、紀錄匯出、`?movie` 錄影掛勾（物件與時間狀態取自 `project.js`）。renderer、相機、軌道控制、環境光與燈光、畫面迴圈用共用舞台 `core/ui/stage.js` 的 `createStage({ look: 'cell' })`：配色、曝光、半球光與燈光強度取 look，只寫差異（環境光 220、霧 5000～11000 mm、不用對數深度、太陽／補光位置與陰影範圍沿用原值，不用 `extent` 推算）；作業區局部光（暖白、含小範圍陰影）放在 `extraLights`。播放列用 `core/ui/player.js` 的 `createPlayer`（時間、播放／暫停、速度、時間軸、步驟選單、上一步／下一步）：`advance` 交給 core 的到位閘門 `createArrivalGate`（`core/anim/arrival.js`，規則 `ARRIVAL`：每格切成 ≤ 10 ms 子步、手臂未到位就停在步驟終點等、等超過 8 s 判故障、手臂限速追蹤；與 `tools/verify.mjs` 的連續播放用同一個閘門），本檔只加示意 NG 複檢後停線的故障判斷、`apply(T, { seek })`（跳播手臂直接到位、清除等待、故障與軌跡）與按播放時從故障處重新到位的 `resume`。3D 標籤用 `stage.addLabel(…, { anchor: 'above', priority })`（小畫面重疊時先留手臂 3、壓墊 2、兩台相機 1，其餘 0）、視角轉場用 `stage.goTo`／`stage.cancelTween`、載盤近看跟著輸送用 `stage.shiftView`；手機直向等窄畫布由 stage 自動拉遠，壓合特寫在窄畫布且用整排壓墊時改看第一排中點（桌面仍看第一顆）；常用材質（框架、黑件、烤漆、工具鋼、PU、鏡頭玻璃）取 `core/geom/materials.js` 的 `MAT` |
| `web/css/style.css` | 桌面版面與本站面板樣式。≤ 900 px、觸控平板與橫向手機由 `core/ui/viewer-workspace` 的精簡版面接手（☰ 製程與視角、⚙ 播放設定、工具列開側欄、畫布全寬），本檔只保留 900～1100 px 非觸控視窗的 `@media(max-width:1100px)` 規則，以及精簡版面時把近看說明移到畫布頂端 |
| `tools/verify.mjs` | 全配方驗證（快速檢查） |
| `tools/verify-camera.mjs` | 相機取像幾何、站別捷徑、移動時畫面來源、面板比例（完整檢查） |
| `tools/verify-clearance.mjs` | 壓頭彈簧與導桿在 0～3 mm 全行程的配合（完整檢查） |
| `tools/verify-self-clearance.mjs` | 末端相機、鏡頭、光源、支架、線纜對手臂的淨空（完整檢查） |
| `tools/self-clearance.mjs` | `verify.mjs` 與 `verify-self-clearance.mjs` 共用的有向包圍盒淨空計算 |

## 驗證

需要 Node.js 22 以上，不需 npm 套件。統一檢查會跑 core 內建項目與 `project.json` 的 `checks`：

```powershell
node ../../core/tools/check.mjs RobotArmPressSSD           # 完整檢查（在本資料夾；在庫根目錄可寫 node core/tools/check.mjs RobotArm）
node ../../core/tools/check.mjs RobotArmPressSSD --quick   # 快速檢查（部署前）
node ../../core/tools/check.mjs RobotArmPressSSD --only electrical   # 只跑某一項
```

| 項目 | 內容 | 最近結果 |
|---|---|---|
| `imports`、`structure`、`names` | import 路徑、站的結構、不得出現用戶名稱 | — |
| `determinism` | 倒序／跳播一致 | 1,993 個物件、40 個時刻一致（`review/determinism.json`） |
| `layout` | `project.layoutChecks()`：載盤靠止擋、貼後軌基準、全局相機涵蓋整盤 | 3 項通過（`review/layout-checks.json`） |
| `scene` | 全場動態／靜態干涉＋重合面閃爍 | 1,650 個網格、56 個關節、207 個時刻：0 筆（`review/scene-verification.json`） |
| `electrical` | 電控元件在櫃內、櫃內連線、穿板孔，加上 `verify.cables` 的配線動態取樣 | 13 個元件、14 條連線、1 個櫃體；5 種配方／壓墊情境各 17 條走線、共 1,640 個取樣通過（`review/electrical-checks.json`） |
| `physics` | core 剛體動力學烘焙 | 本站沒有用，略過 |
| `bom` | 場景的 core 模型對照 3D工作室平台的 BOM（只警告） | 場景 15 個模型、BOM 38 行，對上 4 項；落差清單在 `review/bom-checks.json` |
| `ui` | 桌面、手機直向、手機橫向、觸控平板的標準互動測試（只在完整檢查，port 用環境變數 `UI_PORT`） | `review/ui-check.json` |
| `tools/verify.mjs`（quick） | 見下 | 8 種組合都通過（`review/verification.json`） |
| `tools/verify-camera.mjs`（full） | 見上表 | 28 個全局／手臂取像位置的 USB 幾何完整在視野內 |
| `tools/verify-clearance.mjs`（full） | 見上表 | 36 項彈簧／導桿檢查通過 |
| `tools/verify-self-clearance.mjs`（full） | 三個配方、五種可用壓墊組合逐步抽樣（間隔 ≤ 25 ms，含起訖點），門檻 5 mm；並重現舊待命姿態的肩部干涉，確認檢查抓得到 | 5,049 個樣本，保守淨空下限 9.83 mm（`review/self-clearance.json`、[起始姿態](review/start-camera-clearance.png)） |
| `../../tools/verify-vision.mjs`（full） | 跨站的視覺標記檢查（根目錄 `tools/`） | — |

單獨執行本專案驗證：

```powershell
node --import ../../core/tools/register.mjs tools/verify.mjs
node --import ../../core/tools/register.mjs tools/verify-camera.mjs
node --import ../../core/tools/register.mjs tools/verify-clearance.mjs
node --import ../../core/tools/register.mjs tools/verify-self-clearance.mjs
```

`tools/verify.mjs`：三個配方 × 可用的壓墊 × OK／NG 示意，共 8 種組合，每種都檢查：
- 全部步驟代表時刻的 TCP 可達性（PTP 步驟檢查終點）、力值上限、頂升條件。
- 任意倒退／跳站一致性。
- 手臂對軌道、止擋、全局相機、外罩、底櫃與產品的碰撞（接觸與接近步驟只允許壓頭進入產品包絡）。
- 結束時的接頭狀態（OK 全部貼合；NG 只剩回彈那一顆）。
- 連續播放（實際限速＋到位等待，與網頁同一個到位閘門與 `ARRIVAL`，每 0.25 秒做一次碰撞與相機自干涉檢查）。

模型計算誤差並非設備精度。淨空檢查是動畫幾何包絡與離散抽樣，實機仍須以原廠 CAD、實際線纜彎曲及安全距離校核。四站共用的干涉回歸見根目錄 [tools/README.md](../../tools/README.md)，過去的干涉修正項目見 [四站干涉修正紀錄](../../tools/docs/interference-review.md)。

## 配線與電控

- 基座電源與分段手臂護套、F/T 及光源支線、外罩內側相機支線、輸送感測器線路。
- 「線材配置」視角顯示主要外露線束、固定夾、分隔線槽，並有配色說明。畫面：[review/cables.png](review/cables.png)。
- 配線與電盤檢查由 core 的 `electrical` 執行（快速檢查就會跑；情境與障礙物宣告在 `web/js/project.js` 的 `verify.cables`），結果在 [review/electrical-checks.json](review/electrical-checks.json)。
- 研究與實機確認項目見 [配線研究](../../tools/docs/cable-routing-review.md)；本機另有 [配線紀錄](docs/cable-management.md)、[電控元件清單](docs/electrical-plan.md)、[電路圖索引與設計說明](docs/circuit-diagrams.md)、[A3 PDF 圖冊](docs/circuit-diagrams.pdf)，可編輯 SVG 與圖面資料在 `docs/electrical/`。

## 成本

成本表在 3D工作室平台維護與匯出；場景與 BOM 的落差由 `bom` 檢查列在 `review/bom-checks.json`。本機的 [成本試算表](docs/cost-estimate.xlsx)、[估價範圍與摘要](docs/cost-estimate.md) 是 2026-09-26 匯入平台前的試算，以平台為準；正式價格以供應商報價為準。
