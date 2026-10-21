# 定子轉子自動下料與高度檢測

沖壓機出口 SCARA 自動擺盒，品檢區整盒翻轉／逐顆量測高度（雷射與視覺四方案）。

由 `node core/tools/new-project.mjs` 從 `core/template` 建立。框架說明見 [core/README.md](../../core/README.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "StatorHeightMeasurement"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "StatorHeightMeasurement"
```

開啟 http://127.0.0.1:8770/StatorHeightMeasurement/。網址參數：

| 參數 | 值 |
|---|---|
| `plan` | `box-laser`（預設）、`box-vision`、`piece-laser`、`piece-vision` |
| `part` | `stator`（預設，分割式定子）、`rotor`（轉子 Ø42） |
| 其他 | `?pause&t=30&view=measure`、`?shadow=0`、`?cam=x,y,z,tx,ty,tz` |

側欄「量測方案」可直接切換；視角有全景、下料、整列、地坑、品檢站、量測、俯視（另有 `view=scara` 下料手臂近景）。

## 流程（動畫約 70～87 s，依方案與工件）

1. **沖壓出料・整列・SCARA 擺盒**：6 道散料經整列單元（收斂導正 → 窄通道 → 分料擋銷 → 定位座，側推靠基準壁、光纖確認到位與方向，上方相機再確認），SCARA 從定位座吸起，交錯 180° 擺進鐵盒，每 3.33 s 一顆（手臂實際取放 1.5 s）。
2. **換盒**：擺滿後滿盒往東送出、空盒補進並推靠擋塊與南側導板，手臂側裝雷射伸進空盒量內壁、修正擺盒原點（兩格空盒＋兩格滿盒，定子約 32 分鐘才需要換人）。
3. **人員搬盒**：作業員把上一盒滿盒搬上推車，推約 10 m 到品檢區，放上量測站。
4. **量測**（依方案）：
   - 整盒：雷射量盒壁確認間隙 → 基準板座下降壓到工件頂面 → 夾盒 → 翻 180° → 基準板座落在花崗岩定位墊、解鎖 → 鐵盒上移翻回 → 雷射逐列掃描或逐列頂升側拍 → NG 剔除 → 鐵盒翻回罩住 → 整組翻回 → 工件落回盒底。每盒約 0.6～0.9 分鐘（雷射比視覺快；轉子一盒 40 顆）。
   - 逐顆：SCARA 入料盒 → 量測砧 → 量測 → 出料盒同一格（NG 進滑槽）；前 5 顆真實速度，其餘快轉。每顆 2.4～2.6 s（23～25 顆／分）。
5. **放行**：良品盒搬回推車。

## 設計重點與假設

- **散料怎麼取**：機構定位為主（收斂導正、擋銷分料、定位座側推靠基準壁），到位與方向光纖確認有料、方向對；定位座上方的 2D 相機再確認位置與方向，偏差回饋給手臂（雙重保險）。前提是出模方向固定。
- **擺盒不撞**：盒子推靠擋塊（x）與南側導板（z）、手臂側裝雷射量盒內壁修正原點；同列間隙 1.5 mm 大於定位後的殘差；從定位角由遠往近擺，吸盤只吸工件頂面（工具不會碰到鄰件），離底 1 mm 釋放。
- **基準板放得進折板盒**：基準板只蓋工件區（每邊比工件外框大 6 mm），離盒壁每邊 ≥ 16.8 mm（定子）／19.8 mm（轉子）；四周倒角、支柱下有浮動單元，放板前雷射量盒壁，超差警報退盒。
- **為什麼翻盒**：鐵盒底部不平，盒內直接量只能量到「頂面－盒底」；翻盒後每顆的頂面都貼在同一個研磨基準面上，量另一端面與基準面的差就是高度，與盒底無關。基準板座的框架翻過來就是它的底座，落在花崗岩的四塊硬化墊上。
- **整盒視覺**：從上方拍不出高度，必須側拍輪廓；整盒工件排得密，所以把該列頂高 80 mm，讓相機視線越過其他列。
- **0.01 mm**：雷射方案以基準面差動量測（工件面與基準面在同一趟掃描或同一組量測頭裡），視覺方案以同一張影像中的基準邊與頂緣相減；兩者都要用塊規定期校正。量測時間、感測器型號、隔振效果都是規劃值，需打樣驗證（見根目錄 `PENDING.md`）。
- **SCARA 安全環帶**：取放點都在手臂半徑 330～620 mm 內（J2 不進 >120° 的本體干涉區）；下料區圍籬離手臂 780 mm，大於手臂掃過的最大半徑。
- **檢查的限制**：盒內、滑道上、基準板上的工件用 InstancedMesh 繪製，core 的全場干涉檢查不檢查它們；工件與機構的間隙（吸盤工具、龍門吸盤、相機鏡頭）是依設計尺寸算的，自有檢查 `tools/verify.mjs` 另外核對放置位置、基準板貼合與落座高度。

## 檢查

```powershell
node ../../core/tools/check.mjs "StatorHeightMeasurement"          # 完整：內建項目＋四種尺寸 ui＋tools/verify.mjs、verify-details.mjs
node ../../core/tools/check.mjs "StatorHeightMeasurement" --quick  # 部署前快速檢查：內建項目（不含 ui）＋tools/verify.mjs
```

- 內建檢查跑五個情境：預設（整盒雷射・定子）加 `project.json` 的四個 `variants`。
- `tools/verify.mjs` 自己跑四方案 × 兩種工件共八組（放置位置、基準板貼合、落座高度、NG 剔除、產能），結果在 `review/verification.json`。
- `tools/verify-details.mjs`（只在完整檢查跑）核對八組的反向跳時、量測視窗與光學提示，結果在 `review/detail-verification.json`；也可以在庫根目錄單獨執行 `node --import ./core/tools/register.mjs project-site/StatorHeightMeasurement/tools/verify-details.mjs`。

## 檔案

| 檔案 | 用途 |
|---|---|
| `project.json` | 標題、首頁說明、檢查清單、四個方案情境 |
| `web/index.html`、`web/css/style.css` | 標準版面骨架與桌面版面（窄螢幕規則由 `core/ui/viewer-workspace.css` 負責） |
| `web/js/spec.js` | 節拍、工件、格位、量測方案、配置與量測值（示意） |
| `web/js/parts.js` | 工件幾何（定子齒、轉子）與整盒工件（每列一個 InstancedMesh） |
| `web/js/press.js` | 沖壓機、出料滑道、整列單元、廢料坑蓋板與落料網格（沖壓機、出料滑道與地坑是現場既有，`noBom`；整列單元是新設） |
| `web/js/unloader.js` | 自動下料機：可移動底座、SCARA＋吸盤工具、鐵盒輸送、圍籬與光柵 |
| `web/js/boxes.js` | 鐵盒、推車、作業員姿勢示意 |
| `web/js/qc-common.js`、`qc-box.js`、`qc-piece.js` | 品檢隔間、花崗岩機台；整盒翻轉站；逐顆量測站 |
| `web/js/motion.js` | SCARA 取放（IK＋關節空間內插，時間的純函式） |
| `web/js/finishes.js` | 共用拉絲、磨耗、花崗岩與沖壓端面程序貼圖 |
| `web/js/equipment-details.js` | 沖床、整列器、廢料坑、下料機與品檢設備外觀細節 |
| `web/js/measurement-effects.js` | 隨時間定位的雷射掃描線、共焦光點與背光亮度 |
| `web/js/measurement-view.js` | 量測視窗的高度輪廓、側影與雙點讀值；保留 OK／NG 格位圖 |
| `web/js/project.js` | 場景組裝、全場時間軸、`apply(t)`、空間檢核、檢查設定 |
| `web/js/main.js` | 舞台、視角、方案切換、量測結果格位圖、播放列 |
| `tools/verify.mjs` | 本站製程檢查（四方案 × 兩種工件） |
| `tools/verify-details.mjs` | 八組方案的反向跳時、量測視窗與光學提示檢查（完整檢查） |
| `AGENTS.md`／`CLAUDE.md` | 本站規則：範圍、規格摘要、已拍板事項（`CLAUDE.md` 以 `@AGENTS.md` 引用） |
| `.claude/settings.json` | 寫檔關卡：從本資料夾啟動的 Claude Code 只能改本站 |

## 外觀細節補強

2026-10-16 的細節補強以 `2a6704e` 的整列器與小型基準板配置為準，保留原排程與運動位置。材質、護罩、配管、折邊鐵盒及量測提示詳見 [補強與驗證報告](review/detail-pass.md)。量測視窗顯示既有模擬結果，並非實際相機影像或感測器精度驗證。

當輪排程指紋零差異、快速檢查 10/10（干涉與閃爍 0）；四尺寸 UI 測試通過，手機幀率 40.8 fps（補強前 28.5 fps；`core/tools/perf-check.mjs`）。
