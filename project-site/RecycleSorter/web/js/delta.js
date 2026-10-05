// 並聯（Delta）手臂：本體（上下殼、三支主動臂＋平行連桿、動平台、中央伸縮軸）與閉式逆解用 core 的 ABB IRB 360 模型
// （core/models/robots/abb-irb360.js，core 1.10.0 由本站搬過去）；這個檔只剩薄包裝，加上站內的工具與氣管：
// 工具是波紋吸嘴＋真空產生器（壓縮空氣式；現場原本是吸塵器式真空源與大口徑軟管，2026-10-05 拍板改掉），
// 氣管由真空產生器接到網籠頂的固定端，形狀每次依姿態重建。尺寸為現場照片目測的示意值，不是原廠 CAD。
//
// 座標：root 原點在三個肩關節所在的水平面中心，+Y 向上；動平台中心 p = [x, y, z]（y 為負，在肩部下方）。
// 姿態只由 p 決定（逆解是閉式解），所以倒序、跳播結果相同。
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { std } from '@core/geom/materials.js';
import { createIRB360, deltaIK, IRB360, IRB360_MAT } from '@core/models/robots/abb-irb360.js';

export { deltaIK, IRB360 };                                                        // project.js 與 tools/verify.mjs 由這裡取逆解

const { carbon: CARBON, joint: JOINT } = IRB360_MAT;                               // 轉接座、吸嘴筒與本體共用材質
const BELLOWS = std(0x1c1e21, .75, 0), RING = std(0xb4322c, .5, .1), HOSE = std(0x3f8fd8, .5, .05), EJECTOR = std(0x2d6fb5, .45, .3);

/**
 * 建立手臂。toolLen：動平台中心到吸嘴口的距離；hose：氣管固定端（root 座標）。
 * 回傳 { root, platform, tool, arms, hose, set(p) → 是否可達, state, toolLen, tipOf(p) }
 */
export function createDelta({ geometry: G = IRB360, toolLen = 330, hose = [0, 260, -780] } = {}) {
  const body = createIRB360({ geometry: G, name: 'delta' }), { root, platform } = body;

  // ---------------------------------------------------------------- 吸嘴工具（裝在動平台，本地 −y 朝下）
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

  /** 把動平台放到 p = [x, y, z]；到不了時保持上一個姿態（氣管也不動）並回傳 false */
  function set(p) { if (!body.set(p)) return false; setHose(p); return true; }
  set(body.state.p);
  return { root, platform, tool, arms: body.arms, hose: hoseMesh, set, state: body.state, toolLen, tipOf: p => [p[0], p[1] - toolLen, p[2]] };
}
