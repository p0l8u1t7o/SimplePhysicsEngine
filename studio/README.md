# studio：3D 設備動畫生成應用程式

上傳規格、輸入需求，由使用者電腦上已登入的代理 CLI（Claude Code 或 Codex）做出與本庫各站同等級的 3D 設備動畫。目前是 **P1 命令列原型 `vs3d`**；Electron 外殼排在 P3。計畫書在本機 `TEMP/3d-app-plan.md`（不進版控）。

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
- 之後用 Electron 把同一個頁面包成桌面程式（P5 打包）。

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
node studio/vs3d.mjs probe Conveyor --cli codex --other <另一個專案>   # 寫入隔離自我測試
node studio/vs3d.mjs models Conveyor                          # 各角色目前的 CLI 與模型
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
    → 前後對照頁（TEMP/render-compare/）→ 接受／要調整／整批還原 → 完成
```

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
node --test "studio/test/*.test.mjs"   # 不耗額度：事件解析、角色、提問、隔離、Office 抽取，以及用假代理跑完整流程
```

`test/fixtures/` 是實際錄下、去掉本機資訊的兩種 CLI 事件；測試用的 Office 檔由 `test/office-fixtures.mjs` 在記憶體裡組出。
