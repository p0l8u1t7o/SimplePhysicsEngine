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
