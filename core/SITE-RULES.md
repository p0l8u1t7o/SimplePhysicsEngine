# 站實作規範

本檔是「實作一個展示站」的單一規範。凡是建立或修改 `project-site/<站>/`（studio 部署版工作區是 `projects/<專案>/`）的代理都要遵守，不論用哪種工具：

- VS Code 或終端機裡的 Claude Code、Codex，從根目錄或從站資料夾啟動都一樣；
- 3D工作室（vs3d）派出的規劃、開發、修正、審查、補強代理。

API 的寫法以 [`core/README.md`](README.md) 為準，本檔只寫做事的步驟、必須遵守的規則與完成定義。工具之間只有「怎麼問使用者」「誰跑完整檢查」「誰 commit」三件事不同，見最後一節。

## 閱讀順序

1. 站的 `AGENTS.md`：規格摘要、已拍板事項（使用者決定的事，不要改，也不要重問）。
2. 本檔。
3. [`core/README.md`](README.md)：目錄、`project.json`、`project.js` 介面、共用模型、舞台、「統一寫法」、檢查。
4. 依需要再讀：第二段（電控、電盤、配線、相機）讀 [`examples/segment2/README.md`](examples/segment2/README.md)；物理讀 [`physics/README.md`](physics/README.md)；光學讀 [`optics/README.md`](optics/README.md)；換用 core 模型讀 [`migrations/`](migrations/)。
5. 站的 `docs/`：使用者給的圖面、照片、規格（只留本機）。Office、DXF、STEP 檔看同資料夾的 `<檔名>.extract/`（`text.md`＋圖片；DXF 有預覽圖與尺寸、文字清單，STEP 有外形與零件尺寸）。還沒抽取的用 `node studio/vs3d.mjs extract "<站>" --repo` 產生。

## 開工（每次動手前）

1. **確認範圍**：只改自己這一站，加上根目錄 `TEMP/` 的暫存檔。`core/` 由主 session 負責；core 缺功能時，先在站裡暫代，並登記到 `core/REQUESTS.md`（3D工作室的代理改寫站的 `.studio/core-requests.json`，由 app 每輪結束後代為登記）。
2. **不清楚就問，不要猜**：站位、設備選型、節拍、規格不明，或會影響之後很多工作的取捨，整理成 1～4 題、每題 2～4 個選項，建議的選項放第一個。有合理預設值的小事自己決定，事後說明。
3. **盤點 core 模型**：市購品（手臂、輸送、相機與光源、氣動、夾爪、感測器、三色燈、HMI、實驗室設備、光伏…）先在 `core/models/index.js` 或目錄頁 `/core/catalog/` 找。有現成模型就用，**不要在站裡重畫**；沒有的話在站裡暫代，並登記到 `core/REQUESTS.md`。
4. **查元件庫**：選型前先查 `node studio/vs3d.mjs parts search <關鍵字…>`（3D工作室的代理讀 `.studio/parts-catalog.md`）。合用的就沿用並寫出元件編號 `P-xxxxx`；沒有合用的才另外選型，並標「新元件」。
5. **新站**一律用 `node core/tools/new-project.mjs <資料夾> "<標題>" "<一句說明>"` 建立（3D工作室由 app 建立），建好就先把規格摘要寫進站的 `AGENTS.md`。

## 實作規則

**場景與時間**

- `web/js/project.js` 是網頁與檢查共用的場景，匯出 `createProject({ scene, ...params })`，回傳 `{ total, apply(t), layoutChecks?, verify }`；不得碰 DOM。
- 狀態**只由時間決定**：`apply(t)` 倒序、跳播都要得到相同的畫面（`determinism` 檢查）。不用 `Math.random`、掛鐘，也不累加每格的狀態。
- 排程：單一手臂依序作業用 `createStepSequence`，多台設備並行用 `createTimeline`。手臂要等到位時用 `createArrivalGate`，規則 `ARRIVAL` 放在站的 `sequence.js`，網頁和 `tools/verify.mjs` 共用。

**模型、材質與成本一致**

- 形狀用 `@core/geom/shapes.js`，材質用 `MAT`／`finished(...)`，地面用 `floor()`。
- 市購品用 core 模型。元件庫有的用 `fromPart('P-xxxxx')`（會帶 `partRef`）；自己畫的用 `tagPart` 標編號；現場既有、不採購的設備在根群組標 `userData.noBom = '原因'`。成本表裡的市購品一律引用元件編號（`bom` 檢查會列出落差）。
- 設定 `userData` 時用 `Object.assign`，不要整個換掉（會蓋掉 `coreModel`、`partRef`）。相對父群組會動的群組標 `cableHost = false`。
- 規格沒寫的尺寸、型號、時間用合理的假設值，並在面板或標籤上標「示意」。

**版面與網頁**

- 沿用範本的版面骨架：`#topbar`（`.brand`、`#stations`、`.views`）、`#side`／`#left`、`#bottombar`，並呼叫 `createViewerWorkspace`。專案 CSS 不要再寫隱藏或縮小這些區塊的窄螢幕規則。
- `exposeSim(...)`、`?movie` 時呼叫 `installMovie`，每頁都要連 `../core/favicon.svg`，importmap 用 `@core/`。
- 標籤、說明、程式註解用繁體中文（台灣用語），程式碼與檔名用英文。

**檢查規則不放水**

- `verify.allow` 必須窄，而且要逐條寫原因；不能用 allow 蓋掉真的干涉。看到「0 筆干涉」時，先確認規則本身沒有放水（過去 `bodyOf` 為 null 時 `null===null` 讓固定件之間全部放行，修正後抓到大量真問題）。
- 閃爍的根因通常是兩個面重合，對數深度緩衝解決不了，要改幾何（錯開或縮小）。
- 換用 core 模型時三樣都要比：快速檢查的數字、桌面截圖、`scene-dump.mjs --diff`（逐網格與走線五金）。夾具改釘到別處不會報錯，截圖也可能低於門檻（1.9.0 那一批 SSD 的兩支夾腳就是這樣漏掉的）。
- core 模型的 `userData`：模型根群組標 `coreModel`，走線與干涉檢查把它當成透明的包裝；可動子群組標 `coreModelPart`，站可以把它改掛到自己的移動群組。

**一定不能做的事**

- 任何檔案、畫面、commit 訊息都**不得出現用戶（客戶）名稱**，即使規格、簡報或需求裡有；改用中性描述。設備廠牌與零件型號不算。
- 不要改 `core/`、其他站、根目錄的規則檔（`AGENTS.md`、`CLAUDE.md`）。
- 不要裝 npm 套件（core 與各站都沒有套件），也不要上網找程式。上網只用來查設備與零件的型錄、規格（3D工作室只有規劃角色可以，而且 WebFetch 限廠商網站）：**查詢字串與網址不得含用戶名稱、專案名稱或需求原文**，查到的數字在提案註明出處並標「待確認」。
- `export { X } from '…'` 不會建立本地綁定，本檔要用的話先 import 再 export。

## 完成定義（交付前逐項確認）

| # | 項目 | 怎麼確認 |
|---|---|---|
| 1 | 快速檢查通過 | `node core/tools/check.mjs "<站>" --quick`（在站資料夾內是 `../../core/tools/check.mjs`） |
| 2 | 完整檢查通過（含 `ui`） | `node core/tools/check.mjs "<站>"`；開發機要經 `cpu-cap.ps1` 包裝（根目錄 `AGENTS.md`「環境」）。3D工作室由 app 執行 |
| 3 | 截圖逐張看過 | `node core/tools/shots.mjs "<站>" --out TEMP/<站>-shots --port <p>`，用讀檔工具打開每張，對照規格與拍板事項，修掉明顯不對或粗糙的地方。3D工作室由 app 拍好交給代理自我檢查 |
| 4 | 站的 `AGENTS.md` 已更新 | 「規格摘要」寫明設備、節拍、主要選型（含元件編號）、資料來源；「已拍板事項」一條一行（3D工作室由 app 寫入回答） |
| 5 | `project.json` 正確 | `title`、`summary`、`coreVersion`（＝目前的 `core/VERSION`）、`checks` |
| 6 | 場景與成本表一致 | `bom` 檢查沒有落差；新站（`project.json` 有 `"strict": true`）有落差就不通過 |
| 7 | 評估簡報與成本表（新站） | 見下一節；開發機會把檔案寫到站的 `docs/assessment/` |
| 8 | review JSON 已整理 | 只有時間戳、`seconds`、`generated` 改變的先還原，有實質變化的才提交 |
| 9 | 待辦已記錄 | 沒做完、待使用者提供或待現場確認的事，寫進根目錄 `PENDING.md`「各站待確認」 |
| 10 | 結束回報 | 用幾行條列：做了什麼、做了哪些假設、還有什麼沒做 |

## 評估簡報與成本表（新站）

2026-11-14 起，新站除了 3D 動畫，還要有可行性評估與成本分析。

1. 規劃時寫出 `.studio/plan/proposal.md`（配置提案）、`feasibility.md`＋`feasibility.json`（可行性分析）、`bom.json`（成本表）。格式和 3D工作室的規劃角色相同，章節與欄位見 `studio/lib/prompts.mjs` 的規劃任務；`node studio/vs3d.mjs assess "<站>" --repo check` 會檢查。
2. 匯入元件庫：`node studio/vs3d.mjs assess "<站>" --repo import`。提案、可行性分析各存一版，BOM 匯入成本表，新元件標「待確認」。
3. 3D 完成、截圖拍好後產生：`node studio/vs3d.mjs assess "<站>" --repo deck`。輸出到 `docs/assessment/`：
   - `<站>-評估簡報-<日期>.pptx`：公司簡報樣板，內容依序是封面、結論與關鍵數字、需求與範圍、配置與 3D 截圖、節拍、可行性與風險、成本摘要（圖表）、AOI（有的話）、待拍板與 POC，附錄放 BOM 明細與假設值；
   - `<站>-成本表-<日期>.xlsx`。
   3D工作室在開發機上會於第一段完成後自動產生。部署版維持「下載時才產生、不留在主機」（2026-10-06 拍板）。
4. 公司樣板只留本機、不進版控：預設自動找 `~/.claude/skills` 底下的 `zq-work-deck`，也可以用環境變數 `VS3D_DECK_KIT` 指定資料夾（裡面要有 `assets/template.pptx` 與 `scripts/zqdeck.py`）。找不到樣板時只產生 xlsx 並提示。需要 Python 與 `python-pptx`、`pillow`（`requirements.txt`）。
5. 數字要有出處：資料不足就寫「待確認」，不要編。用戶名稱一樣要換掉。

## 各工具的差異

| | 怎麼問使用者 | 可以寫的範圍 | 完整檢查與截圖 | commit |
|---|---|---|---|---|
| Claude Code（根目錄啟動） | `AskUserQuestion` 選項對話 | 跨範圍；改 core 照根目錄 `AGENTS.md`「檢查與回歸的做法」 | 自己跑（經 `cpu-cap`） | 階段完成、檢查通過就提交，推送要使用者要求 |
| Claude Code／Codex（站資料夾啟動） | 選項對話（Codex 寫在回報裡） | 本站＋`TEMP/`，寫檔關卡與 pre-commit 會擋 | 自己跑 | 只提交本站的路徑 |
| 主 session 派出的平行代理 | 寫在回報裡，由主 session 問 | 本站＋`TEMP/<簡稱>*` | 自己跑（`UI_PORT`、`--port` 錯開） | 不 commit，由主 session 審過後提交 |
| 3D工作室的代理 | 寫問題檔 `.studio/questions/<id>.json`，然後結束這一輪 | 依角色（app 每輪比對） | 只跑快速檢查與 `snap.mjs`；不跑 `ui-check`／`shots`、不自己開伺服器，完整檢查與截圖由 app 跑 | 不 commit；app 在本機分支 `<站>/vs3d-…` 只提交本站 |

**開發中看畫面**：不論哪種工具，改了外觀、配置或動作就用 `node core/tools/snap.mjs "<站>" --view <視角> --t <秒>` 拍幾張來看（`--list` 列出視角與總長、`--size phone` 看手機版面；一次最多 8 張，輸出在站的 `TEMP/snap/`）。完成前再照完成定義第 3 項拍完整截圖。

3D工作室在開發機上直接操作本庫的 `project-site/`；部署版（給同事用的中央主機）才使用 `Documents\3D-Studio` 工作區，代理在 `projects/<專案>/` 裡工作，規則一樣是本檔（工作區的 `core/SITE-RULES.md`）。
