# TestCode 3D 動畫統一框架：遷移計畫與進度

2026-10-03 拍板（選項對話）：
- 單一 `core/` 直接引用（importmap `@core/`），不再複製同步；
- 7 個專案一次全部遷移；
- 本機跑完整檢查，Pages 部署前跑快速檢查，沒過就不發佈；
- 共用 3D 模組用程序式 JS，統一 `createX(參數) → { root, set(state), meta }`，另做模型目錄頁。

## 網址與檔案配置（本機與 Pages 相同）

| 網址 | 本機來源 | 說明 |
|---|---|---|
| `/` | 由 `core/tools/site.mjs` 產生 | 展示首頁 |
| `/core/…` | `core/` | 共用模組與 three.js（只發佈一份） |
| `/<專案>/…` | `<專案>/web/…` | 各專案頁面 |

各專案 `index.html` 的 importmap 一律寫成：
`three` → `../core/vendor/three.module.js`、`three/addons/` → `../core/vendor/addons/`、`@core/` → `../core/`。
Node 端由 `core/tools/loader.mjs` 解析相同的三種名稱，檢查程式直接載入網頁用的同一份模組。

## 階段

| 階段 | 內容 | 狀態 |
|---|---|---|
| P0 基準 | 遷移前各專案原有檢查紀錄＋各視角截圖，作為逐一比對的依據 | 完成 |
| P1 骨架 | `core/vendor`、`loader.mjs`、統一伺服器 `serve.mjs`、`project.json`、importmap、移除 7 份 vendor／three-loader／serve.py、Pages 建置改用 `build-site.mjs` | 完成 d1392707 |
| P2 共用模組 | 根目錄 `tools/` 共用檔與手動複製檔移入 core；`detail.js`（A／A+／B）、`kinematics.js`（A／B）合併；移除 sync 腳本與無用檔 | 完成 03b6af01 |
| P3 標準介面＋統一檢查 | 各專案 `web/js/project.js` 提供 `createProject()`；`window.sim` 標準化；core 檢查：全場干涉、重合面閃爍、倒序一致、空間檢核；`check.mjs` 依 `project.json` 執行專案自有檢查；情境（variants）與分模組門檻 | 完成（7 專案） |
| P4 修正發現 | 各專案依新檢查修正閃爍與干涉 | 完成：7 專案 scene 全 0（PCB S1／S3 改懸臂、MGPC 加步驟並移 S3，均經使用者決定） |
| P5 渲染與 UI 共用 | `core/ui/stage.js`、`player.js`；錄影改用 `?movie` 掛鉤（`core/movie`） | 完成：7 專案改用 createStage＋exposeSim，截圖逐張差異 0 |
| P6 模型庫 | 手臂、AGV、桶、輸送、龍門、標準件移入 `core/models`；目錄頁 | 完成：12 個模型（FANUC R-2000iC、DENSO VS-068／VM-60B1／COBOTTA PRO 900／HSR065、AGV、200L 桶、輸送線、龍門、4 標準件） |
| P7 新專案範本與文件 | `core/template` ＋ `new-project.mjs`；README | 完成 |

## 比對方式

- 每階段前後跑 `core/tools/shots.mjs`，逐張比對截圖（像素差異），再跑各專案原有檢查，結果需與 P0 相同。
- 刻意的外觀改變（例如修閃爍）在該階段紀錄中註明。

## 進度紀錄

- 2026-10-03 P0：26 支專案檢查＋4 支根目錄檢查全數通過；`TEMP/shots-base`（91 張）重拍兩次差異 0，可作基準；`TEMP/review-base` 為 review JSON 基準（`core/tools/compare-review.py` 比對，忽略時間與雜湊欄位）。
- 2026-10-03 P1（d1392707）：截圖 91 張差異 0、檢查 33/33、review 結果相同。另刪除 MonocularDepthEstimation（性質不同，b575e21d）。
- 2026-10-03 P2：`core/electrical`（線材、電盤、元件、檢視器）、`core/ui`（viewer-workspace、vision-overlay、view-controls）、`core/geom`（primitives＝原 detail A+、parts／hardware＝原化學桶 parts／detail、finish、surfaces、perforated）、`core/robot/kinematics.js`（合併 A／B，B 的參數改由化學桶 robot.js 傳入）。刪除根目錄 tools 的 7 個正本與 3 支 sync 腳本、3 份未使用的 camera-panel.js。截圖差異 0、檢查 33/33＋根目錄 4 支、review 結果相同。
  - 原 detail A 的專案（滴定、軍規、PCB）改用 A+，`tube()` 多了陰影；截圖差異在門檻內。
  - 兩套基本形狀並存：`primitives.js`（block／cylinder／decal…）與 `parts.js`（MAT／box／cyl／plate…）。→ 2026-10-03 第二輪統一為 `shapes.js`＋`materials.js`。
- 2026-10-03 P3（95578342）：`core/verify/{scene,determinism,run,dom-stub}.mjs`；化學桶改用 `project.js`，舊的 `tools/verify-scene.mjs` 退役。dom-stub 讓瀏覽器才有的文字牌也進檢查，抓到「取桶位／放回位」牌在夾爪路徑上（已移到輸送架下方）。其餘 6 專案由平行代理各自完成 project.js、main.js 接上、修正 scene 發現。
- 2026-10-03 P5／P6／P7 先行（2595b72f、73d5d9f9、27b9886a）：stage／player／track、範本與 new-project、模型庫（輸送線、龍門、標準件）＋目錄頁＋models 檢查；Pages 不再發布 verify 與 review。範本產生的專案通過全部 core 檢查；檢查也抓到範本初稿的 2 組重合面與龍門原點超出行程。
- 2026-10-03 收尾：
  - 檢查規則修正：`bodyOf` 為 null 時「同一剛體」誤放行（固定件之間、頂層移動件對固定件），修正後各專案抓到大量真問題並全部處理；另加曲面／開孔擠出件頂點複核、線材端點與小型配線五金規則、自轉件歸屬、快取（MGPC 由 2 小時以上降到 90 秒）。
  - 部署前快速檢查加入 scene（干涉＋閃爍）。
  - 已知待實機確認：PCB S1／S3 相機與 S2 Y 軌間隙 1.75 mm；MGPC 週期 329.75 → 347.75 s。
  - 待延伸：各專案的 3D 標籤、視角轉場仍是自己的寫法（行為與 stage 版略有不同）；兩套基本形狀（primitives／parts）並存。
- 2026-10-03 第二輪統一（使用者選：四項全做、允許小幅外觀改變、一次做完）：
  - 形狀：`shapes.js`＋`materials.js` 取代 parts／primitives（codemod-shapes.py 自動轉換，91 張截圖不變）。
  - 排程：`createStepSequence`（SSD、快門、MGPC、WPM、滴定手臂）與 `createTimeline`（化學桶、PCB、滴定轉盤與滴定頭）；統一事件格式 `{time,dur,label,sub,station}`。各站排程結果與改寫前逐位元／1e-7 相同。
  - 介面：7 站播放列改用 `createPlayer`，標籤 `stage.addLabel`，視角 `stage.goTo`；化學桶相機視窗改用 viewer-workspace，`view-controls.js` 刪除。WPM 的 2D 模擬相機維持專案自有。
  - 材質：常見材質改用 MAT，框架、儀表盤等外觀略有變化（各站截圖差異已逐張檢視）。
  - 代理回報的 core 補強建議（尚未做）：標籤自動加畫布偏移（6 站各自補正）、player 的到位閘門／loop／speed getter／select 速度、步驟逐鍵緩動與 latch／retime／rollback、stage 取消轉場與 shiftView、Track.at(T)、MAT.frame（0x6b7480）／chrome／帶細紋材質、viewer-workspace 的 focusOffset 函式與 startFollowing、2D 影像來源、verify-cables 改讀 tr.steps 後移除 PCB 的 segs 別名。
- 2026-10-03 精進輪（使用者選：四項全做、做完更新 Pages）：
  - core（07b00ea1）：player 的 `advance`／`loop`／`<select>` 速度／`speed`；標籤自動加畫布偏移與 `anchor`；`stage.cancelTween`／`shiftView`；`createStepSequence` 的 `latch`、逐鍵緩動、`peek`、`mark`／`rollback`、`retime`、`nested`；`Track.at(T)`；`MAT.frame`／`chrome`／`finished()`；viewer-workspace 的 `renderImage`／`setSources`／`startFollowing`／focusOffset 函式。
  - 7 站改用（ced15a38 化學桶、3dfc1a3a PCB、318e5f8a WPM、5d72ca9f 快門、ab2db938 滴定、864a053d 軍規、6592d70c SSD）：各站排程指紋、review JSON、專案檢查與改前相同；外觀差異只在改用 MAT.frame／chrome／finished 的框架、銷、鋁件。
  - 收尾補 core：上一步改為逐步回退（短步驟不再被跳過）；追隨目標離線後重新出現時平移回目標（化學桶的 focusAbsent 變通寫法移除）；獨立相機視窗的 2D 影像也更新標題時間；player 加 `apply` 的 `dt`、`onChange` 的 `seek`、`maxStep`（軍規的 stepDt／seeking／自拆子步移除）；`createStepSequence.add` 由 O(n²) 改用 Set；滴定、軍規樣式表中被 stage 覆蓋的 `.label3d` transform 移除。
  - 仍在專案內（刻意）：各站手臂 IK／PTP 規劃與到位判斷規則、SSD 的 `resume()`、各站自己的光源與產品外觀。
- 2026-10-03 第四輪（使用者選：手臂到位閘門、標準互動測試、光源與地面預設、favicon，另加「手機、平板等小螢幕可以順利觀看」）：
  - 到位閘門（43376644）：`core/anim/arrival.js` 的 `createArrivalGate`；MGPC、SSD 的網頁與 `tools/verify.mjs` 共用各站 `sequence.js` 的 `ARRIVAL`，9 支工具輸出逐字相同。
  - 小螢幕（d7e68b64、0af3983f、365678c0）：stage 的 `narrowFit`（窄畫布拉遠，旋轉時依視角的 `fit` 重算，霧與 maxDistance 一起放大）、標籤避讓（精簡版面時依 priority）；viewer-workspace 精簡版面擴及觸控平板 ≤1100 px，大平板加大點按目標，觸控裝置預設不開相機視窗；播放設定展開時步驟列緊接播放列；橫向手機的側欄與電控面板改為右側面板；手機直向電控面板精簡。
  - 光源與地面：`createStage({ look, extent })`（cell／plant／studio）、`core/geom/environment.js` 的 `floor()`。7 站都改用 look；`extent` 推算的燈位與各站手調值不同，為了桌面畫面不變，各站保留原本的燈位與陰影。地面：Acid、MGPC、PCB、SSD、快門改用 `floor()`，WPM 用 `material` 保留展示地面，化學桶的廠房地坪維持專案自建。
  - 標準互動測試：`core/tools/ui-check.mjs`（桌面、手機直向、手機橫向、觸控平板 × 載入、溢出、畫布、播放、步驟、視角、側欄、標籤、點按目標、?movie），接進 check.mjs 完整檢查的 `ui`（`UI_PORT`），結果在各站 `review/ui-check.json`。7 站四種尺寸全過。
  - favicon：`core/favicon.svg`，首頁、目錄頁、7 站與範本都連上。
  - 範本改為標準版面（viewer-workspace、look／extent、floor、標籤 priority），並修掉範本原本的靜態相撞（龍門 offset 300→400）；new-project 依檔案類型跳脫標題；`createTimeline` 補上 `stationStart`。
  - 桌面截圖：各站與第四輪前的 HEAD 逐張比對，差異 0；刻意改動只有 WPM 工件跟拍（原本同一格先跳播再切視角會空白）與 MGPC 手臂取景說明文字（原本壓在影像資訊框上，改到影像左下角）。
  - 收尾：精簡版面打開側欄或電控面板時，viewer-workspace 以 `camera.setViewOffset` 把 3D 畫面中心移到沒被遮住的區域（直向往上、橫向往左），手機看電盤視角時機櫃不再被面板蓋住；桌面不受影響（截圖差異 0）。
- 2026-10-04 子專案規則（使用者選：依提交位置判定、PR 依分支名稱限定、各站拍板紀錄搬進各站、這次就做寫檔關卡）：
  - 規則檔：根目錄 `AGENTS.md`（共通規則，Claude Code 與 Codex 共用；`CLAUDE.md` 以 `@AGENTS.md` 引用並另加 Claude Code 專屬說明）、各站 `AGENTS.md`／`CLAUDE.md`（範圍、規格摘要、已拍板事項）；範本一併帶出。
  - 範圍檢查：`core/tools/check-scope.mjs`（pre-commit 依 `GIT_PREFIX`、PR CI 依分支名稱）、`.githooks/pre-commit`＋`core/tools/install-hooks.mjs`（setup.ps1 自動安裝）、`.github/workflows/scope.yml`；`pages.yml` 只改 `studio/` 時不跑。
  - 寫檔關卡：各站 `.claude/settings.json` 的 PreToolUse 呼叫 `core/tools/scope-guard.mjs`。
  - core 需求登記 `core/REQUESTS.md`；版本號 `core/VERSION` 定為 1.0.0，各站 `project.json` 加 `coreVersion`。網頁與檢查行為不變。
- 2026-10-04 core 1.1.0（3D 動畫生成應用程式 P1 需要）：
  - 工作區模式：`core/tools/projects.mjs` 看到 core 旁邊有 `studio-workspace.json` 時，專案改從 `<工作區>/projects/` 找（`WORKSPACE`、`ROOT`），網址配置不變；`check.mjs` 在工作區模式只檢查單一專案時，結果寫到該專案的 `TEMP/`。本庫沒有標記檔，行為不變。
  - `new-project.mjs`：從範本複製出的檔案一律改成可寫（工作區的 core 是唯讀屬性）。
- 2026-10-04 core 1.2.0（studio P4b 渲染與細節補強的守門檢查需要）：
  - `core/verify/fingerprint.mjs`：排程指紋（時間軸總長、事件表、各取樣點 `apply(t)` 的狀態、有名稱且會動的物件軌跡）＋`fingerprint-compare.mjs`（不依賴 three 的比對：原有欄位不可變、可新增）。`core/verify/run.mjs` 新增 `fingerprint` 檢查，只印一行 JSON、不寫 review。
  - `core/tools/perf-check.mjs`：各視角 `renderer.info`（三角面、draw call、貼圖、幾何）與手機直向（CPU 降速 4 倍）幀率；`createStage` 把舞台登記到 `globalThis.__coreStages` 供量測讀取。
  - `viewNames` 從 `shots.mjs` 搬到 `core/tools/views.mjs`（shots 仍匯出）。7 站桌面截圖與改前 HEAD 比對 0 張超過門檻。
  - 現有各站的量測基準（無頭瀏覽器）：快門 572 萬三角面／4457 draw call／手機 11.7 fps，MGPC 134 萬／28172／5 fps，可作為之後最佳化的參考。
- 2026-10-04 core 1.3.0（專案搬進 `project-site/`）：
  - 7 站與 RecycleSorter 從庫根目錄搬到 `project-site/<專案>/`，之後的新專案也放在這裡；網址配置不變（`/<專案>/`、`/core/`），網頁 importmap 的 `../core/` 不用改。
  - `core/tools/projects.mjs` 新增 `REPO`（庫根目錄）與 `PROJECTS_DIR`（`project-site`，工作區模式為 `projects`）；`ROOT` 改指 `project-site/`。兩種配置的專案都在 core 往上兩層，專案的 Node 工具往根目錄一律寫 `../../core`、`../../tools`（工具檔在 `tools/` 底下時是 `../../../`）。
  - `check-scope.mjs` 新增 `scopeOf()`：`project-site/<專案>/…` 判為該專案，`core/`、`tools/`、`studio/` 判為固定範圍，其餘是 root；pre-commit、`scope.yml` 的分支名稱規則不變。`scope-guard.mjs` 與各站 `.claude/settings.json` 的 hook 改成 `$CLAUDE_PROJECT_DIR/../../core/tools/scope-guard.mjs`。
  - `new-project.mjs` 建在 `project-site/`；`check.mjs`、`install-hooks.mjs`、`compare-review.py` 改用 `REPO`。根目錄 `tools/`、`scripts/`、`.gitignore`（`docs/`、ffmpeg）同步改路徑。
  - 7 站桌面截圖與搬移前 HEAD 比對 0 張超過門檻，review JSON 內容不變。
- 2026-10-04 core 1.4.0（studio P4 第二段：電控、電盤、配線、相機；用戶名稱檢查）：
  - `core/verify/electrical.mjs`（`checkElectricalPlan`、`verifyElectrical`）與 `core/verify/cables.mjs`（`checkCableScenarios`）：從根目錄 `tools/verify-electrical-plan.mjs`、`verify-cables.mjs` 抽出通用的判定，根目錄工具改成只組各站情境再呼叫 core（各站 `cables.json`、`electrical-plan-checks.json` 結果不變）。`tools/geometry-clearance.mjs`、`check-feedthroughs.mjs` 搬到 `core/verify/clearance.mjs`、`feedthroughs.mjs`，根目錄留轉接檔，各站工具不用改。
  - `check.mjs` 內建 `electrical`（快速）：場景有電控元件或電盤時檢查元件在櫃內（場景沒有電盤櫃時不檢查這條）、編號、機身重疊、櫃內連線、穿板孔；`project.js` 的 `verify.cables = { obstacles, interval, times, minRoutes }` 有宣告時另做配線動態取樣。結果寫入 `review/electrical-checks.json`，沒有電控的專案略過、不產生報告。現有 7 站都通過（ChemicalTankWashing 略過）。
  - `electrical-components.js` 匯出 `component({...})`；`populatePanel`／`controlPanel` 可以直接收元件表 `schedule`（原本只能用寫死在 core 的 `profile`），`controlPanel` 另外回傳 `devices`。現有 `profile` 寫法不變。
  - 新模型 `core/models/camera.js`（工業相機＋鏡頭＋環形光源，內含依感光元件與焦距算視角的虛擬相機、`fieldOfView(工作距離)`、`lensFov`），共 13 個參數化模型。
  - `core/examples/segment2/`：第二段的完整範例（電盤櫃、背板元件表、穿板接頭、龍門拖鏈、外露線路、立柱相機與相機線）與說明；`check.mjs` 的 `core · examples` 會跟著檢查。
  - `core/tools/check-names.mjs` 與 `check.mjs` 內建 `names`（快速）：專案資料夾不得出現本機名單（`.private/client-names.txt`、工作區 `.studio/client-names.txt`）裡的用戶名稱；pre-commit 也會掃。
  - 7 站桌面截圖與改前比對 0 張超過門檻；根目錄配線、電盤、干涉回歸全過。
- 2026-10-04 core 1.5.0（現有 5 站的配線檢查改用 core，根目錄配線與電盤工具退役）：
  - `verify.cables` 新增 `variants`（只給配線檢查的額外情境：配方、SKU）、`apply`、`times`（陣列或函式）、`minRoutes`；預設取樣點另外加上排程事件的起訖時間（標準事件 `{ time, dur }`與時間軸事件 `{ start, dur }` 都認得）。
  - `run.mjs`：結果改用全部情境判斷（原本 `project.json` 沒有 variants 時只看第一個情境，配線額外情境失敗也會通過、也不會寫進報告）；各情境的配線報告用情境名稱命名。
  - 新增 `core/anim/sampling.js`（`sampleTimes`、`stepTimes(steps, interval)`，網頁也能載入）；`core/verify/clearance.mjs` 的 `sampleTimes` 改成轉匯出它。`cable-routing.js` 匯出 `solidMeshes(root)`（去掉配線五金與平面的實體網格，給 `verify.cables.obstacles` 用）。
  - 酸鹼、MGPC、PCB、SSD、快門的 `project.js` 宣告 `verify.cables`（取樣間隔 0.1 s，快速檢查就會跑）。退役前逐情境比對：線路、支架、拖鏈、取樣數與穿板孔統計都和根目錄版相同，0 個失敗。
  - 退役：根目錄 `tools/verify-cable-routing.mjs`、`verify-cables.mjs`、`verify-electrical-plan.mjs`、`check-feedthroughs.mjs` 與 `tools/review/cable-checks.json`、`electrical-plan-checks.json`、各站 `review/cables.json`；`electricalActivity` 的斷言移到 `core/examples/segment2/check.mjs`。`tools/geometry-clearance.mjs` 轉接檔保留（各站工具還在用）。
- 2026-10-04 core 1.6.0（成品匯出：網站壓縮檔、單一 HTML、MP4）：
  - `core/tools/export.mjs`：匯出總入口（`--zip`、`--html`、`--mp4`，預設輸出 `TEMP/exports/`），匯出前後做用戶名稱檢查，有名稱就不留下成品。
  - 網站壓縮檔：`build-site.mjs` 可以只建指定專案；壓縮檔附 `open-demo.cmd`＋`tools/offline/serve.ps1`（Windows 內建 PowerShell 的本機伺服器，只聽 localhost），客戶電腦不必安裝軟體。zip 讀寫在 `tools/zip.mjs`（沒有 npm 套件，studio 的交接包也用）。
  - `tools/export-html.mjs`：單一 HTML，模組以 Blob URL＋importmap 內嵌、CSS 與 `new URL('…', import.meta.url)` 資源轉 data URL，`file://` 雙擊可開；附 `verifyHtml`（Chrome 以 file:// 開啟檢查錯誤、`window.sim`、畫布）。8 站約 1.5 MB，全部驗證通過。
  - `tools/export-mp4.mjs`：Node 版錄影接收端（取代 Python 的 `tools/movie-export/server.py`、`prepare.py`，已刪除），無頭 Chrome（GPU）開 `?movie&auto` 全自動錄製，ffmpeg NVENC／libx264，結束時用 ffprobe 核對影格數。`audit.py`、`verify.py` 保留。
  - `movie/movie.js`：`installMovie` 新增 `title`（片頭標題，原本只有 6 站的對照表）；沒有電控元件的專案略過電盤與整線鏡頭。現有各站的鏡頭不變。
  - 範本 `main.js` 接好 `?movie` 錄影（依時間軸事件運鏡、追焦工件），新專案建好就能匯出 MP4。
- 2026-10-04 core 1.7.0（錄影的鏡頭方向與片長）：
  - `installMovie` 的步驟可以帶 `offset`（這一步的鏡頭偏移，切換時約 2 秒平滑過渡）與 `speed`（展示倍率，>1 較快）；新增 `targetSeconds`（製程段等比例壓到指定總長，短動作保底 0.25 s）。使用者決定不設預設上限，由各站自己調。另外 1.6.0 之後補了 `far`（廠房級的站）與 `glandShots`。
  - 沒有用這些參數的站走原本的程式路徑：SSD 2782 格、MGPC 6503 格與改前相同。
  - 化學桶的 AGV 段落改從南側走道拍（原本只能把固定的西北偏移拉遠）；`storage.js` 的 `zAt` 修正（示範車道第 4 位不再是 NaN）。
- 2026-10-04 core 1.8.0（結構檢查：別的工具做的站也要符合架構）：
  - `core/tools/check-structure.mjs`＋`check.mjs` 內建 `structure`（快速）：`project.json` 欄位、規則檔、寫檔關卡、`docs/` 不進版控、favicon、importmap；跑全部專案時另查 `project-site/` 底下不是專案的資料夾。pre-commit 加上 `check-structure.mjs --staged`（只查這次提交到的站）。
  - 根目錄 `.gitignore` 改用 `/project-site/*/docs/`，新站不必再手動加；`new-project.mjs` 的提示跟著改。
  - 給不讀 `AGENTS.md` 的工具放指向檔：`GEMINI.md`（`@AGENTS.md`）、`.github/copilot-instructions.md`。
  - 8 站結構檢查全數通過，執行期程式沒有改變。
- 2026-10-05 core 1.9.0（市購小件拆成共用模型；各站外觀不變）：
  - 新模型 8 個（共 22 個），都是 `{ meta, create(參數) }`，目錄頁可預覽：
    - `core/models/indicators.js`：`signalTower`（三色燈）、`hmi`（人機介面：機身＋螢幕面板＋canvas 畫面＋文字貼紙）、`estop`（急停／復歸鈕，可加按鈕盒）。
    - `core/models/sensors.js`：`boxSensor`（盒型光電＋動作指示燈，id `sensor-led`）、`lightCurtain`（安全光柵一對）、`ftSensor`（六軸力覺感測器＋力值色環）。
    - `core/models/lights.js`：`barLight`（條形光）、`domeLight`（穹頂光＋聚光燈）。
    - `core/models/util.js`：`defaults`、`shadow`、`pick`。既有的 `sensor`（黑色機身＋紅色鏡片）外觀與用法不變。
  - 參數分兩種：`meta.params` 是目錄頁可調的數值；`meta.options` 是程式才傳的選項（材質、陣列、子物件設定）。外部傳入的材質原樣使用、不複製。
  - 目錄頁：原點在機身中心的小件會抬到地面上再顯示。
  - 各站原寫法與模型（照下表參數）逐網格比對相同：幾何型別與參數、頂點數、世界矩陣、材質屬性、陰影旗標，共 40 組。各站改用由各站另外進行。
  - 換用對照（root 的位置＝原本群組或方塊的位置；沒列的參數用預設值）：

    | 站 | 元件 | 參數 | root 位置與狀態 |
    |---|---|---|---|
    | PCB | 三色燈 | `{ pole: false, base: 40, shadow: false }` | `(EX−100, H1+50, Z0+60)`；`tower.set(k)` 不變 |
    | PCB | HMI | `{ w: 260, h: 170, d: 16, bevel: 0, bodyMaterial: MAT.screen, panel: false, text: { lines, w: 240, h: 150, options: { bg, color } } }` | `(0, 1250, Z1+12)` |
    | SSD、快門 | 三色燈 | `{ base: 40, colors: { red: 0xff3b3b, yellow: 0xffb020, green: 0x3dd68c }, lens: { opacity: .85 }, pole: { y: 0 }, shadow: { lamps: false } }` | `(ex−80, h+40, z0+80)`；`tower.set(k)` |
    | SSD、快門 | HMI | 同 PCB，`w: 210, h: 150`，`text: { w: 190, h: 125 }` | `(ex−150, 1300 或 1250, z1+12)` |
    | SSD、快門 | 急停 | `{ collarZ: 10, capZ: 20 }` | `(ex−150, 1150 或 1110, z1)` |
    | SSD | 感測器 | `{}` | `(x, top+22, rearInner−14)`；`led: s.led` |
    | SSD | 全局光源 ×2 | `{ axis: 'x', housing: false, length: 260, lensT: 12, lensW: 30, lensMaterial: gLightMat }` | gcam 內 `(0, 20, ±70)`；`ko(bar.lens, '全局光源')` |
    | SSD | 手腕條形光 | `{ axis: 'x', housing: false, length: 100, lensT: 10, lensW: 16, bevel: 6, lensMaterial: lightMat }` | camMount 內 `(0, 30, 52)` |
    | SSD | 力覺感測器 | `{}` | `tool.add(ft.root)`；`setForceColor = ft.setForce` |
    | MGPC | 三色燈 | `{ height: 36, base: 10, pitch: 40, colors: 同 SSD, lens: { opacity: .85 }, pole: { r: 8, h: 300, y: −150, segments: 24 }, shadow: { lamps: false } }` | `(stationX[4]−450, top+320, −300)` |
    | MGPC | HMI（櫃、堆料架） | 櫃 `{ w: 500, h: 300, d: 20, bevel: 0, bodyMaterial: MAT.screen, panel: false, text: { lines, w: 390, h: 220, z: 12, options } }`；堆料架 `{ w: 160, h: 110, d: 14, bevel: 0, bodyMaterial: MAT.screen, panel: false }` | `(−3300, 1350, −40)`；`(0, 1500, D/2+10)` |
    | MGPC | 急停 | `{ collarR: 24, capH: 20, collarZ: 0, capZ: 10 }` | `(−3120, 1080, −40)` |
    | MGPC | 感測器 | `{ ledY: 11 }` | `(x, top+12, 210)`；`led: s.led` |
    | MGPC | 光柵 | `{ span: 2*endX, height: 900, w: 30, d: 30, material: MAT.yellow, window: false, beam: false }` | occ 內 `(0, 0, 900)` |
    | MGPC | 力覺感測器 | `{ radius: 44, height: 34, tube: 2.2, thresholds: [2, 8] }` | `tool.add`；`toolParts` 用 `ft.body` |
    | MGPC | 穹頂光 | `{ radius: LAYOUT.s1DomeR, material: matDome }` | head 內 `y = domeRim`；`dome.dome.name = 'S1 穹頂光'`；`topFlash = dome.light` |
    | WM | 三色燈 | `{ radius: 16, height: 28, segments: 24, base: 30, pitch: 30, colors: { red: 0xff3b30, yellow: 0xffc400, green: 0x2ee67a }, lens: { roughness: .35, opacity: .92 }, on: 1.8, off: .05, pole: { size: [10, 40, 10], y: 25, material: MAT.frame }, shadow: { lamps: false } }` | deco 內 `(330, top, −230)`；`setTower = k => tower.set(k)` |
    | WM | HMI | `{ w: 370, h: 235, d: 22, bevel: 0, bodyMaterial: MAT.axis, panel: false, display: { w: 340, h: 205, z: 11.75, canvas: [680, 410] } }` | `(470+HX, top−110, 270)`，`root.rotation.y = −.45; x = −.12`；`drawScreen` 用 `panel.canvas`／`panel.texture`，或 `panel.drawText(lines, { accent: color })` |
    | RS | 三色燈 | `{ name: 'tower', radius: 34, height: 46, segments: 18, lamps: ['green', 'amber', 'red'], base: 30, pitch: 48, materials: { red: MAT.red, amber: MAT.amber, green: MAT.green }, pole: { r: 26, h: 150, y: 75, segments: 18, material: MAT.black } }` | frame 內 `(−f.postX, f.top, PZ[0])`；`towerLights = [t.lamps.red, t.lamps.amber, t.lamps.green]`，換材質的寫法不變 |
    | RS | HMI | `{ w: hw, h: hh, d: hd, bevel: 12, panel: { w: 480, h: 270 }, display: { w: 468, h: 258, mipmaps: false } }` | hmi 群組內 `(hm.x, hm.y, hm.z)`；畫面用 `panel.ctx`／`panel.texture` |
    | RS | 急停、復歸 | 急停 `{ collarR: 25, capR: 18, capH: 14, collarZ: −6, capZ: 2, collarMaterial: MAT.amber, capMaterial: MAT.red, box: { size: [76, 65, 16] } }`；復歸 `{ reset: 1, collarR: 13, capR: 10, capH: 14, collarZ: −6, capZ: 2, box: { size: [52, 65, 16] } }` | `(−560 或 −500, 1250, 680)` |
    | RS | 光柵 | `{ span: 1750, height: 1200, w: 40, d: 36, window: { gap: .5, offset: −10 }, brackets: { ys: [40, 1160] }, beam: false }` | frame 內 `(0, 400, 620)`；光幕面留在 marks |
    | RS | 條燈（前後段） | `{ length: ledLen, lensOffset: [−side*20*Math.SQRT2, 0], lensMaterial: LED_ON }`，`side = lx < x ? −1 : 1` | `(lx, ledY, bz)`，`root.rotation.z = side*Math.PI/4`；`leds.push(bar.lens)` |
    | 化學桶 | 三色燈 | `{ radius: 45, height: 90, segments: 28, base: 10, pitch: 95, on: 1.2, off: .05, lamps: [{ key: 'fault', material: 'red' }, { key: 'wait', material: 'amber' }, { key: 'run', material: 'green' }], pole: { r: 25, h: 1950, y: −1025, segments: 12, material: MAT.steel } }` | `(FENCE[1][0]+100, 2000, FENCE[1][1]+100)`；原本的 `rod` 刪掉；`setTower(s) { tower.set(s); }` |
    | 化學桶 | HMI | `{ w: 380, h: 280, d: 50, bevel: 0, bodyMaterial: MAT.screen, panel: false }` | `(cx, 1250, cz)`，`root.rotation.x = −.35` |
    | 化學桶 | 光柵 ×4 | `{ span: w, axis: ax, height: 1700, w: 50, d: 50, window: false, beam: false }` | fences 內 `(x, 0, z)` |

## 版本

| 版本 | 日期 | 內容 |
|---|---|---|
| 1.9.0 | 2026-10-05 | 市購小件共用模型：三色燈、HMI、急停、盒型感測器、安全光柵、力覺感測器、條形光、穹頂光（`models/indicators.js`、`sensors.js`、`lights.js`） |
| 1.8.1 | 2026-10-05 | ffmpeg／ffprobe 的預設位置改成共用的 `tools/bin/`（原本在軍規專案的 `tools/bin/`）；`setup.ps1 -Ffmpeg` 會把舊位置的搬過去 |
| 1.8.0 | 2026-10-04 | 結構檢查 `structure`（check、pre-commit）、`docs/` 萬用忽略規則 |
| 1.7.0 | 2026-10-04 | 錄影步驟 `offset`／`speed`、`targetSeconds`、`far`、`glandShots` |
| 1.6.0 | 2026-10-04 | 成品匯出（`export.mjs`：網站壓縮檔、單一 HTML、MP4）、`zip.mjs`、離線伺服器、範本接上錄影；Python 錄影接收端退役 |
| 1.5.0 | 2026-10-04 | `verify.cables` 的 variants／apply／times、結果判斷修正、`core/anim/sampling.js`、`solidMeshes`；根目錄配線與電盤工具退役 |
| 1.4.0 | 2026-10-04 | 通用電控與配線檢查（`electrical`）、元件表 `schedule`、相機模型、第二段範例、用戶名稱檢查（`names`） |
| 1.3.0 | 2026-10-04 | 專案搬進 `project-site/`；`REPO`、`PROJECTS_DIR`、`scopeOf` |
| 1.2.0 | 2026-10-04 | 排程指紋、效能量測、舞台登記 |
| 1.1.0 | 2026-10-04 | 工作區模式（studio）；new-project 複製後設為可寫 |
| 1.0.0 | 2026-10-04 | 開始編號：搬庫後、第四輪統一完成時的 core |
