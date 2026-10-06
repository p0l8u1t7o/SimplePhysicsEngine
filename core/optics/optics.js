// 機器視覺的光學計算（L1，評估平台 Q4）：純函式，瀏覽器與 Node 共用，不需要 three.js。
// 相機模型（core/models/camera.js）、studio 的光學工作台、vs3d optics eval（代理與檢查）都用這一份。
//
// 單位：長度 mm（像素尺寸 µm）、時間 s（曝光 µs）、速度 mm/s、角度度。
// 一般鏡頭用薄透鏡近似：物距 u（工作距離，鏡頭前主點到物面）、倍率 m = f / (u − f)；
// 遠心鏡頭的倍率固定（廠商標示），工作距離是鏡頭規格。
// 這些都是選型時的估算，不能取代實際打樣（POC）；結果的 note 會寫出假設。

import { lighting } from './lighting.js';      // L2 打光幾何（只在方案有工件材質時用到）

// ---- 基本公式 --------------------------------------------------------------
const deg = r => r * 180 / Math.PI, rad = d => d * Math.PI / 180;
export const round = (v, n = 3) => v == null || !Number.isFinite(v) ? v : Math.round(v * 10 ** n) / 10 ** n;

// 針孔模型的視角（度）：感光元件邊長 h、焦距 f（相機子畫面的虛擬相機用這個）
export const angularFov = (h, f) => deg(2 * Math.atan(h / 2 / f));
// 針孔模型的視野：工作距離 wd 時，感光元件 w×h 對到的物面大小（相機模型的 fieldOfView 用這個）
export const pinholeFov = (w, h, f, wd) => [wd * w / f, wd * h / f];

// 感光元件：給像素尺寸與像素數就算出尺寸；給尺寸就用尺寸
export function sensorOf(c) {
  const px = num(c.pixel), hPx = num(c.hPx), vPx = num(c.vPx);
  const w = num(c.sensorW) ?? (px && hPx ? px * hPx / 1000 : null), h = num(c.sensorH) ?? (px && vPx ? px * vPx / 1000 : null);
  return { w, h, diag: w != null && h != null ? Math.hypot(w, h) : null, pixel: px ?? (w && hPx ? w / hPx * 1000 : null), hPx, vPx };
}
// 倍率：遠心用標示的倍率；一般鏡頭用薄透鏡 m = f / (wd − f)
export const magnification = (lens, wd) => lens.type === '遠心' || lens.telecentric ? num(lens.magnification) : num(lens.focal) && wd > num(lens.focal) ? lens.focal / (wd - lens.focal) : null;
// 景深（近距離近似）：DOF = 2·N·c·(1 + m) / m²；N 是光圈值、c 是容許模糊圓（mm）
export const depthOfField = (N, c, m) => N && c && m ? 2 * N * c * (1 + m) / (m * m) : null;
// 介面的可用頻寬（MB/s，取常見實測值，不是線速）
export const INTERFACES = { GigE: 110, '2.5GigE': 280, '5GigE': 560, '10GigE': 1100, USB3: 350, CoaXPress: 1250, 'Camera Link': 680 };
// 鏡頭接口：相機接口 → 可以直接裝的鏡頭接口（C 鏡頭裝 CS 相機要 5 mm 轉接環）
const MOUNTS = { C: ['C'], CS: ['CS', 'C'], F: ['F'], M42: ['M42'], M58: ['M58'], M72: ['M72'] };
const num = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

// ---- 元件庫的規格欄位 → 計算參數（欄位名稱見 studio/lib/categories.mjs 的 DEFAULT_FIELDS） -------
export function fromAttrs(kind, a = {}) {
  const n = k => num(a[k]);
  if (kind === 'camera') return { sensorW: n('感光元件寬'), sensorH: n('感光元件高'), pixel: n('像素尺寸'), hPx: n('水平像素'), vPx: n('垂直像素'), fps: n('幀率'),
    interface: a['介面'] || '', mount: a['鏡頭接口'] || '', color: a['色彩'] || '', shutter: a['快門'] || '' };
  if (kind === 'lens') return { type: a['鏡頭類型'] || '', focal: n('焦距'), magnification: n('倍率'), fMax: n('最大光圈'), fMin: n('最小光圈'), imageCircle: n('像圈'),
    mount: a['鏡頭接口'] || '', mod: n('最近對焦距離'), wd: n('工作距離') };
  if (kind === 'light') return { type: a['光源類型'] || '', wavelength: n('波長'), size: num(String(a['發光尺寸'] ?? '').match(/[\d.]+/)?.[0]), distance: n('建議工作距離') };
  return {};
}

// ---- 一個方案的評估 ----------------------------------------------------------
// setup：{ camera, lens, light, scene }（欄位見 core/optics/README.md）；回傳 { derived, results: [{ key, label, value, unit, status, note }] }
// status：ok 符合、warn 要注意、fail 不符合、info 只是資訊
export function evaluate(setup) {
  const cam = setup.camera || {}, lens = setup.lens || {}, light = setup.light || {}, sc = setup.scene || {};
  const s = sensorOf(cam), tele = lens.type === '遠心' || !!lens.telecentric, lineScan = !!cam.lineScan || lens.type === '線掃描';
  const wd = num(sc.wd) ?? (tele ? num(lens.wd) : null), m = magnification(lens, wd);
  const out = [], push = (key, label, value, unit, status = 'info', note = '') => out.push({ key, label, value: typeof value === 'number' ? round(value) : value, unit, status, note });
  const d = { sensor: s, wd, magnification: m, telecentric: tele, lineScan };

  if (!s.w || !s.h) push('sensor', '感光元件', null, '', 'fail', '缺感光元件尺寸（或像素尺寸×像素數）');
  if (m == null) push('magnification', '倍率', null, '', 'fail', tele ? '遠心鏡頭缺倍率' : '缺焦距或工作距離，或工作距離小於焦距');
  if (s.w && s.h && m) {
    d.fov = [s.w / m, lineScan ? null : s.h / m];
    push('magnification', '光學倍率', m, '×', 'info', tele ? '遠心鏡頭標示的倍率' : `薄透鏡 f / (WD − f)，焦距 ${lens.focal} mm、工作距離 ${wd} mm`);
    push('fov', '視野', lineScan ? `${round(d.fov[0], 2)}（寬）` : `${round(d.fov[0], 2)} × ${round(d.fov[1], 2)}`, 'mm',
      sc.target?.w && (d.fov[0] < sc.target.w || (!lineScan && sc.target.h && d.fov[1] < sc.target.h)) ? 'fail' : sc.target?.w ? 'ok' : 'info',
      sc.target?.w ? `要涵蓋 ${sc.target.w}${sc.target.h && !lineScan ? ` × ${sc.target.h}` : ''} mm` : '');
    if (s.pixel) {
      d.mmPerPx = s.pixel / 1000 / m;
      push('resolution', '每像素對應', d.mmPerPx * 1000, 'µm', 'info', `= 像素尺寸 ${s.pixel} µm ÷ 倍率`);
      if (num(sc.defect)) {
        const need = num(sc.pxPerDefect) ?? 3, got = sc.defect / d.mmPerPx;
        d.defectPx = got;
        push('defect', '最小缺陷佔的像素', got, 'px', got >= need ? 'ok' : got >= need * 0.67 ? 'warn' : 'fail', `${sc.defect} mm 的缺陷；判定至少要 ${need} px`);
      }
      // 景深：容許模糊圓 = cocPx 個像素
      const N = num(lens.fNumber) ?? num(lens.fMin) ?? num(lens.fMax), c = (num(sc.cocPx) ?? 2) * s.pixel / 1000;
      if (N) {
        d.dof = depthOfField(N, c, m);
        const need = num(sc.target?.heightRange);
        push('dof', '景深', d.dof, 'mm', need ? (d.dof >= need ? 'ok' : d.dof >= need * 0.7 ? 'warn' : 'fail') : 'info', `光圈 F${N}、容許模糊 ${num(sc.cocPx) ?? 2} px${need ? `；產品高低差 ${need} mm` : ''}`);
      }
      // 運動模糊與曝光
      const v = num(sc.speed);
      if (v && !lineScan) {
        const exp = (num(sc.exposureUs) ?? 0) / 1e6, allow = num(sc.blurPx) ?? 1;
        d.blurPx = v * exp / d.mmPerPx; d.maxExposureUs = allow * d.mmPerPx / v * 1e6;
        push('blur', '運動模糊', d.blurPx, 'px', d.blurPx <= allow ? 'ok' : d.blurPx <= allow * 2 ? 'warn' : 'fail', `速度 ${v} mm/s、曝光 ${sc.exposureUs ?? 0} µs；容許 ${allow} px，曝光上限約 ${round(d.maxExposureUs, 1)} µs（或用閃光）`);
      }
      // 線掃描：需要的行頻
      if (lineScan && v) {
        d.lineRate = v / d.mmPerPx;
        const max = num(cam.lineRate);
        push('lineRate', '需要的行頻', d.lineRate / 1000, 'kHz', max ? (d.lineRate <= max * 1000 ? 'ok' : 'fail') : 'info', `速度 ${v} mm/s ÷ 每像素 ${round(d.mmPerPx * 1000, 2)} µm${max ? `；相機最高 ${max} kHz` : ''}`);
      }
    }
  }
  // 鏡頭相容：像圈、接口、最近對焦距離
  if (s.diag && num(lens.imageCircle)) push('imageCircle', '像圈 vs 感光元件對角', `${lens.imageCircle} / ${round(s.diag, 2)}`, 'mm', lens.imageCircle >= s.diag ? 'ok' : 'fail', lens.imageCircle >= s.diag ? '' : '像圈比感光元件小，四角會暗角');
  if (cam.mount && lens.mount) { const ok = (MOUNTS[cam.mount] || [cam.mount]).includes(lens.mount); push('mount', '鏡頭接口', `${lens.mount} → ${cam.mount}`, '', ok ? (cam.mount === 'CS' && lens.mount === 'C' ? 'warn' : 'ok') : 'fail', ok ? (cam.mount === 'CS' && lens.mount === 'C' ? '要加 5 mm 轉接環' : '') : '接口不相容'); }
  if (!tele && wd && num(lens.mod)) push('mod', '最近對焦距離', `${wd} ≥ ${lens.mod}`, 'mm', wd >= lens.mod ? 'ok' : 'fail', wd >= lens.mod ? '' : '工作距離比最近對焦距離近，對不到焦（可加接寫環）');
  if (tele && num(lens.wd) && num(sc.wd) && Math.abs(sc.wd - lens.wd) > 0.1 * lens.wd) push('teleWd', '遠心工作距離', `${sc.wd} vs ${lens.wd}`, 'mm', 'warn', '遠心鏡頭的工作距離是固定的，和場景設定差很多');
  // 頻寬與取像時間
  if (s.hPx && s.vPx && !lineScan) {
    const bytes = (num(cam.bits) ?? 8) / 8 * (cam.color === '彩色' && cam.bayer === false ? 3 : 1), frameMB = s.hPx * s.vPx * bytes / 1e6;
    const cap = INTERFACES[cam.interface], fps = num(cam.fps);
    d.frameMB = frameMB;
    if (cap && fps) push('bandwidth', '滿幀率需要的頻寬', frameMB * fps, 'MB/s', frameMB * fps <= cap ? 'ok' : 'warn', `${cam.interface} 可用約 ${cap} MB/s；超過時實際幀率會降到約 ${round(cap / frameMB, 1)} fps`);
    const n = num(sc.imagesPerCycle), takt = num(sc.taktS);
    if (n && takt && (fps || cap)) {
      const realFps = Math.min(fps || Infinity, cap ? cap / frameMB : Infinity);
      d.acquireS = n / realFps;
      push('acquire', '每個節拍的取像時間', d.acquireS, 's', d.acquireS <= takt * 0.5 ? 'ok' : d.acquireS <= takt ? 'warn' : 'fail', `${n} 張 ÷ ${round(realFps, 1)} fps；節拍 ${takt} s（取像超過節拍一半就要注意）`);
    }
  }
  // 打光：環形、條形、點光等用安裝高度與半徑估入射角；同軸、背光、穹頂直接分類
  if (light.type) {
    const t = light.type, h = num(light.distance), r = num(light.size) != null ? light.size / 2 : null;
    let kind = '', angle = null;
    if (t === '同軸') kind = '明場（鏡面反射直接進鏡頭）';
    else if (t === '背光') kind = '背光（輪廓、透光）';
    else if (t === '穹頂') kind = '漫射（抑制反光、看表面顏色）';
    else if (h && r != null) { angle = deg(Math.atan2(r, h)); kind = angle < 30 ? '明場（高角度）' : angle < 60 ? '中角度' : '暗場（低角度，凸顯刮傷與邊緣）'; }
    d.lightAngle = angle;
    push('light', '打光方式', angle != null ? `${kind}，入射角約 ${round(angle, 1)}°` : kind || t, '', 'info', angle != null ? `光源半徑 ${r} mm、距離工件 ${h} mm（入射角從法線算）` : '');
    if (h && num(light.beamAngle) && r != null) { d.lightSpot = 2 * (r + h * Math.tan(rad(light.beamAngle / 2))); if (d.fov) push('lightSpot', '照射範圍（直徑）', d.lightSpot, 'mm', d.lightSpot >= Math.hypot(d.fov[0], d.fov[1] || 0) ? 'ok' : 'warn', '要蓋住整個視野'); }
  }
  // L2 打光幾何（core/optics/lighting.js）：有工件材質時才算。scene.defectKinds 是要檢出的缺陷種類（判定符合與否），沒列的只當資訊
  if (light.type && sc.material && d.fov) {
    const L = lighting(setup, d), want = Array.isArray(sc.defectKinds) ? sc.defectKinds : null, needPx = num(sc.pxPerDefect) ?? 3;
    d.lighting = { field: L.field, brightRatio: L.brightRatio, uniformity: L.uniformity, hiddenRatio: L.hiddenRatio, shadowRatio: L.shadowRatio, defects: L.defects.map(({ kind, contrast, polarity, px }) => ({ kind, contrast, polarity, px })) };
    push('field', '明暗場（平整表面）', L.label, '', L.field === 'mixed' ? 'warn' : 'info', `${L.material}；視野內 ${round(L.brightRatio * 100, 0)}% 的位置鏡面反光進鏡頭（幾何估算）`);
    if (L.field !== 'back') push('uniformity', '照度均勻度', L.uniformity * 100, '%', L.uniformity >= 0.7 ? 'ok' : 'warn', '視野內最暗處 ÷ 最亮處（只算光源幾何）');
    if (L.hiddenRatio > 0) push('occlusion', '相機被擋住', L.hiddenRatio * 100, '%', 'warn', '視野內被治具或障礙物擋住、相機看不到的比例');
    if (L.shadowRatio > 0.05) push('shadow', '陰影', L.shadowRatio * 100, '%', 'warn', '視野內超過 1/4 的光被擋住的比例');
    for (const x of L.defects) {
      const judged = want ? want.includes(x.kind) : false, pxOk = x.px == null || x.px >= needPx;
      const status = !judged ? 'info' : x.contrast >= 0.2 && pxOk ? 'ok' : x.contrast >= 0.1 && pxOk ? 'warn' : 'fail';
      push(`defect-${x.kind}`, `缺陷可見度：${x.kind}`, x.contrast * 100, '%', status, `${x.polarity === '亮' ? '亮點在暗背景' : '暗點在亮背景'}；對比 = |缺陷 − 周圍| ÷ 較亮者${x.px != null ? `；佔 ${round(x.px, 1)} px` : ''}${judged ? '（要檢出：對比 ≥ 20% 才算看得到）' : ''}`);
    }
  }
  const worst = out.some(r => r.status === 'fail') ? 'fail' : out.some(r => r.status === 'warn') ? 'warn' : 'ok';
  return { derived: d, results: out, status: worst };
}
