# 輪框吊掛線手臂下掛

FANUC 手臂＋手臂搭載雙眼立體視覺：追蹤 4 cm/s 吊掛線、抗反光辨識輪框、下掛疊放棧板

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "WheelHangingAutomaticLine"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "WheelHangingAutomaticLine"
```

開啟 http://127.0.0.1:8770/WheelHangingAutomaticLine/。網址參數：`?pause&t=5&view=pick`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

側欄：目前動作、雙眼視覺量測（示意值）、PLC／手臂訊號、棧板計數、空間檢核。相機視窗是手臂左相機的虛擬影像。視角「打光」看面光源、背板與防擺導軌，「特寫」以目前 TCP 取景。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "WheelHangingAutomaticLine"          # 完整：import 路徑、倒序一致、空間檢核、全場干涉與閃爍、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "WheelHangingAutomaticLine" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/project.js` | 建立場景、`apply(t)`（追蹤段逆解、輪框與隔板換手、感測與 HMI）、空間檢核、全場檢查設定（網頁與檢查共用） |
| `web/js/layout.js` | 配置與尺寸（DXF 量測值與假設值）、輪框款式、追蹤窗、取像距離、棧板格位 |
| `web/js/sequence.js` | 排程：追蹤段用相對輪框的位姿，結束時刻的關節角以當下絕對位姿逆解 |
| `web/js/line.js` | 吊掛線、吊鉤循環排列、取像區固定設施（防擺導軌、消光黑背板、面光源、到位光電、編碼器） |
| `web/js/robot.js` | R-2000iC/165F、伺服夾爪與 PU 指墊、雙眼相機與濾鏡座、隔板吸盤、視野錐 |
| `web/js/cell.js` | 棧板 A／B、隔板架、圍籬與光柵、控制櫃、操作站 |
| `web/js/wheel.js` | 參數化輪框（切削面材質） |
| `web/js/main.js` | 舞台（`look`／`extent`）、`createViewerWorkspace`、視角、站別按鈕、3D 標籤、播放列、面板、`exposeSim` |
| `tools/verify.mjs` | 本專案的製程規則檢查 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
