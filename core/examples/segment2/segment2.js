// 第二段範例（電控、配線、相機）：接在 core/template 的「輸送線＋龍門」場景上。單位 mm；X 往東、Y 往上、Z 往南。
// 新專案把這個檔複製成自己的 web/js/electrical.js，依配置改座標與元件表；用法與檢查見同資料夾的 README.md。
// 內容：電盤櫃（頂板開孔＋穿板接頭）、背板元件表（DIN 軌、端子台、櫃內連線自動產生）、龍門 X 軸拖鏈、
//      外露線路（拖鏈 → 樑後側 → 腳柱 → 櫃頂接頭 → 端子）、立柱上的相機（core/models/camera.js）與相機線。
import * as THREE from 'three';
import { component } from '../../electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryGland, panelFeed } from '../../electrical/electrical-cabinet.js';
import { cable, carrier, CABLE } from '../../electrical/cable-routing.js';
import { create as visionCamera } from '../../models/camera.js';
import { block } from '../../geom/shapes.js';
import { MAT } from '../../geom/materials.js';

// 元件表：每列一條 DIN 軌；y 是背板上的列高（背板中心為 0，頂端 0.3×高 是端子台，不要放元件）。
// 一列的寬度總和（含 14 mm 間隔）要小於背板寬的 83%，超過時 populatePanel 會丟錯。
export const SCHEDULE = [
  { y: 90, items: [
    component({ id: 'QS1', kind: 'isolator', title: '總電源隔離開關', size: [36, 75, 65], role: 'power', category: 'ac', description: '檢修時隔離設備電源' }),
    component({ id: 'QF1', kind: 'breaker', title: '控制支路保護', size: [36, 75, 65], role: 'power', category: 'ac', source: 'QS1' }),
    component({ id: 'PS1', kind: 'psu', title: '24 VDC 電源', size: [50, 95, 100], role: 'power', category: 'ac', source: 'QF1' }),
    component({ id: 'PLC1', kind: 'plc', title: '設備 PLC', size: [80, 90, 85], role: 'control', source: 'PS1', description: '站序、到位互鎖' }),
    component({ id: 'IO1', kind: 'io', title: '分散式 I/O', size: [50, 80, 65], role: 'io', category: 'signal', source: 'PLC1' }),
  ] },
  { y: -150, items: [
    component({ id: 'SW1', kind: 'switch', title: '工業乙太網交換器', size: [40, 80, 70], role: 'network', source: 'PS1' }),
    component({ id: 'IPC1', kind: 'ipc', title: '視覺工業電腦', size: [160, 95, 100], role: 'vision', category: 'network', source: 'SW1', description: '相機取像與判定，與 PLC 交換 Ready／OK／NG' }),
    component({ id: 'D1', kind: 'drive', title: '龍門 X 軸驅動器', size: [45, 100, 110], role: 'motion', category: 'ac', source: 'QF1' }),
    component({ id: 'D2', kind: 'drive', title: '龍門 Z 軸驅動器', size: [45, 100, 110], role: 'motion', category: 'ac', source: 'QF1' }),
  ] },
];

// gantry：core/models/gantry.js 的 create() 回傳值（root 已放進場景）
// cab：電盤櫃 { center, size }（世界座標）；cam：相機 { at: [x, y, z]（鏡頭前緣）, postZ（立柱的 z，立柱與相機同一個 x） }
export function createSegment2(scene, { gantry, cab, cam }) {
  const P = gantry.params, H = P.height, [cx, cy, cz] = cab.center, [, h, d] = cab.size, top = cy + h / 2;
  // ---- 電盤櫃：頂板開孔用櫃內座標 x、z；每個孔一顆穿板接頭，線要從接頭中心垂直穿過
  const entries = [{ x: -150, z: -60, hole: 12, wire: 3 }, { x: -60, z: -60, hole: 10, wire: 2.5 }];
  cabinetShell(scene, '電控櫃', { center: cab.center, size: cab.size, entries, thickness: 20 });
  const backZ = cz - d / 2 + 3;                                              // 櫃背板內面；背板離它 42 mm（固定柱長度）
  const panel = controlPanel(scene, 'CTRL / 背板', { center: [cx, cy, backZ + 42], width: 500, height: 700, backZ, schedule: SCHEDULE });
  const holes = entries.map((e, i) => { const at = [cx + e.x, top, cz + e.z]; entryGland(scene, 'CTRL / 頂板接頭 ' + (i + 1), { at, hole: e.hole, wire: e.wire, thickness: 20 }); return { ...e, at }; });
  // 櫃頂上方 40 mm → 穿過接頭 → 櫃內走到端子
  const feed = (i, port, color) => { const [x, , z] = holes[i].at, p = panel.ports[port];
    panelFeed(scene, 'CTRL / 頂板到端子 ' + (i + 1), [[x, top + 40, z], [x, top - 60, z], [x, top - 60, p[2]], [p[0], top - 60, p[2]], p], { radius: holes[i].wire, color }); };

  // ---- 龍門 X 軸拖鏈：架在橫樑頂面上方（放大包圍盒要讓開樑頂），固定端在跨距中心，活動端跟著台車
  const chain = carrier(gantry.root, 'X 軸拖鏈', { origin: [0, H + 125, -20], axis: [1, 0, 0], rise: [0, 1, 0], fixed: 0, min: -P.span / 2 + 100, max: P.span / 2, radius: 45, width: 32 });
  const gx = gantry.root.position.x, gz = gantry.root.position.z, leg = gx + P.span / 2 + 190;
  cable(scene, 'X 軸動力／編碼器', [[gx, H + 125, gz - 20], [gx + 120, H + 125, gz - 75], [leg - 60, H + 125, gz - 75], [leg - 60, 1000, gz - 75], [holes[0].at[0], 1000, holes[0].at[2]], [holes[0].at[0], top + 40, holes[0].at[2]]], { radius: holes[0].wire, color: CABLE.power, clips: 4 });
  feed(0, 0, CABLE.power);

  // ---- 相機：立柱＋懸臂＋吊板＋相機（光軸朝下）
  // 相機線：沿懸臂底 → 立柱北面 → 地面 → 電控櫃西側外牆 → 櫃頂接頭 2（不要讓線懸空；長距離可以改用 cableTray）
  const [ax, ay, az] = cam.at, pz = cam.postZ, armY = ay + 150;
  const camera = visionCamera({ focal: 16, ring: 60 }); camera.root.position.set(ax, ay, az); scene.add(camera.root);
  const B = camera.params.body, L = camera.params.lensL, plugTop = ay + L + B * 1.3 + 14, wall = cx - cab.size[0] / 2 - 10, run = cz - d / 2 + 80;
  const mount = new THREE.Group(); mount.name = 'camera mount'; scene.add(mount);
  block(mount, [60, armY + 20, 60], [ax, (armY + 20) / 2, pz], MAT.alu);                              // 立柱（頂面與懸臂頂齊）
  block(mount, [80, 40, Math.abs(pz - az) + 40], [ax, armY, (pz + az) / 2], MAT.alu);                    // 懸臂：底面在相機接頭上方
  block(mount, [8, armY - 20 - (ay + L + 15), 40], [ax + B / 2 + 4, (armY - 20 + ay + L + 15) / 2, az], MAT.steelDark);   // 吊板：貼機身側面，頂到懸臂底
  const y0 = ay + L + B * 1.3 + 20;
  const [hx, , hz] = holes[1].at, r = holes[1].wire, north = pz - 30 - r - 1.5 * Math.sign(pz - az || 1);
  cable(scene, '相機 GigE／觸發', [[ax, plugTop - 2, az], [ax, y0, az], [ax, y0, north], [ax, r + 1, north], [wall, r + 1, north], [wall, r + 1, run], [wall, top + 40, run], [hx, top + 40, run], [hx, top + 40, hz]], { radius: r, color: CABLE.signal, clips: 4 });
  feed(1, 3, CABLE.signal);

  return { panel, camera, set: ({ x, light = 0 }) => { chain.set(x); camera.set({ light }); } };
}
