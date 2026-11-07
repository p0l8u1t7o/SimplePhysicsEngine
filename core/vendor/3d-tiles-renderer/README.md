# 3d-tiles-renderer（3D Tiles 串流載入）

- 套件：`3d-tiles-renderer` 0.5.3（NASA-AMMOS，Apache-2.0，`LICENSE`）。0.5.4 在 2026-11-03 發布，未滿兩週，先用 0.5.3。
- 來源：https://github.com/NASA-AMMOS/3DTilesRendererJS（npm 套件的 `build/`）
- 檔案：只放 three.js 版需要的 `index.three.js`、`renderer-CUfHAmYW.js`、`renderer-_7gAivIK.js`（原樣，只拿掉 `sourceMappingURL` 註解；map 檔沒放）。外掛（`index.three-plugins.js`：DRACO、KTX2、Cesium Ion、Google 3D Tiles 等）沒放；壓縮圖磚之後要用時再加。
- 依賴：`three`、`three/addons/loaders/GLTFLoader.js`、`three/addons/utils/BufferGeometryUtils.js`（放在 `../addons/`，r187 原樣；GLTFLoader 另外用到 `utils/SkeletonUtils.js`）。
- 只由 `core/geo/tiles.js` 引用，站不要直接 import。
- 更新：在 `TEMP/` 的空資料夾 `npm pack 3d-tiles-renderer@<版本>`、解開，比對 `build/index.three.js` 引用的檔名（打包後的檔名有雜湊，換版會變），複製後刪掉 `//# sourceMappingURL` 那一行，跑 `node --import ./core/tools/register.mjs --test core/geo/test/tiles.test.mjs` 與範例頁 `/core/examples/tiles/`，記進 `core/MIGRATION.md`。
