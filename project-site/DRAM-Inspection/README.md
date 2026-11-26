# SOCAMM 記憶體檢測組裝機

載台主機板（4 槽）上依序植入 interposer 與 SOCAMM：Tray 上面 3D／2D 檢查、SCARA 雙三孔頭取放、底面 PIN 3D 掃描與覆拍修正、SOCAMM 離子風刀＋IPA 擦拭吹乾複檢、壓持後三螺絲預鎖＋終鎖（評估展示，數值為示意）。規格摘要與拍板事項在 `AGENTS.md`。

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "DRAM-Inspection"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "DRAM-Inspection"
```

開啟 http://127.0.0.1:8770/DRAM-Inspection/。網址參數：`?pause&t=5&view=lock`（視角 iso、scara、tray、inspect、clean、board、lock、top）、`?scenario=ok|clean|ng-clean|ng-pin`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "DRAM-Inspection"          # 完整：import 路徑、結構、用戶名稱、倒序一致、空間檢核、全場干涉與閃爍、配線與電盤、物理、BOM 一致性、太陽能遮陰與手臂動力學（有宣告才跑）、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "DRAM-Inspection" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/parts.js` | 產品：載台、主機板（4 槽、PEM 螺帽、基準點）、interposer（上下 PIN、三凸點）、SOCAMM（DRAM、焊墊、髒污）、M2 螺絲、Tray |
| `web/js/machine.js` | 機架與 FFU、邊皮帶輸送與頂升定位、Tray 抽屜與檢查橋、上視站（3D 線雷射、上視相機、離子風刀、IPA 擦拭、吹乾槽、NG 盒）、鎖附模組 |
| `web/js/robot.js` | DENSO HSR065＋雙三孔頭、下視相機、雷射位移計；底座轉 180° 的逆解（指定肘向） |
| `web/js/refs.js` | 場景市購品 ↔ 元件庫編號 |
| `web/js/project.js` | 場景、時間軸（輸送、Tray、SCARA、上視站、鎖附、每個零件與螺絲）、四種情境、`apply(t)`、檢查紀錄、空間檢核、全場檢查設定 |
| `web/js/main.js` | 舞台、視角、相機視窗（上視 I／S、Tray 上面、下視、鎖附近照）、檢查紀錄、扭力-角度曲線、入位高度表、播放列 |
| `tools/verify.mjs` | 製程檢查：組裝順序、孔位對齊、清潔流程、鎖附順序、手臂與鎖附模組不同時進相鄰槽位、影像追溯 |
| `.studio/plan/` | 配置提案、可行性分析、成本表（評估簡報的資料） |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
