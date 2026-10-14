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
node ../../core/tools/check.mjs "ParkingEMS"          # 完整：import 路徑、倒序一致、空間檢核、全場干涉與閃爍、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "ParkingEMS" --quick  # 部署前快速檢查
```

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
