# 自動化設備 3D 展示 — 共通規則

這個庫原本是 `Python` 庫底下的 `TestCode/`，2026-10 搬成獨立庫（從頭開始，舊歷史留在原庫）。本檔是 Claude Code 與 Codex 共用的規則（`CLAUDE.md` 以 `@AGENTS.md` 引用），各站自己的規則在 `<專案>/AGENTS.md`。**實作站一律照 `core/SITE-RULES.md`**，框架細節以 `core/README.md` 為準，改版紀錄在 `core/MIGRATION.md`，待辦事項在 `PENDING.md`。

## 與使用者合作的方式

- **語言**：一律用繁體中文（台灣用語）回覆。程式碼、指令、檔名保持英文；程式註解用繁體中文；commit 訊息用英文。
- **要拍板的事用選項對話**：設計取捨、方案選擇都整理成 1～4 題、每題 2～4 個選項，推薦項放第一並標「（建議）」。有合理預設值的小事不必問。
- **提交與推送**：階段完成、檢查通過就直接 commit，不必問。**推送只在使用者要求時才做**；推送到 `main` 會觸發 Pages 檢查與發布。
- **不進版控**：各專案 `docs/`（使用者給的圖面、照片、影片、規劃與成本資料）、`TEMP/`、`question_log.txt`、ffmpeg 執行檔、元件資料庫 `studio/data/`。`.gitignore` 的 `/project-site/*/docs/` 已涵蓋新專案。
- **使用者自己也會改檔、提交**：改檔前先看 `git status`。有未提交改動的檔案**絕對不要** `git checkout`／`restore`／`stash`（曾經這樣弄丟過工作，只能事後重做）。
- 使用者要求「先討論不改」時，只討論、不動檔案。
- **不得顯示用戶名稱**（2026-10-04 拍板，所有代理都要遵守）：任何子專案的網頁、標籤、`project.json`、README、`AGENTS.md`、程式註解、review、commit 訊息都不得出現用戶（客戶）名稱，即使評估文件或提示詞裡有；改用中性描述（例如「回收物自動分揀展示機」）。名單只放本機 `.private/client-names.txt`（不進版控，一行一個）；`check.mjs` 的 `names` 檢查與 pre-commit 會擋。新案匯入或產生後，先把用戶名稱加進名單再檢查。設備廠牌與零件供應商（例如手臂型號）不算用戶名稱。
- **待辦事項一律記在根目錄的 `PENDING.md`**（進版控），包括規劃中的工作、待使用者提供或待現場確認的事。完成就打勾或刪掉。規則檔（AGENTS.md、CLAUDE.md）只記已經拍板的事和慣例，不放待辦。

## 環境

- 安裝：`powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 [-All]`（會一併安裝 git hook），需求見 `REQUIREMENTS.md`。
- 啟動網頁：`scripts\start.cmd`（不帶參數只開 vs3d 介面 8780；`-Site` 展示網站 8770、`-All` 兩個都開、`-Station <名稱>` 開某一站），停止：`scripts\stop.cmd`。腳本一律放在 `scripts/`，`.ps1` 存成 UTF-8 BOM。
- **3D 專案只需要 Node.js 22 以上**（開發機 26.13.0），沒有 npm 套件；three.js（r187）、Rapier、MuJoCo 等放在 `core/vendor/`。瀏覽器檢查用 Chrome 或 Edge（可設 `CHROME_PATH`）。
- Python 3.14（一般版，不要 `3.14t`）＋ `requirements.txt` 只給選用工具用（錄影稽核、電路圖、視覺採購品項表、pvlib 交叉驗證）；成本表已改在 3D工作室平台維護與匯出。
- Node 端跑 core 模組要加 `--import ./core/tools/register.mjs`（解析 `three` 與 `@core/`）。`core/tools/run.mjs` 會自動加上。
- Shell 是 Windows 上的 Git Bash 或 PowerShell 5.1。
- **與 AutoSequence 同機開發時，整機 CPU 不得超過 80%**（使用者 2026-10-21 要求）：完整檢查、`shots.mjs`、`scene-dump.mjs`、`ui-check.mjs`、長時間的鎖步聯調經 `powershell -NoProfile -File "D:\Working Space\AutoSequence\temp\cpu-cap.ps1" -Percent 50 -Command "<指令>"` 執行（所有包裝行程共用一個上限；`-Command` 一次只放一個指令，不要用 `;` 串接），重工作一次只跑一個。找不到 `cpu-cap.ps1` 時先問，不要改寫 AutoSequence 的檔案。

## 結構

| 位置 | 內容 |
|---|---|
| `core/` | 共用框架（以 importmap `@core/` 引用）：geom（形狀、材質、五金、地面）、models（85 個參數化模型＋目錄頁：市購品一律放這裡——手臂、輸送與搬運、相機與視覺、氣動與運動、夾爪、指示與感測小件、實驗室與製程設備、光伏；各站換用的對照在 `core/migrations/`）、anim（時間軸、步驟序列、到位閘門、取樣時間）、examples（範例頁：第二段電控／配線／相機、物理、手臂動力學、日照、鋼構與管路、3D Tiles、天候、CFD）、optics（光學計算 L1、打光與模擬影像 L2）、physics（剛體 Rapier 決定性版、XPBD 線材與布料、PBF 粒子流體）、robot（IK、手臂可達檢查、MuJoCo 手臂動力學、負載估算）、solar（日照、追日、遮陰、全年發電）、geo（地形、GeoTIFF、LAS／LAZ、OBJ、3D Tiles）、structure、piping、weather、cfd（外部 CFD 結果讀檔與顯示）、math（決定性數學函式）、twin（AutoSequence 數位孿生的 SPE 端：Twin Protocol v2 server，2026-11-11 起為選配外接後端，說明在 `core/twin/README.md`）、ui（stage、player、viewer-workspace）、electrical、movie、verify、template、tools；版本號在 `core/VERSION`，core 需求登記在 `core/REQUESTS.md` |
| `project-site/<專案>/` | 所有展示專案（之後新增的也放這裡）。`web/`（網站；`web/js/project.js` 是網頁與檢查共用的場景）、`project.json`（首頁說明、`coreVersion`、`checks.quick`／`checks.full`、`variants`、`ui`）、`tools/`（專案自有檢查）、`review/`（檢查結果，進版控）、`docs/`（只留本機）、`AGENTS.md`／`CLAUDE.md`（該站規則）、`.claude/settings.json`（寫檔關卡） |
| `tools/` | 跨專案工具：干涉回歸、跨站視覺檢查（`verify-vision.mjs`）、外部 CFD（`cfd/`）、案場天候資料下載（`weather/fetch-tmy.mjs`，PVGIS）、`core/solar` 與 pvlib 交叉驗證（`solar-pvlib/`）、電路圖、錄影稽核與驗證（`movie-export`；MP4 輸出是 core 的 `export.mjs --mp4`；配線與電盤檢查已移到 core 的 `electrical`）；`bin/` 是各站共用的 ffmpeg／ffprobe（`setup.ps1 -Ffmpeg` 下載，不進版控） |
| `scripts/` | 腳本：`setup.ps1`（環境設定）、`start`／`stop`（`.ps1`＋可點兩下的 `.cmd`，網頁啟動與停止，PID 與輸出在 `logs/`）；搬庫腳本已在 2026-11-12 移除（搬庫 2026-10 完成，要看時從 git 歷史找） |
| `studio/` | 3D 動畫生成應用程式（從本庫啟動介面時也能對 `project-site/` 的站下指令：本庫模式，只提交該站路徑、每次開本機分支）：命令列 `node studio/vs3d.mjs`＋網頁介面 `vs3d ui`（第一段、第二段、審查補強、評估平台；說明見 `studio/README.md`，測試 `node --test "studio/test/*.test.mjs"`）；計畫書在本機 `TEMP/3d-app-plan.md`；元件資料庫（介面「元件庫」、`vs3d parts`，SQLite 檔 `studio/data/studio.db` 只留本機） |
| `.githooks/` | pre-commit 範圍檢查 |
| `.github/workflows/` | `pages.yml`：PR 跑快速檢查；推送到 `main` 時快速檢查、建置、發布 Pages（只改 `studio/` 時不跑）；快速檢查分 5 個工作平行跑（core 本身＋站分 4 組）。`scope.yml`：PR 範圍檢查 |
| `PENDING.md` | 待辦事項 |

14 個專案（都在 `project-site/`）：AutomaticAcid-BaseTitration（酸鹼滴定）、ChemicalTankWashing（200L 化學桶清洗＋填裝線）、MilitaryGradePC（軍規筆電 QC 線）、PCB-CopperAssembly（散熱銅片植入）、RobotArmPressSSD（USB 接頭壓合）、shutter assembly（快門葉片組裝，資料夾名稱有空白）、WorkpieceMeasurement（杯體 AOI＋共焦量測）、RecycleSorter（回收物分揀，vs3d 產生後匯入）、SolarDismantling（太陽能板拆框機器人上下料）、PlumbingFixtureInspection（水五金外觀 AOI）、WheelHangingAutomaticLine（輪框吊掛線手臂下掛）、ParkingEMS（停車場光儲充能源服務，三種場型）、StatorHeightMeasurement（定子轉子下料與高度檢測，四種量測方案）、TeflonWelding（襯 PTFE 桶內焊道自動焊接＋兆赫波檢測）。

**新專案一律放在 `project-site/<專案>/`**（`new-project.mjs` 會自動放在這裡）。專案裡的 Node 工具往庫根目錄要寫 `../../core`、`../../tools`；網頁的 importmap 是網址相對路徑（`../core/`），不用改。

## 常用指令

```powershell
node core/tools/serve.mjs                         # http://127.0.0.1:8770/（首頁、/core/catalog/、/<專案>/）
node core/tools/check.mjs [專案…] [--quick] [--only 名稱] [--core-only | --shard i/n]   # 統一檢查（--core-only 只跑 core 本身、--shard 每 n 站取 1 組，CI 用）
node core/tools/ui-check.mjs <專案> --port <p> --shots TEMP/<資料夾>   # 四種尺寸互動測試＋截圖
node core/tools/shots.mjs [專案…] --out TEMP/<新> --compare TEMP/<基準> --port <p>   # 桌面截圖回歸
python core/tools/compare-review.py TEMP/<review 基準>   # review JSON 比對（忽略時間與雜湊）
node core/tools/new-project.mjs <資料夾> "<標題>" ["一句說明"]   # 由範本建立新專案（含規則檔與寫檔關卡）
node core/tools/export.mjs <專案> [--zip] [--html] [--mp4]   # 成品匯出到 TEMP/exports/：網站壓縮檔（雙擊離線開）、單一 HTML、MP4（全自動）
node core/tools/twin.mjs <專案> --port 7600 --sse 8776      # 數位孿生 server（選配；AutoSequence Twin Hub 連入；網頁 ?twin=8776 觀看）；需要相鄰的 AutoSequence/schema（版本鎖在 core/twin/automation-schema.lock.json）
node core/tools/scene-dump.mjs <專案> --out TEMP/<檔>.json      # 場景傾印（每個網格、燈光、走線五金）；--diff <前> <後> 比對，換用 core 模型或改 core 前後各傾印一次
node core/tools/install-hooks.mjs                 # 安裝 pre-commit 範圍檢查（clone 後一次）
node core/tools/check-scope.mjs --scope <範圍> <路徑…>   # 手動檢查路徑是否在範圍內
node studio/vs3d.mjs parts search <關鍵字…> [--project 專案] [--json]   # 查元件資料庫：選型、單價、哪些專案用過（show <id> 看單一元件）
node tools/verify-interference.mjs [專案…]         # 四站干涉回歸；配線與電盤檢查是 check.mjs 內建的 electrical
```

## 範圍（子專案規則）

- **範圍**：各專案資料夾（`project-site/<專案>/`）、`core/`、根目錄 `tools/`、`studio/`，其餘根目錄檔案算 root。共用檔 `core/REQUESTS.md`、`PENDING.md` 任何範圍都可以改。
- **主 session**（從根目錄啟動）可以跨範圍；改 core 照「檢查與回歸的做法」。
- **子專案 session**（從 `project-site/<專案>/` 啟動的 Claude Code 或 Codex）只改自己的資料夾，加上根目錄 `TEMP/` 的暫存。
  - core 缺功能時，先在專案內暫代，並登記到 `core/REQUESTS.md`；由主 session 實作（基準截圖＋全專案檢查），再讓各站改用。
  - 要開 PR 時，分支名稱用 `<範圍>/<說明>`。專案名稱用小寫、空白換成 `-`，例如 `shutter-assembly/blade-detail`。
- **強制機制**（防誤改，不是防惡意；判定邏輯都在 `core/tools/check-scope.mjs`）：
  - **pre-commit**：在範圍資料夾（`project-site/<專案>/`、`core/`、`tools/`、`studio/`）內執行 `git commit` 時，只能提交該範圍的檔案；在根目錄提交不限制。
  - **PR CI**（`scope.yml`）：分支名稱是 `<範圍>/…` 時，只能改該範圍；其他分支名稱不限制。
  - **Claude Code 寫檔關卡**：各專案 `.claude/settings.json`（`node "$CLAUDE_PROJECT_DIR/../../core/tools/scope-guard.mjs"`） 的 PreToolUse 呼叫 `core/tools/scope-guard.mjs`，擋下寫到範圍外的 Write／Edit／MultiEdit／NotebookEdit。shell 指令擋不到，靠前兩項。
  - **Codex**：從專案資料夾啟動並用 `--sandbox workspace-write`。沙箱擋住共用檔時，把 core 需求或待辦寫在回報裡，由主 session 登記。
  - **其他代理工具**：Gemini CLI 讀 `GEMINI.md`、GitHub Copilot 讀 `.github/copilot-instructions.md`，兩者都只指向本檔。不管用哪個工具，最後都要過 pre-commit（用戶名稱、結構、範圍）與 PR CI。
  - **結構檢查**（`check.mjs` 內建 `structure`，pre-commit 也查這次提交到的站）：站要有 `project.json`（`title`、`summary`、`coreVersion`）、`AGENTS.md`、`CLAUDE.md`、寫檔關卡，`docs/` 不進版控，網頁連 favicon、importmap 用 `@core/`。手動建的資料夾通常過不了，**新站一律用 `new-project.mjs` 建立**。
- **各站規則**：規格摘要與已拍板事項放在 `project-site/<專案>/AGENTS.md`（同資料夾的 `CLAUDE.md` 只有 `@AGENTS.md`）。新專案由 `new-project.mjs` 從範本帶出這些檔案。
- **開發流程**：規格 → new-project → 盤點 core 與元件庫 → project.js → 排程 → main.js 與 verify（可平行）→ check → 截圖 → 評估簡報（新站）→ commit → PR → Pages。每一步的做法與完成定義見 `core/SITE-RULES.md`。
- **core 版本**：`core/VERSION` 用語意化版本；各專案 `project.json` 的 `coreVersion` 記錄最後一次驗證通過的 core 版本。core 有 API 或外觀改變時升版、記進 `core/MIGRATION.md`，各站驗證通過後再更新 `coreVersion`。

## 實作站的規範

- **實作或修改任何站，一律照 [`core/SITE-RULES.md`](core/SITE-RULES.md)**：閱讀順序、開工步驟、實作規則、完成定義、新站的評估簡報，以及各工具（Claude Code、Codex、平行代理、3D工作室）的差異。VS Code 的 Claude Code 可以用 `/site` skill 照著走。API 的寫法在 [`core/README.md`](core/README.md)「統一寫法」。規則只維護這兩份，其他文件（本檔、站的 `AGENTS.md`、studio 的工作區規則、`GEMINI.md`、copilot 說明）都只放連結，不另外抄一份。
- **場景與成本表一致**（2026-10-06 拍板，評估平台 Q9）：寫法見 `core/SITE-RULES.md`「模型、材質與成本一致」；新站（`project.json` 的 `"strict": true`）的 `bom` 落差會擋，舊站只警告。
- **共用功能優先放 core**：專案內發現可共用的寫法，先在專案暫代，再搬進 core，然後各站改用。
- **共用的東西不放在某一站的資料夾**（2026-10-05 拍板）：多站會用到的執行檔（ffmpeg／ffprobe 在 `tools/bin/`）、跨站的檢查與工具放根目錄 `tools/`；站的 `tools/` 只放該站自己的檢查與產生器。

## 檢查與回歸的做法

- **`check.mjs` 內建項目**：`imports`、`structure`、`names`、`determinism`、`layout`、`scene`（干涉＋閃爍，部署前也會擋）、`electrical`（配線與電盤）、`physics`（剛體、線材、布料、流體的烘焙）、`bom`（場景 ↔ 平台 BOM，只警告）、`solar`（`verify.solar` 的冬至列間遮陰與對照組）、`dynamics`（`verify.dynamics` 的手臂峰值扭矩與負載力矩，只警告）、`ui`（只在完整檢查跑；平行執行時設 `UI_PORT`），再加上 `project.json` 列的自有檢查。core 本身另有 `models`、`physics`、`dynamics`、`solar`（Node 與瀏覽器雜湊）、`engineering`、`examples`、`twin`、`structure`、`names` 檢查（不指定專案時才跑）。
- **改 core 或渲染時**：
  1. 先拍基準：`git worktree add <暫存資料夾> HEAD`，在 worktree 裡跑 `shots.mjs --out TEMP/shots-<名>-base`，用完 `git worktree remove`。
  2. 改完比對：全部站的桌面截圖要 0 張超過門檻（`shots.mjs` 不指定專案就是全部）。刻意的外觀改變要逐張看過，並記進 `core/MIGRATION.md`。
- **review JSON**：只有時間戳、`seconds`、`generated` 改變的，提交前先還原。有實質內容變化的才提交。根目錄 `tools/review/*.json` 的 sourceHash 會隨程式改變，連同程式一起提交。
- 站層級的檢查規則（allow 要窄、換用 core 模型三樣都要比、`userData` 標記、閃爍改幾何）在 `core/SITE-RULES.md`「檢查規則不放水」。
- 完整檢查（全部專案）要數十分鐘，MGPC 的 scene 約 90 秒，可以放到背景執行。

## 平行代理的慣例（主 session 派出的代理）

- 主 session 派出的代理在根目錄執行，不受寫檔關卡限制，靠以下約定：
- 每站只派一個代理，**代理只改自己那站**加上 `TEMP/<簡稱>*`；core 由主 session 修改。
- 每個代理分配不同的 port 區段（避開 8770、8771、8790），`UI_PORT` 與 `shots --port` 也要錯開。
- 代理不 commit、不 checkout。主 session 審過回報後，重新產生 `ui-check.json`、還原只有時間戳變動的 review，再逐站提交。
- 代理提出的 core 建議，由主 session 判斷後統一實作，再讓各站改用。

## 踩過的坑

- **Git Bash heredoc 會吃掉 `\n`、`\t`、`\\`**：含反斜線的內容用 Write／Edit 工具寫。經 heredoc 交給 Python 的替換字串也可能出錯，寫完要檢查結果。
- **PowerShell 5.1 讀沒有 BOM 的 UTF-8 腳本會變亂碼**：`.ps1` 一律存成 UTF-8 BOM。
- **化學桶用按需重繪（onDemand）**：狀態改變要 `invalidate`。標籤等每格的量測不能依賴下一格補正。
- **GitHub API 未登入每小時只能呼叫 60 次**：監看 Actions 時輪詢間隔至少 30 秒。
- **review JSON 不要寫入耗時**：`run.mjs` 已經拿掉 `seconds`，否則每次跑檢查都會產生差異。
- **Windows 的 casadi＋nlopt**：import cadquery 後 python.exe 結束時可能崩潰。之後做 STEP 轉換時要注意，解法是替換 nlopt。

## 框架的使用者拍板紀錄

- 4 輪統一：P0～P7、第二輪、精進輪、第四輪。第四輪內容是到位閘門、小螢幕、look 加地面、ui-check、favicon。
- `extent` 推算的燈位對不上各站手調的值，所以各站只用 `look` 省掉配色設定。
- 3D 動畫生成應用程式（studio，2026-10-04；計畫書在本機 `TEMP/3d-app-plan.md`）：
  - 給公司內部同事用，Claude Code 與 Codex 並行；介面是網頁版（`vs3d ui`，本機 127.0.0.1，`scripts\start.cmd` 啟動），不做 Electron 桌面外殼；前端 React＋Vite，npm 套件只放在 `studio/ui/`（core 與各站仍然沒有套件）。
  - 角色依段落指派模型（`studio/lib/roles.mjs`）：規劃、開發、修正、審查預設 Claude opus，渲染與細節補強預設 Codex gpt-6-astra（high）；第二段（電控、電盤、配線、相機）的開發與修正預設 Codex gpt-6-astra，審查維持 opus；元件補全 `enrich` 用 sonnet。
  - 流程：第一段完成後審查、補強、守門檢查全自動，只在最後停下看前後對照（接受／要調整／整批還原）；審查的必修項（違反拍板或規則）自動送修正，建議補強才給使用者。第二段先規劃成 `.studio/plan/segment2.md`＋`segment2.json`，卡片確認後才開發，不能改第一段的排程指紋。手機幀率預算是「不低於補強前的 80%」，30 fps 只當提示。
  - 上傳檔只留本機；成品可匯出網站壓縮檔、單一 HTML（超過 15 MB 時提示改用壓縮檔或內部發布）、MP4；同事之間用專案交接包；core 自動升級並自動驗證。STEP 輸入做成 Python＋OCP 的選用元件。
  - 一般工作區的每個專案各自一個 git 庫；寫入隔離採多層防護（CLI 關卡＋唯讀屬性、每輪雜湊比對＋`check-scope`、偵測到越界就自動還原）。
  - 本庫模式：代理在使用者的工作目錄改檔，不得執行 `checkout`／`restore`／`stash`／`reset --hard`／`clean`，改用逐檔寫回；遇到併改就停下提問；每次開本機分支，只提交該站的路徑。
- 元件資料庫（2026-10-05）：SQLite（`node:sqlite`），元件＋價格紀錄＋專案使用紀錄＋供應商；資料庫檔只留本機、不進版控。各站做設計、選型、成本表時先查資料庫（`vs3d parts search`，用元件編號 `P-xxxxx` 引用），確定的選型與報價在介面「元件庫」補回去。元件用分類樹分類（2026-10-06 起由使用者自訂，見下方「自動化專案評估平台」）。vs3d 的代理另外會拿到一份清單（每次執行前寫到專案的 `.studio/parts-catalog.md`），規劃與選型時先查、沿用的寫出編號。說明在 `studio/README.md`「元件資料庫」。
- studio 介面（2026-10-05）：配色只用綠與白（和 Excel 相同的綠 `#217346`），不做淺色／深色切換；左上角名稱「3D工作室」；本庫 `project-site/` 的站集中在「本庫的站」那一頁，不放在左邊的專案清單。
- studio 帳號（2026-10-05）：「用戶管理」指的是介面的登入帳號與權限（管理者／一般／唯讀），不是客戶名單；沒有帳號時不用登入，帳號資料只留本機 `studio/data/`。
- 元件資料庫補充（2026-10-05）：元件編號用流水號 `P-00132`（不含分類、不可改、不重用）；3D 顯示只連 core 共用模型；新案子的元件在提案確認後自動匯入，新元件標「待確認」。
- 自動化專案評估平台（2026-10-06，計畫書在本機 `TEMP/assessment-platform-plan.md`，待辦在 `PENDING.md` 第 3 節）：studio 擴充成評估平台，名稱維持「3D工作室」。
  - 部署：區網中央主機，元件庫與評估資料只有一份；代理都在主機上執行（代理佇列）。
  - **代理認證**：開發機上訂閱帳號與 API 金鑰（Anthropic、OpenAI）可以切換；**打包部署時拿掉訂閱帳號功能，只用 API 金鑰**，避免違反訂閱方案的條款。
  - 專案組成三項可選：評估＋成本、3D 動畫、AOI。可行性分析、AOI 方案、BOM 與成本表只存在資料庫，使用者在介面匯出時才產生檔案。
  - 元件有版本：影響選型或成本的欄位儲存就升版；專案 BOM 鎖定使用當時的版本，元件更新不會改變專案成本，平台提示新版並做差異比較，可以逐行或全部升級（升級前自動留快照）。
  - 元件分類樹由使用者自訂（不限層，介面最多 4 層，子分類繼承欄位範本）；關聯件（組成、配件、替代、相容）與模組元件。附件上限依類型在系統設定調整（一般 20 MB、CAD 300 MB）。成本表 xlsx 用純 Node 產生。
  - 光學模擬第一版做 L1 計算＋L2 幾何打光與近似模擬影像（`core/optics/`）；AI 補全元件資料的 `enrich` 角色是唯一可以上網的角色，結果逐欄審核。
  - core 加入剛體動力學：Rapier 決定性版放 `core/vendor/`，預先模擬、烘焙成軌跡，`apply(t)` 只取樣；用途是物料流、掉落與投料、料箱堆積、夾取穩定，現有站不強制改用。
- AutoSequence 數位孿生（2026-10-21／22，開發計畫在本機 `TEMP/AutoSequence孿生_SPE開發計畫_v0.2.md`）：
  - SPE 是 Twin Protocol v2 的 server（`core/twin`＋`core/tools/twin.mjs`），時間主控只有 AutoSequence 的 Hub；鎖步只依 tick 推進、不讀掛鐘，孿生路徑不經過時間軸的 `apply(t)`。示範站是 MilitaryGradePC。
  - 孿生用 schema 執行時讀相鄰的 repo，**不複製進 SPE**（專有授權；特別是會發布的 `core/vendor/`）；要求的版本鎖在 `core/twin/automation-schema.lock.json`，不符就拒絕啟動。CI 沒有它時，需要它的檢查明確印「略過」（不算通過）；換機器時 `setup.ps1` 只檢查並提示、不自動 clone。
  - 範例 MD 可以進 SPE 版控（`project-site/MilitaryGradePC/twin/`，從 tag 原樣取出、記 `SOURCE.md`，不得手改）；場景綁定用 MD 的邏輯路徑，由站的 `web/js/twin-binding.js` 對照。
  - 協定的 6 項釐清（error 位置、bye 回應、bindings 計數、sensorStuck 對 io-、followingError 門檻、commLoss 對 PLC 設備）照 preview.3；其餘待決事項採計畫書的建議。交付標籤一律 Simulation Validated。
- AutoSequence 改自建孿生（2026-11-11，AutoSequence 的告知在本機 `TEMP/AutoSequence數位孿生決定_2026-11-11.md`；SPE 端選項由使用者定案）：
  - AutoSequence 以內建物理後端（MuJoCo 原生函式庫）自建數位孿生，SPE 降為**選配外接**後端；AutoSequence 不再依賴 SPE。SPE 的 `core/twin` **保留並持續維護**（照常修錯、跟 Twin Protocol），但聯調、TWIN-AC 端對端驗收、由站產生 MD（S4）都結案不做。
  - 孿生用 schema 改讀相鄰的 **AutoSequence repo 的 `schema/`**（預設 `..\AutoSequence\schema`，環境變數名稱沿用 `SPE_AUTOMATION_SCHEMA`），不再讀 Automation-Schema repo。**只鎖協定**：lock 檔記 RELEASE 與 twin-protocol、machine-description、common 三個 v2 schema 的雜湊；AutoSequence 新增其他 schema 或改產生碼不擋，產生碼行為的變化由 core 的 twin 檢查把關；協定或 MD schema 改了要先確認相容再 `twin-schema.mjs --write-lock`。
  - MD 2.2 起，軸、致動器、機器人、感測器、設備的物理與場景欄位歸 AutoSequence、由它的孿生寫回。SPE 只讀 MD；若之後要寫回或產生 MD，必須避開這些欄位。
  - 聯調回饋 P1～P4 全修（core 1.21.0）；初始狀態改為 PLC 全部 DO OFF 的穩態（單線圈與無電磁閥的致動器從 `states[0]` 開始）。
- 開發機搬遷與環境（2026-11-07）：開發機 Node 26.13.0、Python 3.14（一般版，不用 3.14t）；CI 改用 Node 26，最低需求仍寫 22；選用的 Python 套件（含 TEMP 腳本用的 ezdxf、matplotlib、python-pptx、xlsxwriter、lxml）都列在 `requirements.txt`；PV DEMO 站移除。
- 物理模擬擴充（2026-11-07）：
  - 剛體維持 Rapier 決定性版（JS 版最新就是 0.21.0，Rust crate 的 0.3x 是另一套版號）。
  - 線材、軟管用自寫的 XPBD（`core/physics/rope.js`，core 1.17.0），不加套件；軟體、布料之後用同一套 XPBD 延伸，不用 Jolt（預編版沒有跨平台決定性）。
  - 手臂動力學導入 MuJoCo（官方 `@mujoco/mujoco`，Apache-2.0，放 `core/vendor/mujoco/`，用單執行緒版與瘦身後的 wasm）；原型與評估在本機 `TEMP/mujoco-proto/`。
  - 流體：管路用 1D 管網水力，畫面用 CPU 預先烘焙的粒子；另接外部 CFD（OpenFOAM，GPL，只當外部離線程式、不內嵌，結果匯入顯示）。
- 太陽能案場平台（2026-11-07，評估在本機 `TEMP/太陽能案場平台評估_2026-11-07.md`，工作項目在 `PENDING.md` 第 5 節）：
  - 第一階段四項都做：日照遮陰與發電（`core/solar`）、地形與空拍匯入（`core/geo`）、參數化鋼構與管路（`core/structure`、`core/piping`）、天候與流體軟體（雪、雨、風載重、粒子流體、XPBD 軟體）。
  - three.js 從 r160 直接升級（照「改 core 或渲染時」的流程，全部站回歸）。
  - 空拍只匯入標準格式（GeoTIFF、LAS/LAZ、OBJ、3D Tiles）；照片處理交給外部的 OpenDroneMap（AGPL，獨立程序）或商用軟體，平台不內建。
  - 高精度門檻（2026-11-07 第二輪）：平面 ±50 mm、高程 ±30 mm、太陽位置 ±0.01°（以太陽方向夾角量）、全年發電和 pvlib 相差 < 2%；常數在 `core/solar/precision.js`，檢查與測試一律引用它。
- 手臂動力學的負載（2026-11-07 第二輪）：從站的 3D 工具模型估（`core/robot/payload.js` 的 `estimatePayload`：體積 × 密度，金屬當鋁、其他當塑膠），不再手填；有實際重量時在模型上標 `userData.mass`／`density`。
- 依建議持續開發（2026-11-08，使用者授權「遇到問題採用你的建議」）：core 模型不加 `cableHost` 選項（站裡一行 `root.userData.cableHost = false`）；天候資料先用 PVGIS（見 `tools/weather/README.md`）；截圖回歸的視角清單改讀頁面的 `window.sim.views`。
- 3D工作室生成品質（2026-11-07）：開發後多一輪看截圖自我檢查（`studio.json` 的 `selfReview`，2026-11-14 起預設 2，代理也能用 `snap.mjs` 隨時看畫面）、本庫的站當唯讀參考（`references`，自動挑 2 個；站的 `docs/`、`.studio/`、`TEMP/` 不給讀）、Claude 角色預設 `--effort high`；補強角色維持 Codex。
- 站實作規範與 3D工作室的存放位置（2026-11-14）：
  - 「實作一個站」的規則只維護 `core/SITE-RULES.md`（閱讀順序、開工、實作規則、完成定義、評估簡報、各工具差異）＋`core/README.md`（API）；其他代理會讀的文件只放連結。VS Code 端另有 `/site` skill（`.claude/skills/site/`）照規範帶流程。
  - **開發機上 3D工作室直接在本庫 `project-site/` 建站**（本庫模式的 `new`：保留範本的規則檔與寫檔關卡、不另建 git 庫、在本機分支 `<站>/vs3d-…` 只提交該站）；`Documents\3D-Studio` 工作區**只有部署版**建立與使用，啟動時發現工作區的 core 比 app 舊就自動更新。原本開發機上的空工作區已刪除。
  - 機械檢查：`structure` 要求站 `AGENTS.md` 的「規格摘要」不是空的；新站在 `project.json` 標 `"strict": true`，`bom` 落差改成擋下（舊站維持只警告）。
  - 新站的完成定義加上可行性評估與成本分析：開發機自動產生公司樣板的評估簡報 pptx＋成本表 xlsx 到站的 `docs/assessment/`（不進版控）；部署版維持 2026-10-06 的「下載時才產生、不留在主機」。公司樣板只留本機（自動找 `zq-work-deck` skill，或 `VS3D_DECK_KIT`），不進版控。只有新站必做，既有站不補。
- 3D工作室對齊 VS Code 的 Claude 能力（2026-11-14 第二輪，選項對話）：這輪做 A 看畫面再修（`core/tools/snap.mjs`，自我檢查預設 2 次）、B 對話式修改、C CAD／圖面輸入預處理（STEP、DXF）、D 規劃角色可上網查規格（限制見 `studio/README.md`）、E 同步白名單 skills 到代理設定目錄、F core 缺功能自動登記、G 評估簡報逐頁目視檢查、I 審查必修項累積成「常見錯誤」清單；H（worktree 平行執行、自動開 PR）這輪不做。
- 各站的拍板紀錄在各站的 `AGENTS.md`。
