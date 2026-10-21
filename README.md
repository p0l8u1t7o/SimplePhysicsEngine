# SimplePhysicsEngine 專案展示與研究

每個子專案的程式、模型、資料與說明均放在 `project-site/` 底下自己的資料夾；之後新增的專案也放在這裡。

| 子專案 | 用途 |
| --- | --- |
| [AutomaticAcid-BaseTitration](project-site/AutomaticAcid-BaseTitration/) | 自動酸鹼滴定 |
| [ChemicalTankWashing](project-site/ChemicalTankWashing/) | 200L 化學桶自動清洗線、夾具與相機追蹤 |
| [MilitaryGradePC](project-site/MilitaryGradePC/) | 軍規電腦自動檢測 |
| [PCB-CopperAssembly](project-site/PCB-CopperAssembly/) | 基板與散熱板組裝 |
| [RobotArmPressSSD](project-site/RobotArmPressSSD/) | SSD USB 銀腳壓合 |
| [shutter assembly](project-site/shutter%20assembly/) | 快門葉片與上蓋組裝 |
| [WorkpieceMeasurement](project-site/WorkpieceMeasurement/) | 杯體加工件 AOI 與共焦量測 |
| [RecycleSorter](project-site/RecycleSorter/) | 回收物自動分揀展示機（雙相機立體視覺＋SCARA 同步帶速取放；由 vs3d 產生） |
| [SolarDismantling](project-site/SolarDismantling/) | 太陽能板拆框機器人上下料（A/B 雙工位、拆框機訊號交握） |
| [PlumbingFixtureInspection](project-site/PlumbingFixtureInspection/) | 水五金外觀 AOI 檢測機（匯入 CAD 自動產生產品檔） |
| [WheelHangingAutomaticLine](project-site/WheelHangingAutomaticLine/) | 輪框吊掛線手臂下掛（手臂搭載雙眼立體視覺追蹤吊掛線） |
| [ParkingEMS](project-site/ParkingEMS/) | 停車場光儲充能源服務（三種場型的建置流程與全天 EMS 調度） |
| [StatorHeightMeasurement](project-site/StatorHeightMeasurement/) | 定子轉子自動下料與高度檢測（沖壓機出口 SCARA 擺盒；整盒／逐顆 × 雷射／視覺四種量測方案） |

所有 3D 專案共用 [core](core/README.md)：three.js、基本形狀、手臂與模型庫、時間軸、渲染舞台、播放列、錄影程式、統一檢查與 Pages 建置都只有一份，各專案以 `@core/` 直接引用。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 [-All]   # clone 後執行一次：檢查環境（-All 另建 Python 環境、下載 ffmpeg）
scripts\start.cmd                             # 啟動 vs3d 介面（8780）；-Site 開展示網站（8770）、-All 兩個都開、-Station <名稱> 開某一站
scripts\stop.cmd                              # 停止
node core/tools/serve.mjs                     # 只開展示網站（前景執行），首頁 http://127.0.0.1:8770/
node core/tools/check.mjs                     # 全部專案完整檢查（結構、用戶名稱、倒序一致、空間檢核、干涉與閃爍、配線與電盤、物理、BOM、介面互動、各專案自有檢查）；--quick 是部署前的快速檢查
node core/tools/new-project.mjs <名稱> "<標題>"  # 由範本建立新專案
```

- 各 3D 專案（`project-site/<專案>/`）：`web/` 為網站（`web/js/project.js` 是網頁與檢查共用的場景）、`project.json` 為首頁說明與檢查清單、`tools/` 為專案自有檢查、`review/` 為檢查結果、`docs/` 為本機參考資料。
- 共用模型目錄：本機 http://127.0.0.1:8770/core/catalog/，Pages 上為 `/core/catalog/`。
- [tools](tools/)：跨專案的干涉回歸、跨站視覺檢查、電路圖與錄影稽核工具（配線與電盤檢查是 core 的 `electrical`，MP4 輸出是 `core/tools/export.mjs --mp4`）；`tools/docs/` 是跨專案研究文件，`tools/review/` 是彙總結果。
- [GitHub Pages 部署](tools/github-pages/README.md)：`.github/workflows/pages.yml`，PR 只跑快速檢查；推送到 `main` 時先跑快速檢查，通過才發布；首頁依各專案 `project.json` 自動產生。
- `TEMP/`、`LOGS/`（不分大小寫）、`*.log` 與快取不納入版控。成品匯出（`core/tools/export.mjs`：網站壓縮檔、單一 HTML、MP4）預設放在 `TEMP/exports/`，不隨網站發布。
- 3D 專案只需 Node.js 22 以上與 Chrome／Edge，不需 npm 套件；選用工具的 Python 套件與 ffmpeg 等見 [REQUIREMENTS.md](REQUIREMENTS.md)。
- [數位孿生](core/twin/README.md)：AutoSequence 的 Twin Hub 以 TCP 連進 SPE 驅動虛擬機台（`node core/tools/twin.mjs MilitaryGradePC --port 7600 --sse 8776`，網頁 `?twin=8776` 觀看）；需要相鄰 checkout 的 Automation-Schema。
- [AGENTS.md](AGENTS.md)：給 Claude Code 與 Codex 的共通規則（合作方式、範圍、框架慣例、檢查流程、踩坑紀錄）；[CLAUDE.md](CLAUDE.md) 以 `@AGENTS.md` 引用。各站規則與拍板紀錄在各站的 `AGENTS.md`，待辦事項在 [PENDING.md](PENDING.md)。
- 範圍檢查：從子專案資料夾啟動的代理只能改該站（pre-commit、PR 的 `scope.yml`、各站 `.claude/settings.json` 寫檔關卡）；clone 後執行 `scripts\setup.ps1` 或 `node core/tools/install-hooks.mjs` 安裝 hook。
- [studio](studio/README.md)：3D工作室（`vs3d` 命令列＋網頁介面）：由代理產生 3D 設備動畫，兼自動化專案評估平台（元件庫、可行性、BOM 與成本表、光學與 AOI）。網頁介面的 npm 套件只放在 `studio/ui/`。
- [scripts](scripts/)：環境設定（`setup.ps1`）、網頁啟動與停止（`start`／`stop`，`.cmd` 可以點兩下）、[搬庫腳本](scripts/migrate/README.md)。
