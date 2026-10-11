// 下櫃電控與固定走線：機身包絡、配電與通訊均為配置示意，沿立柱／吊架佈線。
import * as THREE from 'three';
import { block, plate } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { component, robotController, electricalActivity } from '@core/electrical/electrical-components.js';
import { cabinetShell, controlPanel, entryPlate, entryGland, panelFeed } from '@core/electrical/electrical-cabinet.js';
import { cable, carrier, CABLE, support } from '@core/electrical/cable-routing.js';
import { MACHINE, OPTICS, DRAWER, HMI_POS, ROBOT } from './layout.js';

const part = (id, kind, title, size, role, source = null, category = 'dc') => component({ id, kind, title, size, role, source, category, description: '設備配置示意；實際選型依電氣設計。' });
const SCHEDULE = [
  { y: 60, items: [
    part('QS1', 'isolator', '總電源隔離', [36, 75, 65], 'power', null, 'ac'),
    part('QF1', 'breaker', '支路保護', [36, 75, 65], 'power', 'QS1', 'ac'),
    part('PS1', 'psu', '24 VDC', [65, 95, 100], 'power', 'QF1', 'ac'),
    part('PLC1', 'plc', '設備 PLC', [100, 90, 85], 'control', 'PS1'),
    part('SAF1', 'safety', '門鎖／光柵安全繼電器', [60, 90, 95], 'safety', 'PS1'),
    part('IO1', 'io', '抽屜感測／鎖／燈', [70, 80, 65], 'io', 'PLC1', 'signal'),
  ] },
  { y: -140, items: [
    part('SW1', 'switch', '工業 Ethernet', [60, 80, 70], 'network', 'PS1'),
    part('IPC1', 'ipc', '工控 PC＋GPU', [260, 110, 180], 'vision', 'SW1', 'network'),
    part('LC1', 'light', '八扇區 LED 驅動', [80, 90, 100], 'vision', 'IO1', 'signal'),
    part('VD1', 'gateway', '三屏影音／電源分配', [100, 80, 90], 'vision', 'IPC1', 'network'),
  ] },
];

export const ENTRIES = [{ x: 1060, z: -860, hole: 20, wire: 5 }, { x: 1000, z: -860, hole: 16, wire: 3 }];
export function createBaseCabinet(base) {
  const material = MAT.cabinet.clone(); material.transparent = true; material.opacity = .22; material.depthWrite = false;
  const shell = cabinetShell(base, 'lower cabinet', { center: [0, 430, 0], size: [2400, 740, 2000], entries: ENTRIES, thickness: 12, material });
  const table = entryPlate(base, 'work table', [2400, 20, 2000], [0, 810, 0], ENTRIES.map(e => [e.x, e.z, e.hole]), MAT.steelDark);
  return { shell, table };
}

export function createElectrical(scene, cell) {
  // 與機櫃同一安裝模組；實體仍由場景檢查與線路檢查檢核。
  const root = new THREE.Group(); root.name = 'cabinet electrical'; cell.base.add(root);
  const panel = controlPanel(root, 'CTRL', { center: [-530, 450, -955], width: 1050, height: 600, backZ: -997, schedule: SCHEDULE });
  const controller = robotController(root, { at: [500, 230, -920], id: 'RC1', floor: 65 });
  plate(root, ['工控 PC + GPU', 'PLC / SAFETY / 24 VDC', 'DENSO RC8A'], 800, 140, [-450, 190, -650], 0, { bg: '#18364a' });
  const wire = (name, pts, power = false, parent = root, clips = 0) => cable(parent, name, pts, { radius: power ? 5 : 2.5, color: power ? CABLE.power : CABLE.signal, clips });
  // 本站兩列背板較高，PE 改由梳齒前方繞行，再由上方進端子。
  panel.group.children.filter(o => o.name.startsWith('PE / chassis bond')).forEach(o => panel.group.remove(o));
  const earth = panel.ports[0];
  cable(root, 'PE / front duct bond', [[-897.5, 234, -948], [-897.5, 234, -910], [-1040, 234, -910], [-1040, 700, -910], [earth[0], 700, -910], [earth[0], 675, earth[2]], earth], { radius: 1.5, color: CABLE.earth, clips: 0, ends: false });
  ENTRIES.forEach((e, i) => {
    entryGland(root, 'cabinet top gland ' + i, { at: [e.x, 820, e.z], hole: e.hole, wire: e.wire, thickness: 32 });
    const p = panel.ports[i];
    panelFeed(root, 'X1 / top feed ' + i, [[e.x, 850, e.z], [e.x, 735, e.z], [p[0], 735, e.z], [p[0], 735, p[2]], p], { radius: e.wire, color: i ? CABLE.signal : CABLE.power });
  });
  // 主幹由後側空間上升，不跨過手臂與抽屜的掃掠區；支線沿各設備吊架。
  wire('RC1 / arm power feedback', [[500, 275, -590], [950, 275, -590], [1060, 275, -860], [1060, 735, -860]], true);
  const rcPort = panel.ports[3];
  wire('RC1 / Ethernet', [[510, 275, -590], [930, 275, -590], [930, 735, -890], [rcPort[0], 735, -890], [rcPort[0], 690, rcPort[2]], rcPort]);
  wire('robot base / protected loom', [[1060, 850, -860], [1060, 855, -700], [ROBOT.x, 855, -700], [ROBOT.x, 855, ROBOT.z - 170]], true, cell.base);
  const rise = [1000, 2175, -860];
  wire('cabinet / overhead data', [[1000, 850, -860], rise]);
  for (const y of [1000, 1500, 2100]) support(cell.shell, 'rear loom bracket', [1000, y, -986], [1000, y, -866], 3);
  const branch = (name, end, via = []) => {
    const [x, , z] = end;
    const routeZ = via.length ? via[0][2] : z;
    wire(name, [rise, [x, 2175, -860], [x, 2175, routeZ], ...via, end]);
    support(cell.shell, name + ' roof clip', [x, 2236, routeZ], [x, 2181, routeZ], 2);
  };
  const [sx, sy, sz] = OPTICS.S;
  branch('IPC1 / main camera GigE trigger', [sx + 36, sy + OPTICS.wd + 112, sz], [[sx + 36, 1950, sz - 65], [sx + 36, 1932, sz - 65]]);
  branch('IPC1 / color camera', [sx + 145, sy + OPTICS.wd + 100, sz + 10], [[sx + 145, 1945, sz - 65], [sx + 145, 1920, sz - 65]]);
  branch('LC1 / LED sectors', [sx + 239, sy + OPTICS.ledY + 8, sz + 220]);
  const head = cell.scanBeam.parent;
  const plug = head.localToWorld(new THREE.Vector3(0, 38, -30)).toArray();
  const scanRoute = [plug[0] + 36, 2175, plug[2]];
  wire('IPC1 / structured light scanner', [rise, [scanRoute[0], 2175, -860], scanRoute, [scanRoute[0], plug[1] + 30, plug[2]], plug]);
  support(cell.shell, 'scanner loom roof clip', [scanRoute[0], 2236, plug[2]], [scanRoute[0], 2181, plug[2]], 2);
  for (const [i, s] of cell.screens.entries()) {
    const p = s.group.localToWorld(new THREE.Vector3(0, 0, -60)).toArray();
    branch('VD1 / screen video power ' + (i + 1), p);
  }
  branch('IO1 / adapter ID reader', [595, 1330, 465]);
  branch('PLC1 / HMI network power', [HMI_POS.x + 38, HMI_POS.y + 100, 960], [[HMI_POS.x + 38, 1550, 930]]);
  // 維修門在後側，門邊安全開關與致動片相對；不改變既有光學／手臂幾何。
  const door = new THREE.Group(); door.name = 'maintenance door'; cell.shell.add(door);
  const panelDoor = block(door, [500, 1050, 5], [820, 1550, -1010], MAT.cabinet); panelDoor.material = MAT.cabinet.clone(); panelDoor.material.transparent = true; panelDoor.material.opacity = .18;
  block(door, [16, 160, 25], [1000, 1500, -1025], MAT.black);
  block(door, [35, 70, 25], [1080, 1900, -972], MAT.yellow).name = 'maintenance interlock switch';
  block(door, [12, 22, 18], [1053, 1900, -972], MAT.steel).name = 'maintenance interlock tongue';
  plate(door, ['維修門 / 安全互鎖'], 340, 60, [820, 1980, -1015], Math.PI);
  wire('SAF1 / maintenance interlock', [rise, [1125, 2175, -860], [1125, 2175, -972], [1125, 1900, -972], [1098, 1900, -972]]);
  const curtains = [], locks = [], chains = [];
  for (const [side, x] of Object.entries(DRAWER.xs)) {
    const d = cell.drawers[side];
    const fixed = new THREE.Group(); fixed.position.set(x, 836, 680); d.group.add(fixed);
    const sensor = block(fixed, [18, 28, 14], [145, 60, -260], MAT.steelBlue); sensor.name = 'drawer closed sensor ' + side;
    const lock = block(fixed, [32, 42, 65], [-140, 68, 190], MAT.steelDark); lock.name = 'drawer lock solenoid ' + side; locks.push(lock);
    // 內側安全光柵：抽屜拉出時亮紅，禁止手臂進入該工位；右工位獨立互鎖。
    for (const dx of [-190, 190]) block(fixed, [12, 290, 22], [dx, 165, 290], MAT.yellow).name = 'drawer safety curtain post ' + side;
    const beams = new THREE.Group(); beams.name = 'drawer safety curtain rays ' + side; beams.userData.fx = true; fixed.add(beams);
    for (let y = 45; y < 300; y += 28) block(beams, [366, 2, 2], [0, y, 290], new THREE.MeshBasicMaterial({ color: 0xff584b, transparent: true, opacity: .55 }));
    curtains.push({ side, beams });
    plate(fixed, ['人機不共區'], 220, 42, [0, 318, 302], 0);
    const offset = side === 'L' ? 169 : -169;
    const chain = carrier(d.group, 'drawer ' + side + ' / signal carrier', { origin: [x + offset, 874, 310], axis: [0, 0, 1], rise: [0, 1, 0], min: 0, max: DRAWER.travel, radius: 18, width: 10 });
    chains.push({ side, chain });
    wire('IO1 / drawer ' + side, [[1000, 850, -860], [1125, 874, -860], [1125, 874, 280], [x + offset, 874, 280], [x + offset, 874, 310]]);
    wire('drawer ' + side + ' / carrier moving lead', [[offset, 74, -370], [offset, 42, -370], [offset, 42, 280], [145, 42, 280]], false, d.tray);
    // 前板工位燈與抽屜上的有料感測器隨台板移動，線路固定在台板下方。
    wire('drawer ' + side + ' / presence lamp', [[130, 42, DRAWER.nestOffset + 70], [145, 42, DRAWER.nestOffset + 70], [145, 42, 280]], false, d.tray);
    wire('drawer ' + side + ' / front lamp', [[145, 42, 280], [145, 42, 310], [145, d.lamp.position.y, 310], [0, d.lamp.position.y, 310], [0, d.lamp.position.y, d.lamp.position.z - 3]], false, d.tray);
    wire('drawer ' + side + ' / closed sensor', [[offset, 38, -370], [145, 38, -370], [145, 44, -260]], false, fixed);
    wire('drawer ' + side + ' / lock solenoid', [[offset, 38, -370], [-140, 38, -370], [-140, 43, 190]], false, fixed);
    support(d.group, 'drawer ' + side + ' carrier rear support', [x + offset, 820, 310], [x + offset, 859, 310], 2);
  }
  function set(st, step, vision) {
    for (const device of [...panel.devices.values(), controller]) {
      const led = device.userData.electricalLed;
      if (led) led.material.emissiveIntensity = electricalActivity(device.userData.electrical.role, { action: step.action, motion: !!step.robot, vision }) ? 1.1 : .12;
    }
    curtains.forEach(({ side, beams }) => { beams.visible = (side === 'L' ? st.dL : st.dR) > .001; });
    chains.forEach(({ side, chain }) => chain.set((side === 'L' ? st.dL : st.dR) * DRAWER.travel));
  }
  return { root, panel, controller, curtains, locks, chains, set };
}
