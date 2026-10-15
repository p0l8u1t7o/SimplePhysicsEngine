// 相機視窗使用同一套示意量值與時間，跳播不保留上一張影像或尚未取得的判定。
import { QP } from './qc-piece.js';
export function drawMeasurement(ctx, w, h, t, project, drawGrid) {
  const { part, plan, results } = project, m = project.measured(t), active = m.current >= 0;
  const R = active ? results[m.current] : null, sx = w / 800, sy = h / 500;
  ctx.save(); ctx.scale(sx, sy);
  ctx.fillStyle = '#101b25'; ctx.fillRect(0, 0, 800, 500);
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = '#e0ebf2';
  ctx.fillText(`${plan.name} · 模擬量測`, 24, 30);
  ctx.font = '14px sans-serif'; ctx.fillStyle = '#9bb0be';
  ctx.fillText(active ? `格位 ${m.current + 1} / ${project.cap}　${plan.mode === 'box' ? `第 ${m.row + 1} 列` : '工件頂面／基準面'}` : '等待有效量測觸發', 24, 54);
  const x0 = 66, x1 = 746, top = 83, bottom = 286;
  ctx.fillStyle = plan.sensor === 'vision' ? '#d9e5ed' : '#07121b'; ctx.fillRect(x0, top, x1 - x0, bottom - top);
  if (active && plan.sensor === 'vision') {
    const yRef = 264, cols = part.grid.cols, count = plan.mode === 'box' ? cols : 2;
    const pitch = (x1 - x0 - 40) / count;
    for (let i = 0; i < count; i++) {
      const index = plan.mode === 'box' ? m.row * cols + cols - 1 - i : m.current;
      const valid = m.has(index) || index === m.current, value = results[index];
      const width = pitch * (part.key === 'rotor' ? .75 : .64), x = x0 + 20 + i * pitch;
      // 輪廓保留整列外觀，只有已擷取的格位才疊上量測頂緣。
      const yTop = yRef - (valid ? value.h : part.h) / part.h * 156;
      ctx.fillStyle = '#111820'; ctx.fillRect(x, yTop, width, yRef - yTop);
      ctx.fillStyle = '#29343b'; ctx.fillRect(x + width - 5, yTop + 1, 4, yRef - yTop - 1);
      if (valid) { ctx.strokeStyle = value.ng ? '#d34432' : '#ee983f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 2, yTop); ctx.lineTo(x + width + 2, yTop); ctx.stroke(); }
    }
    ctx.strokeStyle = '#147b92'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, yRef); ctx.lineTo(x1, yRef); ctx.stroke();
    ctx.fillStyle = '#147b92'; ctx.fillText('基準邊', x0 + 8, yRef + 18);
    ctx.fillStyle = '#8c4704'; ctx.fillText('頂緣擬合', x0 + 8, top + 18);
    if (plan.mode === 'piece') { ctx.fillStyle = '#243943'; ctx.fillText('CAM A', 142, 245); ctx.fillText('CAM B · 90°', 435, 245); }
  } else if (active && plan.mode === 'box') {
    const row = m.row, cols = part.grid.cols, lo = part.h - part.tolN - .15, hi = part.h + part.tolP + .15;
    const y = value => bottom - 22 - (value - lo) / (hi - lo) * (bottom - top - 45);
    ctx.lineWidth = 1;
    for (const [value, label] of [[part.h - part.tolN, 'LSL'], [part.h + part.tolP, 'USL'], [part.h, 'NOM']]) {
      ctx.strokeStyle = '#475363'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(x0, y(value)); ctx.lineTo(x1, y(value)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#b7c5cf'; ctx.fillText(`${label} ${value.toFixed(2)}`, x0 + 8, y(value) - 5);
    }
    ctx.strokeStyle = '#49baff'; ctx.lineWidth = 2; ctx.beginPath();
    let started = false;
    for (let c = 0; c < cols; c++) {
      const i = row * cols + c;
      if (!m.has(i) && i !== m.current) { started = false; continue; }
      const x = x1 - 15 - c * (x1 - x0 - 30) / (cols - 1), v = results[i];
      if (!started) ctx.moveTo(x, y(v.h)); else ctx.lineTo(x, y(v.h)); started = true;
    }
    ctx.stroke(); ctx.fillStyle = '#9bb0be'; ctx.fillText('列內位置 →　高度 mm（扣除基準面）', x0 + 180, bottom - 3);
  } else if (active) {
    // 兩個共焦點：同一安裝高度下的距離差；讀值與既有高度示意值一致。
    ctx.fillStyle = '#768997'; ctx.fillRect(130, 252, 535, 15); ctx.fillRect(218, 155, 130, 97);
    ctx.strokeStyle = '#4abaff'; ctx.lineWidth = 2;
    const referenceDistance = QP.heads.y - QP.anvil.top;
    for (const [x, y, label, value] of [[283, 155, 'A 頂面距離', referenceDistance - R.h], [510, 252, 'B 砧面距離', referenceDistance]]) {
      ctx.beginPath(); ctx.moveTo(x, 115); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = '#8ed6ff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(`${label} ${value.toFixed(3)} mm`, x - 90, 103);
    }
    ctx.fillStyle = '#d9e6ee'; ctx.fillText('H = B − A', 375, 200);
  }
  if (!active) { ctx.fillStyle = '#77909f'; ctx.font = '20px sans-serif'; ctx.fillText('尚無本次有效影像', 290, 190); }
  ctx.fillStyle = R ? (R.ng ? '#ff7373' : '#61dfa1') : '#8a9ba8'; ctx.font = 'bold 24px monospace';
  ctx.fillText(R ? `${R.h.toFixed(3)} mm   ${R.ng ? 'NG' : 'OK'}` : '---.--- mm   WAIT', 24, 322);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#8ba1b2'; ctx.fillText('示意數值・非實際相機影像或精度驗證', 450, 320);
  ctx.save(); ctx.translate(20, 340); drawGrid(ctx, 760, 140, t, false); ctx.restore();
  ctx.restore();
}
