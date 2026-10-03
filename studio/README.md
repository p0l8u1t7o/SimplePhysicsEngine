# studio：3D 設備動畫生成應用程式

上傳規格、輸入需求，由使用者電腦上已登入的代理 CLI（Claude Code 或 Codex）做出與本庫各站同等級的 3D 設備動畫。目前是 **P1 命令列原型 `vs3d`**；Electron 外殼排在 P3。計畫書在本機 `TEMP/3d-app-plan.md`（不進版控）。

只需要 Node.js 22 以上，沒有 npm 套件。

## 用法

```powershell
node studio/vs3d.mjs doctor                                   # Claude Code／Codex 是否已安裝、已登入
node studio/vs3d.mjs new Conveyor --prompt "輸送帶＋龍門取放，節拍 10 s" --files spec.pdf photo.jpg
node studio/vs3d.mjs status Conveyor                          # 階段、輪數、等待中的問題
node studio/vs3d.mjs answer Conveyor layout-1 2 --note "靠牆"  # 不在終端機時回答問題
node studio/vs3d.mjs resume Conveyor                          # 回答後、中斷後續跑
node studio/vs3d.mjs check Conveyor --full                    # 手動跑檢查
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
| `--max-rounds 24`、`--timeout 60` | 輪數上限、每輪逾時（分鐘） |

結束代碼：0 完成、10 等待回答、1 中途停止（代理失敗、額度、逾時），2 參數錯誤。

## 流程

```
new → 規劃（配置提案＋問題）⇄ 使用者回答 → 確認提案 → 開發第一段
    → 快速檢查 → 完整檢查（含 ui 四尺寸）→ 截圖 → 完成
           └ 失敗 → 修正（續接同一個工作階段）→ 再檢查；同一項連續失敗 3 次轉成提問
```

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
    ├── docs/                上傳檔（不進版控）
    ├── .studio/             狀態、問題與回答、配置提案、每輪紀錄與事件記錄（不進版控）
    └── web/ tools/ review/  與本庫各站相同
```

角色指派的優先順序：app 預設（`lib/roles.mjs`）＜ 工作區 `.studio/settings.json` ＜ 專案 `studio.json` ＜ 命令列。P1 的預設是各角色都用中階模型（Claude `sonnet`、Codex 帳號預設模型）；正式預設值等 P2 實測後決定。

## 代理 CLI 的實測重點（2026-10-04，Claude Code 2.1.266、codex-cli 0.154.0）

- Claude Code：`claude -p --output-format stream-json --verbose`，提示從 stdin 傳入；`result` 事件有 `session_id`、`num_turns`、`total_cost_usd`、`usage`；另有 `rate_limit_event`。`.claude/settings.json` 只從啟動資料夾讀取，寫檔關卡改用 `--settings <JSON>` 傳入，不必在專案裡放設定檔。Windows 上 Bash 工具的寫入攔不到，靠第 2、3 層。
- Codex：`codex exec --json -`；續接 `codex exec resume <id> -` 沒有 `-s`，改用 `-c sandbox_mode="workspace-write"`。Windows 原生沙箱**會擋下**工作目錄以外的寫入（PowerShell 回「拒絕存取」），但預設允許寫系統暫存目錄。Codex 只從 git 根目錄（專案）往下找 `AGENTS.md`，工作區規則由 app 放進提示。頂層的 `error` 事件多半是重新連線，只有 `turn.failed` 才算失敗。

## 測試

```powershell
node --test "studio/test/*.test.mjs"   # 不耗額度：事件解析、角色、提問、隔離，以及用假代理跑完整流程
```

`test/fixtures/` 是實際錄下、去掉本機資訊的兩種 CLI 事件。
