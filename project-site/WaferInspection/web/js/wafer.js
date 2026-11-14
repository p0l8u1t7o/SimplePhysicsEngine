// 晶圓與晶圓上的疊圖：示意圖樣貼圖、掃描格（已完成／目前／未掃描／展示略過／待複檢）、掃描路徑與方向、
// 候選區（B）、真值（A，預設隱藏）、待人工確認（C）、邊緣排除區。疊圖都是非實體（userData.fx），只在畫面上。
// 晶圓群組的座標：x = 晶圓 x、z = −晶圓 y、y 往上（表面在 y = 厚度）。圖樣用 instancing／貼圖，不為每個小圖案建網格。
import * as THREE from 'three';
import { pattern } from './inspection-sim.js';

const LIFT = { cells: 0.12, path: 0.2, marks: 0.28 };       // 疊圖離晶圓表面的高度（mm，避免和表面重合閃爍）
export const CELL_COLORS = { pending: 0xb8c4d0, skipped: 0x4a525c, current: 0xffd34d, done: 0x3ccf7a, candidate: 0xff5a4a, recheck: 0xffa42b, missing: 0xff7ad9 };
export const CELL_LABEL = { pending: '未掃描', skipped: '展示略過（未取像）', current: '目前取像', done: '已取像・無候選', candidate: '已取像・有候選', recheck: '待複檢（品質不足）', missing: '缺圖・待複檢' };

const fx = o => { o.userData.fx = true; o.castShadow = false; o.receiveShadow = false; return o; };

// 示意圖樣貼圖（瀏覽器才畫；Node 檢查時沒有 canvas，用純色）
function patternTexture(p, size = 2048) {
  if (typeof HTMLCanvasElement === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), R = p.waferD / 2, pv = [0, 0];
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + .5) / size * 2 * R - R, y = R - (j + .5) / size * 2 * R, k = (j * size + i) * 4;
    pattern(x, y, p.dieW, p.dieH, pv);
    const b = pv[0], tint = (Math.floor(Math.abs(x) / 2.4) * 7 + Math.floor(Math.abs(y) / 2.4) * 13) % 5;
    img.data[k] = 70 + 175 * b; img.data[k + 1] = 38 + 140 * b * (tint === 4 ? 1.05 : .86); img.data[k + 2] = 34 + 120 * b * (tint === 2 ? 1.1 : .78); img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// 圓形裁切：掃描格超出晶圓的部分不畫（在 instance 座標判斷半徑）
function clipToDisc(material, R) {
  material.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vDisc;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvDisc = (instanceMatrix * vec4(position, 1.0)).xz;\n#else\nvDisc = position.xz;\n#endif');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vDisc;`)
      .replace('void main() {', `void main() {\n if (length(vDisc) > ${R.toFixed(3)}) discard;`);
  };
  return material;
}

export function createWafer(p, plan) {
  const R = p.waferD / 2, T = p.waferT, top = T;
  const group = new THREE.Group(); group.name = 'wafer';
  const tex = patternTexture(p);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 128), [
    new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: .3, metalness: .7 }),                       // 側面
    new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0x9a5a48, map: tex, roughness: .32, metalness: .45 }),   // 上表面
    new THREE.MeshStandardMaterial({ color: 0x7c8086, roughness: .4, metalness: .6 }),                       // 下表面
  ]);
  // CylinderGeometry 的頂蓋 UV 以圓心為 (0.5, 0.5)，貼圖剛好對到晶圓座標
  disc.position.y = T / 2; disc.name = 'wafer disc'; disc.castShadow = true; disc.receiveShadow = true; group.add(disc);
  // 缺口（notch）示意：晶圓下緣（−y）一個小三角暗標
  const notch = fx(new THREE.Mesh(new THREE.CircleGeometry(2.2, 3), new THREE.MeshBasicMaterial({ color: 0x15181c })));
  notch.rotation.x = -Math.PI / 2; notch.rotation.z = Math.PI / 2; notch.position.set(0, top + LIFT.marks, R - 1.6); notch.name = 'notch mark'; group.add(notch);

  const over = new THREE.Group(); over.name = 'wafer overlays'; fx(over); group.add(over);
  // 邊緣排除區
  if (plan.valid) {
    const ring = fx(new THREE.Mesh(new THREE.RingGeometry(plan.Rv, R, 160), new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: .28, depthWrite: false, side: THREE.DoubleSide })));
    ring.rotation.x = -Math.PI / 2; ring.position.y = top + LIFT.cells; ring.name = 'edge exclusion'; over.add(ring);
  }
  // 掃描格：每個位置一格（大小 = 步距，格與格不重疊）
  const n = plan.valid ? plan.positions.length : 0;
  const cellMat = clipToDisc(new THREE.MeshBasicMaterial({ transparent: true, opacity: .42, depthWrite: false, side: THREE.DoubleSide }), R);
  const cells = fx(new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), cellMat, Math.max(1, n)));
  cells.count = n; cells.name = 'scan cells'; cells.frustumCulled = false;
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), col = new THREE.Color();
  if (plan.valid) plan.positions.forEach(q => { m4.compose(new THREE.Vector3(q.x, top + LIFT.cells, -q.y), q4, new THREE.Vector3(plan.step[0] * .96, plan.step[1] * .96, 1)); cells.setMatrixAt(q.k, m4); cells.setColorAt(q.k, col.set(CELL_COLORS.pending)); });
  if (cells.instanceColor) cells.instanceColor.needsUpdate = true;
  over.add(cells);
  // 掃描路徑（全部）與已完成段
  const pathGeo = new THREE.BufferGeometry(), donePathGeo = new THREE.BufferGeometry();
  const path = fx(new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0x8fb4d8, transparent: true, opacity: .55 })));
  const donePath = fx(new THREE.Line(donePathGeo, new THREE.LineBasicMaterial({ color: 0x2ee59d })));
  path.name = 'scan path'; donePath.name = 'scan path done'; over.add(path, donePath);
  // 移動方向箭頭（目前位置 → 下一個位置）
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, 0x7fe3ff, 4, 3);
  arrow.name = 'move arrow'; arrow.traverse(fx); over.add(arrow);
  // 複檢路徑
  const reviewGeo = new THREE.BufferGeometry();
  const reviewPath = fx(new THREE.Line(reviewGeo, new THREE.LineDashedMaterial({ color: 0xff9a3c, dashSize: 4, gapSize: 3 })));
  reviewPath.name = 'review path'; over.add(reviewPath);
  // 標記群組：B 候選、A 真值、C 待人工確認、選取
  const marks = { B: new THREE.Group(), A: new THREE.Group(), C: new THREE.Group() };
  for (const [k, g] of Object.entries(marks)) { g.name = 'marks ' + k; fx(g); over.add(g); }
  marks.A.visible = false;
  const select = fx(new THREE.Mesh(new THREE.RingGeometry(5.2, 6.4, 40), new THREE.MeshBasicMaterial({ color: 0x40e0ff, side: THREE.DoubleSide, depthWrite: false })));
  select.rotation.x = -Math.PI / 2; select.visible = false; select.name = 'selected mark'; over.add(select);

  const lineMat = c => new THREE.LineBasicMaterial({ color: c, depthWrite: false });
  const rect = (g, box, c, pad = 0) => {
    const [x0, y0, x1, y1] = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad];
    const geo = new THREE.BufferGeometry().setFromPoints([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector3(x, top + LIFT.marks, -y)));
    const m = fx(new THREE.LineLoop(geo, lineMat(c))); g.add(m); return m;
  };
  const circle = (g, at, r, c) => {
    const pts = Array.from({ length: 33 }, (_, i) => { const a = i / 32 * Math.PI * 2; return new THREE.Vector3(at[0] + r * Math.cos(a), top + LIFT.marks, -(at[1] + r * Math.sin(a))); });
    const m = fx(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(c))); g.add(m); return m;
  };

  // ---- 每次參數或情境重建後設定一次：路徑、候選、真值、複檢點
  let ctx = null;
  function setup(c) {
    ctx = c;
    const pts = c.list.map(k => new THREE.Vector3(plan.positions[k].x, top + LIFT.path, -plan.positions[k].y));
    pathGeo.setFromPoints(pts); donePathGeo.setFromPoints(pts); donePathGeo.setDrawRange(0, 0);
    for (const g of Object.values(marks)) g.clear();
    c.candidates.forEach(cd => { cd.mark = rect(marks.B, cd.box, 0xff4a3a, 0.15); cd.ring = circle(marks.B, cd.at, 3.2, 0xff4a3a); });   // 外框＋3.2 mm 圈（示意放大）
    for (const d of c.scenario.defects) {
      if (d.kind === 'line') { const g = new THREE.BufferGeometry().setFromPoints([d.a, d.b].map(([x, y]) => new THREE.Vector3(x, top + LIFT.marks + .05, -y))); marks.A.add(fx(new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xff4dff, dashSize: 1.2, gapSize: .8 }))).computeLineDistances()); }
      else circle(marks.A, d.at, d.kind === 'particle' ? 2.4 : d.r ?? 3, 0xff4dff);
    }
    c.review.forEach(it => { it.markC = circle(marks.C, it.at, 4.2, 0xffe14d); });
    const rp = c.review.length ? [c.list.length ? plan.positions[c.list.at(-1)] : { x: 0, y: 0 }, ...c.review.map(it => ({ x: it.at[0], y: it.at[1] }))] : [];
    reviewGeo.setFromPoints(rp.map(q => new THREE.Vector3(q.x, top + LIFT.path + .02, -q.y))); reviewPath.computeLineDistances();
  }

  // ---- 依時間 T 更新（只讀 ctx 與 T；倒退時未發生的結果一律清掉）
  const state = new Array(n).fill('pending');
  function update(T, s, view = {}) {
    if (!ctx) return;
    const { list, posTime, per, candidates, review, revTime, inList } = ctx;
    let doneCount = 0;
    for (let k = 0; k < n; k++) {
      let st = 'pending';
      if (!inList.has(k)) st = 'skipped';
      else {
        const t = posTime.get(k);
        if (t && T >= t.done) { doneCount++; st = T >= t.result ? (per[k].status === 'ok' ? 'done' : per[k].status) : 'done'; }
        else if (s.pos === k) st = 'current';
      }
      if (state[k] !== st) { state[k] = st; cells.setColorAt(k, col.set(CELL_COLORS[st])); if (cells.instanceColor) cells.instanceColor.needsUpdate = true; }
    }
    donePathGeo.setDrawRange(0, Math.min(list.length, doneCount + (s.pos >= 0 && s.phase === '掃描取像' ? 1 : 0)));
    // 方向箭頭：掃描中指向下一個位置
    const idx = list.indexOf(s.pos), next = idx >= 0 ? list[idx + 1] : undefined;
    arrow.visible = s.phase === '掃描取像' && next !== undefined && view.path !== false;
    if (arrow.visible) {
      const a = plan.positions[s.pos], b = plan.positions[next], dir = new THREE.Vector3(b.x - a.x, 0, -(b.y - a.y)), L = dir.length();
      arrow.position.set(a.x, top + LIFT.marks + .1, -a.y); arrow.setDirection(dir.normalize()); arrow.setLength(Math.max(4, L * .9), 3.5, 2.6);
    }
    path.visible = donePath.visible = view.path !== false;
    // 候選（B）：處理完成後才出現；外框依已處理的部分
    for (const c of candidates) { const vis = c.parts.some(x => T >= posTime.get(x.k)?.result); c.mark.visible = c.ring.visible = vis && view.B !== false; }
    review.forEach((it, i) => { it.markC.visible = !!revTime[i] && T >= revTime[i].done && view.C !== false; });
    reviewPath.visible = review.length > 0 && (s.phase === '複檢' || s.phase === '結果輸出' || T >= ctx.reviewStart) && view.path !== false;
    marks.A.visible = !!view.A;
  }
  function setSelected(at) { select.visible = !!at; if (at) select.position.set(at[0], top + LIFT.marks + .1, -at[1]); }

  return { group, disc, cells, state, path, donePath, arrow, reviewPath, marks, setup, update, setSelected, top };
}
