# 細節補強與優化紀錄（2026-11-26）

基準：`c60754b`。修改只限本站及 `TEMP/dram-codex*`；沒有提交、推送、變更 core 或需求文件，也沒有安裝套件。

## 逐檔變更

| 檔案 | 變更與用途 |
|---|---|
| `web/js/parts.js` | interposer 改為三段折彎薄片 PIN，維持格距、孔位與 0.45 mm 最高點；SOCAMM 增加方向絲印，標籤縮到單顆封裝上，主機板與載台改中性中文標示。小型 PIN／焊墊不投影陰影；重用材質，合併幾何後釋放中間幾何。薄片省略厚度，仍是示意模型。 |
| `web/js/robot.js` | 三孔取放頭改三瓣開縫夾套，隨既有 gA／gB 狀態漲縮；最大半徑 1.22 mm，小於孔半徑 1.25 mm；工具標籤改中文。TCP、逆解與關節軌跡不變。 |
| `web/js/machine.js` | 修正擦拭帶捲輪旋轉軸：繞自身輪軸轉動，消除既有 Euler 角組合造成的歪擺；沿用 tape 狀態與轉角。 |
| `web/js/details.js`（新增） | 上、下 3D 掃描時，只有產品通過掃描線才顯示紅線；捲輪端面、擦拭帶邊緣、起子套筒增加可讀的運動標記。僅光線標為 fx，實體標記沒有排除干涉檢查。 |
| `web/js/project.js` | 建立細節物件並以本次 apply(t) 的狀態更新；未改排程、事件、製程條件、檢查門檻、allow 或 skip。 |
| `web/js/inspection-view.js`（新增） | 依來源與時間選取最近一筆既有檢查紀錄；顯示產品／孔位 ROI、異物或 PIN 歪斜示意、判定、取像時間與影像編號。取像前等待，不提前顯示合格；明示「非相機實拍」。 |
| `web/js/main.js` | 相機視窗接結果示意並快取影像；鎖附近照保留即時 3D。增加底面 3D 結果來源、產品近照視角，調整 SCARA 視角與標籤錨點。 |
| `web/index.html` | 增加「產品細節」視角按鈕。 |
| `tools/verify.mjs` | 保留原製程檢查，增加 PIN 外形／高度／孔壁、夾套界線、捲輪軸向與端面標記、影像不可提前判定及清潔複檢結果檢查。 |
| `review/bom-checks.json` | 重新驗證仍全部對應；因本機已有評估簡報而清除舊的缺簡報警告，未產生或修改簡報。 |
| `review/determinism.json` | 記錄新增物件後的四情境倒序一致性。 |
| `review/scene-verification.json` | 記錄新增幾何後的網格／可動件數與無干涉結果。 |
| `review/verification.json` | 四情境製程檢查及新增細節檢查結果。 |
| `review/detail-preservation.json`（新增） | 四情境零容差排程指紋、81 點狀態與製程資料完全相同，及前後幾何統計。 |
| `review/detail-enhancement.md`（本檔） | 修改清單、驗證證據、限制與補驗指令。 |

## 驗證

- 快速檢查：12/12 通過。electrical、physics、solar、dynamics 四項為不適用而略過，並非硬體或物理驗收。
- 四種情境：每種 layout 7/7；J2 最大 118.3°，均低於 120°；手臂與鎖附模組最小 X 距離 110 mm。
- 四種情境的 scene：動態干涉 0、靜態干涉 0、共面閃爍 0。產品原門檻 0.05 mm 未變；未新增放行規則。
- 四種情境的 determinism：887 個物件、各 40 時間點，一致。
- 四種情境的 BOM：19 模型、44 行、19 對應，sceneOnly 0、bomOnly 0。
- 四種情境的製程驗證：中間孔先鎖、12 顆螺絲終鎖、裝配孔位、清潔與至少 10 s 吹乾、NG 分流、相鄰槽位互斥及影像追溯均通過。
- 排程保全：core fingerprint 四情境均 `tol: 0`、`diffs: []`。另以 81 個時間點比對 apply 回傳狀態，及完整 events、cycle、insp、heights、screwLog、reach，逐字相同。單次換肘向與原作業路徑保留。
- JavaScript 語法檢查與 `git diff --check` 通過。

## 效能界線

| 全場幾何統計（包含未顯示物件，非 renderer.info） | 補強前 | 補強後 |
|---|---:|---:|
| 三角面 | 138,788 | 120,900 |
| Mesh | 706 | 729 |
| 啟用投影陰影的三角面 | 115,384 | 50,584 |

三角面減少約 12.9%；Mesh 增加 23 個。細小接點的陰影精度本來就低於全景陰影貼圖，因此關閉其投影陰影；這不影響幾何檢查。結果圖只在來源、紀錄或尺寸變動時重畫。以上不能證明手機 FPS 或 draw call 沒有退步。

## 瀏覽器驗收阻礙

完整檢查目前為 12/13，唯一失敗項 `ui`：`Chrome DevTools 未啟動`（core/tools/cdp.mjs:25）。前、後 `perf-check.mjs` 與 `shots.mjs` 也因瀏覽器啟動失敗而無法完成。Chrome 與 Edge 都已嘗試，另查得瀏覽器控制服務不可用；沒有變更瀏覽器安全設定或繞過限制。

- 未取得 FPS、draw call 或各視角 renderer.info，不能宣稱「效能不退步」已驗收。
- 截圖未產生；指定輸出位置為 `TEMP/dram-codex-shots`。沒有可供目視驗證的截圖。
- 桌面／手機直向／手機橫向／平板 UI、SCARA 視角遮擋、產品近照與 ROI 可讀性仍需瀏覽器補驗。
- `review/ui-check.json` 保留原提交的歷史結果，不代表本輪 UI 通過；未將失敗偽寫成通過。

原始證據在根目錄 `TEMP/dram-codex/`：`quick-check.log`、`full-check.log`、`shots.log`、`perf-after.log`、`preservation.json`、`contract-before.json`、`contract-after.json`、`fingerprint-before.txt`、`fingerprint-after.txt`、`validation.json`。沒有偽造 perf JSON 或截圖。

全部重工作由以下 CPU 限制包裝執行，單次只有一個重工作；子工具也繼承限制。若共享 Job 無法加入，原腳本會退回私有 Job 25%。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Working Space\AutoSequence\temp\cpu-cap.ps1" -Percent 50 -Command "node TEMP/dram-codex/verify-all.mjs"
```

瀏覽器恢復後，依序補驗（每行各自包同一個 CPU cap，不並行）：

```powershell
$env:UI_PORT = '8797'
# 以下各條指令分別作為 cpu-cap.ps1 的單一 -Command。
node core/tools/check.mjs DRAM-Inspection
node core/tools/perf-check.mjs DRAM-Inspection --port 8796 --out TEMP/dram-codex/perf-after.json
node core/tools/shots.mjs DRAM-Inspection --out TEMP/dram-codex-shots --port 8796
node core/tools/ui-check.mjs DRAM-Inspection --port 8797 --shots TEMP/dram-codex-phone
```

前後 FPS 比較還需要從 c60754b 的獨立副本重建補強前基準；本輪沒有可比較的成功基準量測，且依指示未切換或還原工作目錄。

## 未做與後續提案

本輪未增加 PIN 密度、額外 PCB 走線、IPA 滴液運動、吹送螺絲軌跡、PU 壓縮、工具氣管；既有輸送與拖鏈維持原設計。未取得正式尺寸，彈片與 ROI 均屬照片參考的展示示意，不是實物 AOI 能力驗證。

不需新增 BOM 項目或 core-model 實例。未修改 refs.js 或成本資料。可另案評估將三瓣漲緊夾套與雷射掃描落線功能整理成 core 共用能力；本輪只留本站實作，未更動 core、core/REQUESTS.md 或根目錄待辦。
