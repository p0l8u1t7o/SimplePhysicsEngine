# 3D 專案 MP4 展示輸出（2026-09-29 運鏡與穩定性修正版）

## Node 版（建議）：`node core/tools/export-mp4.mjs <專案>`

全自動，不必開瀏覽器按按鈕：用 `core/tools/build-site.mjs` 建單站網站副本（`TEMP/mp4-export-*`，結束即刪），在 127.0.0.1:8810～8819 開接收端（端點與資料格式同 `server.py`），以無頭 Chrome／Edge（新模式、D3D11 GPU）開 `/<專案>/?pause&movie&auto`，影格送進 ffmpeg（NVENC 可用就用，否則 libx264），最後用 ffprobe 核對影格數。

- 成品預設在 `TEMP/videos/<專案>-<日期>/<專案>_1080p30.mp4`＋`.shots.json`（`verify.py --output` 可直接用），也可指定 `node core/tools/export-mp4.mjs <專案> <輸出資料夾>`。已有成品時不覆寫。
- 選項：`--port`、`--encoder auto|h264_nvenc|libx264`、`--ffmpeg`（否則 `FFMPEG_PATH` ＞ 共用的 `tools/bin/ffmpeg.exe` ＞ PATH）、`--chrome`（否則 `CHROME_PATH`）、`--samples`（另存抽查影格）、`--manual`（只開接收端，用自己的瀏覽器按「檢查鏡頭與固定影格」等按鈕）。
- 每 5% 印一行進度；Ctrl+C 會關掉 Chrome、ffmpeg 與伺服器並刪掉未完成的成品。
- 程式內使用：`import { exportMp4 } from './core/tools/export-mp4.mjs'`，`await exportMp4(專案, 輸出資料夾, { log, port, ffmpeg, encoder, chrome, signal })` 回傳 `{ file, frames, seconds, duration, size, encoder, gpu, warnings }`。

Python 版的接收端（`prepare.py`、`server.py`）已於 2026-10-04 退役；`audit.py`、`verify.py` 仍可用來稽核成品。vs3d 的專案在介面按「錄影 MP4」或 `vs3d export <專案> --mp4`。

## 錄影規格與運鏡

錄影程式在 `core/movie/movie.js`：各專案在自己的 `main.js` 於網址帶 `?movie` 時呼叫 `installMovie()`，並在那裡提供本站的取樣、追焦與細節重播設定（範本已經接好）。手動預覽可以在 `node core/tools/export-mp4.mjs <專案> --manual` 開的頁面拖曳時間軸、按「檢查鏡頭與固定影格」。

- 網站副本在 `TEMP/mp4-export-*`（結束即刪），成品與抽查影格在 `TEMP/videos/`，均由 `.gitignore` 排除。
- GPU WebGL 以 3840×2160 取樣後縮至 1920×1080、30 fps，改善細線與金屬邊緣閃爍。接收器實際試編碼後優先使用 NVENC H.264；不可用時回退 libx264。使用共用的 `tools/bin/ffmpeg.exe`（`scripts\setup.ps1 -Ffmpeg` 下載，不進版控）。
- 每一步依絕對時間渲染、確認影格順序後送入編碼器，不依賴螢幕更新率。保留完整製程順序，長製程展示加速，短動作延長供觀察。
- 開場 12 秒：依設備外廓自動框入整機，先停留 3 秒，再以 9 秒緩慢拉近。拉遠製程追焦距離，以絕對時間預算並平滑焦點，避免取放對象切換時跳鏡頭。
- 錄製副本使用對數深度及合理 near plane，固定繪圖緩衝區大小，提高陰影解析度並抑制過尖的金屬高光。取像頻閃的製程事件／LED 保留，影片不使用頻閃聚光燈照亮整個場景。
- 資訊約 2 秒後淡出。後段保留電盤剖視、元件與周圍配置、整線、穿板接頭，以短疊化銜接，避免鏡頭穿越桌板。接頭鏡位另檢查中心及周邊遮擋。
- PCB 原始模型是五站並行節拍，先保留完整節拍，再依上／下料軌道、供料震動及植入事件選取細節重播，以原速或更慢展示，不再將完整節拍擠進幾秒造成龍門閃過；不宣稱追蹤同一片基板經過原模型未建立的多節拍排程。
- 可拖曳預覽時間軸抽查鏡頭。錄製時保持瀏覽器及本機服務運行；中斷後同一服務可從已接收的下一影格接續。
- 點選「檢查鏡頭與固定影格」輸出全景、推近、製程及細節抽查圖，並在固定時間重畫 10 次；`python tools/movie-export/audit.py --output TEMP/videos/revised-20260929` 產生 contact sheet 與量化差異。
- `python tools/movie-export/verify.py --output TEMP/videos/revised-20260929` 以 FFprobe 比對總影格與時間、檢查完整製程連續性、解碼全片、檢查黑影格與單影格大面積閃光候選。另在 TEMP 產生抽查圖與驗證 JSON；這些數值不能取代目視檢查運動與局部反光。
- 接收端不覆寫成品：預設資料夾已有成品時自動改用 `-2` 結尾的新資料夾，指定的資料夾已有成品就報錯。全部影片、稽核圖與中間檔保持在忽略的 TEMP 中。
- `node --test tools/movie-export/test-camera-path.mjs`（測 `core/movie/camera-path.mjs`）驗證追焦交接不瞬移、不過衝，以及開場停留和推近的連續性。

## WorkpieceMeasurement 單獨輸出

1. `node core/tools/export-mp4.mjs WorkpieceMeasurement TEMP/videos/workpiece-<日期>`（要先看鏡頭時加 `--manual`，在開出的頁面按「檢查鏡頭與固定影格」）。
2. `python tools/movie-export/audit.py --output TEMP/videos/workpiece-<日期>`。
3. `python tools/movie-export/verify.py --output TEMP/videos/workpiece-<日期> --project WorkpieceMeasurement`。

此站保留上方護罩與立柱，開場完整框入機台後緩慢推近，製程以較寬的產品跟隨視角呈現。完整 B 規格合格流程依序播放後，另重播 ST1 夾持取像、ST2 共焦量測、X／Z 拖鏈全行程與光纖補償環，最後展示桌板穿線護口、電盤剖視、PLC／電源與整線配置。所有製程影格使用同一個絕對時間取樣器；重播段在標題註明，不能當作另一件工件或實際節拍。

影片只擷取 3D 畫布與約 2 秒的階段文字，不擷取網頁資訊側欄。輸出使用 4K 超取樣縮至 1080p／30 fps，JSON 保留實際 GPU、編碼器、每段製程時間與影片影格對照。固定時間重畫、全片解碼及時間閃光檢查仍需搭配全尺寸目視抽查，不能據單一指標保證所有細部反光完全不閃。
