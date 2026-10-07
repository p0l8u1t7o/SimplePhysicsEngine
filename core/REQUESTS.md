# core 需求登記

子專案發現 core 缺功能時，先在專案內暫代，再登記在這裡；由主 session（core 維護）判斷後統一實作（基準截圖 → 實作 → 全專案檢查 → 比對），再讓各站改用。規則見根目錄 `AGENTS.md`「範圍」。

任何範圍的 session 都可以改本檔。登記格式：

```
### <一句話需求>
- 提出：<專案>（<日期>）
- 暫代：<專案內的檔案與函式>
- 期望介面：<想要的 core API，例如 createX({ … })>
- 影響：<還有哪些站可能會用到>
```

實作完成後，把該條目移到 `core/MIGRATION.md` 的進度紀錄，並從這裡刪除。

## 待處理

### 電控檢視器「聚焦元件」要依元件朝向取景
- 提出：RecycleSorter（2026-10-05）
- 暫代：`project-site/RecycleSorter/web/js/main.js`——在檢視器的「元件特寫」按鈕與元件選單上再掛一個事件，聚焦之後把鏡頭改放到元件群組本地 +Z 的方向
- 期望介面：`focus()` 用元件的世界朝向（`getWorldDirection`）取景；目前固定把鏡頭放在元件的世界 +Z 側
- 影響：盤面不是朝 +Z 的站（本站的系統盤裝在既有電控櫃的側板上朝 −X，控制器朝 −Z）；`robotController()` 的面板朝向也固定是本地 +Z，本站用轉 180° 的安裝座暫代

### 全場檢查的「線材端點接入」放行範圍太大
- 提出：RecycleSorter（2026-10-05）
- 現象：`core/verify/scene.mjs` 的 `cableEndIn(a, b)` 用對方整個網格的外框（再放大 30 mm）判斷線端有沒有接入。對方如果是一條 L 形的長線，外框涵蓋一大片地面，
  結果兩條不相干的線只要其中一條的端點落在另一條的外框裡，沿線的重合與交叉就全部被放行。本站原本地面主幹上好幾條線重合、交叉，都是這樣沒被抓到；
  電控櫃搬位置後端點離開外框，才一次冒出 38 筆。
- 暫代：本站已把地面主幹重排成每條線一道、不交叉（不靠放行）
- 期望：端點接入只對「端點附近 30 mm 內的那一段」放行，或只對非線材的零件（接頭、端子、設備外殼）放行
- 影響：所有有配線的站；改了之後可能會抓出其他站原本被蓋掉的線材重合，要逐站看

### 擴張網護板材質
- 提出：RecycleSorter（2026-10-05）
- 暫代：`project-site/RecycleSorter/web/js/frontline.js` 的 `meshGuard` 材質與 `guard(parent, a, b)`（網目貼圖依實際尺寸換算 UV，所有護板共用一個材質）
- 期望介面：`@core/geom/materials.js` 的 `MAT.expandedMesh`（或 `meshPanel(parent, a, b, { cell })`）
- 影響：有圍籬或網籠的站（目前各站用半透明的 `MAT.mesh`，近看沒有網目）

### ABB OmniCore C30 控制器與 DSQC I/O 的電控元件外觀
- 提出：core 1.10.0 整合（2026-10-05，RecycleSorter 的既有分選站；已拍板不做成 `core/models`，因為它們是電控元件）
- 暫代：`project-site/RecycleSorter/web/js/frontline.js` 229～262 行在站內自己畫（`userData.electrical`、`electricalBody`；機身置中、轉 180° 朝門）
- 期望介面：`core/electrical/electrical-components.js` 的 `robotController` 加 ABB OmniCore C30 的外觀與朝向參數，`electricalDevice` 加 DSQC 類 I/O 擴充模組的外觀；原點與朝向照 core 的慣例（背面在 z = 0、正面朝本地 +Z）
- 影響：和上面「聚焦元件要依元件朝向取景」一起處理（都卡在「面板固定朝本地 +Z」）；之後用 ABB 手臂的站都會用到

### 文字貼紙（`decal`）與模型標籤改成「建立當下」判斷有沒有 `document`
- 提出：core 1.10.0 各站換用（2026-10-05，RobotArmPressSSD）
- 現象：`core/geom/shapes.js` 的 `HAS_DOM` 在模組載入時就決定；`decal()`、`visionCamera` 的 `label`、`indicators.js` 的面板文字都用它把關。檢查腳本如果先 import 模型、之後才補 `document`（SSD 的 `tools/verify*.mjs`），貼紙不會建立，網格數就和站內自己畫的寫法不同。
- 暫代：SSD 的手腕相機標籤留在站內畫（`project-site/RobotArmPressSSD/web/js/robot.js`）
- 期望：改成呼叫當下判斷 `typeof document`。影響所有用 `decal` 的站在檢查腳本裡的網格數，要先拍基準、逐站比對 review 檔再改。
- 影響：所有站

### 模型提供 `cableHost` 選項；`codeReader` 機身名稱
- 提出：core 1.10.0 各站換用（2026-10-05，酸鹼、軍規、PCB）
- 現象：原本是站內普通群組的設備換成模型後，root 變成走線固定面的來源，站要自己標 `root.userData.cableHost = false`（見 `core/migrations/` 四份對照最後一節）。`codeReader` 的機身網格預設名稱是 `camera body`。
- 期望介面：各模型的 options 加 `cableHost`（預設照現在）；`codeReader` 機身預設名稱改成 `reader body`（改名前先查各站用名稱判斷的規則）
- 影響：之後換用或新做的站

### 長方形棧板與木棧板
- 提出：SolarDismantling（2026-10-07）
- 現象：`pallet`（`transport-handling.js`）只有正方形塑膠棧板（`size` 單一邊長）；太陽能板要 1100×1750 的長方形棧板，叉車從長邊進叉
- 暫代：`project-site/SolarDismantling/web/js/cell.js` 的 `woodPallet()`（上板＋三支沿 X 的底樑，木色材質）
- 期望介面：`pallet.create({ size: [寬, 長], runnerAxis: 'x'|'z', material: 'wood'|'plastic' })`，`size` 給單一數值時維持現狀
- 影響：之後放板材、長件的站

### FANUC R-2000iC 模型支援底座旋轉
- 提出：SolarDismantling（2026-10-07）
- 現象：`fanuc-m710ic.js`（1.14.0 新增）的逆解初始解在底座座標計算，root 可以繞 Y 旋轉，用來把 J1 的 ±180° 分界轉到不需要經過的方向；`fanuc-r2000ic.js` 仍假設 root 不旋轉
- 期望：R-2000iC 的 `seeds()` 照 M-710iC 的寫法改成底座座標（化學桶清洗線要用基準截圖與場景傾印確認畫面不變）
- 影響：之後用 R-2000iC 且需要轉向的站
