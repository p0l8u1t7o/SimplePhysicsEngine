# 太陽能板拆框機器人上下料

FANUC M-710iC/45M＋懸臂移載機：A/B 雙工位上下料、拆框機訊號交握、餘料外送到大料車

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "SolarDismantling"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "SolarDismantling"
```

開啟 http://127.0.0.1:8770/SolarDismantling/。網址參數：`?fault`（情境：拆框機故障）、`?pause&view=transfer`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

側欄：情境切換、棧板工位（片數與狀態）、訊號交握（PLC 與拆框機的 I/O、互鎖）、手臂選型評估、空間檢核。視角「特寫」（`view=gripper`）以目前 TCP 取景。

細節仍屬提案示意：拆框機尺寸、夾爪驅動位置與落料路線是依影片推估；M-710iC/45M 的臂長是推估值；線束鬆弛環以關節位置決定，翻落以固定時間曲線呈現，未做柔性管線或碰撞動力學求解；光柵與互鎖不代表現場安全驗證完成。

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
| `web/js/layout.js` | 配置與尺寸（工件、拆框機、交接台、移載機、手臂、吸盤架、A/B 工位、餘料、圍籬）；標「假設」的值待現場量測 |
| `web/js/panel.js` | 層壓板、接線盒線束與 MC4、四支鋁框、角碼接縫與排水孔口；靜態板堆簡化模式 |
| `web/js/machine.js` | 籠架、四邊夾爪（兩端外側無桿缸）、壓板與導桿、刮刀、長框輸送帶、短框抽屜料箱、接線盒漏斗與滑槽、機外料車與料箱、液壓管、後側光柵、銘牌 |
| `web/js/transfer.js` | 交接台（托條、定位塊、置中推缸、有板感測）與懸臂移載機（導軌、台車、升降立柱、懸臂吸盤框） |
| `web/js/robot.js` | M-710iC/45M（底座轉 90°）＋置中吸盤架、真空管與開關、腕部線束、雷射／吹氣效果、板位姿與逆解 |
| `web/js/cell.js` | A/B 棧板與板堆、工位硬體（擋塊、導引、感測、滿疊光電、工位燈、按鈕盒）、圍籬與四組光柵、控制櫃、操作站 |
| `web/js/sequence.js` | 六段排程（手臂 PTP／直線、移載機、拆框機、零件位置狀態）、A/B 換工位、故障情境 |
| `web/js/selection.js` | 手臂選型評估：候選型號型錄值、兩種夾持方式的負載／力矩／慣量需求與判定 |
| `web/js/project.js` | 組合場景、`apply(t)`（零件位置、訊號交握、工位燈、三色燈、HMI、效果）、空間檢核、放行規則 |
| `web/js/main.js` | 舞台、視角、3D 標籤、站別按鈕、側欄（情境、工位、訊號、選型、檢核）、拆框機內部的虛擬監看相機、播放列、錄影 |
| `tools/verify.mjs` | 兩個情境各跑：直線精度、交接台放板定位、互鎖（拆框時移載機待命、手臂與移載機間距、故障時停止搬料）、餘料落點、A/B 換工位、效果時機、倒序一致；選型結果寫入 `review/verification.json` |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
