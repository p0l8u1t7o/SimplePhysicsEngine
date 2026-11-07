# three.js addons（r187）

從 `three@0.187.0` 的 `examples/jsm/` 原樣複製（MIT，同 three.js），importmap 的 `three/addons/` 指到這裡：

| 檔案 | 用途 |
|---|---|
| `controls/OrbitControls.js` | 相機操作（各站、範例） |
| `environments/RoomEnvironment.js` | 環境光（`ui/stage.js`） |
| `loaders/GLTFLoader.js`、`utils/BufferGeometryUtils.js`、`utils/SkeletonUtils.js` | 3D Tiles 的 glb／b3dm 圖磚（`vendor/3d-tiles-renderer`、`geo/tiles.js`；2026-11-08） |
| `loaders/DRACOLoader.js`、`libs/draco/gltf/draco_wasm_wrapper.js`＋`draco_decoder.wasm` | DRACO 壓縮幾何（Google Draco，Apache-2.0，見 `libs/draco/README.md`）；只放 wasm 版，沒放純 JS 的 `draco_decoder.js` |
| `loaders/KTX2Loader.js`、`utils/WorkerPool.js`、`math/ColorSpaces.js`、`libs/ktx-parse.module.js`、`libs/zstddec.module.js`、`libs/basis/basis_transcoder.js`＋`.wasm` | KTX2／Basis 壓縮貼圖（Basis Universal，Apache-2.0；ktx-parse、zstddec 是 MIT） |
| `libs/meshopt_decoder.module.js` | `EXT_meshopt_compression`（meshoptimizer，MIT；wasm 內嵌在檔案裡） |

解碼器由 `geo/tiles.js` 的 `installDecoders` 掛上，第一次遇到壓縮內容時才載入 wasm。升級 three.js 時這些檔要和 `three.module.js` 同版。
