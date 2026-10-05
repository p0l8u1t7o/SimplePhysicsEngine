// 搬運與倉儲用的市購設備：塑膠棧板（pallet-plastic）、棧板穿梭車（pallet-shuttle）、穿梭車密集架（shuttle-rack）、
// 懸臂吊＋電動葫蘆＋夾桶具（jib-crane）、平台台車（platform-dolly）、AGV 充電櫃（agv-charger）。輸送設備在 transport.js。
// 這些原本畫在化學桶清洗線裡；幾何、分段數、位置與材質都能用參數重現原樣（換用對照見 core/migrations/1.10.0-transport.md）。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、陣列、子物件設定）。外部傳入的材質原樣使用。
import * as THREE from 'three';
import { block, cylinder, rod, plate, D2R } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { foot, bolts, motor } from '../geom/hardware.js';
import { defaults } from './util.js';
import { modelRoot, seq, part } from './transport.js';

// ---------------------------------------------------------------- 塑膠棧板
// 原點：棧板底面中心。上板＋沿 Z 的底樑（叉子由 Z 向插入）。大量靜態棧板用 pallet.instances()（每種零件一個 InstancedMesh）。
const palletParts = P => {                                 // [寬（X）, 高, 中心 x, 中心 y]：上板、各底樑
  const { size: W, height: H, deck } = P, xs = P.runnerX ?? [-(W / 2 - P.runner / 2), 0, W / 2 - P.runner / 2];
  return [[W, deck, 0, H - deck / 2], ...xs.map(x => [P.runner, H - deck, x, (H - deck) / 2])];
};
export const pallet = {
  meta: {
    id: 'pallet-plastic', name: '塑膠棧板（三底樑）', category: '搬運',
    source: 'ChemicalTankWashing',
    params: {
      size: { value: 1200, min: 600, max: 1500, step: 50, unit: 'mm', label: '邊長' },
      height: { value: 150, min: 100, max: 220, step: 5, unit: 'mm', label: '高度' },
      deck: { value: 30, min: 15, max: 60, step: 5, unit: 'mm', label: '上板厚' },
      runner: { value: 100, min: 60, max: 200, step: 10, unit: 'mm', label: '底樑寬' },
    },
    options: {
      runnerX: '各底樑的中心 X（預設 [−(size/2−runner/2), 0, size/2−runner/2]）',
      material: '材質（預設 MAT.pallet）', empty: 'true 用 MAT.palletEmpty（空棧板）',
      name: 'root 的名稱（預設 pallet）',
    },
    usage: "import { pallet } from '@core/models/transport-handling.js';\nconst p = pallet.create(); p.root.position.set(x, 棧板底 y, z); scene.add(p.root);   // p.deck、p.runners 是網格\nconst many = pallet.instances([[x, y, z], …]); scene.add(many.root);   // 大量靜態棧板：每種零件一個 InstancedMesh",
  },
  create(p = {}) {
    const P = { ...defaults(pallet.meta), name: 'pallet', ...p };
    const root = modelRoot(pallet.meta, P, { mobile: true }), mat = P.material ?? (P.empty ? MAT.palletEmpty : MAT.pallet);
    const [deck, ...runners] = palletParts(P).map(([w, h, x, y]) => block(root, [w, h, P.size], [x, y, 0], mat));
    deck.name = 'pallet deck'; for (const r of runners) r.name = 'pallet runner';
    return { root, params: P, deck, runners };
  },
  // positions：[[x, y, z]…]（棧板底面中心）。回傳 { root, meshes }；root 是放在原點的群組
  instances(positions, p = {}) {
    const P = { ...defaults(pallet.meta), name: 'pallets', ...p };
    const root = modelRoot(pallet.meta, P, { mobile: true }), mat = P.material ?? (P.empty ? MAT.palletEmpty : MAT.pallet), m = new THREE.Matrix4();
    const meshes = palletParts(P).map(([w, h, dx, dy]) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, P.size), mat, positions.length);
      positions.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x + dx, y + dy, z)));
      mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
    });
    return { root, params: P, meshes };
  },
};

// ---------------------------------------------------------------- 棧板穿梭車
// 原點：軌道頂面（棧板底面）中心；車身在軌道下緣行走（y < 0），沿 Z 進出車道，前端（+Z）有紅色警示燈。
export const shuttleCar = {
  meta: {
    id: 'pallet-shuttle', name: '棧板穿梭車', category: '搬運',
    source: 'ChemicalTankWashing',
    params: {
      width: { value: 1000, min: 600, max: 1400, step: 10, unit: 'mm', label: '車寬（X）' },
      length: { value: 1080, min: 600, max: 1600, step: 10, unit: 'mm', label: '車長（Z）' },
      height: { value: 120, min: 80, max: 250, step: 5, unit: 'mm', label: '車身高' },
    },
    options: {
      bodyMaterial: '車身材質（預設 MAT.yellow）', deckMaterial: '頂升板材質（預設 MAT.steelDark）',
      wheelMaterial: '車輪材質（預設 MAT.black）', lampMaterial: '警示燈材質（預設 MAT.red）',
      name: 'root 的名稱（預設 pallet-shuttle）',
    },
    usage: "import { shuttleCar } from '@core/models/transport-handling.js';\nconst car = shuttleCar.create(); car.root.position.set(車道 x, 軌道頂面 y + 頂升量, z); scene.add(car.root);",
  },
  create(p = {}) {
    const P = { ...defaults(shuttleCar.meta), ...p };
    const root = modelRoot(shuttleCar.meta, P, { mobile: true }), { width: w, length: l, height: h } = P;
    const body = block(root, [w, h, l], [0, -20 - h / 2, 0], P.bodyMaterial ?? MAT.yellow); body.name = 'shuttle body';
    const wheels = [];
    for (const x of [-(w / 2 - 20), w / 2 - 20]) for (const z of [-(l / 2 - 140), l / 2 - 140]) wheels.push(cylinder(root, 45, 35, [x, -70, z], P.wheelMaterial ?? MAT.black, 'x', 16));
    const deck = block(root, [w - 100, 16, l - 100], [0, -12, 0], P.deckMaterial ?? MAT.steelDark); deck.name = 'shuttle deck';   // 頂升板
    const lamps = [-1, 1].map(s => block(root, [30, 60, 200], [s * (w / 2 + 5), -95, l / 2 - 20], P.lampMaterial ?? MAT.red));
    return { root, params: P, body, wheels, deck, lamps };
  },
};

// ---------------------------------------------------------------- 穿梭車密集架
// 原點：站內座標原點（root 不位移時 lanes、zBack、zFront 就是站的絕對座標）；車道沿 Z，zBack 是後端、zFront 是前緣（入口）。
// blocks 把相鄰車道分成幾座架體（中間被柱子隔開時）；fronts 可以讓個別車道的前緣退後（較淺的車道）。
// 組成：立柱＋腳座、斜撐、立柱間的縱向繫樑、每道前後的頂樑、每層兩條穿梭車軌道＋入口導引、車道牌。
export const shuttleRack = {
  meta: {
    id: 'shuttle-rack', name: '穿梭車密集架', category: '搬運',
    source: 'ChemicalTankWashing',
    params: {
      pitch: { value: 1360, min: 1000, max: 2000, step: 10, unit: 'mm', label: '車道間距' },
      zFront: { value: 2800, min: 1200, max: 8000, step: 100, unit: 'mm', label: '前緣 Z（架深）' },
      topBeam: { value: 3700, min: 1500, max: 6000, step: 50, unit: 'mm', label: '頂樑高度' },
    },
    options: {
      lanes: '各車道中心 X（預設兩道：[−pitch/2, pitch/2]）', levels: '各層軌道頂面（棧板底）的高度（預設 [150, 1480, 2810]）',
      zBack: '後端 Z（預設 100）', fronts: '{ 車道編號: 前緣 Z }：個別車道較淺時指定',
      blocks: '[[車道編號…]…]：分成幾座架體（預設全部一座）', frameZ: '中間各排立柱的 Z（預設 [1450, 2750, 4050]；超過前緣的不立）',
      brace: '斜撐 { from=430, to=topBeam−600, pitch=1330, rise=980, r=12 }',
      railX: '軌道中心到車道中心（預設 600）', guideX: '入口導引中心到車道中心（預設 650）',
      labels: 'false 不掛；i => 文字（預設「第 n 道」）：車道牌',
      name: 'root 的名稱（預設 shuttle-rack）',
    },
    usage: "import { shuttleRack } from '@core/models/transport-handling.js';\nconst rack = shuttleRack.create({ lanes: [1000, 2360, 3720], zFront: 5400 }); scene.add(rack.root);\n// 棧板放在 (lanes[i], levels[v], z)；rack.front(i) 是該道的前緣 Z",
  },
  create(p = {}) {
    const P = { ...defaults(shuttleRack.meta), levels: [150, 1480, 2810], zBack: 100, frameZ: [1450, 2750, 4050], railX: 600, guideX: 650, ...p };
    const root = modelRoot(shuttleRack.meta, P);
    const X = P.lanes ?? [-P.pitch / 2, P.pitch / 2], half = P.pitch / 2, { zBack, topBeam } = P;
    const blocks = P.blocks ?? [X.map((_, i) => i)], br = { from: 430, to: topBeam - 600, pitch: 1330, rise: 980, r: 12, ...P.brace };
    const front = l => P.fronts?.[l] ?? P.zFront;
    const framesTo = f => [zBack, ...P.frameZ, f - 50].filter((z, i, a) => z <= f - 50 && (i === 0 || z - a[i - 1] > 300));
    const label = P.labels === false ? null : P.labels ?? (i => `第 ${i + 1} 道`);
    const posts = [], rails = [];
    for (const lanes of blocks) {
      // 每支立柱的深度取兩側車道較深者
      const xs = [[X[lanes[0]] - half, front(lanes[0])], ...lanes.map((l, k) => [X[l] + half, Math.max(front(l), k + 1 < lanes.length ? front(lanes[k + 1]) : 0)])];
      for (const [x, f] of xs) {
        const zs = framesTo(f);
        for (const z of zs) { posts.push(block(root, [90, topBeam, 90], [x, topBeam / 2, z], MAT.steelBlue)); foot(root, x, z, 130); }
        for (let k = 0; k < zs.length - 1; k++) for (let y = br.from; y < br.to; y += br.pitch) rod(root, [x, y, zs[k]], [x, y + br.rise, zs[k + 1]], br.r, MAT.steel, 8);
        for (let k = 0; k < zs.length - 1; k++) block(root, [40, 40, zs[k + 1] - zs[k]], [x, topBeam - 300, (zs[k] + zs[k + 1]) / 2], MAT.steelBlue);
      }
      for (const l of lanes) for (const z of [zBack, front(l) - 50]) block(root, [P.pitch + 90, 120, 70], [X[l], topBeam - 60, z], MAT.steelBlue);
      for (const i of lanes) for (const y of P.levels) for (const s of [-1, 1]) {
        rails.push(block(root, [80, 105, front(i) - zBack], [X[i] + s * P.railX, y - 52, (zBack + front(i)) / 2], MAT.steelOrange));
        block(root, [60, 220, 60], [X[i] + s * P.guideX, y + 60, front(i) - 30], MAT.steelOrange);   // 入口導引
      }
      if (label) for (const i of lanes) plate(root, [label(i)], 520, 130, [X[i], topBeam + 90, front(i) - 10], 0, { w: 512, h: 128 });
    }
    return { root, params: P, lanes: X, posts, rails, front };
  },
};

// ---------------------------------------------------------------- 懸臂吊（立柱式）＋電動葫蘆＋夾桶具
// 原點：立柱中心、地面。手臂（arm）在 armY 高度繞立柱旋轉，方位 a（度）：手臂方向 (cos a, −sin a)；台車（trolley）沿手臂走到半徑 r；
// 夾具（clamp）由吊鏈吊著升降，y 是夾具原點（橫桿底面）的離地高度；夾爪（claws）grip 1 夾住、0 張開。
export const jibCrane = {
  meta: {
    id: 'jib-crane', name: '懸臂吊（電動葫蘆＋夾桶具）', category: '搬運',
    source: 'ChemicalTankWashing',
    params: {
      armY: { value: 3000, min: 2000, max: 5000, step: 50, unit: 'mm', label: '手臂高度' },
      reach: { value: 1550, min: 1000, max: 4000, step: 50, unit: 'mm', label: '臂長' },
      gripR: { value: 282.5, min: 100, max: 500, step: .5, unit: 'mm', label: '夾爪夾住時的半徑' },
    },
    states: {
      a: { value: 0, min: -180, max: 180, unit: '°', label: '手臂方位' },
      r: { value: 1200, min: 700, max: 1400, unit: 'mm', label: '吊點半徑' },
      y: { value: 1800, min: 1000, max: 2500, unit: 'mm', label: '夾具高度' },
      grip: { value: 1, min: 0, max: 1, label: '夾爪（1 夾住）' },
    },
    options: {
      gripOpen: '夾爪單側張開行程（預設 60）', mastR: '立柱半徑（預設 130）',
      name: 'root 的名稱（預設 jib-crane）',
    },
    usage: "import { jibCrane } from '@core/models/transport-handling.js';\nconst jib = jibCrane.create({ armY: 3000, reach: 1550 }); jib.root.position.set(x, 0, z); scene.add(jib.root);\njib.set({ a: 方位度, r: 半徑, y: 夾具離地高度, grip: 1 });   // jib.arm、jib.trolley、jib.clamp 是群組，jib.chain、jib.claws 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(jibCrane.meta), gripOpen: 60, mastR: 130, ...p };
    const root = modelRoot(jibCrane.meta, P), { armY, reach } = P;
    const mast = cylinder(root, P.mastR, armY + 190, [0, (armY + 190) / 2, 0], MAT.steelOrange, 'y', 20); mast.name = 'jib mast';
    block(root, [600, 40, 600], [0, 20, 0], MAT.steelDark);
    const arm = new THREE.Group(); arm.name = 'jib arm'; arm.position.set(0, armY, 0); root.add(arm);
    block(arm, [reach, 140, 35], [reach / 2, 0, 0], MAT.steelOrange);
    for (const y of [-85, 85]) block(arm, [reach, 30, 180], [reach / 2, y, 0], MAT.steelOrange);
    rod(arm, [100, 180, 0], [reach - 300, 100, 0], 18, MAT.steelDark);   // 拉桿隨臂長
    bolts(root, [-1, 1].flatMap(a => [-1, 1].map(b => [a * 230, 48, b * 230])), 20);
    block(arm, [300, 160, 160], [0, 120, 0], MAT.steelDark);
    const trolley = new THREE.Group(); trolley.name = 'jib trolley'; arm.add(trolley);
    block(trolley, [220, 120, 220], [0, -150, 0], MAT.black);
    motor(trolley, 0, -150, 130, .55);
    for (const s of [-1, 1]) cylinder(trolley, 45, 28, [0, -50, s * 85], MAT.steel, 'z', 28);
    const chain = cylinder(trolley, 10, 1, [0, 0, 0], MAT.steel, 'y', 6); chain.name = 'hoist chain';
    const clamp = new THREE.Group(); clamp.name = 'hoist clamp'; trolley.add(clamp);
    block(clamp, [520, 50, 120], [0, 25, 0], MAT.steelDark);
    const claws = [-1, 1].map(s => { const c = block(clamp, [30, 120, 100], [0, -30, 0], MAT.yellow); c.userData.s = s; return c; });
    // a：方位（度）；r：吊點半徑；y：夾具原點離地高度；grip：1 夾住、0 張開
    function set({ a = 0, r = reach - 350, y = armY - 1200, grip = 1 } = {}) {
      arm.rotation.y = a * D2R; trolley.position.x = r;
      const clampY = y - armY;
      clamp.position.y = clampY; chain.scale.y = Math.max(1, -clampY - 160); chain.position.y = (clampY + 10 - 150) / 2;   // 吊鏈下端埋進夾具 10 mm
      for (const k of claws) k.position.x = k.userData.s * (P.gripR + (1 - grip) * P.gripOpen);
    }
    set();
    return { root, params: P, mast, arm, trolley, chain, clamp, claws, set };
  },
};

// ---------------------------------------------------------------- 平台台車（四輪＋推把，載油桶用）
// 原點：台面中心在地面的投影；台面高度 = height；推把在 −X 側。
export const dolly = {
  meta: {
    id: 'platform-dolly', name: '平台台車（油桶台車）', category: '搬運',
    source: 'ChemicalTankWashing',
    params: {
      size: { value: 640, min: 400, max: 1200, step: 10, unit: 'mm', label: '台面邊長' },
      height: { value: 120, min: 80, max: 300, step: 5, unit: 'mm', label: '台面高度' },
      handle: { value: 950, min: 600, max: 1200, step: 10, unit: 'mm', label: '推把高度' },
    },
    options: {
      deckMaterial: '台面材質（預設 MAT.steelBlue）', handleMaterial: '推把材質（預設 MAT.steel）', wheelMaterial: '車輪材質（預設 MAT.black）',
      name: 'root 的名稱（預設 dolly）',
    },
    usage: "import { dolly } from '@core/models/transport-handling.js';\nconst d = dolly.create(); d.root.position.set(x, 0, z); scene.add(d.root);   // 推著走就移動 d.root；工件放在 y = height",
  },
  create(p = {}) {
    const P = { ...defaults(dolly.meta), name: 'dolly', ...p };
    const root = modelRoot(dolly.meta, P, { mobile: true }), { size: w, height: h } = P, hm = P.handleMaterial ?? MAT.steel, hx = -(w / 2 + 20), hw = w / 2 - 120;
    const deck = block(root, [w, 40, w], [0, h - 20, 0], P.deckMaterial ?? MAT.steelBlue); deck.name = 'dolly deck';
    const wheels = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => cylinder(root, 40, 40, [a * (w / 2 - 70), 40, b * (w / 2 - 70)], P.wheelMaterial ?? MAT.black, 'z', 12));
    block(root, [30, P.handle - 50, 30], [hx, (P.handle + 50) / 2, -hw], hm); block(root, [30, P.handle - 50, 30], [hx, (P.handle + 50) / 2, hw], hm);
    block(root, [30, 30, 2 * hw + 30], [hx, P.handle, 0], hm);
    return { root, params: P, deck, wheels };
  },
};

// ---------------------------------------------------------------- AGV 充電櫃（掛在柱面或牆面）
// 原點：櫃體底面中心；正面（指示燈）朝 +Z。
export const agvCharger = {
  meta: {
    id: 'agv-charger', name: 'AGV 充電櫃', category: '搬運',
    source: 'ChemicalTankWashing',
    params: {
      w: { value: 400, min: 200, max: 1000, step: 10, unit: 'mm', label: '寬' },
      h: { value: 1400, min: 600, max: 2200, step: 50, unit: 'mm', label: '高' },
      d: { value: 150, min: 80, max: 600, step: 10, unit: 'mm', label: '深' },
    },
    options: {
      material: '櫃體材質（預設 MAT.cabinet）', lampMaterial: '指示燈材質（預設 MAT.green）',
      lamp: '{ size=[120, 120, 6], y=h−200 }：正面的指示燈',
      name: 'root 的名稱（預設 agv-charger）',
    },
    usage: "import { agvCharger } from '@core/models/transport-handling.js';\nconst c = agvCharger.create({ w: 400, h: 1400, d: 150 }); c.root.position.set(x, 0, z); scene.add(c.root);   // c.body、c.lamp 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(agvCharger.meta), ...p };
    const root = modelRoot(agvCharger.meta, P), { w, h, d } = P, la = P.lamp ?? {}, size = la.size ?? [120, 120, 6];
    const body = block(root, [w, h, d], [0, h / 2, 0], P.material ?? MAT.cabinet); body.name = 'charger body';
    const lamp = block(root, size, [0, la.y ?? h - 200, d / 2 + size[2] / 2], P.lampMaterial ?? MAT.green); lamp.name = 'charger lamp';
    return { root, params: P, body, lamp };
  },
};
