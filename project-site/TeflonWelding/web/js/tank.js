// 1000L 襯 PTFE 桶：SUS 桶身＋碟形封頭（LatheGeometry）、人孔、底部出口、管腳、PTFE 襯裡與三條焊道的分層狀態（焊道清單由 spec.js makeSeams 依排版產生）。
// 尺寸取自 docs/1000L.step（見 spec.js）。frame 是不轉的桶座標（原點在下切線中心、+Y 朝人孔），spin 是會跟著桶轉的部分。
// 剖切：桶身、襯裡與焊道的材質共用一組剖切平面（世界座標），setCut(true) 時切掉朝向觀看者的一半（同切半展示品）。
import * as THREE from 'three';
import { finished } from '@core/geom/materials.js';
import { decal } from '@core/geom/shapes.js';
import { TANK, LINER_R, SEAMS, THZ, headGeometry, headHeight, seamLength } from './spec.js';

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

// 各層截面（mm）：規劃軌跡（虛擬線）、對接間隙 → V 槽 → 焊條凸起 → 削平（刮平）→ 焊帶（檢測後換綠色）
const LAYERS = {
  path: { profile: [[-1.4, 6], [1.4, 6]], color: 0x2ad4ff, emissive: 0x2ad4ff, fx: true },
  gap: { profile: [[-1, .7], [1, .7]], color: 0x2b3238 },
  // 明暗 V 面保留襯裡幾何，槽底與表面錯開，避免把示意開槽當成壁厚改動。
  groove: { profile: [[-5.5, .9], [-1.2, .35], [0, .3], [1.2, .35], [5.5, .9]], color: 0xffffff, shades: [0xd8d4c4, 0x706758, 0x292b2b, 0x9a917c, 0xeee9d9] },
  rod: { profile: [[-4.5, .7], [-3.9, 2.2], [-2.6, 3.3], [0, 3.8], [2.6, 3.3], [3.9, 2.2], [4.5, .7]], color: 0xe4e9e6, roughness: .32 },
  flat: { profile: [[-5.5, .45], [5.5, .45]], color: 0xece8d8, roughness: .24 },
  belt: { profile: [[-15, .7], [-12.5, 1.9], [0, 2.4], [12.5, 1.9], [15, .7]], color: 0xf6f9fb, roughness: .22 },
  ok: { profile: [[-15, .7], [-12.5, 1.9], [-6, 2.3], [6, 2.3], [12.5, 1.9], [15, .7]], color: 0xffffff, roughness: .3, emissive: 0x1d6b40, shades: [0xcee3ae, 0x70b8a2, 0x31bd70, 0x3bd57c, 0x83c3a0, 0xc3dda9] },
};

export function createTank({ circStart = 0, seams: seamList = SEAMS, defect = THZ.defect, craneLugs = false } = {}) {
  const frame = new THREE.Group(); frame.name = 'tank';
  const spin = new THREE.Group(); spin.name = 'tank-spin'; spin.userData.cableHost = false; frame.add(spin);
  const planes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6)];       // 預設不切；setCut 設定
  const clipped = [];
  const mat = (c, r, m, x) => { const M = std(c, r, m, { clippingPlanes: planes, clipShadows: true, ...x }); clipped.push(M); return M; };
  const M = {
    sus: mat(0xc9cfd4, .32, .78), ptfe: mat(0xeeeadd, .43, 0, { vertexColors: true }), flange: mat(0xb9c0c6, .3, .8),
    leg: mat(0xbfc6cc, .35, .75),
  };
  M.sus = finished(M.sus, 'metal', .06); M.sus.clippingPlanes = planes; clipped.push(M.sus);
  const mesh = (g, m, name, parent = spin) => { const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

  const mw = TANK.manway, ol = TANK.outlet, ST = TANK.straight;
  // 桶身（SUS，內 0 → 外 +4）、PTFE 襯裡（−1 → −4，與桶身之間留 1 mm 膠層）
  mesh(shellGeometry(0, TANK.wall, ol.ro, mw.ro), M.sus, 'shell');
  const linerG = shellGeometry(-TANK.glue - TANK.ptfe, -TANK.glue, ol.ri, mw.ri);
  const linerColors = new Float32Array(linerG.attributes.position.count * 3);
  for (let i = 0; i < linerG.attributes.position.count; i++) {
    const y = linerG.attributes.position.getY(i);
    const shade = .85 + .15 * Math.min(1, Math.max(0, Math.min(y + 150, ST + 150 - y) / 280));
    linerColors.fill(shade, i * 3, i * 3 + 3);
  }
  linerG.setAttribute('color', new THREE.BufferAttribute(linerColors, 3));
  mesh(linerG, M.ptfe, 'liner');
  // 人孔頸＋法蘭；襯裡套管翻邊到法蘭面
  const yNeck = ST + headHeight(mw.ro, TANK.wall) - 6, yFl = mw.top - mw.flangeT;
  mesh(ringGeometry([[mw.ri, yNeck], [mw.ro, yNeck], [mw.ro, yFl], [mw.flangeR, yFl], [mw.flangeR, mw.top], [mw.ri, mw.top], [mw.ri, yNeck]].reverse()), M.flange, 'manway');
  const yNeckIn = ST + headHeight(mw.ri, -TANK.glue) - 4;
  mesh(ringGeometry([[mw.ri - TANK.ptfe, yNeckIn], [mw.ri - .6, yNeckIn], [mw.ri - .6, mw.top + .6], [mw.flangeR - 30, mw.top + .6], [mw.flangeR - 30, mw.top + 3.6], [mw.ri - TANK.ptfe, mw.top + 3.6], [mw.ri - TANK.ptfe, yNeckIn]].reverse()), M.ptfe, 'manway-liner');
  // 人孔法蘭螺栓孔位（16 支螺栓頭）
  const boltG = new THREE.CylinderGeometry(11, 11, 10, 6);
  const bolts = new THREE.InstancedMesh(boltG, M.flange, 16), boltPose = new THREE.Object3D();
  bolts.name = 'manway-bolts'; bolts.castShadow = bolts.receiveShadow = true; spin.add(bolts);
  for (let k = 0; k < 16; k++) {
    const a = (k + .5) * Math.PI / 8;
    boltPose.position.set(Math.cos(a) * (mw.flangeR - 26), mw.top + 5.5, Math.sin(a) * (mw.flangeR - 26));
    boltPose.updateMatrix(); bolts.setMatrixAt(k, boltPose.matrix);
    // 保留原本的命名座標標記，指紋仍能驗證每顆螺栓的軌跡。
    const marker = new THREE.Object3D(); marker.name = 'manway-bolt'; marker.position.copy(boltPose.position); spin.add(marker);
  }
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
    const gusset = new THREE.Shape(); gusset.moveTo(0, 0); gusset.lineTo(95, -80); gusset.lineTo(20, -170); gusset.closePath();
    const brace = mesh(new THREE.ExtrudeGeometry(gusset, { depth: 8, bevelEnabled: false }), M.leg, 'leg-gusset');
    brace.position.set(top.x, top.y - 30, top.z); brace.rotation.y = -a;
  }

  // B 案吊耳沿用吊帶端點；A/C 的外側耳座避開人孔與手臂掃掠區。
  for (const side of [-1, 1]) {
    const eye = new THREE.Shape(); eye.absarc(0, 0, 35, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, 17, 0, Math.PI * 2, true); eye.holes.push(hole);
    const lug = mesh(new THREE.ExtrudeGeometry(eye, { depth: 14, bevelEnabled: false, curveSegments: 12 }), M.sus, 'lifting-lug');
    const r = craneLugs ? 420 : 490, y = ST + (craneLugs ? 70 : 80);
    lug.position.set(side * r, y, -7);
    const stem = mesh(new THREE.BoxGeometry(24, 55, 14), M.sus, 'lug-foot');
    stem.position.set(side * (r + 12), y - 40, 0);
  }
  const plate = decal(spin, 150, 65, [0, 230, -TANK.ri - TANK.wall - 1], [0, Math.PI, 0], ['PTFE LINED VESSEL', '1000 L  /  SUS304'], { center: true, color: '#28333b', bg: '#c2c7c7' });
  plate.material.clippingPlanes = planes;

  // 剖切封面只表現切開的層次，並非槽內實體；不隨槽體自轉。
  const cutFaces = new THREE.Group(); cutFaces.name = 'cut-faces'; cutFaces.userData.fx = true; frame.add(cutFaces); cutFaces.visible = false;
  const capMats = [std(0x929b9e, .46, .7), std(0xab8753, .8, 0), std(0xf6f0dc, .55, 0)];
  const localPlane = new THREE.Plane(), invFrame = new THREE.Matrix4();
  let capKey = '';
  function updateCutFaces(plane) {
    localPlane.copy(plane).applyMatrix4(invFrame.copy(frame.matrixWorld).invert());
    const key = [localPlane.normal.x, localPlane.normal.z, localPlane.constant].map(v => v.toFixed(3)).join(',');
    if (key === capKey) return;
    capKey = key;
    for (const m of [...cutFaces.children]) { m.geometry.dispose(); cutFaces.remove(m); }
    const n = localPlane.normal, d = -localPlane.constant;
    const projectPoint = ([r, y], side) => new THREE.Vector2(side * Math.sqrt(Math.max(0, r * r - d * d)), y);
    const bands = [[0, TANK.wall], [-TANK.glue, 0], [-TANK.glue - TANK.ptfe, -TANK.glue]];
    bands.forEach(([a, b], i) => {
      for (const side of [-1, 1]) {
        const points = [...vesselLine(a, ol.ro, mw.ro), ...vesselLine(b, ol.ro, mw.ro).reverse()].map(p => projectPoint(p, side));
        const cap = mesh(new THREE.ShapeGeometry(new THREE.Shape(points)), capMats[i], 'cut-layer-' + i, cutFaces);
        cap.position.set(n.x * d, 0, n.z * d); cap.rotation.y = Math.atan2(n.x, n.z); cap.castShadow = false;
      }
    });
  }

  // ---------------------------------------------------------------- 焊道
  const seams = {};
  const seamMaterials = Object.fromEntries(Object.entries(LAYERS).map(([key, L]) => [key, mat(L.color, L.roughness ?? .5, 0, {
    vertexColors: !!L.shades, ...(key === 'rod' ? { transparent: true, opacity: .9 } : {}),
    ...(L.emissive ? { emissive: L.emissive, emissiveIntensity: L.fx ? .9 : .25 } : {}),
  })]));
  for (const s of seamList) {
    const at = seamPath(s, circStart), N = s.kind === 'circ' ? 360 : 60, layers = {};
    for (const [key, L] of Object.entries(LAYERS)) {
      const geo = stripGeometry(at, N, L.profile);
      if (L.shades) {
        const colors = new Float32Array(geo.attributes.position.count * 3), c = new THREE.Color();
        for (let j = 0; j < geo.attributes.position.count; j++) c.setHex(L.shades[j % L.profile.length]).toArray(colors, j * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      const o = mesh(geo, seamMaterials[key], `seam-${s.id}-${key}`); o.castShadow = false;
      if (L.fx) o.userData.fx = true;                                       // 規劃軌跡是畫面上的虛擬線，不是實體
      layers[key] = o;
    }
    const hotMat = new THREE.MeshBasicMaterial({ color: 0xff9749, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: planes, vertexColors: true });
    const hotGeo = stripGeometry(at, N, [[-12, 3.9], [0, 4.5], [12, 3.9]]);
    const hotColors = new Float32Array(hotGeo.attributes.position.count * 3); hotGeo.setAttribute('color', new THREE.BufferAttribute(hotColors, 3));
    const hot = mesh(hotGeo, hotMat, `hot-zone-${s.id}`); hot.userData.fx = true; hot.castShadow = false;
    seams[s.id] = { seam: s, at, layers, N, hot };
  }
  // 模擬缺陷（兆赫波掃到才顯示）：紅圈＋短線標示疑似氣孔位置
  const ds = seams[defect.seam], dp = ds.at(defect.u);
  const mark = new THREE.Mesh(new THREE.TorusGeometry(22, 2.2, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff3b3b, clippingPlanes: planes }));
  mark.name = 'thz-defect'; mark.userData.fx = true; mark.position.copy(dp.p).addScaledVector(dp.n, 4);
  mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dp.n); mark.visible = false; spin.add(mark);

  // 缺陷處重熔焊帶（視覺疊層）：缺陷前後各 THZ.repairHalf mm，r 0→1 時沿焊道長出來
  const half = THZ.repairHalf / seamLength(ds.seam), pu0 = defect.u - half;
  const patchMat = new THREE.MeshPhysicalMaterial({ color: 0xf6dec0, roughness: .2, metalness: 0, clearcoat: .7, clearcoatRoughness: .16, side: THREE.DoubleSide, clippingPlanes: planes });
  // 重熔後的圓潤邊緣比原 30 mm 焊帶略寬；局部起伏為凝固紋理，非檢測厚度資料。
  const patchGeo = stripGeometry(u => ds.at(pu0 + 2 * half * u), 40, [[-18, 1.2], [-16, 2.9], [-10, 3.6], [0, 4.1], [10, 3.6], [16, 2.9], [18, 1.2]]);
  const pp = patchGeo.attributes.position;
  for (let j = 0; j < pp.count; j++) {
    const u = Math.floor(j / 7) / 40, normal = ds.at(pu0 + 2 * half * u).n;
    const ripple = .12 * Math.sin(u * Math.PI * 18) * Math.sin((j % 7) * Math.PI / 6);
    pp.setXYZ(j, pp.getX(j) + normal.x * ripple, pp.getY(j) + normal.y * ripple, pp.getZ(j) + normal.z * ripple);
  }
  patchGeo.computeVertexNormals();
  const patch = new THREE.Mesh(patchGeo, patchMat);
  patch.name = 'repair-patch'; patch.userData.fx = true; patch.visible = false; spin.add(patch);
  // 判定保留紅／橘／綠圈；焊帶本體由暖色冷卻為乳白，不把綠色判定當成材料顏色。
  function setRepair({ r = 0, c = 0 } = {}, found = false) {
    mark.visible = found;
    mark.material.color.setHex(c >= 1 ? 0x3dd68c : r > 0 ? 0xffb020 : 0xff3b3b);
    const n = Math.round(Math.min(1, r) * 40), per = patch.geometry.userData.per;
    patch.visible = n > 0; patch.geometry.setDrawRange(0, n * per);
    patchMat.color.setHex(r < 1 ? 0xf6dec0 : c > 0 ? 0xf0f3e9 : 0xe9dfcc);
    patchMat.roughness = r < 1 ? .16 : .27;
  }

  // 每道焊道的進度（0～1）：s 定位、g 開槽、r 焊條、f 削平（刮平）、b 焊帶、i 檢測；各層只畫自己負責的區段，避免重疊面
  function setSeam(id, { s: sc = 0, g = 0, r = 0, f = 0, b = 0, i = 0 }, tool = {}) {
    const S = seams[id], N = S.N, seg = u => Math.round(Math.max(0, Math.min(1, u)) * N);
    const show = (key, u0, u1) => { const o = S.layers[key], a = seg(u0), z = Math.max(a, seg(u1)), per = o.geometry.userData.per; o.geometry.setDrawRange(a * per, (z - a) * per); o.visible = z > a; };
    show('path', g, sc); show('gap', g, 1); show('groove', r, g); show('rod', f, r); show('flat', b, f); show('belt', i, b); show('ok', 0, Math.min(i, b));
    const progress = tool.held === 'rod' ? r : tool.held === 'belt' ? b : 0;
    S.hot.visible = !!tool.fx && progress > 0 && progress < 1;
    if (S.hot.visible) {
      const length = S.seam.kind === 'circ' ? Math.PI * 2 * LINER_R : S.seam.y1 - S.seam.y0 - 32;
      const end = seg(progress), start = Math.max(0, end - Math.ceil(65 / length * N)), per = S.hot.geometry.userData.per;
      S.hot.geometry.setDrawRange(start * per, (end - start) * per);
      const colors = S.hot.geometry.attributes.color;
      for (let j = start; j <= end; j++) for (let q = 0; q < 3; q++) {
        const fade = (j - start) / Math.max(1, end - start), edge = q === 1 ? 1 : .3;
        colors.setXYZ(j * 3 + q, .22 + .78 * fade * edge, .14 + .65 * fade * edge, .12 + .36 * fade * edge);
      }
      colors.needsUpdate = true;
    }
  }
  for (const s of seamList) setSeam(s.id, {});

  // 剖切：plan 給世界座標的平面（法向量朝保留側）；off 時平面推到無限遠
  let cutPlane = null;
  function setCut(on, plane = cutPlane) { cutPlane = plane; cutFaces.visible = !!(on && plane); if (on && plane) { planes[0].copy(plane); updateCutFaces(plane); } else planes[0].set(new THREE.Vector3(0, 0, -1), 1e6); }
  // 透視：桶身、襯裡、人孔與管腳半透明（焊道維持不透明），看得到桶內作業但桶仍是完整的
  const shellMats = [M.sus, M.ptfe, M.flange, M.leg];
  const base = new Map(shellMats.map(m => [m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite }]));
  function setGhost(on) {
    for (const m of shellMats) {
      const b0 = base.get(m), op = m === M.ptfe ? .2 : .14;
      m.transparent = on || b0.transparent; m.opacity = on ? op : b0.opacity; m.depthWrite = on ? false : b0.depthWrite; m.needsUpdate = true;
    }
  }

  return { frame, spin, seams, setSeam, setRepair, setCut, setGhost, materials: clipped, legs, defectAt: dp };
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
