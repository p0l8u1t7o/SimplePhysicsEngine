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

### 室外場景的環境光強度
- 提出：PV DEMO（2026-11-04；該站已於 2026-11-07 移除，暫代程式留在 commit `ad4b816`）
- 暫代：`project-site/PV DEMO/web/js/main.js`（見 `ad4b816`）的 `envMats`（逐材質設 `envMapIntensity`，隨太陽高度變化）
- 現象：stage 固定載入 RoomEnvironment，室外大場景（mm 單位、數十公尺）陰影對比被洗掉；r160 沒有 `scene.environmentIntensity`（core 1.18.0 升到 r187 後已經有了，可以直接用它實作）
- 期望介面：`createStage({ envIntensity })`＋`stage.setEnvIntensity(k)`（或 look 加 `outdoor`）
- 影響：ParkingEMS、其他室外或日夜變化的站

### 電控檢視器「聚焦元件」要依元件朝向取景
- 提出：RecycleSorter（2026-10-05）
- 暫代：`project-site/RecycleSorter/web/js/main.js` 的 `flip()`（緊接在 `createElectricalInspector` 之後的區塊）——在檢視器的「元件特寫」按鈕與元件選單上再掛一個事件，聚焦之後把鏡頭改放到元件群組本地 +Z 的方向
- 期望介面：`core/electrical/electrical-inspector.js` 的 `focus()` 用元件的世界朝向（`getWorldDirection`）取景；目前固定把鏡頭放在元件包圍盒的世界 +Z 側
- 影響：盤面不是朝 +Z 的站（本站的系統盤裝在既有電控櫃的側板上朝 −X，控制器朝 −Z）；`robotController()` 的面板朝向也固定是本地 +Z，本站用轉 180° 的安裝座暫代

### 全場檢查的「線材端點接入」放行範圍太大
- 提出：RecycleSorter（2026-10-05）
- 現象：`core/verify/scene.mjs` 的 `cableEndIn(a, b)`（`ALLOW` 的第三條規則用它）用對方整個網格的外框（再放大 30 mm）判斷線端有沒有接入。對方如果是一條 L 形的長線，外框涵蓋一大片地面，
  結果兩條不相干的線只要其中一條的端點落在另一條的外框裡，沿線的重合與交叉就全部被放行。本站原本地面主幹上好幾條線重合、交叉，都是這樣沒被抓到；
  電控櫃搬位置後端點離開外框，才一次冒出 38 筆。
- 暫代：本站已把地面主幹重排成每條線一道、不交叉（不靠放行）
- 期望：端點接入只對「端點附近 30 mm 內的那一段」放行，或只對非線材的零件（接頭、端子、設備外殼）放行
- 影響：所有有配線的站；改了之後可能會抓出其他站原本被蓋掉的線材重合，要逐站看
- 2026-11-08 補充：core 1.20.2 沿邊取樣後修 RecycleSorter 時又看到它蓋掉的例子（GC1 與 E5 沿頂樑承接條平行重疊約 5 mm、急停線與投光器線斜穿前立柱、急停線立管穿過 HMI 短懸臂）；同模組的固定件預設不比（`compareFixed` 可以開）也蓋掉手臂底座附近的幾處。

### 擴張網護板材質
- 提出：RecycleSorter（2026-10-05）
- 暫代：`project-site/RecycleSorter/web/js/frontline.js` 的 `meshGuard` 材質與 `guard(parent, a, b)`（網目貼圖依實際尺寸換算 UV，所有護板共用一個材質）
- 期望介面：`@core/geom/materials.js` 的 `MAT.expandedMesh`（或 `meshPanel(parent, a, b, { cell })`）
- 影響：有圍籬或網籠的站（目前各站用半透明的 `MAT.mesh`，近看沒有網目）

### ABB OmniCore C30 控制器與 DSQC I/O 的電控元件外觀
- 提出：core 1.10.0 整合（2026-10-05，RecycleSorter 的既有分選站；已拍板不做成 `core/models`，因為它們是電控元件）
- 暫代：`project-site/RecycleSorter/web/js/frontline.js` 的 `abbDevice()` 與其後的 DSQC 2000（`CTM1`）、OmniCore C30（`ABB1`）兩段在站內自己畫（`userData.electrical`、`electricalBody`；機身置中、轉 180° 朝門）。RC8A 用 core 的 `robotController()`，放進 `electrical.js` 轉 180° 的安裝座 `RC1 安裝座`
- 期望介面：`core/electrical/electrical-components.js` 的 `robotController`（目前只有 RC8A 與 `crc: true` 的 CRC9M 兩種外形）加 ABB OmniCore C30 的外觀與朝向參數，`electricalDevice` 加 DSQC 類 I/O 擴充模組的外觀；原點與朝向照 core 的慣例（背面在 z = 0、正面朝本地 +Z）
- 影響：和上面「聚焦元件要依元件朝向取景」一起處理（都卡在「面板固定朝本地 +Z」）；之後用 ABB 手臂的站都會用到

### 長方形棧板與木棧板
- 提出：SolarDismantling（2026-10-07）
- 現象：`pallet`（`core/models/transport-handling.js`）只有正方形塑膠棧板（`size` 單一邊長，上板與底樑沿 Z 的長度都用它）；太陽能板要 1100×1750 的長方形棧板，叉車從長邊進叉
- 暫代：`project-site/SolarDismantling/web/js/cell.js` 的 `woodPallet()`（上板＋三支沿 X 的底樑，木色材質）
- 期望介面：`pallet.create({ size: [寬, 長], runnerAxis: 'x'|'z', material: 'wood'|'plastic' })`，`size` 給單一數值時維持現狀
- 影響：之後放板材、長件的站

### FANUC R-2000iC 模型支援底座旋轉
- 提出：SolarDismantling（2026-10-07）
- 現象：`core/models/robots/fanuc-m710ic.js`（1.14.0 新增）的逆解初始解在底座座標計算，root 可以繞 Y 旋轉，用來把 J1 的 ±180° 分界轉到不需要經過的方向；`core/models/robots/fanuc-r2000ic.js` 仍假設 root 不旋轉（`createArm` 註解寫明不可旋轉，`seeds()` 直接用世界座標減 root 位置）
- 期望：R-2000iC 的 `seeds()` 照 M-710iC 的寫法改成底座座標（目前用 R-2000iC 的化學桶清洗線、輪框吊掛線都沒有轉 root，要用基準截圖與場景傾印確認畫面不變）
- 影響：之後用 R-2000iC 且需要轉向的站

### 吊掛輸送線（I 型鋼軌道＋吊鉤）與鋁合金輪框模型
- 提出：WheelHangingAutomaticLine（2026-10-12）
- 現象：core 只有地面輸送（滾筒、皮帶）；吊掛線的軌道、支架、台車與 C 型吊鉤，以及參數化的鋁合金輪框（輪圈旋轉體、輪轂中心孔與螺栓孔、輪輻、切削面材質）都在站內自己畫
- 暫代：`project-site/WheelHangingAutomaticLine/web/js/line.js`（軌道、支架、`createHook`、吊鉤循環排列 `hookX`）、`web/js/wheel.js`（`createWheel(spec)`）
- 期望介面：`overheadConveyor.create({ length, railY, hooks: { pitch, shape }, supports })` ＋ `set({ s })`；`wheel.create({ od, w, bore, pcd, lugs, spokes, hub, finish })`
- 影響：之後有吊掛線、輪框或圓盤件搬運的站

### 手臂搭載雙眼相機頭（兩台相機＋基線樑＋選配投影器）
- 提出：WheelHangingAutomaticLine（2026-10-12）
- 現象：用兩個 `visionCamera` 加碳纖維樑、濾鏡座、投影器在站內組；視野錐（視野錐體效果）也是站內畫
- 暫代：`project-site/WheelHangingAutomaticLine/web/js/robot.js`「雙眼相機」一段
- 期望介面：`stereoHead.create({ baseline, focal, sensor, tilt, filters, projector })`，回傳左右相機與 `setFov(dist)`
- 影響：之後手眼立體視覺的站

### 停車場與能源設備模型（電動車、充電樁、儲能櫃、配電盤、光電車棚、柵欄機、車載吊車）
- 提出：ParkingEMS（2026-10-14）
- 現象：core 沒有室外與能源類設備；電動車（含充電口）、背景停放車輛（InstancedMesh）、AC 壁掛／立柱與 DC 快充樁、室外儲能櫃、低壓配電盤、受電變壓器、PV 逆變器、柵欄機、車牌辨識相機、繳費機、路燈、電桿、施工圍籬、伸縮臂車載吊車、T 型雙懸臂光電車棚都在站內畫
- 暫代：`project-site/ParkingEMS/web/js/models.js`（全部）、`web/js/lot.js`（停車場鋪面與標線、建物、植栽）
- 外觀與動作暫代補充（2026-10-14）：本站 `vehicles.js` 的曲面車體／開門、`surfaces.js` 的戶外材質、`site-details.js` 的植栽／立面、`outdoor-lighting.js` 的日夜天空，以及 `operator.js` 固定骨長與 `charging-cable.js` 的兩端固定下垂線。尚未提升為 core API；抽出時需保留幾何、倒序與場景回歸。
- 寫實渲染暫代補充（2026-10-14）：`cinematic-assets.js` 封裝 PBR／HDRI 的同源載入與可見降級；`cinematic-renderer.js` 為支援標準／對數深度的 HDR 接觸遮蔽與高低畫質管線。抽入 core 前需保留多相機子畫面、手機模式、缺檔處理與全部站的基準回歸；來源授權清單在本站 `web/assets/`。
- 期望介面：`evCharger.create({ type: 'AC'|'DC', kw, mount })` ＋ `set(state)`／`screen`；`bess.create({ kw, kwh, size })`；`carport.create({ cols, mod, nx, ny, tilt })`；`truckCrane.create({ boom, scale })` ＋ `aim(hook)`；`car.create({ color })` ＋ `portWorld(side)`
- 影響：之後的能源、停車、室外工地類展示


### 作業員模型（站立、走動、手臂擺動）
- 提出：ChemicalTankWashing（2026-10-31）
- 暫代：`project-site/ChemicalTankWashing/web/js/filling.js` 的 `person()`（工作服、安全帽，兩臂各一個可轉的群組）；擦拭人員放在場景頂層的 `people` 群組，全場檢查會對所有設備檢查
- 期望介面：`core/models/` 的 `operator.create({ color, helmet })`，`set({ walk, armL, armR })` 或 `pose('stand'|'wipe'|'press')`；身高、肩寬可參數化
- 影響：需要表現人工作業的站（擦拭、上下料、目檢）；ParkingEMS 的人物、RecycleSorter 的作業員

### `drumJaws` 加爪片寬度選項
- 提出：ChemicalTankWashing（2026-10-31）
- 現象：`core/models/drum-200l.js` 的 `drumJaws()` 每片爪約 80°（1.4 rad）。從 2×2 棧板夾桶時，不管轉到哪個方位，爪片邊緣都會掃到同板相鄰的桶（本站量到最多約 110 mm，被「桶整個放行」蓋住）。
- 暫代：`project-site/ChemicalTankWashing/web/js/drum.js` 的 `narrowJaws(parent, stroke)`（每片 30°，`JAW_ARC`），夾爪轉 ±45° 對準對角；`tools/verify.mjs` 檢查夾爪對同板的桶
- 期望介面：`drumJaws(parent, armTo, stroke, { arc })`，預設維持 1.4 rad（現有外觀不變）
- 影響：用 `drumJaws` 從棧板夾桶的站

### 桶裝填裝頭（灌裝槍＋鎖蓋頭換位）
- 提出：ChemicalTankWashing（2026-10-31）
- 暫代：`project-site/ChemicalTankWashing/web/js/filling.js` 的填裝頭（每位一組：換位橫樑、台車、灌裝槍升降、2"／3/4" 伺服鎖付頭，鎖付頭用 core 的 `nutrunner`）
- 期望介面：`core/models/equipment-process.js` 的 `drumFillHead.create({ shift, bungR })`，`set({ e, sx, cy, spin })`（灌裝槍插入量、換位、鎖蓋頭下降、套筒轉數）
- 影響：其他桶裝、IBC 填裝的站

### 孿生：由站產生 MD（S4，第二階段）
- 提出：AutoSequence 孿生開發計畫 v0.2（2026-10-22，4.6 節；藍圖 §9 P3）
- 暫代：MGPC 用 Automation-Schema 的範例 MD 原樣複本（`project-site/MilitaryGradePC/twin/`）
- 期望介面：`core/twin/md-export.mjs`：從站產生 MD v2（設備、軸、IO、致動器、感測器、機器人、場景綁定），只寫 SPE 擁有的欄位、AutoSequence 擁有的欄位讀入時保留，ID 穩定、輸出決定性；IO 表的版控來源要先決定（MGPC 的電控資料只在本機 `docs/`）
- 影響：之後接孿生的站；驗收 SPE-AC-24
