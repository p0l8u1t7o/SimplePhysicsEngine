// 依既有檢查紀錄繪製結果示意；不是相機實拍，也不提前顯示尚未完成的判定。
import { MOD, PIN_XZ } from './parts.js';
export function inspectionRecord(records, source, time) {
  return records.findLast(e => e.t <= time && (
    source === 'upI' ? e.cam === 'UP-2D' && e.part.startsWith('INT-') :
    source === 'upS' ? e.cam === 'UP-2D' && e.part.startsWith('SOC-') && e.item !== '位置修正' :
    source === 'pin' ? e.cam === 'UP-3D' :
    source === 'trayI' ? e.cam === 'TOP-3D' :
    source === 'trayS' ? e.cam === 'TOP-2D' : source === 'down' && e.cam === 'DOWN-2D')) ?? null;
}
export function drawInspection(ctx, width, height, { record, source }) {
  ctx.save(); ctx.scale(width / 720, height / 450);
  ctx.fillStyle = '#0b1720'; ctx.fillRect(0, 0, 720, 450);
  ctx.strokeStyle = '#152a36'; ctx.lineWidth = 1;
  for (let x = 0; x < 720; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 450); ctx.stroke(); }
  for (let y = 0; y < 450; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(720, y); ctx.stroke(); }
  const text = (s, x, y, color = '#b7cbd7', size = 18) => { ctx.fillStyle = color; ctx.font = `${size}px "Microsoft JhengHei",sans-serif`; ctx.fillText(s, x, y); };
  text('檢測結果示意 · 非相機實拍', 24, 32, '#86a8ba', 16);
  if (!record) {
    text('等待本來源完成第一次取像', 150, 210, '#e3edf3', 24);
    text('ROI 與判定將依主時間軸更新', 185, 250);
    ctx.restore(); return;
  }
  const bad = record.result !== 'OK', color = bad ? '#ff916d' : '#61e2ac';
  text(record.part + ' · ' + record.item, 24, 68, '#e3edf3', 21);
  text(bad ? '待處理／不合格' : '合格', 550, 68, color, 22);
  const px = x => 360 + x * 6.6, py = z => 210 + z * 6.6;
  if (source === 'down') {
    ctx.fillStyle = '#164e3e'; ctx.fillRect(80, 110, 560, 180);
    ctx.fillStyle = '#d6ad64'; ctx.beginPath(); ctx.arc(360, 200, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.strokeRect(316, 156, 88, 88);
    ctx.beginPath(); ctx.moveTo(290, 200); ctx.lineTo(430, 200); ctx.moveTo(360, 130); ctx.lineTo(360, 270); ctx.stroke();
  } else {
    ctx.fillStyle = '#252e34'; ctx.fillRect(px(-45), py(-7), 594, 92.4);
    if (source === 'trayS') {
      ctx.fillStyle = '#0b0d10'; for (const x of [-28.5, -14.2, 17.2, 30.2]) ctx.fillRect(px(x - 5.5), py(-5.3), 72.6, 70);
      text('記憶體模組', px(-34), py(0), '#cbd4d9', 13);
    } else {
      ctx.fillStyle = '#d9bb72';
      for (const [x, z] of PIN_XZ) ctx.fillRect(px(x) - 2, py(z) - 1.5, 4, 3);
    }
    MOD.holes.forEach((x, i) => {
      ctx.fillStyle = '#070c10'; ctx.beginPath(); ctx.arc(px(x), py(0), 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ccab75'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#57bded'; ctx.strokeRect(px(x) - 15, py(0) - 15, 30, 30);
      text(`孔 ${i + 1}`, px(x) - 20, 292, '#71d0f6', 14);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(px(-44), py(-6.7), 580.8, 88.4);
    if (bad) {
      ctx.strokeStyle = '#ff916d'; ctx.strokeRect(px(-20) - 12, py(2) - 12, 24, 24);
      text(source === 'pin' ? 'PIN 歪斜示意' : '異物區示意', px(-20) - 25, 140, '#ff916d', 16);
      ctx.beginPath(); ctx.moveTo(px(-20), 148); ctx.lineTo(px(-20), py(2) - 12); ctx.stroke();
    }
  }
  text(record.value ?? '未提供量測值', 24, 338, color, 18);
  text(`取像 ${record.t.toFixed(2)} s · 保留最近結果`, 24, 385, '#adc4d2', 17);
  text(`影像編號 ${String(Math.round(record.t * 100)).padStart(6, '0')} · ROI／數值均為示意`, 24, 421, '#86a8ba', 15);
  ctx.restore();
}
