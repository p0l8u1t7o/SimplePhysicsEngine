// 面板：每一張取像的模擬畫面（最新一張＋前 6 張）、NG 放大、影像佇列與判定。兩個方案共用，資料來自 project.shots／project.queue。
// 模擬畫面：在拍攝當下的時間點用該相機（反射鏡相機用鏡中虛像相機）渲染場景，轉灰階，亮度依該張的控光配方（亮度 %）縮放；
// 拍到缺陷的張數用紅框標出（位置由缺陷在畫面中的投影算），並在角落放大。只是示意，不是光學模擬影像。
import * as THREE from 'three';
import { queueAt } from './inspect-queue.js';

export function createShotView({ renderer, scene, project, root, hideDuring = [] }) {
  const BW = 352, BH = 264, SW = 112, SH = 84, NT = 6;
  root.innerHTML = `<div class="shotBig"><canvas width="${BW}" height="${BH}"></canvas><canvas class="zoom" width="120" height="120"></canvas><div class="cap"></div></div>
    <div class="shotStrip">${Array.from({ length: NT }, () => `<div class="tile"><canvas width="${SW}" height="${SH}"></canvas><div class="cap"></div></div>`).join('')}</div>`;
  const big = root.querySelector('.shotBig canvas'), bctx = big.getContext('2d'), zoom = root.querySelector('.zoom'), zctx = zoom.getContext('2d'), bcap = root.querySelector('.shotBig .cap');
  const tiles = [...root.querySelectorAll('.tile')].map(t => ({ c: t.querySelector('canvas'), cap: t.querySelector('.cap'), el: t }));
  const rt = new THREE.WebGLRenderTarget(BW, BH), zrt = new THREE.WebGLRenderTarget(120, 120), px = new Uint8Array(BW * BH * 4), zpx = new Uint8Array(120 * 120 * 4);
  const img = new ImageData(BW, BH), zimg = new ImageData(120, 120);
  const shots = project.shots, history = [];   // history：最近的 [{ shot, bitmap（ImageData 縮圖）, box }]
  let lastT = -1;
  zoom.style.display = 'none';

  // 讀回畫素 → 灰階；gain 未給時自動曝光（平均亮度對到配方亮度的目標值）
  function grab(target, buf, image, w, h, bright, gain = null) {
    renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
    if (gain == null) {
      let sum = 0; for (let i = 0; i < buf.length; i += 16) sum += .3 * buf[i] + .59 * buf[i + 1] + .11 * buf[i + 2];
      const mean = Math.max(1, sum / (buf.length / 16)) / 255;
      gain = .2 * Math.pow(bright / 150, .35) / mean;
    }
    const d = image.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4, o = (y * w + x) * 4;
      const v = Math.min(1, (.3 * buf[i] + .59 * buf[i + 1] + .11 * buf[i + 2]) / 255 * gain), g = Math.round(255 * Math.pow(v, 1 / 2.2));
      d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255;
    }
    return gain;
  }
  function render(shot) {
    const cam = project.viewCamOf(shot.cam); if (!cam) return null;
    project.apply(shot.t); scene.updateMatrixWorld(true);
    const hidden = [];
    for (const o of hideDuring()) if (o?.visible) { o.visible = false; hidden.push(o); }
    scene.traverse(o => { if (o.name === 'defect-ring' && o.visible) { o.visible = false; hidden.push(o); } });
    const old = renderer.getRenderTarget(), aspect = cam.aspect;
    cam.aspect = BW / BH; cam.updateProjectionMatrix();
    renderer.setRenderTarget(rt); renderer.render(scene, cam);
    const gain = grab(rt, px, img, BW, BH, shot.bright);   // 配方亮度 → 畫面亮度（示意）
    // 缺陷位置（投影到畫面）
    let box = null, zoomImg = null;
    if (shot.defects?.length) {
      const part = project.parts.find(p => p.k === shot.part), g = part?.defects?.[0];
      if (g) {
        const w = g.getWorldPosition(new THREE.Vector3()).project(cam), x = (w.x * .5 + .5) * BW, y = (-w.y * .5 + .5) * BH;
        box = { x, y, ng: shot.ng, label: `${shot.defects[0].kind} ${shot.defects[0].size} mm` };
        // 放大：同一台相機只取缺陷周圍（view offset）
        const fw = 2048, fh = fw * BH / BW, zs = 160;
        cam.setViewOffset(fw, fh, x / BW * fw - zs / 2, y / BH * fh - zs / 2, zs, zs); cam.updateProjectionMatrix();
        renderer.setRenderTarget(zrt); renderer.render(scene, cam); cam.clearViewOffset();
        grab(zrt, zpx, zimg, 120, 120, shot.bright, gain); zoomImg = new ImageData(new Uint8ClampedArray(zimg.data), 120, 120);
      }
    }
    renderer.setRenderTarget(old); cam.aspect = aspect; cam.updateProjectionMatrix();
    for (const o of hidden) o.visible = true;
    return { shot, image: new ImageData(new Uint8ClampedArray(img.data), BW, BH), box, zoomImg };
  }
  const caption = s => `${s.cam}${s.k >= 0 ? ` #${s.k + 1}` : ' 靜態'} · 第 ${s.part + 1} 顆 · ${s.ch} ${s.bright}%／${s.pulse} µs`;
  function draw() {
    const h = history[history.length - 1];
    if (!h) { bctx.fillStyle = '#0b1016'; bctx.fillRect(0, 0, BW, BH); bcap.textContent = '尚未取像'; tiles.forEach(t => { t.c.getContext('2d').clearRect(0, 0, SW, SH); t.cap.textContent = ''; }); zoom.style.display = 'none'; return; }
    bctx.putImageData(h.image, 0, 0);
    markBox(bctx, h.box, 1);
    bcap.textContent = caption(h.shot) + (h.box ? (h.box.ng ? ' → 拍到 NG 缺陷' : ' → 缺陷未達門檻') : '');
    bcap.classList.toggle('ng', !!h.box?.ng);
    // NG 放大：最近一張拍到缺陷的
    const z = [...history].reverse().find(x => x.zoomImg);
    if (z) { zoom.style.display = ''; zctx.putImageData(z.zoomImg, 0, 0); zctx.strokeStyle = z.box.ng ? '#ff4d4d' : '#ffb020'; zctx.lineWidth = 3; zctx.strokeRect(1.5, 1.5, 117, 117); zctx.fillStyle = '#000a'; zctx.fillRect(0, 100, 120, 20); zctx.fillStyle = '#fff'; zctx.font = '11px sans-serif'; zctx.fillText(z.box.label, 5, 114); }
    else zoom.style.display = 'none';
    const prev = history.slice(-NT - 1, -1).reverse();
    tiles.forEach((t, i) => {
      const x = prev[i], ctx = t.c.getContext('2d');
      if (!x) { ctx.fillStyle = '#0b1016'; ctx.fillRect(0, 0, SW, SH); t.cap.textContent = ''; t.el.classList.remove('ng'); return; }
      ctx.drawImage(toCanvas(x.image), 0, 0, SW, SH); markBox(ctx, x.box, SW / BW);
      t.cap.textContent = `${x.shot.cam}${x.shot.k >= 0 ? ` #${x.shot.k + 1}` : ''} ${x.shot.bright}%`;
      t.el.classList.toggle('ng', !!x.box?.ng);
    });
  }
  const tmpC = document.createElement('canvas'); tmpC.width = BW; tmpC.height = BH;
  const toCanvas = im => { tmpC.getContext('2d').putImageData(im, 0, 0); return tmpC; };
  function markBox(ctx, b, k) {
    if (!b) return;
    const r = Math.max(8, 14 * k * 2);
    ctx.strokeStyle = b.ng ? '#ff4d4d' : '#ffb020'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x * k - r, b.y * k - r, 2 * r, 2 * r);
  }
  // 時間 T：補渲染 (lastT, T] 之間的新張數（每格最多 4 張，其餘只記錄不渲染）；倒退或跳播時重建最近 7 張
  function update(T) {
    if (Math.abs(T - lastT) < 1e-6) return false;
    let from = lastT;
    if (T < lastT || T - lastT > 1.5) { history.length = 0; from = -Infinity; }
    const fresh = []; for (const s of shots) { if (s.t > T) break; if (s.t > from) fresh.push(s); }
    const todo = fresh.slice(-(from === -Infinity ? NT + 1 : 4));
    for (const s of todo) { const r = render(s); if (r) history.push(r); }
    while (history.length > NT + 1) history.shift();
    if (todo.length) project.apply(T);
    lastT = T; if (todo.length || from === -Infinity) draw();
    return todo.length > 0;
  }
  return { update, get latest() { return history[history.length - 1]?.shot; } };
}

// 影像佇列面板：佇列中張數的時間圖（前 8 s～後 2 s）＋每顆的拍攝、判定、就緒對需要時間
export function createQueueView({ project, root }) {
  const W = 352, H = 86;
  root.innerHTML = `<canvas width="${W}" height="${H}"></canvas><div class="qparts"></div>`;
  const cv = root.querySelector('canvas'), ctx = cv.getContext('2d'), list = root.querySelector('.qparts');
  const { images, verdicts, needAt } = project.queue;
  function update(T) {
    const t0 = T - 8, t1 = T + 2, X = t => (t - t0) / (t1 - t0) * W;
    ctx.fillStyle = '#0b1016'; ctx.fillRect(0, 0, W, H);
    // 佇列中張數
    const pts = []; let peak = 1;
    for (let t = t0; t <= T; t += .05) { const q = queueAt(images, t).waiting; pts.push([t, q]); peak = Math.max(peak, q); }
    ctx.fillStyle = 'rgba(151,117,250,.55)'; ctx.beginPath(); ctx.moveTo(X(t0), H - 14);
    for (const [t, q] of pts) ctx.lineTo(X(t), H - 14 - q / peak * (H - 30));
    ctx.lineTo(X(T), H - 14); ctx.closePath(); ctx.fill();
    // 拍攝時間（黃點）、判定點（紅線）
    ctx.fillStyle = '#f2c230'; for (const im of images) if (im.t >= t0 && im.t <= T) ctx.fillRect(X(im.t), H - 12, 1, 4);
    for (const v of verdicts) { const n = needAt(v.part); if (n >= t0 && n <= t1) { ctx.fillStyle = '#ff6b6b'; ctx.fillRect(X(n) - 1, 0, 2, H - 14); ctx.font = '10px sans-serif'; ctx.fillText(`第 ${v.part + 1} 顆分料點`, Math.min(X(n) + 3, W - 70), 11); } }
    ctx.fillStyle = '#4aa8ff'; ctx.fillRect(X(T) - 1, 0, 2, H);
    ctx.fillStyle = '#8b98a8'; ctx.font = '10px sans-serif'; ctx.fillText(`佇列 ${queueAt(images, T).waiting} 張（峰值 ${peak}）`, 4, H - 2); ctx.fillText('現在', X(T) - 26, H - 2);
    // 每顆狀態
    const q = queueAt(images, T).parts;
    list.innerHTML = verdicts.filter(v => q[v.part] || needAt(v.part) - T < 4).slice(-3).map(v => {
      const s = q[v.part] || { shot: 0, done: 0 }, ready = s.done === v.n, st = !s.shot ? '待拍' : ready ? (v.ng ? 'NG' : 'OK') : '判定中';
      const cls = ready ? (v.ng ? 'ng' : 'ok') : '';
      return `<div class="qp ${cls}"><b>第 ${v.part + 1} 顆</b> 已拍 ${s.shot}/${v.n}・已判 ${s.done}/${v.n} <span>${st}</span><br><small>全部判完比分料點${v.slack >= 0 ? `提前 ${v.slack.toFixed(2)} s，不用等` : `晚 ${(-v.slack).toFixed(2)} s，要等`}</small></div>`;
    }).join('');
  }
  return { update };
}
