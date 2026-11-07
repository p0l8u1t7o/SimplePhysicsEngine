# laz-perf（LAZ 點雲解壓）

- 套件：`laz-perf` 0.0.7（Hobu Inc.，LASzip 壓縮格式的 C++ 實作編成 WebAssembly）
- 授權：Apache-2.0（`LICENSE`，取自 https://github.com/hobuinc/laz-perf 的 `COPYING`；npm 套件本身沒附）
- 檔案：
  - `laz-perf.mjs`（約 85 KB）：npm 套件 `lib/web/laz-perf.js` 原樣，最後加一行 `export default createLazPerf;`（原本是 UMD，ESM 裡 module.exports／define 的分支不會執行）。
  - `laz-perf-wasm.mjs`（約 280 KB）：`lib/web/laz-perf.wasm` 的 base64；`core/geo/laz.js` 解開後以 `wasmBinary` 交給載入程式，所以不另外載 `.wasm`。
- 只由 `core/geo/laz.js` 引用。OpenDroneMap 預設輸出的點雲是 LAZ。
- 更新：在 `TEMP/` 的空資料夾 `npm pack laz-perf@<版本>`，照上面兩點重新產生兩個檔（2026-11-07 用 node 一次產生，作法見 `core/MIGRATION.md` 1.20.0），跑 core 檢查 `engineering`（`geo/test/las.test.mjs` 用 laspy 寫的 LAZ 對照 LAS 逐點比對）。
