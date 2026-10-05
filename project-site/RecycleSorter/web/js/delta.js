// 並聯（Delta）手臂的示意模型：ABB IRB 360 FlexPicker 型，吊掛安裝、三支主動臂＋平行連桿＋中央伸縮軸，
// 工具是波紋吸嘴＋真空產生器（壓縮空氣式；現場原本是吸塵器式真空源與大口徑軟管，2026-10-05 拍板改掉）。
// 尺寸為現場照片目測的示意值，不是原廠 CAD。
// core 還沒有並聯手臂模型，先放在本站；已登記到 core/REQUESTS.md，之後搬進 core/models/robots/。
//
// 座標：root 原點在三個肩關節所在的水平面中心，+Y 向上；動平台中心 p = [x, y, z]（y 為負，在肩部下方）。
// 姿態只由 p 決定（逆解是閉式解），所以倒序、跳播結果相同。
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';

export const IRB360 = { rb: 200, la: 520, lf: 1240, rp: 45, gap: 50 };
const D2R = Math.PI / 180;
// 主動臂方位：一支朝 +Z，另外兩支朝 −Z 兩側 ±60°，中間留給軟管
const AZ = [90, 210, 330].map(d => d * D2R);

/** 逆解：回傳三支主動臂相對水平面的下擺角（rad，向下為正）；到不了回傳 null */
export function deltaIK([x, y, z], G = IRB360) {
  const out = [];
  for (const a of AZ) {
    const rho = x * Math.cos(a) + z * Math.sin(a) + G.rp - G.rb, t = -x * Math.sin(a) + z * Math.cos(a), h = -y;
    const K = (G.la * G.la + rho * rho + h * h + t * t - G.lf * G.lf) / (2 * G.la), R = Math.hypot(rho, h);
    if (Math.abs(K) > R) return null;
    out.push(Math.atan2(h, rho) - Math.acos(K / R));
  }
  return out;
}

const WHITE = std(0xe9ecee, .42, .05), CARBON = std(0x17191c, .38, .25), JOINT = std(0x8d959c, .35, .7);
const BELLOWS = std(0x1c1e21, .75, 0), RING = std(0xb4322c, .5, .1), HOSE = std(0x3f8fd8, .5, .05), EJECTOR = std(0x2d6fb5, .45, .3);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * 建立手臂。toolLen：動平台中心到吸嘴口的距離；hose：氣管固定端（root 座標）。
 * 回傳 { root, platform, set(p) → 是否可達, joints, tipOf(p) }
 */
export function createDelta({ geometry: G = IRB360, toolLen = 330, hose = [0, 260, -780] } = {}) {
  const root = new THREE.Group(); root.name = 'delta';
  // ---------------------------------------------------------------- 本體（固定）
  cylinder(root, 250, 240, [0, 140, 0], WHITE, 'y', 40);                           // 上殼
  cylinder(root, 253, 18, [0, 34, 0], CARBON, 'y', 40);                            // 分模線
  cylinder(root, 170, 150, [0, -55, 0], WHITE, 'y', 40, 238);                      // 下殼（收斂）
  cylinder(root, 60, 40, [0, -150, 0], WHITE, 'y', 24);                            // 中央軸承座

  // ---------------------------------------------------------------- 主動臂與平行連桿
  // 主動臂直接掛在 root（旋轉順序 YZX：先下擺、再轉到方位），全場檢查才會把它視為裝在本體上的關節
  const arms = AZ.map((a, i) => {
    const seat = block(root, [150, 150, 170], [(G.rb - 10) * Math.cos(a), 0, (G.rb - 10) * Math.sin(a)], WHITE); seat.rotation.y = -a;   // 減速機座
    const upper = new THREE.Group(); upper.name = `delta arm ${i + 1}`; upper.position.set(G.rb * Math.cos(a), 0, G.rb * Math.sin(a));
    upper.rotation.set(0, -a, 0, 'YZX'); root.add(upper);
    cylinder(upper, 44, 190, [0, 0, 0], CARBON, 'z', 24);                          // 肩部軸套
    cylinder(upper, 27, G.la - 30, [G.la / 2 + 15, 0, 0], CARBON, 'x', 20);        // 主動臂（碳纖管）
    cylinder(upper, 13, 2 * G.gap + 36, [G.la, 0, 0], JOINT, 'z', 14);             // 肘部橫桿
    const rods = [-1, 1].map(s => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(13, 14, 10), JOINT); ball.position.set(G.la, 0, s * G.gap); upper.add(ball);
      const rod = cylinder(upper, 7, G.lf - 34, [0, 0, 0], CARBON, 'y', 10); rod.name = 'delta rod';
      return { rod, s };
    });
    return { a, upper, rods };
  });

  // ---------------------------------------------------------------- 動平台＋吸嘴工具
  const platform = new THREE.Group(); platform.name = 'delta platform'; root.add(platform);
  cylinder(platform, 62, 18, [0, 0, 0], JOINT, 'y', 24);
  for (const a of AZ) {
    const bar = cylinder(platform, 9, 2 * G.gap - 30, [G.rp * Math.cos(a), 0, G.rp * Math.sin(a)], JOINT, 'y', 12);
    bar.quaternion.setFromUnitVectors(Y, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
    for (const s of [-1, 1]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(12, 14, 10), JOINT); ball.name = 'delta ball';
      ball.position.set(G.rp * Math.cos(a) - s * G.gap * Math.sin(a), 0, G.rp * Math.sin(a) + s * G.gap * Math.cos(a)); platform.add(ball);
    }
  }
  const tool = new THREE.Group(); tool.name = 'suction nozzle'; platform.add(tool);
  cylinder(tool, 30, 46, [0, -32, 0], JOINT, 'y', 20);                             // 轉接座
  cylinder(tool, 34, 170, [0, -140, 0], CARBON, 'y', 22);                          // 吸嘴筒（現場為長孔鏤空筒）
  cylinder(tool, 37, 14, [0, -232, 0], RING, 'y', 22);                             // 快拆環
  for (let k = 0; k < 4; k++) cylinder(tool, 39 - (k % 2) * 6, 21, [0, -249.5 - k * 21, 0], BELLOWS, 'y', 22).name = 'suction cup';   // 波紋吸口
  cylinder(tool, 40, toolLen - 323, [0, -(323 + toolLen) / 2, 0], BELLOWS, 'y', 22).name = 'suction cup';
  // 真空產生器：裝在吸嘴筒側面（−Z），上面是消音器；氣管接在它的快速接頭上
  block(tool, [46, 96, 34], [0, -140, -52], EJECTOR).name = 'vacuum ejector';
  cylinder(tool, 11, 44, [0, -70, -52], BELLOWS, 'y', 14);                           // 消音器
  cylinder(tool, 7, 22, [0, -150, -80], JOINT, 'z', 10).name = 'hose port';         // 快速接頭（朝 −Z）

  // ---------------------------------------------------------------- 中央伸縮軸（第四軸，外管在本體、內桿在動平台）
  const outer = new THREE.Group(); outer.name = 'delta telescope outer'; outer.position.set(0, -150, 0); root.add(outer);
  cylinder(outer, 14, 620, [0, -350, 0], JOINT, 'y', 14);
  const inner = new THREE.Group(); inner.name = 'delta telescope inner'; inner.position.set(0, 30, 0); platform.add(inner);
  cylinder(inner, 8, 680, [0, 360, 0], MAT.chrome, 'y', 12);
  inner.userData.nested = outer;

  // ---------------------------------------------------------------- 氣管（往真空產生器的壓縮空氣）：兩端固定、形狀由端點內插（示意，不是柔性體模擬）
  // 幾何每次重建，所以把網格位置設在工具端——全場檢查才會把它當成會動的零件逐格檢查。
  const hoseMesh = new THREE.Mesh(new THREE.BufferGeometry(), HOSE); hoseMesh.name = 'air tube'; hoseMesh.castShadow = true; root.add(hoseMesh);
  const B = new THREE.Vector3(...hose);
  let hoseKey = '';
  function setHose(p) {
    const key = p.map(v => v.toFixed(2)).join(); if (key === hoseKey) return; hoseKey = key;
    const A = new THREE.Vector3(p[0], p[1] - 150, p[2] - 93), o = A.clone();
    const mid = new THREE.Vector3(A.x * .45, (A.y + B.y) / 2 - 40, Math.max(-835, Math.min(A.z - 210, (A.z + B.z) / 2 - 150)));
    const pts = [A, new THREE.Vector3(A.x, A.y - 25, A.z - 150), mid, new THREE.Vector3(B.x, B.y - 260, B.z - 20), B].map(v => v.clone().sub(o));
    hoseMesh.geometry.dispose();
    hoseMesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 28, 8, 8, false);
    hoseMesh.position.copy(o);
  }

  const v = new THREE.Vector3(), q = { ok: true, theta: [0, 0, 0], p: [0, -1010, 0] };
  /** 把動平台放到 p；到不了時保持上一個姿態並回傳 false */
  function set(p) {
    const th = deltaIK(p, G); if (!th) return false;
    platform.position.set(...p);
    arms.forEach(({ a, upper, rods }, i) => {
      const t = th[i], c = Math.cos(t), s = Math.sin(t);
      upper.rotation.z = -t;                                                       // 向下為正
      // 肘部到動平台關節的向量，換到主動臂的本地座標
      const rho = p[0] * Math.cos(a) + p[2] * Math.sin(a) + G.rp - G.rb, tt = -p[0] * Math.sin(a) + p[2] * Math.cos(a);
      const dx = rho - G.la * c, dy = p[1] + G.la * s;
      v.set(dx * c - dy * s, dx * s + dy * c, tt);
      for (const { rod, s: side } of rods) {
        rod.position.set(G.la + v.x / 2, v.y / 2, side * G.gap + v.z / 2);
        rod.quaternion.setFromUnitVectors(Y, v.clone().normalize());
      }
    });
    const d = v.set(p[0], p[1] + 30 + 150, p[2]).normalize();
    outer.quaternion.setFromUnitVectors(Y, d.clone().negate());
    inner.quaternion.setFromUnitVectors(Y, d.negate());
    setHose(p);
    q.theta = th; q.p = p; return true;
  }
  set(q.p);
  return { root, platform, tool, arms, hose: hoseMesh, set, state: q, toolLen, tipOf: p => [p[0], p[1] - toolLen, p[2]] };
}
