# 散熱銅片植入機：自動化方案 3D 模擬

把散熱銅片放進 350 × 350 mm 銅箔基板的孔中（孔底的黏紙會黏住銅片），放置精度 ±6 mil（±0.152 mm），目標每片 60 秒。同一台機要做兩種機種：

| 配方 | 內容 | 資料來源 | 節拍 |
|---|---|---|---|
| `obround-138` | 長圓孔 138 孔、長圓銅片 3 × 7 mm | 照片目測 | 約 54 s（53.94） |
| `round-72` | 圓孔 72 孔、圓形銅片 Ø10 mm | 假設 | 約 29.5 s（29.47） |

換線時切換配方、供料盤清料換料、吸嘴快換（Ø2.4 ↔ Ø4）。

機台採用雙龍門 XYZθ、每頭 4 吸嘴。基板定位（S1）與吸取後的拍照補償（飛越仰視相機）分開進行；模擬呈現穩態下五片基板同時在五站作業的一個節拍。所有 Three.js 依賴在 `core/vendor`，可離線執行。

方案說明、機構選型理由、精度預算與待確認事項見本機的 [機台規劃](docs/machine-plan.md)。用戶提供的照片在 `docs/`（只留本機）。

## 站別

| 站別 | 動作 |
|---|---|
| S0 上料 | 料倉吸取 → 分板吹氣、雙片偵測 → 放上輸送線 |
| S1 基板視覺定位 | 相機龍門拍 20 張，建立全部孔的孔位圖 |
| S2 放置 | 拍基準點修正孔位圖 → 兩頭輪流趟次（吸 4 顆 → 飛越仰視相機 → 放 4 顆）；長圓孔每頭 18 趟、圓孔 9 趟 |
| S3 放置後檢查 | 相機龍門拍 20 張，確認全部在孔內、偏差在規格內 |
| S4 下料 | 吸起 → 疊到收料料倉 |

模擬最大放置誤差：長圓孔 0.056 mm、圓孔 0.066 mm（`review/verification.json`）。

## 機構配置

- S1／S3 相機龍門是完全懸臂：兩根 Z 軌與立柱都在外側（離站中心 230、300 mm），橫樑從外側伸到板面上方，相機車掃描與回原點時不跨過任何 Z 軌（間隙 5 mm），內側沒有立柱。
- S2 Y 軌寬 50 mm；S1／S3 相機拍最靠 S2 的一欄時與 Y 軌間隙約 1.75 mm（偏緊，待實機確認）。
- 後側外罩與立柱在 Z = −680 mm，避開龍門橫樑完整行程。
- 兩座橫樑任何時刻間距 ≥ 140 mm（實際最小：長圓孔 191.5 mm、圓孔 209.4 mm）。

## 啟動

```powershell
node ../../core/tools/serve.mjs PCB-CopperAssembly
# 或不自動開外部瀏覽器
node ../../core/tools/serve.mjs PCB-CopperAssembly --no-open
```

開啟 [本地模擬](http://127.0.0.1:8770/PCB-CopperAssembly/)，也可在根目錄執行 `scripts\start.cmd -Station PCB-CopperAssembly`（`scripts\start.cmd -Site` 只開展示網站，`-All` 連 vs3d 介面一起開；所有專案共用 `core/tools/serve.mjs`，首頁 http://127.0.0.1:8770/ 列出全部專案）。ES module 需 HTTP，請勿直接用 `file://` 開啟 HTML。

## 操作

- 上方選單切換**機種**（長圓孔 138／圓孔 72）。
- 時間軸是一個節拍，預設循環播放；下拉選單與 ‹ › 列出各站與每一趟的時間節點（同一時刻的節點併成一筆）。
- 視角：全景、線材配置、電盤配線、放置站、吸嘴特寫、基板近看、孔位細節、供料盤、基板定位、上下料、俯視；上方站別按鈕也會切換到該站。
  - 「基板近看」「孔位細節」跟著輸送中的基板移動；右側孔位選單可指定孔，「空孔／放入中／放入後」直接定位該孔的動畫時點。
  - 「電盤配線」會剖開櫃門，看穿板接頭、桌下走線與電盤；切到其他視角就恢復。
- **相機子畫面**是相機實際看到的畫面，可選自動或指定相機（影像維持 3:2，標題與結果列在影像外；可放大／縮小）：
  - 仰視相機 A／B：吸嘴上的銅片與量到的偏移；只在當前取像時間顯示該幀偏移，其他時間顯示等待訊息。
  - S1 定位相機、S3 檢查相機。
  - 供料相機 A／B：盤上正面與反面的銅片。
  - A／B 頭下視相機：拍基準點。
  - 自動模式會跟著 A／B 頭飛越與 S3 曝光切換。
- **視覺標記**：相機畫面可開關檢測框、中心標記與結果（銅片中心、正反面、ΔX／ΔZ、θ 補償、基準點、孔位框與放置偏差，`web/js/vision-results.js`），數值都是模擬；見 [相機視覺標記](../../tools/docs/vision-review.md)。
- 「顯示孔位輔助標記」預設關閉，永遠不進入相機影像。
- 右側顯示兩頭的放置進度、目前最大放置誤差（對照 ±6 mil），以及各站當下的動作。
- **相機面板與視窗**：面板標題列可拖曳，右上角可放大、獨立開窗或隱藏；主畫面上方的 ◧／◨ 收合資訊，▣ 恢復相機面板，◎ 切換近距離產品追隨。獨立視窗共用主時間軸與檢測標記。共通說明見 [視窗操作](../../tools/docs/viewer-controls.md)，畫面見 [review/viewer-workspace.png](review/viewer-workspace.png)。
- **⚡ 電控規劃**：查看元件用途、功能連接及配置外形；支援剖視、透視、點選與特寫，顯示狀態共用主時間軸。
- 「匯出紀錄」產生 JSON：每顆的放置頭、吸嘴、趟次、時間與模擬誤差。**無實拍影像、無實測值。**

網址參數：`?recipe=round-72`、`?t=14.24&view=s2&pip=upA`、`?view=hole&hole=23`（指定第 23 孔）、`?cameraSize=large`（相機子畫面放大）、`?shadow=0`；`?pause&movie` 開啟展示影片模式（`installMovie`：全景開場、五站並行一個節拍，再分站重播上料、S1 掃描、供料震動、吸嘴取放、S3 檢查、下料，最後電盤與整線；可預覽、檢查鏡頭及輸出；全自動輸出 MP4 用根目錄的 `node core/tools/export.mjs PCB-CopperAssembly --mp4`）。主控台：`window.sim.seekTo(sec)`、`setView(name)`、`views`、`total`、`play()`、`pause()`、`plan`、`events`、`stationStart`、`player`。

預覽：[孔位細節](http://127.0.0.1:8770/PCB-CopperAssembly/?pause&t=20&view=hole)（圓片加上 `&recipe=round-72`）、[飛越取像](http://127.0.0.1:8770/PCB-CopperAssembly/?pause&t=1.098526&pip=upA&cameraSize=large)。

## 檔案

| 檔案 | 用途 |
|---|---|
| `web/js/layout.js` | 機種配方、產品與機台尺寸、運動參數、誤差模型 |
| `web/js/plan.js` | 一個節拍的完整排程：每個機構是 core 時間軸（`createTimeline`）上的一條軌，並行排程，任一時刻用 core 的 `Track.at(T)` 取姿勢與所在步驟；`log` 是逐顆取放／取像紀錄，`events`／`stationStart`／`total` 是統一的事件介面；誤差抽樣 |
| `web/js/board.js` | 基板（依配方的長圓孔或圓孔＋黏紙）、銅片、量測與檢查標記 |
| `web/js/surfaces.js` | 離線產生的銅面拉絲、刮痕、氧化色差與粗糙度貼圖（外觀參考，不是檢查影像） |
| `web/js/machine.js` | 地坪、底座、輸送線、料倉與上下料、相機龍門、雙龍門與吸嘴頭、供料盤、仰視相機、外罩、電控箱與配線。市購品用 core 模型：相機 `visionCamera`（`vision.js`）；邊軌輸送 `edgeBeltConveyor`、止擋 `stopper`、柔性供料盤 `flexFeeder`（`transport.js`）；頂升氣缸 `airCylinder`、線性軸 `linearAxis`（上下料樑與升降柱、S1／S3 的 Z 軌與 X 樑、S2 的 Y 軌與龍門樑）、吸盤 `suctionCup`、Z-θ 主軸 `zThetaSpindle`（`motion.js`）；三色燈 `signalTower`、HMI `hmi`（`indicators.js`）。加工件（頂升塊、吸盤架、導向座、吸嘴座、吸嘴尖端、支架、立柱）與工件留在站內。地坪用 core 的 `floor()`（`core/geom/environment.js`，9 × 6 m 深色地坪＋9 m 見方、200 mm 格線，回傳的地坪以 `machine.floor` 交給 `project.js` 排除在干涉檢查外）；鋁擠型框、鋁件、底座烤漆用 core 的 `MAT.frame`／`finished(MAT.alu, 'metal')`／`finished(MAT.cabinet, 'polymer')` |
| `web/js/sim.js` | 把排程在任一時間的狀態套到機台（畫面與驗證共用） |
| `web/js/project.js` | 專案介面 `createProject({ scene, recipe })`：建立機台、基板與排程，`apply(t)` 把整個場景放到時間 t；網頁與 core 統一檢查共用同一份（含 `layoutChecks`、全場檢查設定與配線情境 `verify.cables`） |
| `web/js/vision-results.js` | 相機子畫面的模擬檢測結果（`copperResults`） |
| `web/js/main.js` | UI、視角、相機子畫面、紀錄匯出（場景物件與逐時狀態都取自 `project.js`）；舞台 `core/ui/stage.js`（光源用 `look: 'cell'` 的配色、曝光與燈光強度，只另寫霧、環境點光 240 與原本的太陽／補光位置和陰影相機；不開對數深度；3D 標籤 `addLabel`，站名 priority 2、龍門 1，小螢幕重疊時先留；視角轉場 `goTo`，手機直向由舞台自動拉遠，基板近看在窄畫布只水平拉遠、高度不變，相機留在龍門下方與前罩內；基板近看／孔位細節以 `shiftView` 跟著輸送中的基板），播放列 `core/ui/player.js`（事件選單用排程的 `events`，循環播放綁定標準 `#loop` 勾選框），`?movie` 時改由 `core/movie/movie.js` 驅動 |
| `web/css/style.css` | 桌面版面；900～1100 px 的非觸控視窗頂部改三列。≤900 px、觸控平板與橫向手機由 core 的精簡版面（`core/ui/viewer-workspace.css`）接手，本專案不寫手機規則 |
| `tools/verify.mjs` | 排程與幾何驗證（快速檢查） |
| `tools/verify-clearance.mjs` | 掃掠體積取樣、固定相機與支架淨空、主軸鏜孔、基準點軸線（完整檢查） |
| `tools/verify-geometry.mjs` | 倒角後尺寸、真孔、層厚、植入後高度、逐顆顯示的模型裁切範圍與倒帶（完整檢查） |

## 驗證

需要 Node.js 22 以上，不需 npm 套件。統一檢查會跑 core 內建項目與 `project.json` 的 `checks`；core 內建檢查以預設配方（長圓孔 138）與 `project.json` 的 `variants`（圓孔 72）各跑一次。

```powershell
node ../../core/tools/check.mjs PCB-CopperAssembly           # 完整檢查（在本資料夾；在庫根目錄可寫 node core/tools/check.mjs PCB）
node ../../core/tools/check.mjs PCB-CopperAssembly --quick   # 快速檢查（部署前）
node --import ../../core/tools/register.mjs tools/verify.mjs  # 只跑排程驗證
```

| 項目 | 內容 | 最近結果（長圓孔／圓孔） |
|---|---|---|
| `imports`、`structure`、`names` | import 路徑、站的結構、不得出現用戶名稱 | — |
| `determinism` | 倒序／跳播一致 | 2,897 個物件、40 個時刻一致（`review/determinism.json`） |
| `layout` | `project.layoutChecks()` 空間檢核 | 8 項通過（`review/layout-checks.json`） |
| `scene` | 全場動態／靜態干涉＋重合面閃爍 | 2,558 個網格；0 筆（`review/scene-verification.json`） |
| `electrical` | 電控元件在櫃內、櫃內連線、穿板孔，加上 `verify.cables` 的配線動態取樣 | 40 個元件、40 條連線、51 條走線、12 組拖鏈；1,968／1,094 個取樣通過（`review/electrical-checks.json`） |
| `physics` | core 剛體動力學烘焙 | 本站沒有用，略過 |
| `bom` | 場景的 core 模型對照 3D工作室平台的 BOM（只警告） | 場景 49 個模型、BOM 45 行，對上 14 項；落差清單在 `review/bom-checks.json` |
| `ui` | 四種尺寸的標準互動測試（只在完整檢查，port 用環境變數 `UI_PORT`） | `review/ui-check.json` |
| `tools/verify.mjs`（quick） | 見下 | 兩個機種都通過（`review/verification.json`） |
| `tools/verify-clearance.mjs`（full） | 見上表；2 ms 路徑取樣，含外罩、仰視相機與各動作端點 | 28,400／15,536 個掃掠取樣通過 |
| `tools/verify-geometry.mjs`（full） | 見上表 | 兩個機種都通過 |

`tools/verify.mjs` 兩個機種各檢查一次：
- 節拍 ≤ 60 s。
- 每孔各放一次，且在基準點與頂升之後。
- 每個吸取都有放置；只吸當下在盤上、正面朝上的銅片。
- 兩座橫樑任何時刻間距 ≥ 140 mm。
- 吸嘴在 XY 移位時都在安全高度。
- 放下瞬間銅片中心與角度等於目標；誤差 ≤ ±6 mil；吸嘴尖不碰孔邊。
- S1／S3 涵蓋全部孔。
- 取樣與歷史無關；整台場景在整個節拍都能套用。

四站共用的干涉回歸與跨站視覺檢查見根目錄 [tools/README.md](../../tools/README.md)，過去的干涉修正項目見 [四站干涉修正紀錄](../../tools/docs/interference-review.md)。視覺比對截圖保存在 `review/`。

## 外觀

參照 docs 下 7 張 PXL 照片：板面照片 065404289、長條散熱片 065412691、孔與已放入細節 065419319／065426020／065432867、圓片 065814706／065818608。

- 銅面有離線產生的拉絲、輕微刮痕、氧化色差與粗糙度貼圖；散熱片保持非自發光金屬反射。鋁件及烤漆外殼也有離線生成的細紋與粗糙度。
- 基板分成上下銅箔與中間芯材，孔洞貫穿三層，底部另有黏紙。散熱片有倒角及獨立邊緣材質，名義尺寸不變。
- 長條輪廓照照片做成有直邊的圓角長方形；圓孔配方是圓片。
- 吸嘴露出細管與吸孔，有主軸套環、相機鏡筒環與軌道螺絲。

350 × 350 mm 是用戶給定的板面尺寸；其餘配方尺寸是示意。銅箔單層 0.035 mm 低於顯示的深度精度，畫面上以零厚度表皮呈現（上下各一面，芯材上下蓋面不繪製；黏紙為孔底可見的一個面），避免薄層互搶深度閃爍。長條孔圓角 R0.85、長條散熱片圓角 R0.65、散熱片倒角 0.045 mm 是外觀假設，不是從照片推定的實測值。刮痕、色澤分布是程序化外觀，不代表實際缺陷；紅藍手寫檢查記號不作為自動檢查結果。

## 配線與電控

- 雙龍門、S1／S3 掃描與 S0／S4 上下料共 12 組拖鏈；相機支線朝機頭外側，供氣歧管接入頭部內部通道。
- 「線材配置」視角顯示主要外露線束、固定夾、分隔線槽與活動拖鏈，並有配色說明。畫面：[review/cables.png](review/cables.png)。
- 配線與電盤檢查由 core 的 `electrical` 執行（快速檢查就會跑；情境與障礙物宣告在 `web/js/project.js` 的 `verify.cables`），結果在 [review/electrical-checks.json](review/electrical-checks.json)；只跑這項：`node ../../core/tools/check.mjs PCB-CopperAssembly --only electrical`。
- 研究與實機確認項目見 [配線研究](../../tools/docs/cable-routing-review.md)；本機另有 [配線紀錄](docs/cable-management.md)、[電控元件清單](docs/electrical-plan.md)、[電路圖索引與設計說明](docs/circuit-diagrams.md)、[A3 PDF 圖冊](docs/circuit-diagrams.pdf)，可編輯 SVG 與圖面資料在 `docs/electrical/`。

## 成本

成本表在 3D工作室平台維護與匯出；場景與 BOM 的落差由 `bom` 檢查列在 `review/bom-checks.json`。本機的 [成本試算表](docs/cost-estimate.xlsx)、[估價範圍與摘要](docs/cost-estimate.md) 是 2026-09-26 匯入平台前的試算，以平台為準；正式價格以供應商報價為準。
