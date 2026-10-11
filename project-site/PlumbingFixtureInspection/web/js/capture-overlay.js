// 取像後的相位→曲率→候選疊圖。產品輪廓來自該姿態的 CAD 投影；色圖為示意，非實測重建。
import * as THREE from 'three';
import { productData } from './product-mesh.js';
import { createRaster } from './raster.js';

export function capturePresentation(project, t) {
  const { step } = project.sequence.sample(t);
  if (step.station !== 4 && step.station !== 5) return null;
  const caps = project.sequence.steps.filter(s => s.capture != null);
  let cap = caps.filter(s => s.start + s.dur <= t + 1e-7).at(-1);
  let age = cap ? t - cap.start - cap.dur : 0;
  if (step.station === 5) {
    const measured = caps.filter(s => project.cands.some(c => c.view === s.capture));
    age = t - project.stationStart[5]; cap = measured[Math.floor(age / 2.1) % measured.length]; age %= 2.1;
  }
  if (!cap || step.capture != null) return null;
  const stage = age < .18 ? 0 : age < .4 ? 1 : 2;
  return { view: cap.capture, stage, candidates: project.cands.filter(c => c.view === cap.capture), label: ['相位圖', '曲率圖', '候選標記'][stage] };
}

export function createCaptureOverlay(project) {
  const { m } = productData(project.prod), camera = project.cell.cam.camera, cache = new Map();
  const W = 360, H = 264;
  function frame(view) {
    if (cache.has(view)) return cache.get(view);
    camera.aspect = W / H; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    const v = project.prod.file.views[view], q = new THREE.Quaternion(...v.quat), pos = new THREE.Vector3(...v.pos);
    const projectPoint = p => { const n = p.clone().applyQuaternion(q).add(pos).project(camera); return [(n.x + 1) * W / 2, (1 - n.y) * H / 2, n.z]; };
    const points = [];
    for (let i = 0; i < m.positions.length; i += 3) points.push(projectPoint(new THREE.Vector3(...m.positions.slice(i, i + 3))));
    const raster = createRaster(W, H); raster.clear();
    for (let i = 0; i < m.index.length; i += 3) raster.tri(...points[m.index[i]], ...points[m.index[i + 1]], ...points[m.index[i + 2]]);
    const marks = project.cands.filter(c => c.view === view).map(c => ({ c, p: projectPoint(c.pos) }));
    const canvases = [0, 1, 2].map(stage => {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d'), image = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = y * W + x; let rgb = [12, 24, 36];
        if (Number.isFinite(raster.depth[k])) {
          const bump = marks.reduce((a, mk) => Math.max(a, Math.exp(-((x - mk.p[0]) ** 2 + (y - mk.p[1]) ** 2) / 70)), 0);
          const wave = .5 + .5 * Math.sin(x * .16 + y * .06 + bump * 2.5);
          rgb = stage === 0 ? [30 + wave * 40, 75 + wave * 145, 160 + wave * 85] : stage === 1 ? [35 + bump * 210, 95 + bump * 55, 150 - bump * 90] : [140 + wave * 60, 151 + wave * 60, 161 + wave * 60];
        }
        image.data.set([...rgb, 255], k * 4);
      }
      ctx.putImageData(image, 0, 0); return canvas;
    });
    const result = { canvases, marks }; cache.set(view, result); return result;
  }
  return { draw(ctx, w, h, info) {
    const f = frame(info.view); ctx.drawImage(f.canvases[info.stage], 0, 0, w, h);
    ctx.fillStyle = '#0b2030e8'; ctx.fillRect(0, 0, w, 40); ctx.fillStyle = '#c5e8fa'; ctx.font = `${Math.max(16, w * .026)}px Microsoft JhengHei,sans-serif`;
    ctx.fillText(`SIM / 姿態 ${info.view + 1} / ${info.label}`, 12, 27);
    if (info.stage === 2) f.marks.forEach(({ c, p }, i) => {
      const x = p[0] / W * w, y = p[1] / H * h;
      ctx.strokeStyle = '#ff626a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
      const label = `${c.type}候選${c.unit === 'ΔE' ? ` / ΔE ${c.value.toFixed(1)}` : ''}`;
      const ty = h - 18 - i * 30; ctx.fillStyle = '#0b2030de'; ctx.fillRect(6, ty - 22, w - 12, 29); ctx.fillStyle = '#ff9398'; ctx.fillText(label, 12, ty);
    });
    if (!f.marks.length) { ctx.fillStyle = '#80ddb2'; ctx.fillText('此姿態未新增候選', 12, h - 16); }
  } };
}
