# 環境需求與安裝

clone 之後執行一次：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1          # 檢查必要環境＋快速檢查
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -All     # 另外建立 Python 環境、下載 ffmpeg
```

## 必要（3D 展示、開發、檢查）

| 項目 | 版本 | 用途 | 安裝 |
|---|---|---|---|
| Node.js | 22 以上（開發機 24.21，CI 用 22；studio 的元件資料庫要 22.13 以上） | 本機伺服器、統一檢查、截圖、Pages 建置、studio 命令列；**3D 專案與 core 不需要 npm 套件** | `winget install OpenJS.NodeJS.LTS` |
| Chrome 或 Edge | 近期版本 | 瀏覽器檢查（`ui-check`、`shots`、各專案 browser 檢查）用 DevTools Protocol 驅動無頭瀏覽器 | Windows 內建 Edge 即可；其他路徑設環境變數 `CHROME_PATH` |
| Git | 任何近期版本 | 版控；回歸比對用 `git worktree` 拍基準截圖 | `winget install Git.Git` |

three.js 與 Rapier 已放在 `core/vendor/`，不需要網路或套件管理器。

vs3d 網頁介面（`studio/ui/`，React＋Vite）是唯一用到 npm 套件的地方：`scripts\start.cmd` 第一次啟動時會自動 `npm install` 並建置（npm 隨 Node.js 安裝）。vs3d 的代理另外需要 Claude Code 或 Codex CLI，說明見 `studio/README.md`。

## 選用（只有特定工具需要）

| 項目 | 需要的工具 | 安裝 |
|---|---|---|
| Python 3.12＋`requirements.txt` | 錄影稽核與驗證（`tools/movie-export`）、電路圖（`tools/circuit-drawings`）、回收物分揀的視覺品項表（`project-site/RecycleSorter/tools/build_vision_items.py`）、`core/tools/compare-review.py` | `setup.ps1 -Python`（建立 `.venv` 並安裝） |
| ffmpeg／ffprobe（支援 NVENC 的 Windows 版） | MP4 錄影輸出（`core/tools/export-mp4.mjs`、影片驗證） | `setup.ps1 -Ffmpeg` 下載到共用的 `tools/bin/`（不進版控）；也可用 `-FfmpegZip <本機 zip>` |
| Automation-Schema（相鄰 checkout，指定 tag） | 數位孿生 server（`core/tools/twin.mjs`）與它的檢查：協定驗證、mdHash；SPE 不複製它的任何檔案 | 在 SPE 旁邊 `git clone <Automation-Schema> ..\Automation-Schema`，再 `git -C ..\Automation-Schema checkout <tag>`（tag 見 `core/twin/automation-schema.lock.json`）；`setup.ps1` 會檢查並提示。驗證工具 `validate.py` 另需 uv |
| 中文 TrueType 字型 | 電路圖 PDF（reportlab） | 預設 `C:/Windows/Fonts/msjh.ttc`（微軟正黑體）；其他字型設 `CIRCUIT_FONT` |
| poppler `pdftoppm` | 電路圖驗證時把 PDF 轉成 PNG（`tools/circuit-drawings/verify.py --render`） | 安裝 poppler 後設 `PDFTOPPM` 指向 `pdftoppm.exe` |

## 環境變數

| 變數 | 用途 | 預設 |
|---|---|---|
| `CHROME_PATH` | 指定瀏覽器執行檔 | 依序找 Chrome、Edge 的標準安裝路徑 |
| `FFMPEG_PATH` | 指定 ffmpeg 執行檔（MP4 錄影輸出、studio、影片驗證） | 共用的 `tools/bin/ffmpeg.exe`，再找 PATH |
| `CLIENT_NAMES` | 補充用戶名稱名單（逗號分隔，`check-names.mjs` 與 `names` 檢查會合併） | （無；名單本體在 `.private/client-names.txt`） |
| `UI_PORT` | `check.mjs` 內建 `ui` 檢查用的 port（平行跑檢查時錯開） | 8771 |
| `SPE_AUTOMATION_SCHEMA` | Automation-Schema 的位置（孿生 server、`twin` 檢查） | SPE 根目錄的上一層 `..\Automation-Schema` |
| `CIRCUIT_FONT` | 電路圖字型 | `C:/Windows/Fonts/msjh.ttc` |
| `PDFTOPPM` | poppler 的 pdftoppm | （無，需要時指定） |

## 常用 port

| port | 用途 |
|---|---|
| 8770 | `node core/tools/serve.mjs`（本機展示首頁；`scripts\start.ps1` 也用它） |
| 8780 | `node studio/vs3d.mjs ui`（vs3d 網頁介面；`scripts\start.ps1` 也用它） |
| 8771 | `check.mjs` 的 `ui` 檢查（`UI_PORT`） |
| 8790 | `shots.mjs` 預設（`--port` 可改） |
| 5173 | `npm --prefix studio/ui run dev`（vs3d 介面開發模式，`/api` 轉給 8780） |
| 8810～8819 | `core/tools/export-mp4.mjs` 錄影接收端 |
| 8795 | `core/tools/perf-check.mjs` 預設（`--port` 可改） |
| 7600 | `core/tools/twin.mjs` 孿生 server（TCP，AutoSequence Twin Hub 連入；`--port` 可改） |
| 8776 | `core/tools/twin.mjs --sse 8776` 孿生觀看（SSE；網頁 `?twin=8776`） |

## 不進版控的東西

- **各專案的 `docs/`**：使用者提供的圖面、照片、影片、規劃與成本資料，只留本機。新專案也要把 `docs/` 加進 `.gitignore`。
- **`TEMP/`、`LOGS/`、`*.log`、`.venv/`、`_site/`、`node_modules/`、`studio/ui/dist/`**：本機產物。
- **`studio/data/`**：元件資料庫、附件、帳號、API 金鑰等 studio 的本機資料。
- **`.private/`**：用戶名稱名單（`client-names.txt`）。
- **ffmpeg 執行檔**：由 `scripts\setup.ps1 -Ffmpeg` 下載。
