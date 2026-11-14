# 軍規電腦檢測系統（`MilitaryGradePC`）

DENSO VM-60B1 搭配第七軸，完成軍規筆電的翻轉、接口取像與檢測。

本檔是這個子專案的規則；全庫共通的規則在根目錄 `AGENTS.md`，從這個資料夾啟動 Claude Code 或 Codex 時會一併載入。

## 範圍

- 本站範圍是 `project-site/MilitaryGradePC/`；PR 分支名稱用 `militarygradepc/<說明>`。規則見根目錄 `AGENTS.md`「範圍」。
- core 缺功能：先在本站暫代，並登記到 `core/REQUESTS.md`。
- 待辦與待確認事項記在根目錄 `PENDING.md`「各站待確認」。

## 規格摘要

- 資料來源：產品外觀檢驗規範（QII，PDF）、一張工單（PDF）與實機照片（使用者提供，只留本機）；本站自寫的 `docs/phase1-scope.md`（檢驗映射、排除項目、工程假設）、電控與配線紀錄、電路圖、2026-09-26 的成本試算（`docs/` 只留本機）。照片只用來重建外形，配置以工單為準。
- 範圍（第一階段）：閉合、未接電的軍規筆電，做可見外觀、側邊護蓋與翻面底部檢查；FT、標籤、模組拆拔、Recover、摔機、包材等仍由其他工位負責。
- 製程：S0 進料（升降堆料架、SN 讀碼、四角側夾定位）→ S1 閉合外觀（懸臂取像頭頂視＋手臂四側取像＋接縫線雷射）→ S2 側邊護蓋（6 個護蓋逐門開門、連接器取像、閉門鎖定；2 個電池門只檢外觀與封印）→ S3 翻面（翻轉治具抬升 210 mm 翻轉，底面印刷／SN／Docking／螺絲腳墊取像）→ S4 出料（OK 入堆料架、NG 停在 S4 待人工覆判）。
- 手臂：DENSO VM-60B1＋RC8A＋TP-RC8（core `createVM60B1`，P-00027），第七軸滑軌（P-00034，滑軌 z = −560、可用行程 ±1100 mm）上 600 mm 立座；力覺末端 ATI Axia80-M20（P-00032）＋手臂相機 IDS GV-5890FA-C-HQ（P-00040）＋環形光（P-00042）＋鉤爪／壓頭＋線雷射 LMI Gocator 2520（P-00047）。
- 視覺：S1 頂視相機 IDS GV-5800SE-M-GL（P-00035）＋12 mm 鏡頭（P-00036）＋穹頂光（P-00037）；S0 SN 讀碼器 Keyence SR-X 系列（P-00048）。
- 輸送與機構：Bosch Rexroth TS 2plus 雙帶載具輸送（P-00052）、S1 取像頭電動滑台 SMC LEFB 行程 800（P-00051）、翻轉夾爪 SMC LEHF 級（P-00064）、翻轉龍門框架（P-00061，橫樑 1800 mm）、載具 RFID（P-00091）。
- 控制與安全：Keyence KV-X 系列 PLC（P-00065）＋KV-XH16EC（P-00066）、維修 HMI VT5（P-00075）、安全控制器 GC-1000（P-00078）、安全光柵 GL-R（P-00081）、DENSO Safety Motion（P-00090）。
- 節拍（模擬）：一台 241 步，規劃週期 347.75 s；連續播放加上到位等待約 362 s。不是實機節拍承諾。
- 關鍵尺寸：產品 300 × 210 × 36 mm、載具 440 × 330 × 40 mm、堆疊節距 110 mm、輸送面高 760 mm、站距 1000 mm；S1 前側單邊懸臂、S3 在 x 1150。
- 假設（示意）：產品與載具尺寸沿用概念值；VM-60B1 的基座高度、手腕長度與關節零點方向待 DENSO CAD 核對；相機工作距離 150 mm、力值 2／8／12 N、門扣 3 mm、開門 100°、接近速度 ≤ 50 mm/s 都是工程示意。
- 數位孿生：本站是 AutoSequence 數位孿生的示範站（MD 在 `twin/`，綁定在 `web/js/twin-binding.js`）。
- 完整說明見 [README.md](README.md)。

## 已拍板事項

- 全場干涉一律修正，可以加步驟、可以調站位：S3 移到 x 1150，週期從 329.75 s 變成 347.75 s。
- 選型：DENSO VM-60B1＋RC8A、Keyence KV-X、IDS GigE 相機。
- 採路線 B：六軸手臂＋F/T 力覺末端＋工業相機／線雷射、五站載具輸送、進出料升降堆料架及翻轉治具。
- 第一階段只做閉合、未接電產品的可見外觀、側邊護蓋與翻面底部檢查；工單的其他項目由其他工位負責。
- 標準配方不含 RF／GPS；HDD 只開門取像不拔除；電池保持封印、只檢外觀與封印。
- 底面 Docking 是外露接點（照片確認），不畫護蓋、不做開蓋動作。
- 本站是 AutoSequence 數位孿生的示範站（2026-10-21；2026-11-11 起 SPE 孿生是 AutoSequence 的選配外接後端）：孿生用的 MD 是 Automation-Schema 範例的原樣複本（`twin/`，從 tag 取出、不得手改，與 AutoSequence/schema 的同名範例內容相同，來源記在 `twin/SOURCE.md`）；場景綁定用 MD 的邏輯路徑，由 `web/js/twin-binding.js` 對照；`act-S3-PCLAMP` 維持 unbound。改 `cell.js`、`project.js` 的狀態或物件時，要同時跑 `tools/verify-twin.mjs`（快速檢查已列入）。
