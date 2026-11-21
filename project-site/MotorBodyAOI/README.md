# 馬達本體 AOI 檢測機

杯形鑄鋁本體 12 面外觀檢測：雙光學站固定相機＋工件旋轉取像、翻轉 180°、OK／NG 分料

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "MotorBodyAOI"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "MotorBodyAOI"
```

開啟 http://127.0.0.1:8770/MotorBodyAOI/。網址參數：`?pause&t=5&view=pick`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "MotorBodyAOI"          # 完整：import 路徑、結構、用戶名稱、倒序一致、空間檢核、全場干涉與閃爍、配線與電盤、物理、BOM 一致性、太陽能遮陰與手臂動力學（有宣告才跑）、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "MotorBodyAOI" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/project.js` | 建立場景（地面用 `floor()`）、站別、時間軸、`apply(t)`、空間檢核、全場檢查設定（網頁與檢查共用） |
| `web/js/main.js` | 舞台（`look`／`extent`）、`createViewerWorkspace`、視角、站別按鈕、3D 標籤、播放列、面板、`exposeSim` |
| `web/js/body.js`、`body-mesh.js`、`codec.js` | 本體網格（由 STEP 產生）、12 面對照表 `FACES`、夾持帶 |
| `web/js/optics-plan.js` | 8 台相機與光源（工件座標）、夾具角度與高度、景深公式 |
| `web/js/coverage.js`、`raycast.js`、`coverage-data.js` | STEP 射線檢查（覆蓋、景深、解析度、入射角、遮擋）；`coverage-data.js` 由 `tools/plan.mjs` 產生 |
| `web/js/specular.js` | 高反光加工面的鏡面反光分析（每面要整面暗場或整面亮場，不能有局部反光） |
| `web/js/sequence.js` | 每拍動作時序、CT、甘特資料 |
| `web/js/machine.js`、`optics-scene.js` | 機台、夾頭、翻轉、移載、分料；相機、光源、視錐與照射範圍 |
| `tools/import-step.mjs` | STEP → `web/js/body-mesh.js`（需要 `TEMP/occt` 的 occt-import-js） |
| `tools/plan.mjs` | 重算覆蓋並寫出 `coverage-data.js`、`review/coverage.json` |
| `tools/verify.mjs` | 12 面對照、覆蓋重算比對、對照組（遮擋、反射鏡範圍、局部反光）、檢核、客戶縮寫整字檢查 |
| `tools/gantt_png.py` | CT 甘特圖 PNG（給 docs） |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
