# 待辦事項

所有待辦都記在這裡，完成後打勾，或連同說明一起刪掉。已經拍板的決定記在 `AGENTS.md`（各站的在各站 `AGENTS.md`）。

## 規劃中的工作

### 1. 子專案規則的實機驗證

子專案規則已於 2026-10-04 完成（規則見 `AGENTS.md`「範圍」），以下是只用模擬輸入測過、還沒實際操作確認的部分：

- [x] 寫檔關卡實機確認（2026-10-04）：從 `project-site/RobotArmPressSSD/` 啟動 Claude Code（-p），Write 到 `../../core/` 被擋下並顯示範圍說明，寫本站檔案正常。
- [x] scope.yml 實機確認（2026-10-04）：PR #1（`recyclesorter/electrical-view`）的 Scope check 判定為 RecycleSorter 範圍並通過，PR 的快速檢查也通過。

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
    - P4b（2026-10-04）：審查的必修項（違反拍板或規則）自動送修正，建議補強才給使用者；第一段完成後審查、補強、守門檢查全自動，只在最後停下看前後對照（接受／要調整／整批還原）；手動 `vs3d render --pick` 時用一張卡片三選一（全部／只補高優先／自己挑編號）。手機幀率預算改為「不低於補強前的 80%」，30 fps 只當提示（無頭量測不等於實機，現有各站都低於 30）。
    - P3（2026-10-04）：網頁介面先行（`vs3d ui`，本機 127.0.0.1），Electron 之後包在外面；前端用 React＋Vite（npm 套件只放在 `studio/ui/`，core 與 7 站仍然沒有套件）；第一版包含專案清單＋新建（拖放上傳）、進度串流＋提問卡片、預覽＋補強對照（P4c）、設定頁（角色與模型）。
    - 正式預設（使用者的實務分工）：規劃、開發、修正、審查用 Claude opus；渲染與細節補強用 Codex gpt-6-astra 高推理。P4 第二段的電控、電盤與配線也預設交給 Codex gpt-6。
- 順序：~~搬庫~~、~~子專案規則~~、~~命令列原型 P1~~（已完成，見 `studio/README.md`）→ P2 驗收 → Electron 外殼（含庫模式）與第二段能力 → 內部安裝與更新。
- [x] P2 執行：冒煙＋其餘 5 次都完成，第一段全部通過檢查；對照報告在本機 `TEMP/p2-report/index.html`（2026-10-04）。
- [x] 定各角色的正式預設：opus 規劃與實作、gpt-6 渲染與細節補強（2026-10-04，已寫進 `studio/lib/roles.mjs`）。
- [x] P4 第二段能力實作（2026-10-04，core 1.4.0）：`vs3d stage2`／第一段完成後的卡片、`segment2.md`／`segment2.json` 規劃、角色依段落指派、第二段不能改第一段的排程指紋、core 內建 `electrical` 檢查、`core/examples/segment2` 範例、相機模型。
- [x] 現有 5 站（酸鹼、MGPC、PCB、SSD、快門）的配線檢查改由 core 的 `electrical`（`verify.cables`）執行，根目錄 verify-cable-routing／verify-cables／verify-electrical-plan 退役；退役前逐情境比對完全一致（2026-10-04，core 1.5.0）。
- [x] P4 第二段驗收（2026-10-04）：MGPC（P2 Codex 版）與回收物分揀都跑完第二段，結果見 `studio/README.md`「P4 第二段驗收」；回收物分揀成品已匯入本庫。快門不跑（使用者決定）。
- [ ] 回收物分揀：光幕依 ISO 13855 的安全距離 668 mm 在現有框架內不成立，畫面只畫示意；實機防護位置待風險評估（對客戶說明時要提）。
- [x] 回收物分揀的「電盤配線」視角改從機台後緣上方往下看，進入時收起相機子畫面（2026-10-04，在 `recyclesorter/electrical-view` 分支，用來確認 scope.yml）。
- [ ] P2 MGPC 的第二段成品：右上角「外觀檢查」面板被電控檢視器面板蓋住（第一段就有），之後若要拿這版展示再修。
  - 推送：驗收結束後一起推。推送前改寫 origin/main 之後的本機 commit，清掉歷史裡的用戶名稱（`git filter-branch`，原歷史備份在 `refs/original`）。
- 第二段的拍板內容（2026-10-04）：
  - 第一段（含補強 A）完成後出卡片「開始第二段？」，也可以之後用 `vs3d stage2` 或介面按鈕開始。
  - 角色依段落指派：第二段的開發、修正預設 Codex gpt-6-astra high，審查維持 Claude opus，補強 B 照舊 gpt-6。
  - 輸入：第二段先跑規劃，代理讀 docs 整理成 `.studio/plan/segment2.md`＋`segment2.json`（電控元件、電盤位置、走線、相機與光源規格、安裝位置），做成卡片確認後才開發。
  - 檢查：core 內建 `electrical` 檢查（場景有電控元件就自動跑：元件在櫃內、不重疊、線不穿元件、穿板孔），配線碰撞由 `project.js` 的 `verify.cables` 宣告；`populatePanel` 可以直接收元件表。現有 7 站繼續用根目錄工具。
  - 驗收：拿 P2 的 MGPC、快門成品與原始回收物分揀工作區追加第二段。
- [x] P4b 命令列：審查（比對拍板事項與規則）、必修送修正、渲染補強、守門檢查（排程指紋、空間檢核、效能預算）、前後對照與還原（2026-10-04，core 1.2.0）。
- [x] P4b 實測：新案 RecycleSorter 第一次完整真實執行（審查→必修修正→補強→守門→對照→調整→接受）。
- [x] 審查能力驗證（2026-10-04，`vs3d review --no-fix`，opus）：快門 × sonnet 抓到「葉片疊放順序做反」、MGPC × opus 抓到「空白相機預覽框是第一段不做的東西」，兩個已知錯誤都在必修第 1、2 項；另外各抓到 2 項真問題（右抽屜吸塑盤是空的、沒標「示意」、標籤數字與幾何不符、S3 夾持對象與拍板不符）。每案約 6 分鐘。
- [x] P3 網頁介面 `vs3d ui`（含 P4c 補強勾選與前後對照），端對端測試通過（2026-10-04）。
- [ ] 用 Electron 把網頁介面包成桌面程式（原生檔案對話框、拖放取得路徑）；安裝檔在 P5。
- [x] 上傳 pptx／xlsx／docx 時自動抽出文字與圖片到 `docs/<檔名>.extract/`（純 Node，2026-10-04）。沒做：pptx 內嵌影片的影格、圖表數據、EMF／WMF 向量圖。
- [x] 7 站與 RecycleSorter 搬進 `project-site/`，新案已匯入本庫（`project-site/RecycleSorter/`，2026-10-04，core 1.3.0）；之後的新專案都放在 `project-site/`。
- [x] P2 新案：回收物分揀展示機（`TEMP/demo`），用正式預設跑完：opus 開發 3 輪、審查抓到 2 項違反拍板的必修並自動修正、gpt-6 補強兩次都通過守門檢查（2026-10-04）。依使用者拍板偏離客戶規格三處：抓取寬 280 mm（規格 600）、混合料流 1.5～1.6 s（規格 1.4）、機台寬 1460 mm（規格 1300），對客戶說明時要提。
- [ ] 觀察修正迴圈的實際表現：P1、P2 共 8 次實測都第一次就通過檢查，修正迴圈只用假代理測過。
- [x] P1、P2 實測的工作區已刪除（2026-10-04，對照截圖留在本機 `TEMP/seg2-accept/`、`TEMP/p2-report/`）。
- [x] 匯出擴充（2026-10-04，core 1.6.0）：`core/tools/export.mjs`（網站壓縮檔附離線啟動、單一 HTML 全部內嵌、MP4 全自動），`vs3d export`／`handoff`／`import` 與介面按鈕；Python 錄影接收端退役。推到內部 Pages 等發布目標定了再接。
- [x] 錄影的改進（2026-10-04，core 1.7.0）：步驟 `offset`（化學桶 AGV 改從南側拍）、`speed`、`targetSeconds`；使用者決定片長不設預設上限。原本的需求：讓 `offset` 能依步驟或時間改變（廠房級的站有些站位要從反方向拍，例如化學桶 AGV 進貨架）；讓專案指定變速倍率（化學桶片長 15 分鐘、約 7 成是沖洗站）。
- [ ] 內部 Pages 的發布目標：內部網頁伺服器／NAS 共用資料夾，或公司 GitHub 組織的 Pages（P4 前定）
- [ ] STEP 選用元件的安裝來源：內部共用資料夾或內部套件伺服器（P4 實作前）

## 各站待確認

- [ ] **PCB-CopperAssembly**：S1、S3 相機與 S2 Y 軌的間隙只剩 1.75 mm，待實機確認。
- [ ] **MilitaryGradePC**：用 DENSO CAD 核對關節零點與尺寸。
- [ ] **ChemicalTankWashing**：西牆捲門待現場確認。
- [x] **ChemicalTankWashing**：`storage.js` 的 `zAt` 改成先夾上限再取整，示範車道第 4 位的棧板與穿梭車不再是 NaN；錄影的 `hideInvalid()` 暫代已拿掉（2026-10-04）。
- [ ] **shutter assembly**：待使用者提供葉片圖面。
- [ ] **WorkpieceMeasurement**：規格 A 底孔、規格 C 口部是依圖面判讀的，待原始圖檔確認。
