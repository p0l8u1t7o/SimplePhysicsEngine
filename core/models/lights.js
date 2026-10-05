// 視覺用光源：條形光（bar-light）、穹頂光（dome-light）。環形光在 camera.js 的相機模型裡。
// 這些原本各站自己畫；幾何、分段數、位置與材質都能用參數重現各站原樣（換用對照見 core/MIGRATION.md 1.9.0）。
import * as THREE from 'three';
import { block, bevelBox } from '../geom/shapes.js';
import { MAT, std } from '../geom/materials.js';
import { defaults } from './util.js';

const group = name => { const g = new THREE.Group(); g.name = name; return g; };
const level = v => v === true ? 1 : Math.min(1, Math.max(0, +v || 0));

// ---------------------------------------------------------------- 條形光
// 原點：外殼中心（不畫外殼時是發光面中心）；長邊沿 axis（預設 Z）。要斜打時旋轉 root。
// 發光面（lens）的截面是 lensW（水平、垂直長邊）× lensT（Y 向），位置用 lensOffset 指定（截面內的 [水平, Y]）。
export const barLight = {
  meta: {
    id: 'bar-light', name: '條形光', category: '視覺',
    source: 'RecycleSorter、RobotArmPressSSD',
    params: {
      length: { value: 300, min: 60, max: 1500, step: 10, unit: 'mm', label: '長度' },
      w: { value: 60, min: 10, max: 150, step: 1, unit: 'mm', label: '外殼寬' },
      h: { value: 50, min: 8, max: 120, step: 1, unit: 'mm', label: '外殼高' },
      lensW: { value: 52, min: 6, max: 140, step: 1, unit: 'mm', label: '發光面寬' },
      lensT: { value: 8, min: 2, max: 40, step: 1, unit: 'mm', label: '發光面厚' },
    },
    states: { light: { value: 1, min: 0, max: 1, label: '亮度' } },
    options: {
      axis: "長邊方向 'z'（預設）或 'x'",
      housing: 'false 不畫外殼（只有發光條）', housingMaterial: '外殼材質（預設 MAT.alu）',
      lensLength: '發光面長度（預設：有外殼 length−20，沒有外殼 length）',
      lensOffset: '發光面中心在截面內的 [水平, Y]（預設：有外殼 [0, −h/2] 半嵌在底面，沒有外殼 [0, 0]）',
      bevel: '發光條倒角半徑（預設 0 方塊；>0 用 bevelBox）',
      lensMaterial: '發光面材質（外部材質原樣使用，可多支共用；預設白色 emissive、粗糙度 roughness=.3）',
      on: '全亮的 emissiveIntensity（預設 1.1）', off: '熄燈的 emissiveIntensity（預設 0.05）',
      name: 'root 的名稱（預設 bar-light）',
    },
    usage: "import { barLight } from '@core/models/lights.js';\nconst bar = barLight.create({ length: 520 }); bar.root.position.set(x, y, z); bar.root.rotation.z = -Math.PI / 4; scene.add(bar.root);\nbar.set({ light: 1 });   // 0～1 或布林；bar.lens、bar.housing 是網格（也可以直接換 bar.lens.material）",
  },
  create(p = {}) {
    const P = { ...defaults(barLight.meta), axis: 'z', on: 1.1, off: .05, roughness: .3, bevel: 0, ...p };
    const root = group(P.name ?? 'bar-light');
    const Z = P.axis !== 'x';
    const dims = (across, y, along) => Z ? [across, y, along] : [along, y, across];
    const shell = P.housing === false ? null : block(root, dims(P.w, P.h, P.length), [0, 0, 0], P.housingMaterial ?? MAT.alu);
    if (shell) shell.name = 'bar-light housing';
    const [ou, oy] = P.lensOffset ?? (shell ? [0, -P.h / 2] : [0, 0]);
    const material = P.lensMaterial ?? std(0xffffff, P.roughness, 0, { emissive: 0xffffff, emissiveIntensity: P.off });
    const size = dims(P.lensW, P.lensT, P.lensLength ?? (shell ? P.length - 20 : P.length));
    const lens = P.bevel > 0 ? bevelBox(...size, material, P.bevel) : block(null, size, [0, 0, 0], material);
    lens.name = 'bar-light lens'; lens.position.set(Z ? ou : 0, oy, Z ? 0 : ou); root.add(lens);
    function set(v) {
      if (v !== null && typeof v === 'object') v = v.light;
      const k = level(v);
      lens.material.emissiveIntensity = k >= 1 ? P.on : k <= 0 ? P.off : P.off + (P.on - P.off) * k;
    }
    return { root, params: P, housing: shell, lens, set };
  },
};

// ---------------------------------------------------------------- 穹頂光
// 原點：開口（底緣）中心；穹頂在 +Y，光朝 −Y 照。頂部留開口給相機鏡頭。
// spot：穹頂內的聚光燈（閃光），set({ light }) 設定強度＝light × power。
const DOME_WHITE = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: .9, side: THREE.DoubleSide });
export const domeLight = {
  meta: {
    id: 'dome-light', name: '穹頂光', category: '視覺',
    source: 'MilitaryGradePC',
    params: {
      radius: { value: 200, min: 50, max: 500, step: 10, unit: 'mm', label: '穹頂半徑' },
      opening: { value: .16, min: 0, max: .8, step: .01, unit: 'rad', label: '頂部開口（極角）' },
      ringTube: { value: 8, min: 2, max: 30, step: 1, unit: 'mm', label: '底緣環粗細（半徑）' },
      ringGap: { value: 2, min: 0, max: 30, step: 1, unit: 'mm', label: '底緣環比穹頂大多少' },
    },
    states: { light: { value: 0, min: 0, max: 1, label: '閃光亮度' } },
    options: {
      segments: '穹頂 [經, 緯] 分段（預設 [32, 16]）', ringSegments: '底緣環 [管圓周, 環圓周]（預設 [8, 48]）',
      material: '擴散罩材質（預設白色霧面雙面）', ringMaterial: '底緣環材質（預設 MAT.black）',
      spot: 'false 不裝；{ color=0xffffff, distance=1200, angle=.5, penumbra=.6, decay=1, y=250, targetY=−180, power=2000 }',
      name: 'root 的名稱（預設 dome-light）',
    },
    usage: "import { domeLight } from '@core/models/lights.js';\nconst dome = domeLight.create(); dome.root.position.set(x, 產品頂面 + 80, z); scene.add(dome.root);\ndome.set({ light: 1 });   // dome.dome、dome.ring 是網格，dome.light 是聚光燈（也可以直接設 intensity）",
  },
  create(p = {}) {
    const P = { ...defaults(domeLight.meta), segments: [32, 16], ringSegments: [8, 48], ...p };
    const root = group(P.name ?? 'dome-light');
    const dome = new THREE.Mesh(new THREE.SphereGeometry(P.radius, P.segments[0], P.segments[1], 0, Math.PI * 2, P.opening, Math.PI / 2 - P.opening), P.material ?? DOME_WHITE);
    dome.name = 'dome light'; dome.castShadow = true; root.add(dome);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(P.radius + P.ringGap, P.ringTube, ...P.ringSegments), P.ringMaterial ?? MAT.black);
    ring.name = 'dome rim'; ring.rotation.x = Math.PI / 2; root.add(ring);
    let light = null, power = 0;
    const so = P.spot === undefined || P.spot === true ? {} : P.spot;
    if (so) {
      power = so.power ?? 2000;
      light = new THREE.SpotLight(so.color ?? 0xffffff, 0, so.distance ?? 1200, so.angle ?? .5, so.penumbra ?? .6, so.decay ?? 1);
      light.position.set(0, so.y ?? 250, 0); light.target.position.set(0, so.targetY ?? -180, 0); root.add(light, light.target);
    }
    function set(v) {
      if (v !== null && typeof v === 'object') v = v.light;
      if (light) light.intensity = level(v) * power;
    }
    return { root, params: P, dome, ring, light, set };
  },
};
