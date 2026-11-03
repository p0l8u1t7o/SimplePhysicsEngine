# 第二輪細節補強

基準為 `df4bf9f431b7986c33916510085866e68c8a80be`。修改範圍限本站與 `TEMP/tw-codex*`；未修改 core，未提交、切換、還原、暫存或推送 Git 內容。以下為展示模型與 Node 驗證，並非設備實測。

## 審查事項與檔案

| 項目 | 處理方式 | 檔案 |
|---|---|---|
| C 案人孔頸附近管束 | 熱風與光纖改沿上臂中性側，接頭避開關節端蓋。原管夾基準框架保留，支架幾何重新配合管路。預設上環縫仍為 870 mm，上限小幅提高到 875 mm。 | `web/js/details.js`、`spec.js`、`AGENTS.md` |
| PTFE 切屑 | 開槽／削平各加後側吸屑罩，罩口退後 TCP 22 mm；沿臂吸屑管、工具快換接頭與獨立集屑機。切屑效果朝吸口移動，不再向槽內散落。 | `web/js/tools.js`、`details.js` |
| 熱風焊槍停放 | 焊條、焊帶格位都有向上開口隔熱槽、支腳、朝噴嘴的待機送風支管及高溫警示牌。額外取放檢查抓到料卷／送料件會擦側板，已加寬並將側板集中在熱噴嘴側，留下送料側擺動開口。 | `web/js/tools.js` |
| 補焊真實感 | 補焊段由 22 mm 寬改為 36 mm，增加圓潤邊緣、微小凝固紋理、光澤與暖色轉乳白的冷卻表現。維持 `repair-patch`、`userData.fx` 及紅／橘／綠判定圈。 | `web/js/tank.js` |
| THz 可讀性 | 加大字級，A-scan 顯示 0–60 ps 刻度，B-scan 顯示 0／2／4 mm 深度及正負回波圖例。深度依 PFA／PTFE／膠各自折射率換算。原回波、材料數值、厚度與判定門檻未改。相同顯示狀態使用快取畫布。 | `web/js/thz-view.js` |
| 三案物理合理性 | A 案補螺桿至壓墊的伸縮接桿；B 案補隨原夾緊狀態移動的圓弧橡膠壓條，以切線接觸避免平面閃爍；C 案補定位腳落地鞋板，門架標籤隨門架移動。集屑機本體與抽屜分層，修正初次檢查發現的重合底面。 | `web/js/details.js`、`plans.js`、`main.js` |
| 回歸與說明 | 六案例增加 C 案 15 mm 間隙門檻、人孔區間隙與排版數值；細節檢查涵蓋接觸位置、補焊倒序、刻度換算與畫布快取。更新本站使用說明。 | `tools/verify.mjs`、`verify-details.mjs`、`README.md` |

沒有新增或放寬 `allow`，沒有把實體吸屑罩／管路標成 FX。THz 補焊疊層與切屑粒子屬既有的製程示意層。

## 排程與軌跡

修改前後執行：

```text
node core/tools/run.mjs TeflonWelding ../../core/verify/run.mjs fingerprint
```

原始輸出：`TEMP/tw-codex-fp-before.txt`、`TEMP/tw-codex-fp-after.txt`。以 `compareFingerprints(..., {tol: 0})` 比對三案，全部 `ok: true`、`diffs: []`，僅增加細節物件。原有命名物件基準框架軌跡保持不變，管路與支架幾何的重配屬本次指定修正。

另從 HEAD 唯讀複製基準模組到 `TEMP/tw-codex-baseline/`，比對完整時間軸事件、各 track 步驟、apply 狀態、TCP 與全部工具的世界矩陣：

| 方案 | 總時間（秒） | 事件 | 比對時間點 | 結果 |
|---|---:|---:|---:|---|
| A | 268.42 | 221 | 892 | 完全一致 |
| B | 322.4769444444444 | 250 | 1001 | 完全一致 |
| C | 324.87 | 269 | 1077 | 完全一致 |

證據：`TEMP/tw-codex-contract.json`、`TEMP/tw-codex-fingerprint-comparison.json`。沒有改 `DEMO`、IK、載具行程、製程順序或預設透視模式。

## 驗證

最終 quick 為 **11/11 綠燈**，exit 0。其中 electrical、physics、bom 由檢查器明確列為不適用／略過；其餘 8 項實際通過。日誌：`TEMP/tw-codex-quick-final.log`。

- 三案 scene：動態干涉 0、靜態干涉 0、重合面 0；沿用原檢查取樣與門檻。警示貼片已移至隔熱槽底板，避開相鄰格位的原立柱。
- `tools/verify.mjs`：預設與極端排版共 6/6 通過，沒有桶壁穿入；逐頂點以 0.1 秒取樣，保留原刀尖接觸排除範圍。
- `tools/verify-details.mjs`：每案 2,921 項，共 8,763 項通過。
- 最終指紋三案 `diffs: []`；完整事件、步驟、TCP 與工具世界矩陣比對通過。

| 案例 | 下／上環縫（mm）／縱縫數 | 槽內最小間隙（mm） | 人孔區最小間隙（mm） | TCP 最大跟隨誤差（mm） |
|---|---|---:|---:|---:|
| roll | 420／870／1 | 16.8 | 37.8 | 0.05 |
| roll·極端排版 | 250／1000／2 | 16.8 | 37.8 | 0.05 |
| turntable | 420／870／1 | 16.8 | 37.3 | 0.05 |
| turntable·極端排版 | 250／1000／2 | 14.4 | 14.4 | 0.05 |
| cobot | 420／870／1 | 16.8 | 22 | 0.16 |
| cobot·極端排版 | 250／875／2 | 16.8 | 17.8 | 0.16 |

C 案預設 `minGapInside` 從審查指出的 6.8 mm 提高到 16.8 mm，符合 ≥15 mm；目前槽內最小值對應原有 `pfa-tape`，人孔區最小值另列為 22.0 mm。C 案上限 875 mm 的極端排版亦達 16.8 mm，人孔區為 17.8 mm。人孔區統計限定槽體局部 y > 1290 mm（上封頭與人孔頸範圍）。B 案極端排版為原有 `mast-head` 的 14.4 mm，無穿入；本次新增的 15 mm 強制門檻僅適用指定的 C 案。

完整結果：`review/verification.json`、`details-verification.json`、`scene-verification.json`，彙整為 `review/detail-pass-2-checks.json`。

工具架另以 20 ms 間隔，將各工具的實體頂點轉入每片隔熱板與支腳的座標檢查，沒有套用「工具可接觸工具架」的既有 allow。A／B／C 分別 13,421／16,124／16,244 個時間點，共 45,789 點，穿入數均為 0（表面容差 0.05 mm）。此為離散逐頂點檢查，不宣稱連續時間 CAD 干涉認證。證據：`TEMP/tw-codex-rack-clearance.json`。

重工作均逐一經既有 CPU wrapper 執行。環境要求加 `-ExecutionPolicy Bypass` 才能載入腳本；wrapper 內部會將傳入的 50% 再限制為 40%，本次未修改 wrapper。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Working Space\AutoSequence\temp\cpu-cap.ps1" -Percent 50 -Command "node --import ./TEMP/tw-codex-check-output.mjs core/tools/check.mjs TeflonWelding --quick"
```

`check-output` 啟動鉤子僅將共用檢查器固定的 `TEMP/check-quick.json` 改寫到授權的 `TEMP/tw-codex-check-quick.json`；沒有改檢查程序、門檻或結果。標準 quick 會包含本站 `tools/verify.mjs` 及 `tools/verify-details.mjs`。

## 瀏覽器、效能與未完成範圍

- 瀏覽器測試副本僅寫在 `TEMP/tw-codex*`，網站使用 8850、DevTools 使用 8851。Chrome 啟動後以 exit `2147483651` 結束，報 `Chrome DevTools 未啟動`。沒有取得可用截圖、UI 或 FPS 結果；記錄為 `TEMP/tw-codex-browser-probe.log`。
- 三案的透視／剖切／實體切換與多時間點幾何、狀態可由 Node 檢查覆蓋；**三案多時間點人工畫面檢視、THz 實際字形與視窗閱讀效果、手機 FPS 約 5% 預算仍待瀏覽器驗收**。畫布記錄器只查輸出文字、基準點、字級和快取，不取代瀏覽器。
- 新管路採 24 段曲線與靜態合併；小件、管路與周邊維持不投影。Node 幾何統計只作資源盤點，不換算成 FPS 或 GPU draw calls。
- C 案 900 mm 的額外試算在人孔區發現共用手臂原有上臂護線碰壁；880 mm 雖無穿入，但初測餘隙只有約 12.1 mm。因此不採用這兩個上限。
- C 案定位腳鞋板已貼地及可收起；既有腳輪／門架高度軌跡保持原樣，尚未表現腳輪真正抬離地坪的受力動作。此項若要進一步做實際離地位移，須放寬原物件軌跡限制。
- 關節內吸屑通道、旋轉接頭、沿載具內部的主管、實際抽氣能力及隔熱效能仍為配置示意，未做管路內流場、最小彎曲半徑、扭轉壽命、現場設備或實機焊接驗證。

## core 建議（未修改）

1. `check.mjs` 增加 `--out`，讓受限工作範圍可指定摘要輸出，不必加啟動鉤子。
2. `cdp.mjs` 開放 DevTools 埠號、profile 位置與啟動逾時參數，並在瀏覽器提前退出時回報 exit code；避免受限環境只能等待連線。
