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

### 同軸光源、低角度環形光（暗場）的共用模型
- 提出：WaferInspection（2026-11-14）
- 暫代：`project-site/WaferInspection/web/js/machine.js` 的 `coaxial light`（鏡頭側光源盒＋發光面）與 `darkfield ring light`（環形外殼＋內緣發光環＋夾環與吊桿）
- 期望介面：`coaxLight.create({ size, side })`、`ringLight.create({ diameter, height, angle })`，`set({ light })` 控制亮度；和 `vision-camera` 的鏡頭可以組合
- 影響：AOI 類的站（WorkpieceMeasurement、PlumbingFixtureInspection、shutter assembly）

### 晶圓載台：θ 微調台＋真空吸盤
- 提出：WaferInspection（2026-11-14）
- 暫代：`project-site/WaferInspection/web/js/machine.js` 的 `theta stage`、`vacuum chuck`（多孔陶瓷＋鋁環）
- 期望介面：`waferChuck.create({ diameter, thetaRange })`，回傳可轉的 rotor 群組與晶圓安裝面高度
- 影響：之後的半導體或面板類站

### optics：固定倍率物鏡的 NA 景深，以及晶圓／圖案化表面的適用範圍標示
- 提出：WaferInspection（2026-11-14）
- 現象：`optics.js` 的鏡頭只有薄透鏡或固定倍率（遠心），景深用 F 值近似；晶圓這類顯微取像通常給 NA。L2 的材質沒有拋光矽或圖案化表面，站只能借用「鏡面金屬」判斷明暗場，並在畫面上自行說明不能預測薄膜干涉、圖案繞射與缺陷散射。
- 暫代：`project-site/WaferInspection/web/js/budget.js` 用 `{ type: '遠心', magnification, fNumber }` 與 `鏡面金屬`，結果旁邊加警示
- 期望介面：`lens.na`（DOF ≈ λ/NA² + 像素項）；`MATERIALS` 加「拋光矽」並在結果列加 `applicability` 說明（哪些現象不在模型內）
- 影響：AOI 類的站、studio 的光學工作台

### 停拍掃描取像時序（移動、停穩、曝光、相機緩衝、介面傳輸、並行處理）
- 提出：WaferInspection（2026-11-14）
- 暫代：`project-site/WaferInspection/web/js/sequence.js` 的 `buildSchedule`（梯形速度、緩衝滿時等待、處理執行緒池，同一份時序給動畫與週期估算）
- 期望介面：`core/anim` 或 `core/optics` 提供 `stopAndGo({ positions, motion, camera, interface, processing })` → 每個位置的曝光、傳輸、處理時間與關鍵路徑分項
- 影響：多視野拼接的 AOI 站

### `cable()` 的管子分段依長度
- 提出：RecycleSorter（2026-11-08）
- 現象：`electrical/cable-routing.js` 的 `cable()` 管子固定 64 段，幾公尺長的線每段 40～60 mm，轉角被弦切進內側 10～20 mm；並排 9 mm 的一束線在彎道互相穿過，加大間距也沒用。
- 暫代：`project-site/RecycleSorter/web/js/electrical-details.js` 的 `fineCable()`（沿同一條中心線重建管子，每段 ≤ 6 mm；線夾、端子、`userData.cable` 不動）
- 期望介面：`cable(…, { segmentLength = 6 })`，分段數 `ceil(長度 ÷ segmentLength)`；或只在轉角附近加密（頂點數對手機幀率的影響要量）
- 影響：所有有配線的站（外觀與 scene 結果都會變，要跑全站截圖與 scene）

### scene 干涉檢查：InstancedMesh 不檢查、薄板可能落在取樣點之間
- 提出：MilitaryGradePC（2026-11-08，修 S1 相機線時看到）
- 現象：`verify/scene.mjs` 只收一般網格，拖鏈的鏈節（`carrier` 用 InstancedMesh）完全不在檢查範圍；相機線原本垂直穿過下層鏈也沒被抓到。另外沿邊取樣每 20 mm 一點，8 mm 的薄導板剛好落在兩點之間時，線材斜穿過它也會漏（雙方都沒有取樣點在對方體內）。
- 暫代：站已改線路避開，沒有靠檢查
- 期望：InstancedMesh 逐個實例展開成有向包圍盒（數量多時只取外框）；薄件（任一邊 < 取樣間距）改用線段對方塊的相交測試，或取樣間距依對方最薄的邊縮小
- 影響：所有用拖鏈、InstancedMesh 陣列（光伏板、料件）的站

### ABB OmniCore C30 控制器與 DSQC I/O 的電控元件外觀
- 提出：core 1.10.0 整合（2026-10-05，RecycleSorter 的既有分選站；已拍板不做成 `core/models`，因為它們是電控元件）
- 暫代：`project-site/RecycleSorter/web/js/frontline.js` 的 `abbDevice()` 與其後的 DSQC 2000（`CTM1`）、OmniCore C30（`ABB1`）兩段在站內自己畫（`userData.electrical`、`electricalBody`；機身置中、轉 180° 朝門）。RC8A 用 core 的 `robotController()`，放進 `electrical.js` 轉 180° 的安裝座 `RC1 安裝座`
- 期望介面：`core/electrical/electrical-components.js` 的 `robotController`（目前只有 RC8A 與 `crc: true` 的 CRC9M 兩種外形）加 ABB OmniCore C30 的外觀與朝向參數，`electricalDevice` 加 DSQC 類 I/O 擴充模組的外觀；原點與朝向照 core 的慣例（背面在 z = 0、正面朝本地 +Z）
- 影響：之後用 ABB 手臂的站都會用到。電控檢視器的「聚焦元件」已在 1.20.4 改成依元件朝向取景，轉 180° 的元件不必再翻面暫代

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
- core 已有的（1.20.2，本站尚未換用）：太陽能板 `pvModule`／`pvArray`、組串式變流器 `stringInverter`（`core/models/pv.js`）
- 期望介面：`evCharger.create({ type: 'AC'|'DC', kw, mount })` ＋ `set(state)`／`screen`；`bess.create({ kw, kwh, size })`；`carport.create({ cols, mod, nx, ny, tilt })`；`truckCrane.create({ boom, scale })` ＋ `aim(hook)`；`car.create({ color })` ＋ `portWorld(side)`
- 影響：之後的能源、停車、室外工地類展示

### 作業員模型（站立、走動、手臂擺動）
- 提出：ChemicalTankWashing（2026-10-31）
- 暫代：`project-site/ChemicalTankWashing/web/js/filling.js` 的 `person()`（工作服、安全帽，兩臂各一個可轉的群組）；擦拭人員放在場景頂層的 `people` 群組，全場檢查會對所有設備檢查
- 期望介面：`core/models/` 的 `operator.create({ color, helmet })`，`set({ walk, armL, armR })` 或 `pose('stand'|'wipe'|'press')`；身高、肩寬可參數化
- 影響：需要表現人工作業的站（擦拭、上下料、目檢）；ParkingEMS 的人物、RecycleSorter 的作業員

### 桶裝填裝頭（灌裝槍＋鎖蓋頭換位）
- 提出：ChemicalTankWashing（2026-10-31）
- 暫代：`project-site/ChemicalTankWashing/web/js/filling.js` 的填裝頭（每位一組：換位橫樑、台車、灌裝槍升降、2"／3/4" 伺服鎖付頭，鎖付頭用 core 的 `nutrunner`）
- 期望介面：`core/models/equipment-process.js` 的 `drumFillHead.create({ shift, bungR })`，`set({ e, sx, cy, spin })`（灌裝槍插入量、換位、鎖蓋頭下降、套筒轉數）
- 影響：其他桶裝、IBC 填裝的站
