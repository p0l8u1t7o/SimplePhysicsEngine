# core/twin：AutoSequence 數位孿生的 SPE 端（Twin Protocol v2 server）

AutoSequence 的 Twin Hub（時間主控、虛擬 PLC）以 TCP 連進來，序列程式一行不改就能驅動 SPE 裡的虛擬機台；SPE 的虛擬感測器把狀態回報給 Hub。協定規格在相鄰 repo **Automation-Schema** 的 `schemas/twin-protocol/v2/README.md`（本檔只寫 SPE 端的用法與慣例）；開發計畫在本機 `TEMP/AutoSequence孿生_SPE開發計畫_v0.2.md`。

- 協定：`zqs.twin/2.0`（Automation-Schema `v2.0.0-preview.3`，版本鎖在 `automation-schema.lock.json`）
- 示範站：MilitaryGradePC（`project-site/MilitaryGradePC/twin/`、`web/js/twin-binding.js`）
- 交付標籤一律 **Simulation Validated**：機器人連桿與關節零點是估計值，孿生結論只當初步可行性；干涉事件是警示，不是安全保證。

## 啟動

```powershell
node core/tools/twin.mjs MilitaryGradePC --port 7600 --sse 8776      # Hub 端：asq-sim run <情境> --spe 127.0.0.1:7600
# 觀看：http://127.0.0.1:8770/MilitaryGradePC/?twin=8776（先用 scripts\start.cmd -Site 開展示網站）
```

| 選項 | 說明 |
|---|---|
| `--md <檔>` | MD；省略時用 `project-site/<站>/twin/<站>.md.json` |
| `--schema-repo <路徑>` | Automation-Schema 的位置；也可用環境變數 `SPE_AUTOMATION_SCHEMA`；預設是 SPE 根目錄的上一層 `..\Automation-Schema` |
| `--schema-unlocked` | 開發期略過版本要求（只印警告；**不得用於聯調驗收**） |
| `--port`、`--host` | TCP，預設 `127.0.0.1:7600`；`--port 0` 取空埠，`--port-file <檔>` 寫出實際埠號。協定沒有認證，`--host` 改成其他位址時印警告 |
| `--sse <port>` | 開 SSE 觀看端點（`/events`、`/view`），預設埠 8776 |
| `--max-line <bytes>` | 在 hello 宣告自己願意收的單行上限（65,536–16,777,216） |
| `--validate` | 逐則驗證收到的訊息（除錯；握手階段一律驗證） |
| `--transcript <檔>` | 寫出工作階段紀錄，可交給 `validate.py session` |
| `--test-hook no-ack-at:<n>` | 第 n 個 tick 不回 tickAck（驗 Hub 的看門狗，TWIN-AC-05） |

啟動時（接受連線之前）依序做：Automation-Schema 定位與版本檢查 → 載入並驗證 MD、計算 mdHash → 無頭建立站的場景 → 站的孿生描述 → 綁定解析。任何一步失敗就以非 0 結束。

## Automation-Schema（相鄰 checkout，不複製進 SPE）

- SPE **不複製** Automation-Schema 的任何產生碼（專有授權；開發計畫 Q-06 = C）。`core/tools/twin-schema.mjs` 在啟動時讀相鄰 repo 的 `generated/js/index.mjs`（`validateTwinMessage`、`checkHello`、`validateMachineDescription`、`mdHashOfText`），再注入 session；`core/twin/*.js` 本身不 import 它（靜態檢查會擋）。
- 版本要求在 `automation-schema.lock.json`：tag、commit、`generated/js` 各檔 SHA-256。HEAD 不是該 commit、`generated/js`／twin 與 MD schema 有未提交的修改、雜湊或 `RELEASE` 不符 → 拒絕啟動，訊息寫出要求與實際版本及修正指令。
- Automation-Schema 發新版後：`git -C ..\Automation-Schema checkout <tag>`，再 `node core/tools/twin-schema.mjs --write-lock <tag>`，並照 `project-site/MilitaryGradePC/twin/SOURCE.md` 重取站內 MD。
- 換機器：在 SPE 旁邊 clone Automation-Schema 並 checkout lock 檔的 tag（`scripts\setup.ps1` 會檢查並提示）。
- CI（GitHub Actions 只 checkout SPE）：不需要 Automation-Schema 的測試照跑；需要的測試與 mdHash 檢查明確印「略過：找不到 Automation-Schema」（不算通過）。本機一律要有。

## 模組

| 檔案 | 內容 |
|---|---|
| `session.js` | `prepareTwin({ md, twin })`（啟動時一次）、`createTwinSession({ prepared, mdHash, schema, software, maxLine, options })`（每條連線一個）：`receive(line)`／`handle(msg)` 一則進、一串出（與 AutoSequence 假 SPE 的 `ITwinServerEngine.Handle` 同形）、`pollRealtime(nowUs)`、`view()` |
| `framing.js` | JSON Lines 分框：`createLineReader`、`parseMessage`、`encodeMessage`（BOM、非 UTF-8、單行上限） |
| `binding.js` | `resolveBindings(index, twin)`：MD 實體 ↔ 站的狀態鍵／物件路徑，算出 `bindings`、`unbound` 與初始值；`buildView` |
| `md.js` | MD 索引、致動器預設動作與穩態（MD README §7） |
| `dynamics/axis.js`、`actuator.js`、`robot.js` | 梯形曲線閉式解、減速停止、原點復歸、追隨誤差；致動器依 travelTime 線性移動、單線圈彈簧復歸；機器人關節線性插值與任務 |
| `sensors.js` | reed、limitSwitch／inPosition、pressureSwitch、levelSwitch；幾何類交給站的 `sense` |
| `geometry.js` | photoEye 射線、proximity 區域（three.js；類別標記 `userData.twinClass`） |
| `collisions.js` | 即時干涉：`createCollisionWatch({ movers, obstacles, allow, tol })`（外框＋`core/verify/scene.mjs` 的 OBB 分離軸）、`scenePath`（只列有名字的祖先，可用名稱找回） |
| `workpieces.js` | 工件持有權轉移：站的 `transfers` 規則 |
| `view.js` | 網頁的孿生觀看：`connectTwinView({ url, apply })`（SSE）、`twinUrl(?twin=)` |
| `core/tools/twin.mjs`、`twin-server.mjs`、`twin-schema.mjs`、`twin-hub.mjs` | 命令列、TCP／SSE 傳輸層、Automation-Schema 定位與版本檢查、測試用 Hub（重播 transcript） |

## 決定性（鎖步）

- 只依 tick 帶來的整數 `tUs` 推進；內部時間一律是整數 µs，`time = tUs / 1e6`。軸、致動器、機器人的運算順序與假 SPE（`FakeSpe/ModelSpe.cs`、`Kinematics/*.cs`）相同。
- `core/twin/*.js` 不得出現 `Date.now`、`performance.now`、`new Date`、`Math.random`、`setTimeout`／`setInterval`、`node:*`（`test/scenario.mjs` 的靜態檢查，列在 `check.mjs` 的 core `twin` 檢查）。掛鐘只在 `core/tools/twin-server.mjs`（`tickAck.wallUs`、即時迴圈、日誌）。
- 每條連線從站的初始狀態開始；同一串 hub>spe 訊息在不同工作階段、不同 Node 行程得到逐位元組相同的輸出（去掉 `tickAck.wallUs` 與 `hello.software`）。
- 輸出的物件依 ID 字典序；同一 tick 內 error 依接收順序、event 依發生順序。
- 速度：MGPC 在程序內跑 120 s 虛擬時間（dt 1 ms，輸送、第七軸、夾爪持續動作，干涉每 0.02 s）約 8.5 s 掛鐘（AutoSequence 的關卡是 ≤ 60 s；TCP 與 Hub 端的時間另計）。
- **孿生路徑不經過時間軸的 `apply(t)`**：站的時間軸模式（與 determinism 檢查）不受影響。

鎖步 tick(n)：依接收順序套用暫存的 cmd／fault（時間 t_{n-1}，被拒的回 non-fatal error）→ 故障生效／解除 → 動態推進到 t_n → 到期的排程事件（曝光、工件）→ 工件持有權轉移 → 即時干涉（格點時刻）→ 幾何感測器（只在 `geometryKeys` 改變時更新場景）→ DI（sensorStuck 覆寫感測器輸出、再套 `io.logic`）→ 送出 `[error]* → state(n)? → event(n)* → tickAck(n)`。

## 站的孿生描述（`web/js/twin-binding.js`）

`createTwinBinding(project, scene)` 回傳：

| 欄位 | 說明 |
|---|---|
| `station` | hello 的 `station`（站資料夾名稱；不得有用戶名稱） |
| `keys` | 可綁定的狀態鍵（MD `scene.stateKey`），通常是 `project.initialState()` 的數值鍵＋手臂的 `q`、`q.rail` |
| `setters` | 沒有 stateKey 的實體可用的物件路徑（例 `cell/stops/S1`、`cell/tower/green`），值在 `view.paths` |
| `objects`、`root` | 邏輯路徑 → 物件；查不到再沿 `root` 的物件名稱逐段解析；都解析不到列入 unbound |
| `initialView()` | 初始的場景值 `{ keys, paths }`（MD 值 = (場景值 − offset) ÷ scale） |
| `apply(view)` | 把 view 套到場景（觀看模式與握手時用）；站狀態 = `initialState()` 的複本＋view，交給 `applyState` |
| `applyGeometry(view)`、`geometryKeys` | 選填：每個 tick 只更新幾何感測器看得到的物件；只有這些鍵改變才呼叫（MGPC 只移動載具） |
| `sense(sensor)` | photoEye、proximity、vacuumSwitch 的判定（通常用 `geometry.js` 的 `createSceneSensors`） |
| `collide()` | 選填：目前穿插中的配對 `[{ a, b, depth }]`（通常用 `collisions.js`）；session 在虛擬時間格點呼叫，一對開始干涉時送一次 `event k:collision` |
| `transfers` | 選填：`[{ from, to, when(ctx) }]`，`ctx.state(致動器)`、`ctx.pos(軸)`、`ctx.di(io)`；成立時工件換持有者並送 `event k:workpiece action:transferred` |
| `ik(robotId, { pos, rot, tool, rail }, q)` | 選填：`move` 的位姿目標 → 關節角；無解回 null（session 回 `BAD_ARGS`）；沒有時關節不變、忙碌 1 s（同假 SPE） |
| `spawnWorkpiece`、`removeWorkpiece`、`resetWorkpieces` | 選填：工件的顯示 |
| `config` | `exposureDelay`（s，預設 0.05）、`homeDuration`、`taskDefault`、`taskDuration`、`switches`（感測器的固定值，例如壓力、液位開關）、`collisionEvery`（s，預設 0.02） |

## 測試

```powershell
node --test "core/twin/test/*.test.mjs"                       # 也是 check.mjs 的 core twin 檢查
node core/tools/run.mjs MilitaryGradePC tools/verify-twin.mjs # 綁定、mdHash、applyState 等價、photoEye、位姿指令
# 協定一致性（SPE-AC-04）：重播範例 transcript，再用 Automation-Schema 的驗證工具驗
node core/tools/twin.mjs MilitaryGradePC --port 7600
node core/tools/twin-hub.mjs ..\Automation-Schema\examples\MilitaryGradePC.twin-session.jsonl --port 7600 --out TEMP\twin\ac04.jsonl
cd ..\Automation-Schema\tools; uv run validate.py session ..\..\SimplePhysicsEngine\TEMP\twin\ac04.jsonl --md ..\examples\MilitaryGradePC.md.json
```

## 已知限制

- 由站產生 MD（S4）尚未做（登記在 `core/REQUESTS.md`）；工件的持有權只切換清單與事件，模型本身由站決定怎麼顯示（MGPC 只有一台產品模型）。
- 即時干涉只在取樣格點（`collisionEvery`，預設 0.02 s）判斷，只查站指定的 movers 對 obstacles。
- `move` 的 `line` 與 `ptp` 一樣以關節插值移動；`light` 只記錄狀態給觀看端。
- 同時只服務一條連線，第二條收到 `error(INTERNAL, fatal)`（協定沒有指定錯誤碼）。
- MGPC 觀看模式的「設備訊號」面板依 DI 顯示；MD 沒有對應 DI 的訊號（升降到位、所有門關閉、工具到位）不亮。
