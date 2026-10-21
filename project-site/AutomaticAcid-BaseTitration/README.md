# 酸鹼自動滴定：機械手臂前處理系統 3D 模擬

用 DENSO COBOTTA PRO 900 取代人員，完成滴定前處理，再交給 Metrohm 自動進樣器與滴定儀分析。一批 6 瓶樣品（3 × 500 mL、3 × 100 mL），每瓶取兩次，共 12 次滴定。前處理包括：

- 讀條碼
- 開蓋
- 空杯秤重
- 移液潤洗與取樣 20 mL（機器人專用 5 mL 移液模組，4 × 5 mL）
- 樣品秤重
- 放入進樣器
- 關蓋
- 分析完成後取杯

整合軟體是主控。Metrohm 以 tiamo＋Titrando 為主案（Remote Box＋樣品表／結果檔），OMNIS 列為備案。滴定前由滴定頭加純水 50 mL。所有 Three.js 依賴在 `core/vendor`，可離線執行。

方案說明、配置、時間、Metrohm 整合、選型與待確認事項見本機的 [系統規劃](docs/system-plan.md)。用戶提供的流程在 `docs/酸鹼自動滴定-機械手臂規劃-0828.pptx`（`docs/` 只留本機）。

## 結果（模擬）

| 項目 | 數值 |
|---|---|
| 整批時間 | 約 93 分鐘（93.3 分；第一杯 3.9 分鐘開始滴定，之後約每 7 分 24 秒一杯） |
| 手臂前處理 | 每瓶約 6.9 分鐘，6 瓶共 41.5 分鐘；手臂忙碌 43.7 分，約佔 47% |
| 瓶頸 | 滴定（每杯 7 分鐘）；已決定維持單一滴定頭 |

## 啟動

```powershell
node ../../core/tools/serve.mjs AutomaticAcid-BaseTitration
# 或不自動開外部瀏覽器
node ../../core/tools/serve.mjs AutomaticAcid-BaseTitration --no-open
```

開啟 [本地模擬](http://127.0.0.1:8770/AutomaticAcid-BaseTitration/)，也可在根目錄執行 `scripts\start.cmd -Station AutomaticAcid-BaseTitration`（`scripts\start.cmd -Site` 只開展示網站，`-All` 連 vs3d 介面一起開；所有專案共用 `core/tools/serve.mjs`，首頁 http://127.0.0.1:8770/ 列出全部專案）。ES module 需 HTTP，請勿直接用 `file://` 開啟 HTML。

## 操作

- **時間軸**是整批約 93 分鐘，播放列為共用的 `core/ui/player.js`。預設 5 倍速（速度選單選定的選項，`?speed=` 優先）；勾選「等待時加速」時，手臂等待分析的時段再加快 10 倍（player 的 `advance`）。下拉選單與 ‹ › 依排程的流程節點（每瓶、每杯的各步驟）跳轉。
- **上方流程按鈕**對照用戶文件的步驟（①初始化 … ⑨分析・取杯），按下跳到下一次出現的時間點。⑦（第二杯重複 ②④⑤⑥）沒有自己的步驟，所以沒有按鈕。
- **視角**：全景、線材配置、電盤配線、天平、開蓋、移液、進樣器、滴定特寫、液面近看、液面俯拍、跟隨手臂、俯視。
  - 「電盤配線」會剖開櫃門，看穿板接頭、桌下走線與電盤；切到其他視角就恢復。
  - 「液面俯拍」隨當前滴定杯與液位移動，仍可用滑鼠調整角度；這是觀察視角，不是文件指定的工業相機。
- **細節示範**選單直接定位到樣品瓶與刻度、移液注入杯中、滴定前加水、滴液與攪拌的時點。
- **整合方式**：選單切換 tiamo／OMNIS，通訊紀錄與電腦畫面跟著改。
- **左側**：
  - 樣品表：空杯重、淨重、進樣器位置、狀態、結果。
  - 通訊紀錄：整合軟體與手臂、天平、移液模組、讀碼器、Metrohm 之間的訊息。
- **右側**：
  - 目前動作。
  - 滴定曲線（pH 對滴定液體積）。
  - 天平讀值。
  - 交握訊號。
  - 顯示選項：設備標籤（預設收起）、安全掃描區。
- 「匯出紀錄」產生 JSON，內容是樣品表、滴定排程與通訊紀錄。**全部是模擬值，非實測。**
- **相機面板與視窗**：面板標題列可拖曳，右上角可放大、獨立開窗或隱藏；主畫面上方的 ◧／◨ 收合左右資訊，▣ 恢復相機面板，◎ 切換近距離產品追隨（正在夾持或處理的瓶杯，等待分析時改看滴定中的杯子）。獨立視窗共用主時間軸。共通說明見 [視窗操作](../../tools/docs/viewer-controls.md)，畫面見 [review/viewer-workspace.png](review/viewer-workspace.png)。
- **視覺標記**：液面相關視角可開關檢測框、中心標記與結果（杯／瓶編號、液面輪廓、模型體積、空杯狀態，`web/js/vision-results.js`）。數值來自模型與排程，滴定體積不是影像量測，pH 也不由相機判斷；見 [相機視覺標記](../../tools/docs/vision-review.md)。
- **⚡ 電控規劃**：查看元件用途、功能連接及配置外形；支援剖視、透視、點選與特寫，顯示狀態共用主時間軸。

網址參數：`?t=600&pause&view=sampler`、`?mode=omnis`、`?speed=30`、`?shadow=0`；主控台：`window.sim.seekTo(sec)`、`setView(name)`、`plan`（`plan.events`、`plan.stationStart`、`plan.total` 為共用事件介面，`plan.timeline` 為進樣器時間軸）。station 即用戶文件的流程編號：1～6、8、9，10 為 Cycle Complete；0 與 7 沒有步驟，`stationStart[0]`、`[7]` 是空位。

預覽：[滴定特寫](http://127.0.0.1:8770/AutomaticAcid-BaseTitration/?pause&t=300&view=titration)、[液面俯拍](http://127.0.0.1:8770/AutomaticAcid-BaseTitration/?pause&t=300&view=meniscus)。

展示影片：開 `?pause&movie`，`main.js` 不跑一般迴圈，改載入 `core/movie/movie.js` 的 `installMovie`（逐格取樣排程、秤重步驟對準天平秤盤、其餘跟隨目前的杯／瓶），頁面下方出現影片預覽與輸出按鈕；此時舞台強制開對數深度。全自動輸出 MP4 用根目錄的 `node core/tools/export.mjs AutomaticAcid-BaseTitration --mp4`。

## 檔案

| 檔案 | 用途 |
|---|---|
| `web/js/layout.js` | 站別位置、器皿尺寸、時間與速度參數、樣品批次 |
| `web/js/robot.js` | 手臂本體、限位、速度與 IK 用 core 的 `core/models/robots/denso-cobotta-pro900.js`（`createCobottaPro900`）；本檔只放長行程電動平行夾爪（core `parallelGripper`）、TCP、J1 固定角度窗與排程用的逆解／位姿 |
| `web/js/lab.js` | 地坪（`core/geom/environment.js` 的 `floor()`：9 × 7 m、100 mm 格、格線 9 m 見方高 1 mm，地坪與格線顏色沿用本站原本略深的 0x1a1f26／0x2c3440、0x222831）、實驗桌、桌下控制器與 I/O 箱（`core/electrical`）、樣品瓶座、開蓋夾持、移液區（廢液漏斗、吸頭廢料口、吸頭架、移液模組座）、料架、器皿。市購品用 core 模型：天平 `analyticalBalance`、進樣器 `autosampler`、滴定儀 `titrator`、移液模組 `pipetteModule`、吸頭 `pipetteTip`、廢液桶 `wasteCanister`（`core/models/equipment-lab.js`），電腦 `operatorPc`、安全掃描器 `safetyScanner`（`equipment.js`），讀碼器 `codeReader`（`vision.js`），開蓋夾持氣缸 `airCylinder`（`motion.js`）。探針線、拖鏈、加液管、漏斗排液管留在本站 |
| `web/js/render-details.js` | 玻璃器皿（有壁厚的瓶、杯、刻度、口緣）、液面、流束與吸頭液柱 |
| `web/js/plan.js` | 手臂動作序列（逐步計算 PTP 與直線移動時間，直接寫入 `core/anim/sequence.js` 的 `createStepSequence`；進樣器區先試排，撞到轉盤轉動時用序列的 `mark()`／`rollback()` 退回重排；station＝流程編號 ①～⑨）、轉盤與滴定頭排程（`core/anim/track.js` 的 `createTimeline`，rack／head 兩條軌）、樣品表與通訊紀錄 |
| `web/js/sim.js` | 把排程在任一時間的狀態套到場景（畫面與驗證共用） |
| `web/js/project.js` | 專案介面 `createProject({ scene })`：建立場景、`apply(t)` 套到時間 t，並提供 core 檢查的設定（非實體物件、設備分工位、逐條說明的允許接觸、配線情境 `verify.cables`）；`main.js` 與 core 檢查共用同一份場景 |
| `web/js/vision-results.js` | 液面視角的模擬檢測結果（`liquidResults`） |
| `web/js/main.js` | renderer、場景、相機、軌道控制、環境光與主要燈光由共用舞台 `core/ui/stage.js` 的 `createStage` 建立：`look: 'cell'` 給背景、環境光與補光配色強度，本站只寫與 look 不同的曝光（1.0）、環境點光（240）、暖色主光（0xfff8ef、1.25）與霧；主光／補光位置與陰影範圍是本站手調值，不用 `extent` 推算（推算結果會改變桌面陰影）；滴定杯補光（貼著杯座的小陰影相機）放在 `extraLights`。標籤避讓用 core 預設（精簡版面或畫布 < 900 px；本站桌面畫布約 960 px，不會避讓）；手臂（`priority` 2）與天平、進樣器、滴定儀（1）的標籤在小畫布優先保留；畫面迴圈用 `stage.loop`，3D 標籤用 `stage.addLabel`（`anchor: 'above'`，畫布偏移由 stage 處理），固定視角（`VIEWS`）用 `stage.goTo`、停止轉場用 `stage.cancelTween`、液面俯拍跟著液面平移用 `stage.shiftView`，`window.sim` 用 `exposeSim`；播放列用 `createPlayer`；液面俯拍、跟隨手臂、流程按鈕、樣品表、滴定曲線、交握訊號、通訊紀錄、匯出為本站自有；場景物件取自 `project.js` |
| 材質 | 桌架、不鏽鋼件（`finished(MAT.steel, 'metal', .008)`）、黑件、狀態燈、夾爪陽極件用 `core/geom/materials.js` 的 `MAT`；灰色件（電控箱、防風罩框、夾爪座、鍵帽、移液模組本體）是烤漆／塑膠，不用 `MAT.frame`（鋁擠型）；實驗桌面、Metrohm 外殼、POM、瓶蓋、玻璃、液體、吸頭與安全區留在 `lab.js`／`render-details.js` |
| `web/css/style.css` | 桌面版面（左側樣品表／通訊紀錄、右側狀態卡、下方播放列）；900～1100 px 的非觸控視窗標題列改三列、≤1300 px 先收起左側欄。手機直向、橫向與 ≤1100 px 觸控平板由 `core/ui/viewer-workspace.js` 的精簡版面接手（☰ 製程與視角、⚙ 播放設定、工具列 ◧／◨ 開左右側欄抽屜，畫布全寬），本檔不寫窄螢幕規則；手機直向的取景由 stage 的 `narrowFit` 自動拉遠，視角照桌面寫 |
| `tools/verify.mjs` | 排程與幾何驗證（快速檢查） |
| `tools/verify-clearance.mjs` | 噴洗嘴與電極固定環、攪拌軸、槳葉／探頭掃掠、桌面貫穿孔與吸頭架通道的淨空（完整檢查） |
| `tools/verify-render.mjs` | 渲染狀態：12 次滴定的滴定頭抬升高度、液面與體積、流束出現／停止、吸頭容量、倒帶後畫面一致（完整檢查） |
| `tools/verify-self-clearance.mjs` | 夾爪對手臂本體的全批次淨空（完整檢查） |

## 驗證

需要 Node.js 22 以上，不需 npm 套件。統一檢查會跑 core 內建項目與 `project.json` 的 `checks`：

```powershell
node ../../core/tools/check.mjs AutomaticAcid-BaseTitration           # 完整檢查（在本資料夾；在庫根目錄可寫 node core/tools/check.mjs AutomaticAcid）
node ../../core/tools/check.mjs AutomaticAcid-BaseTitration --quick   # 快速檢查（部署前）
node ../../core/tools/check.mjs AutomaticAcid-BaseTitration --only electrical   # 只跑某一項
```

| 項目 | 內容 | 最近結果 |
|---|---|---|
| `imports`、`structure`、`names` | import 路徑、站的結構、不得出現用戶名稱 | — |
| `determinism` | 倒序／跳播一致 | 1,409 個物件、40 個時刻一致（`review/determinism.json`） |
| `layout` | `project.layoutChecks()` 空間檢核 | 本站沒有宣告項目（`review/layout-checks.json`） |
| `scene` | 全場動態／靜態干涉＋重合面閃爍 | 1,094 個網格、142 個關節、400 個時刻：0 筆（`review/scene-verification.json`） |
| `electrical` | 電控元件在櫃內、櫃內連線、穿板孔，加上 `verify.cables` 的配線動態取樣 | 11 個元件、10 條連線、2 個櫃體、20 條走線、22,837 個取樣通過（`review/electrical-checks.json`） |
| `physics` | core 剛體動力學烘焙 | 本站沒有用，略過 |
| `bom` | 場景的 core 模型對照 3D工作室平台的 BOM（只警告） | 場景 25 個模型、BOM 39 行，對上 7 項；落差清單在 `review/bom-checks.json` |
| `ui` | 桌面、手機直向、手機橫向、觸控平板的標準互動測試（只在完整檢查，port 用環境變數 `UI_PORT`） | `review/ui-check.json` |
| `tools/verify.mjs`（quick） | 見下 | 2,801 步、9,449 項檢查通過（`review/verification.json`） |
| `tools/verify-clearance.mjs`（full） | 見上表 | 電極固定環淨空 ≥ 4.20 mm、攪拌軸 ≥ 0.42 mm |
| `tools/verify-render.mjs`（full） | 見上表 | 286 項渲染狀態檢查通過 |
| `tools/verify-self-clearance.mjs`（full） | 每 50 ms 以內取樣並含步驟端點 | 41,682 個樣本，保守淨空下限 10 mm（`review/self-clearance.json`） |

單獨跑站內工具：

```powershell
node --import ../../core/tools/register.mjs tools/verify.mjs
```

`tools/verify.mjs` 的檢查項目：
- 所有目標位姿可達（誤差 < 0.5 mm）。
- 關節不超限。
- 以 20 ms 取樣，關節速度不超過上限。
- 直線移動路徑誤差 < 0.5 mm。
- 手臂與手上的器皿不碰設備與其他器皿（器皿以直立圓柱判斷，只有該步驟預期接觸的物件例外）。
- 器皿交接時不跳位。
- 每杯都有空杯重與淨重。
- 秤重時天平門關著。
- 滴定依序進行，開始時杯子在滴定頭正下方。
- 放杯位置離滴定頭 ≥ 90°。
- 手臂在進樣器區時轉盤不轉。
- 批次結束時：
  - 瓶子已關蓋、回到完成區，每瓶用掉 52 mL。
  - 用過的 6 支吸頭已退除。
  - 移液模組回座、天平門關上。
- 倒退／跳站結果一致。

四站共用的干涉回歸與跨站視覺檢查見根目錄 [tools/README.md](../../tools/README.md)，過去的干涉修正項目見 [四站干涉修正紀錄](../../tools/docs/interference-review.md)。

## 外觀與近看

依 `docs/酸鹼自動滴定-機械手臂規劃-0828.pptx` 的九步流程／配置圖與 `docs/system-plan.md` 的設備方案建模。文件沒有實機照片與精確 CAD，玻璃壁厚、接頭、螺絲、管線與表面材質都是示意。

- 樣品瓶和滴定杯是有壁厚的空心玻璃輪廓，有厚底、口緣、體積刻度、瓶口螺紋、貼合瓶身的條碼標籤；滴定杯有倒液嘴，杯號貼在杯壁上。
- 液面高度依排程體積換算，有彎月面、滴定攪拌波紋、移液流束、加水流束、滴定液滴和電極噴洗。錐形吸頭中的液柱依錐台體積計算，不會穿出吸頭。流束、液滴和波紋是流程示意，不是流體力學或計量模擬。
- 文件沒有指定指示劑，所以終點時液體不變色；液體淡色只幫助辨識，濃度與終點由理論 pH 曲線與模擬結果顯示。
- 滴定頭待機時抬升 190 mm；攪拌棒、液面、管路與滴液都由模擬時間驅動，暫停、倒帶、跳站結果一致。
- 細節：電極球泡、管線接頭與升降軟管、轉盤輪轂、螺絲、天平秤盤邊緣、鍵盤、手臂外殼倒角、進樣器局部陰影、塑膠與不鏽鋼細紋。

## 配線與電控

- 桌下分隔線槽管理電源與訊號；滴定頭用 R40 mm 升降拖鏈容納兩路液管與電極線；手臂、天平及電腦線穿過上下兩層桌板的穿線孔，接桌下控制器與 I/O 箱。
- 「線材配置」視角顯示主要外露線束、固定夾、分隔線槽與活動拖鏈，並有配色說明。畫面：[review/cables.png](review/cables.png)。
- 配線與電盤檢查由 core 的 `electrical` 執行（快速檢查就會跑；情境與障礙物宣告在 `web/js/project.js` 的 `verify.cables`），結果在 [review/electrical-checks.json](review/electrical-checks.json)。
- 研究與實機確認項目見 [配線研究](../../tools/docs/cable-routing-review.md)；本機另有 [配線紀錄](docs/cable-management.md)、[電控元件清單](docs/electrical-plan.md)、[電路圖索引與設計說明](docs/circuit-diagrams.md)、[A3 PDF 圖冊](docs/circuit-diagrams.pdf)，可編輯 SVG 與圖面資料在 `docs/electrical/`。

## 成本

成本表在 3D工作室平台維護與匯出；場景與 BOM 的落差由 `bom` 檢查列在 `review/bom-checks.json`。本機的 [成本試算表](docs/cost-estimate.xlsx)、[估價範圍與摘要](docs/cost-estimate.md) 是 2026-09-26 匯入平台前的試算，以平台為準；正式價格以供應商報價為準。
