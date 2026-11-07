# 外部 CFD（OpenFOAM）案例產生與結果匯入（原型）

依 2026-11-07 拍板：「流體：管路用 1D 管網水力，畫面用 CPU 預先烘焙的粒子；另接外部 CFD（OpenFOAM，GPL，只當外部離線程式、不內嵌，結果匯入顯示）」。這裡是外部 CFD 那一段的原型：從場景的簡單幾何產生 OpenFOAM 案例，在平台外面跑，把結果檔匯入成網頁能直接讀的格式並用 three.js 顯示。

> 命令列（產生器、檢查、匯入、執行腳本）、範例與測試在根目錄 `tools/cfd/`；瀏覽器也要用的讀檔器與顯示（`vtk.js`、`dat.js`、`pack.js`、`flow-field.js`、`flow-view.js`、`case-gen.js` 等）在 `core/cfd/`。原型與展示頁在本機 `TEMP/cfd-dev/`（2026-11-07）。

## 授權邊界（GPL）

- OpenFOAM 是 GPL v3。平台**只把它當成獨立的外部程式執行**（Docker 容器、WSL、或另一台 Linux 主機），不連結、不內嵌、不把它的原始碼或執行檔放進本庫，也不放進 `core/vendor/`。
- 本工具寫出的是**輸入檔**（OpenFOAM 的字典文字、STL），讀進來的是 OpenFOAM 的**輸出檔**（VTK、文字表格）。兩邊只透過檔案溝通，平台的程式不衍生自 OpenFOAM。
- 字典由本工具從頭產生（`lib/foam-dict.js`），沒有複製 OpenFOAM tutorials 的檔案；檔頭也不使用 OpenFOAM 的版權橫幅。`#includeEtc "caseDicts/meshQualityDict"` 只是在執行時引用使用者自己安裝的 OpenFOAM 裡的檔案。
- 交付給客戶時，若要附 OpenFOAM 本身（例如 Docker 映像），要依 GPL 提供原始碼取得方式；只交付平台與結果檔則不需要。

## 需求

| 項目 | 版本 | 用途 |
|---|---|---|
| Node.js | 22 以上（開發機 26.13.0） | 產生器、檢查、匯入；不需要 npm 套件 |
| OpenFOAM.com（ESI／OpenCFD） | **v2412**（v2306 以後語法相同） | 實際計算；三擇一：Docker 映像 `opencfd/openfoam-default:2412`、WSL2 的 Ubuntu 安裝官方預編版、或 Linux 主機 |
| Docker Desktop 或 WSL2 | 近期版本 | 在 Windows 上跑 OpenFOAM；本工具只偵測，不會安裝 |
| bash | Git Bash 即可 | 只有測試用來做 `bash -n Allrun` 語法檢查 |

選 OpenFOAM.com 而不是 OpenFOAM.org 的原因：官方有維護的 Docker 映像與 Ubuntu 預編版、`atmBoundaryLayerInlet*` 與 `surfaces`／`forces` 函數物件的輸出格式穩定、snappyHexMesh 支援 `searchableRotatedBox`（傾斜面板不必轉 STL）。

### 發行版差異（OpenFOAM.org v11 以後，這版不產生）

| 項目 | OpenFOAM.com（本工具產生） | OpenFOAM.org |
|---|---|---|
| 求解器 | `application simpleFoam;` | `solver incompressibleFluid;`，用 `foamRun` 執行 |
| 黏度 | `constant/transportProperties`：`transportModel Newtonian; nu …;` | `constant/physicalProperties`：`viscosityModel constant; nu …;` |
| 紊流 | `constant/turbulenceProperties`：`RAS { RASModel kOmegaSST; }` | `constant/momentumTransport`：`RAS { model kOmegaSST; }` |
| 傾斜方塊 | `searchableRotatedBox` | 沒有對應；改用 `mesh.geometryMode: "stl"` |
| 特徵線 | `surfaceFeatureExtract`＋`surfaceFeatureExtractDict` | `surfaceFeatures`＋`surfaceFeaturesDict` |
| 函數物件 | `libs (sampling)`、`(forces)`、`(fieldFunctionObjects)` | `libs ("libsampling.so")` 等，部分改用 `#includeFunc` |
| 力的輸出 | `forces_<名稱>/<t>/force.dat`（`total_x …`） | `forces.dat`（欄名不同；匯入器的欄位辨識有涵蓋常見寫法，沒有實檔驗證） |

要支援 .org 時，在 `lib/case-gen.js` 加一個 `distribution` 開關換掉上面幾個檔，其餘（blockMesh、snappy、fvSchemes、fvSolution）兩邊相同。

## 流程

```powershell
# 1. 產生案例（預設輸出到 TEMP/cfd-cases/<name>/，同時做不需要 OpenFOAM 的字典檢查）
node --import ./core/tools/register.mjs tools/cfd/gen-case.mjs tools/cfd/examples/pv-row-wind.json --force

# 2. 在外部執行（自動偵測 Docker／WSL；都沒有就印出三種做法的完整指令）
powershell -ExecutionPolicy Bypass -File tools\cfd\run-case.ps1 -Case TEMP\cfd-cases\pv-row-wind -Cpus 4 -Import

# 3. 匯入（-Import 已經做了；手動複製結果回來的話自己跑）
node --import ./core/tools/register.mjs tools/cfd/import-results.mjs TEMP/cfd-cases/pv-row-wind        # → results.cfdpack

# 檢查既有的案例資料夾（例如手動改過字典）
node --import ./core/tools/register.mjs tools/cfd/validate-case.mjs TEMP/cfd-cases/pv-row-wind

# 範例頁（假資料，不需要 OpenFOAM）：/core/examples/cfd/ 讀 core/examples/cfd/demo.cfdpack.gz；改了產生器或流場格式後重產
node --import ./core/tools/register.mjs tools/cfd/make-demo.mjs --example
# 真的結果：/core/examples/cfd/?pack=<results.cfdpack 或 .cfdpack.gz 的網址>（loadPack 會自動解 gzip）

# 測試
node --import ./core/tools/register.mjs --test tools/cfd/test/
```

第一次在新環境實跑，先用 `examples/smoke-box.json`（約 8 萬格、200 步、2 核，粗估 1 分鐘內）確認整條流程，再跑正式案例。

CPU：本機規定整機不超過 80%。Docker 用 `-Cpus` 限制容器（預設邏輯核心數的一半）；WSL 的上限要在 `%UserProfile%\.wslconfig` 設 `processors=`。`cpu-cap.ps1` 的 Job 上限管不到 Docker／WSL 的虛擬機（它只管 Windows 行程），所以不能靠它限制 OpenFOAM。

## 產生器輸入（JSON）

座標都是**場景座標**（本框架慣例：Y 向上、mm），產生器負責換成 OpenFOAM 的 Z 向上、m，並把風向轉到 +x，計算域永遠對齊座標軸。長度可以寫數字（輸入單位）或 `"5H"`（障礙物最高點離地高度 H 的倍數）。

```jsonc
{
  "name": "pv-row-wind",                     // 案例資料夾名稱
  "frame": { "up": "y", "units": "mm", "origin": [0, 0, 0] },   // up: y|z；units: mm|cm|m
  "flow": {
    "medium": "air",                         // air（ν 1.5e-5、ρ 1.225）| water（ν 1e-6、ρ 998.2）；可用 nu、rho 覆寫
    "direction": [0, 0, 1],                  // 風吹往的方向（場景座標，只取水平分量）
    "profile": "abl",                        // abl（對數律大氣邊界層）| uniform
    "Uref": 12, "Zref": 10000, "z0": 30,     // 參考風速 m/s、參考高度、地表粗糙長度（預設 10 m、0.03 m）
    "intensity": 0.05, "mixingLength": 1000  // uniform 入口與 enclosure 開口的紊流
  },
  "ground": { "level": 0 },                  // 地面高度（場景 up 軸座標）
  "domain": {                                // external（預設）：障礙物外框往外擴
    "upstream": "5H", "downstream": "15H", "lateral": "5H", "height": "6H"
    // 或 "min"/"max"（場景座標）指定；"kind": "enclosure" 時必填 min/max，另給 openings：
    // "openings": [{ "name": "feed", "kind": "inlet"|"outlet", "min": […], "max": […], "velocity": 1.5 }]  開口要貼在某一面牆上
  },
  "mesh": {
    "baseCell": 800,                         // 背景網格（正立方體；external 計算域會擴到整數倍）
    "nCellsBetweenLevels": 2,
    "wake": { "level": 2, "upstream": "1H", "downstream": "4H", "lateral": "1H", "height": "1.5H" },  // false 關閉
    "regions": [{ "name": "zone", "min": […], "max": […], "level": 3 }],
    "geometryMode": "searchable",            // searchable（searchableBox／RotatedBox／Cylinder）| stl（全部寫成 STL＋特徵線）
    "minPlateCells": 2,                      // 面板厚度至少幾格最細網格，不夠就加厚並警告
    "layers": 0                              // 邊界層網格（>0 才開 addLayers）
  },
  "obstacles": [
    { "name": "table1", "type": "plate", "center": […], "size": [長, 寬], "thickness": 60,
      "tiltDeg": 20, "yawDeg": 0,            // 平放（長沿 x、寬沿 z、厚沿 y）→ +z 邊抬高 tilt → 繞 y 轉 yaw；或直接給 rotation [rx,ry,rz]（度，XYZ，同 three.js）
      "level": [5, 5], "group": "panels", "report": true, "label": "支架 1" },
    { "name": "inverter", "type": "box", "center": […], "size": […], "rotation": [0, 0, 0], "level": [3, 3], "report": true },  // 或 min/max
    { "name": "pole", "type": "cylinder", "center": […], "radius": 80, "height": 4000, "axis": "y", "level": [3, 4] }       // 或 p1/p2
  ],
  "solver": { "application": "simpleFoam", "turbulence": "kOmegaSST", "iterations": 800, "writeInterval": 200, "nProcs": 4, "residual": 1e-4 },
  "sampling": {
    "autoSlices": true,                      // external：面板中心高度的水平切面 plan＋沿風向的直立切面 elevation
    "slices": [{ "name": "behind1", "point": […], "normal": […] }],
    "probes": [{ "name": "gap12", "point": […] }],   // 另外自動加上游參考探針 ref（Cp 的參考靜壓）
    "streamlines": { "nSeeds": 24 }          // false 關閉
  }
}
```

`report: true`（面板預設開）的障礙物會有 `forces_<名稱>` 與 `patch_<名稱>` 表面取樣。名稱要以英文字母開頭（OpenFOAM patch 名稱）。`solver.application: "interFoam"` 會明確報「尚未支援」。

### 產生的案例

`system/`：`blockMeshDict`、`snappyHexMeshDict`、`meshQualityDict`、`controlDict`（函數物件：`surfaces` 寫 legacy VTK、`probes`、`forces_*`、`streamLines`、`yPlus`、`residuals`（solverInfo））、`fvSchemes`、`fvSolution`（SIMPLE、GAMG）、`decomposeParDict`（scotch）；STL 模式另有 `surfaceFeatureExtractDict`；enclosure 另有 `topoSetDict`、`createPatchDict`。
`constant/`：`transportProperties`、`turbulenceProperties`、（STL 模式）`triSurface/*.stl`。
`0.orig/`：`U`、`p`、`k`、`omega`、`nut`（external：入口 `atmBoundaryLayerInlet*`、地面 `nutkAtmRoughWallFunction`、頂面與兩側 `symmetry`；障礙物用 patch 群組 `obstacles` 一次設定）。
`Allrun`（blockMesh → snappyHexMesh → checkMesh → restore0Dir → decomposePar → simpleFoam → reconstructPar）、`Allclean`、`cfd-case.json`（座標轉換矩陣、參考值、障礙物、取樣清單、粗估網格數與時間、警告；匯入器靠它把結果轉回場景）。

### 不需要 OpenFOAM 的檢查（`lib/validate.js`）

- 語法：每個字典都用自寫的小解析器讀過（括號、分號、註解、字串、指令），錯誤帶行號。
- blockMesh：8 個頂點、hex 索引、格數、六個面各屬於一個 patch、面的法向朝外。
- snappy：refinementSurfaces／Regions 都在 geometry 裡、各 searchable 型別的必要參數、STL 檔存在、特徵線有對應的 surfaceFeatureExtractDict 項目、`locationInMesh` 在域內且不在任何障礙物裡。
- 函數物件：有 `type`、patch 名稱或群組存在、探針在域內。
- 0.orig：class、7 個數的 dimensions、每個 patch 都有邊界條件（名稱、群組或 regex）、型別在白名單裡（抓拼字錯誤）、symmetry patch 的條件也是 symmetry、需要 `value`／`inletValue` 的有寫。
- Allrun：shebang、沒有 CR、必要步驟。

不涵蓋：各型別所有必要參數的組合、網格品質（要 `checkMesh`）、收斂。

## 結果匯入

`import-results.mjs` 讀 `postProcessing/`，輸出單一 `.cfdpack`（JSON 標頭＋Float32／Uint32 二進位區，小端序，決定性：同一份輸入位元組完全相同）。

| 來源 | 支援的格式 |
|---|---|
| `surfaces/<t>/<面>.vtk` | VTK legacy ASCII 與 BINARY（大端序）；POLYDATA（POLYGONS、LINES、VERTICES、TRIANGLE_STRIPS）與 UNSTRUCTURED_GRID（取三角形、四邊形、多邊形、線；體元素只計數）；舊式「n size」cells 與 VTK 5.1 的 OFFSETS／CONNECTIVITY；POINT_DATA／CELL_DATA 的 FIELD、SCALARS（LOOKUP_TABLE）、VECTORS、NORMALS、TENSORS；舊版「欄位_面名.vtk」自動合併 |
| `streamLines/` 或 `sets/streamLines/<t>/*.vtk` | 同上（POLYDATA LINES＋點資料） |
| `forces_<名稱>/<t>/force.dat` 或 `forces.dat` | v2006 以後的 `total_x…pressure_x…viscous_x`；舊版巢狀括號的 `forces(pressure viscous porous)`；多個起始時間合併 |
| `probes/<t>/{p,U}` | `# Probe i (x y z)` 標頭、純量與 `(ux uy uz)` 向量、`# Not Found` 與 ±1e300 標記 |
| `yPlus/<t>/yPlus.dat`、`residuals/<t>/solverInfo.dat` | 表格（欄位可以是字）；殘差縮到最多 200 點 |

不支援：XML 的 `.vtp`／`.vtu`（controlDict 已設 `legacy true`；看到會提示）、ensight、raw 表面格式、整個體網格（`foamToVTK` 的體元素）。

匯入時做的換算：座標用 `foamToScene` 轉回場景（Y 向上、mm），速度與力只轉方向；`p` 從運動壓力（m²/s²）乘 ρ 成 Pa；另算 `Umag`、`Cp = (p − p_ref)/(½ρU_ref²)`（p_ref 用上游參考探針 `ref` 最後一步的值，沒有就用出口 0）；面板的力另算法向力 `normalForce`、`CN`、沿風向的 `CD`（面積用長 × 寬），以及最後 20% 疊代的力變化 `tailVariation`（收斂指標）。

瀏覽器端：`import { loadPack } from 'lib/pack.js'`（`decodePack(arrayBuffer)` 直接回傳指向原緩衝區的 typed array）。

## 顯示（`view/flow-view.js`）

```js
import { loadPack } from './lib/pack.js';
import { createFlowView } from './view/flow-view.js';
const pack = await loadPack('results.cfdpack');
const flow = createFlowView(pack, {
  field: 'Umag', colormap: 'turbo', range: 'robust',          // 切面／流線／箭頭的色彩通道（robust = 2～98 百分位；'full' 或 [min, max]）
  patchField: 'Cp', patchColormap: 'coolwarm', patchSymmetric: true,  // 障礙物表面的色彩通道
  opacity: 0.9, patchOffset: 3,                               // 障礙物表面往流體側推 3 mm，避免和設備模型重合閃爍
  streamlines: true,                                          // 匯入的 OpenFOAM 流線
  arrows: { surface: 'plan', stride: 5, color: 0x1b1f24 },    // 切面重新取樣成格點後畫箭頭（不給 color 就跟色表）
  traced: { surface: 'elevation', count: 20 },                // 在切面內自己積分的流線（RK2，決定性）
});
scene.add(flow.group);                       // 根群組標 userData.noBom
flow.setField('p'); flow.setField('Cp', 'patches'); flow.setRange([0, 12]); flow.setColormap('viridis');
flow.setVisible('elevation', false); flow.setOpacity(0.7);
flow.legend('slices');                       // { label, unit, min, max, stops, ticks }
panel.append(flow.legendElement('slices'), flow.legendElement('patches'));
flow.forcesTable();                          // [{ obstacle, label, Fx, Fy, Fz, normalForce, CN, CD, converged }]
flow.dispose();
```

表面一律展開成三角形（點資料內插、cell 資料整片同色）；顏色是資料色，用不受光照的 `MeshBasicMaterial`，色表值先從 sRGB 轉線性。`lib/flow-field.js` 另外提供 `resampleSlice`、`arrowSegments`、`traceStreamlines`、`colormap`、`niceTicks`、`robustRange`，不依賴 three.js。

平台上看得到的：切面上的風速／壓力／Cp 色圖、箭頭、流線（匯入的與切面內積分的）、面板與設備表面的 Cp（每個面一個顏色）、每座面板的風力與係數表、y+ 範圍與殘差（在結果包裡，介面還沒畫圖）。

## 測試

`node --import ./core/tools/register.mjs --test tools/cfd/test/`（37 項，約 1 秒）：

- `foam-dict.test.mjs`：寫出→解析來回、語法錯誤與行號、座標轉換（來回一致、右手系）、面板傾斜方向、rotatedBox 角點、STL 法向朝外。
- `case-gen.test.mjs`：範例（三座傾斜面板＋變流器箱＋監控桿）結構檢查與 0 錯誤、決定性、寫檔後讀回檢查、`bash -n Allrun`、薄板加厚警告、STL 模式、enclosure（水槽＋開口）、輸入錯誤、檢查器能抓到 8 種刻意弄壞的錯誤。
- `vtk-dat.test.mjs`：VTK 的 ASCII／BINARY × 舊式／5.1 × FIELD／SCALARS 八種組合、UNSTRUCTURED_GRID、三角帶、錯誤處理；forces 新舊格式與合併、probes、solverInfo、yPlus。
- `pipeline.test.mjs`：產生案例 → `test/synth-results.mjs` 寫出解析式假流場的 postProcessing（OpenFOAM.com 的檔案配置）→ 匯入 → 解碼，檢查座標與向量轉換、Pa 與 Cp、力與係數、探針、流線、決定性，再用 three.js 在 Node 端建出 `createFlowView` 的幾何（色條、patch 外推、重新上色）。

測試輸出在 `test/out/`（TEMP 底下，不進版控）。

## 準確度與限制（給看結果的人）

- **這次沒有實跑 OpenFOAM**（開發機沒有 Docker 也沒有 WSL 發行版）。字典是照 OpenFOAM.com v2412 的語法寫的，通過本工具的檢查，但幾個地方要第一次實跑確認：`atmBoundaryLayerInletOmega` 的參數、`z0`／`d` 寫成 `uniform`、`formatOptions vtk { legacy true; }`、streamLine 的輸出位置與 `direction forward`、v2412 surfaces 輸出的檔名配置。建議先跑 `smoke-box`。
- **網格獨立性**：結果會隨網格改變。正式報告至少跑三種 baseCell（例如 ×1.5、×1、×0.67），面板的力變化 < 5% 才算網格收斂；`estimate` 只是粗估。
- **y+**：預設不加邊界層網格，壁面靠 wall function，y+ 落在 30～300 較合理；`yPlus` 結果會記在結果包裡。要算摩擦或分離點就要 `mesh.layers` 加邊界層並檢查 y+。
- **紊流模型**：k-omega SST 穩態 RANS 給的是時間平均場，**不給陣風峰值**。設計風壓要依規範（例如建築物耐風設計規範的陣風反應因子）換算，或做 LES／DES 暫態計算（之後的工作）。
- **ABL 入口**：對數律剖面在空的計算域裡會往下游變形（地面粗糙度與入口不一致的老問題），障礙物離入口不要太近，並用空域先跑一次檢查剖面維持度。
- **面板厚度**：薄板不到最細網格 2 格會被加厚（產生器會警告），厚度方向的細節與邊緣分離會失真；零厚度面板要用 baffle（之後的工作）。
- **收斂**：看殘差（`residuals`）與力的 `tailVariation`；殘差降到門檻不代表力已穩定。
- 匯入的值是 OpenFOAM 取樣到切面與表面的內插值，箭頭與切面流線又在格點上再內插一次，只適合看趨勢。
- 假資料（`SYNTHETIC.txt`、`make-demo.mjs`）只用來測流程與畫面，展示頁會標示，不能拿來談物理。

## 還沒做的

- 實際在 Docker／WSL 上跑一次 smoke-box 與 pv-row-wind，修正字典細節，記錄時間與網格數，用網格三種密度做一次網格獨立性。
- `interFoam`（水槽自由液面，VOF；`setFields` 初始液位、`alpha.water`、重力、暫態 controlDict）。
- OpenFOAM.org 版本開關（見上表）。
- 面板 baffle（零厚度）、邊界層網格的預設值、STL 直接從場景模型匯出（目前只有方塊、面板、圓柱）。
- 匯入 XML `.vtp`、平行計算不 reconstruct 時的 `processor*/` 結果。
- 介面：殘差與力收斂的圖、y+ 警示、時間序列（暫態）播放、和站的 `project.js` 整合（風載重 → 結構檢查）。
- 搬家：`tools/cfd/`（gen-case、validate-case、import-results、run-case.ps1、examples、test）＋`core/cfd/`（vtk、dat、pack、flow-field、flow-view、foam-dict），`REQUIREMENTS.md` 的選用表加 Docker／WSL＋OpenFOAM 一列。
