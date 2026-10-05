// 以主時間軸反算最近一次硬體觸發；回呼期間才切到取像時刻，結束後完整還原。
import { objectRegion } from '@core/ui/vision-overlay.js';
import { KINDS } from './items.js';
import { LAYOUT as L } from './layout.js';

// 共用視窗按鈕的 aria-pressed 同時涵蓋停靠與獨立視窗；隱藏時不切換製程時間。
export function renderVisionFrame(project, scene, source, draw, requested) {
  if (!requested) return false;
  withVisionFrame(project, scene, source, draw);
  return true;
}

export function withVisionFrame(project, scene, source, draw) {
  const st = project.state;
  // CAM1／CAM2 是後段補抓站，CAM3／CAM4 是前段（ABB 站）；自動切換時跟著段落看前段或後段
  const front = source === 'CAM3' || source === 'CAM4' || (!['CAM1', 'CAM2'].includes(source) && !!st.chapter.front);
  const index = source === 'CAM2' || source === 'CAM4' ? 1 : source === 'CAM1' || source === 'CAM3' ? 0 : st.electrical.triggerIndex % 2;
  const cam = (front ? project.frontCameras : project.visionCameras)[index], stationX = front ? L.front.x : L.vision.x;
  const captureTime = project.timing.timeAt(st.electrical.triggerIndex);
  const savedMarks = project.marks.visible;
  const savedPatch = project.lightPatch.visible, frontPatch = project.front.lightPatch, savedFront = frontPatch.visible;
  try {
    project.apply(captureTime); scene.updateMatrixWorld(true); project.marks.visible = false;
    project.lightPatch.visible = frontPatch.visible = false;
    const regions = project.items.filter(it => it.grp.visible && Math.abs(it.grp.position.x - stationX) < 360 && Math.abs(it.grp.position.y - L.belt.top - 2) < 1).map(it => front ? {
      // 前段：綠＝派給 ABB、藍＝ABB 沒空而放行（交後段）、灰＝非目標
      points: objectRegion(it.grp),
      status: it.abbJob ? 'ok' : it.pass ? 'preview' : 'pending',
      label: `${KINDS[it.kind].label} · h ${Math.round(L.belt.top + 2 + it.H)} mm · ${it.abbJob ? 'ABB 抓取' : it.pass ? '放行→後段' : '不抓'}（示意）`,
    } : ({
      points: objectRegion(it.grp),
      status: project.missed.some(m => m.item.id === it.id) ? 'ng' : it.cls === 'food' ? 'ok' : it.cls === 'other' ? 'pending' : 'preview',
      label: `${KINDS[it.kind].label} · h ${Math.round(L.belt.top + 2 + it.H)} mm · θ ${Math.round(it.theta * 180 / Math.PI)}° · score ${(0.93 + (it.id % 5) * .01).toFixed(2)}（示意）`,
    }));
    return draw({ camera: cam.camera, aspect: cam.aspect, captureTime,
      title: `${front ? '前段 ' : ''}CAM-${index ? 'R' : 'L'} · f10 · ${cam.fieldOfView(front ? L.front.wd : L.vision.wd).map(Math.round).join('×')} mm · SIM／示意`,
      result: `第 ${st.electrical.triggerIndex} 次取像 · ${st.electrical.analysis ? '分類判定／畫面凍結' : st.electrical.capture ? '同步取像' : '等待觸發／保留前次影像'}`,
      marks: { title: front ? '前段分類與抓取分配／示意' : '立體分類與定位／示意', state: st.electrical.analysis ? '判定' : st.electrical.capture ? '取像' : '等待觸發', time: st.t, marks: regions },
    });
  } finally { project.apply(st.t); project.marks.visible = savedMarks; project.lightPatch.visible = savedPatch; frontPatch.visible = savedFront; scene.updateMatrixWorld(true); }
}
