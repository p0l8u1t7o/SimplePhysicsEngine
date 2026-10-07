// 電控配置示意：沿用 segment2 的中空櫃、背板、穿板接頭、固定線路與定長拖鏈。
// 配線只讀既有機構位置；電氣額定、線徑與安全迴路須由實際選型確認。
import * as THREE from 'three';
import { component, electricalDevice, electricalActivity } from '@core/electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryGland, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, cableTray, carrier, support, solidMeshes, CABLE } from '@core/electrical/cable-routing.js';
import { block, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { LOADER as L, BAYS, FENCE, CONTROLLER, OPERATOR } from './layout.js';

const device = (id, kind, title, size, role, source = null, category = 'dc', description = '') =>
  component({ id, kind, title, size, role, source, category, description: description || '配置示意；容量與型號待選。' });
export const SCHEDULE = [
  { y: 260, items: [
    device('QS1', 'isolator', '總電源隔離開關', [65, 100, 85], 'power', null, 'ac'),
    ...['控制電源', '移載機伺服', '鋁框輸送帶', '手臂控制器饋電', '預留支路'].map((title, i) =>
      device('QF' + (i + 1), 'breaker', title, [54, 90, 75], 'power', 'QS1', 'ac')),
  ] },
  { y: 50, items: [
    device('PS1', 'psu', '24 VDC 電源', [90, 120, 120], 'power', 'QF1', 'ac'),
    device('PLC1', 'plc', '工作站 PLC', [130, 100, 100], 'control', 'PS1', 'dc', 'A/B 工位、移載機、拆框機交握；透過 SW1 與手臂交換 EtherNet/IP 訊號。'),
    device('SAF1', 'safety', '安全控制器', [100, 100, 100], 'safety', 'PS1', 'safety', '四組叉車口光柵＋後側光柵，共五組；急停、移載機在機內禁止拆框的硬體互鎖。示意，非安全認證。'),
    device('SW1', 'switch', '工業乙太網交換器', [60, 100, 85], 'network', 'PS1', 'dc', 'PLC ↔ 手臂 EtherNet/IP、HMI、遠端 I/O 網路。'),
    device('IO1', 'io', '機台／交接台 I/O 耦合器', [70, 100, 80], 'io', 'SW1', 'network'),
    device('IO2', 'io', '入出料工位 I/O 耦合器', [70, 100, 80], 'io', 'SW1', 'network'),
  ] },
  { y: -180, items: [
    device('D1', 'drive', '移載機 Z 軸伺服驅動', [95, 160, 150], 'motion', 'QF2', 'ac'),
    device('D2', 'drive', '移載機升降伺服驅動', [95, 160, 150], 'motion', 'QF2', 'ac'),
    device('KM1', 'contactor', '南側鋁框輸送帶接觸器', [65, 100, 90], 'motion', 'QF3', 'ac'),
    device('KM2', 'contactor', '北側鋁框輸送帶接觸器', [65, 100, 90], 'motion', 'QF3', 'ac'),
  ] },
  { y: -430, items: ['待料', '拆框中', '拆框完成', '故障', '拆框啟動', '移載機互鎖'].map((title, i) =>
    device('KA' + (i + 1), 'io', title + '介面繼電器', [38, 70, 60], 'io', i === 5 ? 'SAF1' : 'IO1', i === 5 ? 'safety' : 'signal')) },
];

export function createElectrical(scene, { transfer }) {
  // 保留全部既有實體：含手臂、移載機、夾爪、皮帶、動態板／鋁框／接線盒與棧板。
  // 光束與地坪平面不是障礙物；櫃內元件另由電盤檢查逐一驗證。
  const obstacles = solidMeshes(scene).filter(m => {
    for (let p = m; p; p = p.parent) if (p.userData.fx) return false;
    return true;
  });
  const root = new THREE.Group(); root.name = 'electrical installation'; scene.add(root);
  const rigid = (name, size, at, parent = root) => {
    const m = block(parent, size, at, MAT.steelDark); m.name = name; obstacles.push(m); return m;
  };
  const cx = -300, cy = 900, cz = 5400, top = 1800, backZ = cz - 250 + 3;
  const entries = [-300, -180, -60, 60, 180, 300].map(x => ({ x, z: -70, hole: 12, wire: 3 }));
  const shell = cabinetShell(root, 'CTRL / 主控制櫃', { center: [cx, cy, cz], size: [1000, 1800, 500], entries, thickness: 20 });
  obstacles.push(...shell.solids);
  const panel = controlPanel(root, 'CTRL / 背板', { center: [cx, cy, backZ + 42], width: 880, height: 1530, backZ, schedule: SCHEDULE });
  // 保留 controlPanel 原有梳齒與通道幾何，只把槽體改為灰色，讓配線容易辨識。
  const ductMat = new THREE.MeshStandardMaterial({ color: 0x92999d, roughness: .72 });
  panel.group.traverse(m => { if (m.isMesh && /duct/.test(m.name)) m.material = ductMat; });
  for (let i = 0; i < 12; i++) plate(panel.group, [`X1:${i + 1}`], 22, 10, [(i - 5.5) * 25, 443, 33], 0);
  plate(panel.group, ['CTRL · 24 VDC / I/O / SERVO'], 510, 40, [0, 650, 4], 0);
  const holes = entries.map((e, i) => {
    const at = [cx + e.x, top, cz + e.z];
    entryGland(root, 'CTRL / 頂板接頭 ' + (i + 1), { at, ...e, thickness: 20 });
    const p = panel.ports[i];
    panelFeed(root, 'CTRL / 頂板到 X1:' + (i + 1), [[at[0], top + 40, at[2]], [at[0], top - 60, at[2]], [at[0], top - 60, p[2]], [p[0], top - 60, p[2]], p], { radius: 3, color: i < 2 ? CABLE.power : CABLE.signal });
    return [at[0], top + 40, at[2]];
  });

  // 小型現場介面採櫃外模組（free），背面有獨立支架，避免把原機控制箱冒充新增 I/O。
  const fields = [];
  function field(id, title, at, description) {
    const spec = { ...device(id, 'io', title, [240, 240, 100], 'io', null, 'signal', description), free: true };
    const g = electricalDevice(root, spec, at); fields.push(g); obstacles.push(...solidMeshes(g));
    rigid(id + ' mounting post', [40, at[1] - 130, 40], [at[0], (at[1] - 130) / 2, at[2] - 25]);
    rigid(id + ' mounting plate', [200, 230, 8], [at[0], at[1], at[2] - 12]);
    rigid(id + ' mounting neck', [30, 25, 30], [at[0], at[1] - 120, at[2] - 25]);
    return { g, port: [at[0], at[1] + 123, at[2] + 55] };
  }
  const machine = field('JB1', '拆框機交握改裝箱', [-1690, 1080, -650], 'KA1–KA6：待料、忙碌、完成、故障、啟動與硬體互鎖；連到現場既有控制箱。');
  const table = field('JB2', '交接台閥組／感測 I/O', [1000, 570, 1280], '置中電磁閥、交接台有板感測與到位。');
  const west = field('JB3', '入料 A/B 現場 I/O', [-3250, 1000, 5060], '入料 A/B 棧板感測、工位燈、換料請求／就位確認、光柵訊號。');
  const east = field('JB4', '出料 A/B 現場 I/O', [3250, 1000, 5060], '出料 A/B 棧板感測、滿疊對照光電、工位燈、換料請求／就位確認、光柵訊號。');

  // 線槽分段接合留 1 mm；主幹越過機械工作區，支柱只落在南側與機台西側。
  const trayY = 2380, bridgeY = 3800, southZ = 5010, bridgeX = -1750;
  function tray(name, a, b, width = 120) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A).normalize();
    return cableTray(root, name, A.addScaledVector(d, 1).toArray(), B.addScaledVector(d, -1).toArray(), { width, height: 36 });
  }
  tray('南側架高主線槽', [-3450, trayY, southZ], [3450, trayY, southZ]);
  tray('西側高架橋', [bridgeX, bridgeY, southZ], [bridgeX, bridgeY, -650]);
  for (const x of [-3500, -2100, -700, 550, 2100, 3500]) {
    rigid('south tray post', [40, trayY - 50, 40], [x, (trayY - 50) / 2, 4970]);
    support(root, 'south tray bracket', [x, trayY - 50, 4970], [x, trayY - 23, southZ], 8);
  }
  for (const z of [southZ, 700, -650]) {
    const pz = z === southZ ? z + 100 : z;
    rigid('overhead bridge post', [60, bridgeY - 50, 60], [bridgeX - 150, (bridgeY - 50) / 2, pz]);
    support(root, 'overhead bridge bracket', [bridgeX - 119, bridgeY - 60, pz], [bridgeX, bridgeY - 23, z], 10);
  }

  // 固定線的金屬護軌隨路徑延伸；落地段在地面，立段在柱旁，分支沿固定設備外側。
  // feet 只在實際支承處指定，沒有從線材任意拉向可動機構的假線夾。
  function wire(name, points, { parent = root, color = CABLE.signal, radius = 3, feet = [], offset = [0, -12, 12] } = {}) {
    const path = points.map(p => new THREE.Vector3(...p).add(new THREE.Vector3(...offset)));
    // 護軌在插頭之前收尾，不能把整根護軌偏移進端子或箱殼內。
    for (const [i, j] of [[0, 1], [path.length - 1, path.length - 2]]) {
      const d = path[j].clone().sub(path[i]); path[i].addScaledVector(d.normalize(), Math.min(24, path[i].distanceTo(path[j]) * .4));
    }
    // 地面護軌每 600 mm 有落地腳，不讓整段金屬護軌與線材一起懸空。
    if (parent === root) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (Math.max(a.y, b.y) > 30) continue;
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / 600));
      for (let j = 0; j < n; j++) {
        const p = a.clone().lerp(b, (j + .5) / n);
        support(root, name + ' / floor saddle', [p.x, .8, p.z], [p.x, p.y - 5, p.z], 3);
      }
    }
    return cable(parent, name, points, { radius, color, clips: Math.max(2, points.length),
      backing: { path: path.map(p => p.toArray()), radius: 5, feet } });
  }
  holes.forEach((h, i) => wire('CTRL / 外線 ' + (i + 1), [h, [h[0], 1870 + i * 14, h[2]], [h[0], 1870 + i * 14, 5075], [h[0], trayY - 14, 5075], [h[0], trayY - 14, 5040]], { color: i < 2 ? CABLE.power : CABLE.signal }));
  wire('移載／拆框主幹', [[bridgeX, trayY - 14, 5040], [bridgeX - 70, trayY - 14, 5040], [bridgeX - 70, bridgeY - 14, 5040], [bridgeX - 30, bridgeY - 14, 5010], [bridgeX - 30, bridgeY - 14, -650]], { color: CABLE.power });
  wire('JB1 / 高架垂降', [[bridgeX - 30, bridgeY - 14, -650], [bridgeX - 30, 1250, -650], [bridgeX - 30, 1250, -595], [machine.port[0], 1250, -595], machine.port]);
  wire('JB1 / 原機交握', [[-1569, 1100, -590], [-1561, 1100, -590]], { radius: 2.5 });
  for (const z of [-650, 700]) for (const y of [1600, 2400, 3200])
    support(root, 'bridge drop clamp', [bridgeX - 119, y, z], [bridgeX - 30, y, z + 12], 4);
  support(root, 'bridge riser clamp', [bridgeX - 119, 3000, southZ + 100], [bridgeX - 70, 3000, 5052], 4);
  holes.forEach((h, i) => support(root, 'cabinet outgoing loom bracket', [h[0], 1801, 5380], [h[0], 1858 + i * 14, 5342], 4));
  for (const [name, box, x] of [['入料', west, -3250], ['出料', east, 3250]])
    wire(name + ' I/O 垂降', [[x, trayY - 14, 5040], [x, 1310, 5040], [x, 1310, box.port[2]], box.port]);

  // 手臂控制器由 QF4 供電，EtherNet/IP 與動力分路；控制器到機座走封閉範圍內的地面線槽。
  const floorY = 28;
  tray('手臂地面線槽 Z', [-1030, floorY, 5420], [-1030, floorY, 3850], 100);
  tray('手臂地面線槽 X', [-1030, floorY, 3850], [0, floorY, 3850], 100);
  wire('RC1 / 動力與回授', [[CONTROLLER.x + 371, 150, 5420], [-1055, 150, 5420], [-1055, floorY - 14, 5420], [-1055, floorY - 14, 3875], [0, floorY - 14, 3875], [0, 100, 3875], [0, 100, 3712]], { color: CABLE.power });
  wire('QF4 / RC1 饋電', [[-1500, trayY - 14, 4980], [-1500, 1200, 5060], [-1500, 1200, 5450], [-1500, 1103, 5450]], { color: CABLE.power });
  wire('SW1 / RC1 EtherNet/IP', [[-1530, trayY - 14, 5040], [-1530, 1220, 5080], [-1530, 1220, 5480], [-1530, 1103, 5480]]);
  wire('HMI / 網路', [[900, trayY - 14, 5040], [980, trayY - 14, 5040], [980, 1200, 5040], [980, 1200, 5240], [980, 1208, 5240]]);
  wire('SAF1 / 操作站急停', [[1200, trayY - 14, 5040], [1200, 1030, 5040], [1200, 1030, 5190], [1200, 1053, 5190]]);

  // 交接台線路沿東側桌腳、地面與北圍籬；不經任何叉車口或板子落料區。
  wire('JB2 / 現場主幹', [[3450, trayY - 14, 5040], [3430, trayY - 14, 5040], [3430, 24, 5010], [1300, 24, 5010], [1300, 24, 1200], [1000, 24, 1200], [1000, 750, 1200], [1000, 750, 1335], table.port], { offset: [0, -12, -12] });
  wire('交接台 / 有板感測', [[1000, 580, 1383], [1000, 580, 1410], [1000, 780, 1410], [650, 780, 1410], [650, 780, 2070], [700, 780, 2070], [700, 824, 2070]], { offset: [0, -12, 12] });
  const valve = electricalDevice(root, { ...device('YV1', 'valve', '交接台置中閥組', [170, 70, 65], 'io', 'JB2', 'signal'), free: true }, [1000, 380, 1290]);
  obstacles.push(...solidMeshes(valve));
  rigid('valve mounting plate', [180, 80, 8], [1000, 380, 1278]);
  wire('JB2 / 置中閥組', [[1105, 447, 1350], [1105, 420, 1380], [1128, 420, 1380], [1128, 325, 1380], [1048, 325, 1332], [1048, 343, 1332]]);

  // 工位分支在棧板內緣地面；A 燈由北側繞行、B 燈由南側繞行，叉車開口不拉橫線。
  for (const [key, b] of Object.entries(BAYS)) {
    const s = b.side, a = key.endsWith('A'), zLamp = a ? 1830 : 4770, zBypass = a ? 1870 : 4810;
    const boxX = s * 3250, lane = s * 1310, sx = b.x - s * (875 + 22);
    wire(key + ' / 棧板存在', [[boxX, 877, 5130], [boxX, 830, 5130], [boxX + s * 170, 830, 5130], [boxX + s * 170, 830, 5005], [boxX + s * 170, 24, 5005], [lane, 24, 5005], [lane, 24, b.z + 350], [sx - s * 55, 24, b.z + 350], [sx - s * 55, 209, b.z + 350], [sx - s * 14, 209, b.z + 350]], { offset: [-s * 12, -12, 0] });
    const lampX = s * 3660;
    wire(key + ' / 工位燈與請求確認', [[boxX + s * 25, 877, 5130], [boxX + s * 25, 800, 5130], [boxX + s * 170, 800, 5130], [boxX + s * 170, 800, 5073], [boxX + s * 170, 24, 5073], [lane - s * 30, 24, 5073], [lane - s * 30, 24, zBypass], [lampX + s * 125, 24, zBypass], [lampX + s * 125, 1000, zBypass], [lampX, 1000, zLamp + 20], [lampX, 1016, zLamp + 20]], { offset: [s * 12, 0, -12] });
    wire(key + ' / 燈柱', [[lampX + 27, 1050, zLamp + 20], [lampX + 50, 1050, zLamp + 20], [lampX + 50, 1380, zLamp], [lampX + 13, 1380, zLamp]], { offset: [12, -12, 0] });
    // 每支光柵各自從棧板端部進線，不跨過投／受光器之間的叉車開口。
    const gate = FENCE.gates[a ? 0 : 1];
    for (const z of [gate[0] + 55, gate[1] - 55])
      wire(key + ' / 安全光柵 ' + z, [[lane - s * 30, 24, z], [s * 3460, 24, z], [s * 3480, 24, z]], { color: CABLE.signal, offset: [0, -12, 0] });
    if (s > 0) for (const [x, z] of [[1365, b.z - 640], [3235, b.z + 640]])
      wire(key + ' / 滿疊光電 ' + x, [[lane - 30, 24, zBypass], [lane - 30, 24, z], [x - 32, 24, z], [x - 32, 448, z], [x - 20, 448, z]], { radius: 2, offset: [-12, -12, 0] });
  }
  for (const x of [-1350, 1350]) wire('SAF1 / 後側光柵 ' + x,
    [[-1800, 1080, -548], [-1800, 1080, -525], [-1840, 1080, -525], [-1840, 1080, -1030], [-1840, 24, -1030], [x, 24, -1030], [x, 175, -1030], [x, 175, -993]]);

  // Z 軸鏈沿導軌下方折返，位在前柱內側、台車外側；升降鏈隨台車走。
  const horizontal = carrier(transfer.loader, '移載 Z 軸拖鏈', { origin: [-1275, 1350, 0], axis: [0, 0, 1], rise: [1, 0, 0], fixed: 700, min: 0, max: 1550, radius: 30, width: 28 });
  const vertical = carrier(transfer.carriage, '移載升降拖鏈', { origin: [-1050, 0, 90], axis: [0, 1, 0], rise: [1, 0, 0], fixed: 1300, min: L.yPick + 170, max: L.yPark + 170, radius: 35, width: 24 });
  wire('D1/D2 / 導軌進線', [[bridgeX - 30, bridgeY - 14, 700], [bridgeX - 30, 1350, 700], [-1275, 1350, 700]], { color: CABLE.power });
  wire('台車 / 升降鏈固定端', [[-1215, 1350, 0], [-1215, 1350, 90], [-1050, 1350, 90], [-1050, 1300, 90]], { parent: transfer.carriage, color: CABLE.power });
  wire('升降鏈 / 夾具端', [[-980, 170, 90], [-980, 195, 90], [-1045, 195, 90], [-1045, 195, 42]], { parent: transfer.head, color: CABLE.air, offset: [0, 0, 12] });
  // 固定端支架釘在導軌／立柱，活動端支架釘在各自載體；沿線仍納入剛體障礙檢查。
  for (const z of [300, 700, 1100, 1500]) {
    support(transfer.loader, 'Z chain rail bracket', [-1240, 1419, z], [-1286, 1350, z], 5);
  }
  support(transfer.carriage, 'lift chain post bracket', [-1145, 1300, 31], [-1145, 1300, 90], 5);
  support(transfer.carriage, 'lift chain bracket', [-1145, 1300, 90], [-1061, 1300, 90], 5);

  const leds = [...panel.devices.values(), ...fields, valve];
  function set({ z, y, action = '', motion = false }) {
    horizontal.set(z); vertical.set(y + 170);
    for (const d of leds) if (d.userData.electricalLed)
      d.userData.electricalLed.material.emissiveIntensity = electricalActivity(d.userData.electrical.role, { action, motion }) ? 1.1 : .12;
  }
  return { root, panel, shell, fields, horizontal, vertical, obstacles, set };
}
