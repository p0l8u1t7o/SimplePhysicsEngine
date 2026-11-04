# 屋頂光伏電場

鋸齒屋面與鋼架斜置陣列的屋頂型光伏電場：一天的日照、發電與併網

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "PV DEMO"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "PV DEMO"
```

開啟 http://127.0.0.1:8770/PV%20DEMO/。網址參數：`?pause&t=27&view=rack`（視角：`iso`、`saw`、`rack`、`inv`、`top`）、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`、`?movie`。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨雲影），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "PV DEMO"          # 完整：import 路徑、結構、用戶名稱、倒序一致、空間檢核、全場干涉與閃爍、配線與電盤、物理、BOM 一致性、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "PV DEMO" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/layout.js` | 配置與假設值（建物、陣列、變流器、雲、損失係數） |
| `web/js/solar.js` | 太陽位置、晴空日射、斜面日射、遮蔭射線（純函式） |
| `web/js/models.js` | 幾何：建物與鋸齒屋面、太陽能板（InstancedMesh）、鋼架、塔樓、變流器區與線槽、流向管、併網點、遠景、雲 |
| `web/js/project.js` | 板片清單、逐片遮蔭與發電、時間軸（一天的時刻與雲）、累積發電量表、`apply(t)`、空間檢核、全場檢查設定（網頁與檢查共用） |
| `web/js/main.js` | 舞台（`look`／`extent`）、天色（太陽燈位、天空顏色、環境光強度）、`createViewerWorkspace`、視角、站別按鈕、3D 標籤、即時發電與發電曲線、播放列、`exposeSim` |
| `tools/verify.mjs` | 發電模型檢查：夜間為零、峰值不超過額定、等效日照時數、雲遮驟降、遮蔭模型有作用、累積量不倒退 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
