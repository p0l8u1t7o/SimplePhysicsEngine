// 配置示意；固定線路用共用 cable，腕部鬆弛段依當下關節重建取樣點。
import * as THREE from 'three';
import { component, electricalActivity } from '@core/electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryGland, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, solidMeshes, support, CABLE } from '@core/electrical/cable-routing.js';
import { block, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { CABINET, CONTROLLER, PICK, STEREO, GRIP } from './layout.js';
import { K } from './robot.js';

const device = (id, kind, title, size, role, source = null, category = 'dc', description = '') =>
  component({ id, kind, title, size, role, source, category, description: description || '配置示意，額定與型號依實際選型確認。' });
export const SCHEDULE = [
  { y: 280, items: [device('QS1', 'isolator', '總電源隔離', [60, 90, 80], 'power', null, 'ac'), device('QF1', 'breaker', '支路保護', [50, 90, 75], 'power', 'QS1', 'ac'), device('PS1', 'psu', '24 VDC 電源', [90, 120, 110], 'power', 'QF1', 'ac')] },
  { y: 40, items: [device('PLC1', 'plc', 'PLC／編碼器鎖存', [120, 100, 100], 'control', 'PS1'), device('SAF1', 'safety', '安全繼電器', [80, 100, 90], 'safety', 'PS1', 'safety'), device('LC1', 'light', '300 µs 頻閃控制器', [90, 80, 85], 'vision', 'PLC1', 'signal')] },
  { y: -210, items: [device('IPC1', 'ipc', '視覺 IPC（內含 GPU）', [210, 145, 150], 'vision', 'SW1', 'network', '機箱包絡包含 GPU 與 5GigE 網卡；幾何特徵辨識、手眼轉換及輪型配方。'), device('SW1', 'switch', '5GigE／PoE 交換器', [100, 100, 100], 'network', 'PS1')] },
  { y: -460, items: [device('IO1', 'io', '到位光電／編碼器介面', [130, 85, 80], 'io', 'PLC1', 'signal'), device('DRV1', 'drive', '夾爪伺服驅動', [110, 140, 130], 'motion', 'QF1', 'ac')] },
];

export function createElectrical(scene, { robot, line }) {
  // 櫃內元件由電盤檢查負責；所有原有機構、工件與新增末端實體均保留為配線障礙。
  const obstacles = solidMeshes(scene).filter(m => { for (let p = m; p; p = p.parent) if (p.userData.fx || p.userData.operatorProxy) return false; return true; });
  const root = new THREE.Group(); root.name = 'electrical installation'; scene.add(root);
  const cx = CABINET.x, cz = CABINET.z, top = 1950, backZ = cz - 247;
  const entries = [-280, -170, 170, 280].map(x => ({ x, z: -70, hole: 12, wire: 3 }));
  const shell = cabinetShell(root, 'CTRL', { center: [cx, 1000, cz], size: [800, 1900, 500], entries, thickness: 20 });
  obstacles.push(...shell.solids);
  const panel = controlPanel(root, 'CTRL / 背板', { center: [cx, 1000, backZ + 42], width: 690, height: 1650, backZ, schedule: SCHEDULE });
  block(root, [820, 48, 520], [cx, 24, cz], MAT.steelDark).name = 'vision cabinet plinth';
  plate(panel.group, ['IPC · GPU / 5GigE · PLC'], 430, 50, [0, 690, 4], 0);
  plate(panel.devices.get('IPC1'), ['GPU + 5GigE NIC'], 180, 24, [0, 20, 157], 0);
  const holes = entries.map((e, i) => {
    const at = [cx + e.x, top, cz + e.z], p = panel.ports[i];
    entryGland(root, 'CTRL gland ' + i, { at, ...e, thickness: 20 });
    panelFeed(root, 'CTRL feed ' + i, [[at[0], top + 40, at[2]], [at[0], top - 60, at[2]], [at[0], top - 60, p[2]], [p[0], top - 60, p[2]], p]);
    return [at[0], top + 40, at[2]];
  });
  const routes = [];
  function wire(name, points, { parent = root, color = CABLE.signal, radius = 3, backing = true } = {}) {
    const path = points.map(p => [p[0], p[1] - 10, p[2] + 10]);
    // 護軌在接頭前收尾；端點不得沿偏移方向伸進機殼。
    for (const [i, j] of [[0, 1], [path.length - 1, path.length - 2]]) {
      const a = new THREE.Vector3(...path[i]), b = new THREE.Vector3(...path[j]);
      path[i] = a.lerp(b, Math.min(.4, 28 / a.distanceTo(b))).toArray();
    }
    const g = cable(parent, name, points, { radius, color, clips: points.length, backing: backing ? { path, radius: 4, feet: [] } : null });
    routes.push(g); return g;
  }
  wire('CTRL → RC1 power', [holes[0], [holes[0][0], 2040, 3430], [-1900, 2040, 3430], [-1900, 1103, 3430]], { color: CABLE.power });
  wire('CTRL → RC1 network', [holes[1], [holes[1][0], 2080, 3470], [-1930, 2080, 3470], [-1930, 1103, 3470]]);
  wire('RC1 → robot base', [[-2273, 160, 3550], [-2390, 160, 3550], [-2390, 18, 3550], [-2390, 18, 2800], [-650, 18, 2800], [-650, 18, 0], [-650, 100, 0], [-553, 100, 0]], { color: CABLE.power });
  // 高架主幹沿圍籬西側越過工作區，再從光源樑南側垂降。
  const main = [holes[2], [holes[2][0], 2120, 3190], [-2390, 2120, 3190], [-2390, 3700, 3190], [-2390, 3700, -450]];
  wire('CTRL → optical trunk', main);
  // 高架線路的支承落在西側非工作區，護軌不能只和電線一起懸空。
  for (const z of [3190, -450]) {
    const post = block(root, [40, 3680, 40], [-2490, 1840, z], MAT.steelDark); post.name = 'optical cable post'; obstacles.push(post);
    const foot = block(root, [180, 12, 180], [-2490, 6, z], MAT.steelDark); foot.name = 'optical cable foot'; obstacles.push(foot);
    support(root, 'optical cable bridge bracket', [-2469, 3650, z], [-2390, 3690, z + 10], 4);
  }
  for (const [i, l] of PICK.lights.entries()) {
    wire('LC1 → area light ' + i, [[-2390, 3700, -450], [l.x, 3700, -450], [l.x, 2890, -450], [l.x, 2890, -740], [l.x, 2690, -740], [l.x, 2648, -860]], { color: CABLE.power });
  }
  wire('PLC1 → arrival sensor', [[-2390, 3700, -450], [PICK.sensorX, 3700, -450], [PICK.sensorX, 1560, -450], [PICK.sensorX, 1560, -608], [PICK.sensorX, 1500, -608]]);
  wire('PLC1 → encoder', [[-2390, 3700, -450], [PICK.encoderX, 3700, -450], [PICK.encoderX, 3180, -1170], [PICK.encoderX, 3133, -1170]]);
  // 前臂固定段與末端分支；關節內部穿線以原廠內部通道表示。
  wire('forearm camera loom', [[200, K.foreOff + 160, 100], [600, K.foreOff + 160, 100], [920, K.foreOff + 160, 100]], { parent: robot.arm.j.j3, radius: 5 });
  for (const [i, cam] of robot.cameras.entries()) {
    const x = (i ? 1 : -1) * STEREO.baseline / 2;
    wire('PoE → camera ' + i, [[0, -90, -170], [x, -90, -170], [x, -165, -170], [x, -205, -230]], { parent: robot.tool, radius: 2 });
  }
  wire('DRV1 → gripper servo', [[0, -90, -170], [500, -90, -170], [500, -238, -170], [500, -238, -78]], { parent: robot.tool, color: CABLE.power });
  for (const [i, [x, y]] of GRIP.cups.entries()) wire('VAC1 → cup ' + i,
    [[180, -75, 100], [180, -50, 125], [x + 45, -50, 125], [x + 45, y + 40, 125], [x + 45, y + 40, 148], [x, y + 30, 148]], { parent: robot.tool, color: CABLE.air, radius: 1, backing: false });

  // 鬆弛段在前臂端與工具側的外側通道，取樣點及幾何每次全量覆寫。
  // J4／J5 採機內通道；J6 外露服務圈繞法蘭，避免把跨整個手腕的自由曲線穿過腕殼。
  wire('wrist internal outlet', [[120, 0, -108], [120, 0, -140], [210, 0, -140]], { parent: robot.arm.j.j5, radius: 5, backing: false });
  wire('wrist → tool junction', [[0, -20, -140], [0, -90, -140], [0, -90, -170]], { parent: robot.tool, radius: 5, backing: false });
  const flex = cable(robot.arm.j.j5, 'wrist slack loom', [[0, 0, 0], [0, 1, 0]], { radius: 5, clips: 0, ends: false });
  routes.push(flex);
  const mesh = flex.children[0], radius = 5, segments = 64;
  function updateFlex() {
    scene.updateMatrixWorld(true);
    const points = Array.from({ length: 33 }, (_, i) => {
      const u = i / 32, angle = -Math.PI / 2 + (Math.PI * 2 + robot.q.j6) * u;
      const r = 140;
      return new THREE.Vector3(210 + 25 * u, r * Math.cos(angle), r * Math.sin(angle));
    });
    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, segments, radius, 8, false);
    // 保留網格與 UUID；舊 GPU 幾何釋放，避免跳播累積資源。
    mesh.geometry.dispose(); mesh.geometry = geo;
    flex.userData.cable = { radius, type: 'flexible', length: curve.getLength(), points: Array.from({ length: 129 }, (_, i) => curve.getPoint(i / 128).toArray()) };
  }
  function set(st, step) {
    updateFlex();
    for (const d of panel.devices.values()) if (d.userData.electricalLed)
      d.userData.electricalLed.material.emissiveIntensity = electricalActivity(d.userData.electrical.role, { action: step.action, vision: st.strobe > .5, motion: !!step.robot }) ? 1.1 : .12;
  }
  return { root, shell, panel, routes, flex, obstacles, set };
}
