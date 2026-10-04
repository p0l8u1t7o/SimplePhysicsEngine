# 回收物自動分揀展示機

雙相機立體視覺把帶上的混合回收物分類、定位（含頂面高度與長軸角度）並交給 DENSO HSR065 SCARA，
吸盤組同步帶速取放，食品類白色 HDPE 送 A 帶、非食品類送 B 帶，其餘回收物由主帶末端續流。
動畫 96 秒、十個敘事段落，含慢動作拆解、滿載連續節拍（CT 1.4 s／瓶）與漏抓警報。

框架說明見 [core/README.md](../../core/README.md)。規格與已拍板事項見 [AGENTS.md](AGENTS.md)，配置提案見 `docs/proposal.md`（只留本機）。

## 時間模型

整個動畫只有一個時間尺度參數 `rate(t)`（`web/js/schedule.js` 的 `RATE`）——製程時間相對播放時間的速率。
`τ(t) = ∫rate dt`、帶面行程 `s = 200 τ`、分流帶行程 `= 1.5 s`，手臂的每個子動作也以製程時間計。
所以慢動作段（1/4、1/5、1/6）與凍結段（AI 分析）的帶速、手臂速度、節拍彼此一致，不是單獨把帶子調慢。

## 節拍與承諾產能

已拍板「以混合料流加權平均承諾」（`ct-mixed`）。`project.throughput` 在建場景時算出四種轉移的單趟節拍
（前一趟投到 A／B × 這一趟投到 A／B），再依 `schedule.js` 的 `MIX`（食品類佔 60%、稼動 85%，示意）加權：

| 項目 | 值 |
|---|---|
| 同類連抓（AA） | 1.40 s／瓶 ← 開案報告第 4、8 頁規格 |
| 跨帶（AB／BA／BB） | 1.52 ／ 1.55 ／ 1.67 s |
| 混合料流加權平均 | **1.51 s／瓶 · 約 2026 瓶/小時** |
| 對應的目標物平均間距 | ≥ 302 mm（同類連抓時 280 mm） |

動畫第 9 段用 280 mm 間距的滿載同類料流驗證 1.40 s，第 10 段把加權平均與承諾產能標示出來；
第 9 件目標因間距只有 240 mm 排不進手臂的空檔，流到末端觸發漏抓警報。

## 手臂路徑

1. 全程用同一個肘部方向（第二臂一律負向）。換肘必須讓肘部打直，TCP 會掃到半徑 650 的奇異點。
2. 取放之間走極座標弧線：角度線性轉、半徑中途先收（`arm.dip`）再伸，掃掠外圍才壓得進機台框架。
3. 每個子動作的時間 = 基準時間與「關節行程 ÷ 軸速上限（`schedule.js` 的 `AXIS`，示意值）」取大者。
   所以同側連抓是規格的 1.40 s，跨到另一條分流帶時擺幅大，單趟會自動加長到約 1.66 s。

## 啟動

雙擊 `run.bat`，或：

```powershell
node ../../core/tools/serve.mjs "RecycleSorter"
```

開啟 http://127.0.0.1:8770/RecycleSorter/。網址參數：`?pause&t=5&view=pick`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

視角：`overview`、`top`、`infeed`、`vision`、`visionTop`、`track`、`pick`、`outfeed`（頂部列只放六個常用的，
`visionTop` 與 `track` 由段落自動切換，也可用 `?view=` 或 `window.sim.setView()` 指定）。
播放時相機會跟著段落換成該段的預設視角；自己按過視角按鈕或開了焦點追隨（◎）就不會被搶走。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。
相機子畫面（▣）屬第二段：`index.html` 的 `#showPip` 預設不勾選，`main.js` 不呼叫 `renderCamera`／`setSources`。

## 檢查

```powershell
node ../../core/tools/check.mjs "RecycleSorter"          # 完整：import 路徑、倒序一致、空間檢核、全場干涉與閃爍、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "RecycleSorter" --quick  # 部署前快速檢查
```

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單 |
| `web/index.html` | 標準版面骨架：`#topbar`（`.brand`、`#stations`、`.views` 視角按鈕 `data-view`）、`#side`（`.card`）、`#bottombar`（`.ctl`、`.stepRow`、`#timeline`、`#clock`） |
| `web/css/style.css` | 桌面版面與深色主題（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責，這裡不寫） |
| `web/js/layout.js` | 站位配置常數（座標系、設備位置與尺寸）；`project.js`、`main.js` 與 `tools/verify.mjs` 共用 |
| `web/js/items.js` | 模型庫 12 款，動畫展示 11 款（洗衣精罐未排入料流）；食品／非食品 HDPE、PET、鐵罐、薄膜、壓扁件、紙盒與瓶身材質 |
| `web/js/appearance.js` | 瓶身包裝與低對比帶面貼圖、金屬表面、批次固定細節及取像照明亮斑 |
| `web/js/schedule.js` | 敘事段落、播放速率（慢動作與凍結）、製程時間換算、帶上工件清單、子動作與軸速上限 |
| `web/js/project.js` | 建立場景（地面用 `floor()`）、取放工單與手臂路徑、`apply(t)`、空間檢核、全場檢查設定 |
| `web/js/main.js` | 舞台（`look`／`extent`）、`createViewerWorkspace`、視角、站別按鈕、3D 標籤、播放列、面板、`exposeSim` |
| `tools/verify.mjs` | 本專案的製程規則檢查（節拍、類別與目的地、落料位置、導料板開口、漏抓警報） |
| `tools/render-audit.mjs` | 961 個時間點的狀態／動件回歸、配置結果比對、幾何預算及新增實例展開干涉檢查 |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |
