// 從 3D 工具模型估算手臂負載（core 1.20.1）：質量、質心（法蘭座標）、逐件明細。給 core/verify/dynamics.mjs 的 payload 用。
//
//   const p = estimatePayload(arm.tool)                       // 法蘭座標＝arm.tool 的局部座標（+Z 是工具軸，和 payload.com 的慣例相同）
//   verify.dynamics.arms[0].payload = { mass: p.mass, com: p.com }   // p.parts、p.skipped 是明細（檢查報告可以列出來）
//
// 規則（都是估計；有實際重量時在模型上標 userData.mass 最準）：
//   - 只算看得見的實體網格：隱藏的（不同情境的工具）、透明的、userData.fx／nonSolid 的不算。
//   - userData.mass（kg）：標在網格或群組上，整組用這個質量、質心取那一組的體積質心（沒有體積時取原點），子件不再另外算。
//   - 密度：userData.density（kg/m³，可標在祖先群組）；沒標時金屬材質（metalness ≥ 0.5）當鋁 2700、其他當塑膠 1200。
//   - 體積：封閉的網格用有號四面體體積；管子（TubeGeometry，線材與軟管）用 π r² × 路徑長；開口的網格算不出體積，列在 skipped。
//   - fill：實心比例（預設 1；機加件有挖空時可以給 0.6～0.8）。
// 長度單位 mm（場景慣例），質量 kg。
import * as THREE from 'three';

const DEFAULT_DENSITY = m => (m.material?.metalness ?? 0) >= 0.5 ? 2700 : 1200;

function shown(o, stop) { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === stop) break; } return true; }
function inherited(o, key, stop) { for (let p = o; p; p = p.parent) { if (p.userData?.[key] != null) return { value: p.userData[key], owner: p }; if (p === stop) break; } return null; }

// 網格在 frame 座標下的有號體積（mm³）與體積質心；開口的網格回傳 null
function meshVolume(mesh, M) {
  const g = mesh.geometry;
  if (g.type === 'TubeGeometry' && g.parameters?.path) {
    const L = g.parameters.path.getLength(), r = g.parameters.radius;
    // 質心取路徑中點（彎曲的管子會有一點偏差；線材很輕，影響小）
    return { volume: Math.PI * r * r * L * Math.abs(M.determinant()), centroid: g.parameters.path.getPoint(0.5).applyMatrix4(M), method: 'tube' };
  }
  if (g.parameters?.openEnded) return null;
  const pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
  if (!pos || n < 3) return null;
  // 封閉判斷：每條邊（依位置量化）都要剛好被兩個三角形用到
  const key = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`, edges = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3();
  let V = 0;
  for (let t = 0; t < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    const k = [key(i0), key(i1), key(i2)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;                // 退化三角形（圓柱頂點、擠出件的接縫）
    for (const [u, v] of [[k[0], k[1]], [k[1], k[2]], [k[2], k[0]]]) { const e = u < v ? u + '|' + v : v + '|' + u; edges.set(e, (edges.get(e) || 0) + 1); }
    a.fromBufferAttribute(pos, i0).applyMatrix4(M); b.fromBufferAttribute(pos, i1).applyMatrix4(M); c.fromBufferAttribute(pos, i2).applyMatrix4(M);
    const v6 = a.dot(new THREE.Vector3().crossVectors(b, c));                     // 6 × 四面體（原點、a、b、c）的有號體積
    V += v6; cen.addScaledVector(a.clone().add(b).add(c), v6);
  }
  for (const count of edges.values()) if (count !== 2) return null;
  if (Math.abs(V) < 1e-9) return null;
  return { volume: Math.abs(V) / 6, centroid: cen.divideScalar(4 * V), method: 'mesh' };
}

/**
 * @param root 要算的工具子樹（通常就是 arm.tool）
 * @param o { frame = root（法蘭座標的物件）, density（網格 → kg/m³）, fill = 1, exclude（網格 → true 就不算） }
 * @returns {{ mass, com: [x, y, z], parts: { name, mass, volumeCm3, density, method }[], skipped: { name, reason }[], estimate: true }}
 */
export function estimatePayload(root, { frame = root, density = DEFAULT_DENSITY, fill = 1, exclude = () => false } = {}) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert(), parts = [], skipped = [], fixed = new Set();
  let mass = 0; const mc = new THREE.Vector3();
  const add = (name, m, c, extra) => { parts.push({ name, mass: +m.toFixed(4), ...extra }); mass += m; mc.addScaledVector(c, m); };
  root.traverse(o => {
    if (!shown(o, root)) return;
    // 標了 userData.mass 的群組：整組一個質量
    if (o.userData?.mass != null && !fixed.has(o)) {
      for (let p = o.parent; p && p !== root.parent; p = p.parent) if (fixed.has(p)) return;
      fixed.add(o);
      const box = new THREE.Box3().setFromObject(o), c = box.isEmpty() ? new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) : box.getCenter(new THREE.Vector3());
      add(o.name || o.type, +o.userData.mass, c.applyMatrix4(inv), { method: 'userData.mass' });
      return;
    }
    if (!o.isMesh || !o.geometry) return;
    for (let p = o; p && p !== root.parent; p = p.parent) if (fixed.has(p)) return;
    const u = o.userData || {};
    if (u.fx || u.nonSolid || o.material?.transparent || exclude(o)) return;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), v = meshVolume(o, M);
    if (!v) { skipped.push({ name: o.name || o.geometry.type, reason: '開口或不封閉的網格，算不出體積' }); return; }
    const rho = inherited(o, 'density', root)?.value ?? density(o), m = rho * v.volume * 1e-9 * fill;
    add(o.name || o.geometry.type, m, v.centroid, { volumeCm3: +(v.volume / 1000).toFixed(2), density: rho, method: v.method });
  });
  const com = mass > 0 ? mc.divideScalar(mass).toArray().map(x => +x.toFixed(1)) : [0, 0, 0];
  return { mass: +mass.toFixed(3), com, parts, skipped, estimate: true, note: '由 3D 模型體積 × 密度估算（金屬當鋁 2700、其他當塑膠 1200 kg/m³；userData.mass／density 可覆寫）' };
}

// 幾份估計合起來（例如手臂工具座上的快換盤＋這時候夾著的工具）：質量相加、質心依質量加權（各份要在同一個法蘭座標）
export function combinePayloads(...list) {
  const items = list.filter(Boolean), mass = items.reduce((s, p) => s + p.mass, 0);
  const com = mass > 0 ? [0, 1, 2].map(k => +(items.reduce((s, p) => s + p.mass * p.com[k], 0) / mass).toFixed(1)) : [0, 0, 0];
  return { mass: +mass.toFixed(3), com, parts: items.flatMap(p => p.parts), skipped: items.flatMap(p => p.skipped), estimate: true, note: items[0]?.note };
}
