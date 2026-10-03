# 待辦事項

所有待辦都記在這裡，完成後打勾，或連同說明一起刪掉。已經拍板的決定記在 `AGENTS.md`（各站的在各站 `AGENTS.md`）。

## 規劃中的工作

### 1. 子專案規則的實機驗證

子專案規則已於 2026-10-04 完成（規則見 `AGENTS.md`「範圍」），以下是只用模擬輸入測過、還沒實際操作確認的部分：

- [ ] 從某站資料夾實際啟動 Claude Code，確認 `.claude/settings.json` 的寫檔關卡有載入，並且會擋下寫到 core 的 Edit（第一次啟動時可能要先信任該資料夾的 hook）。
- [ ] 第一個依 `<範圍>/…` 命名的 PR 上，確認 `scope.yml` 正常執行。

### 2. 3D 動畫生成應用程式

計畫書在本機 `TEMP/3d-app-plan.md`（不進版控）。

- 已拍板：
  - 給公司內部同事用，Claude Code 與 Codex 並行，Electron 外殼，第一版就含電控與相機。
  - 依角色指定模型（plan、build、render、review、fix），並有獨立的渲染與細節補強流程。
  - 上傳檔只留本機；成品可匯出網站壓縮檔、MP4、內部 Pages、單一 HTML。
  - core 自動升級並自動驗證；同事之間用專案交接包。
  - P2 驗收重做 MGPC 與快門，再加 1 個新案。
  - STEP 輸入排進 P4，Python＋OCP 做成選用元件；效能預算採中等；審查角色每段自動執行。
  - 應用程式程式碼放在本庫的 `studio/`（獨立範圍；CI 用路徑篩選，只改 `studio/` 時不觸發 Pages）。
  - 一般工作區的每個專案各自一個 git 庫。
  - 寫入隔離採多層防護：CLI 關卡＋唯讀屬性、每輪雜湊比對＋`check-scope`、偵測到越界就自動還原。
  - 庫模式：有本庫權限的人可以直接開啟庫內專案，代理在使用者的工作目錄改檔。app 不得執行 `checkout`／`restore`／`stash`／`reset --hard`／`clean`，改用逐檔寫回；遇到併改就停下提問；只提交該專案的路徑。
  - 單一 HTML 超過 15 MB 時，提示改用壓縮檔或內部發布。
- 順序：~~搬庫~~、~~子專案規則~~、~~命令列原型 P1~~（已完成，見 `studio/README.md`）→ P2 驗收 → Electron 外殼（含庫模式）與第二段能力 → 內部安裝與更新。
- [ ] P2 新案的規格與需求（使用者提供，開始 P2 前）
- [ ] P2 動工前用選項對話確認：MGPC 與快門要給代理哪些原始規格（各站 `docs/` 只在本機）、各角色要比較哪些模型、額度預算。
- [ ] P2 觀察修正迴圈的實際表現：P1 實測兩種 CLI 都第一次就通過檢查，修正迴圈只用假代理測過。
- [ ] P1 實測的工作區（`%USERPROFILE%\Documents\3D-Studio-P1test`、`3D-Studio-P1test-codex`）看完後可以刪除（core 是唯讀屬性，要先解除）。
- [ ] 內部 Pages 的發布目標：內部網頁伺服器／NAS 共用資料夾，或公司 GitHub 組織的 Pages（P4 前定）
- [ ] STEP 選用元件的安裝來源：內部共用資料夾或內部套件伺服器（P4 實作前）

## 各站待確認

- [ ] **PCB-CopperAssembly**：S1、S3 相機與 S2 Y 軌的間隙只剩 1.75 mm，待實機確認。
- [ ] **MilitaryGradePC**：用 DENSO CAD 核對關節零點與尺寸。
- [ ] **ChemicalTankWashing**：西牆捲門待現場確認。
- [ ] **shutter assembly**：待使用者提供葉片圖面。
- [ ] **WorkpieceMeasurement**：規格 A 底孔、規格 C 口部是依圖面判讀的，待原始圖檔確認。
