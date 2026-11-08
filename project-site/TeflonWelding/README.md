# 鐵氟龍襯裡桶自動焊接

1000L 襯 PTFE 桶內焊道：DENSO 手臂熱風焊接＋兆赫波檢測（多方案比較）

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "TeflonWelding"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "TeflonWelding"
```

開啟 http://127.0.0.1:8770/TeflonWelding/。網址參數：`?plan=roll|turntable|cobot`（三個方案）、`?c1=420&c2=870&nl=1`（焊道排版：下／上環縫高度、縱縫條數，側欄可調）、`?look=xray|cut|solid`（透視（預設，完整桶半透明）／剖切示意／不透明）、`?pause&t=5&view=inside`（視角 `iso`、`inside`、`weld`、`rack`、`top`）、`?shadow=0`、`?cam=x,y,z,tx,ty,tz`。

手機、平板與橫向手機自動改用精簡版面（☰ 製程與視角、⚙ 播放設定、工具列 ◨ 開側欄、▣ 相機視窗、◎ 追隨工件），由 `createViewerWorkspace` 處理；`css/style.css` 只寫桌面版面。

## 檢查

```powershell
node ../../core/tools/check.mjs "TeflonWelding"          # 完整：import 路徑、結構、用戶名稱、倒序一致、空間檢核、全場干涉與閃爍、配線與電盤、物理、BOM 一致性、太陽能遮陰與手臂動力學（有宣告才跑）、四種尺寸的介面測試（ui）、本專案檢查
node ../../core/tools/check.mjs "TeflonWelding" --quick  # 部署前快速檢查
```

- 內建檢查跑三個情境：預設（A 案）加 `project.json` 的 `variants`（B、C 案）。
- `dynamics`（只警告）：A、B 案的 VS-068 倒裝在桶內，負載由 3D 工具模型估（取週期內最重的時刻），結果在 `review/dynamics-checks.json`；C 案的 COBOTTA PRO 900 還沒有動力學參數，略過。

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單、`variants`（B、C 方案也跑統一檢查） |
| `web/index.html` | 標準版面骨架；側欄：設備方案（切換、優缺點、顯示方式）、目前動作、焊道狀態、工時估算、空間檢核 |
| `web/css/style.css` | 桌面版面與深色主題 |
| `web/js/spec.js` | 桶尺寸（STEP 量得）、焊道排版（`makeSeams`、可調範圍）、方案比較表、製程與速度、工具、三個方案的說明、動畫節奏、工時估算 |
| `web/js/tank.js` | 桶身與封頭（LatheGeometry）、人孔、出口、管腳、PTFE 襯裡、焊道分層（規劃軌跡→間隙→V 槽→焊條→削平→焊帶→檢測綠）、模擬缺陷、剖切平面、透視、`wallAt`（間隙檢查用） |
| `web/js/tools.js` | 6 支末端工具（3D 相機、開槽刀＋雷射循縫、LHS 21S 外形的焊條／焊帶焊槍、拖嘴、壓輪、削平刀（刮刀）、兆赫波探頭）、快換盤、工具架托叉 |
| `web/js/robot.js` | VS-068／COBOTTA PRO 900（core 模型 `createVS068`、`createCobottaPro900`）＋快換盤＋TCP；安裝方式（J1 與桶軸同軸）與焊接、退刀姿態的 IK |
| `web/js/plans.js` | 三個方案的機構：迴轉架／轉台／移動門架、伸臂／立柱懸臂／Z 伸縮柱、上料吊鉤、周邊（電控、熱風控制、兆赫波主機） |
| `web/js/details.js` | 三案機構細節、拖鏈、手臂氣管／電源／光纖、旋轉接頭、側吸罩與排氣管、送風機、護網、HMI 焊道狀態；新增外觀不修改排程 |
| `web/js/project.js` | 組場景、取放工具姿態與工具架格位、時間軸（上料 → 6 道製程 × 各焊道（相機定位後插入軌跡規劃）→ 卸料）、`apply(t)`、空間檢核、全場檢查設定 |
| `web/js/thz-view.js` | 兆赫波畫面：A-scan 回波波形（菲涅耳反射係數＋時間差模型）、沿焊道 B-scan、各焊道判定（NG／補焊／複檢 OK） |
| `web/js/main.js` | 舞台、方案切換、剖切開關、視角、標籤、焊道狀態表、焊點特寫相機、`exposeSim`、錄影 |
| `tools/verify.mjs` | 三方案各跑預設排版：TCP 跟隨焊道、桶內間隙（逐頂點對 `wallAt`）、兆赫波 NG 處補焊、製程順序；結果寫 `review/verification.json`（快速檢查） |
| `tools/verify-extreme.mjs` | 三方案改用極端排版（環縫夾到可調範圍兩端、兩道縱縫）再跑一次 `verify.mjs` 的全部項目；結果寫 `review/verification-extreme.json`（只在完整檢查，避免 CI 超時） |
| `tools/verify-details.mjs` | 三案的透視／剖切／實體切換、切面跟隨、共用材質、七道工序效果、跳播旋轉、缺陷標記與法蘭螺栓實例位置；結果寫 `review/details-verification.json`（快速檢查） |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、保密、規格摘要、已拍板事項 |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |

## 外觀細節

透視仍是預設觀看方式，完整槽體及人孔尺寸維持原規格。剖切模式的灰色 SUS、棕色膠層與乳白 PTFE 封面隨各案切面及上料位置移動，不跟著槽體自轉。槽內漸層與 V 槽明暗是視覺表現，沒有改變驗證用桶壁尺寸。

捲盤、壓輪與開槽刀依累積加工距離設定角度，倒序播放與跳播可重現；短熱區、規劃線、切屑及 THz 色帶是製程示意，不能作為實際溫度或檢測數據。新增氣路、光纖、排氣系統及機構細節是配置示意，未代表設備選型、現場安全驗證或排氣處理設計已完成。

第二輪細節補強：開槽／削平工具有後側吸屑罩、沿臂吸屑管及獨立集屑機；焊條／焊帶焊槍停放格有向上開口隔熱槽、待機送風與警示牌。C 案熱風及光纖改沿上臂中性側，環縫上限為 875 mm，預設仍是 870 mm。補焊段以較寬的圓潤 PFA 帶與冷卻色表現，紅／橘／綠判定圈維持原流程。THz 畫面加大字級、ps 時間刻度、按各層折射率換算的 mm 深度刻度及正負回波圖例，波形與判定數值維持原模型。

管路關節內通道、旋轉接頭、抽氣能力與隔熱效能仍是配置示意；幾何檢查與排程回歸不代表實機驗收。第二輪檢查紀錄及瀏覽器限制見 `review/detail-pass-2.md`。
