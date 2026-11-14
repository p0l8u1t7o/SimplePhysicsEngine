---
name: site
description: 在本庫建立或修改一個展示站（project-site/<站>/）時照 core/SITE-RULES.md 走完流程：開工盤點、選項對話拍板、實作、檢查、截圖自看、規格摘要、新站的評估簡報與成本表、提交。使用者說「做一個新站／新專案」「改某一站」「照規範做」「/site」時使用。
---

# 實作展示站

規則只有一份：`core/SITE-RULES.md`。**先完整讀它**，這個 skill 只把流程排成步驟，不重複規則內容。API 寫法看 `core/README.md`。

參數：`/site <站名或新站資料夾> [要做的事]`。沒給站名時，先用 AskUserQuestion 問。

## 步驟

1. **讀規則與現況**
   - 讀 `core/SITE-RULES.md`、站的 `AGENTS.md`（規格摘要、已拍板事項）、`git status`。有未提交改動的檔案不要 checkout／restore／stash。
   - 新站：確認資料夾名稱與標題後執行 `node core/tools/new-project.mjs <資料夾> "<標題>" "<一句說明>"`。
2. **盤點**（SITE-RULES「開工」第 3、4 項）
   - 在 `core/models/index.js` 找市購品模型。
   - 用 `node studio/vs3d.mjs parts search <關鍵字…>` 查元件庫。
   - 把「沿用的模型與元件編號」「core 缺的東西」列給使用者看。core 缺的登記到 `core/REQUESTS.md`。
3. **拍板**：站位、選型、節拍、範圍等取捨整理成 AskUserQuestion（1～4 題、每題 2～4 個選項，建議的放第一個並標「（建議）」）。決定寫進站 `AGENTS.md` 的「已拍板事項」。
4. **規格摘要**：寫進站 `AGENTS.md` 的「規格摘要」，空的過不了 `structure` 檢查。
5. **新站的評估資料**：
   - 寫 `.studio/plan/proposal.md`、`feasibility.md`＋`feasibility.json`、`bom.json`，格式照 `studio/lib/prompts.mjs` 的規劃任務。
   - 用 `node studio/vs3d.mjs assess "<站>" --repo check` 檢查，再用 `node studio/vs3d.mjs assess "<站>" --repo import` 匯入。
   - 確認 BOM 前先給使用者看總計與分段。
6. **實作**：`project.js` → 排程 → `main.js` 與 `tools/verify.mjs`。市購品用 `fromPart`／`tagPart`，現場既有的標 `noBom`。
7. **檢查**（重工作經 `cpu-cap.ps1`，見根目錄 `AGENTS.md`「環境」，一次只跑一個）：
   - `node core/tools/check.mjs "<站>" --quick`，修到通過；
   - 完整檢查 `node core/tools/check.mjs "<站>"`（含 `ui`）；
   - `node core/tools/shots.mjs "<站>" --out TEMP/<站>-shots --port <p>`，**用 Read 逐張看截圖**，修掉明顯不對或粗糙的地方。
8. **評估簡報（新站）**：`node studio/vs3d.mjs assess "<站>" --repo deck`，輸出到 `docs/assessment/`。
   - 用 PowerPoint 轉成 PNG 逐頁看過（做法在 `zq-work-deck` skill 的「交付前必做」），有文字溢出就回頭修資料。
9. **完成定義**：照 SITE-RULES「完成定義」10 項逐項確認。
   - review JSON 只有時間變動的先還原；
   - 待辦寫進 `PENDING.md`；
   - `project.json` 的 `coreVersion` 改成目前的 `core/VERSION`。
10. **提交**：檢查通過就 commit（英文訊息，結尾加 Co-Authored-By）。推送只在使用者要求時才做。
11. **回報**：幾行條列：做了什麼、做了哪些假設、還有什麼沒做，以及簡報與截圖的位置。
