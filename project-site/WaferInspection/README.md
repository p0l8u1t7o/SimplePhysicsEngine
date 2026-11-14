# 晶圓表面 AOI 檢測評估

設備方案評估與溝通用的 3D 動畫：單片晶圓＋真空吸盤＋XYθ 平台＋固定上視面掃相機＋同軸明場／低角度暗場切換的停拍掃描。可以操作、比較取像參數、觀察掃描流程與檢測限制。**所有檢測結果都是 SIM（模擬），不是實拍影像辨識；參數多為展示假設，不是客戶規格。** 規格摘要與已拍板事項見 [AGENTS.md](AGENTS.md)。

## 啟動

在根目錄執行 `scripts\start.cmd -Station "WaferInspection"`（停止：`scripts\stop.cmd`），或：

```powershell
node ../../core/tools/serve.mjs "WaferInspection"
```

開啟 http://127.0.0.1:8770/WaferInspection/。

| 網址參數 | 作用 |
|---|---|
| `?mode=full` | 完整掃描（預設 `compact` 精簡展示：只掃中央幾列，其餘標「展示略過」，不算已取像） |
| `?sc=clean｜line｜particle｜defocus` | 情境：無注入缺陷、線狀表面異常（預設）、顆粒／污染、失焦或照明不足 |
| `?mag=2&camIf=10GigE…` | 覆寫 `web/js/spec.js` 的參數（面板「參數與假設」改完按「套用並重新計算」會帶上這些參數重新載入） |
| `?hood=solid｜glass｜off`、`?truth=1`、`?view=top`、`?src=photo`、`?pause&t=20` | 外罩、顯示 A 真值、視角、影像來源、跳到指定時間 |

## 畫面

- 視角：全機、晶圓俯視（隱藏光學頭與龍門、跟著晶圓）、相機／照明近看、正面。
- 左側：wafer map（已取像、目前、未掃描、展示略過、待複檢、缺圖；B 候選、C 待人工確認、A 真值可切換；點選格子或候選會定位）、複檢列表、SIM 對照真值。
- 右側：目前流程與取像時序（移動 → 停穩 → 明場 → 切換 → 暗場，並列傳輸與演算）、情境與顯示、光學與節拍估算、參數與假設（每項標來源）、檢測演算方式、線掃描參數比較、空間與流程檢核。
- 影像視窗：目前取像位置或選取位置的 SIM 檢測影像（明場／暗場、原圖／標記），或用「本機參考照片」載入的客戶照片（只在本機瀏覽器顯示；照片上的紅色箭頭是客戶的人工標記，點畫面可加本機註記）。
- 播放倍率只影響觀看速度，工程週期由 `sequence.js` 的時序計算。

## 資料分離

| 類別 | 來源 | 用途 |
|---|---|---|
| A 模擬缺陷真值 | `spec.js` 的 `SCENARIOS`（固定資料） | 只給相機模擬 `renderTile` 與事後評分 `scoreAgainstTruth` |
| B 演算法候選區 | `inspection-sim.js` 的 `detect(影像, 參考影像)` | 只看影像：缺圖 → 影像品質 → 明暗補正 → 差異比對 → 連通區域 |
| C 人工註記／待確認 | 複檢完成的項目、參考照片上的人工標記 | 交人工確認，不是判定結果 |

## 檔案

| 檔案 | 用途 |
|---|---|
| `web/js/spec.js` | 參數（值、單位、來源、合法範圍）、情境、照片的人工標記、機台配置 |
| `web/js/budget.js` | 光學（core/optics L1＋L2）、整片估算、線掃描比較 |
| `web/js/scan-plan.js` | 圓形晶圓的取像位置（蛇形）、逐點覆蓋率、排除區、die 數、精簡模式 |
| `web/js/inspection-sim.js` | 示意圖樣、相機模擬、演算法、候選合併、複檢清單、SIM 評分 |
| `web/js/sequence.js` | 停拍時序（梯形速度、停穩、曝光、相機緩衝、傳輸、處理並行）→ core 的 `createStepSequence` |
| `web/js/wafer.js`、`machine.js` | 晶圓與疊圖、設備（core 模型＋站內示意包絡） |
| `web/js/project.js` | 組合以上，提供 `total`、`apply(t)`、`layoutChecks`、`verify`、`resultsAt(t)` |
| `web/js/main.js`、`views2d.js` | 網頁介面與 2D 畫面（wafer map、時序、影像） |
| `tools/assessment-extra.mjs`、`assessment_extra.py` | 評估簡報：先執行 `vs3d assess "WaferInspection" --repo deck`，再用公司樣板在附錄前補上光學與掃描估算、週期分項、參數與線掃描比較、演算方式、模擬／估算／實機界線、SIM 情境截圖（輸出在 `docs/assessment/`，只留本機） |
| `tools/scenario-shots.mjs` | 情境截圖（四種情境、完整掃描、非法參數、外罩、參考照片、候選定位）與渲染時間量測，輸出 `TEMP/WaferInspection-shots/scenarios`；簡報的 SIM 情境頁用它 |
| `tools/verify.mjs` | 自有檢查（倒序與跳播、未取像不顯示完成、倒退清除、覆蓋、張數、參數重算、停拍互鎖、資料分離、非法參數／缺圖／失焦） |

## 檢查

```powershell
node ../../core/tools/check.mjs "WaferInspection"          # 完整（含 ui）
node ../../core/tools/check.mjs "WaferInspection" --quick  # 快速
```
