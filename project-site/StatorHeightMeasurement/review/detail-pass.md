# 動畫外觀補強與驗證紀錄

日期：2026-10-16。來源基準：`2a6704e`，參考本站 `docs/` 照片及先前中斷工作的適用部分。保留整列器、六個取料巢、小型倒角基準板與四種品檢方案。

程式與非瀏覽器檢查已完成；**四尺寸 UI 與手機 ≥26 fps 尚未驗收，因此本輪不能宣告完整通過**。改動只在本站，暫存只在 `TEMP/statorcodex*`；沒有修改 core、其他站或根目錄，也沒有提交。

## 各檔變更

| 檔案 | 變更 |
|---|---|
| `web/js/finishes.js`（新增） | 固定種子的共用拉絲不鏽鋼、磨耗鋼板、油汙刮痕、花崗岩與端面鉚接凹痕貼圖；不依賴 DOM。 |
| `web/js/equipment-details.js`（新增） | 沖床冠部與立柱檢修蓋、導軌、飛輪護罩、固定送入鋼帶、分塊模座；整列器氣缸接頭、氣管、光纖線及相機支架固定件；合併網格的菱形落料網、96 個實例化廢料；下料框架接合板、螺栓、線槽、FRL、電磁閥組及分段真空管；品檢框架細節與標牌。 |
| `web/js/press.js` | 接入沖床、整列器與廢料坑細節；蓋板磨耗材質與拋光導引面；取料巢方形推墊改成同中心、同行程的圓形推墊，消除方角干涉，未變動排程。 |
| `web/js/parts.js` | 0.5 mm 視覺層疊紋、亮面沖壓端面；定子鉚接凹痕由假通孔改為表面貼圖，減少幾何量；轉子增加端面凹痕外觀。 |
| `web/js/boxes.js` | 拉絲鐵盒、底部內縮 3 mm 的微張壁、連續圓捲邊與折縫，保留頂部外廓；作業員軀幹／四肢圓角、鞋、頸部、鼻部、帽緣、拉鍊與口袋，保留 `operatorProxy` 與姿態驅動。 |
| `web/js/unloader.js` | 整合框架、配管與氣動元件外觀，輸送導引面改用拋光材質。 |
| `web/js/qc-common.js` | 花崗岩斑點材質、品檢室發光條燈；不增加投影光源。 |
| `web/js/qc-box.js` | 拋光基準板、翻轉軸承座與螺栓、龍門模組護蓋及 Y 軸拖鏈，保留盒壁感測器。 |
| `web/js/qc-piece.js` | 品檢手臂真空管與機台細節，保留雙量測頭／雙相機介面。 |
| `web/js/measurement-effects.js`（新增） | 雷射線依目前掃描位置及工件形狀分段貼合表面；共焦雙光點與背光亮度由當前取樣決定。光線／光點標記 `userData.fx = true`。 |
| `web/js/project.js` | 接入上述效果與拖鏈位置更新，沿用既有 `apply(t)`、取樣與排程。 |
| `web/js/measurement-view.js`（新增） | 整盒雷射目前列的高度輪廓、視覺基準邊／量測頂邊側影、逐顆雙點或雙視角讀值，保留 OK／NG 格位圖及待量測狀態；明示模擬／示意。 |
| `web/js/main.js` | 僅將量測影像來源接到新繪製器；取料巢相機來源保留。 |
| `tools/verify-details.mjs`（新增） | 八種組合的反向跳時一致性、實例矩陣／材質狀態、量測畫面有限值、未量測顯示及雷射落點檢查。 |
| `README.md` | 增列模組、檢查指令與本輪驗收限制。 |
| `review/determinism.json`、`review/scene-verification.json` | 更新新增物件後的檢查數量與場景結果。 |
| `review/detail-verification.json`、`fingerprint-comparison.json`、`detail-resource-audit.json`、`detail-pass.md`（新增） | 保存本輪細節檢查、指紋比較、Node 資源盤點及本報告。 |

## 檢查結果

| 項目 | 結果與證據 |
|---|---|
| 指紋 | `node core/tools/run.mjs StatorHeightMeasurement ../../core/verify/run.mjs fingerprint`，以 `compareFingerprints` 對照 `TEMP/stator/fp-before.txt`，`tol: 0`；五個變體全部 `ok: true`、`diffs: []`。見 `fingerprint-comparison.json`。 |
| 排程補充比對 | 用 `git show 2a6704e` 讀出來源至暫存，直接比較八組方案的總時間、事件起點／期間／動作文字／子動作／站序與 stationStart，全部相同。未執行 checkout。見 `detail-resource-audit.json`。 |
| 快速檢查 | `node core/tools/check.mjs StatorHeightMeasurement --quick`：10/10；五個變體 layout 各 10/10，dynamic 0、static 0、zfight 0；40 個時間點的決定性一致。電控、物理與 BOM 沿用原本的不適用結果，不代表這些系統已驗證。 |
| 既有製程檢查 | `node --import ./core/tools/register.mjs project-site/StatorHeightMeasurement/tools/verify.mjs`：八組全部通過，placeErr 0，NG 各 2。 |
| 新增細節檢查 | `node --import ./core/tools/register.mjs project-site/StatorHeightMeasurement/tools/verify-details.mjs`：八組全部通過，16,030 項斷言，`failures: []`。 |
| allow／skip | 未增加或放寬任何 `verify.allow` 或 `verify.skip`。圓形推墊修正實體幾何，沒有以效果標記隱藏推墊。 |
| UI | `$env:UI_PORT='8853'; node core/tools/check.mjs StatorHeightMeasurement --only ui` 未完成四尺寸驗收；停止卡住的程序後結果為 exit 4294967295、0/1。`TEMP/statorcodex/ui.txt` 保存紀錄。既有 `review/ui-check.json` 未當成本輪結果。 |
| 文字差異 | `git diff --check` 通過。 |

## 效能前後

| 指標 | 補強前 | 補強後 |
|---|---|---|
| 實際渲染最大三角形／draw calls | 使用者提供約 720k／2,544，本輪未重測成功 | 未取得有效瀏覽器數據 |
| 手機 FPS | 使用者提供約 28.5 fps，本輪未重測成功 | 未取得有效數據，≥26 fps 未驗證 |
| GPU | 本輪未能取得 | 本輪未能取得 |

`perf-check.mjs` 在使用 8850／8851 的執行及診斷中無法完成；Chrome GPU 子程序反覆退出（`-1073741790`），最後回報 `GPU process isn't usable`。紀錄在 `TEMP/statorcodex/perf-log.txt`。這是執行失敗，不能推定通過或 FPS 下降。

另以 Node 對基準與補強後場景各取樣 40 個時間點，得到下列資源盤點。**這些數字不是 renderer.info、draw calls 或 FPS**：未計視錐剔除、多視窗及陰影 pass；仍可能計入零縮放的實例。

| 方案／工件 | 三角形前 → 後 | 材質群組前 → 後 |
|---|---:|---:|
| box-laser／stator | 189,724 → 146,448 | 789 → 933 |
| box-vision／stator | 191,594 → 148,318 | 821 → 965 |
| piece-laser／stator | 200,668 → 153,290 | 816 → 941 |
| piece-vision／stator | 201,688 → 154,310 | 827 → 952 |
| box-laser／rotor | 1,328,912 → 1,354,972 | 759 → 903 |
| box-vision／rotor | 1,330,326 → 1,356,386 | 782 → 926 |
| piece-laser／rotor | 1,343,728 → 1,365,642 | 788 → 913 |
| piece-vision／rotor | 1,340,876 → 1,362,790 | 797 → 922 |

定子假通孔改為端面貼圖可降低三角形；廢料以 InstancedMesh、菱形網以合併幾何呈現，貼圖與材質共用。細節仍增加材質群組，需實際手機測試確認其成本，不能從三角形減少推論幀率達標。

## 未完成與共用框架建議

- 待在可用的 GPU／瀏覽器測試環境重跑四尺寸 UI、前後效能與近距離外觀檢視；本輪未完成照片逐項對照的瀏覽器驗收。
- 瀏覽器工具的自動權限審查拒絕 raw CDP 存取 localhost 頁面，因此沒有繼續以替代管道讀取 GPU／效能資料；也沒有將有限的標準頁面操作視為自動 UI 通過。
- 真空管目前固定在各臂段，跨關節柔性管的連續彎折沒有模擬；沖床鋼帶為固定外觀，未新增送料運動。
- 沿用既有翻轉驅動與隔振結構；本輪沒有新增完整減速機內構或隔振物理模擬。材質磨耗、鉚接凹痕、輪廓量測均是視覺示意，不是實測表面／光學誤差模型。
- core 建議：瀏覽器啟動工具遇到 GPU fatal、CDP 連線或 WebSocket 無回應時應儘速失敗並保存診斷，避免長時間卡住。本輪未修改 core。
- 依本次硬性範圍限制，未改根目錄 `PENDING.md`；尚待驗收項目列在本報告。

## 主 session 驗收（2026-10-16）

- 排程指紋：五個變體與補強前零差異（之後另修正說明標記的時間軌，只影響事件選單時間，不影響動作）。
- 快速檢查 10/10，干涉與閃爍 0，沒有 allow 規則。
- UI 四尺寸通過（`UI_PORT=8846`）。
- 效能：三角面最多 531,558、draw call 最多 2,995、手機幀率 40.8 fps（補強前 720,534／2,544／28.5 fps）。
