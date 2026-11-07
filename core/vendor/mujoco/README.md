# MuJoCo（手臂動力學）

- 套件：`@mujoco/mujoco` 4.0.0（2026-11-06，Google DeepMind 官方的 JavaScript／WebAssembly 綁定；官方標示仍在開發中，約兩週一版）
- 授權：Apache-2.0（`LICENSE`，從 MuJoCo repo 的 4.0.0 tag 取得；npm 套件本身沒附）。wasm 裡另外編進的第三方程式：tinyxml2（zlib）、tinyobjloader（MIT）、libccd（BSD-3）、qhull（Qhull License）、miniz（MIT）、abseil（Apache-2.0）。
- 來源：https://github.com/google-deepmind/mujoco （`wasm/`）
- 檔案：
  - `mujoco.js`（約 290 KB）：Emscripten 產生的 ESM 載入程式，原樣。
  - `mujoco-wasm.mjs`（約 2 MB）：單執行緒版 wasm 去掉自訂 section（11.2 MB → 5.2 MB，code 與 data 不變）後 gzip＋base64。`core/robot/dynamics.js` 用 `DecompressionStream` 解開後以 `wasmBinary` 交給載入程式，所以不另外載 `.wasm`，伺服器 MIME 不對也沒關係，單一 HTML 匯出也能內嵌。
  - 不放多執行緒版（`mt/`，要 COOP/COEP 標頭，Pages 與離線檔都不適合）、`.wasm.map`、`.d.ts`。
- 只由 `core/robot/dynamics.js` 引用，站不要直接 import。
- 更新：在 `TEMP/` 的空資料夾 `npm pack @mujoco/mujoco@<版本>`、解開，執行 `node core/tools/vendor-mujoco.mjs <package 資料夾>`，改這份說明的版本，跑 core 的 `dynamics` 檢查並記進 `core/MIGRATION.md`。換版後扭矩的雜湊會變（3.17 → 4.0 最大差 1.4e-14 N·m），檢查只比 Node 與瀏覽器、前後兩次，不鎖固定雜湊。
- 原型與評估：本機 `TEMP/mujoco-proto/`（2026-11-07）。
