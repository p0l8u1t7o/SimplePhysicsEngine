# 軍規筆電自動化 QC 線：第一階段設備模擬

以 V110 系列外觀 QII、工單 RMK12608372 及實機照片（本機 `docs/`）重建。採路線 B：六軸手臂＋F/T 力覺末端＋工業相機／線雷射、五站載具輸送、進出料升降堆料架及翻轉治具。所有 Three.js 依賴在 `core/vendor`，可離線執行。

## 第一階段範圍

**閉合、未接電的產品，進行可見外觀、側邊護蓋與翻面底部檢查。** 工單的 FT、LCD／鍵盤／掌托標籤、模組拆拔、Recover、摔機、附件包材仍由其他工位負責。

| 工位 | 動作 |
|---|---|
| S0 進料 | 上層托叉承重 → 最底層推出 → 推桿退回 → 平台接管上層 → 下降一個間距 → SN → 四角側夾定位 |
| S1 閉合外觀 | 取像頭（頂視相機＋穹頂光）沿前側懸臂移入 → 頂視外蓋 → 取像頭退出 → 手臂四側取像 → 指定接縫雷射掃描 |
| S2 側邊護蓋 | 六個可開啟護蓋逐門定位、接觸、抬扣、沿弧線開門、連接器取像、保持抬扣閉門、換壓頭鎖定、閉合確認；兩個電池門只檢外觀與封印 |
| S3 翻面 | 翻轉治具從待命高度下降 → 夾具先夾緊 → 載具鬆開 → 抬升 210 mm → 翻轉 → 印刷／SN／警語／外露 Docking／螺絲腳墊取像 → 手臂退讓 → 翻回落座 → 載具夾緊 → 翻轉治具鬆開 → 上升 100 mm 讓出輸送通道 |
| S4 出料 | 模擬結果彙整；OK 拉入堆料架、平台接管、托叉退出、上升、托叉承重、平台復歸；NG 停留 S4 待人工覆判 |

照片中的 Docking 是外露接點，底面不畫護蓋。標準配方不含 RF／GPS，HDD 只開門取像不拔除，電池保持封印。OS／CPU 標籤在掌托，不列入底面檢查。

完整檢驗對照、QII 頁碼、排除項目、照片與 G7 工單差異，以及工程假設見 [第一階段檢驗映射](docs/phase1-scope.md)。

畫面預覽：[護蓋與連接器](review/screenshots/door-inspection.jpg)、[底面翻轉取像](review/screenshots/bottom-inspection.jpg)。

## 啟動

```powershell
node ../../core/tools/serve.mjs MilitaryGradePC
# 或不自動開外部瀏覽器
node ../../core/tools/serve.mjs MilitaryGradePC --no-open
```

開啟 [本地模擬](http://127.0.0.1:8770/MilitaryGradePC/)，也可在根目錄執行 `scripts\start.cmd -Station MilitaryGradePC`（`scripts\start.cmd -Site` 只開展示網站，`-All` 連 vs3d 介面一起開；所有專案共用 `core/tools/serve.mjs`，首頁 http://127.0.0.1:8770/ 列出全部專案）。ES module 需 HTTP，請勿直接用 `file://` 開啟 HTML。

## 操作

- 站別按鈕跳至 S0–S4；下方下拉選單列出完整動作步驟（`時間 S站 · 動作`，含退離與取像預備點），搭配前後步與時間滑桿查看交接過程。前一步在步驟中途時先回到本步起點。
- 播放／暫停會同步控制所有軸，速度 0.25–4×；單台完成後停止，按播放從頭開始，按重播回到起點並播放。
- 視角：全景、線材配置、電盤配線、堆料架、手臂、護蓋特寫、翻面站、俯視、產品特寫、手臂取景；護蓋視角會隨目前門的位置改變。滑鼠可自由旋轉縮放。
- 右側顯示設備訊號、TCP 位置／姿態誤差、模擬力值與檢驗清單。曝光與動作銜接等待手臂到位，逾時會停止並顯示原因。
- 下方可顯示 TCP 路徑與參考包絡；右側可顯示／隱藏圍籬、控制櫃及設備標籤。
- 手機與平板：≤900 px、觸控平板 ≤1100 px 與橫向手機改用 core 的精簡版面（☰ 站別與視角、⚙ 播放設定、工具列 ◨ 開側欄）。手機直向時畫面自動拉遠，霧也跟著放遠；俯視改由側面俯看，讓輸送線由上而下排列（S0 在上）；手臂取景的說明文字若會蓋到影像，就移到影像左下角。設備標籤重疊時，先保留站名與手臂標籤。
- 「示意 NG」會使播放在 S4 停止。切回 OK 只是示範正常流程，不代表真實覆判；時間滑桿仍可檢視其他步驟。
- 「匯出紀錄」產生 JSON：模擬 SN、配方、完成／未完成項目、曝光事件及目前模型誤差。**無實拍影像、無實測數值、未接 MES。**
- SKU 選單：`V110-STND` 是工單配方；`V110-RF` 是非本工單的擴充示意，不冒充 G7-STND 配置。

網址參數：`?pause&st=2&view=product`（`?t=秒` 與 `?st` 併用時為站內位移，單獨用時跳到該時間）、`?pause&step=43&view=door`、`?sku=V110-RF`、`cam=x,y,z,tx,ty,tz` 指定鏡頭、`?shadow=0` 關陰影（給數字時改用 PCF 陰影並放大主光陰影貼圖）。
主控台：`window.sim.jump(st, view, off)`、`seekTo(sec)`、`setView(name, instant)`、`pause()`、`play()`；`window.sim.views` 列出視角名稱，`window.sim.steps` 列出步驟起點，`window.sim.events` 為排程事件（`{ time, dur, label, sub, station }`），`window.sim.player` 為播放列。

- `?pause&movie`：展示影片模式。不跑一般畫面迴圈，改由 `core/movie/movie.js` 的 `installMovie` 依絕對時間逐格取樣（與 `project.apply` 同一路徑），鏡頭追焦載具，提供預覽、鏡頭檢查與「輸出完整影片」。全自動輸出用 `node core/tools/export.mjs MilitaryGradePC --mp4`（見下方「影片輸出」）。

## 建模與運動

上蓋四區壓紋、品牌字樣、護角、前拉帶、門軸／門扣／膠條、獨立介面端子、底部維修蓋、螺絲十字槽、可讀法規示意字體、Docking 接點均為程式幾何（`web/js/notebook.js`）。HDMI／COM 用梯形金屬殼，USB-C 用圓角開口；接口有中空金屬壁、內部舌片及端子。

動作由絕對時間和步驟快照驅動，避免跳站殘留；換 TCP 以法蘭座標插值保持連續。手臂採幾何初始解＋阻尼最小平方 IK，依流程順序選擇接近上一姿態的等價手腕解，避免轉位時多轉一圈。自由移位走關節插值（PTP），接近、接觸、減速與掃描走直線，皆有關節與線性限速；夾持交接先取得新約束再解除舊約束。一台共 241 步，規劃週期 **347.75 秒**；連續播放加上到位等待約 362 秒（`review/verification.json`）。

產品本體 300×210×36 mm、載具 440×330 mm、節距 110 mm、輸送面 760 mm 沿用概念尺寸；翻轉抬升 210 mm。手臂依 DENSO VM-60B1 型錄的臂長、偏移與關節範圍建模（見 [第一階段檢驗映射](docs/phase1-scope.md)），立在 600 mm 立座上；基座與手腕長度、關節零點方向仍待 DENSO CAD 核對，目前結果不能當成實機可達性保證。前、後側由斜上方 35° 取像（手腕 ±120° 限制）。

配置與路徑重點（全場干涉 0 筆的前提）：

- S1 是前側單邊懸臂（立柱 z=1050），取像頭移入時穹頂底緣距產品 80 mm、退出 780 mm 讓手臂巡拍。
- S3 在 x=1150，翻轉龍門在輸送線前側、橫樑 1800 mm，後側留給手臂；翻轉治具輸送期間停在上方 100 mm。
- 右側護蓋在滑軌 575 作業；護蓋開度 100°；門邊作業結束先垂直上升 150 mm 再轉位。
- 鉤爪、壓頭、線雷射作業時工具繞軸轉動，讓環形光在 TCP 正上方；線雷射一律由斜上方 20° 掃描。線雷射輪廓儀在工具 X=90 mm，與環形光保留 7 mm 間距。
- 待命相機 TCP 在 Y=1250 mm，避免工具掃入 J2；低位量測／接觸姿態轉腕前先沿工具軸退離 120 mm；右側取像先到門面上方 300 mm 預備點再直線下降，避開 S3 立柱。
- 載具側夾氣缸放低；側門縮短並避開四角護角；滑軌供電線沿地面繞過滑軌端部。

實際尺寸、力／速度參數、量測 ROI 和安全回路須於實測後校正。

## 檔案

| 檔案 | 用途 |
|---|---|
| `web/js/notebook.js` | 產品、介面、封印與 SKU（`SKUS`、`selectSku`） |
| `web/js/cell.js` | 載具、進出料、輸送與翻轉設備。市購品用 core 模型：邊皮帶輸送 `edgeBeltConveyor`、止擋 `stopper` ×5、推／拉料氣缸 `airCylinder`、升降與 S1 滑台 `linearAxis`、調壓器 `frl`（`core/models/transport.js`、`motion.js`），頂視相機 `visionCamera`、讀碼器 `codeReader`（`vision.js`），穹頂光 `domeLight`（`lights.js`），光電 `boxSensor`、光幕 `lightCurtain`（`sensors.js`），三色燈 `signalTower`、操作面板 `hmi`、急停 `estop`（`indicators.js`）；載具側夾氣缸與 S3 翻轉治具的滑台、馬達仍是本站幾何。材質用 `core/geom/materials.js` 的 `MAT`（鋁擠型 `MAT.frame`、定位銷與導桿 `MAT.chrome`），相機外殼與穹頂擴散罩的材質留在本檔；地面用 `core/geom/environment.js` 的 `floor()`（11 × 7 m、200 mm 一格） |
| `web/js/robot.js` | 手臂本體用 core 模型 `core/models/robots/denso-vm60b1.js`（`createVM60B1`：連桿、關節、限位、關節速度、IK 參數與幾何初始解；模型目錄 `/core/catalog/` 可預覽）。本站部分：第七軸滑軌（`linearAxis`）與拖鏈、600 mm 立座、力覺末端（`ftSensor`、`visionCamera`＋環形光、鉤爪／壓頭、`laserProfiler`）、TCP、逆解選解、PTP 與位姿快取 |
| `web/js/sequence.js` | 第一階段逐步流程。通用排程（起訖快照、插值、護蓋開度的巢狀插值 `nested`、`stationStart`、`total`、`events`）用 core 的 `createStepSequence`，每步由 core 的 `apply` 套用終點狀態並算出終點位姿；本檔只加手臂位姿層（每步起訖位姿、PTP／直線、偏軸 TCP 轉向、先用 `peek` 預覽終點再決定是否低位先退離）與力值曲線；另匯出手臂到位規則 `ARRIVAL`（門檻、逾時 12 s、子步 25 ms），`main.js` 與 `tools/verify.mjs` 共用 |
| `web/js/project.js` | 專案介面 `createProject`：建立全部設備、產品與動作序列，`apply(t)` 把場景放到時間 t，並提供 core 檢查的設定（`verify`，含配線情境 `verify.cables`）；網頁與 core 統一檢查共用 |
| `web/js/main.js` | 控制、紀錄匯出、手臂鏡頭子畫面、`?movie` 錄影掛勾（場景物件由 `project.js` 建立）。renderer、相機、軌道控制、環境光與燈光、畫面迴圈、3D 標籤（`stage.addLabel`，畫布位移由 stage 處理）與視角轉場（`stage.goTo`／`cancelTween`）用共用舞台 `core/ui/stage.js`。光源用 `look: 'cell'` 提供配色，本站另外寫明曝光 1.0、環境光 240、天空光 .55、主光 1.6，以及主光／補光位置、陰影範圍與霧 7～14 m；沒有給 `extent`，避免改變桌面畫面。跟隨載具的特寫陰影光放在 `extraLights`。手機直向的拉遠由 stage 的 `narrowFit` 處理，俯視另外用 `fit` 改變方向；標籤用 `priority` 指定避讓順序。播放、重播、速度、時間軸、時鐘、步驟選單與前後步用 `core/ui/player.js` 的 `createPlayer`（事件取自 `sequence.events`），`advance` 交給 core 的到位閘門 `createArrivalGate`（`core/anim/arrival.js`，規則 `ARRIVAL`：子步推進、步驟終點等手臂到位、到位逾時停止），本檔只加 NG 停在 S4 的故障判斷與 `apply(T, { seek })`（跳播時手臂直接到位並清除等待與故障）；`window.sim` 由 `exposeSim` 提供 |
| `web/js/vision-results.js` | 相機畫面的檢測框、中心標記與模擬結果（`core/ui/vision-overlay.js`） |
| `tools/verify.mjs` | 狀態／幾何／運動驗證（連續播放用與網頁相同的到位閘門與 `ARRIVAL`） |
| `tools/verify-camera.mjs` | 手臂相機光軸與接口取景 |
| `tools/verify-clearance.mjs` | 護蓋與接口間隙、電控櫃落地與輸送線支撐 |
| `tools/verify-self-clearance.mjs` | 末端工具對手臂、光學機殼對筆電、工具對翻轉治具的淨空，寫入 `review/self-clearance.json` |

## 驗證

需要 Node.js 22 以上，不需 npm 套件。

```powershell
node ../../core/tools/check.mjs MilitaryGradePC --quick   # 快速檢查（部署前）
node ../../core/tools/check.mjs MilitaryGradePC           # 完整檢查（scene 約 90 秒，可放背景）
node --import ../../core/tools/register.mjs tools/verify.mjs   # 只跑本站排程與運動驗證
```

core 內建檢查：`imports`、`structure`、`names`、`determinism`（倒序／跳播一致）、`layout`、`scene`（全場干涉＋重合面閃爍）、`electrical`（配線與電盤）、`physics`（本站沒用，略過）、`bom`（只警告），完整檢查另跑 `ui`（四種尺寸互動測試，`review/ui-check.json`，port 用環境變數 `UI_PORT` 指定）。`project.json` 的本站檢查：快速 `tools/verify.mjs`；完整另加 `tools/verify-camera.mjs`、`tools/verify-clearance.mjs`、`tools/verify-self-clearance.mjs`。

統一檢查讀取 `web/js/project.js`（預設 SKU `V110-STND`）。最近一次結果：

- `scene`：5364 個網格、每 0.87 s 取樣，動態／靜態干涉與重合面都是 0 筆（`review/scene-verification.json`）；放行的接觸只有載具側夾與 S3 夾臂的 PU 夾墊夾住護角、鉤爪／壓頭在力控步驟的接觸（`project.js` 的 `verify.allow`）。
- `tools/verify.mjs`（`review/verification.json`）：兩個 SKU 各 241 步、週期 347.75 s，最大 TCP 誤差 0.033 mm；涵蓋全部步驟的代表時刻、任意倒退／跳站一致性、封印保持、翻面升降與夾持條件、TCP 可達性（PTP 步驟檢查終點）、手臂對 S1／S3 固定結構的碰撞（代表時刻＋連續播放每 0.25 秒）、轉位時產品與堆料架立柱的間隙（44 mm），以及連續播放。模型計算誤差並非設備精度。
- `tools/verify-camera.mjs`：兩種 SKU 共 50 個光軸位置、20 個接口無遮擋。
- `tools/verify-clearance.mjs`：16 個護蓋閉合、接口與護蓋最小間隙 0.25 mm；電控櫃落地、24 處輸送線支撐最小間隙 10 mm。
- `tools/verify-self-clearance.mjs`（`review/self-clearance.json`）：每 SKU 7196 個取樣（步驟端點＋50 ms 以內），工具最近 25.4 mm（J2 對輪廓儀）、光學機殼對筆電 53.6 mm、工具對翻轉治具 93 mm。
- `electrical`：19 個元件、20 條連線、2 個電控櫃（`review/electrical-checks.json`）。

跨站的干涉回歸與視覺檢查見 [檢查工具](../../tools/README.md)；干涉修正內容見 [干涉修正紀錄](../../tools/docs/interference-review.md)。

## 近拍與手臂取景

- 塑膠／橡膠細紋、金屬粗糙度與跟隨產品的局部陰影；環境反射保留深色外殼層次。
- 「手臂取景」從工具鏡頭前端取像，維持 3:2 全視野，隱藏 ROI／軌跡等輔助線。點按時會暫停到下一個手臂取像步驟；時間軸仍可查看移動中的真實朝向。
- [接口取像](http://127.0.0.1:8770/MilitaryGradePC/?pause&step=48&view=sensor)、[底面 Docking](http://127.0.0.1:8770/MilitaryGradePC/?pause&step=186&view=sensor)。
- 鏡頭以 12 mm、13.2 × 8.8 mm 感光面建模，屬示意光學參數，須按實機鏡頭校正；不代表已產生實測檢查結果。
- 相機畫面有可開關的檢測框、中心標記及對應結果，依當前取像與 3D 模型更新，所有數值均為模擬。詳見 [標記內容、預覽與驗證](../../tools/docs/vision-review.md)。

## 線材配置

「線材配置」視角與配色說明包含主要外露線束、固定夾、分隔線槽與活動拖鏈。第七軸 R65 mm 拖鏈與 S1 取像頭 R55 mm 拖鏈保持定長；立座沿背面走線，末端相機、光源與輪廓儀各有支線。

配線與電盤檢查由 core 的 `electrical` 執行（快速檢查就會跑；情境與障礙物宣告在 `web/js/project.js` 的 `verify.cables`）：`node ../../core/tools/check.mjs MilitaryGradePC --only electrical`。

[配線研究與實機確認項目](../../tools/docs/cable-routing-review.md)｜[本機 docs 配線紀錄](docs/cable-management.md)｜[配線與電盤檢查結果](review/electrical-checks.json)｜[配線畫面](review/cables.png)

## 視窗操作與產品焦點

相機標題列可拖曳，右上角可放大、獨立開窗或隱藏；主畫面上方的 ◧／◨ 可收合資訊，▣ 恢復相機面板，◎ 切換近距離產品追隨。獨立視窗共用主時間軸與檢測標記。

[完整操作說明與驗證範圍](../../tools/docs/viewer-controls.md)｜[介面畫面](review/viewer-workspace.png)

## 電控規劃與電路圖

上方「⚡ 電控規劃」可查看元件用途、功能連接及配置外形；支援剖視、透視、點選與特寫，顯示狀態共用主時間軸。[本站元件清單](docs/electrical-plan.md)。

電路圖：[圖紙索引與設計說明](docs/circuit-diagrams.md) · [A3 PDF 圖冊](docs/circuit-diagrams.pdf)。可編輯 SVG 與圖面資料在 `docs/electrical/`（`docs/` 只留本機）。

## 成本

成本表在 3D工作室平台維護與匯出（元件編號引用元件庫）；場景與平台 BOM 的對照是 core 的 `bom` 檢查（只警告），結果在 `review/bom-checks.json`。本機的 [成本試算表](docs/cost-estimate.xlsx)｜[估價範圍與摘要](docs/cost-estimate.md) 是 2026-09-26 匯入平台前的試算，金額以平台為準；正式價格以供應商報價為準。

## 影片輸出

`node core/tools/export.mjs MilitaryGradePC --mp4`（在庫根目錄執行；無頭 Chrome＋ffmpeg 全自動錄 `?pause&movie`，成品在 `TEMP/exports/`），說明見 [`tools/movie-export/README.md`](../../tools/movie-export/README.md)。站內舊的 1080p 錄影工具（`?capture=1`、`render_server.py`、`verify_video.py`、`capture_video.js`）已在 2026-10-21 退役。
