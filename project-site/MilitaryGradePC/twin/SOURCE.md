# 孿生用機台描述檔（MD）的來源

`MilitaryGradePC.md.json` 是 Automation-Schema 範例 MD 的原樣複本，**不得手改**；要更新時從新的 tag 整檔重取，並更新本檔與 `tools/verify-twin.mjs` 的期望值。

| 項目 | 值 |
|---|---|
| 來源 repo | Automation-Schema（相鄰 checkout，`../../../Automation-Schema`） |
| tag | `v2.0.0-preview.3` |
| commit | `3b112ccf080d96caee9d80f09b398b727ec4ca34` |
| 檔案 | `examples/MilitaryGradePC.md.json` |
| schema | `zqs.machine-description/2.0` |
| mdHash | `sha256:389d9e049c89cd732a29a58f9fa179faebff9b7d234e8239d1b4c6c0c9d019b6` |
| 取出日期 | 2026-10-22 |

取出指令（在庫根目錄；從 tag 取，不從工作樹複製）：

```powershell
git -C ..\Automation-Schema show v2.0.0-preview.3:examples/MilitaryGradePC.md.json > project-site\MilitaryGradePC\twin\MilitaryGradePC.md.json
```

- 授權：Automation-Schema 為專有授權；使用者 2026-10-22 同意本範例 MD 進 SPE 版控。`twin/` 不在 `web/` 底下，不會發布到 Pages。
- 場景綁定用 MD 的邏輯路徑（例如 `cell/stackerIn/forks`），由 `web/js/twin-binding.js` 對照到本站的物件（開發計畫 Q-04 = A）。
- `act-S3-PCLAMP` 沒有場景綁定，孿生時列在 `unbound`（Q-07）。
