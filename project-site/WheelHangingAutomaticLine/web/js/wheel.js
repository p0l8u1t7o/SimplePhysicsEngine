// 鋁合金輪框（參數化，WHEELS 的款式）：輪圈（旋轉體）＋輪轂（中心孔、螺栓孔）＋輪輻。
// 局部座標：原點在輪框中心，+Z＝正面（裝飾面）法線，輪圈沿 Z 從 −w/2 到 +w/2。
// 正面輪緣與輪輻正面是切削亮面（金屬度 1、粗糙度低 → 方向性強反光），輪輻側面與內筒是銀色烤漆。
import * as THREE from 'three';
import { std } from '@core/geom/materials.js';

const PAINT = std(0x9ba3ab, .42, .55, { side: THREE.DoubleSide });
const HOLE = std(0x101418, .9, 0);
const cutCache = new Map();
const machined = color => { if (!cutCache.has(color)) cutCache.set(color, std(color, .14, 1, { side: THREE.DoubleSide })); return cutCache.get(color); };

// 旋轉體：profile 是 [r, z]（z 沿輪框軸）；LatheGeometry 繞 Y，轉成繞 Z
function lathe(parent, pts, material, name, segments = 64) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), segments), material);
  m.rotation.x = Math.PI / 2; m.name = name; m.castShadow = m.receiveShadow = true; parent.add(m); return m;
}

export function createWheel(spec, name = 'wheel', { detail = true } = {}) {
  const g = new THREE.Group(); g.name = name; g.userData.spec = spec;
  const R = spec.od / 2, h = spec.w / 2, cut = machined(spec.color);
  const P = pts => pts;                                   // LatheGeometry 的軸向 y 經 rotation.x = +90° 正好對到 +Z
  // 輪圈：外輪廓（後輪緣 → 胎座 → 落槽 → 前輪緣），再沿內筒回到起點
  lathe(g, P([
    [R - 16, -h], [R, -h + 5], [R, -h + 14], [R - 22, -h + 22], [R - 24, -h + 48], [R - 52, -h + 70], [R - 52, h - 82],
    [R - 24, h - 50], [R - 22, h - 24], [R - 6, h - 16], [R - 40, h - 26], [R - 62, h - 62], [R - 66, -h + 34], [R - 34, -h + 8], [R - 16, -h],
  ]), PAINT, 'wheel barrel', detail ? 72 : 40);
  // 前輪緣（切削亮面，獨立網格：反光示意與光學檢討用）
  lathe(g, P([[R - 6, h - 16], [R, h - 12], [R, h - 4], [R - 12, h], [R - 26, h - 6], [R - 40, h - 26], [R - 6, h - 16]]), cut, 'wheel front lip', detail ? 72 : 40);
  // 輪轂：中心孔 bore、安裝面 hub ± 20；正面是切削面
  const r0 = spec.bore / 2, rH = Math.max(100, spec.pcd / 2 + 32), zH = spec.hub;
  lathe(g, P([[r0, zH - 22], [rH, zH - 22], [rH + 10, zH + 4], [rH, zH + 20], [r0 + 8, zH + 20], [r0, zH + 14], [r0, zH - 22]]), cut, 'wheel hub', 48);
  // 螺栓孔（黑色凹孔示意，略凸出安裝面避免重合面）
  if (detail) for (let i = 0; i < spec.lugs; i++) {
    const a = Math.PI / 2 + i * 2 * Math.PI / spec.lugs, hole = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2, 16), HOLE);
    hole.rotation.x = Math.PI / 2; hole.position.set(Math.cos(a) * spec.pcd / 2, Math.sin(a) * spec.pcd / 2, zH + 20.6); hole.name = 'lug hole'; g.add(hole);
  }
  // 輪輻：輪轂外緣（安裝面高度）斜向延伸到前輪緣內側；正面切削、側面烤漆
  const rIn = rH + 4, rOut = R - 46, zIn = zH + 6, zOut = h - 30, L = Math.hypot(rOut - rIn, zOut - zIn), tilt = Math.atan2(zOut - zIn, rOut - rIn);
  const wide = spec.spokes <= 6 ? 62 : 34;
  for (let i = 0; i < spec.spokes; i++) {
    const a = Math.PI / 2 + i * 2 * Math.PI / spec.spokes;
    const arm = new THREE.Group(); arm.rotation.z = a; g.add(arm);
    const tilted = new THREE.Group(); tilted.position.set(rIn, 0, zIn); tilted.rotation.y = -tilt; arm.add(tilted);
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, wide, 24), PAINT); body.position.set(L / 2, 0, -3); body.name = 'wheel spoke'; tilted.add(body);
    const face = new THREE.Mesh(new THREE.BoxGeometry(L - 6, wide - 8, 4), cut); face.position.set(L / 2, 0, 10); face.name = 'wheel spoke face'; tilted.add(face);
    for (const m of [body, face]) m.castShadow = m.receiveShadow = true;
  }
  return g;
}
