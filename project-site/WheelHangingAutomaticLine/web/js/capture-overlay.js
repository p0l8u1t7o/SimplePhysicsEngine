// 幾何投影模擬，不是實際影像辨識；量測歷史每次由排程回查，不保留上一幀。
import * as THREE from 'three';
import { STEREO, LINE } from './layout.js';
import { frontOf } from './sequence.js';

export const isCapture = step => /取像（粗）|^精取像$/.test(step.action);
export function capturePresentation(seq, t) {
  const { step } = seq.sample(t), p = step.track?.p;
  const captures = seq.steps.filter(s => isCapture(s) && s.start <= t);
  const last = captures.at(-1);
  const measuredAt = last ? Math.min(t, last.start + last.dur) : null;
  const lastMeasurement = last ? {
    time: measuredAt, model: last.track.p.spec.name,
    center: frontOf(last.track.p, measuredAt).add(new THREE.Vector3(0, 0, -last.track.p.spec.w / 2)).toArray(),
    od: +(last.track.p.spec.od + Math.sin(1.7 * last.track.p.j + 2.3) * .4).toFixed(1),
  } : null;
  const mode = !p ? 'idle' : step.action === '盲區直線接近' ? 'blind' :
    isCapture(step) || /辨識輪型|更新夾取點/.test(step.action) ? (step.station === 1 ? 'fine' : 'coarse') : 'idle';
  return { mode, p, lastMeasurement, exposure: isCapture(step),
    confidence: p ? .96 - .02 * p.j : null,
    encoderDelta: mode === 'blind' && lastMeasurement ? (t - lastMeasurement.time) * LINE.v : 0 };
}

// 圓形特徵取樣後投影成透視橢圓；和輪框模型共用 bore、pcd、hub，不能用固定畫面座標。
export function projectedFeatures(wheel, spec, camera, w, h) {
  camera.updateMatrixWorld(true); wheel.updateWorldMatrix(true, false);
  const point = (x, y, z) => {
    const v = wheel.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
    return [(v.x + 1) * w / 2, (1 - v.y) * h / 2, v.z];
  };
  const ring = (x, y, z, r) => Array.from({ length: 65 }, (_, i) => {
    const a = i / 64 * Math.PI * 2; return point(x + Math.cos(a) * r, y + Math.sin(a) * r, z);
  });
  const rings = [ring(0, 0, spec.w / 2 - 4, spec.od / 2), ring(0, 0, spec.hub + 14, spec.bore / 2)];
  for (let i = 0; i < spec.lugs; i++) {
    const a = Math.PI / 2 + i * 2 * Math.PI / spec.lugs;
    rings.push(ring(Math.cos(a) * spec.pcd / 2, Math.sin(a) * spec.pcd / 2, spec.hub + 21.6, 9));
  }
  const c = wheel.localToWorld(new THREE.Vector3(0, 0, spec.hub + 14)).applyMatrix4(camera.matrixWorldInverse);
  const depth = -c.z, disparity = STEREO.focal / STEREO.sensor[0] * STEREO.px[0] * STEREO.baseline / depth;
  return { rings, center: point(0, 0, spec.hub + 14), grips: [-1, 1].map(s => point(s * spec.od / 2, 0, spec.w / 2)), depth, disparity, point };
}

export function createCaptureOverlay(project) {
  const host = document.createElement('div'), canvas = document.createElement('canvas');
  host.className = 'wheel-vision-overlay'; host.style.cssText = 'inset:0;pointer-events:none';
  canvas.style.cssText = 'width:100%;height:100%;display:block'; host.append(canvas);
  return { host, hide() { host.hidden = true; }, draw(camera, rect, { time }) {
    host.hidden = false;
    const w = Math.round(rect.width * 2), h = Math.round(rect.height * 2);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'), info = capturePresentation(project.sequence, time);
    host.dataset.mode = info.mode;
    if (info.mode === 'idle') return;
    ctx.font = `${Math.max(24, w * .03)}px Microsoft JhengHei,sans-serif`;
    const text = (s, y, color = '#b5ffd8') => { ctx.fillStyle = '#081b29e8'; ctx.fillRect(0, y - 24, w, 32); ctx.fillStyle = color; ctx.fillText(s, 12, y); };
    if (info.mode === 'blind') {
      text('盲區：用最後量測＋編碼器推算', h / 2, '#ffd282');
      text(`最後量測 ${info.lastMeasurement.time.toFixed(2)} s · ΔX ${info.encoderDelta.toFixed(1)} mm`, h / 2 + 36, '#ffd282'); return;
    }
    const f = projectedFeatures(project.wheels[project.plan.indexOf(info.p)], info.p.spec, camera, w, h);
    const path = points => { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); };
    ctx.lineWidth = 2; ctx.strokeStyle = '#6fffc1';
    f.rings.forEach(r => { path(r); ctx.stroke(); });
    // 示意飽和遮罩只落在切削輪緣，不宣稱真實光學飽和或量測出的瑕疵。
    const spec = info.p.spec, mask = [];
    for (const r of [spec.od / 2 - 4, spec.od / 2 - 20]) {
      const arc = Array.from({ length: 21 }, (_, i) => { const a = .25 + i * .6 / 20; return f.point(r * Math.cos(a), r * Math.sin(a), spec.w / 2); });
      mask.push(...(mask.length ? arc.reverse() : arc));
    }
    path(mask); ctx.closePath(); ctx.fillStyle = '#ff697580'; ctx.fill();
    if (info.mode === 'fine') {
      ctx.strokeStyle = '#ffdf73';
      for (const [x, y] of [f.center, ...f.grips]) { ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke(); }
      f.grips.forEach(([x, y], i) => {
        if (x >= 12 && x <= w - 12 && y >= 40 && y <= h - 74) return;
        const ex = Math.max(12, Math.min(w - 12, x)), ey = Math.max(52, Math.min(h - 82, y));
        ctx.fillStyle = '#ffdf73'; ctx.textAlign = x > w / 2 ? 'right' : 'left';
        ctx.fillText(`${i ? '右' : '左'}夾取點（視野外）${x > w / 2 ? ' →' : ' ←'}`, ex, ey); ctx.textAlign = 'left';
      });
    }
    text(`SIM ${info.mode === 'fine' ? '精定位＋夾取點' : '粗取像'} · ${spec.name} · ${(info.confidence * 100).toFixed(0)}%`, 25);
    text(`Z ${f.depth.toFixed(1)} mm · 視差 ${f.disparity.toFixed(1)} px`, h - 42);
    text('綠：幾何擬合　紅：飽和遮罩示意', h - 9, '#ffc3c8');
  } };
}
