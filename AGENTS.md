# 自動化設備 3D 展示 — 共通規則

這個庫原本是 `Python` 庫底下的 `TestCode/`，2026-10 搬成獨立庫（從頭開始，舊歷史留在原庫）。本檔是 Claude Code 與 Codex 共用的規則（`CLAUDE.md` 以 `@AGENTS.md` 引用），各站自己的規則在 `<專案>/AGENTS.md`。框架細節以 `core/README.md` 為準，改版紀錄在 `core/MIGRATION.md`，待辦事項在 `PENDING.md`。

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
- **3D 專案只需要 Node.js 22 以上**（開發機 24.21），沒有 npm 套件；three.js 放在 `core/vendor/`。瀏覽器檢查用 Chrome 或 Edge（可設 `CHROME_PATH`）。
- Python 3.12 ＋ `requirements.txt` 只給選用工具用（錄影稽核、電路圖、成本表）。
- Node 端跑 core 模組要加 `--import ./core/tools/register.mjs`（解析 `three` 與 `@core/`）。`core/tools/run.mjs` 會自動加上。
- Shell 是 Windows 上的 Git Bash 或 PowerShell 5.1。

## 結構

| 位置 | 內容 |
|---|---|
| `core/` | 共用框架（以 importmap `@core/` 引用）：geom（形狀、材質、五金、地面）、models（80 個參數化模型＋目錄頁：市購品一律放這裡——手臂、輸送與搬運、相機與視覺、氣動與運動、夾爪、指示與感測小件、實驗室與製程設備；各站換用的對照在 `core/migrations/`）、anim 的 sampling（取樣時間）、examples（第二段範例：電控、配線、相機；剛體動力學四種用途）、optics（光學計算 L1、打光與模擬影像 L2）、physics（剛體動力學，Rapier 決定性版）、robot（IK、手臂可達檢查）、anim（時間軸、步驟序列、到位閘門）、ui（stage、player、viewer-workspace）、electrical、movie、verify、template、tools；版本號在 `core/VERSION`，core 需求登記在 `core/REQUESTS.md` |
| `project-site/<專案>/` | 所有展示專案（之後新增的也放這裡）。`web/`（網站；`web/js/project.js` 是網頁與檢查共用的場景）、`project.json`（首頁說明、`coreVersion`、`checks.quick`／`checks.full`、`variants`、`ui`）、`tools/`（專案自有檢查）、`review/`（檢查結果，進版控）、`docs/`（只留本機）、`AGENTS.md`／`CLAUDE.md`（該站規則）、`.claude/settings.json`（寫檔關卡） |
| `tools/` | 跨專案工具：干涉回歸、跨站視覺檢查（`verify-vision.mjs`）、電路圖、錄影輸出（配線與電盤檢查已移到 core 的 `electrical`）；`bin/` 是各站共用的 ffmpeg／ffprobe（`setup.ps1 -Ffmpeg` 下載，不進版控） |
| `scripts/` | 腳本：`setup.ps1`（環境設定）、`start`／`stop`（`.ps1`＋可點兩下的 `.cmd`，網頁啟動與停止，PID 與輸出在 `logs/`）、`migrate/`（搬庫腳本） |
| `studio/` | 3D 動畫生成應用程式（從本庫啟動介面時也能對 `project-site/` 的站下指令：本庫模式，只提交該站路徑、每次開本機分支）：目前是 P1 命令列原型 `node studio/vs3d.mjs`（說明見 `studio/README.md`，測試 `node --test "studio/test/*.test.mjs"`）；計畫書在本機 `TEMP/3d-app-plan.md`；元件資料庫（介面「元件庫」、`vs3d parts`，SQLite 檔 `studio/data/studio.db` 只留本機） |
| `.githooks/` | pre-commit 範圍檢查 |
| `.github/workflows/` | `pages.yml`：PR 跑快速檢查；推送到 `main` 時快速檢查、建置、發布 Pages（只改 `studio/` 時不跑）。`scope.yml`：PR 範圍檢查 |
| `PENDING.md` | 待辦事項 |

8 個專案（都在 `project-site/`）：AutomaticAcid-BaseTitration（酸鹼滴定）、ChemicalTankWashing（200L 化學桶清洗線）、MilitaryGradePC（軍規筆電 QC 線）、PCB-CopperAssembly（散熱銅片植入）、RobotArmPressSSD（USB 接頭壓合）、shutter assembly（快門葉片組裝，資料夾名稱有空白）、WorkpieceMeasurement（杯體 AOI＋共焦量測）、RecycleSorter（回收物分揀，vs3d 產生後匯入）。

**新專案一律放在 `project-site/<專案>/`**（`new-project.mjs` 會自動放在這裡）。專案裡的 Node 工具往庫根目錄要寫 `../../core`、`../../tools`；網頁的 importmap 是網址相對路徑（`../core/`），不用改。

## 常用指令

```powershell
node core/tools/serve.mjs                         # http://127.0.0.1:8770/（首頁、/core/catalog/、/<專案>/）
node core/tools/check.mjs [專案…] [--quick] [--only 名稱]   # 統一檢查
node core/tools/ui-check.mjs <專案> --port <p> --shots TEMP/<資料夾>   # 四種尺寸互動測試＋截圖
node core/tools/shots.mjs [專案…] --out TEMP/<新> --compare TEMP/<基準> --port <p>   # 桌面截圖回歸
python core/tools/compare-review.py TEMP/<review 基準>   # review JSON 比對（忽略時間與雜湊）
node core/tools/new-project.mjs <資料夾> "<標題>" ["一句說明"]   # 由範本建立新專案（含規則檔與寫檔關卡）
node core/tools/export.mjs <專案> [--zip] [--html] [--mp4]   # 成品匯出到 TEMP/exports/：網站壓縮檔（雙擊離線開）、單一 HTML、MP4（全自動）
node core/tools/scene-dump.mjs <專案> --out TEMP/<檔>.json      # 場景傾印（每個網格、燈光、走線五金）；--diff <前> <後> 比對，換用 core 模型或改 core 前後各傾印一次
node core/tools/install-hooks.mjs                 # 安裝 pre-commit 範圍檢查（clone 後一次）
node core/tools/check-scope.mjs --scope <範圍> <路徑…>   # 手動檢查路徑是否在範圍內
node studio/vs3d.mjs parts search <關鍵字…> [--project 專案] [--json]   # 查元件資料庫：選型、單價、哪些專案用過（show <id> 看單一元件）
node --import ./core/tools/register.mjs tools/verify-interference.mjs   # 四站干涉回歸；配線與電盤檢查是 check.mjs 內建的 electrical
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
- **開發流程**：規格 → new-project → 盤點 core → project.js → 排程 → main.js 與 verify（可平行）→ check → 截圖 → commit → PR → Pages。
- **core 版本**：`core/VERSION` 用語意化版本；各專案 `project.json` 的 `coreVersion` 記錄最後一次驗證通過的 core 版本。core 有 API 或外觀改變時升版、記進 `core/MIGRATION.md`，各站驗證通過後再更新 `coreVersion`。

## 框架慣例（詳見 core/README.md「統一寫法」）

- **專案介面**：`project.js` 匯出 `createProject({ scene, ...params })`，回傳 `{ total, apply(t), layoutChecks?, verify }`。`verify` 包含 `skip`、`moduleOf`、`stationOf`、`allow`（必須寫原因）、`thresholds`、`envelope`。
- **形狀與材質**：`core/geom/shapes.js`、`materials.js` 的 `MAT`（含 `frame`、`chrome`）、`finished(MAT.alu, 'metal')`；地面用 `environment.js` 的 `floor()`。
- **排程**：
  - 單一手臂用 `createStepSequence`：`discrete`、`latch`、`nested`、`ease`／`easeKeys`、`peek`、`mark`／`rollback`、`retime`。
  - 多台並行用 `createTimeline`：`Track.at`、`stationStart`。
  - 兩者都提供 `events`、`stationStart`、`total`。
- **播放列**：`createPlayer({ apply(T,{seek,dt}), advance, maxStep, onChange(T,s,{seek}), loop })`。手臂要等到位的站用 `createArrivalGate`（`core/anim/arrival.js`），規則 `ARRIVAL` 放在該站的 `sequence.js`，網頁和 `tools/verify.mjs` 共用。
- **舞台**：
  - `createStage({ look: 'cell'|'plant'|'studio', extent? })`。
  - `addLabel(html, pos, cls, { anchor, priority })`。
  - `goTo(p, t, instant, dur, { fit })`、`cancelTween`、`shiftView`。
  - 窄畫布會自動拉遠（`narrowFit`），霧與 maxDistance 一起放大；精簡版面時標籤自動避讓（`declutter`）。
  - 視角可以回傳 `[位置, 注視點, { fit }]`。
- **版面**：骨架固定為 `#topbar`（`.brand`、`#stations`、`.views`）、`#side`／`#left`、`#bottombar`，並呼叫 `createViewerWorkspace`。
  - 精簡版面的觸發條件：≤900 px、觸控平板 ≤1100 px、橫向手機。
  - 精簡版面的操作：☰ 開製程與視角、⚙ 開播放設定、工具列開側欄。抽屜開啟時，`uncover` 會讓出畫面。
  - 專案 CSS 不要再寫隱藏或縮小這些區塊的窄螢幕規則。
- `window.sim` 用 `exposeSim(...)`；錄影在 `?movie` 時呼叫 `installMovie`。每頁都要連 `../core/favicon.svg`。
- **場景與成本表一致**（2026-10-06 拍板，評估平台 Q9）：市購品在成本表一律引用元件編號；3D 一律優先用 core 模型，元件庫有的用 `fromPart('P-xxxxx')`（`core/models/parts.js`）建立並帶 `partRef`，自己畫的用 `tagPart` 標編號，現場既有、不採購的設備標 `userData.noBom`；`bom` 檢查列出落差（只警告）。core 沒有的模型照現行流程先在站裡暫代並登記 `core/REQUESTS.md`。
- **共用功能優先放 core**：專案內發現可共用的寫法，先在專案暫代，再搬進 core，然後各站改用。
- **共用的東西不放在某一站的資料夾**（2026-10-05 拍板）：多站會用到的執行檔（ffmpeg／ffprobe 在 `tools/bin/`）、跨站的檢查與工具放根目錄 `tools/`；站的 `tools/` 只放該站自己的檢查與產生器。

## 檢查與回歸的做法

- **`check.mjs` 內建項目**：`imports`、`structure`、`names`、`determinism`、`layout`、`scene`（干涉＋閃爍，部署前也會擋）、`ui`（只在完整檢查跑；平行執行時設 `UI_PORT`），再加上 `project.json` 列的自有檢查。core 本身另有 `models` 檢查。
- **改 core 或渲染時**：
  1. 先拍基準：`git worktree add <暫存資料夾> HEAD`，在 worktree 裡跑 `shots.mjs --out TEMP/shots-<名>-base`，用完 `git worktree remove`。
  2. 改完比對：7 站桌面截圖要 0 張超過門檻。刻意的外觀改變要逐張看過，並記進 `core/MIGRATION.md`。
- **review JSON**：只有時間戳、`seconds`、`generated` 改變的，提交前先還原。有實質內容變化的才提交。根目錄 `tools/review/*.json` 的 sourceHash 會隨程式改變，連同程式一起提交。
- **allow 規則**：必須窄，而且要寫原因；不能用 allow 蓋掉真問題。看到「0 筆干涉」時要先確認規則本身沒有放水。過去 `bodyOf` 為 null 時 `null===null` 讓固定件之間全部放行，修正後抓到大量真問題。
- **換用 core 模型時三樣都要比**：快速檢查的數字、桌面截圖、`scene-dump.mjs --diff`（逐網格與走線五金）。夾具改釘到別處不會報錯、截圖也可能低於門檻（1.9.0 那一批 SSD 的兩支夾腳就是這樣漏掉的）。
- **core 模型的 `userData` 標記**：模型 root 標 `coreModel`，走線（`cable()`）與干涉檢查（`mountedOn`）會把它當成透明的包裝；可動子群組標 `coreModelPart`；不能當線夾固定面的標 `cableHost = false`。站裡設 `userData` 用 `Object.assign`，不要整個換掉。
- 閃爍的根因通常是重合面，對數深度緩衝解決不了，要改幾何。
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
- **`export { X } from '…'` 不會建立本地綁定**：本檔要用的話，先 import 再 export。
- **化學桶用按需重繪（onDemand）**：狀態改變要 `invalidate`。標籤等每格的量測不能依賴下一格補正。
- **GitHub API 未登入每小時只能呼叫 60 次**：監看 Actions 時輪詢間隔至少 30 秒。
- **review JSON 不要寫入耗時**：`run.mjs` 已經拿掉 `seconds`，否則每次跑檢查都會產生差異。
- **Windows 的 casadi＋nlopt**：import cadquery 後 python.exe 結束時可能崩潰。之後做 STEP 轉換時要注意，解法是替換 nlopt。

## 框架的使用者拍板紀錄

- 4 輪統一：P0～P7、第二輪、精進輪、第四輪。第四輪內容是到位閘門、小螢幕、look 加地面、ui-check、favicon。
- `extent` 推算的燈位對不上各站手調的值，所以各站只用 `look` 省掉配色設定。
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
- 各站的拍板紀錄在各站的 `AGENTS.md`。
