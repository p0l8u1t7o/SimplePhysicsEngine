# studio：3D 設備動畫生成應用程式

上傳規格、輸入需求，由使用者電腦上已登入的代理 CLI（Claude Code 或 Codex）做出與本庫各站同等級的 3D 設備動畫。介面是命令列 `vs3d`＋網頁介面（本機瀏覽器），不做 Electron 桌面外殼（2026-10-04 決議）。計畫書在本機 `TEMP/3d-app-plan.md`（不進版控）。

命令列只需要 Node.js 22 以上，沒有 npm 套件；網頁介面（`studio/ui/`）用 React＋Vite，npm 套件只放在那個資料夾。

## 網頁介面（P3）

```powershell
npm --prefix studio/ui install        # 第一次：安裝 React 與 Vite（只在 studio/ui）
npm --prefix studio/ui run build      # 建置到 studio/ui/dist（不進版控）
node studio/vs3d.mjs ui               # 開啟 http://127.0.0.1:8780/（--port、--no-open、--workspace）
```

也可以用根目錄的腳本在背景啟動與停止（第一次會自動安裝並建置前端）：`scripts\start.cmd -Studio [-Workspace <資料夾>]`、`scripts\stop.cmd -Studio`。

- 專案清單、新建（拖放規格、圖面、照片、影片、Office 檔；影片自動每 5 秒擷取影格，Office 檔自動抽出文字與圖片）、即時進度、提問卡片（補強項目是勾選清單）、提案、審查結果、3D 預覽、截圖、補強前後對照、設定（兩種 CLI 的狀態與各角色的 CLI＋模型）。
- 介面用子程序執行 `vs3d` 命令列，流程和終端機完全相同；回答完全部問題會自動續跑。伺服器只聽 127.0.0.1，`/files/` 只開放專案的 `TEMP/`、`docs/`、`.studio/plan|reviews|render/`。
- 開發時 `npm --prefix studio/ui run dev`（Vite 5173，`/api` 轉給 8780 的 `vs3d ui`）。
- 端對端測試：`node studio/test/ui-e2e.mjs [--shots 資料夾]`（暫存工作區＋假代理，在網頁上點完整個流程，約 2 分鐘）。
- 「元件庫」：元件資料庫的查詢、新增、編輯、刪除（見「元件資料庫」）。
- 介面維持網頁版：用瀏覽器開，檔案用拖放或「選擇檔案」上傳（2026-10-04 決議不做 Electron）。

## 用法

```powershell
node studio/vs3d.mjs doctor                                   # Claude Code／Codex 是否已安裝、已登入
node studio/vs3d.mjs new Conveyor --prompt "輸送帶＋龍門取放，節拍 10 s" --files spec.pdf photo.jpg
node studio/vs3d.mjs status Conveyor                          # 階段、輪數、等待中的問題
node studio/vs3d.mjs answer Conveyor layout-1 2 --note "靠牆"  # 不在終端機時回答問題
node studio/vs3d.mjs resume Conveyor                          # 回答後、中斷後續跑
node studio/vs3d.mjs check Conveyor --full                    # 手動跑檢查
node studio/vs3d.mjs review Conveyor                          # 重新審查（必修自動送修正），接著補強
node studio/vs3d.mjs render Conveyor --pick --focus "手臂與夾爪" # 重新補強：先挑項目、限定範圍
node studio/vs3d.mjs stage2 Conveyor                          # 開始第二段（電控、電盤、配線、相機）
node studio/vs3d.mjs export Conveyor [--zip] [--html] [--mp4]  # 匯出成品到專案 TEMP/exports/（不指定時壓縮檔＋單一 HTML）
node studio/vs3d.mjs handoff Conveyor                         # 交接包：git 歷史、上傳檔、提問與紀錄、不得顯示的名稱
node studio/vs3d.mjs import Conveyor-handoff-20261004.zip --name Conveyor2   # 匯入交接包，之後 resume 續跑
node studio/vs3d.mjs probe Conveyor --cli codex --other <另一個專案>   # 寫入隔離自我測試
node studio/vs3d.mjs models Conveyor                          # 各角色目前的 CLI 與模型
node studio/vs3d.mjs parts search 相機 GigE                    # 查元件資料庫（選型、單價、哪些專案用過），見「元件資料庫」
```

共通選項：

| 選項 | 說明 |
|---|---|
| `--workspace <資料夾>` | 工作區位置；預設 `%USERPROFILE%\Documents\3D-Studio`，也可設環境變數 `VS3D_WORKSPACE` |
| `--cli claude｜codex` | 這次所有角色改用指定的 CLI |
| `--model <名稱>`、`--role plan=opus,fix=haiku` | 這次所有角色／個別角色的模型；`--role render=codex:<模型>` 可以同時換 CLI |
| `--effort <等級>` | 推理強度（Claude `--effort`、Codex `model_reasoning_effort`） |
| `--no-wait` | 有問題時寫出後就結束（預設在終端機直接詢問） |
| `--auto-approve` | 配置提案不必確認，直接開始開發 |
| `--no-review`、`--no-render`、`--no-perf`、`--no-fix` | 第一段完成後不自動審查／不補強／補強時不量效能；`--no-fix` 審查的必修項不送修正（只審查） |
| `--no-stage2` | 第一段完成後不出「開始第二段？」卡片（之後可以用 `vs3d stage2`） |
| `--private "名稱,…"` | `new` 時指定不得顯示的用戶名稱 |
| `--pick`、`--focus "範圍"` | 補強前先用卡片挑項目（全部／只補高優先／自己挑編號）；限定這次補強的範圍 |
| `--max-rounds 40`、`--timeout 90` | 輪數上限、每輪逾時（分鐘）；opus 開發複雜案子單輪可能超過 60 分鐘 |

結束代碼：0 完成、10 等待回答、1 中途停止（代理失敗、額度、逾時），2 參數錯誤。

## 流程

```
new → 規劃（配置提案＋問題）⇄ 使用者回答 → 確認提案 → 開發第一段
    → 快速檢查 → 完整檢查（含 ui 四尺寸）→ 截圖
           └ 失敗 → 修正（續接同一個工作階段）→ 再檢查；同一項連續失敗 3 次轉成提問
    → 審查（比對拍板事項與規則、看截圖）
           └ 必修 → 修正 → 再檢查 → 再審查（最多 3 次）
    → 渲染與細節補強（建議補強全部交給 render 角色；--pick 先挑）
    → 守門檢查：檢查全過、排程指紋與空間檢核不變、效能在預算內
           └ 沒過 → 退回 render（續接，最多 3 次，之後轉成提問）
    → 前後對照頁（TEMP/render-compare/）→ 接受／要調整／整批還原 → 第一段完成
    → 卡片「開始第二段？」（或之後 vs3d stage2、介面的「開始第二段」）
    → 第二段規劃（.studio/plan/segment2.md＋segment2.json：電控元件、電盤、走線、相機與光源）⇄ 回答 → 確認提案
    → 記下第一段的排程指紋 → 第二段開發（照 core/examples/segment2）
    → 檢查（含 electrical：電盤、櫃內連線、穿板孔、配線動態取樣）＋排程指紋與第一段相同 ⇄ 修正
    → 審查（第二段）→ 補強 B（電盤內部、線材、相機與光源外觀）→ 守門 → 對照 → 第二段完成
```

第二段的開發與修正預設用 Codex `gpt-6-astra` 高推理，審查仍用 Claude `opus`（`lib/roles.mjs` 的 `SEGMENT_DEFAULTS`）。只想改某一段的指派時寫「角色@段」，例如 `studio.json` 的 `roles: { "build@2": { "cli": "claude", "model": "opus" } }` 或 `--role build@2=claude:opus`。工作階段也分段保存（`state.sessions['build@2']`），第二段不會續接第一段的開發工作階段。

**用戶名稱**：任何產出都不得出現用戶（客戶）名稱。`new --private "名稱,…"`（介面的「不得顯示的用戶名稱」欄）會加進工作區的 `.studio/client-names.txt`，需求原文裡的名稱換成「（用戶）」；規劃角色在資料裡發現的名稱寫進 `.studio/plan/client-names.txt`，app 併進名單並遮掉專案 `AGENTS.md`。core 的 `names` 檢查（快速）擋下出現名稱的檔案，審查角色把它當必修。

效能預算在專案 `studio.json` 的 `budget`：三角面 ≤ 補強前 1.5 倍、draw call ≤ 1.3 倍、手機幀率不低於補強前的 80%。`phoneMinFps`（30）只當提示：無頭瀏覽器加 CPU 降速的幀率不等於實機，現有各站本身也低於 30。

每一輪：

1. 專案有未提交的變更就先 commit（還原點）。
2. 記下受保護路徑的雜湊：工作區的 `core/`、core 還原副本、規則檔、其他專案。
3. 執行代理；Claude Code 掛上寫檔關卡（`lib/guard.mjs`，可寫範圍依角色決定），Codex 用 `workspace-write` 沙箱。
4. 比對雜湊，被改動的自動還原（`lib/isolation.mjs`）；再用 git 檢查角色範圍：規劃角色不能改程式，開發與修正角色不能改 `AGENTS.md`、`studio.json`。
5. commit，並把這一輪寫進 `.studio/rounds.jsonl`（角色、CLI、模型、工作階段、秒數、用量、違規）。

判定一律看 app 自己跑的檢查結果，不採信代理自己回報的「已通過」。

## 工作區

```
<工作區>/
├── studio-workspace.json   標記：core 的 projects.mjs 看到它就改從 projects/ 找專案（網址配置不變）
├── core/                   內附的 core（唯讀屬性）
├── .studio/                core 還原副本、工作區設定（settings.json：defaultCli、各角色預設）
├── AGENTS.md、CLAUDE.md     代理的共通規則（studio/templates/）
└── projects/<專案>/         每個專案一個 git 庫
    ├── AGENTS.md            需求、已拍板事項（app 寫入）
    ├── studio.json          角色與模型、效能預算
    ├── docs/                上傳檔（不進版控）；Office 檔另有 <檔名>.extract/（text.md＋圖片）
    ├── .studio/             狀態、問題與回答、配置提案、每輪紀錄與事件記錄（不進版控）
    └── web/ tools/ review/  與本庫各站相同
```

代理 CLI 讀不了 Office 檔，所以建立專案時（`new --files` 與網頁上傳都一樣）由 `lib/office.mjs` 自動抽出（純 Node，自己解 zip，不用套件）：pptx 依投影片順序抽文字（含表格、SmartArt、備忘稿），圖片命名 `slideNN-…` 標出所在投影片；docx 抽段落、標題、清單、表格，圖片位置以 `[圖片：…]` 標在本文；xlsx 每個工作表轉成 Markdown 表格（列號＋欄字母，日期與百分比依儲存格格式，最多 2000 列），圖片標出錨點儲存格。結果寫到 `docs/<檔名>.extract/text.md`，專案 `AGENTS.md` 的上傳檔清單會標出路徑。檔案損壞只記警告；舊格式（.ppt／.doc／.xls）不處理，建立時提示另存成新格式。圖表數據、版面位置不會保留。

角色指派的優先順序：app 預設（`lib/roles.mjs`）＜ 工作區 `.studio/settings.json` ＜ 專案 `studio.json` ＜ 命令列。正式預設（2026-10-04 拍板）：規劃、開發、修正、審查用 Claude `opus`；渲染與細節補強用 Codex `gpt-6-astra` 高推理（`lib/roles.mjs` 的 `ROLE_DEFAULTS`）。這是使用者的實務分工：opus 做規劃與主體實作，gpt-6 補強渲染、電盤、電線與細節；P4 第二段的電控與配線也預設交給 gpt-6。命令列 `--cli` 會讓所有角色改用同一種 CLI。`new` 時指定的 `--cli`、`--model`、`--effort`、`--role` 會寫進專案 `studio.json`，之後 `resume` 沿用。

## 本庫模式（2026-10-04）

從本庫啟動介面（`scripts\start.cmd -Studio` 或 `node studio/vs3d.mjs ui`）時，清單分成「工作區」與「本庫 project-site」兩區，可以直接對本庫的站下指令（計畫書 4.10）；`--no-repo` 只看工作區。命令列用 `--repo`（或 `--workspace` 指到本庫根目錄）：

```powershell
node studio/vs3d.mjs status --repo                                        # 本庫各站的狀態
node studio/vs3d.mjs review RecycleSorter --repo                          # 審查＋補強（沒有 vs3d 截圖時先檢查、截圖）
node studio/vs3d.mjs change RecycleSorter --repo --text "出料台改成兩層" --keep-timing   # 修改指令：開發 → 檢查 → 審查
node studio/vs3d.mjs stage2 ChemicalTankWashing --repo                    # 第二段（電控、配線、相機）
node studio/vs3d.mjs check RecycleSorter --repo ；export RecycleSorter --repo --zip
node studio/vs3d.mjs push RecycleSorter --repo                            # 推送這次的 vs3d 分支（之後在 GitHub 開 PR）
```

- **開工檢查**：該站有未提交的改動就拒絕開始（`docs/`、`TEMP/`、`.studio/` 不算）。其他路徑有未提交改動沒關係，app 不會碰。
- **別的工具改的站**：用 Claude Code、Codex 桌面版等工具新增或修改 `project-site/` 的站，介面不必重開就看得到（每次載入清單都重新掃描，有 `project.json` 的資料夾就列出來）。還沒提交的改動會在清單標「N 個未提交」，站頁列出檔案，並停用會開分支的指令（審查、補強、第二段、修改指令）；檢查與匯出照常可用。
- **分支**：每次指令從目前的 HEAD 開一個本機分支 `<範圍>/vs3d-<指令>-<月日-時分>`（不改任何檔案）；已經在本站的 vs3d 分支上就沿用。流程進行中切到別的分支時，續跑會拒絕，app 不會替你切換分支。
- **提交**：每輪只 `git add`／`commit` 該站的路徑（pathspec），review JSON 只有時間變動的寫回原內容不提交。推送只在你按「推送分支」或執行 `vs3d push` 時做。
- **絕不執行** `checkout`／`restore`／`stash`／`reset --hard`／`clean`。角色越界與補強的「整批還原」都用逐檔寫回（`git show <commit>:<路徑>`）；整批還原只寫回代理改過、而且你之後沒再改的檔案，你改過的會列出來不動。
- **專案外的變動**只警告、不還原（分不出是你同時在改還是代理越界；代理已經被寫檔關卡與 Codex 沙箱擋在本站內）。
- 代理的規則是本庫根目錄的 `AGENTS.md`＋本站的 `AGENTS.md`，提示另外寫明「不要自己 commit／checkout」；回答的問題照樣寫進本站 `AGENTS.md` 的「已拍板事項」。app 狀態在各站的 `.studio/`（不進版控），鎖與設定在本庫 `TEMP/studio/`，用戶名稱名單用本庫的 `.private/client-names.txt`。
- 還沒做：代理執行中同一個檔案被你和代理都改過的「併改偵測」（目前開工時要求本站乾淨，執行中改到本站的檔案會被當成代理的改動一起提交）。

## 匯出與交接（2026-10-04）

- **成品**：`vs3d export`（介面「匯出成品」列）呼叫工作區 core 的 `tools/export.mjs`，輸出到專案 `TEMP/exports/`，介面列出已匯出的檔案可以下載。
  - 網站壓縮檔：首頁＋本站＋core，解壓後雙擊 `open-demo.cmd` 用 Windows 內建 PowerShell 的本機伺服器開啟，客戶電腦不必安裝軟體。
  - 單一 HTML：模組、CSS、圖示全部內嵌（Blob URL），雙擊就能離線開；一站約 1.5 MB，超過 15 MB 時建議改用壓縮檔。
  - MP4：無頭 Chrome（GPU）開 `?movie&auto` 全自動錄製，ffmpeg 用 NVENC（不可用時 libx264），結束時核對影格數。範本已經接好錄影；這個功能之前建立的專案要自己在 `main.js` 加 `installMovie`（照 `core/template/web/js/main.js` 最後一段）。
  - 匯出前後都做用戶名稱檢查，成品裡有名稱就失敗、不留下檔案。
- **交接包**：`vs3d handoff` 產生 `TEMP/exports/<專案>-handoff-<日期>.zip`，內容是專案 git 全部歷史（bundle）、`docs/` 上傳檔、`.studio/` 的狀態、提問、回答、提案、審查與每輪紀錄（不含代理的完整對話記錄），以及這個專案不得顯示的用戶名稱。對方用 `vs3d import`（或介面「新建專案」頁的「匯入交接包」）匯入後，名稱加進他的工作區名單，代理的工作階段清掉（屬於原本的電腦），可以直接 `resume`。
- 專案自己的名單在 `.studio/client-names.txt`：建立時的 `--private` 與規劃角色列出的名稱都會記在這裡，交接包靠它把名稱保護帶給接手的人。

## 元件資料庫（2026-10-05）

各站做設計、選型與成本表時共用的參考：元件的規格、歷次價格、供應商，以及哪些專案用過。用 Node 內建的 `node:sqlite`（Node.js 22.13 以上，沒有 npm 套件）。

- **資料庫檔只留本機，不進版控**（2026-10-05 拍板）：`studio/data/parts.db`，環境變數 `VS3D_PARTS_DB` 或 `--db <檔案>` 可以改位置。換電腦或給別人用時自己複製這個檔案。
- **介面**：`vs3d ui` 左上的「元件庫」（`#parts`）。「元件」分頁可以搜尋（空白分隔多個關鍵字，比對名稱、廠牌、型號、規格、自由規格欄位、專案、編號、供應商、報價來源）、依類別／專案／供應商篩選、新增、編輯、刪除；點一列開啟編輯面板，裡面逐列管理價格紀錄與專案使用紀錄。「供應商」分頁管理供應商主檔。刪除都要按兩次確認。
- **命令列**（代理與腳本查詢用，`--json` 輸出完整欄位）：

```powershell
node studio/vs3d.mjs parts search 相機 GigE --project RecycleSorter   # 查詢；不給關鍵字就列全部，--category 篩類別
node studio/vs3d.mjs parts show 132                                   # 單一元件的規格、價格紀錄、使用紀錄
node studio/vs3d.mjs parts seed [--dry-run]                           # 從各站 docs/ 的成本表匯入
node studio/vs3d.mjs parts merge <保留 id> <併入 id>                   # 合併重複的元件（價格與使用紀錄都移過去）
```

| 資料表 | 內容 |
|---|---|
| `parts` | 元件：類別、名稱、廠牌、型號／建議選型、規格、`attrs`（自由規格欄位，JSON）、單位、選型備註、替代方案、標籤、資料連結、備註 |
| `prices` | 價格紀錄，一個元件多筆：報價日、單價、幣別、等級（成本表的 A／B／C）、供應商、來源或報價單號、有效期限、備註 |
| `usages` | 專案使用紀錄：專案、來源檔、成本表編號、子系統、數量、選型理由、備註 |
| `suppliers` | 供應商：名稱、類型（原廠／代理商／經銷商／加工廠／網購）、聯絡窗口、電話、Email、網站、交期、付款條件、備註 |
| `part_latest` | 檢視表：元件＋報價日最新的一筆價格＋供應商（清單的「參考單價」就是它） |

**成本表匯入**（`parts seed`，`lib/parts-seed.mjs`）：讀 `project-site/<專案>/docs/*.xlsx` 裡表頭有「編號、項目或品項、單位」的工作表（各站的 `cost-estimate.xlsx`、回收物分揀的 `integration-cost.xlsx` 與 `vision-items.xlsx`）。

- 只匯採購品項：工程人日、工程類的列、選型只寫「自製」的一式項目不匯入（2026-10-05 拍板）；數量 0 的選配照樣匯入，使用紀錄標「選配」。
- 每一列變成一筆使用紀錄（專案、來源檔、編號）和一筆價格紀錄（報價日用成本表檔案的修改日，來源寫「專案 檔名 編號」）。同名同選型的列併成同一個元件；品項表「對應成本表」欄指到的列、規格寫「同 V-01」的列也併到那個元件。
- 可以重複執行：同一個專案、來源檔、編號已經有使用紀錄的列會跳過，介面上改過的內容不會被蓋掉。成本表改版後想重匯某一列，先在介面刪掉那筆使用紀錄。
- 類別與廠牌是從名稱與選型文字猜的，匯入後在介面上校正；成本表沒有供應商資料，供應商要自己建。文字裡出現 `.private/client-names.txt` 的用戶名稱會換成「（用戶）」。

**其他工具讀資料庫**：同一個檔案可以直接讀，例如成本表產生器（Python 內建 `sqlite3`）：

```python
import sqlite3
db = sqlite3.connect("studio/data/parts.db")
price, grade = db.execute("select unit_price, grade from part_latest where id = ?", (132,)).fetchone()
```

寫入請走介面或 `lib/partsdb.mjs`（有欄位驗證）。資料庫結構的版本記在 `PRAGMA user_version`，改結構時在 `partsdb.mjs` 加升級步驟。

## P4 第二段驗收（2026-10-04）

拿 P2 的 MGPC（Codex 版）與回收物分揀實際跑第二段，正式預設：規劃、審查 Claude opus，開發、修正、補強 Codex gpt-6-astra 高推理。代理的設計問題與最後的補強卡片由主 session 依建議項代答。前後對照截圖存在本機 `TEMP/seg2-accept/`。

| | 回收物分揀 | MGPC |
|---|---|---|
| 規劃（opus） | 3 輪 32 分、$10.8；問 4 題（電盤位置、相機數量、安全防護，畫光幕時發現 ISO 13855 安全距離不成立又追加 1 題） | 2 輪 31 分、$9.3；問 4 題（電盤位置、相機配置、現場 I/O、移動軸控制） |
| 開發（gpt-6） | 12 分：20 個元件、28 條櫃內連線、6 個接頭、雙相機子畫面、光幕示意 | 14 分：33 個元件、6 個接頭、地面線槽、移動軸拖鏈、3 台相機 |
| app 檢查 | 排程指紋擋下 1 次（架台外緣改到第一段的空間檢核）→ 修正後通過 | 一次通過；配線取樣 1,301 個時間點 |
| 審查（opus） | 2 次、$7.6；必修 1 項（光幕標牌少做） | 2 次、$9.5；必修 2 項（CSS 把相機視窗藏起來、升降架電纜懸空） |
| 補強 B（gpt-6） | 守門擋下 1 次（手機幀率 22.7 → 12.3 fps）→ 修正後 22.9 fps 通過 | 一次通過，三角面 +4% |
| 合計 | 約 70 分、Claude $18 | 約 75 分、Claude $19 |

- 排程指紋、效能預算、審查三道關都實際擋下過問題；審查抓到的都是檢查擋不住的「做了但沒照提案」（相機被藏、線懸空、標牌缺漏）。
- `names` 檢查在工作區擋下了 README 標題裡的用戶名稱，代理自己改成中性描述。
- 實測中修掉的 bug：代理在選項名稱自己寫「（建議）」時重複顯示；`vs3d answer` 可以覆寫已回答的問題（改成拒絕）。
- 回收物分揀的第二段成品已匯入本庫 `project-site/RecycleSorter/`；MGPC 是 P2 對照版，沒有匯入。

## P2 驗收（2026-10-04）

重做 MGPC 與快門組裝站的第一段，只給原始資料＋一段需求，代理的設計問題依現有拍板紀錄代答。6 次都在 app 的快速＋完整檢查第一次就通過；對照報告在本機 `TEMP/p2-report/index.html`。Claude 比較了 sonnet 與 opus；Codex 這邊因為 `~/.codex/config.toml` 預設就是 `gpt-6-astra` 高推理，原本規劃的「中階／高推理」其實是同一設定跑了三次，沒有比較到中階模型。重點：

- 檢查擋不住「做錯東西」：快門 × Claude sonnet 把葉片層序做反（拍板先小後大），MGPC × opus 顯示了第一段不該有的相機子畫面。P4b 的審查角色要比對「實作是否照已拍板事項與規則」。
- 成品與速度：Codex gpt-6 的成品最完整、代理時間約 22～30 分；Claude sonnet 兩站都偏弱（42～52 分），opus 介於中間（57 分，API 等值約 $22）。MGPC 的動作細節都比現有版本（347.75 s）簡化，Claude 只有 64～68 s。
- 規則遵守：Claude 兩次自己跑 ui／截圖，其中一次寫到工作區根目錄，由雜湊比對偵測；Codex 的沙箱在第一層就擋下寫入。
- 實測中修掉的 bug：`--model`／`--effort` 沒有保存，續接時退回預設（受影響的兩次已用正確設定重跑）。

## 代理 CLI 的實測重點（2026-10-04，Claude Code 2.1.266、codex-cli 0.154.0）

- Claude Code：`claude -p --output-format stream-json --verbose`，提示從 stdin 傳入；`result` 事件有 `session_id`、`num_turns`、`total_cost_usd`、`usage`；另有 `rate_limit_event`。`.claude/settings.json` 只從啟動資料夾讀取，寫檔關卡改用 `--settings <JSON>` 傳入，不必在專案裡放設定檔。Windows 上 Bash 工具的寫入攔不到，靠第 2、3 層。
- Codex：`codex exec --json -`；續接 `codex exec resume <id> -` 沒有 `-s`，改用 `-c sandbox_mode="workspace-write"`。Windows 原生沙箱**會擋下**工作目錄以外的寫入（PowerShell 回「拒絕存取」），但預設允許寫系統暫存目錄。Codex 只從 git 根目錄（專案）往下找 `AGENTS.md`，工作區規則由 app 放進提示。頂層的 `error` 事件多半是重新連線，只有 `turn.failed` 才算失敗。

## P1 實測（2026-10-04）

需求：「皮帶輸送帶把 100×100×50 mm 工件送到取放位，兩軸龍門用真空吸盤移到出料台，節拍約 10 秒，不需要電控與相機」。各角色用中階模型，代理的問題與提案確認都選建議選項。

| | Claude Code（sonnet） | Codex（帳號預設模型） |
|---|---|---|
| 規劃 | 5.2 分，問 2 題（循環方式、吸盤外觀） | 2.8 分，問 3 題（出料側、循環與清空、工件吸附條件） |
| 回答後續接規劃 | 39 s | 70 s |
| 開發第一段 | 17.8 分（97 turns） | 6.6 分 |
| 檢查 | 快速＋完整（ui 四尺寸）第一次就全過 | 同左 |
| 成品 | 沿用範本的滾筒輸送線與夾爪（依回答）；範本的相機子畫面沒拿掉 | 自建皮帶輸送帶（含馬達）、Ø40 吸盤、出料台；假設值都標「示意」；拿掉相機子畫面 |
| 越界 | 0 | 0 |

- 兩邊都第一次就通過檢查，**修正迴圈沒有在實測中跑到**（只用假代理測過）；P2 再觀察。
- 隔離自我測試：兩種代理都依規則**拒絕**用 shell 越界；`--simulate` 在真實工作區驗證了偵測與還原（core、其他專案自動還原，工作區根目錄的新檔只記錄）。
- 實測中修掉的問題：`--cli` 沒有保存（resume 換成另一個 CLI）、複合 Bash 指令被擋、同一工作區併行會互相還原（加執行鎖）。

## 測試

```powershell
node --test "studio/test/*.test.mjs"   # 不耗額度：事件解析、角色、提問、隔離、Office 抽取、元件資料庫，以及用假代理跑完整流程
node studio/test/parts-e2e.mjs          # 元件資料庫的介面測試（無頭 Chrome，約 10 秒；先建置前端）
```

`test/fixtures/` 是實際錄下、去掉本機資訊的兩種 CLI 事件；測試用的 Office 檔由 `test/office-fixtures.mjs` 在記憶體裡組出。
