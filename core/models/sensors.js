// 感測與安全用的市購小件：盒型光電感測器＋動作指示燈（sensor-led）、安全光柵（light-curtain）、六軸力覺感測器（ft-sensor）。
// 這些原本各站自己畫；幾何、分段數、位置與材質都能用參數重現各站原樣（換用對照見 core/MIGRATION.md 1.9.0）。
// 既有的 `sensor`（hardware.js：黑色機身＋紅色鏡片＋安裝板）外觀與用法不變；盒型＋指示燈是另一個模型。
import * as THREE from 'three';
import { block, cylinder } from '../geom/shapes.js';
import { MAT, std } from '../geom/materials.js';
import { defaults } from './util.js';

const group = name => { const g = new THREE.Group(); g.name = name; return g; };

// ---------------------------------------------------------------- 盒型光電感測器＋動作指示燈
// 原點：機身中心；指示燈在機身頂面（+Y）。
export const boxSensor = {
  meta: {
    id: 'sensor-led', name: '盒型光電感測器（含動作指示燈）', category: '感測與安全',
    source: 'MilitaryGradePC、RobotArmPressSSD',
    params: {
      w: { value: 16, min: 8, max: 60, step: 1, unit: 'mm', label: '寬（X）' },
      h: { value: 18, min: 8, max: 80, step: 1, unit: 'mm', label: '高（Y）' },
      d: { value: 24, min: 8, max: 80, step: 1, unit: 'mm', label: '深（Z）' },
      ledR: { value: 3, min: 1, max: 8, step: .5, unit: 'mm', label: '指示燈半徑' },
      ledH: { value: 2, min: 1, max: 6, step: .5, unit: 'mm', label: '指示燈高' },
    },
    states: { on: { value: 1, min: 0, max: 1, step: 1, label: '動作指示燈' } },
    options: {
      ledY: '指示燈中心的 Y（預設 h/2＋ledH/2，貼在頂面）', ledSegments: '指示燈圓周分段（預設 20）',
      material: '機身材質（預設 MAT.steelBlue）', ledMaterial: '指示燈材質（預設深綠底、emissive 0x32d49b、亮度 0）',
      glow: '動作時的 emissiveIntensity（預設 1.4）', name: 'root 的名稱（預設 sensor-led）',
    },
    usage: "import { boxSensor } from '@core/models/sensors.js';\nconst s = boxSensor.create(); s.root.position.set(x, y, z); scene.add(s.root);\ns.set(true);   // 布林、0～1 或 { on }；s.body、s.led 是網格（s.led.material.emissiveIntensity 也可以直接改）",
  },
  create(p = {}) {
    const P = { ...defaults(boxSensor.meta), ledSegments: 20, glow: 1.4, ...p };
    const root = group(P.name ?? 'sensor-led');
    const body = block(root, [P.w, P.h, P.d], [0, 0, 0], P.material ?? MAT.steelBlue); body.name = 'sensor body';
    const led = cylinder(root, P.ledR, P.ledH, [0, P.ledY ?? P.h / 2 + P.ledH / 2, 0],
      P.ledMaterial ?? new THREE.MeshStandardMaterial({ color: 0x1b4f3d, emissive: 0x32d49b, emissiveIntensity: 0 }), 'y', P.ledSegments);
    led.name = 'sensor led';
    function set(v) {
      if (v !== null && typeof v === 'object') v = v.on;
      led.material.emissiveIntensity = (v === true ? 1 : +v || 0) * P.glow;
    }
    return { root, params: P, body, led, set };
  },
};

// ---------------------------------------------------------------- 安全光柵（投光器＋受光器一對）
// 原點：兩支中間、底端；兩支沿 axis（預設 X）相距 span（中心距），機身由 y 0 到 height。
// 透光面（window）在兩支相對的內側面；托架（brackets）與光幕面（beam，示意用，userData.fx 不列入干涉）可選。
export const lightCurtain = {
  meta: {
    id: 'light-curtain', name: '安全光柵（投／受光器一對）', category: '感測與安全',
    source: 'RecycleSorter、MilitaryGradePC、ChemicalTankWashing',
    params: {
      span: { value: 1200, min: 200, max: 6000, step: 50, unit: 'mm', label: '兩支的中心距' },
      height: { value: 1200, min: 200, max: 2400, step: 50, unit: 'mm', label: '機身高度' },
      w: { value: 40, min: 20, max: 100, step: 1, unit: 'mm', label: '機身寬（沿兩支連線）' },
      d: { value: 36, min: 20, max: 100, step: 1, unit: 'mm', label: '機身深' },
    },
    states: { blocked: { value: 0, min: 0, max: 1, step: 1, label: '遮斷（光幕面變紅）' } },
    options: {
      axis: "兩支連線的方向 'x'（預設）或 'z'",
      material: '機身材質（預設 MAT.amber）',
      window: 'false 不畫；{ t=2, h=height−30, w=12, gap=−1（離機身內側面的距離，負值為嵌入）, offset=0（垂直連線方向的偏移）, y=height/2, material=MAT.black }',
      brackets: 'false（預設）；{ ys:[…]（相對原點）, size:[沿連線,高,深]=[28,18,10], offset=d/2+size[2]/2, material=MAT.steelDark }',
      beam: 'false 不畫；{ color=0xefda57, opacity=.08, offset=window.offset }：兩支透光面之間的光幕面',
      name: 'root 的名稱（預設 light-curtain）',
    },
    usage: "import { lightCurtain } from '@core/models/sensors.js';\nconst lc = lightCurtain.create({ span: 1400, height: 1700 }); lc.root.position.set(門口中心 x, 0, z); scene.add(lc.root);\nlc.set({ blocked: 1 });   // lc.units（兩支機身）、lc.windows、lc.brackets、lc.beam 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(lightCurtain.meta), axis: 'x', ...p };
    const root = group(P.name ?? 'light-curtain');
    const X = P.axis !== 'z';
    const at = (along, y, across) => X ? [along, y, across] : [across, y, along];   // 沿連線、高、垂直連線 → [x, y, z]
    const wo = P.window === undefined || P.window === true ? {} : P.window, bo = P.brackets === true ? {} : P.brackets;
    const wt = wo ? wo.t ?? 2 : 0, gap = wo ? wo.gap ?? -1 : 0, wOff = wo ? wo.offset ?? 0 : 0;
    const units = [], windows = [], brackets = [];
    for (const s of [-1, 1]) {
      const u = block(root, at(P.w, P.height, P.d), at(s * P.span / 2, P.height / 2, 0), P.material ?? MAT.amber); u.name = 'curtain unit'; units.push(u);
      if (wo) {
        const m = block(root, at(wt, wo.h ?? P.height - 30, wo.w ?? 12), at(s * (P.span / 2 - (P.w / 2 + gap + wt / 2)), wo.y ?? P.height / 2, wOff), wo.material ?? MAT.black);
        m.name = 'curtain window'; windows.push(m);
      }
      if (bo) {
        const size = bo.size ?? [28, 18, 10];
        for (const y of bo.ys ?? [40, P.height - 40]) { const m = block(root, at(...size), at(s * P.span / 2, y, bo.offset ?? P.d / 2 + size[2] / 2), bo.material ?? MAT.steelDark); m.name = 'curtain bracket'; brackets.push(m); }
      }
    }
    // 光幕面：示意用的半透明面，不是實體
    let beam = null;
    const be = P.beam === undefined || P.beam === true ? {} : P.beam, color = be ? be.color ?? 0xefda57 : 0;
    if (be) {
      const inner = P.span - P.w - 2 * (gap + wt);
      beam = new THREE.Mesh(new THREE.PlaneGeometry(inner, be.h ?? P.height), std(color, .8, 0, { transparent: true, opacity: be.opacity ?? .08, side: THREE.DoubleSide, depthWrite: false }));
      beam.name = 'curtain'; beam.userData.fx = true; beam.position.set(...at(0, be.y ?? P.height / 2, be.offset ?? wOff));
      if (!X) beam.rotation.y = Math.PI / 2;
      root.add(beam);
    }
    function set({ blocked = 0 } = {}) { if (beam) beam.material.color.setHex(blocked >= .5 ? 0xff4d4d : color); }
    return { root, params: P, units, windows, brackets, beam, set };
  },
};

// ---------------------------------------------------------------- 六軸力覺感測器（含力值色環）
// 原點：法蘭安裝面中心；工具軸是本地 +Z，機身由 z 0 到 height，色環套在機身中段。
// 色環依力值變色：< thresholds[0] 綠、< thresholds[1] 黃、其餘紅。
export const ftSensor = {
  meta: {
    id: 'ft-sensor', name: '六軸力覺感測器（含力值色環）', category: '感測與安全',
    source: 'MilitaryGradePC、RobotArmPressSSD',
    params: {
      radius: { value: 41, min: 20, max: 80, step: 1, unit: 'mm', label: '機身半徑' },
      height: { value: 25, min: 10, max: 60, step: 1, unit: 'mm', label: '機身高' },
      tube: { value: 1.8, min: 1, max: 5, step: .1, unit: 'mm', label: '色環粗細（半徑）' },
    },
    states: { force: { value: 0, min: 0, max: 60, unit: 'N', label: '力值' } },
    options: {
      thresholds: '[注意, 超限]（N，預設 [2, 45]）', colors: '[正常, 注意, 超限]（預設 [0x3dd68c, 0xffb020, 0xff4d4d]）',
      glow: '色環的 emissiveIntensity（預設 1.2）', segments: '機身圓周分段（預設 32）', ringSegments: '色環 [管圓周, 環圓周]（預設 [8, 40]）',
      material: '機身材質（預設 MAT.steelDark）', name: 'root 的名稱（預設 ft-sensor）',
    },
    usage: "import { ftSensor } from '@core/models/sensors.js';\nconst ft = ftSensor.create({ thresholds: [2, 8] }); arm.tool.add(ft.root);   // 工具安裝座的 +Z 朝工具\nft.setForce(牛頓);   // 或 ft.set({ force })、ft.setColor(0x…)；ft.body、ft.ring 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(ftSensor.meta), thresholds: [2, 45], colors: [0x3dd68c, 0xffb020, 0xff4d4d], glow: 1.2, segments: 32, ringSegments: [8, 40], ...p };
    const root = group(P.name ?? 'ft-sensor');
    const body = new THREE.Mesh(new THREE.CylinderGeometry(P.radius, P.radius, P.height, P.segments), P.material ?? MAT.steelDark);
    body.name = 'ft body'; body.castShadow = body.receiveShadow = true; body.rotation.x = Math.PI / 2; body.position.z = P.height / 2; root.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(P.radius, P.tube, ...P.ringSegments), new THREE.MeshStandardMaterial({ color: P.colors[0], emissive: P.colors[0], emissiveIntensity: P.glow }));
    ring.name = 'ft ring'; ring.position.z = P.height / 2; root.add(ring);
    const setColor = c => { ring.material.color.setHex(c); ring.material.emissive.setHex(c); };
    const setForce = f => setColor(f < P.thresholds[0] ? P.colors[0] : f < P.thresholds[1] ? P.colors[1] : P.colors[2]);
    return { root, params: P, body, ring, setColor, setForce, set({ force = 0 } = {}) { setForce(force); } };
  },
};
