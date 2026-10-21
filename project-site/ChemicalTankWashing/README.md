# 200L 化學桶自動清洗線：3D 規劃動畫

依 `docs/` 的場地圖（紅框倉儲區）、手繪動線與 200L 閉口 HDPE 桶照片規劃。洗桶區 12.56 × 15.52 m、樓高 4.5 m，倉儲約 200 桶，用 AGV 搬運，清洗手臂用 FANUC。Three.js 依賴放在 `core/vendor`，可以離線執行。

[線上 3D 展示](https://p0l8u1t7o.github.io/SimplePhysicsEngine/ChemicalTankWashing/) · [全部自動化專案](https://p0l8u1t7o.github.io/SimplePhysicsEngine/)

已拍板：
- **倉儲**：穿梭車密集架。
- **殘液**：酸鹼水溶液，不需防爆，手臂加防護衣。
- **開蓋**：線上自動開蓋。
- **上料**：棧板上料用龍門加翻轉夾爪。
- **入庫**：散桶入庫，依手繪圖箭頭由倉儲西牆南段進入，需要上棧板。
- **清洗**：雙孔進水；末道倒液後先以負壓抽乾積水，再用熱風吹乾＋負壓同時帶走內壁附著水。
- **乾燥驗收**：放回位秤重，殘水 < 100 g 才放行。
- **廢液**：酸、鹼依桶號分兩個廢液槽。
- **穿梭車**：每層一台共 3 台，換道由 AGV 搬運。
- **產能**：維持約 24 桶／h，不加站。
- **動線**：翻桶後直線送到裝填區。

## 流程

| 站 | 動作 | 動畫節拍 |
|---|---|---|
| S0 散桶入庫 | 作業員用台車把散桶從西牆捲門推入 → 懸臂吊夾住桶頂 L 環，放上入庫站空棧板（先放遠側兩格）→ AGV 由走道以 R2600 弧線轉入，取走滿棧板入架 | 約 15 s／桶 |
| S1 倉儲／AGV | AGV 叉出車道前位棧板（4 桶）→ 放上棧板站；穿梭車把後方棧板補到前位。卸完的空棧板直接送到入庫站重複使用 | 約 45 s／棧板 |
| S2 龍門上料 | 雙弧形 PU 爪夾桶 → 抬升 → 平移出棧板範圍 → 邊移邊翻 90° → 放上水平沙漏形（V 槽）滾輪；桶頂朝西 | 約 20 s／桶 |
| S3 貼標讀碼 | 同一支斜拍相機先辨識 2" 桶塞方位 → 旋轉輥一次轉到規定的貼標角度並再取像確認（允收 ±2°）→ 列印、貼標 → 轉到相機前讀 QR 並量標籤相對 2" 桶塞的角度 → 轉到出站方位（翻正後 2" 朝北） | 約 12 s／桶 |
| S4 90° 翻桶 | L 形搖籃以桶底下緣為軸翻正，接著一路往南直送 | 約 6 s＋復歸 |
| S5 自動開蓋 | 頂視相機確認兩個桶蓋並量偏差 → 旋轉台微調（貼標站已轉好方位，只修翻桶與輸送造成的數度偏轉）→ 伺服鎖付軸反轉拆蓋 | 約 22 s／桶 |
| S6 手臂清洗 | R-2000iC/165F 從「取桶位」取下 → 經過渡點送入沖洗站 → 每道：2" 旋轉噴頭與 3/4" 直噴頭同時進水 → 搖晃 → 翻 190° 倒液（3/4" 在上方當通氣口）；共 3 道 → **末道後桶身微傾 3°，2" 噴槍長行程伸到桶底負壓抽乾積水 → 3/4" 改送 70°C 熱風、桶底持續負壓 30 s，帶走內壁附著水** → 放回同一條線的「放回位」**秤重（殘水 < 100 g 放行）**，再往南直送裝填區 | **約 150 s／桶（瓶頸）** |
| S7 廢液回收 | 逆流沖洗：第 1 道用 TK-R 回收水，第 2、3 道用清水；第 1、2 道經 P-2 依桶號送 TK-WA（酸）或 TK-WB（鹼），第 3 道與抽出的殘水回收到 TK-R | 每道 20 L |

整線約 24 桶／h，200 桶約 8.4 h（使用者決定維持，不加站）。動畫走完「散桶入庫 4 桶＋一個棧板 4 桶清洗」共 753.1 s，各站並行，交接時刻依站位占用推算。

**手臂節拍的組成**：
- **進水**：雙孔進水每道 13.3 s（2" 60 L/min＋3/4" 30 L/min）；只用 2" 單孔要 20 s，雙孔每桶省約 20 s。
- **倒液**：3/4" 通氣，每道約 3.5 s；不通氣約 7 s。
- **負壓抽乾積水**：每桶多約 16 s。
- **熱風吹乾內壁**：每桶多約 33 s。

若日後需要提高產能，最有效的是加第二個沖洗站，讓手臂在兩站之間交替；熱風吹乾也可以移到下游的獨立乾燥站，手臂節拍可回到約 119 s。

## 手臂負重（R-2000iC/165F）

| 項目 | 數值 | 容許 |
|---|---:|---:|
| 總重（夾爪估 60 kg＋桶 8.5＋殘液 2＋水 20） | 91 kg | 165 kg |
| J5 手腕力矩（重心距 J5 約 0.76 m） | 471 N·m | 921 |
| J6 手腕力矩（桶內水偏離 J6 軸） | 84 N·m | 461 |
| J5 慣量 | 31 kg·m² | 78.4 |

以 J5 力矩反推，桶內最多可裝約 80 L 水，目前每道 20 L 有充分餘裕。網頁右側「手臂負載」會隨桶內水量即時顯示。容許值取型錄等級概略值，夾爪重量是估計值，採購前需以 FANUC 負載曲線核對。

## 場地檢核（網頁右側「空間檢核」，20 項全數通過）

- **倉儲容量**：5 道 × 3 層，柱子前方的道位無法進出，所以分成西 3 道、東 2 道。最西一道只做 3 深，讓出 AGV 轉入入庫站的空間。合計 57 位，扣空棧板道 4 位後剩 53 位，可放 **212 桶**。
- **樓高**：第 3 層貨頂 3,935 mm，與 4.5 m 樓高之間有 565 mm 灑水頭淨空。
- **AGV**：走道 3.6 m，載棧板時迴轉半徑 1,662 mm。迴轉點最小淨距 71–105 mm，緊，要現場確認。入庫弧線 R2600：載棧板與空叉時，車身與牆、貨架、懸臂吊的淨距都 ≥ 100 mm。
- **入庫門**：西牆捲門寬 1.7 m。人員通道與 AGV 入庫段共用，設區域警示並讓 AGV 減速。
- **清洗手臂**：最遠取放點距基座 2,158 mm（型錄伸展 2,655 mm），以 DCS 限制在圍籬內。

## 啟動

```powershell
node ../../core/tools/serve.mjs ChemicalTankWashing            # http://127.0.0.1:8770/ChemicalTankWashing/
```

或在根目錄執行 `scripts\start.cmd -Station ChemicalTankWashing`（停止：`scripts\stop.cmd`）。

## 操作

- 上方 S0–S7 跳到各站並切換視角；底部播放列（共用 `core/ui/player.js`）有播放、重播、速度 0.25–8×、事件選單與上一步／下一步，時間軸可以拖曳。
- 視角：全景、俯視配置、散桶入庫、倉儲 AGV、龍門上料、貼標讀碼、翻桶、開蓋、清洗手臂、夾具特寫、沖洗站、秤重、廢液回收、跟隨 #1。
- 右側面板：設備狀態、桶槽追蹤（含殘水是否抽乾）、手臂負載、水槽液位、空間檢核。
- 顯示選項：尺寸、AGV 迴轉圈與入庫弧線、手臂伸展範圍、圍籬、標籤、天花板、透視桶身、剖視沖洗隔間與儲槽、相機子畫面。
- **焦點**：頂列「焦點」選清洗夾具、目前作業桶、第 1–4 桶、AGV 或龍門夾爪，按「對準焦點」單次對準，或按工具列 ◎ 持續追隨（追隨中換目標會平移過去）。追隨時仍可旋轉和縮放；再按 ◎ 或其他預設視角退出。桶離線時保留視角並顯示提示，倒退跳轉會恢復追隨。
- **相機視窗**（共用 `core/ui/viewer-workspace.js`）：工具列 ◨ 收合右側面板、▣ 顯示／隱藏相機視窗。視窗拖曳標題列或用方向鍵移動；⛶ 放大／縮小、↗ 以獨立視窗顯示（跟隨主頁播放與跳轉）、× 隱藏。畫面左上角是模擬檢測標記（桶塞 ROI，`core/ui/vision-overlay.js`，可用「標記」按鈕關閉）。
- **相機來源**：視窗內的「來源」選單（viewer-workspace `setSources`）可選自動切換（依最近一次取像事件切到貼標或桶口相機）、貼標相機、桶口相機或清洗夾具。即時畫面持續可用，檢測結果與桶塞定位標記只在觸發後顯示 4 秒，並標示為模擬訊號。
- 小螢幕（手機直向、手機橫向、觸控平板）走 core 的精簡版面：頂部只留標題，☰ 展開製程、視角與焦點列，⚙ 展開速度與步驟，工具列 ◨ 打開側欄抽屜；手機直向由舞台自動拉遠，視角照桌面定義。
- 網址參數：`?pause&t=230&view=booth`、`?speed=2`、`?dims`、`?cam=x,y,z,tx,ty,tz`；`?movie` 載入 `core/movie/movie.js` 的錄影介面（`core/tools/export.mjs ChemicalTankWashing --mp4` 全自動輸出）。主控台可用 `window.sim.seekTo(秒)`、`setView(名稱)`、`play()`、`pause()`。
- 暫停且視角不變時停止重繪（共用舞台 `onDemand`，狀態改變時 `stage.invalidate`）；陰影只在重繪時更新，由主視角和子視窗共用。

## 選型（規劃階段，型號與價格待詢價）

| 項目 | 選型 |
|---|---|
| 散桶入庫 | 西牆 1.7 m 捲門、油桶台車、旋臂 1.55 m 懸臂吊（立柱 x 1750）＋桶頂 L 環夾具、入庫棧板座 |
| 倉儲 | 穿梭車密集架（軌頂 150／1,480／2,810 mm），每層一台穿梭車共 3 台、換道由 AGV 搬運（每次約 1 分鐘），塑膠棧板 1200 × 1200 |
| AGV | 平衡重式堆高 AGV（雷射導引），舉升 ≥ 3.0 m；柱前地面充電板 |
| 上料 | 三軸龍門（雙橫樑，Z 兩段伸縮）＋伺服翻轉軸＋雙弧形 PU 夾爪 |
| 輸送 | 橫躺段為水平沙漏形（V 槽，半角 25°）滾輪；立放段為動力滾筒，一路往南到裝填區 |
| 貼標讀碼 | 熱轉印印字引擎＋推出式貼標頭；IDS GigE 相機＋條形光 |
| 翻桶 | L 形搖籃翻轉機＋側夾 |
| 開蓋 | IDS GigE 頂視相機（框架北側橫樑外斜拍桶頂）、旋轉台、XYZ 模組＋2"／3/4" 伺服鎖付軸 |
| 清洗手臂 | FANUC R-2000iC/165F＋R-30iB Plus＋DCS，加耐酸鹼防護衣 |
| 清洗夾具 | 側進式：工具法蘭、轉接座、背板、雙導軌、四滑座（U 形通槽）、雙氣缸推桿、承力側架、上下分段弧形 PU 墊及頂部 L 環防脫扣；導軌總寬 840 mm、單爪行程 30 mm；框架鋁材，接觸支架與導軌鋼材 |
| 沖洗站 | PP 隔間；2" 旋轉噴頭（長行程無桿氣缸，兼負壓抽液管）、3/4" 直噴頭（兼熱風管）、熱風機 HB-1（70°C）、真空泵 VP-1、集液漏斗與集液槽、排氣接洗滌塔 |
| 乾燥驗收 | 放回位頂升秤台：梳齒從滾筒縫隙頂起 12 mm 把桶托離輸送，秤上只有秤台（約 10 kg），4 顆 20 kg 荷重元，解析度約 10–15 g；殘水 = 秤重 − 桶號建檔的空桶重；沖洗站開口設風刀，桶退出時吹掉外表水珠 |
| 廢液回收 | TK-WA 酸性 1,600 L、TK-WB 鹼性 1,600 L、TK-R 800 L、TK-F 350 L、P-1 多段離心泵、P-2 氣動隔膜泵、V-3／V-4 切換閥、防溢堤（往西延伸到預留區） |

R-2000iC 的臂長取型錄概略值。關節零點、J2／J3 連動限位與速度都是假設。

## 待確認

1. **現場丈量**：柱、門、更衣室位置與紅框深度（誤差約 ±300 mm）；樓高或梁下淨高；西牆外側是否能開 1.7 m 捲門。
2. **桶規格與殘液**：桶塞位置與螺紋、最大殘液量。
3. **空桶建檔**：同型號空桶重差約 ±100 g，跟殘水標準一樣大，所以要逐桶建檔。做法：第一次清洗時延長熱風吹乾，秤得的重量存成該桶號的空桶重。需要確認建檔流程，以及 MES 裡要存哪些欄位。
4. **熱風溫度**：70°C 低於 HDPE 軟化溫度，但仍要確認桶內殘留化學品加熱後是否會揮發；排氣已接到洗滌塔。
5. **其他**：標籤格式與 MES 介面、廢液處理方式、桶蓋是否回用。

## 驗證

需要 Node.js 22 以上，不需 npm 套件。統一檢查（在本資料夾；在庫根目錄改成 `node core/tools/check.mjs ChemicalTankWashing`）：

```powershell
node ../../core/tools/check.mjs ChemicalTankWashing --quick    # 快速檢查（部署前）
node ../../core/tools/check.mjs ChemicalTankWashing            # 完整檢查
node ../../core/tools/check.mjs ChemicalTankWashing --only scene
```

- core 內建：`imports`、`structure`、`names`、`determinism`（[review/determinism.json](review/determinism.json)）、`layout`（[review/layout-checks.json](review/layout-checks.json)，20 項空間檢核）、`scene`；本站沒有電控櫃、沒有用剛體動力學、平台還沒有本站的 BOM，所以 `electrical`、`physics`、`bom` 略過。`ui` 只在完整檢查跑（四種尺寸，[review/ui-check.json](review/ui-check.json)，port 用環境變數 `UI_PORT` 指定）。
- 本站自有：快速檢查跑 `tools/verify.mjs`；完整檢查再加 `tools/verify-detail.mjs`、`tools/verify-gripper.mjs`。

### 排程與幾何（`tools/verify.mjs`）

```powershell
node --import ../../core/tools/register.mjs tools/verify.mjs
```

以 0.05 s 取樣整段動畫，檢查：
- 空間檢核；
- 手臂追蹤誤差、關節限位與速度；
- 手臂連桿與夾持中的桶，對沖洗站、輸送、開蓋站、圍籬、剛性配管的干涉；
- 手臂碰到未夾持的桶；
- 8 個桶互不重疊（桶以含外凸滾箍、半徑 298 mm 的 162 個表面點近似）；
- AGV 車身與載物，對牆、柱、貨架、龍門、懸臂吊的干涉（含入庫弧線）；懸臂吊吊桶經過已放的桶；
- 交接瞬間是否跳動；
- 倒序取樣的一致性。

結果在 [review/verification.json](review/verification.json)：全數通過（15,062 個取樣、總長 753.1 s、手臂節拍 151.1 s）。手臂追蹤誤差 ≤ 0.05 mm；關節速度最高為額定的 84%（J6）；手臂連桿與納入檢查之設備外框最小淨距 166 mm。未含軟管掃掠、緊固件與人員的動態干涉；這是有限取樣檢查，不是連續碰撞證明。

### 全場干涉與閃爍（core `scene`）

直接建立網頁上的同一份場景（`web/js/project.js`；本站的允許規則也寫在那裡）：

- **動態干涉**：自動找出 120 個會動的關節，整段動畫每 0.5 s 取樣，用定向包圍盒分離軸檢查移動件對所有網格；圓柱等曲面件再用頂點射線確認是否真的穿入。
- **靜態干涉**：不同設備、不同站之間的架設位置互相穿插。產線工位在 `line.js` 建立時標記。
- **重合面（閃爍）**：盒、倒角外殼、圓柱端面、平面，距離 < 0.6 mm 且重疊 > 25 mm²、外觀不同者。網頁另用對數深度緩衝（近裁切面 100 mm）、地面分區固定繪製順序、AGV 警示燈用亮度脈動（不切換材質）。
- 允許項目 9 條：core 通用 6 條（`core/verify/scene.mjs`）＋本站 3 條（桶由各站支撐、夾持或噴槍伸入，桶的干涉另由 `verify.mjs` 檢查；AGV 與棧板、貨架另以 2D 車身多邊形驗證，叉子插入棧板屬正常；手臂本體與夾爪內部零件的自身干涉另見 `verify-gripper.mjs`）。

結果在 [review/scene-verification.json](review/scene-verification.json)：1,684 個網格（含瀏覽器才有的文字牌）、1,507 個取樣時刻，動態 0、靜態 0、重合面 0。

### 局部機構（`tools/verify-detail.mjs`）

```powershell
node --import ../../core/tools/register.mjs tools/verify-detail.mjs
```

結果見 [review/detail-verification.json](review/detail-verification.json)。19 項檢查涵蓋貼標輥相切、翻桶托架、轉盤／固定滾輪、秤台整段行程、槽體／防溢堤、PP 板穿管孔、跨圍籬配管、雙槍孔徑與桶內間隙、噴洗聯鎖、液位及入庫門開口。時間取樣包含動作邊界前後，共 16,051 點。

### 清洗夾具（`tools/verify-gripper.mjs`）

```powershell
node --import ../../core/tools/register.mjs tools/verify-gripper.mjs
```

[夾具檢核](review/gripper-verification.json) 包含 15,147 個時間／事件取樣、101 個開合位置、10 項結構檢查、實際零件定向包圍盒及桶輪廓邊線取樣。未檢出設備干涉、穿桶或越界；夾具至 40 mm 圍籬框的最小淨距約 8.97 mm，金屬至桶身約 1.61 mm。小間隙尚須計入製造公差與桶型變異，不能視為製造驗證。

### 瀏覽器檢查（不在 `check.mjs` 內，需要時手動跑）

- `node tools/browser-check.mjs`（先執行 `node ../../core/tools/serve.mjs ChemicalTankWashing --no-open`）：用本機 Chrome 無頭模式收集主控台錯誤，截下 18 張站別畫面到 `review/screens/`（結果 `review/screens/browser-check.json`）。
- `node tools/review-camera.mjs [--port 8770]`：只用 DevTools Protocol，會自行啟動本機伺服器與無頭瀏覽器（也可由 `core/tools/cdp.mjs` 的 `openBrowser()` 呼叫 `runCameraReview(cdp, tab, outputDirectory)`）；[互動報告](review/camera/camera-review.json) 記錄 30 項焦點追隨、相機視窗與來源選單測試（另計主控台錯誤）。另有 [480 × 800 視窗邊界測試](review/camera/responsive-review.json)，及實際 WebGL 畫布匯出的 [夾持特寫](review/camera/gripper-closed.png)、[張開](review/camera/gripper-open.png)、[倒置倒液](review/camera/gripper-inverted.png) 預覽。
- `tools/review-scenes.mjs`：由 Browser 技能工作階段以 `runReview(cdp, tab, outputDirectory)` 呼叫，截下 13 個站位畫面並做倒退取樣與相機子畫面檢查（[review/detail-screens/browser-review.json](review/detail-screens/browser-review.json)）。

## 外觀細節

各站有馬達散熱片、軸承、光電、地腳螺栓、櫃門與通風孔；貨架有斜撐與中空棧板，AGV 有門架液壓桿和雷射頭，手臂有倒角鑄件、關節端蓋與工具法蘭，入庫吊車有工字樑與吊車驅動，儲槽有外置液位視管、維修蓋與管件。

使用離線程序紋理表現金屬拉絲、HDPE 微表面和地坪，搭配環境反射、ACES 色調映射及陰影。圍籬為可透視網孔；沖洗隔間與槽體預設為實體材質，可在「顯示 → 剖視沖洗隔間與儲槽」切換。桶頂雙孔、噴槍導管、PP 穿管孔與捲門開口都有實際幾何開孔。規劃說明見本機 [docs/planning.md](docs/planning.md)。

## 檔案

| 檔案 | 用途 |
|---|---|
| `web/js/layout.js` | 場地、設備位置、手臂負載估算與空間檢核的唯一來源 |
| `web/js/building.js` | 廠房地坪（含分區、退縮的建物外框與周邊地面，不用 core 的 `floor()` 深色格線地坪）、牆、門窗、柱、尺寸標註、AGV 充電櫃 |
| `web/js/inbound.js` | 散桶入庫：捲門、懸臂吊、台車、作業員 |
| `web/js/storage.js`、`agv.js` | 穿梭車密集架、棧板、架上桶槽、AGV |
| `web/js/line.js` | 棧板站、龍門、V 槽滾輪輸送、貼標讀碼、翻桶機、開蓋站、立放直線輸送、圍籬、控制櫃 |
| `web/js/robot.js`、`gripper.js` | R-2000iC/165F（手臂本體、限位、速度與 IK 在 core 模型）的工具與站位；完整清洗夾具（站內自畫） |
| `web/js/washing.js` | 沖洗站、雙噴槍、真空泵、集液、四槽、泵與配管流向 |
| `web/js/drum.js` | 200L 桶（轉出 core 的 `drum-200l.js`） |
| `web/js/sequence.js` | 各設備與各桶的時間軌（`core/anim/track.js` 的 `createTimeline`）、交接推算、狀態取樣 |
| `web/js/plant.js`、`project.js` | 建立全場設備並套用取樣狀態；`project.js` 是網頁與 core 統一檢查共用的專案介面 |
| `web/js/main.js` | 場景（`createStage` 用 `look: 'plant'`、`logDepth`、`onDemand`；太陽／補光位置與陰影範圍沿用為本廠房調好的值，不用 `extent` 推算）、面板、視角、3D 標籤（站名 S0～S7 與倉儲 `priority` 最高，小畫布避讓時先保留）、相機子畫面內容（依取像事件自動切換、桶塞標記）、焦點目標、錄影 |
| `web/css/style.css` | 桌面版面；900～1100 px 非觸控視窗的頂列單欄規則；精簡版面只補焦點列（收在 ☰ 選單內，點按目標 44 px），其餘窄螢幕版面由 core 接手 |
| `tools/verify.mjs`、`verify-detail.mjs`、`verify-gripper.mjs` | 排程與幾何、局部機構、清洗夾具驗證 |
| `tools/browser-check.mjs`、`review-camera.mjs`、`review-scenes.mjs` | 瀏覽器檢查、焦點與相機視窗互動檢查、站位截圖 |
| `docs/planning.md` | 規劃說明（只留本機） |

使用的 core 模型（`core/models/`）：

| 站內檔案 | core 模型 |
|---|---|
| `robot.js` | `robots/fanuc-r2000ic.js`（`createArm`） |
| `agv.js` | `agv-forklift.js` |
| `storage.js` | `transport-handling.js` 的 `pallet`、`shuttleCar`、`shuttleRack` |
| `inbound.js` | `transport-handling.js` 的 `dolly`、`jibCrane` |
| `building.js` | `transport-handling.js` 的 `agvCharger` |
| `line.js` | `transport.js` 的 `vRollerConveyor`、`ballTurntable`；`conveyor.js`；`equipment-process.js` 的 `labeler`、`upender`、`weighIndicator`；`motion.js` 的 `loadCell`、`airCylinder`、`linearAxis`、`nutrunner`；`vision.js` 的 `visionCamera`；`lights.js` 的 `barLight`；`sensors.js` 的 `lightCurtain`；`indicators.js` 的 `signalTower`、`hmi` |
| `washing.js` | `equipment-process.js` 的 `airKnife`、`sprayLance`、`hotAirBlower`、`vacuumPump`、`centrifugalPump`、`diaphragmPump`、`valve`、`transferCoupling`；`motion.js` 的 `linearAxis` |
| `drum.js`、`layout.js` | `drum-200l.js` |

站內留著的（加工件或站專用機構）：清洗夾具、沖洗隔間與集液漏斗、PE 儲槽與防溢堤、貼標旋轉輥、橫躺線側板與立放線護欄、梳齒秤台、管線法蘭與泵壓表、開蓋夾緊護板。換用對照見 `core/migrations/1.10.0-*.md`。
