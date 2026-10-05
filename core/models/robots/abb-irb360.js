// ABB IRB 360 FlexPicker 型並聯（Delta）手臂本體：吊掛安裝的上下殼、三支主動臂＋平行連桿、動平台、中央伸縮軸（第四軸）。
// 原用於 RecycleSorter（既有分選站的示意模型）。工具（吸嘴、真空產生器）與手臂外的氣管留在各專案：
// 工具裝在 arm.platform 底下（動平台本地 −y 朝下），氣管等跟著姿態變形的零件由專案在 set(p) 之後自己更新。
// 座標：root 原點在三個肩關節所在的水平面中心，+Y 向上；動平台中心 p = [x, y, z]（y 為負，在肩部下方）。單位 mm。
// 姿態只由 p 決定（逆解是閉式解），所以倒序、跳播結果相同。
// 連桿尺寸是現場照片目測的示意值（接近動作範圍 1600 mm 的機型），不是原廠 CAD；選型或做可達範圍判斷前要用 ABB 型錄核對。
import * as THREE from 'three';
import { block, cylinder } from '../../geom/shapes.js';
import { MAT, std } from '../../geom/materials.js';

const D2R = Math.PI / 180;

/** 幾何常數：rb 肩關節所在圓半徑、la 主動臂長、lf 平行連桿長、rp 動平台關節所在圓半徑、gap 平行連桿半間距 */
export const IRB360 = { rb: 200, la: 520, lf: 1240, rp: 45, gap: 50 };
/** 主動臂方位（rad）：一支朝 +Z，另外兩支朝 −Z 兩側 ±60°，中間留給軟管 */
export const AZIMUTH = [90, 210, 330].map(d => d * D2R);

/** 逆解：回傳三支主動臂相對水平面的下擺角（rad，向下為正）；到不了回傳 null */
export function deltaIK([x, y, z], G = IRB360) {
  const out = [];
  for (const a of AZIMUTH) {
    const rho = x * Math.cos(a) + z * Math.sin(a) + G.rp - G.rb, t = -x * Math.sin(a) + z * Math.cos(a), h = -y;
    const K = (G.la * G.la + rho * rho + h * h + t * t - G.lf * G.lf) / (2 * G.la), R = Math.hypot(rho, h);
    if (Math.abs(K) > R) return null;
    out.push(Math.atan2(h, rho) - Math.acos(K / R));
  }
  return out;
}

/** 本體材質；工具可共用（例如轉接座用 joint、吸嘴筒用 carbon），外觀才會一致 */
export const IRB360_MAT = {
  white: std(0xe9ecee, .42, .05),
  carbon: std(0x17191c, .38, .25),
  joint: std(0x8d959c, .35, .7),
};
const Y = new THREE.Vector3(0, 1, 0);

/**
 * 建立手臂本體。geometry：幾何常數（預設 IRB360）；name：root 名稱。
 * 回傳：
 *   root      本體（放到吊掛安裝點；原點在肩關節平面中心）
 *   platform  動平台群組（工具裝在這裡，本地 −y 朝下）
 *   arms      [{ a（方位）, upper（主動臂群組）, rods: [{ rod, s }] }]
 *   outer、inner  中央伸縮軸的外管（在本體）與內桿（在動平台）；inner.userData.nested = outer
 *   set(p)    把動平台放到 p = [x, y, z]（也接受 { x, y, z }）；到不了時保持上一個姿態並回傳 false
 *   state     { theta: 三支主動臂的下擺角, p }
 */
export function createIRB360({ geometry: G = IRB360, name = 'irb360' } = {}) {
  const { white: WHITE, carbon: CARBON, joint: JOINT } = IRB360_MAT;
  const root = new THREE.Group(); root.name = name; root.userData.coreModel = 'abb-irb360';
  // ---------------------------------------------------------------- 本體（固定）
  cylinder(root, 250, 240, [0, 140, 0], WHITE, 'y', 40);                           // 上殼
  cylinder(root, 253, 18, [0, 34, 0], CARBON, 'y', 40);                            // 分模線
  cylinder(root, 170, 150, [0, -55, 0], WHITE, 'y', 40, 238);                      // 下殼（收斂）
  cylinder(root, 60, 40, [0, -150, 0], WHITE, 'y', 24);                            // 中央軸承座

  // ---------------------------------------------------------------- 主動臂與平行連桿
  // 主動臂直接掛在 root（旋轉順序 YZX：先下擺、再轉到方位），全場檢查才會把它視為裝在本體上的關節
  const arms = AZIMUTH.map((a, i) => {
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

  // ---------------------------------------------------------------- 動平台
  const platform = new THREE.Group(); platform.name = 'delta platform'; root.add(platform);
  cylinder(platform, 62, 18, [0, 0, 0], JOINT, 'y', 24);
  for (const a of AZIMUTH) {
    const bar = cylinder(platform, 9, 2 * G.gap - 30, [G.rp * Math.cos(a), 0, G.rp * Math.sin(a)], JOINT, 'y', 12);
    bar.quaternion.setFromUnitVectors(Y, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
    for (const s of [-1, 1]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(12, 14, 10), JOINT); ball.name = 'delta ball';
      ball.position.set(G.rp * Math.cos(a) - s * G.gap * Math.sin(a), 0, G.rp * Math.sin(a) + s * G.gap * Math.cos(a)); platform.add(ball);
    }
  }

  // ---------------------------------------------------------------- 中央伸縮軸（第四軸，外管在本體、內桿在動平台）
  const outer = new THREE.Group(); outer.name = 'delta telescope outer'; outer.position.set(0, -150, 0); root.add(outer);
  cylinder(outer, 14, 620, [0, -350, 0], JOINT, 'y', 14);
  const inner = new THREE.Group(); inner.name = 'delta telescope inner'; inner.position.set(0, 30, 0); platform.add(inner);
  cylinder(inner, 8, 680, [0, 360, 0], MAT.chrome, 'y', 12);
  inner.userData.nested = outer;

  const v = new THREE.Vector3(), q = { ok: true, theta: [0, 0, 0], p: [0, -1010, 0] };
  /** 把動平台放到 p；到不了時保持上一個姿態並回傳 false */
  function set(p) {
    if (!Array.isArray(p)) p = [p?.x ?? 0, p?.y ?? -1010, p?.z ?? 0];
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
    q.theta = th; q.p = p; return true;
  }
  set(q.p);
  return { root, platform, arms, outer, inner, set, state: q, geometry: G };
}

// ---------------------------------------------------------------- 模型目錄
// 目錄的範圍取三軸可以各自拉到底都到得了、連桿也不碰本體的方塊；實際工作範圍（圓柱＋下方圓錐）比這個大。
export const meta = {
  id: 'abb-irb360', name: 'ABB IRB 360 並聯手臂（FlexPicker 型，示意）', category: '機械手臂', source: 'RecycleSorter',
  params: {},
  states: {
    x: { value: 0, min: -350, max: 350, unit: 'mm', label: '動平台 X' },
    y: { value: -1010, min: -1200, max: -900, unit: 'mm', label: '動平台 Y（肩關節平面往下為負）' },
    z: { value: 0, min: -350, max: 350, unit: 'mm', label: '動平台 Z' },
  },
  usage: "import { createIRB360, deltaIK, IRB360, IRB360_MAT } from '@core/models/robots/abb-irb360.js';\nconst arm = createIRB360(); arm.root.position.set(x, 肩關節高度, z); scene.add(arm.root);\narm.platform.add(myTool);                 // 工具往動平台本地 −y 裝\nif (!arm.set([px, py, pz])) { /* 到不了：保持上一個姿態 */ }   // p 是動平台中心（root 座標）\nconst theta = deltaIK([px, py, pz]);      // 三支主動臂的下擺角（rad）或 null",
};

export function create(p = {}) {
  const arm = createIRB360(p);
  return { root: arm.root, platform: arm.platform, set({ x = 0, y = -1010, z = 0 } = {}) { return arm.set([x, y, z]); } };
}
