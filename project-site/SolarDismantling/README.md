# 太陽能板拆框機器人上下料

FANUC 手臂真空吸取整板送入拆框機，拆框後取出無框層壓板疊放

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "SolarDismantling"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "SolarDismantling"
```

開啟 http://127.0.0.1:8770/SolarDismantling/。網址參數：`?pause&view=machine`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

「吸盤特寫」（`view=gripper`）以目前 TCP 取景，「夾爪特寫」（`view=jaws`）看外拉與落框。`?movie` 在拆框時對準機內、測高／吸附／放板時縮短取景距離。

工程細節包含同步夾爪油壓缸、滑軌、壓板導桿、液壓雙管、後側光柵、真空支管與隨關節變形的腕部線束。短步驟另呈現雷射測高、破真空吹氣、接線盒翻落、鋁框傾斜後落定。三色燈、HMI 步驟與收集計數都由 `apply(t)` 決定；黃燈代表待命或拆框機動作，綠燈代表手臂上下料。

細節仍屬提案示意：MC4 外形與負壓開關在本站簡化建模；排水孔以暗色孔口表現，沒有加工孔幾何。18 片靜態板省略遮住的線束與角碼細節；兩片示範板保留。線束鬆弛環以關節位置決定，翻落以固定時間曲線呈現，未做柔性管線或碰撞動力學求解。後側光柵不代表現場安全驗證完成。

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
| `web/js/panel.js` | 層壓板、接線盒線束與 MC4、四支鋁框、角碼接縫與排水孔口；靜態板堆簡化模式 |
| `web/js/machine.js` | 籠架、四邊夾爪、同步油壓缸／導軌、壓板導桿、刮刀、收集槽與料箱、液壓雙管、後側光柵、銘牌 |
| `web/js/robot.js` | FANUC＋懸臂吸盤架、真空管與開關、隨關節變形的腕部線束、雷射／吹氣效果、板位姿與逆解 |
| `web/js/cell.js` | 棧板與板堆、安全圍籬、叉車口光柵、控制櫃、操作站 |
| `web/js/sequence.js` | 原有 PTP／直線排程與機台動作、各零件位置狀態、錄影各步驟的取景偏移 |
| `web/js/project.js` | 組合場景、純時間取樣的翻落／特效／三色燈／HMI、空間檢核、具理由的全場檢查放行規則 |
| `web/js/main.js` | 舞台、視角、3D 標籤、站別按鈕、現場狀態面板、拆框機內部的虛擬監看相機、播放列、錄影 |
| `tools/verify.mjs` | 直線精度、放板定位、互鎖、落點／線材收納、節拍；細節倒序一致、桿端接合、雷射／吹氣時機、0.01 s 翻落底面檢查 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
