// 數位空間（機台西側的示意區，全部 userData.fx，不列入干涉檢查）：把放大的產品模型擺在平台上，依流程顯示
//   快掃點雲與 ICP 對位 → 產品檔（A/B 面、設計特徵遮罩、視角與覆蓋率、拍攝路徑）→ 取像覆蓋進度 → 候選點、AI 分類與分級 → 3D 熱圖。
// 狀態只由 set(state) 的參數決定（倒帶、跳播一致）；貼圖文字只在瀏覽器畫。
import * as THREE from 'three';
import { HAS_DOM, block, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { colorGeometry, productGeometry, productData } from './product-mesh.js';
import { TWIN, REWORK, NG_RACK, OK_BIN } from './layout.js';

const C = {
  plain: new THREE.Color(0xd9dee4), A: new THREE.Color(0x8cc4ff), B: new THREE.Color(0xc4c9cf), none: new THREE.Color(0x39424d),
  mask: new THREE.Color(0x6c7684), cov: new THREE.Color(0x3dd68c), heatLo: new THREE.Color(0x2d5f9a), heatHi: new THREE.Color(0xff5a2a),
};
const VERDICT = { candidate: 0xffc83d, ignore: 0x8b96a3, NG: 0xff4d4d, OK: 0x3dd68c };

export function textPlane(w, h, pxW = 1000, pxH = 620) {
  const real = HAS_DOM, canvas = real ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = pxW; canvas.height = pxH; }
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null; if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: tex ? 0xffffff : 0x223344 }));
  mesh.userData.fx = true;
  let last = '';
  return { mesh, draw(key, fn) { if (!canvas || key === last) return; last = key; const g = canvas.getContext('2d'); g.clearRect(0, 0, pxW, pxH); fn(g, pxW, pxH); tex.needsUpdate = true; } };
}

export function createTwin(scene, prod, cands) {
  const root = new THREE.Group(); root.name = 'digital twin'; root.userData.fx = true; scene.add(root);
  const [cx, cy, cz] = TWIN.center, { m, cls, mask, firstView } = productData(prod);
  const size = m.max.clone().sub(m.min), scale = TWIN.height / Math.max(size.y, size.x * .8);
  // 平台：發光圓盤＋格線環
  const floorY = cy - TWIN.height / 2 - 60;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(720, 64), new THREE.MeshBasicMaterial({ color: 0x0d2236, transparent: true, opacity: .85 }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(cx, floorY, cz); root.add(disc);
  for (const r of [300, 500, 700]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r - 4, r, 96), new THREE.MeshBasicMaterial({ color: 0x2f7fd0, transparent: true, opacity: .55, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.set(cx, floorY + 1, cz); root.add(ring); }
  // 模型座：產品座標 → 數位空間（放大、置中，緩慢自轉）
  const holder = new THREE.Group(); holder.position.set(cx, cy, cz); root.add(holder);
  const model = new THREE.Group(); model.scale.setScalar(scale); model.position.copy(m.center).multiplyScalar(-scale); holder.add(model);
  const geo = colorGeometry(prod);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .45, metalness: .15, side: THREE.DoubleSide }));
  mesh.name = 'twin model'; model.add(mesh);
  // CAD 線框（ICP 對位時從偏移位置滑進點雲）
  const wire = new THREE.LineSegments(new THREE.EdgesGeometry(productGeometry(prod), 28), new THREE.LineBasicMaterial({ color: 0x67d4ff, transparent: true, opacity: .9 }));
  model.add(wire);
  // 點雲：從表面取樣（決定性：依三角形面積累計，固定間隔取點）
  const N = 2400, pts = new Float32Array(N * 3), acc = []; let tot = 0;
  for (let t = 0; t < m.nt; t++) { if (cls[t] === 2) { acc.push(tot); continue; } tot += m.area[t]; acc.push(tot); }
  for (let i = 0, t = 0; i < N; i++) {
    const target = (i + .5) / N * tot; while (t < m.nt - 1 && acc[t] < target) t++;
    const w1 = ((i * 7919) % 97) / 97, w2 = ((i * 104729) % 89) / 89 * (1 - w1), w0 = 1 - w1 - w2;
    for (let k = 0; k < 3; k++) pts[i * 3 + k] = w0 * m.positions[m.index[t * 3] * 3 + k] + w1 * m.positions[m.index[t * 3 + 1] * 3 + k] + w2 * m.positions[m.index[t * 3 + 2] * 3 + k] + m.nor[t * 3 + k] * .25;
  }
  const cloudGeo = new THREE.BufferGeometry(); cloudGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const cloud = new THREE.Points(cloudGeo, new THREE.PointsMaterial({ color: 0x4db2ff, size: 2.4 / scale * 2, sizeAttenuation: true }));
  model.add(cloud);
  // 視角圖示（相機方向在產品座標：甜蜜點往上＝相機；逆轉到產品座標）＋拍攝路徑
  const views = prod.file.views, icons = [], R = Math.max(size.x, size.y, size.z) * .55 + 18;
  const iconMat = new THREE.MeshBasicMaterial({ color: 0x9fe3ff }), pathPts = [];
  for (const v of views) {
    const q = new THREE.Quaternion(...v.quat).invert(), dir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const anchor = new THREE.Vector3(...v.anchor), p = anchor.clone().addScaledVector(dir, R);
    const ic = new THREE.Mesh(new THREE.ConeGeometry(3.2, 7, 4), iconMat.clone()); ic.position.copy(p);
    ic.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate()); model.add(ic); icons.push(ic); pathPts.push(p);
  }
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pathPts), new THREE.LineBasicMaterial({ color: 0xffd25a })); model.add(path);
  // 候選點標記（球＋法向量方向的細桿）
  const marks = cands.map((c, i) => {
    const g = new THREE.Group(); g.position.copy(c.pos); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.nor); model.add(g);
    const mat = new THREE.MeshBasicMaterial({ color: VERDICT.candidate, transparent: true, opacity: .95 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(16 / scale, 16, 10), mat); ball.position.y = 12 / scale; g.add(ball);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(2 / scale, 2 / scale, 60 / scale, 6), mat); stick.position.y = 40 / scale; g.add(stick);
    const tag = textPlane(50 / scale, 38 / scale, 96, 72);
    tag.draw('id', (ctx, w, h) => { ctx.fillStyle = '#172b3e'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 54px sans-serif'; ctx.fillText(String(i + 1), 28, 55); });
    tag.mesh.position.y = 85 / scale; tag.mesh.material.depthTest = false; g.add(tag.mesh);
    return { g, mat, c, tag };
  });
  // 熱圖中心：固定位置（示範：電鍍掛架接觸點在夾持端附近的同一側）
  const hot = new THREE.Vector3(m.center.x + size.x * .45, m.min.y + size.y * .14, m.center.z);
  // 資訊卡與柏拉圖放在模型右邊；候選明細放左下，左上留給主相機浮動視窗。
  const card = textPlane(780, 390); card.mesh.position.set(cx + 1060, cy + 480, cz); root.add(card.mesh);
  const detail = textPlane(800, 460); detail.mesh.position.set(cx - 1120, cy - 150, cz); root.add(detail.mesh);
  const legend = textPlane(1500, 90, 1500, 100); legend.mesh.position.set(cx - 300, cy - 600, cz + 850); legend.mesh.material.depthTest = false; legend.mesh.renderOrder = 10; root.add(legend.mesh);
  legend.draw('legend', (g, w, h) => { g.fillStyle = '#10283a'; g.fillRect(0, 0, w, h); g.font = '30px Microsoft JhengHei,sans-serif';
    [['A 面 淡藍', '#8cc4ff'], ['B 面 淡灰', '#c4c9cf'], ['不檢 深灰', '#728090'], ['遮罩 ▧', '#969eaa'], ['已覆蓋 綠', '#3dd68c']].forEach(([s, c], i) => { g.fillStyle = c; g.fillRect(25 + i * 295, 35, 22, 22); g.fillText(s, 60 + i * 295, 58); }); });
  // 遮罩三角形以灰色輪廓顯示，法向微移避免與模型共面。
  const maskPts = [];
  for (let t = 0; t < m.nt; t++) if (mask[t]) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) for (const k of [a, b]) {
    const v = m.index[t * 3 + k]; for (let axis = 0; axis < 3; axis++) maskPts.push(m.positions[v * 3 + axis] + m.nor[t * 3 + axis] * .12);
  }
  const maskGeo = new THREE.BufferGeometry(); maskGeo.setAttribute('position', new THREE.Float32BufferAttribute(maskPts, 3));
  const maskLines = new THREE.LineSegments(maskGeo, new THREE.LineBasicMaterial({ color: 0x939da9, transparent: true, opacity: .6 })); model.add(maskLines);
  const heatPts = new Float32Array(150 * 3);
  for (let i = 0; i < 150; i++) {
    const a = i * 2.399963, r = Math.sqrt((i + .5) / 150) * Math.max(size.x, size.y) * .07;
    heatPts.set([hot.x + Math.cos(a) * r, hot.y + Math.sin(a) * r, hot.z + Math.sin(i * 1.7) * r * .3], i * 3);
  }
  const heatGeo = new THREE.BufferGeometry(); heatGeo.setAttribute('position', new THREE.BufferAttribute(heatPts, 3));
  const heatCloud = new THREE.Points(heatGeo, new THREE.PointsMaterial({ color: 0xff744c, size: 8 / scale, depthTest: false, transparent: true, opacity: .8 })); model.add(heatCloud);
  const pareto = textPlane(780, 500); pareto.mesh.position.set(cx + 1060, cy - 100, cz); root.add(pareto.mesh);
  pareto.draw('pareto', (g, w, h) => {
    g.fillStyle = '#10283a'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2edf7'; g.font = 'bold 42px Microsoft JhengHei,sans-serif'; g.fillText('柏拉圖 / 缺陷類型', 35, 65);
    g.font = '27px Microsoft JhengHei,sans-serif'; g.fillStyle = '#9db3c7'; g.fillText('示意分布・非實測數量', 35, 113);
    ['碰傷', '異色', '刮痕'].forEach((s, i) => { g.fillStyle = ['#ff795c', '#f5b758', '#669bc8'][i]; g.fillRect(90 + i * 285, 440 - [240, 150, 80][i], 155, [240, 150, 80][i]); g.fillStyle = '#dae5ef'; g.fillText(s, 120 + i * 285, 490); });
    g.strokeStyle = '#86deb7'; g.lineWidth = 5; g.beginPath(); [[167, 275], [452, 200], [737, 175]].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
    g.fillStyle = '#9db3c7'; g.fillText('熱點累積 → 回查掛架接觸位置', 35, 565);
  });
  // 重工工作桌為實體；平板上的模型、候選點與縮圖全是數位顯示效果。
  const bench = new THREE.Group(); bench.name = 'rework station'; scene.add(bench);
  block(bench, [800, 35, 480], [REWORK.x, 850, REWORK.z], MAT.frame);
  for (const x of [-350, 350]) for (const z of [-190, 190]) block(bench, [35, 832, 35], [REWORK.x + x, 416, REWORK.z + z], MAT.frame);
  block(bench, [500, 310, 24], [REWORK.x, 1040, REWORK.z - 60], MAT.black);
  const tablet = new THREE.Group(); tablet.name = 'rework tablet display'; tablet.userData.fx = true; tablet.position.set(REWORK.x, 1040, REWORK.z - 44); scene.add(tablet);
  const mini = new THREE.Group(); tablet.add(mini);
  const miniMesh = new THREE.Mesh(productGeometry(prod), new THREE.MeshBasicMaterial({ color: 0x8cc4ff, wireframe: true }));
  const miniScale = 170 / Math.max(size.x, size.y, size.z); mini.scale.setScalar(miniScale); miniMesh.position.copy(m.center).negate(); mini.add(miniMesh);
  for (const c of cands) { const dot = new THREE.Mesh(new THREE.SphereGeometry(5 / miniScale, 10, 8), new THREE.MeshBasicMaterial({ color: VERDICT[c.verdict] })); dot.position.copy(c.pos).sub(m.center); mini.add(dot); }
  const tiles = textPlane(210, 260, 420, 520); tiles.mesh.position.set(128, 0, 35); tablet.add(tiles.mesh);
  tiles.draw('tiles', (g, w, h) => { g.fillStyle = '#0d2236'; g.fillRect(0, 0, w, h); g.fillStyle = '#d5e5f4'; g.font = '26px Microsoft JhengHei,sans-serif'; g.fillText('重工 / 缺陷縮圖 SIM', 16, 40);
    cands.slice(0, 3).forEach((c, i) => { const y = 65 + i * 145; g.fillStyle = '#526371'; g.fillRect(16, y, 380, 120); g.strokeStyle = '#f66'; g.lineWidth = 4; g.beginPath(); g.arc(70, y + 55, 25, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#fff'; g.fillText(`${i + 1} ${c.type.slice(0, 5)}`, 112, y + 45); g.fillText(`${c.face} 面 / ${c.verdict === 'ignore' ? '排除' : c.verdict === 'OK' ? '允收' : 'NG'}`, 112, y + 85); }); });
  mini.position.x = -105;
  // 格位與料箱襯墊：不改變既有產品落點。
  for (const y of [520, 880]) for (let i = 0; i < 3; i++) plate(scene, [`NG-${(y === 520 ? 1 : 4) + i}`], 145, 45, [NG_RACK.x - 180 + i * 180, y - 35, NG_RACK.z + 194], 0, { bg: '#6b2930' });
  const bins = new THREE.Group(); bins.name = 'output bin details'; scene.add(bins);
  for (const z of [-163, 163]) block(bins, [500, 45, 8], [OK_BIN.x, 760, OK_BIN.z + z], MAT.green);
  for (const x of [-246, 246]) block(bins, [8, 45, 320], [OK_BIN.x + x, 760, OK_BIN.z], MAT.green);
  plate(bins, ['OK / 軟墊承接'], 340, 65, [OK_BIN.x, 650, OK_BIN.z + 166], 0, { bg: '#235b42' });

  // ---------------------------------------------------------------- 狀態
  const tmp = new THREE.Color();
  let paintKey = '';
  function paint(mode, k) {
    const key = mode + '|' + k; if (key === paintKey) return; paintKey = key;
    geo.userData.paint(t => {
      if (mode === 'plain' || mode === 'cloud') return C.plain;
      if (cls[t] === 2) return C.none;
      if (mode === 'heat') {
        const p = tmp.set(0, 0, 0), d = Math.hypot(m.cen[t * 3] - hot.x, m.cen[t * 3 + 1] - hot.y, m.cen[t * 3 + 2] - hot.z) / Math.max(size.x, size.y);
        return p.copy(C.heatLo).lerp(C.heatHi, Math.max(0, 1 - d / .22) * k);
      }
      const base = cls[t] === 0 ? C.A : C.B;
      if (mode === 'class') return base;
      if (mode === 'mask') return mask[t] ? C.mask : base;
      if (mode === 'cover') return firstView[t] < k ? C.cov : mask[t] ? C.mask : base;
      return base;
    });
  }
  function set(s, t) {
    const mode = s.twin || 'off';
    root.visible = mode !== 'off';
    tablet.visible = mode === 'judge' || mode === 'stats'; mini.rotation.y = t * .22;
    maskLines.visible = ['plan', 'scan', 'judge'].includes(mode) && (mode !== 'plan' || s.plan >= 1);
    heatCloud.visible = mode === 'stats'; heatGeo.setDrawRange(0, Math.round(150 * (s.heat ?? 0)));
    pareto.mesh.visible = mode === 'stats';
    detail.mesh.visible = mode === 'judge' || mode === 'stats';
    const detailKey = mode + '|' + ((s.judge ?? 0) < .67 ? 'candidate' : 'graded');
    detail.draw(detailKey, (g, w, h) => {
      g.fillStyle = '#10283a'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2edf7'; g.font = 'bold 38px Microsoft JhengHei,sans-serif'; g.fillText('候選點 / 分級（SIM）', 28, 55);
      cands.forEach((c, i) => { const y = 100 + i * 98; const verdict = (s.judge ?? 0) < .67 ? '候選' : c.verdict === 'ignore' ? '排除' : c.verdict === 'OK' ? '允收' : 'NG';
        g.fillStyle = c.verdict === 'NG' ? '#ff8989' : c.verdict === 'ignore' ? '#a0aab6' : '#68dbaa'; g.font = '30px Microsoft JhengHei,sans-serif'; g.fillText(`${i + 1}  ${c.type} / ${c.face} 面 / ${verdict}`, 28, y);
        g.fillStyle = '#b4c7d8'; g.font = '26px Microsoft JhengHei,sans-serif'; g.fillText(c.limit == null ? '設計特徵／正常紋理：不適用允收限值' : `${c.unit === 'ΔE' ? 'ΔE ' : ''}${c.value}${c.unit === 'ΔE' ? '' : ' ' + c.unit} / 限 ${c.limit}`, 60, y + 36);
      });
    });
    holder.rotation.y = .25 * t;                                                 // 緩慢自轉（只由時間決定）
    const showModel = mode !== 'cloud';
    mesh.visible = showModel || s.icp > .98;
    // 點雲：快掃時逐步出現；ICP 時保留
    cloud.visible = mode === 'cloud' || mode === 'icp';
    cloudGeo.setDrawRange(0, Math.round(N * Math.min(1, s.cloud ?? 0)));
    // CAD 線框：ICP 由偏移（平移 + 旋轉）收斂到點雲
    wire.visible = mode === 'icp' || mode === 'plan';
    const e = 1 - (s.icp ?? 0);
    wire.position.set(18 * e, 10 * e, -14 * e); wire.rotation.set(.35 * e, .5 * e, -.2 * e);
    paint(mode === 'icp' ? (s.icp > .98 ? 'class' : 'plain') : mode === 'plan' ? (s.plan < 1 ? 'class' : s.plan < 2 ? 'mask' : 'cover') : mode === 'scan' ? 'cover' : mode === 'judge' ? 'cover' : mode === 'stats' ? 'heat' : 'plain',
      mode === 'plan' ? (s.plan < 2 ? 0 : Math.floor(views.length * Math.min(1, s.plan - 2))) : mode === 'scan' ? s.cov : mode === 'judge' ? views.length : mode === 'stats' ? Math.round((s.heat ?? 0) * 20) / 20 : 0);
    // 視角圖示與路徑
    const nIcons = mode === 'plan' ? Math.floor(views.length * Math.min(1, Math.max(0, s.plan - 2))) : mode === 'scan' ? views.length : 0;
    icons.forEach((ic, k) => { ic.visible = k < nIcons; ic.material.color.setHex(mode === 'scan' && k === s.cov - 1 ? 0xffffff : mode === 'scan' && k < s.cov ? 0x3dd68c : 0x9fe3ff); ic.scale.setScalar(mode === 'scan' && k === s.cov - 1 ? 1.6 : 1); });
    path.visible = (mode === 'plan' && s.plan >= 3) || mode === 'scan';
    path.geometry.setDrawRange(0, mode === 'plan' ? Math.ceil(views.length * Math.min(1, s.plan - 3)) : views.length);
    // 候選點：判定 0～1/3 浮現（黃）、1/3～2/3 AI 分類（非瑕疵轉灰後消失）、2/3～1 分級（紅 NG／綠允收）
    const j = s.judge ?? 0;
    for (const mk of marks) {
      const c = mk.c, show = mode === 'stats' || mode === 'judge' && j > .05 * (1 + marks.indexOf(mk));
      mk.g.visible = show;
      mk.mat.color.setHex(j < .34 ? VERDICT.candidate : c.verdict === 'ignore' ? VERDICT.ignore : j < .67 ? VERDICT.candidate : VERDICT[c.verdict]);
      mk.g.scale.setScalar(c.verdict === 'NG' && j > .67 ? 1.5 : 1);
      mk.tag.mesh.quaternion.copy(holder.quaternion).multiply(mk.g.quaternion).invert();
    }
  }
  root.traverse(o => { o.userData.fx = true; }); tablet.traverse(o => { o.userData.fx = true; });
  return { root, model, mesh, cloud, wire, icons, path, marks, card, detail, legend, maskLines, heatCloud, pareto, tablet, scale, set };
}
