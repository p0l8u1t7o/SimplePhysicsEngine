# core/optics：機器視覺的光學計算

評估平台 Q4（2026-10-06，core 1.11.0）。純函式，瀏覽器與 Node 共用，不需要 three.js。用的地方：

- `core/models/camera.js`：相機子畫面的視角（`angularFov`）與視野（`pinholeFov`，針孔近似，維持原本的畫面）。
- studio 的光學工作台（介面「光學」）與 AOI 方案（`studio/lib/aoi.mjs`）。
- `node studio/vs3d.mjs optics eval <方案.json> [--json]`：給代理與檢查用。
- `view.html`／`view.js`：3D 配置檢視（相機、視錐、景深、光源、工件），工作台用 iframe 嵌入，設定用 `postMessage({ type: 'optics', setup })` 或網址 `#<JSON>` 傳入。

計算都是選型估算：一般鏡頭用薄透鏡近似（倍率 m = f / (WD − f)），遠心鏡頭用標示的倍率；景深用近距離近似 2·N·c·(1 + m) / m²。不能取代實際打樣（POC）。

## 方案（setup）

```json
{
  "camera": { "part": "P-00132", "sensorW": 8.8, "sensorH": 6.6, "pixel": 3.45, "hPx": 2448, "vPx": 2048, "fps": 23, "interface": "GigE", "mount": "C", "bits": 8, "lineScan": false, "lineRate": 26 },
  "lens":   { "part": "P-00140", "type": "定焦｜遠心｜變焦｜微距｜線掃描", "focal": 25, "magnification": 0.35, "fNumber": 8, "fMin": 1.4, "fMax": 16, "imageCircle": 11, "mount": "C", "mod": 100, "wd": 110 },
  "light":  { "part": "P-00160", "type": "環形｜條形｜穹頂｜同軸｜背光｜點光｜線光｜平面", "size": 120, "distance": 50, "beamAngle": 30, "wavelength": 625 },
  "scene":  { "wd": 300, "target": { "w": 40, "h": 30, "heightRange": 2 }, "defect": 0.1, "pxPerDefect": 3, "speed": 200, "exposureUs": 500, "blurPx": 1, "cocPx": 2, "taktS": 10, "imagesPerCycle": 2 },
  "quantity": { "camera": 2, "lens": 2, "light": 2 }
}
```

- 長度 mm、像素尺寸 µm、曝光 µs、速度 mm/s、行頻 kHz、角度度。
- 感光元件給尺寸或「像素尺寸 × 像素數」其中一組即可。
- `part` 是元件庫的元件（studio 的 AOI 方案與 `vs3d optics eval` 會用元件的規格欄位補上沒填的參數，方案自己填的值優先；欄位名稱對照見 `fromAttrs`）。

## 評估項目（`evaluate(setup)` → `{ derived, results, status }`）

| key | 項目 | 判定 |
|---|---|---|
| `magnification`、`fov` | 倍率、視野 | 視野要涵蓋 `target` |
| `resolution`、`defect` | 每像素對應、最小缺陷佔的像素 | 缺陷 ≥ `pxPerDefect`（預設 3）px |
| `dof` | 景深（容許模糊 `cocPx` 個像素） | ≥ 工件高低差 |
| `blur` | 運動模糊（面掃描、有速度時），並算出曝光上限 | ≤ `blurPx`（預設 1）px |
| `lineRate` | 線掃描需要的行頻 | ≤ 相機最高行頻 |
| `imageCircle`、`mount`、`mod`、`teleWd` | 像圈、鏡頭接口、最近對焦距離、遠心工作距離 | 相容與否（C 鏡頭裝 CS 相機要轉接環） |
| `bandwidth`、`acquire` | 滿幀率需要的頻寬、每個節拍的取像時間 | 介面可用頻寬、節拍的一半 |
| `light`、`lightSpot` | 打光方式與入射角（明場／中角度／暗場）、照射範圍 | 照射範圍要蓋住視野 |

`status`：`ok` 符合、`warn` 要注意、`fail` 不符合、`info` 只是資訊。測試在 `studio/test/optics.test.mjs`（對照杯體量測站線掃描的 19.1 mm 視野、快門站的 5MP＋0.35× 遠心）。

## L2：打光幾何與近似模擬影像（`lighting.js`，core 1.12.0，評估平台 Q7）

幾何近似、不是光線追蹤：用來比較打光方案（明場還是暗場、缺陷看不看得到），不能取代實際打樣。座標是工件表面 z = 0、相機在 (0, 0, WD) 往下看。

- `lighting(setup, derived)`：在視野內取樣平整表面，算鏡面反射進不進鏡頭（`spec`，看光源佔了鏡面瓣多少立體角；鏡面瓣 = 入射瞳張角＋材質粗糙度）、漫射照度（`irr`）、相機被擋住（`hidden`）、光被擋住（`shadow`），分類成明場、暗場、明暗混合、漫射（穹頂）、背光；再算每種缺陷和周圍的對比與亮暗。
- `simulateImage(setup, derived)`：灰階影像，整個視野（480 px 寬）＋每個缺陷的原解析度特寫（64 × 64 相機像素）；景深不足時依超出比例模糊、運動模糊沿 x、自動增益、1% 雜訊（亂數固定，同一個方案每次相同）。
- `evaluate()` 在方案有 `scene.material` 與光源時加上 L2 結果：`field`（明暗場）、`uniformity`（照度均勻度）、`occlusion`、`shadow`、`defect-<種類>`（對比；`scene.defectKinds` 列的種類對比 ≥ 20% 而且像素夠才符合，其他只當資訊）。存進資料庫的 `derived.lighting` 只有摘要，不含取樣陣列。
- `view.html`：視野範圍貼明暗場分布（暖色明場、藍色暗場、灰色被擋住）、標缺陷位置；「模擬影像」按鈕開近似影像面板。

方案的 L2 欄位：

```json
{
  "light": { "type": "環形", "size": 120, "distance": 15, "width": 12, "offset": 0, "hole": 40 },
  "scene": { "material": "鏡面金屬", "background": "黑色塑膠", "defectKinds": ["刮傷", "髒污"],
             "defects": [{ "kind": "刮傷", "x": 0, "y": 0, "size": 0.05, "length": 0.6, "angle": 60, "tilt": 20 }],
             "obstacles": [{ "x": 9, "y": 0, "w": 6, "d": 30, "h": 60 }] }
}
```

- 材質（`MATERIALS`）：鏡面金屬、霧面金屬、黑色塑膠、白色塑膠、透明（背光時透光）、PCB 綠漆、銅箔。
- 光源：環形（半徑 `size/2`、高度 `distance`、發光寬 `width`）、條形與線光（長 `size`、水平偏移 `offset`）、點光、平面、同軸（平行光）、穹頂（解析式：均勻半球，頂上相機孔 `hole` 預設 40 mm、底部開口仰角 8°）、背光（輪廓）。
- 缺陷：沒寫 `defects` 時依 `scene.defect` 在視野中線排一列四種。刮傷是 V 形溝、溝壁粗糙（暗場會亮）；凹痕是平滑的碗形（同軸光看得到、低角度環形光幾乎看不到）；髒污是一層灰色霧面（亮的表面上變暗、鏡面在暗場下變亮）；缺件露出背景材質。
- `obstacles`：工件座標的方塊（中心 x、y，寬 w、深 d、高 h，底面 z 預設 0），會擋住相機視線與光源。

驗證（`studio/test/optics.test.mjs`）：同軸光照鏡面是明場、刮傷變暗；低角度環形光是暗場、刮傷變亮、平滑凹痕看不到；遠心鏡頭＋穹頂看鏡面只看到相機孔（暗）、一般鏡頭只有中心一塊暗；治具造成遮擋與陰影；模擬影像的明暗、景深模糊與決定性。

studio 的 `optics` 代理角色（`vs3d optics <專案> --text "需求"`）依需求從元件庫挑相機、鏡頭、光源，提 2～3 個方案；平台用 L1＋L2 檢查，不通過的退回重做（最多 3 次），通過的存成專案的 AOI 方案。
