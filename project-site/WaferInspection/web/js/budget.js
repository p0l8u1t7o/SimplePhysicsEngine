// 光學與節拍估算：視野、物方解析、缺陷像素數、景深、頻寬用 core/optics 的 evaluate()（L1），
// 明暗場分類用 core/optics 的 L2（lighting.js，經 evaluate 帶入）。週期用 sequence.js 的同一份時序加總，不另外估。
//
// 適用範圍（重要）：core/optics 的鏡頭是薄透鏡或固定倍率近似；L2 是幾何打光近似，材質只有一般表面（這裡借用「鏡面金屬」
// 代表拋光晶圓的平整區，只用來判斷同軸光是明場、低角度環形光是暗場）。晶圓薄膜干涉、細密圖案繞射、真實缺陷散射
// 都不在模型裡，缺陷對比與檢出率不能由此推得，必須打光 POC。
import { evaluate, INTERFACES } from '@core/optics/optics.js';

const r = (v, n = 2) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** n) / 10 ** n;

// 光學（L1＋L2）：回傳 { fov, umPerPx, defectPx, dof, frameMB, ifMBs, transferS, rows（core 的結果列）, bf, df, missing }
export function opticsOf(p) {
  const camera = { pixel: p.camPx, hPx: p.camH, vPx: p.camV, fps: p.camFps ?? undefined, interface: p.camIf, bits: p.camBits };
  const lens = { type: '遠心', magnification: p.mag, fNumber: p.fNum };
  const scene = { wd: p.wd, defect: p.defect, pxPerDefect: p.pxPerDefect, cocPx: 2, target: { heightRange: p.flatness } };
  const bf = evaluate({ camera, lens, light: { type: '同軸' }, scene: { ...scene, material: '鏡面金屬' } });
  const df = evaluate({ camera, lens, light: { type: '環形', size: p.dfRingD, distance: p.dfHeight }, scene: { ...scene, material: '鏡面金屬' } });
  const d = bf.derived, ifMBs = INTERFACES[p.camIf] ?? null;
  const frameMB = d.frameMB ?? (p.camH && p.camV ? p.camH * p.camV * (p.camBits / 8) / 1e6 : null);
  return {
    fov: d.fov && d.fov[1] ? d.fov : null, umPerPx: d.mmPerPx != null ? d.mmPerPx * 1000 : null, defectPx: d.defectPx ?? null, dof: d.dof ?? null,
    frameMB, ifMBs, transferS: frameMB && ifMBs ? frameMB / ifMBs : null,
    lightAngleDF: df.derived.lightAngle ?? null,
    bfField: bf.derived.lighting?.field ?? null, dfField: df.derived.lighting?.field ?? null,
    rows: bf.results.filter(x => ['magnification', 'fov', 'resolution', 'defect', 'dof', 'bandwidth'].includes(x.key)),
    lightRows: [...bf.results.filter(x => ['light', 'field'].includes(x.key)).map(x => ({ ...x, label: '明場（同軸）' + x.label })),
      ...df.results.filter(x => ['light', 'field', 'uniformity'].includes(x.key)).map(x => ({ ...x, label: '暗場（環形）' + x.label }))],
  };
}

// 整片估算：plan（scan-plan）、full（全掃描的 buildSchedule 結果）、cov（覆蓋）、dies、review（複檢清單）
export function estimate(p, optics, plan, full, { cov, dies, wasted, review }) {
  if (!plan.valid || !full) return { valid: false, reason: plan.reason || '缺少必要參數' };
  const n = plan.positions.length, images = n * 2, area = Math.PI * plan.Rv ** 2;
  const GB = full.frames * (full.frameMB ?? 0) / 1000;
  const c = full.cat;
  return {
    valid: true,
    fov: optics.fov, umPerPx: optics.umPerPx, defectPx: optics.defectPx, dof: optics.dof,
    positions: n, edgePositions: plan.positions.filter(q => q.edge).length, rows: plan.rows.length, images, frames: full.frames, reviewCount: review.length,
    validArea: area, exclusionArea: Math.PI * ((p.waferD / 2) ** 2 - plan.Rv ** 2), wastedArea: wasted, coverage: cov.ratio, dies,
    dataGB: GB, cycle: full.total,
    breakdown: [
      { key: 'vacuum', label: '真空建立與確認', s: c.vacuum },
      { key: 'align', label: '對位（移動、停穩、取像、θ 修正）', s: c.align },
      { key: 'focus', label: `對焦（${p.afPoints} 點）`, s: c.focus },
      { key: 'move', label: '掃描移動', s: c.move },
      { key: 'settle', label: '掃描停穩', s: c.settle },
      { key: 'expose', label: '曝光與明暗場切換', s: c.expose },
      { key: 'wait', label: '等待影像傳輸（相機緩衝滿）', s: c.wait },
      { key: 'tail', label: '最後一批傳輸與演算', s: c.tail },
      { key: 'review', label: `複檢（${review.length} 處）`, s: c.review },
      { key: 'finish', label: '彙整、破真空、回取放片位', s: c.finish },
    ],
    parallel: [
      { label: '影像讀出與傳輸（與移動並行）', s: full.transferBusy, note: `每張 ${r(full.frameMB, 1)} MB ÷ ${optics.ifMBs} MB/s` },
      { label: '演算處理（與取像並行）', s: full.procBusy, note: `每張 ${p.procImg} s × ${full.frames} 張 ÷ ${p.procThreads} 並行` },
    ],
    bottleneck: c.wait > 0.1 * c.move ? '影像傳輸（介面頻寬）' : c.move + c.settle > c.expose * 5 ? '平台移動與停穩' : '曝光',
    takt: p.taktTarget, taktOk: p.taktTarget == null ? null : full.total <= p.taktTarget,
  };
}

// 線掃描比較（只做參數比較，不另建設備動畫）：同樣的物方解析度下，速度、行頻、道數、資料量與整合風險
export function lineScanCompare(p, optics, plan) {
  if (!plan.valid || optics.umPerPx == null) return null;
  const px = optics.umPerPx / 1000, D = 2 * plan.Rv;
  const cfgs = [{ name: '線掃 8k', pixels: 8192, lineKHz: 80 }, { name: '線掃 16k', pixels: 16384, lineKHz: 70 }];
  return cfgs.map(c => {
    const swath = c.pixels * px, swaths = Math.ceil(D / (swath * (1 - p.overlap))), v = Math.min(c.lineKHz * 1000 * px, p.vMax);
    const lineHz = v / px, pass = swaths * (D / v + 0.4), passes = 2;                   // 明場、暗場各掃一次（多光場同時取像要專用相機，待確認）
    const gpx = Math.PI * (D / 2) ** 2 / (px * px) / 1e9;
    return { name: c.name, swath: r(swath, 1), swaths, speed: r(v, 0), lineKHz: r(lineHz / 1000, 1), maxLineKHz: c.lineKHz,
      scanS: r(pass * passes, 0), dataGB: r(gpx * passes * (p.camBits / 8), 1), passes,
      risks: '需要等速平台＋編碼器觸發、沿掃描方向的動態對焦、亮度不足時要 TDI；相機與光源規格為示意（型錄待確認）' };
  });
}
