# core/twin：AutoSequence 數位孿生的 SPE 端（Twin Protocol v2 server，選配外接後端）

AutoSequence 的 Twin Hub（時間主控、虛擬 PLC）以 TCP 連進來，序列程式一行不改就能驅動 SPE 裡的虛擬機台；SPE 的虛擬感測器把狀態回報給 Hub。協定規格在相鄰 repo **AutoSequence** 的 `schema/schemas/twin-protocol/v2/README.md`（本檔只寫 SPE 端的用法與慣例）。

- **定位（2026-11-11 起）**：AutoSequence 改以內建物理後端（MuJoCo）自建數位孿生，SPE 降為**選配外接**後端；AutoSequence 不再依賴 SPE，也不列入它的必要驗收。SPE 端照常維護（使用者拍板），但不再排聯調與端對端驗收。說明在本機 `TEMP/AutoSequence數位孿生決定_2026-11-11.md`。
- **MD 欄位擁有權**：AutoSequence 的 MD 2.2 把軸、致動器、機器人、感測器、設備的物理與場景欄位（`travel`、`vMax`、`stroke`、`travelTime`、`scene` 等）改歸 AutoSequence、由它的孿生寫回。SPE 只讀 MD、不寫回；之後若要從站產生或寫回 MD，必須避開這些欄位。
- 協定：`zqs.twin/2.0`（schema 取自 AutoSequence 的 `schema/`，release `2.0.0`；版本鎖在 `automation-schema.lock.json`）
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
| `--schema-repo <路徑>` | 孿生用 schema 的位置；也可用環境變數 `SPE_AUTOMATION_SCHEMA`；預設是 SPE 根目錄的上一層 `..\AutoSequence\schema` |
| `--schema-unlocked` | 開發期略過版本要求（只印警告；**不得用於聯調驗收**） |
| `--port`、`--host` | TCP，預設 `127.0.0.1:7600`；`--port 0` 取空埠，`--port-file <檔>` 寫出實際埠號。協定沒有認證，`--host` 改成其他位址時印警告 |
| `--sse <port>` | 開 SSE 觀看端點（`/events`、`/view`），預設埠 8776 |
| `--max-line <bytes>` | 在 hello 宣告自己願意收的單行上限（65,536–16,777,216） |
| `--validate` | 逐則驗證收到的訊息（除錯）；握手階段與 cmd／fault 一律驗證（它們的欄位會回送到 error／event） |
| `--transcript <檔>` | 寫出工作階段紀錄，可交給 `validate.py session` |
| `--test-hook no-ack-at:<n>` | 第 n 個 tick 不回 tickAck（驗 Hub 的看門狗，TWIN-AC-05） |

啟動時（接受連線之前）依序做：孿生用 schema 定位與版本檢查 → 載入並驗證 MD、計算 mdHash → 無頭建立站的場景 → 站的孿生描述 → 綁定解析。任何一步失敗就以非 0 結束。

## 孿生用 schema（AutoSequence/schema，相鄰 checkout，不複製進 SPE）

- 來源（2026-11-11 起）：AutoSequence 把 Automation-Schema `v2.0.0-preview.3` 整份收進自己 repo 的 `schema/` 自行維護，不再往 Automation-Schema 發版；SPE 改讀這一份（使用者拍板）。與 SPE 的相容性 AutoSequence 不保證，由下面的版本鎖與 core 的 twin 檢查把關。
- SPE **不複製**它的任何產生碼（專有授權；開發計畫 Q-06 = C）。`core/tools/twin-schema.mjs` 在啟動時讀 `generated/js/index.mjs`（`validateTwinMessage`、`checkHello`、`validateMachineDescription`、`mdHashOfText`），再注入 session；`core/twin/*.js` 本身不 import 它（靜態檢查會擋）。
- 版本要求在 `automation-schema.lock.json`：**只鎖協定**——`RELEASE` 與 `schemas/twin-protocol/v2`、`schemas/machine-description/v2`、`schemas/common/v2` 的 `*.schema.json`（換行統一後的 SHA-256）。這些檔有未提交的修改、雜湊不符、有新增檔，或 `RELEASE` 不符 → 拒絕啟動，訊息寫出要求與實際版本及修正方式。AutoSequence 新增其他 schema（例 `twin-model`）、改產生碼或工具都不擋；產生碼行為的變化由 core 的 twin 檢查把關。AutoSequence 的 commit 只做紀錄（它每次提交 HEAD 都會變）。
- AutoSequence 改了協定或 MD schema 時：先 `node core/tools/check.mjs --only twin`（twin 測試以未鎖定方式載入）與 MGPC 的 `verify-twin` 確認相容，再 `node core/tools/twin-schema.mjs --write-lock`；範例 MD 有改時照 `project-site/MilitaryGradePC/twin/SOURCE.md` 重取。
- 換機器：在 SPE 旁邊 clone AutoSequence（`scripts\setup.ps1` 會檢查並提示）。
- CI（GitHub Actions 只 checkout SPE）：不需要 schema 的測試照跑；需要的測試與 mdHash 檢查明確印「略過」（不算通過）。本機一律要有。

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
| `initialView()` | 初始的場景值 `{ keys, paths }`（MD 值 = (場景值 − offset) ÷ scale）；單線圈與無電磁閥的致動器不取這裡的值，一律從 `states[0]` 開始（DO 全 OFF 的穩態） |
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
# 協定一致性（SPE-AC-04）：重播範例 transcript，再用 schema 的驗證工具驗（或用 generated/js 的 validateTranscriptLine 逐行驗）
node core/tools/twin.mjs MilitaryGradePC --port 7600
node core/tools/twin-hub.mjs ..\AutoSequence\schema\examples\MilitaryGradePC.twin-session.jsonl --port 7600 --out TEMP\twin\ac04.jsonl
cd ..\AutoSequence\schema\tools; uv run validate.py session ..\..\..\SimplePhysicsEngine\TEMP\twin\ac04.jsonl --md ..\examples\MilitaryGradePC.md.json
```

## 初始狀態與聯調回饋的修正（core 1.21.0）

AutoSequence 2026-10-22 的聯調回饋 P1～P4 都已修正，回歸測試在 `test/server.test.mjs`（P1）與 `test/feedback.test.mjs`（P2～P4）：

- P1：拒絕第二條連線時，被拒的 socket 也掛 `error` 監聽、送完拒絕訊息即 `destroy()`；佔用中的連線若已失效（行程暫停後恢復）先釋放；伺服器層級的錯誤只記日誌。對方送 RST 不再讓 SPE 行程結束。
- P2：初始狀態是工作階段開始時 **PLC 全部 DO OFF 的穩態**（與 Q-2 一致）：單線圈（`solenoid: single`）與無電磁閥（`none`）的致動器在 `states[0]`，不取站的初始畫面；雙線圈維持站的初始畫面，軸與機器人也是。MGPC 的 `act-S0-FORK`、`act-S4-FORK` 因此從收回開始。
- P3：有 schema 時，cmd／fault 一律驗證（`--validate` 只控制其他訊息），不合的回 non-fatal error、不執行；沒有 schema 時，內建檢查也擋下會回送的欄位型別（`vision` 的 `shot` 必須是字串）。SPE 自己的輸出永遠合 schema。
- P4：即時干涉在虛擬時間格點上檢查，但幾何（各實體的 MD 值與工件持有者）和上次檢查相同時不重算；靜止的 idle tick 不再每次整場重算。

## 已知限制

- 不做由站產生 MD（原 S4，2026-11-11 撤回：MD 的場景與物理欄位已改歸 AutoSequence）；工件的持有權只切換清單與事件，模型本身由站決定怎麼顯示（MGPC 只有一台產品模型）。
- 即時干涉只在取樣格點（`collisionEvery`，預設 0.02 s）判斷，只查站指定的 movers 對 obstacles。
- `move` 的 `line` 與 `ptp` 一樣以關節插值移動；`light` 只記錄狀態給觀看端。
- 同時只服務一條連線，第二條收到 `error(INTERNAL, fatal)`（協定沒有指定錯誤碼）。
- MGPC 觀看模式的「設備訊號」面板依 DI 顯示；MD 沒有對應 DI 的訊號（升降到位、所有門關閉、工具到位）不亮。
