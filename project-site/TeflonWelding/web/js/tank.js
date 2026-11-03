// 1000L 襯 PTFE 桶：SUS 桶身＋碟形封頭（LatheGeometry）、人孔、底部出口、管腳、PTFE 襯裡與三條焊道的分層狀態。
// 尺寸取自 docs/1000L.step（見 spec.js）。frame 是不轉的桶座標（原點在下切線中心、+Y 朝人孔），spin 是會跟著桶轉的部分。
// 剖切：桶身、襯裡與焊道的材質共用一組剖切平面（世界座標），setCut(true) 時切掉朝向觀看者的一半（同切半展示品）。
import * as THREE from 'three';
import { TANK, LINER_R, SEAMS, headGeometry, headHeight } from './spec.js';

const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide, ...extra });

// 桶身剖面（偏移 o）：從底部開口邊緣沿內面一路到人孔開口邊緣的 [r, y] 點列
function vesselLine(o, rBottom, rTop, n = 14) {
  const h = headGeometry(o), pts = [];
  const crownArc = (rh, sign, ytan, reverse) => {
    const a0 = Math.acos(Math.min(1, rh / h.c)), out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (h.beta - a0) * i / n; out.push([h.c * Math.cos(a), ytan + sign * (h.cy + h.c * Math.sin(a))]); }
    for (let i = 1; i <= n; i++) { const a = h.beta * (1 - i / n); out.push([h.kx + h.k * Math.cos(a), ytan + sign * h.k * Math.sin(a)]); }
    return reverse ? out.reverse() : out;
  };
  pts.push(...crownArc(rBottom, -1, 0, false));                  // 下封頭：開口 → 轉角 → 直筒
  pts.push(...crownArc(rTop, 1, TANK.straight, true));             // 上封頭：直筒 → 轉角 → 人孔開口
  return pts;
}
// 兩個偏移之間的實心殼（封閉剖面繞 Y 軸旋轉）
function shellGeometry(oIn, oOut, rBottom, rTop, segments = 96) {
  const inner = vesselLine(oIn, rBottom, rTop), outer = vesselLine(oOut, rBottom, rTop).reverse();
  const loop = [...inner, ...outer, inner[0]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(loop.reverse(), segments);
}
const ringGeometry = (pts, segments = 72) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments);

// ---------------------------------------------------------------- 焊道條帶：沿焊道取樣，截面 profile = [[橫向 a, 離襯裡高度 h], …]；依段落排列，drawRange 可只顯示一段
function stripGeometry(at, N, profile) {
  const P = profile.length, pos = new Float32Array((N + 1) * P * 3), idx = [];
  for (let i = 0; i <= N; i++) {
    const { p, n, b } = at(i / N);
    profile.forEach(([a, h], k) => { const o = (i * P + k) * 3; pos[o] = p.x + b.x * a + n.x * h; pos[o + 1] = p.y + b.y * a + n.y * h; pos[o + 2] = p.z + b.z * a + n.z * h; });
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < P - 1; k++) { const a = i * P + k, c = a + P; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  g.userData.per = (P - 1) * 6; g.userData.N = N;
  return g;
}
// 焊道路徑（spin 座標）：p 在襯裡表面、n 朝桶軸（離開襯裡）、b 為焊道寬度方向
export function seamPath(s, circStart = 0) {
  if (s.kind === 'circ') return u => {
    const t = circStart + 2 * Math.PI * u, c = Math.cos(t), si = Math.sin(t);
    return { p: new THREE.Vector3(LINER_R * c, s.y, LINER_R * si), n: new THREE.Vector3(-c, 0, -si), b: new THREE.Vector3(0, 1, 0), t: new THREE.Vector3(-si, 0, c) };
  };
  const c = Math.cos(s.theta), si = Math.sin(s.theta), trim = 16;           // 縱縫兩端縮 16 mm，讓環縫焊帶蓋住接頭（不重疊）
  return u => ({ p: new THREE.Vector3(LINER_R * c, s.y0 + trim + (s.y1 - s.y0 - 2 * trim) * u, LINER_R * si), n: new THREE.Vector3(-c, 0, -si), b: new THREE.Vector3(-si, 0, c), t: new THREE.Vector3(0, 1, 0) });
}

// 各層截面（mm）：規劃軌跡（虛擬線）、對接間隙 → V 槽 → 焊條凸起 → 削平 → 焊帶 → 刮平（檢測後換綠色）
const SCRAPED = [[-15, .7], [-14, 1.1], [14, 1.1], [15, .7]];
const LAYERS = {
  path: { profile: [[-1.4, 6], [1.4, 6]], color: 0x2ad4ff, emissive: 0x2ad4ff, fx: true },
  gap: { profile: [[-1, .7], [1, .7]], color: 0x2b3238 },
  groove: { profile: [[-5.5, .7], [-1.2, .7], [0, .7], [1.2, .7], [5.5, .7]], color: 0x6c7880 },
  rod: { profile: [[-4.5, .7], [-3.9, 2.2], [-2.6, 3.3], [0, 3.8], [2.6, 3.3], [3.9, 2.2], [4.5, .7]], color: 0xe4e9e6, roughness: .32 },
  flat: { profile: [[-5.5, .7], [5.5, .7]], color: 0xe2ddca, roughness: .4 },
  belt: { profile: [[-15, .7], [-12.5, 1.9], [0, 2.4], [12.5, 1.9], [15, .7]], color: 0xf6f9fb, roughness: .22 },
  scraped: { profile: SCRAPED, color: 0xeef1ec, roughness: .3 },
  ok: { profile: SCRAPED, color: 0xa9e3c1, roughness: .3, emissive: 0x1d6b40 },
};

export function createTank({ circStart = 0, defect = { seam: 'C2', u: .62 } } = {}) {
  const frame = new THREE.Group(); frame.name = 'tank';
  const spin = new THREE.Group(); spin.name = 'tank-spin'; spin.userData.cableHost = false; frame.add(spin);
  const planes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6)];       // 預設不切；setCut 設定
  const clipped = [];
  const mat = (c, r, m, x) => { const M = std(c, r, m, { clippingPlanes: planes, clipShadows: true, ...x }); clipped.push(M); return M; };
  const M = {
    sus: mat(0xc9cfd4, .32, .78), susIn: mat(0x9aa2a8, .5, .6), ptfe: mat(0xf1f2ef, .55, 0), flange: mat(0xb9c0c6, .3, .8),
    leg: mat(0xbfc6cc, .35, .75),
  };
  const mesh = (g, m, name, parent = spin) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

  const mw = TANK.manway, ol = TANK.outlet, ST = TANK.straight;
  // 桶身（SUS，內 0 → 外 +4）、PTFE 襯裡（−1 → −4，與桶身之間留 1 mm 膠層）
  mesh(shellGeometry(0, TANK.wall, ol.ro, mw.ro), M.sus, 'shell');
  mesh(shellGeometry(-TANK.glue - TANK.ptfe, -TANK.glue, ol.ri, mw.ri), M.ptfe, 'liner');
  // 人孔頸＋法蘭；襯裡套管翻邊到法蘭面
  const yNeck = ST + headHeight(mw.ro, TANK.wall) - 6, yFl = mw.top - mw.flangeT;
  mesh(ringGeometry([[mw.ri, yNeck], [mw.ro, yNeck], [mw.ro, yFl], [mw.flangeR, yFl], [mw.flangeR, mw.top], [mw.ri, mw.top], [mw.ri, yNeck]].reverse()), M.flange, 'manway');
  const yNeckIn = ST + headHeight(mw.ri, -TANK.glue) - 4;
  mesh(ringGeometry([[mw.ri - TANK.ptfe, yNeckIn], [mw.ri - .6, yNeckIn], [mw.ri - .6, mw.top + .6], [mw.flangeR - 30, mw.top + .6], [mw.flangeR - 30, mw.top + 3.6], [mw.ri - TANK.ptfe, mw.top + 3.6], [mw.ri - TANK.ptfe, yNeckIn]].reverse()), M.ptfe, 'manway-liner');
  // 人孔法蘭螺栓孔位（16 支螺栓頭）
  const boltG = new THREE.CylinderGeometry(11, 11, 10, 6);
  for (let k = 0; k < 16; k++) { const a = (k + .5) * Math.PI / 8; const b = mesh(boltG, M.flange, 'manway-bolt'); b.position.set(Math.cos(a) * (mw.flangeR - 26), mw.top + 5.5, Math.sin(a) * (mw.flangeR - 26)); }
  // 底部出口
  const yOut = -headHeight(ol.ro, TANK.wall) + 6, yOf = ol.bottom + ol.flangeT;
  mesh(ringGeometry([[ol.ri, ol.bottom], [ol.flangeR, ol.bottom], [ol.flangeR, yOf], [ol.ro, yOf], [ol.ro, yOut], [ol.ri, yOut], [ol.ri, ol.bottom]].reverse(), 48), M.flange, 'outlet');
  // 管腳（假設：四支外撇），上端焊在下封頭轉角外側，下端底板
  const L = TANK.legs, legs = [];
  for (let k = 0; k < L.n; k++) {
    const a = Math.PI / 4 + k * 2 * Math.PI / L.n, c = Math.cos(a), s = Math.sin(a);
    const top = new THREE.Vector3(L.topR * c, L.topY, L.topR * s), foot = new THREE.Vector3(L.footR * c, L.footY + 12, L.footR * s);
    const len = top.distanceTo(foot), leg = mesh(new THREE.CylinderGeometry(L.r, L.r, len, 24), M.leg, 'leg');
    leg.position.copy(top).add(foot).multiplyScalar(.5); leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize());
    const plate = mesh(new THREE.BoxGeometry(L.plate, 12, L.plate), M.leg, 'leg-plate'); plate.position.set(foot.x, L.footY + 6, foot.z); plate.rotation.y = -a;
    legs.push(leg);
  }

  // ---------------------------------------------------------------- 焊道
  const seams = {};
  for (const s of SEAMS) {
    const at = seamPath(s, circStart), N = s.kind === 'circ' ? 360 : 60, layers = {};
    for (const [key, L] of Object.entries(LAYERS)) {
      const m = mat(L.color, L.roughness ?? .5, 0, L.emissive ? { emissive: L.emissive, emissiveIntensity: L.fx ? .9 : .35 } : {});
      const o = mesh(stripGeometry(at, N, L.profile), m, `seam-${s.id}-${key}`); o.castShadow = false;
      if (L.fx) o.userData.fx = true;                                       // 規劃軌跡是畫面上的虛擬線，不是實體
      layers[key] = o;
    }
    seams[s.id] = { seam: s, at, layers, N };
  }
  // 模擬缺陷（兆赫波掃到才顯示）：紅圈＋短線標示疑似氣孔位置
  const ds = seams[defect.seam], dp = ds.at(defect.u);
  const mark = new THREE.Mesh(new THREE.TorusGeometry(22, 2.2, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff3b3b, clippingPlanes: planes }));
  mark.name = 'thz-defect'; mark.userData.fx = true; mark.position.copy(dp.p).addScaledVector(dp.n, 4);
  mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dp.n); mark.visible = false; spin.add(mark);

  // 每道焊道的進度（0～1）：s 定位、g 開槽、r 焊條、f 削平、b 焊帶、k 刮平、i 檢測；各層只畫自己負責的區段，避免重疊面
  function setSeam(id, { s: sc = 0, g = 0, r = 0, f = 0, b = 0, k = 0, i = 0 }) {
    const S = seams[id], N = S.N, seg = u => Math.round(Math.max(0, Math.min(1, u)) * N);
    const show = (key, u0, u1) => { const o = S.layers[key], a = seg(u0), z = Math.max(a, seg(u1)), per = o.geometry.userData.per; o.geometry.setDrawRange(a * per, (z - a) * per); o.visible = z > a; };
    show('path', g, sc); show('gap', g, 1); show('groove', r, g); show('rod', f, r); show('flat', b, f); show('belt', k, b); show('scraped', i, k); show('ok', 0, Math.min(i, k));
    if (id === defect.seam) mark.visible = i >= defect.u;
  }
  for (const s of SEAMS) setSeam(s.id, {});

  // 剖切：plan 給世界座標的平面（法向量朝保留側）；off 時平面推到無限遠
  let cutPlane = null;
  function setCut(on, plane = cutPlane) { cutPlane = plane; if (on && plane) planes[0].copy(plane); else planes[0].set(new THREE.Vector3(0, 0, -1), 1e6); }
  // 透視：桶身、襯裡、人孔與管腳半透明（焊道維持不透明），看得到桶內作業但桶仍是完整的
  const shellMats = [M.sus, M.ptfe, M.flange, M.leg];
  const base = new Map(shellMats.map(m => [m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite }]));
  function setGhost(on) {
    for (const m of shellMats) {
      const b0 = base.get(m), op = m === M.ptfe ? .2 : .14;
      m.transparent = on || b0.transparent; m.opacity = on ? op : b0.opacity; m.depthWrite = on ? false : b0.depthWrite; m.needsUpdate = true;
    }
  }

  return { frame, spin, seams, setSeam, setCut, setGhost, materials: clipped, legs, defectAt: dp };
}

// 桶座標中某高度 y 的實體壁（給工具與手臂的間隙檢查）：回傳 [內半徑（襯裡表面）, 外半徑]；人孔、出口頸以外的區域回傳 null
export function wallAt(y) {
  const mw = TANK.manway, ST = TANK.straight, o = -TANK.glue - TANK.ptfe;
  if (y >= 0 && y <= ST) return [LINER_R, TANK.ri + TANK.wall];
  if (y > ST) {
    const yNeck = ST + headHeight(mw.ro, TANK.wall);
    if (y > mw.top) return null;
    if (y >= yNeck - 6) return y >= mw.top - mw.flangeT ? [mw.ri - TANK.ptfe, mw.flangeR] : [mw.ri - TANK.ptfe, mw.ro];
    // 封頭：由高度反求半徑（二分）
    const rAt = (o2) => { let lo = 0, hi = TANK.ri + o2; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (ST + headHeight(m, o2) > y) lo = m; else hi = m; } return lo; };
    return [rAt(o), rAt(TANK.wall)];
  }
  // 下封頭：由深度反求半徑；比外側最低點還低就不是桶壁
  const depth = -y, rAt = (o2) => { let lo = 0, hi = TANK.ri + o2; if (headHeight(0, o2) < depth) return null; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (headHeight(m, o2) > depth) lo = m; else hi = m; } return lo; };
  const rin = rAt(o), rout = rAt(TANK.wall);
  if (rout == null) return null;
  return [rin ?? 0, rout];
}
