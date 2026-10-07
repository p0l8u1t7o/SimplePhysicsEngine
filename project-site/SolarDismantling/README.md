# 太陽能板拆框機器人上下料

FANUC 手臂真空吸取整板送入拆框機，拆框後取出無框層壓板疊放

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "SolarDismantling"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "SolarDismantling"
```

開啟 http://127.0.0.1:8770/SolarDismantling/。網址參數：`?pause&view=machine`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "SolarDismantling"          # 完整：import 路徑、倒序一致、空間檢核、全場干涉與閃爍、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "SolarDismantling" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/layout.js` | 配置與尺寸（工件、拆框機、手臂、吸盤架、棧板、圍籬）；標「假設」的值待現場量測 |
| `web/js/panel.js` | 太陽能板零件：層壓板、接線盒、四支鋁框（各自是場景第一層群組，拆框後分開移動） |
| `web/js/machine.js` | 拆框機：籠架、四邊夾爪（承板＋擺動壓指）、中央壓板、剝線盒刮刀、鋁框收集槽、接線盒料箱、液壓站 |
| `web/js/robot.js` | FANUC R-2000iC/165F＋懸臂側進式真空吸盤架、板位姿 `posePanel`、逆解 |
| `web/js/cell.js` | 棧板與板堆、安全圍籬、叉車口光柵、控制櫃、操作站 |
| `web/js/sequence.js` | 排程（`createStepSequence`）：手臂 PTP／直線段、拆框機動作、各零件位置狀態 |
| `web/js/project.js` | 組合場景、`apply(t)`（零件位置）、空間檢核、全場檢查放行規則（網頁與檢查共用） |
| `web/js/main.js` | 舞台、視角、3D 標籤、站別按鈕、現場狀態面板、拆框機內部的虛擬監看相機、播放列、錄影 |
| `tools/verify.mjs` | 本站檢查：直線段偏差、放板定位、拆框時手臂在機外（互鎖）、鋁框與接線盒落點、節拍 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
