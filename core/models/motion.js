// 氣動、運動與夾持用的市購件：氣缸（air-cylinder）、擺動式油壓／氣壓缸（pivot-cylinder）、氣動滑台（slide-table）、
// 線性模組（linear-axis）、Z-θ 主軸（z-theta-spindle）、伺服鎖付軸（servo-nutrunner）、平行夾爪（parallel-gripper）、
// 真空發生器（vacuum-ejector）、電磁閥（solenoid-valve）、浮動桿（float-rod）、真空吸盤（suction-cup）、FRL 三點組（frl-unit）、
// 旋轉編碼器（rotary-encoder）、抽屜滑軌（drawer-slide）、門互鎖開關（door-switch）、荷重元（load-cell）。
// 這些原本各站自己畫；幾何、分段數、位置與材質都能用參數重現各站原樣（換用對照見 core/migrations/1.10.0-motion.md）。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、陣列、子物件設定）。外部傳入的材質原樣使用。
// 會動的子群組（活塞桿、滑座、夾指…）都有回傳：站裡原本就有移動群組時，把模型的子群組改掛進去
//（站的群組.add(模型.子群組)，位置對齊 root），關節與父子關係就和原本一樣，全場檢查的判定不變。
// root.userData.coreModel＝模型 id；會動的子群組 userData.coreModelPart＝模型 id（改掛到站的群組後仍可辨認）。
import * as THREE from 'three';
import { block, cylinder, D2R } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { housing } from '../geom/hardware.js';
import { defaults } from './util.js';

const AX = { x: 0, y: 1, z: 2 };
const group = name => { const g = new THREE.Group(); g.name = name; return g; };
const rootOf = (meta, P) => { const g = group(P.name ?? meta.id); g.userData.coreModel = meta.id; return g; };
const partOf = (meta, name) => { const g = group(name); g.userData.coreModelPart = meta.id; return g; };
// 子物件選項：undefined／true → 用預設（{}），false／null → 不畫，物件 → 逐項設定
const part = v => v === undefined || v === true ? {} : v || null;
const amount = (v, key) => v !== null && typeof v === 'object' ? v[key] : v;
const clamp01 = v => Math.min(1, Math.max(0, +v || 0));
const unit = (i, v) => { const a = [0, 0, 0]; a[i] = v; return a; };
const list = at => Array.isArray(at[0]) ? at : [at];

// ---------------------------------------------------------------- 氣缸
// 原點：本體中心（不畫本體時是活塞桿中心）；活塞桿沿 axis（預設 +Y）伸出。
// 本體是方塊（薄型／導桿缸）或圓柱（標準缸）；只當固定件用時可以只畫本體（rod: false），止擋銷這類只露出活塞桿的可以只畫桿（body: false）。
// 活塞桿兩種動法：整支平移（預設），或由缸頭長出來（rod.grow：桿長用縮放表示，桿端 tip 跟著走）。
export const airCylinder = {
  meta: {
    id: 'air-cylinder', name: '氣缸（本體＋活塞桿）', category: '氣動',
    source: 'PCB-CopperAssembly、AutomaticAcid-BaseTitration、MilitaryGradePC、RobotArmPressSSD、ChemicalTankWashing、shutter assembly',
    params: {
      w: { value: 40, min: 6, max: 200, step: 1, unit: 'mm', label: '本體寬（X）' },
      h: { value: 60, min: 6, max: 600, step: 1, unit: 'mm', label: '本體高（Y）' },
      d: { value: 40, min: 6, max: 200, step: 1, unit: 'mm', label: '本體深（Z）' },
      rodR: { value: 6, min: 1, max: 40, step: .5, unit: 'mm', label: '活塞桿半徑' },
      rodL: { value: 40, min: 4, max: 600, step: 1, unit: 'mm', label: '活塞桿長度' },
      stroke: { value: 24, min: 1, max: 500, step: 1, unit: 'mm', label: '行程' },
    },
    states: { ext: { value: 0, min: 0, max: 1, label: '伸出（0 縮回～1 全伸）' } },
    options: {
      axis: "活塞桿方向 'x'／'y'（預設）／'z'", dir: '伸出方向 +1（預設）或 −1',
      body: "false 不畫；{ shape:'box'（預設）或 'cyl', size:[x,y,z]=[w,h,d], r=w/2, length（圓柱，預設本體在 axis 方向的尺寸）, segments=20, at=[0,0,0], material, name }",
      bodyMaterial: '本體材質（預設 MAT.black）',
      rod: 'false 不畫；{ r=rodR, length=rodL, segments=20, at（縮回時的中心；預設在軸線上、後段 inset 插在本體裡）, inset=4, material=MAT.chrome, name, grow }',
      'rod.grow': '{ from（桿的起點，沿 axis 離原點的距離；預設缸頭面）, min（行程 0 時露出的長度，預設 0） }：桿由缸頭長出，幾何長度 length 用縮放表示',
      name: 'root 的名稱（預設 air-cylinder）',
    },
    usage: "import { airCylinder } from '@core/models/motion.js';\nconst cyl = airCylinder.create({ stroke: 30 }); cyl.root.position.set(x, y, z); scene.add(cyl.root);\ncyl.set({ ext: 1 });      // 0～1；cyl.setStroke(mm) 直接給毫米\n// cyl.body、cyl.rodMesh 是網格；cyl.rod 是會動的群組，cyl.tip 是桿端（推板、壓塊裝在這裡）",
  },
  create(p = {}) {
    const meta = airCylinder.meta, P = { ...defaults(meta), axis: 'y', dir: 1, ...p };
    const root = rootOf(meta, P), i = AX[P.axis], dir = P.dir < 0 ? -1 : 1;
    const bo = part(P.body), ro = part(P.rod);
    let body = null, head = 0;                                            // head：缸頭面離原點的距離
    if (bo) {
      const at = bo.at ?? [0, 0, 0], mat = bo.material ?? P.bodyMaterial ?? MAT.black;
      if (bo.shape === 'cyl') { const len = bo.length ?? [P.w, P.h, P.d][i]; body = cylinder(root, bo.r ?? P.w / 2, len, at, mat, P.axis, bo.segments ?? 20); head = len / 2; }
      else { const size = bo.size ?? [P.w, P.h, P.d]; body = block(root, size, at, mat); head = size[i] / 2; }
      body.name = bo.name ?? 'cylinder body';
    }
    let rod = null, tip = null, rodMesh = null, grow = null, len = 0;
    if (ro) {
      rod = partOf(meta, 'cylinder rod'); tip = group('cylinder rod end'); root.add(rod); rod.add(tip);
      len = ro.length ?? P.rodL;
      const at = ro.at ?? (bo ? unit(i, dir * (head + len / 2 - (ro.inset ?? 4))) : [0, 0, 0]);
      rodMesh = cylinder(rod, ro.r ?? P.rodR, len, at, ro.material ?? MAT.chrome, P.axis, ro.segments ?? 20); rodMesh.name = ro.name ?? 'cylinder rod';
      tip.position.set(...at); tip.position.setComponent(i, at[i] + dir * len / 2);
      if (ro.grow) grow = { from: ro.grow.from ?? head, min: ro.grow.min ?? 0 };
    }
    // 伸出量（mm）。平移：整個 rod 群組移動；長出：桿由 from 起算，露出 min＋mm
    function setStroke(mm) {
      if (!rod) return;
      if (grow) {
        const out = grow.min + mm;
        rodMesh.position.setComponent(i, dir * (grow.from + out / 2)); rodMesh.scale.y = out / len;
        tip.position.setComponent(i, dir * (grow.from + grow.min + mm));
      } else rod.position.setComponent(i, dir * mm);
    }
    if (grow) setStroke(0);
    return { root, params: P, body, rod, rodMesh, tip, setStroke, set(v) { setStroke(clamp01(amount(v, 'ext')) * P.stroke); } };
  },
};

// ---------------------------------------------------------------- 擺動式油壓／氣壓缸（尾端耳軸固定、桿端跟著機構走）
// 原點：尾端耳軸中心（固定點）。缸筒由原點沿本地 +Y 伸出；活塞桿由 rodFrom 起算，長度用縮放表示。
// aim(向量)：把缸對準「原點 → 桿端」的向量（root 座標），長度就是兩端銷距；set({ length, angle }) 給目錄頁用（在 XY 平面內擺動）。
const UP = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3();
export const pivotCylinder = {
  meta: {
    id: 'pivot-cylinder', name: '擺動式油壓／氣壓缸（耳軸式）', category: '氣動',
    source: 'ChemicalTankWashing',
    params: {
      barrelR: { value: 46, min: 10, max: 150, step: 1, unit: 'mm', label: '缸筒半徑' },
      barrelL: { value: 420, min: 60, max: 2000, step: 10, unit: 'mm', label: '缸筒長度' },
      rodR: { value: 24, min: 4, max: 100, step: 1, unit: 'mm', label: '活塞桿半徑' },
      rodFrom: { value: 350, min: 0, max: 2000, step: 10, unit: 'mm', label: '活塞桿起點（離耳軸）' },
      trunnionR: { value: 65, min: 0, max: 200, step: 1, unit: 'mm', label: '耳軸座半徑（0 不畫）' },
      trunnionL: { value: 110, min: 10, max: 400, step: 5, unit: 'mm', label: '耳軸座長度' },
    },
    states: {
      length: { value: 560, min: 440, max: 760, unit: 'mm', label: '兩端銷距' },
      angle: { value: 20, min: -45, max: 45, unit: '°', label: '擺角（由 +Y 往 +X）' },
    },
    options: {
      segments: '圓周分段（預設 28）',
      trunnion: "false 不畫；{ r=trunnionR, length=trunnionL, axis='z', segments, material=MAT.steelDark }",
      barrelMaterial: '缸筒材質（預設 MAT.steelDark）', rodMaterial: '活塞桿材質（預設 MAT.steel）',
      name: 'root 的名稱（預設 pivot-cylinder）',
    },
    usage: "import { pivotCylinder } from '@core/models/motion.js';\nconst ram = pivotCylinder.create(); ram.root.position.copy(固定點); scene.add(ram.root);\nram.aim(桿端.clone().sub(固定點));   // 每格更新；ram.actuator（會擺的群組）、ram.barrel、ram.piston、ram.trunnion",
  },
  create(p = {}) {
    const meta = pivotCylinder.meta, P = { ...defaults(meta), segments: 28, ...p };
    const root = rootOf(meta, P);
    const to = P.trunnion === undefined ? (P.trunnionR > 0 ? {} : null) : part(P.trunnion);
    let trunnion = null;
    if (to) { trunnion = cylinder(root, to.r ?? P.trunnionR, to.length ?? P.trunnionL, [0, 0, 0], to.material ?? MAT.steelDark, to.axis ?? 'z', to.segments ?? P.segments); trunnion.name = 'cylinder trunnion'; }
    const actuator = partOf(meta, 'cylinder actuator'); root.add(actuator); actuator.userData.cableHost = false;   // 改掛到站的群組後仍會擺動：不當線夾固定面
    const barrel = cylinder(actuator, P.barrelR, P.barrelL, [0, P.barrelL / 2, 0], P.barrelMaterial ?? MAT.steelDark, 'y', P.segments); barrel.name = 'cylinder barrel';
    const piston = cylinder(actuator, P.rodR, 1, [0, P.barrelL, 0], P.rodMaterial ?? MAT.steel, 'y', P.segments); piston.name = 'cylinder piston';
    function aim(to) {
      _v.set(...(to.isVector3 ? to.toArray() : to));
      const length = _v.length();
      actuator.quaternion.setFromUnitVectors(UP, _v.normalize());
      piston.scale.y = length - P.rodFrom; piston.position.y = P.rodFrom + (length - P.rodFrom) / 2;
    }
    function set({ length = meta.states.length.value, angle = 0 } = {}) { const a = angle * D2R; aim([Math.sin(a) * length, Math.cos(a) * length, 0]); }
    return { root, params: P, actuator, barrel, piston, trunnion, aim, set };
  },
};

// ---------------------------------------------------------------- 氣動滑台（SMC MXQ 級）
// 原點：本體安裝面（頂面）中心；滑台沿本地 −Y 伸出。工具裝在 table 群組上，跟著伸縮。
export const slideTable = {
  meta: {
    id: 'slide-table', name: '氣動滑台', category: '氣動',
    source: 'shutter assembly',
    params: {
      w: { value: 20, min: 8, max: 120, step: 1, unit: 'mm', label: '本體寬（X）' },
      h: { value: 40, min: 10, max: 300, step: 1, unit: 'mm', label: '本體高（Y）' },
      d: { value: 22, min: 8, max: 120, step: 1, unit: 'mm', label: '本體深（Z）' },
      stroke: { value: 12, min: 1, max: 150, step: 1, unit: 'mm', label: '行程' },
    },
    states: { ext: { value: 0, min: 0, max: 1, label: '伸出（0～1）' } },
    options: {
      bodyAt: '本體中心（預設 [0, −h/2, 0]）', bodyMaterial: '本體材質（預設 MAT.steelBlue）',
      table: 'false 不畫（工具直接裝在 table 群組）；{ size=[w+4, 6, d+4], at（預設包住本體下緣 1 mm）, material=MAT.alu }：滑台端板',
      name: 'root 的名稱（預設 slide-table）',
    },
    usage: "import { slideTable } from '@core/models/motion.js';\nconst s = slideTable.create(); s.root.position.set(x, y, z); tool.add(s.root);\ns.table.add(吸嘴);      // 工具裝在會動的 table 群組\ns.set({ ext: 1 });     // 0～1：table.position.y = −ext × stroke",
  },
  create(p = {}) {
    const meta = slideTable.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P), at = P.bodyAt ?? [0, -P.h / 2, 0];
    const body = block(root, [P.w, P.h, P.d], at, P.bodyMaterial ?? MAT.steelBlue); body.name = 'slide body';
    const table = partOf(meta, 'slide table'); root.add(table);
    const to = part(P.table); let plate = null;
    if (to) { plate = block(table, to.size ?? [P.w + 4, 6, P.d + 4], to.at ?? [at[0], at[1] - P.h / 2 - 2, at[2]], to.material ?? MAT.alu); plate.name = 'slide plate'; }
    return { root, params: P, body, table, plate, set(v) { table.position.y = -clamp01(amount(v, 'ext')) * P.stroke; } };
  },
};

// ---------------------------------------------------------------- 線性模組／滑軌
// 組成（都可以關掉）：底座（base）、導軌條（rails）、螺絲頭（bolts）、螺桿（screw）、馬達（motor）、滑座（carriage 群組＋方塊）。
// 原點：行程中心、底座安裝面。預設配置以 axis 'x' 描述（導軌在底座 +Y 面上）；axis 'z' 是把 X、Z 對調；
// axis 'y' 是直立（安裝面在 z = 0，導軌與滑座在 +Z 面）。各零件的 size／at 都可以直接給 [x,y,z]（root 座標）蓋過預設。
// 只有導軌或只有滑座也可以（龍門的 Y 軌、裝在別的移動群組上的橫樑）；滑座要跟站裡既有的移動群組走時，把 carriage 群組改掛過去。
export const linearAxis = {
  meta: {
    id: 'linear-axis', name: '線性模組／滑軌（底座＋導軌＋滑座）', category: '運動',
    source: 'PCB-CopperAssembly、MilitaryGradePC、ChemicalTankWashing',
    params: {
      length: { value: 1200, min: 200, max: 6000, step: 50, unit: 'mm', label: '長度（行程方向）' },
      width: { value: 160, min: 30, max: 600, step: 5, unit: 'mm', label: '底座寬' },
      height: { value: 60, min: 10, max: 300, step: 5, unit: 'mm', label: '底座高' },
      carL: { value: 200, min: 30, max: 800, step: 10, unit: 'mm', label: '滑座長' },
      carH: { value: 40, min: 10, max: 300, step: 5, unit: 'mm', label: '滑座高' },
    },
    states: { pos: { value: 0, min: -400, max: 400, unit: 'mm', label: '滑座位置' } },
    options: {
      axis: "行程方向 'x'（預設）／'y'／'z'",
      base: 'false 不畫；{ size, at, material=MAT.steelDark, name }',
      rails: 'false 不畫；{ size, at:[[x,y,z],…]（每支的中心）, material=MAT.steel, name }；預設兩支在底座上（埋入 1 mm）',
      bolts: 'false（預設）；{ r=4, h=2, segments=20, span:[起,迄], pitch=140, a（離安裝面的高度）, offsets:[橫向位置…], material=MAT.steelDark }：導軌上的螺絲頭',
      screw: 'false（預設）；{ r, length, at, segments=20, material=MAT.chrome }：沿行程方向的螺桿',
      motor: 'false（預設）；{ size, at, material=MAT.steelBlue }',
      carriage: 'false 不畫；{ size, at（[x,y,z] 或多個 [[x,y,z],…]：多個滑塊）, material=MAT.steelDark, name }；預設跨在導軌上',
      guide: "導軌標記：預設 'linear-axis'（導軌 userData.guide、carriage 群組 userData.on，全場檢查視為滑動配合）；false 不標；或自訂字串",
      name: 'root 的名稱（預設 linear-axis）',
    },
    usage: "import { linearAxis } from '@core/models/motion.js';\nconst axis = linearAxis.create({ length: 2800 }); scene.add(axis.root);\naxis.carriage.add(手臂立座);   // carriage 是會動的群組\naxis.set({ pos: 300 });       // carriage.position[axis] = pos；axis.base、axis.rails、axis.carriageBody 是網格",
  },
  create(p = {}) {
    const meta = linearAxis.meta, P = { ...defaults(meta), axis: 'x', ...p }, ax = P.axis;
    const root = rootOf(meta, P);
    // 沿行程 u、離安裝面 a、橫向 b → [x,y,z]
    const S = (u, a, b) => ax === 'x' ? [u, a, b] : ax === 'z' ? [b, a, u] : [b, u, a];
    const guide = P.guide === undefined ? meta.id : P.guide;
    const bo = part(P.base), ro = part(P.rails), co = part(P.carriage);
    let base = null;
    if (bo) { base = block(root, bo.size ?? S(P.length, P.height, P.width), bo.at ?? S(0, P.height / 2, 0), bo.material ?? MAT.steelDark); base.name = bo.name ?? 'axis base'; }
    const rails = [];
    if (ro) for (const at of ro.at ?? [-1, 1].map(s => S(0, P.height + 5, s * P.width / 4))) {
      const m = block(root, ro.size ?? S(P.length - 40, 12, 16), at, ro.material ?? MAT.steel); m.name = ro.name ?? 'axis rail'; if (guide) m.userData.guide = guide; rails.push(m);
    }
    const bolts = [];
    if (P.bolts) {
      const b = P.bolts, [u0, u1] = b.span ?? [-P.length / 2 + 100, P.length / 2 - 100];
      for (let u = u0; u <= u1; u += b.pitch ?? 140) for (const o of b.offsets ?? [-P.width / 4, P.width / 4]) {
        const m = cylinder(root, b.r ?? 4, b.h ?? 2, S(u, b.a ?? P.height + 12, o), b.material ?? MAT.steelDark, ax === 'y' ? 'z' : 'y', b.segments ?? 20); m.name = 'axis bolt'; bolts.push(m);
      }
    }
    let screw = null, motor = null;
    if (P.screw) { const s = P.screw; screw = cylinder(root, s.r, s.length, s.at, s.material ?? MAT.chrome, ax, s.segments ?? 20); screw.name = 'axis screw'; }
    if (P.motor) { const m = P.motor; motor = block(root, m.size, m.at, m.material ?? MAT.steelBlue); motor.name = 'axis motor'; }
    let carriage = null; const carriageBodies = [];
    if (co) {
      carriage = partOf(meta, 'axis carriage'); if (guide) carriage.userData.on = guide; root.add(carriage);
      for (const at of list(co.at ?? S(0, P.height + 4 + P.carH / 2, 0))) {
        const m = block(carriage, co.size ?? S(P.carL, P.carH, P.width + 20), at, co.material ?? MAT.steelDark); m.name = co.name ?? 'axis carriage'; carriageBodies.push(m);
      }
    }
    return { root, params: P, base, rails, bolts, screw, motor, carriage, carriageBody: carriageBodies[0] ?? null, carriageBodies,
      set(v) { if (carriage) carriage.position[ax] = +amount(v, 'pos') || 0; } };
  },
};

// ---------------------------------------------------------------- Z-θ 主軸（升降＋旋轉的吸嘴軸）
// 原點：主軸下端的基準面（吸嘴尖端所在的高度）；主軸沿 +Y。吸嘴等自製件裝在站裡自己的群組。
// 組成：主軸桿、套環（collars）、θ 馬達（方塊，主軸穿過）。都在 spin 群組裡，set({ z, theta }) 給目錄頁用。
export const zThetaSpindle = {
  meta: {
    id: 'z-theta-spindle', name: 'Z-θ 主軸模組', category: '運動',
    source: 'PCB-CopperAssembly',
    params: {
      shaftR: { value: 5, min: 2, max: 30, step: .5, unit: 'mm', label: '主軸半徑' },
      shaftL: { value: 144, min: 30, max: 500, step: 1, unit: 'mm', label: '主軸長度' },
      motorW: { value: 14, min: 6, max: 80, step: 1, unit: 'mm', label: 'θ 馬達邊長' },
      motorH: { value: 30, min: 6, max: 120, step: 1, unit: 'mm', label: 'θ 馬達高' },
    },
    states: {
      z: { value: 0, min: 0, max: 20, unit: 'mm', label: '升降' },
      theta: { value: 0, min: -180, max: 180, unit: '°', label: '旋轉' },
    },
    options: {
      shaft: '{ r=shaftR, length=shaftL, y（中心，預設 6＋length/2：下端留 6 mm 給吸嘴）, segments=32, material=MAT.alu }',
      collars: 'false 不畫；{ r=shaftR+0.5, h=2, ys=[6,12,95], segments=32, material=MAT.black }',
      motor: 'false 不畫；{ size=[motorW,motorH,motorW], y=119（中心）, material=MAT.black }',
      name: 'root 的名稱（預設 z-theta-spindle）',
    },
    usage: "import { zThetaSpindle } from '@core/models/motion.js';\nconst zt = zThetaSpindle.create(); 站的主軸群組.add(zt.root);   // 升降與旋轉由站的群組帶動\n// 單獨使用：zt.set({ z: 10, theta: 90 })；zt.shaft、zt.collars、zt.motor 是網格",
  },
  create(p = {}) {
    const meta = zThetaSpindle.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P), spin = partOf(meta, 'spindle'); root.add(spin);
    const so = P.shaft ?? {}, co = part(P.collars), mo = part(P.motor), L = so.length ?? P.shaftL;
    const shaft = cylinder(spin, so.r ?? P.shaftR, L, [0, so.y ?? 6 + L / 2, 0], so.material ?? MAT.alu, 'y', so.segments ?? 32); shaft.name = 'spindle shaft';
    const collars = [];
    if (co) for (const y of co.ys ?? [6, 12, 95]) { const m = cylinder(spin, co.r ?? P.shaftR + .5, co.h ?? 2, [0, y, 0], co.material ?? MAT.black, 'y', co.segments ?? 32); m.name = 'spindle collar'; collars.push(m); }
    let motor = null;
    if (mo) { motor = block(spin, mo.size ?? [P.motorW, P.motorH, P.motorW], [0, mo.y ?? 119, 0], mo.material ?? MAT.black); motor.name = 'spindle motor'; }
    return { root, params: P, spin, shaft, collars, motor, set({ z = 0, theta = 0 } = {}) { spin.position.y = z; spin.rotation.y = theta * D2R; } };
  },
};

// ---------------------------------------------------------------- 伺服鎖付軸（馬達本體＋旋轉套筒）
// 原點：套筒下端中心；軸向 +Y。socket 是會轉的群組（套筒＋撥爪），桶蓋等被帶動的東西可以掛在上面。
export const nutrunner = {
  meta: {
    id: 'servo-nutrunner', name: '伺服鎖付軸（含套筒）', category: '運動',
    source: 'ChemicalTankWashing',
    params: {
      bodyR: { value: 55, min: 10, max: 150, step: 1, unit: 'mm', label: '本體半徑' },
      bodyL: { value: 200, min: 40, max: 800, step: 5, unit: 'mm', label: '本體長度' },
      socketR: { value: 44, min: 6, max: 150, step: 1, unit: 'mm', label: '套筒半徑' },
      socketH: { value: 60, min: 10, max: 200, step: 1, unit: 'mm', label: '套筒高' },
    },
    states: { turns: { value: 0, min: 0, max: 2.5, label: '套筒轉數（圈）' } },
    options: {
      bodyY: '本體中心的 Y（預設 20＋bodyL/2）', segments: '本體圓周分段（預設 28）', socketSegments: '套筒圓周分段（預設 18）',
      lugs: 'false 不畫；{ count=4, size=[8,50,14] }：套筒外圈的撥爪',
      bodyMaterial: '預設 MAT.black', socketMaterial: '預設 MAT.steel', lugMaterial: '預設 MAT.black',
      name: 'root 的名稱（預設 servo-nutrunner）',
    },
    usage: "import { nutrunner } from '@core/models/motion.js';\nconst n = nutrunner.create({ socketR: 蓋半徑 + 8 }); n.root.position.set(x, 0, 0); zAxis.add(n.root);\nn.set({ turns: 2.5 });   // 或直接轉 n.socket.rotation.y；n.body、n.socketMesh、n.lugs 是網格",
  },
  create(p = {}) {
    const meta = nutrunner.meta, P = { ...defaults(meta), segments: 28, socketSegments: 18, ...p };
    const root = rootOf(meta, P), r = P.socketR, lo = part(P.lugs);
    const body = cylinder(root, P.bodyR, P.bodyL, [0, P.bodyY ?? 20 + P.bodyL / 2, 0], P.bodyMaterial ?? MAT.black, 'y', P.segments); body.name = 'nutrunner body';
    const socket = partOf(meta, 'nutrunner socket'); root.add(socket);
    const socketMesh = cylinder(socket, r, P.socketH, [0, P.socketH / 2, 0], P.socketMaterial ?? MAT.steel, 'y', P.socketSegments); socketMesh.name = 'nutrunner socket';
    const lugs = [];
    if (lo) { const n = lo.count ?? 4; for (let i = 0; i < n; i++) { const m = block(socket, lo.size ?? [8, 50, 14], [r * Math.cos(i * Math.PI * 2 / n), P.socketH / 2, r * Math.sin(i * Math.PI * 2 / n)], P.lugMaterial ?? MAT.black); m.name = 'nutrunner lug'; lugs.push(m); } }
    return { root, params: P, body, socket, socketMesh, lugs, set(v) { socket.rotation.y = (+amount(v, 'turns') || 0) * Math.PI * 2; } };
  },
};

// ---------------------------------------------------------------- 平行夾爪（本體＋導軌＋兩個滑座，可帶標準手指）
// 原點：安裝面（法蘭面）中心。axis 是工具前進方向（預設 '+z'），open 是開合方向（預設 'x'）；另一軸是厚度方向。
// 尺寸都以 [開合方向, 厚度方向, 工具軸方向] 表示。fingers 是兩個會動的群組（userData.side＝−1／+1），自製的指墊、夾指加在群組裡。
// set({ width })：兩滑座中心距的一半＝width/2＋jawU/2＋pad（pad：指墊厚，width 就是兩指墊內側的距離）。
export const parallelGripper = {
  meta: {
    id: 'parallel-gripper', name: '平行夾爪（電動／氣動）', category: '夾持',
    source: 'AutomaticAcid-BaseTitration、shutter assembly',
    params: {
      bodyU: { value: 180, min: 10, max: 400, step: 1, unit: 'mm', label: '本體寬（開合方向）' },
      bodyV: { value: 70, min: 6, max: 200, step: 1, unit: 'mm', label: '本體厚' },
      bodyW: { value: 80, min: 6, max: 300, step: 1, unit: 'mm', label: '本體高（工具軸方向）' },
      bodyOffset: { value: 10, min: 0, max: 100, step: 1, unit: 'mm', label: '安裝面到本體的距離' },
      jawU: { value: 12, min: 2, max: 60, step: .5, unit: 'mm', label: '滑座寬（開合方向）' },
      jawV: { value: 34, min: 2, max: 120, step: 1, unit: 'mm', label: '滑座厚' },
      jawW: { value: 16, min: 2, max: 60, step: 1, unit: 'mm', label: '滑座高' },
      maxWidth: { value: 160, min: 2, max: 300, step: 1, unit: 'mm', label: '最大開口' },
    },
    states: { width: { value: 100, min: 0, max: 160, unit: 'mm', label: '開口' } },
    options: {
      axis: "工具前進方向 '+z'（預設）、'-y'… ", open: "開合方向 'x'（預設）／'y'／'z'",
      bodyMaterial: '本體材質（預設 MAT.steelDark）',
      rail: 'false 不畫；{ size=[bodyU−20, bodyV+4, 8], w（中心，預設 bodyOffset＋bodyW−5）, material=MAT.steelDark }：滑座導軌',
      jaw: '{ size=[jawU,jawV,jawW], w（中心，預設貼在本體端面外）, material=MAT.steelDark }',
      finger: 'false 不畫；{ size=[jawU, jawV−6, 94], w（中心，預設接在滑座外）, material=MAT.black }：標準手指',
      pad: '指墊厚（預設 0）', width: '建立時的開口（預設 100）',
      name: 'root 的名稱（預設 parallel-gripper）',
    },
    usage: "import { parallelGripper } from '@core/models/motion.js';\nconst grip = parallelGripper.create({ pad: 3 }); arm.mount.add(grip.root);   // 安裝座 +Z 朝工具\nfor (const f of grip.fingers) block(f, 指墊尺寸, 位置, 橡膠);   // 自製指墊加在手指群組（f.userData.side）\ngrip.set({ width: 60 });   // grip.body、grip.rail、grip.jaws、grip.fingerMeshes 是網格；grip.width 目前開口",
  },
  create(p = {}) {
    const meta = parallelGripper.meta, P = { ...defaults(meta), axis: '+z', open: 'x', pad: 0, ...p };
    const root = rootOf(meta, P);
    const wi = AX[P.axis.at(-1)], ws = P.axis[0] === '-' ? -1 : 1, ui = AX[P.open], vi = 3 - wi - ui;
    const at = (u, v, w) => { const a = [0, 0, 0]; a[ui] = u; a[vi] = v; a[wi] = ws * w; return a; };
    const sz = ([u, v, w]) => { const a = [0, 0, 0]; a[ui] = u; a[vi] = v; a[wi] = w; return a; };
    const body = block(root, sz([P.bodyU, P.bodyV, P.bodyW]), at(0, 0, P.bodyOffset + P.bodyW / 2), P.bodyMaterial ?? MAT.steelDark); body.name = 'gripper body';
    const ra = part(P.rail), jo = P.jaw ?? {}, fo = part(P.finger);
    let rail = null;
    if (ra) { rail = block(root, sz(ra.size ?? [P.bodyU - 20, P.bodyV + 4, 8]), at(0, 0, ra.w ?? P.bodyOffset + P.bodyW - 5), ra.material ?? MAT.steelDark); rail.name = 'gripper rail'; }
    const jawSize = jo.size ?? [P.jawU, P.jawV, P.jawW], jawW = jo.w ?? P.bodyOffset + P.bodyW + jawSize[2] / 2;
    const fingers = [], jaws = [], fingerMeshes = [];
    for (const s of [-1, 1]) {
      const f = partOf(meta, 'gripper finger'); root.add(f); f.userData.cableHost = false;   // 夾指改掛到站的群組後仍會開合：不當線夾固定面
      const j = block(f, sz(jawSize), at(0, 0, jawW), jo.material ?? MAT.steelDark); j.name = 'gripper jaw'; jaws.push(j);
      if (fo) {
        const size = fo.size ?? [P.jawU, P.jawV - 6, 94];
        const m = block(f, sz(size), at(0, 0, fo.w ?? jawW + jawSize[2] / 2 + size[2] / 2), fo.material ?? MAT.black); m.name = 'gripper finger'; fingerMeshes.push(m);
      }
      f.userData.side = s; fingers.push(f);
    }
    let width = 0;
    function set(v) {
      width = THREE.MathUtils.clamp(+amount(v, 'width') || 0, 0, P.maxWidth);
      for (const f of fingers) f.position.setComponent(ui, f.userData.side * (width / 2 + P.jawU / 2 + P.pad));
    }
    set(P.width ?? meta.states.width.value);
    return { root, params: P, body, rail, fingers, jaws, fingerMeshes, set, get width() { return width; } };
  },
};

// ---------------------------------------------------------------- 真空發生器（倒角外殼）
// 原點：機身中心。
export const vacuumEjector = {
  meta: {
    id: 'vacuum-ejector', name: '真空發生器', category: '氣動',
    source: 'RecycleSorter',
    params: {
      w: { value: 80, min: 20, max: 200, step: 1, unit: 'mm', label: '寬（X）' },
      h: { value: 44, min: 10, max: 150, step: 1, unit: 'mm', label: '高（Y）' },
      d: { value: 54, min: 10, max: 150, step: 1, unit: 'mm', label: '深（Z）' },
      bevel: { value: 6, min: 0, max: 15, step: 1, unit: 'mm', label: '倒角（0 為方塊）' },
    },
    options: { material: '機身材質（預設 MAT.steelBlue）', name: 'root 的名稱（預設 vacuum-ejector）' },
    usage: "import { vacuumEjector } from '@core/models/motion.js';\nconst ej = vacuumEjector.create(); ej.root.position.set(x, y, z); tool.add(ej.root);   // ej.body 是網格",
  },
  create(p = {}) {
    const meta = vacuumEjector.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P), mat = P.material ?? MAT.steelBlue;
    const body = P.bevel > 0 ? housing(root, P.w, P.h, P.d, mat, 0, 0, 0, P.bevel) : block(root, [P.w, P.h, P.d], [0, 0, 0], mat);
    body.name = 'ejector body';
    return { root, params: P, body };
  },
};

// ---------------------------------------------------------------- 電磁閥（單體）
// 原點：機身中心。
export const solenoidValve = {
  meta: {
    id: 'solenoid-valve', name: '電磁閥', category: '氣動',
    source: 'RecycleSorter',
    params: {
      w: { value: 60, min: 10, max: 200, step: 1, unit: 'mm', label: '寬（X）' },
      h: { value: 34, min: 10, max: 150, step: 1, unit: 'mm', label: '高（Y）' },
      d: { value: 40, min: 10, max: 150, step: 1, unit: 'mm', label: '深（Z）' },
    },
    options: { material: '機身材質（預設 MAT.black）', name: 'root 的名稱（預設 solenoid-valve）' },
    usage: "import { solenoidValve } from '@core/models/motion.js';\nconst v = solenoidValve.create(); v.root.position.set(x, y, z); tool.add(v.root);   // v.body 是網格",
  },
  create(p = {}) {
    const meta = solenoidValve.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P);
    const body = block(root, [P.w, P.h, P.d], [0, 0, 0], P.material ?? MAT.black); body.name = 'valve body';
    return { root, params: P, body };
  },
};

// ---------------------------------------------------------------- 浮動桿（氣壓緩衝桿：外套＋伸縮桿）
// 原點：上端安裝面中心；桿朝本地 −Y。plunger 是會動的群組（吸盤橫桿等裝在上面），set({ float }) 讓它往 −Y 退 float mm。
export const floatRod = {
  meta: {
    id: 'float-rod', name: '浮動桿（氣壓緩衝）', category: '氣動',
    source: 'RecycleSorter',
    params: {
      sleeveR: { value: 22, min: 5, max: 80, step: 1, unit: 'mm', label: '外套半徑' },
      sleeveL: { value: 150, min: 20, max: 600, step: 5, unit: 'mm', label: '外套長度' },
      rodR: { value: 14, min: 2, max: 60, step: 1, unit: 'mm', label: '伸縮桿半徑' },
      rodL: { value: 200, min: 20, max: 800, step: 5, unit: 'mm', label: '伸縮桿長度' },
    },
    states: { float: { value: 0, min: 0, max: 80, unit: 'mm', label: '浮動量（往 −Y）' } },
    options: {
      sleeveY: '外套中心的 Y（預設 −27−sleeveL/2）', rodY: '伸縮桿中心的 Y（預設 −37−rodL/2）',
      sleeveSegments: '預設 22', rodSegments: '預設 20',
      sleeveMaterial: '預設 MAT.alu', rodMaterial: '預設 MAT.chrome',
      name: 'root 的名稱（預設 float-rod）',
    },
    usage: "import { floatRod } from '@core/models/motion.js';\nconst fr = floatRod.create(); tool.add(fr.root);\nfr.plunger.add(吸盤橫桿);   // 會動的群組\nfr.set({ float: 30 });     // plunger.position.y = −30；fr.sleeve、fr.rod 是網格",
  },
  create(p = {}) {
    const meta = floatRod.meta, P = { ...defaults(meta), sleeveSegments: 22, rodSegments: 20, ...p };
    const root = rootOf(meta, P);
    const sleeve = cylinder(root, P.sleeveR, P.sleeveL, [0, P.sleeveY ?? -27 - P.sleeveL / 2, 0], P.sleeveMaterial ?? MAT.alu, 'y', P.sleeveSegments); sleeve.name = 'float sleeve';
    const plunger = partOf(meta, 'float plunger'); root.add(plunger);
    const rod = cylinder(plunger, P.rodR, P.rodL, [0, P.rodY ?? -37 - P.rodL / 2, 0], P.rodMaterial ?? MAT.chrome, 'y', P.rodSegments); rod.name = 'float rod';
    return { root, params: P, sleeve, plunger, rod, set(v) { plunger.position.y = -(+amount(v, 'float') || 0); } };
  },
};

// ---------------------------------------------------------------- 真空吸盤（可一次建多顆）
// 原點：吸盤中心（at 沒給時）；吸附面朝 −Y。topR 小於 r 時是上小下大的喇叭形。
export const suctionCup = {
  meta: {
    id: 'suction-cup', name: '真空吸盤', category: '氣動',
    source: 'RecycleSorter、PCB-CopperAssembly',
    params: {
      r: { value: 21, min: 2, max: 100, step: .5, unit: 'mm', label: '吸附面半徑' },
      h: { value: 8, min: 1, max: 80, step: .5, unit: 'mm', label: '高' },
      topR: { value: 13, min: 1, max: 100, step: .5, unit: 'mm', label: '上端半徑' },
    },
    options: {
      at: '吸盤中心 [[x,y,z],…]（預設一顆在原點）', segments: '圓周分段（預設 20）',
      material: '預設 MAT.black', cupName: "每顆網格的名稱（預設 'suction cup'；傳空字串不命名）",
      name: 'root 的名稱（預設 suction-cup）',
    },
    usage: "import { suctionCup } from '@core/models/motion.js';\nconst cups = suctionCup.create({ at: [[0, 0, -55], [0, 0, 55]] }); cups.root.position.y = -256; plunger.add(cups.root);\n// cups.cups 是網格陣列（名稱 'suction cup'，allow 規則可以用名稱判斷）",
  },
  create(p = {}) {
    const meta = suctionCup.meta, P = { ...defaults(meta), segments: 20, ...p };
    const root = rootOf(meta, P), cups = [];
    for (const at of P.at ?? [[0, 0, 0]]) { const m = cylinder(root, P.r, P.h, at, P.material ?? MAT.black, 'y', P.segments, P.topR); m.name = P.cupName ?? 'suction cup'; cups.push(m); }
    return { root, params: P, cups };
  },
};

// ---------------------------------------------------------------- FRL 三點組（過濾、調壓、給油）＋壓力表
// 原點：中間那一顆的頭部中心；各顆沿 X 排列，杯朝 −Y，壓力表朝 +Z。
// 組成（都可以關掉）：整體的背板或本體（body）、每顆的頭部（head）與杯（bowl）、壓力表（gauge：圓柱，軸向 Z）。
export const frl = {
  meta: {
    id: 'frl-unit', name: 'FRL 三點組（含壓力表）', category: '氣動',
    source: 'RecycleSorter、MilitaryGradePC',
    params: {
      units: { value: 3, min: 1, max: 4, step: 1, label: '顆數' },
      pitch: { value: 45, min: 20, max: 120, step: 1, unit: 'mm', label: '間距' },
      bowlR: { value: 17, min: 5, max: 50, step: 1, unit: 'mm', label: '杯半徑' },
      bowlH: { value: 84, min: 20, max: 200, step: 1, unit: 'mm', label: '杯高' },
    },
    options: {
      body: 'false 不畫；{ size=[150,18,28], at=[0,10,−10], material=MAT.steelDark }：背板或一體式本體',
      head: 'false 不畫；{ size=[36,28,36], material=MAT.steelBlue }：每顆的頭部（中心在原點那一排）',
      bowl: '{ y=−50（中心）, z=0, segments=18, material=MAT.alu }',
      gauge: 'false 不畫；{ r=24, t=12, at=[0,3,26], segments=24, material=MAT.cap }',
      name: 'root 的名稱（預設 frl-unit）',
    },
    usage: "import { frl } from '@core/models/motion.js';\nconst unit = frl.create(); unit.root.position.set(x, y, z); scene.add(unit.root);\n// unit.body、unit.heads、unit.bowls、unit.gauge 是網格",
  },
  create(p = {}) {
    const meta = frl.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P);
    const bo = part(P.body), ho = part(P.head), wo = P.bowl ?? {}, go = part(P.gauge);
    let body = null, gauge = null;
    if (bo) { body = block(root, bo.size ?? [150, 18, 28], bo.at ?? [0, 10, -10], bo.material ?? MAT.steelDark); body.name = 'frl body'; }
    const heads = [], bowls = [];
    for (let i = 0; i < P.units; i++) {
      const x = (i - (P.units - 1) / 2) * P.pitch;
      const b = cylinder(root, P.bowlR, P.bowlH, [x, wo.y ?? -50, wo.z ?? 0], wo.material ?? MAT.alu, 'y', wo.segments ?? 18); b.name = 'frl bowl'; bowls.push(b);
      if (ho) { const h = block(root, ho.size ?? [36, 28, 36], [x, 0, 0], ho.material ?? MAT.steelBlue); h.name = 'frl head'; heads.push(h); }
    }
    if (go) { gauge = cylinder(root, go.r ?? 24, go.t ?? 12, go.at ?? [0, 3, 26], go.material ?? MAT.cap, 'z', go.segments ?? 24); gauge.name = 'frl gauge'; }
    return { root, params: P, body, heads, bowls, gauge };
  },
};

// ---------------------------------------------------------------- 旋轉編碼器（機身＋出軸）
// 原點：機身中心；出軸沿 axis（預設 +Z），後段插在機身裡。
export const rotaryEncoder = {
  meta: {
    id: 'rotary-encoder', name: '旋轉編碼器', category: '感測與安全',
    source: 'RecycleSorter',
    params: {
      bodyR: { value: 30, min: 8, max: 80, step: 1, unit: 'mm', label: '機身半徑' },
      bodyL: { value: 70, min: 10, max: 200, step: 1, unit: 'mm', label: '機身長度' },
      shaftR: { value: 12, min: 2, max: 40, step: 1, unit: 'mm', label: '出軸半徑' },
      shaftL: { value: 60, min: 5, max: 200, step: 1, unit: 'mm', label: '出軸長度' },
    },
    options: {
      axis: "軸向 'z'（預設）／'x'／'y'", shaftAt: '出軸中心離機身中心的距離（預設 bodyL/2＋shaftL/2−15）',
      bodySegments: '預設 20', shaftSegments: '預設 16', bodyMaterial: '預設 MAT.black', shaftMaterial: '預設 MAT.chrome',
      name: 'root 的名稱（預設 rotary-encoder）',
    },
    usage: "import { rotaryEncoder } from '@core/models/motion.js';\nconst enc = rotaryEncoder.create(); enc.root.position.set(x, y, z); scene.add(enc.root);   // enc.body、enc.shaft 是網格",
  },
  create(p = {}) {
    const meta = rotaryEncoder.meta, P = { ...defaults(meta), axis: 'z', bodySegments: 20, shaftSegments: 16, ...p };
    const root = rootOf(meta, P), i = AX[P.axis];
    const body = cylinder(root, P.bodyR, P.bodyL, [0, 0, 0], P.bodyMaterial ?? MAT.black, P.axis, P.bodySegments); body.name = 'encoder body';
    const shaft = cylinder(root, P.shaftR, P.shaftL, unit(i, P.shaftAt ?? P.bodyL / 2 + P.shaftL / 2 - 15), P.shaftMaterial ?? MAT.chrome, P.axis, P.shaftSegments); shaft.name = 'encoder shaft';
    return { root, params: P, body, shaft };
  },
};

// ---------------------------------------------------------------- 抽屜滑軌（一對）
// 原點：兩支外軌中間、外軌中心；長邊沿 Z，兩支沿 X 相距 span（中心距）。內軌（inner）往 +Z 拉出，set({ ext }) 0～1。
export const drawerSlide = {
  meta: {
    id: 'drawer-slide', name: '抽屜滑軌（一對）', category: '運動',
    source: 'shutter assembly',
    params: {
      length: { value: 400, min: 100, max: 1500, step: 10, unit: 'mm', label: '外軌長度' },
      w: { value: 12, min: 4, max: 40, step: 1, unit: 'mm', label: '外軌寬（X）' },
      h: { value: 14, min: 6, max: 80, step: 1, unit: 'mm', label: '外軌高（Y）' },
      span: { value: 300, min: 40, max: 1500, step: 10, unit: 'mm', label: '兩支的中心距' },
    },
    states: { ext: { value: 0, min: 0, max: 1, label: '拉出（0～1）' } },
    options: {
      material: '外軌材質（預設 MAT.black）',
      inner: 'false 不畫；{ w=w−4, h=h−4, length=length−10, travel=length×0.8, material=MAT.steel }：內軌',
      name: 'root 的名稱（預設 drawer-slide）',
    },
    usage: "import { drawerSlide } from '@core/models/motion.js';\nconst slides = drawerSlide.create({ length: 840, span: 346 }); slides.root.position.set(x, y, z); scene.add(slides.root);\nslides.set({ ext: 1 });   // slides.outers、slides.inners 是網格，slides.inner 是會動的群組",
  },
  create(p = {}) {
    const meta = drawerSlide.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P), io = part(P.inner);
    const inner = io ? partOf(meta, 'slide inner') : null; if (inner) root.add(inner);
    const outers = [], inners = [];
    for (const s of [-1, 1]) {
      const m = block(root, [P.w, P.h, P.length], [s * (P.span / 2), 0, 0], P.material ?? MAT.black); m.name = 'slide outer'; outers.push(m);
      if (io) { const n = block(inner, [io.w ?? P.w - 4, io.h ?? P.h - 4, io.length ?? P.length - 10], [s * (P.span / 2), 0, 0], io.material ?? MAT.steel); n.name = 'slide inner'; inners.push(n); }
    }
    const travel = io ? io.travel ?? P.length * .8 : 0;
    return { root, params: P, outers, inner, inners, set(v) { if (inner) inner.position.z = clamp01(amount(v, 'ext')) * travel; } };
  },
};

// ---------------------------------------------------------------- 門互鎖開關（安全門開關本體＋致動片）
// 原點：本體中心。致動片（actuator）裝在門上、插進本體頂面，可以不畫。
export const doorSwitch = {
  meta: {
    id: 'door-switch', name: '門互鎖開關', category: '感測與安全',
    source: 'shutter assembly、RobotArmPressSSD',
    params: {
      w: { value: 60, min: 20, max: 200, step: 1, unit: 'mm', label: '寬（X）' },
      h: { value: 22, min: 10, max: 200, step: 1, unit: 'mm', label: '高（Y）' },
      d: { value: 30, min: 10, max: 100, step: 1, unit: 'mm', label: '深（Z）' },
    },
    options: {
      material: '本體材質（預設 MAT.black）',
      actuator: 'false 不畫；{ size=[w×0.4, 10, d×0.5], at（預設插進頂面 2 mm）, material=MAT.steel }：致動片',
      name: 'root 的名稱（預設 door-switch）',
    },
    usage: "import { doorSwitch } from '@core/models/motion.js';\nconst sw = doorSwitch.create(); sw.root.position.set(x, y, z); scene.add(sw.root);   // sw.body、sw.actuator 是網格",
  },
  create(p = {}) {
    const meta = doorSwitch.meta, P = { ...defaults(meta), ...p };
    const root = rootOf(meta, P), ao = part(P.actuator);
    const body = block(root, [P.w, P.h, P.d], [0, 0, 0], P.material ?? MAT.black); body.name = 'door switch body';
    let actuator = null;
    if (ao) { actuator = block(root, ao.size ?? [P.w * .4, 10, P.d * .5], ao.at ?? [0, P.h / 2 + 3, 0], ao.material ?? MAT.steel); actuator.name = 'door switch actuator'; }
    return { root, params: P, body, actuator };
  },
};

// ---------------------------------------------------------------- 荷重元（圓柱型）
// 原點：機身中心；受力方向 Y。受力鈕（button）在頂面，可以不畫。
export const loadCell = {
  meta: {
    id: 'load-cell', name: '荷重元（圓柱型）', category: '感測與安全',
    source: 'ChemicalTankWashing、shutter assembly',
    params: {
      r: { value: 35, min: 4, max: 150, step: 1, unit: 'mm', label: '半徑' },
      h: { value: 50, min: 3, max: 200, step: 1, unit: 'mm', label: '高' },
    },
    options: {
      segments: '圓周分段（預設 28）', material: '機身材質（預設 MAT.steelBlue）',
      button: 'false 不畫；{ r=r×0.35, h=6, material=MAT.steel }：頂面的受力鈕（埋入 1 mm）',
      name: 'root 的名稱（預設 load-cell）',
    },
    usage: "import { loadCell } from '@core/models/motion.js';\nconst lc = loadCell.create(); lc.root.position.set(x, y, z); scene.add(lc.root);   // lc.body、lc.button 是網格",
  },
  create(p = {}) {
    const meta = loadCell.meta, P = { ...defaults(meta), segments: 28, ...p };
    const root = rootOf(meta, P), bo = part(P.button);
    const body = cylinder(root, P.r, P.h, [0, 0, 0], P.material ?? MAT.steelBlue, 'y', P.segments); body.name = 'load cell';
    let button = null;
    if (bo) { const bh = bo.h ?? 6; button = cylinder(root, bo.r ?? P.r * .35, bh, [0, P.h / 2 + bh / 2 - 1, 0], bo.material ?? MAT.steel, 'y', P.segments); button.name = 'load cell button'; }
    return { root, params: P, body, button };
  },
};

// 本檔的模型清單（登記到 core/models/index.js 用）
export const MOTION_MODELS = [airCylinder, pivotCylinder, slideTable, linearAxis, zThetaSpindle, nutrunner, parallelGripper,
  vacuumEjector, solenoidValve, floatRod, suctionCup, frl, rotaryEncoder, drawerSlide, doorSwitch, loadCell];
