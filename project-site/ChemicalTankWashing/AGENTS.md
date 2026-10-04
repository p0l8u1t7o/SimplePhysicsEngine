# 200L 化學桶自動清洗線（`ChemicalTankWashing`）

穿梭車密集架＋AGV、龍門翻桶、貼標定位、自動開蓋、FANUC 手臂沖洗與負壓抽乾。

本檔是這個子專案的規則；全庫共通的規則在根目錄 `AGENTS.md`，從這個資料夾啟動 Claude Code 或 Codex 時會一併載入。

## 範圍

- 本站範圍是 `project-site/ChemicalTankWashing/`；PR 分支名稱用 `chemicaltankwashing/<說明>`。規則見根目錄 `AGENTS.md`「範圍」。
- core 缺功能：先在本站暫代，並登記到 `core/REQUESTS.md`。
- 待辦與待確認事項記在根目錄 `PENDING.md`「各站待確認」。

## 規格摘要

見 [README.md](README.md)。使用者提供的規格與圖面在 `docs/`（只留本機）。

## 已拍板事項

- 穿梭車密集架、龍門翻轉、自動開蓋、FANUC R-2000iC/165F 沖洗。
- 約 24 桶／h，週期 753.1 s。
