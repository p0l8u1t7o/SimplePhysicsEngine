# three.js addons（r187）

從 `three@0.187.0` 的 `examples/jsm/` 原樣複製（MIT，同 three.js），importmap 的 `three/addons/` 指到這裡：

| 檔案 | 用途 |
|---|---|
| `controls/OrbitControls.js` | 相機操作（各站、範例） |
| `environments/RoomEnvironment.js` | 環境光（`ui/stage.js`） |
| `loaders/GLTFLoader.js`、`utils/BufferGeometryUtils.js`、`utils/SkeletonUtils.js` | 3D Tiles 的 glb／b3dm 圖磚（`vendor/3d-tiles-renderer`、`geo/tiles.js`；2026-11-08） |

升級 three.js 時這些檔要和 `three.module.js` 同版。
