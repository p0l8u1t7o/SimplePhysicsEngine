// 專用設備與周邊的市購品（三）製程設備：貼標機、翻桶機、秤重顯示器、風刀、沖洗噴槍、熱風機、真空泵、PE 儲槽、
// 離心泵、氣動隔膜泵、切換閥、清運接頭。原用於 ChemicalTankWashing（200 L 化學桶清洗線）。
// 幾何、分段數、位置與材質都能用參數重現該站原樣（換用對照見 core/migrations/1.10.0-equipment.md）；尺寸是示意，不是原廠 CAD。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、標示文字、子物件設定）。外部傳入的材質原樣使用。
import * as THREE from 'three';
import { block, cylinder, plate } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { flange } from '../geom/hardware.js';
import { defaults } from './util.js';

const group = (name, id) => { const g = new THREE.Group(); g.name = name; g.userData.coreModel = id; return g; };
// 直立標示牌（shapes.js 的 plate）：L 是 { lines, w, h, pos, rotY, options }，沒給的欄位用模型的預設；沒有 DOM 時回傳 null
const addPlate = (root, L, d) => L ? plate(root, L.lines ?? d.lines, L.w ?? d.w, L.h ?? d.h, L.pos ?? d.pos, L.rotY ?? d.rotY ?? 0, L.options ?? d.options ?? {}) : null;
const Yv = new THREE.Vector3(0, 1, 0), Zv = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- 貼標機（印字貼標頭，往 −Z 推出貼附）
// 原點：機櫃旁的地面基準點（機櫃中心在 z +200）；貼標頭沿 −Z 推出，貼附中心高度 applyY。
// set({ pad: 0～1, print })：pad 是推出比例（× stroke），print > .5 時貼標頭上有標籤。
export const labeler = {
  meta: {
    id: 'labeler', name: '貼標機（印字貼標頭）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {
      applyY: { value: 800, min: 400, max: 1300, step: 10, unit: 'mm', label: '貼附中心高度' },
      stroke: { value: 430, min: 50, max: 700, step: 10, unit: 'mm', label: '貼標頭行程' },
    },
    states: {
      pad: { value: 0, min: 0, max: 1, label: '貼標頭推出' },
      print: { value: 0, min: 0, max: 1, step: 1, label: '貼標頭上有標籤' },
    },
    options: { labelMaterial: '標籤與標籤捲的材質（預設 MAT.cap）', name: 'root 的名稱（預設 labeler）' },
    usage: "import { labeler } from '@core/models/equipment-process.js';\nconst lb = labeler.create({ applyY: 桶軸高度, stroke }); lb.root.position.set(x, 0, 機台基準 z); parent.add(lb.root);\nlb.set({ pad: 1, print: 1 });   // lb.pad 是貼標頭群組，lb.padLabel 是頭上的標籤（網格）",
  },
  create(p = {}) {
    const P = { ...defaults(labeler.meta), ...p };
    const st = group(P.name ?? 'labeler', 'labeler'), paper = P.labelMaterial ?? MAT.cap;
    block(st, [600, 900, 500], [0, 450, 200], MAT.cabinet);
    block(st, [560, 420, 440], [0, 1110, 160], MAT.steelDark);                                  // 印字引擎
    const screen = block(st, [30, 250, 300], [290, 1150, 160], MAT.screen);
    cylinder(st, 120, 80, [-200, 1200, 340], paper, 'x', 28);                                   // 標籤捲
    const rail = block(st, [80, 60, 480], [0, P.applyY, -120], MAT.alu);
    const pad = new THREE.Group(); pad.name = 'labeler pad'; st.add(pad);
    block(pad, [140, 180, 30], [0, P.applyY, 0], MAT.black);
    const padLabel = block(pad, [100, 150, 4], [0, P.applyY, -17], paper); padLabel.visible = false;
    function set({ pad: k, print } = {}) {
      if (k !== undefined) pad.position.set(0, 0, -120 - k * P.stroke);
      if (print !== undefined) padLabel.visible = print > .5;
    }
    return { root: st, params: P, screen, rail, pad, padLabel, set };
  },
};

// ---------------------------------------------------------------- 翻桶機（L 形搖籃，側置液壓缸）
// 原點：翻轉軸正下方的地面；翻轉軸沿 Z、高 pivotY。搖籃 tilt 0 時床面朝 −X 平放（桶橫躺），tilt 1 時翻 90° 立起。
// 桶半徑 drumR、含滾箍的外半徑 envelopeR 決定托墊高度與夾板位置。
// set({ tilt: 0～1, clamp: 0～1 })：clamp 1 夾緊（夾板貼到外半徑＋15）。
export const upender = {
  meta: {
    id: 'upender', name: '翻桶機（200 L 桶，L 形搖籃）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {
      pivotY: { value: 507.5, min: 300, max: 900, step: 2.5, unit: 'mm', label: '翻轉軸高度' },
      drumR: { value: 292.5, min: 150, max: 400, step: 2.5, unit: 'mm', label: '桶身半徑' },
      envelopeR: { value: 298, min: 150, max: 420, step: 1, unit: 'mm', label: '桶外半徑（含滾箍）' },
    },
    states: {
      tilt: { value: 0, min: 0, max: 1, label: '翻轉（0 橫躺、1 直立）' },
      clamp: { value: 0, min: 0, max: 1, label: '夾板夾緊' },
    },
    options: { name: 'root 的名稱（預設 upender）' },
    usage: "import { upender } from '@core/models/equipment-process.js';\nconst up = upender.create({ pivotY, drumR, envelopeR }); up.root.position.set(軸 x, 0, 軸 z); parent.add(up.root);\nup.set({ tilt: 1, clamp: 1 });   // up.cradle（搖籃群組，桶跟著它）、up.actuator、up.piston、up.clamps = [{ c, s }]",
  },
  create(p = {}) {
    const P = { ...defaults(upender.meta), ...p };
    const root = group(P.name ?? 'upender', 'upender'), uy = P.pivotY, R = P.drumR, ER = P.envelopeR;
    block(root, [1600, 220, 900], [-300, 110, 0], MAT.steelDark);
    for (const s of [-1, 1]) cylinder(root, 90, 120, [0, uy, s * 420], MAT.steelBlue, 'z', 28);
    for (const s of [-1, 1]) block(root, [120, uy, 120], [0, uy / 2, s * 420], MAT.steelBlue);
    const cradle = new THREE.Group(); cradle.name = 'upender cradle'; cradle.position.set(0, uy, 0); root.add(cradle);
    block(cradle, [1000, 40, 640], [-500, -27, 0], MAT.steel);                                   // 床面（桶身下方）
    // 兩條窄墊塊與桶外環相切，不插入桶身
    const supportZ = 230, supportHalf = 12;
    const supportTop = R - Math.sqrt(ER ** 2 - (supportZ - supportHalf) ** 2);
    const pads = [];
    for (const s of [-1, 1]) pads.push(block(cradle, [980, 30, supportHalf * 2], [-500, supportTop - 15, s * supportZ], MAT.pu));
    block(cradle, [40, 640, 760], [82, 320, 0], MAT.steel);                                      // 桶底靠板（翻後成為承載面）
    for (let k = 0; k < 4; k++) cylinder(cradle, 30, 700, [30, 80 + k * 150, 0], MAT.roller, 'z', 12);
    const clamps = [];
    for (const s of [-1, 1]) { const c = block(cradle, [700, 160, 30], [-500, R, s * (R + 60)], MAT.yellow); clamps.push({ c, s }); }
    // 側置液壓缸：活塞端隨搖籃轉動，避開桶與床面
    const actuator = new THREE.Group(); actuator.name = 'upender actuator'; root.add(actuator);
    cylinder(actuator, 46, 420, [0, 210, 0], MAT.steelDark, 'y', 28);
    const piston = cylinder(actuator, 24, 1, [0, 420, 0], MAT.steel, 'y', 28);
    const anchor = new THREE.Vector3(-800, 230, -570), pivot = new THREE.Vector3(0, uy, 0);
    cylinder(root, 65, 110, [anchor.x, anchor.y, anchor.z], MAT.steelDark, 'z', 28);
    function pose(t) {
      cradle.rotation.z = -t * Math.PI / 2;
      const end = new THREE.Vector3(-450, -85, -570).applyAxisAngle(Zv, -t * Math.PI / 2).add(pivot);
      const delta = end.clone().sub(anchor), length = delta.length(); actuator.position.copy(anchor);
      actuator.quaternion.setFromUnitVectors(Yv, delta.normalize()); piston.scale.y = length - 350; piston.position.y = 350 + (length - 350) / 2;
    }
    function set({ tilt, clamp } = {}) {
      if (tilt !== undefined) pose(tilt);
      if (clamp !== undefined) for (const { c, s } of clamps) c.position.z = s * (ER + 15 + (1 - clamp) * 110);
    }
    pose(0);                                                                                     // 液壓缸先接到搖籃上（夾板維持建立時的位置）
    return { root, params: P, cradle, pads, clamps, actuator, piston, anchor, set };
  },
};

// ---------------------------------------------------------------- 秤重顯示器（立柱式）
// 原點：立柱底面中心（地面）；顯示面板薄邊沿 X（面朝 ±X）。set({ on })：秤重中面板換成亮燈材質。
export const weighIndicator = {
  meta: {
    id: 'weigh-indicator', name: '秤重顯示器（立柱式）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {
      height: { value: 1150, min: 600, max: 1800, step: 10, unit: 'mm', label: '面板中心高度' },
    },
    states: { on: { value: 0, min: 0, max: 1, step: 1, label: '秤重中' } },
    options: {
      size: '面板 [厚, 高, 寬]（預設 [40, 200, 320]）', post: '立柱 [邊長, 高]（預設 [60, 1050]）',
      onMaterial: '秤重中的面板材質（預設 MAT.green）', offMaterial: '平時的面板材質（預設 MAT.screen）',
      name: 'root 的名稱（預設 weigh-indicator）',
    },
    usage: "import { weighIndicator } from '@core/models/equipment-process.js';\nconst w = weighIndicator.create(); w.root.position.set(x, 0, z); parent.add(w.root);\nw.set({ on: true });   // w.screen 是面板（材質在 on／off 兩個之間換）",
  },
  create(p = {}) {
    const P = { ...defaults(weighIndicator.meta), ...p };
    const root = group(P.name ?? 'weigh-indicator', 'weigh-indicator');
    const [t, h, w] = P.size ?? [40, 200, 320], [ps, ph] = P.post ?? [60, 1050], on = P.onMaterial ?? MAT.green, off = P.offMaterial ?? MAT.screen;
    const screen = block(root, [t, h, w], [0, P.height, 0], off);
    const post = block(root, [ps, ph, ps], [0, ph / 2, 0], MAT.steelDark);
    function set(v) { if (v !== null && typeof v === 'object') v = v.on; screen.material = v ? on : off; }
    return { root, params: P, screen, post, set };
  },
};

// ---------------------------------------------------------------- 風刀（直立，往側面吹）
// 原點：刀體中心；刀體直立（長邊沿 Y），氣流面往 side（±X）吹出 jet 的距離。氣流面是效果（userData.fx）。
export const airKnife = {
  meta: {
    id: 'air-knife', name: '風刀（直立）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {
      length: { value: 1700, min: 200, max: 2500, step: 50, unit: 'mm', label: '刀體長度（Y）' },
      jet: { value: 380, min: 100, max: 1000, step: 10, unit: 'mm', label: '氣流長度' },
      side: { value: 1, min: -1, max: 1, step: 2, label: '吹出方向（+1：+X，−1：−X）' },
    },
    states: { on: { value: 0, min: 0, max: 1, step: 1, label: '吹氣' } },
    options: {
      body: '刀體截面 [X, Z]（預設 [60, 80]）', jetHeight: '氣流面高度（預設 length−50）',
      material: '刀體材質（預設 MAT.steel）', jetMaterial: '氣流面材質（預設淡藍半透明；每支各自一份）',
      name: 'root 的名稱（預設 air-knife）',
    },
    usage: "import { airKnife } from '@core/models/equipment-process.js';\nconst k = airKnife.create({ side: -1 }); k.root.position.set(x, 中心高度, z); parent.add(k.root);\nk.set({ on: true });   // 或直接改 k.air.visible",
  },
  create(p = {}) {
    const P = { ...defaults(airKnife.meta), ...p };
    const root = group(P.name ?? 'air-knife', 'air-knife'), [bx, bz] = P.body ?? [60, 80];
    const body = block(root, [bx, P.length, bz], [0, 0, 0], P.material ?? MAT.steel);
    const air = new THREE.Mesh(new THREE.PlaneGeometry(P.jet, P.jetHeight ?? P.length - 50),
      P.jetMaterial ?? new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
    air.position.set(P.side * P.jet / 2, 0, 0); air.visible = false; air.userData.fx = true; root.add(air);
    function set(v) { if (v !== null && typeof v === 'object') v = v.on; air.visible = !!v; }
    return { root, params: P, body, air, set };
  },
};

// ---------------------------------------------------------------- 沖洗噴槍（由上方伸入桶內）
// 原點：噴頭底端附近（噴槍管的下端），管往 +Y；整支是一個會動的群組——專案每格直接設 root.position。
// 噴霧（spray）是效果（userData.fx）：type 'cone' 是旋轉噴頭的錐形水霧，'jet' 是直噴水柱。
export const sprayLance = {
  meta: {
    id: 'spray-lance', name: '沖洗噴槍（旋轉噴頭／直噴）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {
      length: { value: 1750, min: 300, max: 2500, step: 50, unit: 'mm', label: '噴槍管長' },
      radius: { value: 16, min: 5, max: 40, step: 1, unit: 'mm', label: '噴槍管半徑' },
    },
    states: { spray: { value: 0, min: 0, max: 1, step: 1, label: '噴洗' } },
    options: {
      segments: '管與噴頭的圓周分段（預設 12）',
      head: '{ r=24, h=60, y=20 }：噴頭（外徑要小於桶口）',
      slider: 'false 不裝；{ size=[140,60,80], pos=[60, length, 0] }：管頂的氣缸滑塊（預設裝）',
      spray: "{ type:'cone', r=240, h=420, segments=24 }（預設）或 { type:'jet', rTop=14, rBottom=22, h=700, segments=10 }",
      sprayMaterial: '噴霧材質（預設 MAT.water 的半透明複本；多支噴槍可共用一份）',
      name: 'root 的名稱（預設 spray-lance）',
    },
    usage: "import { sprayLance } from '@core/models/equipment-process.js';\nconst lance = sprayLance.create(); parent.add(lance.root);\nlance.root.position.set(x, 噴頭高度, z);          // 伸縮：每格直接設位置\nlance.set({ spray: true }); lance.spray.rotation.y = time * 3;   // lance.tube、lance.head 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(sprayLance.meta), ...p };
    const root = group(P.name ?? 'spray-lance', 'spray-lance'), seg = P.segments ?? 12, hd = P.head ?? {}, L = P.length;
    root.userData.cableHost = false;   // root 就是伸縮的群組（站每格移動它）：走線不拿它當線夾固定面
    const tube = cylinder(root, P.radius, L, [0, L / 2, 0], MAT.steel, 'y', seg);
    const so = P.slider === undefined || P.slider === true ? {} : P.slider;
    const slider = so ? block(root, so.size ?? [140, 60, 80], so.pos ?? [60, L, 0], MAT.steelDark) : null;   // 氣缸滑塊
    const head = cylinder(root, hd.r ?? 24, hd.h ?? 60, [0, hd.y ?? 20, 0], MAT.steelDark, 'y', seg);
    let mat = P.sprayMaterial;
    if (!mat) { mat = MAT.water.clone(); mat.opacity = .35; mat.side = THREE.DoubleSide; }
    const sp = P.spray ?? {}, jet = sp.type === 'jet', sh = sp.h ?? (jet ? 700 : 420);
    const spray = new THREE.Mesh(jet ? new THREE.CylinderGeometry(sp.rTop ?? 14, sp.rBottom ?? 22, sh, sp.segments ?? 10, 1, true) : new THREE.ConeGeometry(sp.r ?? 240, sh, sp.segments ?? 24, 1, true), mat);
    spray.position.y = -sh / 2; spray.visible = false; spray.userData.fx = true; root.add(spray);
    function set(v) { if (v !== null && typeof v === 'object') v = v.spray; spray.visible = !!v; }
    return { root, params: P, tube, slider, head, spray, set };
  },
};

// ---------------------------------------------------------------- 屋頂機組：熱風機、真空泵（箱體＋散熱片或百葉＋標示牌）
// 原點：箱體底面中心；標示牌立在箱體上方、朝 −Z。
function boxUnit(id, P, d) {
  const root = group(P.name ?? id, id), [w, h, dp] = P.size ?? d.size;
  const body = block(root, [w, h, dp], [0, h / 2, 0], P.material ?? d.material);
  const fo = P.fins === undefined || P.fins === true ? {} : P.fins, fins = [];
  if (fo) { const f = { ...d.fins, ...fo }; for (let i = 0; i < f.count; i++) fins.push(block(root, f.size, [f.pos[0] + i * (f.step[0] ?? 0), f.pos[1] + i * (f.step[1] ?? 0), f.pos[2]], f.material)); }
  const label = addPlate(root, P.label, d.label);
  return { root, params: P, body, fins, label };
}
export const hotAirBlower = {
  meta: {
    id: 'hot-air-blower', name: '熱風機（鼓風機＋電熱器）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {},
    options: {
      size: '箱體 [寬, 高, 深]（預設 [460, 340, 380]）', material: '箱體材質（預設 MAT.steelOrange）',
      fins: 'false 不裝；{ count=9, size=[5,190,280], pos=[−160,210,0], step=[38,0], material=MAT.steelDark }：機內散熱片（在箱體內，透視時才看得到）',
      label: 'false（預設）；{ lines, w=600, h=120, pos=[0,430,−195], rotY=π, options={ w:640, h:110 } }：直立標示牌',
      name: 'root 的名稱（預設 hot-air-blower）',
    },
    usage: "import { hotAirBlower } from '@core/models/equipment-process.js';\nconst hb = hotAirBlower.create({ label: { lines: ['HB-1 熱風機 70°C'] } }); hb.root.position.set(x, 屋頂面, z); parent.add(hb.root);\n// 熱風出口在箱體頂面中心 [0, 340, 0]",
  },
  create(p = {}) {
    return boxUnit('hot-air-blower', { ...defaults(hotAirBlower.meta), ...p }, {
      size: [460, 340, 380], material: MAT.steelOrange,
      fins: { count: 9, size: [5, 190, 280], pos: [-160, 210, 0], step: [38, 0], material: MAT.steelDark },
      label: { w: 600, h: 120, pos: [0, 430, -195], rotY: Math.PI, options: { w: 640, h: 110 } },
    });
  },
};
export const vacuumPump = {
  meta: {
    id: 'vacuum-pump', name: '真空泵（負壓抽液）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {},
    options: {
      size: '箱體 [寬, 高, 深]（預設 [520, 380, 420]）', material: '箱體材質（預設 MAT.steelBlue）',
      fins: 'false 不裝；{ count=9, size=[400,6,4], pos=[0,80,−213], step=[0,25], material=MAT.black }：−Z 面的百葉',
      label: 'false（預設）；{ lines, w=700, h=120, pos=[0,480,−215], rotY=π, options={ w:640, h:110 } }：直立標示牌',
      name: 'root 的名稱（預設 vacuum-pump）',
    },
    usage: "import { vacuumPump } from '@core/models/equipment-process.js';\nconst vp = vacuumPump.create({ label: { lines: ['VP-1 真空泵'] } }); vp.root.position.set(x, 屋頂面, z); parent.add(vp.root);\n// 吸入口在箱體頂面中心 [0, 380, 0]，排出口在 +X 側面",
  },
  create(p = {}) {
    return boxUnit('vacuum-pump', { ...defaults(vacuumPump.meta), ...p }, {
      size: [520, 380, 420], material: MAT.steelBlue,
      fins: { count: 9, size: [400, 6, 4], pos: [0, 80, -213], step: [0, 25], material: MAT.black },
      label: { w: 700, h: 120, pos: [0, 480, -215], rotY: Math.PI, options: { w: 640, h: 110 } },
    });
  },
};

// ---------------------------------------------------------------- PE 儲槽（立式，含液位、外置視管、人孔與束帶）
// 原點：槽中心軸與地面的交點；槽底在 y = base（防溢堤底板的厚度）。視管、標示牌在 −Z 側。
// set({ level: 0～1 })：液位比例（液量 ÷ 容量）；槽內液面與視管一起變。
export const storageTank = {
  meta: {
    id: 'pe-tank', name: 'PE 儲槽（立式，含液位視管）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {
      radius: { value: 550, min: 200, max: 1200, step: 10, unit: 'mm', label: '槽半徑' },
      height: { value: 1800, min: 600, max: 3000, step: 50, unit: 'mm', label: '槽高' },
      base: { value: 40, min: 0, max: 200, step: 5, unit: 'mm', label: '槽底離地（底板厚）' },
    },
    states: { level: { value: .4, min: 0, max: 1, label: '液位（液量÷容量）' } },
    options: {
      liquidMaterial: '槽內液體的材質（預設 MAT.tankClean）', sightMaterial: '視管內液體的材質（預設同 liquidMaterial）',
      shellMaterial: '槽體材質（預設 MAT.tankW）',
      sightAngle: '視管組（視管、上下接頭、刻度）繞槽軸轉的角度（rad，預設 0＝在 −Z 側）；視管朝向鄰槽或堤牆會相撞時用',
      label: 'false（預設）；{ lines, w=max(700, 1.8·radius), h=230, pos=[0, height+330, −radius−10], rotY=π, options={ w:640, h:210 } }：直立標示牌',
      name: 'root 的名稱（預設 pe-tank）',
    },
    usage: "import { storageTank } from '@core/models/equipment-process.js';\nconst tk = storageTank.create({ radius: 400, height: 1600, label: { lines: ['TK-R 回收水槽', '800 L'] } });\ntk.root.position.set(x, 0, z); parent.add(tk.root);\ntk.set({ level: 液量 / 容量 });   // tk.shell、tk.liquid、tk.sight 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(storageTank.meta), ...p };
    const root = group(P.name ?? 'pe-tank', 'pe-tank'), r = P.radius, h = P.height, b = P.base;
    const liquidMat = P.liquidMaterial ?? MAT.tankClean, sightMat = P.sightMaterial ?? liquidMat;
    const shell = cylinder(root, r, h, [0, b + h / 2, 0], P.shellMaterial ?? MAT.tankW, 'y', 36); shell.castShadow = false;
    cylinder(root, r + 5, 30, [0, b + h + 15, 0], MAT.ppSolid, 'y', 36);                          // 頂蓋環
    const liquid = cylinder(root, r - 25, 1, [0, b + 10, 0], liquidMat, 'y', 32);
    const label = addPlate(root, P.label, { w: Math.max(700, r * 1.8), h: 230, pos: [0, h + b + 290, -r - 10], rotY: Math.PI, options: { w: 640, h: 210 } });
    // 外置液位視管；上下接頭、刻度、人孔、法蘭與束帶
    const sa = P.sightAngle ?? 0, at = (x, y, z) => sa ? [x * Math.cos(sa) + z * Math.sin(sa), y, -x * Math.sin(sa) + z * Math.cos(sa)] : [x, y, z];   // 視管組繞槽軸轉
    const sight = cylinder(root, 12, 1, at(0, b + 40, -r - 18), sightMat, 'y', 10);
    for (const yy of [b + 55, h + b - 60]) cylinder(root, 21, 32, at(0, yy, -r - 18), MAT.steelDark, 'y', 28);
    for (let yy = b + 120; yy < h; yy += 200) block(root, [42, 4, 4], at(33, yy, -r - 17), MAT.black).rotation.y = sa;
    cylinder(root, Math.min(r * .45, 165), 45, [-r * .35, h + b + 35, 0], MAT.ppDark, 'y', 28);    // 人孔
    flange(root, 0, h + b + 15, 0, 58);
    for (const yy of [h * .28, h * .7]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r + 2, 7, 6, 48), MAT.ppDark); band.rotation.x = Math.PI / 2; band.position.set(0, yy + b, 0); root.add(band);
    }
    function set(v) {
      if (v !== null && typeof v === 'object') v = v.level;
      const lh = Math.max(1, v * (h - 40));
      liquid.scale.y = lh; liquid.position.y = b + 10 + lh / 2; sight.scale.y = Math.max(1, lh - 40); sight.position.y = b + 40 + sight.scale.y / 2;
    }
    return { root, params: P, shell, liquid, sight, label, set };
  },
};

// ---------------------------------------------------------------- 泵：多段離心泵、氣動隔膜泵
// 原點：底座（或機身）底面中心；泵軸沿 Z。標示牌立在 +X 側上方、朝 +X。
export const centrifugalPump = {
  meta: {
    id: 'pump-centrifugal', name: '離心泵（多段，臥式）', category: '製程設備', source: 'ChemicalTankWashing',
    params: {},
    options: {
      motorMaterial: '馬達材質（預設 MAT.steelBlue）', headMaterial: '泵頭材質（預設 MAT.ppSolid）',
      label: 'false（預設）；{ lines, w=420, h=110, pos=[130,560,0], rotY=π/2, options={ w:512, h:130 } }：直立標示牌',
      name: 'root 的名稱（預設 pump-centrifugal）',
    },
    usage: "import { centrifugalPump } from '@core/models/equipment-process.js';\nconst pm = centrifugalPump.create({ label: { lines: ['P-1 沖洗泵'] } }); pm.root.position.set(x, 0, z); parent.add(pm.root);\n// 吸入口在泵頭 [0, 300, −160]（−Z 端），吐出口朝上",
  },
  create(p = {}) {
    const P = { ...defaults(centrifugalPump.meta), ...p };
    const root = group(P.name ?? 'pump-centrifugal', 'pump-centrifugal');
    const base = block(root, [250, 120, 500], [0, 60, 0], MAT.steelDark);
    const motor = cylinder(root, 100, 300, [0, 300, 60], P.motorMaterial ?? MAT.steelBlue, 'z', 20);
    const head = cylinder(root, 110, 120, [0, 300, -160], P.headMaterial ?? MAT.ppSolid, 'z', 20);
    const label = addPlate(root, P.label, { w: 420, h: 110, pos: [130, 560, 0], rotY: Math.PI / 2, options: { w: 512, h: 130 } });
    return { root, params: P, base, motor, head, label };
  },
};
export const diaphragmPump = {
  meta: {
    id: 'pump-diaphragm', name: '氣動隔膜泵', category: '製程設備', source: 'ChemicalTankWashing',
    params: {},
    options: {
      material: '機身材質（預設 MAT.ppDark）', capMaterial: '兩端膜室蓋材質（預設 MAT.ppSolid）',
      label: 'false（預設）；{ lines, w=420, h=110, pos=[130,560,0], rotY=π/2, options={ w:512, h:130 } }：直立標示牌',
      name: 'root 的名稱（預設 pump-diaphragm）',
    },
    usage: "import { diaphragmPump } from '@core/models/equipment-process.js';\nconst pm = diaphragmPump.create({ label: { lines: ['P-2 隔膜泵'] } }); pm.root.position.set(x, 0, z); parent.add(pm.root);\n// 吐出口在機身頂面中心 [0, 420, 0]",
  },
  create(p = {}) {
    const P = { ...defaults(diaphragmPump.meta), ...p };
    const root = group(P.name ?? 'pump-diaphragm', 'pump-diaphragm'), cap = P.capMaterial ?? MAT.ppSolid;
    const body = block(root, [250, 420, 360], [0, 210, 0], P.material ?? MAT.ppDark);
    const caps = [cylinder(root, 140, 50, [0, 260, -200], cap, 'z', 20), cylinder(root, 140, 50, [0, 260, 200], cap, 'z', 20)];
    const label = addPlate(root, P.label, { w: 420, h: 110, pos: [130, 560, 0], rotY: Math.PI / 2, options: { w: 512, h: 130 } });
    return { root, params: P, body, caps, label };
  },
};

// ---------------------------------------------------------------- 切換閥、清運接頭（箱形示意）
// 原點：閥體中心。目前只是一個箱體，之後要畫閥桿、致動器時改這裡，各站跟著更新。
// id、名稱、分類在下面兩行直接寫出來（studio 的元件庫用文字比對掃 core/models 的 meta，要看得到）
const boxModel = ({ id, name, category }, size) => {
  const model = {
    meta: {
      id, name, category, source: 'ChemicalTankWashing',
      params: {
        w: { value: size[0], min: 40, max: 600, step: 10, unit: 'mm', label: '寬（X）' },
        h: { value: size[1], min: 40, max: 600, step: 10, unit: 'mm', label: '高（Y）' },
        d: { value: size[2], min: 40, max: 600, step: 10, unit: 'mm', label: '深（Z）' },
      },
      options: { material: '材質（預設 MAT.steelOrange）', name: `root 的名稱（預設 ${id}）` },
      usage: `import { ${id === 'valve' ? 'valve' : 'transferCoupling'} } from '@core/models/equipment-process.js';\nconst v = ${id === 'valve' ? 'valve' : 'transferCoupling'}.create(); v.root.position.set(x, y, z); parent.add(v.root);   // v.body 是箱體`,
    },
    create(p = {}) {
      const P = { ...defaults(model.meta), ...p };
      const root = group(P.name ?? id, id);
      const body = block(root, [P.w, P.h, P.d], [0, 0, 0], P.material ?? MAT.steelOrange);
      return { root, params: P, body };
    },
  };
  return model;
};
export const valve = boxModel({ id: 'valve', name: '切換閥（箱形示意）', category: '製程設備' }, [180, 180, 180]);
export const transferCoupling = boxModel({ id: 'transfer-coupling', name: '清運接頭（委外清運用，箱形示意）', category: '製程設備' }, [260, 160, 120]);
