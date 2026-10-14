# 停車場光儲充能源服務

三種場型（旗艦型光儲充、住商型與都會型市電儲能充電）的建置流程、全天 EMS 調度與停充整合

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "ParkingEMS"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "ParkingEMS"
```

開啟 http://127.0.0.1:8770/ParkingEMS/。網址參數：`?site=flagship｜mixed｜urban`（場型，側欄「場型」也能切換）、`?pause&t=110&view=charging`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

視角：全景、入口、能源區、充電區、車棚（旗艦型）、俯視、追車（追客戶車輛）。側欄：場型與場地條件、目前動作、能源調度（時刻、時段、光電、充電負載、儲能、SOC、市電對契約容量）、客戶充電、充電樁狀態、三種場型比較、空間檢核。相機視窗可切換「EMS 調度畫面」（全天曲線與目前時刻）與「充電區監視器（虛擬）」。

所有容量、需求與時段都是假設的示意值（見 `AGENTS.md`），不是場站設計或投資報價。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "ParkingEMS"          # 完整：import 路徑、結構、用戶名稱、倒序一致、空間檢核、全場干涉與閃爍、配線與電盤、物理、BOM 一致性、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "ParkingEMS" --quick  # 部署前快速檢查
```

## 動畫細節

- 三種場型共用「開門下車 → 走到槍座 → 取槍 → 持槍步行 → 插槍授權 → 回座 → 下車拔槍 → 歸槍 → 回座關門 → 倒車」流程。步行以 1.05 m/s、上下車各 2.6 秒作展示假設；轉身、退槍與充電口蓋連續取樣。固定長度的上臂／前臂以關節與軀幹前傾追隨槍把。人體仍標 `operatorProxy`，不代表人體碰撞或安全驗證；連接器與動態槍線仍進場景檢查。
- 客戶操作段已延長；旗艦／住商／都會總長約 157.3／124.1／143.6 秒。車門關閉、駕駛回座與歸槍完成後才倒車。槍線採固定線段的下垂曲線，兩端持續連接樁體與槍把，沒有做繩索動力學、固定線長或廠商電纜可達認證。
- 車體改為分段曲面、斜風擋、側窗、窗柱、可開前門、座椅、後視鏡、輪胎與輪圈；背景占位車共享車身幾何並保留實例化。輪圈依路徑弧長／輪胎半徑轉動，倒車反轉；移動車輛依日夜亮頭燈，客戶車輛有煞車燈、倒車燈、充電口蓋與車牌 `EVA-0588`（示意）。
- AC／DC 螢幕依序顯示「確認費率（示意）→ 授權 → 啟動成功 → 充電中／排程等待 → 完成」，功率與已充電量取自既有 EMS 模型。車載 SOC 僅以 **60 kWh 電池、起始 30%** 換算作顯示假設，與能源區的儲能 SOC 分開，不回寫能源模型。繳費機與出口顯示「停車＋充電合併結算 ✓」，金額只有「示意」。
- 相機視窗新增「入口車辨（虛擬）」：3D 影像、與既有補光時窗同步的掃描光束、車牌四角投影框。投影會排除背面與遮擋，不是 OCR 或辨識精度驗證。虛擬取像點相對原相機往閘桿內側偏移，避免機殼及車側遮蔽；原有相機實體位置不變。
- 施工新增基礎暗色剖面、鋼筋籠、配管前開挖與配管後回填的管溝、第一吊前的載貨平板車、施工告示牌「分區施工　照常營業」、指揮及模組安裝姿勢。地下坑是地表剖面示意，沒有對地坪做布林開孔；貨車卸料與後續批次配送尚未逐件演出。原始吊裝、建置及能源數值不變。
- 瀝青／混凝土／草地採固定種子紋理；補入口排水格柵、止輪擋、檢修蓋、建物樓層／陽台／屋頂與分枝樹冠。車棚補 I 型鋼、錨栓、模組電池片、邊框、線槽、天溝與接至柱側的落水管；圍籬改為可透視網孔與鋼管框。線槽與集水管在屋面就位後安裝，避免穿過主樑。
- 能量流箭頭依功率正負、大小改變方向、透明度與速度。能源區數值牌只在營運情境顯示。天空、霧與金屬環境反射隨日夜改變；旗艦型有棚底 LED，每場以 4～5 盞無陰影 SpotLight 補足路燈照明。環境反射使用一次預烘的天空貼圖與日夜強度調整，並非逐時光線追蹤。
- 儲能／EMS／配電櫃外增加門把、格柵、消防偵測器、急停、接地端子與警示；EMS 螢幕補上契約容量與限功率狀態。附件是外觀示意，**未建立櫃內電控與消防迴路**，因此 electrical 檢查仍為略過，不能據此聲稱電控驗收通過。
- `?movie` 使用事件複本設定施工、能源區與客戶情境的鏡頭偏移及焦點；不修改時間軸事件。充電區改從車道側看充電樁正面，桌面也啟用標籤避讓。

新增模組：`detail-state.js`（純取樣）、`operator.js`（姿勢）、`details.js`（客戶／能源）、`construction-details.js`（施工）、`lpr-overlay.js`（投影）。`tools/verify-details.mjs` 由原本的 `verify.mjs` 一併執行，結果在 `review/animation-details.json`。

本輪未加預拌車澆置、吊車撐腳收放與櫃內電控。撐腳屬基準指紋的原有移動物件，收放會改變其既有世界座標，故優先維持原指紋。完整施工物流及電控應另作有設計依據的擴充。

排程指紋工具從本站工作目錄載入 core，獨立庫的正確相對路徑為：

```powershell
node core/tools/run.mjs ParkingEMS ../../core/verify/run.mjs fingerprint
node --import ./core/tools/register.mjs project-site/ParkingEMS/tools/verify.mjs
$env:UI_PORT='8793'; node core/tools/check.mjs ParkingEMS
```

2026-10-14 已批准重排客戶動作，舊版 events／total／時間指紋不再相等；車輛道路幾何與 EMS 規則沿用。驗證以新時序的互鎖、倒序一致與能源守恆為準，不能把舊指紋相同當成本次驗收條件。

實物感檢查與固定鏡頭（從根目錄執行）：

```powershell
node --import ./core/tools/register.mjs project-site/ParkingEMS/tools/verify-realism.mjs
node project-site/ParkingEMS/tools/render-realism.mjs TEMP/pems-realism-shots 8848
```

`verify-realism.mjs` 一併由 `verify.mjs` 執行，檢查手與槍把接觸、固定骨長、槍線端點、操作期間車輛靜止、授權前無供電及倒車互鎖。`render-realism.mjs` 取得三場型 31 個固定畫面與本機無頭瀏覽器幀時間。結果與資料限制見 [review/render-realism.md](review/render-realism.md)。新增外觀模組為 `vehicles.js`、`surfaces.js`、`site-details.js`、`outdoor-lighting.js`；動作模組為 `customer-motion.js`、`charging-cable.js`。

## 渲染品質（2026-10-14 第二輪）

桌面預設高畫質：HDR 環境反射、瀝青／混凝土 PBR 紋理、4× MSAA 的 HDR 色彩緩衝、螢幕空間接觸遮蔽、輕微亮部擴散及 4096 太陽陰影。觸控裝置或寬度 ≤900 px 預設低畫質：DPR 上限 1、1024 太陽陰影、直接渲染。桌面 DPR 上限 1.5；可用 `?site=urban&quality=low` 或 `&quality=high` 覆寫，重新載入時套用。

三場型共用加密車體／曲面玻璃／輪胎、實例化薄葉樹冠及立體建物窗框。素材封裝於 `web/assets/`，來源與授權見 [素材說明](web/assets/README.md)。桌面採 4K 天空，低畫質採 1K；表面貼圖逾時 8 秒、HDRI 逾時 20 秒，缺檔時顯示提示並保留基本材質／天空。`window.sim.renderQuality`、`window.sim.assets` 可查實際模式與素材狀態。

```powershell
node project-site/ParkingEMS/tools/verify-cinematic.mjs TEMP/pems-cinema/pipeline 8854
node project-site/ParkingEMS/tools/render-realism.mjs TEMP/pems-cinema/final-review 8853
```

第一個工具查素材雜湊、三場型的桌面／手機／標準深度渲染及強制缺檔降級；第二個取得固定事件畫面和本機播放量測。桌面 30 FPS 是目標，仍需在展示電腦確認。程序車體／人物與固定 HDRI 尚不等同掃描模型或離線電影渲染，詳見 [本輪驗證](review/cinematic-render.md)。

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/project.js` | 組裝場景、`apply(t)`（構件出現、吊車、車輛與充電線、閘門、能量流、螢幕）、空間檢核、全場檢查設定（網頁與檢查共用） |
| `web/js/sites.js` | 三種場型的配置與設備規模（假設值集中在這裡）、充電樁安裝位置、比較表 |
| `web/js/energy.js` | 全天 EMS 調度模型與充電需求場次 |
| `web/js/sequence.js` | 三種場型的時間軸、施工構件出現方式、吊裝排程、時鐘對照、客戶車輛腿段與閘門時機 |
| `web/js/lot.js` | 停車場鋪面與標線、街道、建物、植栽、入口閘門、繳費機、路燈、電桿、能源區圍籬與隔音牆 |
| `web/js/models.js` | 設備與車輛模型（core 沒有的暫代，已登記 `core/REQUESTS.md`） |
| `web/js/paths.js` | 車輛路徑（圓角折線、貝茲、倒車） |
| `web/js/main.js` | 舞台、日照（太陽方位與夜間照明）、視角、站別與場型切換、3D 標籤、播放列、面板、EMS 調度畫面、`exposeSim`、錄影 |
| `tools/verify.mjs` | 調度的功率平衡與 SOC 連續、契約容量與尖峰規則、上線前無充電車、客戶車輛只在閘門開啟時通過、停妥才插槍 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
