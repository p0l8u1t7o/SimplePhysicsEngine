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

動畫細節：

- 相機疊圖由輪框幾何投影：外緣、中心孔及螺栓孔橢圓、飽和區示意遮罩、視差與深度、輪型與示意可信度。精取像加入中心十字、左右夾取點；畫面外的夾取點會標示方向。盲區顯示最後量測時刻與編碼器推算位移。
- 「打光」視角的綠箭頭是入射方向、橙箭頭是往下的正反射；解說箭頭不進相機畫面。525 nm 面光源與投影點依取像訊號發亮，投影點只落在輪面實體；頻閃以慢動作示意，非真實 300 µs 曝光或偏光／飽和模擬。
- 「電控」可剖視中空控制櫃，查看 10 個電控元件、12 位端子台及櫃內連線。IPC 包絡含 GPU 與 5GigE 網卡，沒有另畫板卡內部。外線包含控制器、手臂底座、前臂、雙眼相機、伺服夾爪、真空吸盤、面光源、光電及編碼器。
- 腕部服務圈每次依 J6 角度重算，J4／J5 採機內通道示意；沒有模擬柔性線束力學、固定弧長、最小彎曲半徑或扭轉壽命。線路仍納入全時域的配線取樣，不排除手臂、輪框或隔板。
- 吊鉤編號隨循環更新；四顆台車滾輪、鏈節、編碼器量測輪由線速與時間驅動。HMI 顯示追蹤、輪型、棧板計數及最近量測。操作員位於圍籬外，只是姿勢示意，透過 `operatorProxy` 排除場景檢查，不能用來判定人體安全距離。

以上皆為展示用幾何與數值示意，量測歷史直接從排程回查，倒播與跳播不累積狀態。新增自有檢查涵蓋疊圖時機、左右視差、盲區推算、光源同步、投影點、腕部線束幾何、燈號、吊鉤編號及倒序一致；動態配線由 `verify.cables` 啟用共用 electrical 檢查。

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
| `web/js/capture-overlay.js` | 排程量測回查、輪框特徵投影與相機疊圖 |
| `web/js/optical-effects.js` | 輪面投影點、入射與正反射解說箭頭 |
| `web/js/electrical.js` | 中空控制櫃、電控元件、固定配線與腕部服務圈 |
| `web/js/operator.js` | 圍籬外 HMI 操作員姿勢示意 |
| `tools/verify.mjs` | 本專案的製程規則檢查 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
