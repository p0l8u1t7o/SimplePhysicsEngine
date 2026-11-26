// 第二段：電控盤、手臂控制器、氣源與閥島、外露線路與氣管（照 core/examples/segment2）。
// 全部放在下方機櫃裡：電控盤在西側前方（前門拆下可看背板）、RC8A 在東側前方、FRL 與閥島在東側背板。
// 台面上的設備以台面走線孔（machine.js 的 GROMMETS）穿到機櫃，沿台面下方 715 mm 高度走到電控盤頂板接頭。
// 數量、型號都是配置估算（示意），待電控設計確認。
import * as THREE from 'three';
import { component, robotController } from '@core/electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryGland, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, CABLE } from '@core/electrical/cable-routing.js';
import { frl, solenoidValve } from '@core/models/motion.js';
import { block } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { tagPart } from '@core/models/parts.js';
import { LAY, GROMMETS } from './machine.js';
import { REF } from './refs.js';

const drive = (id, title, source = 'QF2') => component({ id, kind: 'drive', title, size: [45, 100, 110], role: 'motion', category: 'ac', source, description: '伺服功率級與回授；軸功率、編碼器與煞車選型待確認（示意）。' });
// 背板元件表（背板中心為 0；頂端 0.3×高 是端子台）
export const SCHEDULE = [
  { y: 40, items: [
    component({ id: 'QS1', kind: 'isolator', title: '總電源隔離開關', size: [36, 75, 65], role: 'power', category: 'ac', description: '檢修時隔離設備電源；額定電流與現場電源待確認。' }),
    component({ id: 'QF1', kind: 'breaker', title: '控制支路保護', size: [36, 75, 65], role: 'power', category: 'ac', source: 'QS1' }),
    component({ id: 'QF2', kind: 'breaker', title: '伺服動力支路保護', size: [36, 75, 65], role: 'power', category: 'ac', source: 'QS1' }),
    component({ id: 'PS1', kind: 'psu', title: '24 VDC 電源', size: [50, 95, 100], role: 'power', category: 'ac', source: 'QF1', description: '供應 PLC、I/O、光源控制、雷射位移計與感測器（示意）。' }),
    component({ id: 'GC1', kind: 'safety', title: '安全控制器', size: [45, 90, 95], role: 'safety', source: 'PS1', description: '前門互鎖、急停；停止伺服與手臂、IPA 供給。' }),
    component({ id: 'PLC1', kind: 'plc', title: '設備 PLC', size: [80, 90, 85], role: 'control', source: 'PS1', description: '站序、手臂與鎖附模組的槽位互鎖、料倉換盤、IPA 與吹乾計時。' }),
    component({ id: 'IO1', kind: 'io', title: '分散式 I/O（台面）', size: [50, 80, 65], role: 'io', category: 'signal', source: 'PLC1', description: '載台到位、止擋、頂升、料倉層位、真空與壓力開關。' }),
    component({ id: 'IO2', kind: 'io', title: '分散式 I/O（閥島）', size: [50, 80, 65], role: 'io', category: 'signal', source: 'PLC1', description: '雙頭切換、漲緊、壓持、吹氣、擦拭墊、吹乾閥。' }),
  ] },
  { y: -80, items: [
    component({ id: 'SW1', kind: 'switch', title: 'PoE 交換器', size: [40, 80, 70], role: 'network', source: 'PS1', description: '20 MP 相機 × 5、3D 線雷射 × 2、PLC、手臂控制器、視覺工控機（示意）。' }),
    component({ id: 'IPC1', kind: 'ipc', title: '視覺工控機', size: [160, 95, 100], role: 'vision', category: 'network', source: 'SW1', description: '2D／3D 判讀、覆拍修正量、影像歸檔與追溯（IMG 編號）。' }),
    component({ id: 'LC1', kind: 'light', title: '頻閃光源控制器', size: [60, 70, 70], role: 'vision', category: 'signal', source: 'IO1', description: '相機觸發同步：同軸、環形、條形光。' }),
    component({ id: 'NR1', kind: 'drive', title: '伺服起子控制器', size: [60, 100, 110], role: 'motion', category: 'ac', source: 'QF2', description: '分段轉速與扭力控制，輸出扭力-角度曲線與轉數（示意）。' }),
    component({ id: 'GW1', kind: 'gateway', title: 'MES／資料閘道', size: [45, 70, 60], role: 'network', category: 'network', source: 'SW1', description: '上傳檢查、高度與鎖附紀錄；介面待確認。' }),
  ] },
  { y: -195, items: [
    drive('D1', 'Tray I 抽屜驅動'), drive('D2', 'Tray S 抽屜驅動'), drive('D3', '料倉 I 升降驅動'), drive('D4', '料倉 S 升降驅動'),
    drive('D5', '鎖附 X 軸驅動'), drive('D6', '起子 Z 軸驅動'), drive('D7', '起子沿槽軸驅動'),
  ] },
];

export function createElectrical(scene, { robot }) {
  const g = new THREE.Group(); g.name = 'electrical'; scene.add(g);
  const T = LAY.table, under = T - 25;                                       // 機櫃內走線高度（台面下方）
  // ---- 電控盤（下方機櫃西側前方）
  const cab = { center: [-380, 382, 655], size: [700, 620, 430] }, [cx, cy, cz] = cab.center, [, h, d] = cab.size, top = cy + h / 2;
  const entries = [-260, -140, -20, 100, 220].map((x, i) => ({ x, z: -175, hole: 14, wire: i === 4 ? 5 : 4 }));
  cabinetShell(g, '電控盤', { center: cab.center, size: cab.size, entries, thickness: 20 });
  const backZ = cz - d / 2 + 3;
  const panel = controlPanel(g, 'CTRL / 背板', { center: [cx, cy, backZ + 42], width: 620, height: 520, backZ, schedule: SCHEDULE });
  const holes = entries.map((e, i) => { const at = [cx + e.x, top, cz + e.z]; entryGland(g, 'CTRL / 頂板接頭 ' + (i + 1), { at, hole: e.hole, wire: e.wire, thickness: 20 }); return { ...e, at }; });
  const feedY = top - 32;                                                    // 櫃內：背板上緣與頂板之間
  const feed = (i, port, color) => {
    const [x, , z] = holes[i].at, p = panel.ports[port];
    panelFeed(g, 'CTRL / 頂板到端子 ' + (i + 1), [[x, top + 40, z], [x, feedY, z], [x, feedY, p[2]], [p[0], feedY, p[2]], p], { radius: holes[i].wire, color });
  };
  // ---- 手臂控制器 RC8A（東側前方，層板＋腳座）
  const rc = robotController(g, { at: [330, 280, 480], id: 'RC1', floor: 72 });
  rc.userData.electrical.free = true;                                          // 放在下方機櫃層板上，不在電控盤內
  // ---- 氣源：FRL（東側背板）→ 閥島（8 連，示意）
  const air = frl.create(); air.root.position.set(420, 560, LAY.z0 + 13 + 25); g.add(air.root); tagPart(air, REF.air);
  block(g, [220, 40, 44], [420, 420, LAY.z0 + 13 + 22], MAT.steelDark);                                     // 閥島底座
  for (let i = 0; i < 8; i++) { const v = solenoidValve.create(); v.root.position.set(420 - 91 + i * 26, 440, LAY.z0 + 13 + 22); g.add(v.root); tagPart(v, REF.air); }

  // ---- 外露線路：台面上 → 走線孔 → 機櫃內（每條線各自一個高度，交叉時不互碰）→ 頂板接頭
  const lvl = [T - 25, T - 36, T - 47, T - 58, T - 80, T - 62];             // 機櫃內走線高度（台面底面 740；電控盤頂板 692）
  const toGland = (i, [x, z], y) => [[x, y, z], [holes[i].at[0], y, z], [holes[i].at[0], y, holes[i].at[2]], [holes[i].at[0], top + 40, holes[i].at[2]]];
  // 1. 鎖附模組：拖鏈固定端 → 橫樑背面線槽 → 西側立柱後方 → 走線孔 → 接頭 1
  const lz = LAY.locker.z, [gx, gz] = GROMMETS.lock, beamTop = LAY.locker.beamY;
  cableTray(g, '鎖附橫樑背面線槽', [-30, beamTop - 10, lz - 52], [gx + 20, beamTop - 10, lz - 52], { width: 40, height: 14 });
  cable(g, '鎖附模組動力／訊號（拖鏈出口）', [[0, beamTop + 20, lz - 80], [-12, beamTop - 8, lz - 56], [gx + 8, beamTop - 8, lz - 56], [gx + 8, T + 10, lz - 56],
    [gx + 8, T + 10, gz], ...toGland(0, [gx + 8, gz], lvl[0])], { radius: 4, color: CABLE.power, clips: 5 });
  feed(0, 0, CABLE.power);
  // 2. Tray I 抽屜與料倉 I：拖鏈固定端 → 走線孔 → 接頭 2
  {
    const [x, z] = GROMMETS.trayI, chainZ = (LAY.tray.pick + LAY.tray.load) / 2 - 160 - 150;
    cable(g, 'Tray I 抽屜（拖鏈出口）', [[LAY.lane.I - 110, T + 16, chainZ], [x + 5, T + 16, chainZ - 8], [x, T + 16, z], ...toGland(1, [x, z], lvl[1])], { radius: 4, color: CABLE.signal, clips: 3 });
    feed(1, 2, CABLE.signal);
  }
  // 3. 上視相機 I → 走線孔 → 接頭 3
  {
    const [x, z] = GROMMETS.camI;
    cable(g, '上視相機 I GigE／觸發', [[LAY.st.camI[0] + 22, 790, LAY.st.camI[1]], [x, 790, z], ...toGland(2, [x, z], lvl[2])], { radius: 4, color: CABLE.signal, clips: 3 });
    feed(2, 4, CABLE.signal);
  }
  // 4. 上視相機 S（東側）→ 走線孔 → 機櫃內往西 → 接頭 4
  {
    const [x, z] = GROMMETS.camS;
    cable(g, '上視相機 S GigE／觸發', [[LAY.st.camS[0] - 22, 790, LAY.st.camS[1]], [x, 790, z], ...toGland(3, [x, z], lvl[3])], { radius: 4, color: CABLE.signal, clips: 4 });
    feed(3, 6, CABLE.signal);
  }
  // 5. 手臂：底座後方出線 → 走線孔 → RC8A；RC8A → 接頭 5（電源＋網路）
  {
    const [x, z] = GROMMETS.robot, rcTop = 280 + 47;
    cable(g, 'SCARA 馬達／編碼器（底座出線）', [[0, LAY.robot.y + 30, LAY.robot.z + 292], [0, T + 30, z], [0, lvl[4], z], [330, lvl[4], z], [330, rcTop + 22, z]], { radius: 6, color: CABLE.power, clips: 4 });
    cable(g, 'RC8A 電源／網路', [[210, rcTop + 3, 520], [210, T - 62, 520], ...toGland(4, [210, 520], T - 62).slice(1)], { radius: 5, color: CABLE.power, clips: 3 });
    feed(4, 8, CABLE.power);
  }
  // 6. 氣管：閥島 → 機櫃內 → 走線孔（頂升定位氣缸；鎖附壓持經拖鏈）（示意，只畫主幹）
  {
    const [x, z] = GROMMETS.conv, vz = LAY.z0 + 13 + 50, aY = T - 90;
    cable(g, '氣管：頂升定位氣缸', [[420 - 91, 460, vz], [420 - 91, aY, vz], [x, aY, vz], [x, aY, z], [x, T + 40, z], [LAY.work + 36, T + 40, z]], { radius: 3, color: CABLE.air, clips: 4 });
    const ax = GROMMETS.lock[0] - 16;
    cable(g, '氣管：鎖附壓持（經拖鏈）', [[420 - 65, 460, vz], [420 - 65, aY - 9, vz], [ax, aY - 9, vz], [ax, aY - 9, GROMMETS.lock[1]], [ax, T + 12, GROMMETS.lock[1]], [ax, T + 12, lz - 56], [ax, beamTop - 8, lz - 56]], { radius: 3, color: CABLE.air, clips: 4 });
  }
  return { group: g, panel, rc };
}
