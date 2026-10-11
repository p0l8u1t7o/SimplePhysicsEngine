// 數位空間（機台西側的示意區，全部 userData.fx，不列入干涉檢查）：把放大的產品模型擺在平台上，依流程顯示
//   快掃點雲與 ICP 對位 → 產品檔（A/B 面、設計特徵遮罩、視角與覆蓋率、拍攝路徑）→ 取像覆蓋進度 → 候選點、AI 分類與分級 → 3D 熱圖。
// 狀態只由 set(state) 的參數決定（倒帶、跳播一致）；貼圖文字只在瀏覽器畫。
import * as THREE from 'three';
import { HAS_DOM } from '@core/geom/shapes.js';
import { colorGeometry, productGeometry, productData } from './product-mesh.js';
import { TWIN } from './layout.js';

const C = {
  plain: new THREE.Color(0xd9dee4), A: new THREE.Color(0x8cc4ff), B: new THREE.Color(0xc4c9cf), none: new THREE.Color(0x39424d),
  mask: new THREE.Color(0x6c7684), cov: new THREE.Color(0x3dd68c), heatLo: new THREE.Color(0x2d5f9a), heatHi: new THREE.Color(0xff5a2a),
};
const VERDICT = { candidate: 0xffc83d, ignore: 0x8b96a3, NG: 0xff4d4d, OK: 0x3dd68c };

function textPlane(w, h, pxW = 640, pxH = 400) {
  const real = HAS_DOM, canvas = real ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = pxW; canvas.height = pxH; }
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null; if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: tex ? 0xffffff : 0x223344 }));
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
  const marks = cands.map(c => {
    const g = new THREE.Group(); g.position.copy(c.pos); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.nor); model.add(g);
    const mat = new THREE.MeshBasicMaterial({ color: VERDICT.candidate, transparent: true, opacity: .95 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 10), mat); ball.position.y = 1.2; g.add(ball);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, 6, 6), mat); stick.position.y = 4; g.add(stick);
    return { g, mat, c };
  });
  // 熱圖中心：固定位置（示範：電鍍掛架接觸點在夾持端附近的同一側）
  const hot = new THREE.Vector3(m.center.x + size.x * .45, m.min.y + size.y * .14, m.center.z);
  // 資訊卡（模型右上方）
  const card = textPlane(760, 470); card.mesh.position.set(cx + 160, cy + TWIN.height / 2 + 120, cz + 760); card.mesh.rotation.y = Math.PI / 2 - .35; root.add(card.mesh);

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
      const c = mk.c, show = mode === 'judge' && j > .05 * (1 + marks.indexOf(mk));
      const gone = c.verdict === 'ignore' && j > .62;
      mk.g.visible = show && !gone;
      mk.mat.color.setHex(j < .34 ? VERDICT.candidate : c.verdict === 'ignore' ? VERDICT.ignore : j < .67 ? VERDICT.candidate : VERDICT[c.verdict]);
      mk.g.scale.setScalar(c.verdict === 'NG' && j > .67 ? 1.5 : 1);
    }
  }
  return { root, model, mesh, cloud, wire, icons, path, marks, card, scale, set };
}
