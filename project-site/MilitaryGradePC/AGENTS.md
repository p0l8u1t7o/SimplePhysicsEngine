# 軍規電腦檢測系統（`MilitaryGradePC`）

DENSO VM-60B1 搭配第七軸，完成軍規筆電的翻轉、接口取像與檢測。

本檔是這個子專案的規則；全庫共通的規則在根目錄 `AGENTS.md`，從這個資料夾啟動 Claude Code 或 Codex 時會一併載入。

## 範圍

- 本站範圍是 `project-site/MilitaryGradePC/`；PR 分支名稱用 `militarygradepc/<說明>`。規則見根目錄 `AGENTS.md`「範圍」。
- core 缺功能：先在本站暫代，並登記到 `core/REQUESTS.md`。
- 待辦與待確認事項記在根目錄 `PENDING.md`「各站待確認」。

## 規格摘要

見 [README.md](README.md)。使用者提供的規格與圖面在 `docs/`（只留本機）。

## 已拍板事項

- 全場干涉一律修正，可以加步驟、可以調站位：S3 移到 x 1150，週期從 329.75 s 變成 347.75 s。
- 選型：DENSO VM-60B1＋RC8A、Keyence KV-X、IDS GigE 相機。
- 本站是 AutoSequence 數位孿生的示範站（2026-10-21）：孿生用的 MD 是 Automation-Schema 範例的原樣複本（`twin/`，從 tag 取出、不得手改，來源記在 `twin/SOURCE.md`）；場景綁定用 MD 的邏輯路徑，由 `web/js/twin-binding.js` 對照；`act-S3-PCLAMP` 維持 unbound。改 `cell.js`、`project.js` 的狀態或物件時，要同時跑 `tools/verify-twin.mjs`（快速檢查已列入）。
