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
  - P2（2026-10-04）：
    - 只給原始資料＋一段需求，不給之前的產出。MGPC 的原始資料在 `Python/PseudoPhysicsEngine/temp/`（QII 規格 PDF、工單 xls、實機照片）。
    - 只重做第一段；電控、配線、相機等 P4 後再追加驗收。
    - 兩站 × 兩種 CLI 用中階模型，MGPC 另用強模型各 1 次，共 6 次。
    - 設計問題由主 session 依現有拍板紀錄代答，沒有紀錄可依的轉給使用者。
    - 先跑快門 × Codex 當冒煙，之後兩種 CLI 並行、同一 CLI 依序；冒煙後凍結規則與提示詞，只修會卡住的 bug。
    - 新案等兩個重做站跑完後再補；對照報告做成 HTML 放在本機 `TEMP/`。
- 順序：~~搬庫~~、~~子專案規則~~、~~命令列原型 P1~~（已完成，見 `studio/README.md`）→ P2 驗收 → Electron 外殼（含庫模式）與第二段能力 → 內部安裝與更新。
- [x] P2 執行：冒煙＋其餘 5 次都完成，第一段全部通過檢查；對照報告在本機 `TEMP/p2-report/index.html`（2026-10-04）。
- [ ] 依 P2 報告定各角色的正式預設模型，寫進 `studio/lib/roles.mjs`（報告建議改以 Codex 為預設，需使用者確認）。
- [ ] P4b 審查角色要能比對「實作是否照已拍板事項與規則」：P2 有 2 次違反是檢查擋不住的（快門層序、顯示相機子畫面）。
- [ ] P2 新案的規格與需求（使用者提供；兩個重做站跑完後用正式預設跑一次）
- [ ] 觀察修正迴圈的實際表現：P1、P2 共 8 次實測都第一次就通過檢查，修正迴圈只用假代理測過。
- [ ] P1、P2 實測的工作區（`%USERPROFILE%\Documents\3D-Studio-P1test`、`3D-Studio-P1test-codex`、`3D-Studio-P2-claude`、`3D-Studio-P2-codex`）看完後可以刪除（core 是唯讀屬性，要先解除）。
- [ ] 內部 Pages 的發布目標：內部網頁伺服器／NAS 共用資料夾，或公司 GitHub 組織的 Pages（P4 前定）
- [ ] STEP 選用元件的安裝來源：內部共用資料夾或內部套件伺服器（P4 實作前）

## 各站待確認

- [ ] **PCB-CopperAssembly**：S1、S3 相機與 S2 Y 軌的間隙只剩 1.75 mm，待實機確認。
- [ ] **MilitaryGradePC**：用 DENSO CAD 核對關節零點與尺寸。
- [ ] **ChemicalTankWashing**：西牆捲門待現場確認。
- [ ] **shutter assembly**：待使用者提供葉片圖面。
- [ ] **WorkpieceMeasurement**：規格 A 底孔、規格 C 口部是依圖面判讀的，待原始圖檔確認。
