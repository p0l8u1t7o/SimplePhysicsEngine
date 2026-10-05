// 輸送用的市購設備：平皮帶輸送機（belt-conveyor）、邊皮帶雙軌輸送段（edge-belt-conveyor）、V 槽滾輪輸送線（v-roller-conveyor）、
// 止擋（stopper）、萬向球旋轉台（ball-turntable）、柔性供料盤（flex-feeder）。滾筒輸送線在 conveyor.js，搬運設備在 transport-handling.js。
// 這些原本各站自己畫；幾何、分段數、位置與材質都能用參數重現各站原樣（換用對照見 core/migrations/1.10.0-transport.md）。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、陣列、子物件設定）。外部傳入的材質原樣使用。
//
// 共通慣例：
//   - 線型輸送設備沿本地 +X 輸送，原點在中心線、地面（y 0）。`span: [起, 迄]` 可以指定本體在本地 X 的範圍
//     （預設以原點為中心的 length）——站內沿用絕對座標時，root 只放到中心線上、不沿輸送方向位移，子物件的本地 X 就是站的座標。
//   - 位置清單（x、positions）可以給陣列，或 { from, to, pitch, closed }：for (x = from; closed ? x <= to : x < to; x += pitch)。
//   - 子物件選項給 false 就不裝；沒給的欄位用預設值。
//   - 會動的子物件（刻線群組、止擋滑塊、轉台）都回傳參考；站內可以直接改它們的 position／rotation，或用 set()。
import * as THREE from 'three';
import { block, cylinder, screw, D2R } from '../geom/shapes.js';
import { MAT, std } from '../geom/materials.js';
import { foot, motor } from '../geom/hardware.js';
import { defaults } from './util.js';

// 模型的根群組：名稱可由 name 參數指定；userData.coreModel 讓走線與檢查認得這是共用模型。
// mobile：整個會被站搬著走的東西（棧板、台車、穿梭車）——標 cableHost = false，走線不拿它當線夾固定面
export const modelRoot = (meta, P, { mobile = false } = {}) => { const g = new THREE.Group(); g.name = P.name ?? meta.id; g.userData.coreModel = meta.id; if (mobile) g.userData.cableHost = false; return g; };
// 位置清單：陣列原樣使用；{ from, to, pitch, closed } 展開成等距位置（和各站原本的 for 迴圈同一種累加，數值完全相同）
export const seq = s => { if (Array.isArray(s)) return s; const out = []; for (let x = s.from; s.closed ? x <= s.to : x < s.to; x += s.pitch) out.push(x); return out; };
// 子物件選項：false／null 不裝；true 或沒給用預設；物件則蓋掉預設的欄位
export const part = (v, d = {}) => v === false || v === null ? null : v === undefined || v === true ? d : { ...d, ...v };
const skipped = (x, skip) => (skip || []).some(([c, half]) => Math.abs(x - c) < half);
const named = (m, name) => { m.name = name; return m; };

// 內建的皮帶貼圖（固定內容，Node 也能建立）：細橫紋＋一道接縫，帶面移動時看得出來
function beltTexture(color) {
  const n = 64, data = new Uint8Array(n * n * 4), c = new THREE.Color(color);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const h = ((Math.imul(x + 7, 1973) ^ Math.imul(y + 11, 9277)) >>> 0) % 256;
    const k = .94 + h / 255 * .04 - (x < 2 ? .1 : 0);
    data.set([c.r * 255 * k, c.g * 255 * k, c.b * 255 * k, 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- 平皮帶輸送機
// 原點：皮帶中心線、地面；沿 +X 輸送；承載面（皮帶頂面）高度 = top。
// 本體：承載面（carry，貼圖隨輸送距離捲動）、回程面（back）、滑床板（bed）、頭尾滾筒（rollers）。
// 機身（選配，標準品的側板與腳架）：sides（左右對稱的縱向構件：側樑、擋邊）、legs（支腳＋腳座）。
// 現場既有機架、鏽色側牆、導料板、驅動馬達吊架、編碼器這類加工件或站專屬的東西留在站內（sides: false, legs: false）。
export const beltConveyor = {
  meta: {
    id: 'belt-conveyor', name: '平皮帶輸送機', category: '輸送',
    source: 'RecycleSorter',
    params: {
      length: { value: 1600, min: 400, max: 8000, step: 50, unit: 'mm', label: '皮帶長度' },
      width: { value: 300, min: 100, max: 1200, step: 10, unit: 'mm', label: '帶寬' },
      top: { value: 700, min: 200, max: 1400, step: 10, unit: 'mm', label: '承載面高度' },
      rollerR: { value: 42, min: 15, max: 80, step: 1, unit: 'mm', label: '頭尾滾筒半徑' },
    },
    states: { s: { value: 0, min: 0, max: 2000, unit: 'mm', label: '輸送距離' } },
    options: {
      span: '[起, 迄]：承載面在本地 X 的範圍（預設 [−length/2, length/2]）',
      carry: '{ t=14（厚）, material, color=0x53606a（沒給材質時內建貼圖的底色）, name }：承載面；材質有 map 時 set({ s }) 會捲動它',
      texturePitch: '貼圖一格的長度 mm（預設 100）：map.offset.x = −s / texturePitch；內建材質的 repeat = 長度 / texturePitch',
      back: 'false 不畫；{ t=10, y=滾筒底+2（中心）, material=MAT.belt }：回程面',
      bed: 'false 不畫；{ size=[長−20, 16, 寬−30], y=top−carry.t−18（中心）, material=MAT.steel }：滑床板',
      rollers: 'false 不畫；{ r=rollerR, length=寬+14, y=top−r−8, x=[起, 迄], segments=20, material=MAT.roller }：頭尾滾筒',
      sides: 'false 不畫；[{ h, t, y（中心）, z（中心到中心線）, length=長, x=中心, material }]：左右各一支；預設是側樑（90×20，MAT.frame）＋擋邊（50×10，MAT.alu）',
      legs: 'false 不畫；{ x=[起+180, 迄−180], z=[0], size=[60, top−100, 60], material=MAT.frame, foot=140（腳座邊長，false 不裝） }',
      name: 'root 的名稱（預設 belt-conveyor）',
    },
    usage: "import { beltConveyor } from '@core/models/transport.js';\nconst belt = beltConveyor.create({ length: 2400, width: 400 }); belt.root.position.set(x, 0, z); scene.add(belt.root);\nbelt.set({ s: 帶面行程 });   // 貼圖捲動＋滾筒轉動；belt.carry、belt.back、belt.bed、belt.rollers、belt.sides、belt.legs 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(beltConveyor.meta), texturePitch: 100, ...p };
    const root = modelRoot(beltConveyor.meta, P);
    const [a0, a1] = P.span ?? [-P.length / 2, P.length / 2], len = a1 - a0, xc = (a0 + a1) / 2, { width: w, top } = P;
    // 承載面
    const co = P.carry ?? {}, ct = co.t ?? 14;
    let material = co.material;
    if (!material) { const map = beltTexture(co.color ?? 0x53606a); map.repeat.set(len / P.texturePitch, 1); material = std(0xffffff, .92, .02, { map }); }
    const carry = named(block(root, [len, ct, w], [xc, top - ct / 2, 0], material), co.name ?? 'belt carry');
    const ro = part(P.rollers), rr = ro ? ro.r ?? P.rollerR : P.rollerR, rollerY = ro?.y ?? top - rr - 8;
    // 回程面、滑床板
    const bo = part(P.back), be = part(P.bed);
    const back = bo ? named(block(root, [len, bo.t ?? 10, w], [xc, bo.y ?? rollerY - rr + 2, 0], bo.material ?? MAT.belt), 'belt return') : null;
    const bed = be ? named(block(root, be.size ?? [len - 20, 16, w - 30], [xc, be.y ?? top - ct - 18, 0], be.material ?? MAT.steel), 'belt bed') : null;
    // 機身側板（左右對稱）
    const sideSpec = P.sides === false || P.sides === null ? [] : Array.isArray(P.sides) ? P.sides
      : [{ h: 90, t: 20, y: top - 50, z: w / 2 + 10, material: MAT.frame }, { h: 50, t: 10, y: top + 25, z: w / 2 + 5, material: MAT.alu }];
    const sides = [];
    for (const sd of sideSpec) for (const s of [-1, 1])
      sides.push(named(block(root, [sd.length ?? len, sd.h, sd.t], [sd.x ?? xc, sd.y, s * sd.z], sd.material ?? MAT.frame), sd.name ?? 'belt side'));
    // 頭尾滾筒
    const rollers = ro ? (ro.x ?? [a0, a1]).map(x => named(cylinder(root, rr, ro.length ?? w + 14, [x, rollerY, 0], ro.material ?? MAT.roller, 'z', ro.segments ?? 20), 'belt roller')) : [];
    // 支腳＋腳座
    const lg = part(P.legs), legs = [];
    if (lg) {
      const size = lg.size ?? [60, top - 100, 60];
      for (const x of lg.x ? seq(lg.x) : [a0 + 180, a1 - 180]) for (const z of lg.z ?? [0]) {
        legs.push(named(block(root, size, [x, size[1] / 2, z], lg.material ?? MAT.frame), 'belt leg'));
        if (lg.foot !== false) foot(root, x, z, lg.foot ?? 140);
      }
    }
    // 輸送距離 s（mm）：貼圖往 −U 捲、滾筒繞自己的軸轉（網格已繞 X 轉 90°，自轉軸是本地 Y）
    function set(v) {
      const s = typeof v === 'number' ? v : v?.s ?? 0;
      if (carry.material.map) carry.material.map.offset.x = -s / P.texturePitch;
      for (const r of rollers) r.rotation.y = s / r.geometry.parameters.radiusTop;
    }
    return { root, params: P, carry, back, bed, rollers, sides, legs, set };
  },
};

// ---------------------------------------------------------------- 邊皮帶雙軌輸送段（SMT／載具輸送）
// 原點：兩軌中心線、地面；沿 +X 輸送；top 是輸送面的基準高度，width 是兩軌內側面的間距。
// 每一側（−Z 先、+Z 後）：軌道（rail）、壓邊（lip）、鎖付件（fasteners）、側面飾條（strip）、皮帶（belt）、端輪（pulleys）、支腳（legs＋foot）。
// 兩側共用：橫撐（cross）、驅動（drive）、調寬機構（adjust：導桿＋伺服座）、皮帶刻線（marks，獨立群組，隨輸送距離循環位移）。
const BELT_GREEN = std(0x2e7d56, .75, 0);
export const edgeBeltConveyor = {
  meta: {
    id: 'edge-belt-conveyor', name: '邊皮帶雙軌輸送段', category: '輸送',
    source: 'PCB-CopperAssembly、MilitaryGradePC、RobotArmPressSSD',
    params: {
      length: { value: 1200, min: 300, max: 6000, step: 50, unit: 'mm', label: '長度' },
      width: { value: 200, min: 60, max: 800, step: 5, unit: 'mm', label: '軌內側間距' },
      top: { value: 900, min: 300, max: 1400, step: 10, unit: 'mm', label: '輸送面高度' },
    },
    states: { s: { value: 0, min: 0, max: 600, unit: 'mm', label: '輸送距離' } },
    options: {
      span: '[起, 迄]：本體在本地 X 的範圍（預設 [−length/2, length/2]）',
      rail: '{ h=50, w=20, y=top+12−h/2（中心）, z=width/2+w/2（中心到中心線）, material=MAT.alu }：軌道（鋁擠型樑）',
      belt: '{ h=2, w=8, inset=15（每端縮短）, y=top−h/2, z=width/2−w/2, material=綠色皮帶 }',
      lip: 'false 不裝；{ h=3, w=6, y=軌頂−h/2, z=width/2−w/2, material=MAT.alu }：壓邊',
      fasteners: "false 不裝；{ type='screw'（shapes.js 的 screw）或 'bolt'（圓柱頭＋內六角）, x={ from: 起+65, to: 迄−25, pitch: 130 }, y, r, material, socketMaterial }",
      strip: 'false（預設）；{ size=[長−4, 1.4, 1], x（給了就每個位置一片）, y=top−7, z=軌外側面+0.5, material=MAT.black }：軌外側的飾條／槽孔',
      pulleys: 'false 不裝；{ r=14, w=10, x=[起+15, 迄−15], y=top−15, z=belt.z, segments=20, material=MAT.black }：端輪',
      legs: 'false 不裝；{ x=[起+40, 迄−40], size=[40, top−38, 40], y=高/2, z=rail.z, material=MAT.frame, name, foot=false 或 { size=[90,10,70], y=厚/2, material=MAT.black, name } }',
      cross: 'false 不裝；{ x=legs.x, size=[30, 30, width+40], y=top−60, material=MAT.frame }：橫撐',
      drive: 'false 不裝；{ size=[120, 90, 80], pos=[迄−120, top−95, −width/2−70], material=MAT.steelBlue }：皮帶驅動',
      adjust: 'false（預設）；{ x=[…], rod={ r=8, length=width+80, y=top−55, z=10, segments=12, material=MAT.chrome }, servo={ size=[50,50,60], y=top−55, z=width/2+70, material=MAT.steelBlue } }：調寬導桿＋伺服座',
      marks: 'false 不畫；{ size=[3, .6, 7], x={ from: 起+30, to: 迄−30, pitch: 60 }, y=top+.3, z=belt.z, material=MAT.alu, pitch（循環間距，預設取 x.pitch） }：皮帶刻線',
      name: 'root 的名稱（預設 edge-belt-conveyor）',
    },
    usage: "import { edgeBeltConveyor } from '@core/models/transport.js';\nconst conv = edgeBeltConveyor.create({ length: 1200, width: 180 }); conv.root.position.set(x, 0, 兩軌中心 z); scene.add(conv.root);\nconv.set({ s: 輸送距離 });   // 刻線循環位移；conv.marks 是刻線群組，conv.rails／lips／belts 依 [−Z, +Z] 排列",
  },
  create(p = {}) {
    const P = { ...defaults(edgeBeltConveyor.meta), ...p };
    const root = modelRoot(edgeBeltConveyor.meta, P);
    const [a0, a1] = P.span ?? [-P.length / 2, P.length / 2], len = a1 - a0, xc = (a0 + a1) / 2, { top, width: G } = P;
    const ra = { h: 50, w: 20, ...P.rail }, railZ = ra.z ?? G / 2 + ra.w / 2, railY = ra.y ?? top + 12 - ra.h / 2;
    const be = { h: 2, w: 8, inset: 15, ...P.belt }, beltZ = be.z ?? G / 2 - be.w / 2, beltY = be.y ?? top - be.h / 2;
    const lp = part(P.lip, { h: 3, w: 6 }), fa = part(P.fasteners, { type: 'screw' }), st = part(P.strip ?? false), pu = part(P.pulleys, { r: 14, w: 10 });
    const lg = part(P.legs), ft = lg ? part(lg.foot, {}) : null, legX = lg ? (lg.x ? seq(lg.x) : [a0 + 40, a1 - 40]) : [];
    const rails = [], belts = [], lips = [], strips = [], pulleys = [], legs = [], feet = [], fasteners = [];
    for (const s of [-1, 1]) {
      rails.push(named(block(root, [len, ra.h, ra.w], [xc, railY, s * railZ], ra.material ?? MAT.alu), 'conveyor rail'));
      if (lp) lips.push(named(block(root, [len, lp.h, lp.w], [xc, lp.y ?? railY + ra.h / 2 - lp.h / 2, s * (lp.z ?? G / 2 - lp.w / 2)], lp.material ?? MAT.alu), 'conveyor lip'));
      if (fa) for (const x of seq(fa.x ?? { from: a0 + 65, to: a1 - 25, pitch: 130 })) {
        const y = fa.y ?? railY + ra.h / 2 + .3, z = s * (fa.z ?? railZ);
        if (fa.type === 'bolt') {                                           // 圓柱頭螺栓＋內六角孔
          fasteners.push(cylinder(root, fa.r ?? 3.4, 2, [x, y, z], fa.material ?? MAT.alu, 'y', 20));
          cylinder(root, 1.5, .12, [x, y + 1.05, z], fa.socketMaterial ?? MAT.black, 'y', 6);
        } else fasteners.push(screw(root, [x, y, z], fa.r ?? 3.2));
      }
      if (st) {
        const size = st.size ?? [len - 4, 1.4, 1], z = s * (st.z ?? railZ + ra.w / 2 + .5);
        for (const x of st.x ? seq(st.x) : [xc]) strips.push(named(block(root, size, [x, st.y ?? top - 7, z], st.material ?? MAT.black), 'conveyor strip'));
      }
      belts.push(named(block(root, [len - 2 * be.inset, be.h, be.w], [xc, beltY, s * beltZ], be.material ?? BELT_GREEN), 'conveyor belt'));
      if (pu) for (const x of pu.x ?? [a0 + 15, a1 - 15])
        pulleys.push(named(cylinder(root, pu.r, pu.w, [x, pu.y ?? top - 15, s * (pu.z ?? beltZ)], pu.material ?? MAT.black, 'z', pu.segments ?? 20), 'conveyor pulley'));
      if (lg) {
        const size = lg.size ?? [40, top - 38, 40], z = s * (lg.z ?? railZ), fs = ft ? ft.size ?? [90, 10, 70] : null;
        for (const x of legX) {
          legs.push(named(block(root, size, [x, lg.y ?? size[1] / 2, z], lg.material ?? MAT.frame), lg.name ?? 'conveyor leg'));
          if (ft) feet.push(named(block(root, fs, [x, ft.y ?? fs[1] / 2, z], ft.material ?? MAT.black), ft.name ?? 'conveyor foot'));
        }
      }
    }
    // 橫撐、驅動、調寬機構
    const cr = part(P.cross), cross = [];
    if (cr) for (const x of cr.x ? seq(cr.x) : legX.length ? legX : [a0 + 40, a1 - 40])
      cross.push(named(block(root, cr.size ?? [30, 30, G + 40], [x, cr.y ?? top - 60, 0], cr.material ?? MAT.frame), 'conveyor cross'));
    const dr = part(P.drive);
    const drive = dr ? named(block(root, dr.size ?? [120, 90, 80], dr.pos ?? [a1 - 120, top - 95, -G / 2 - 70], dr.material ?? MAT.steelBlue), 'conveyor drive') : null;
    const ad = part(P.adjust ?? false), adjust = { rods: [], servos: [] };
    if (ad) for (const x of ad.x ?? [a0 + 150, a1 - 150]) {
      const rod = part(ad.rod), sv = part(ad.servo);
      if (rod) adjust.rods.push(named(cylinder(root, rod.r ?? 8, rod.length ?? G + 80, [x, rod.y ?? top - 55, rod.z ?? 10], rod.material ?? MAT.chrome, 'z', rod.segments ?? 12), 'width guide'));
      if (sv) adjust.servos.push(named(block(root, sv.size ?? [50, 50, 60], [x, sv.y ?? top - 55, sv.z ?? G / 2 + 70], sv.material ?? MAT.steelBlue), 'width servo'));
    }
    // 皮帶刻線：獨立群組，整組沿 X 循環位移
    const mk = part(P.marks), marks = new THREE.Group(); marks.name = 'belt marks'; root.add(marks);
    const markX = mk ? mk.x ?? { from: a0 + 30, to: a1 - 30, pitch: 60 } : [], markPitch = mk ? mk.pitch ?? (Array.isArray(markX) ? 60 : markX.pitch) : 60;
    if (mk) for (const x of seq(markX)) for (const s of [-1, 1])
      block(marks, mk.size ?? [3, .6, 7], [x, mk.y ?? top + .3, s * (mk.z ?? beltZ)], mk.material ?? MAT.alu);
    // 輸送距離 s（mm）：刻線在一個間距內循環
    function set(v) { const s = typeof v === 'number' ? v : v?.s ?? 0; marks.position.x = ((s % markPitch) + markPitch) % markPitch; }
    return { root, params: P, rails, belts, lips, strips, pulleys, legs, feet, fasteners, cross, drive, adjust, marks, set };
  },
};

// ---------------------------------------------------------------- V 槽滾輪輸送線（圓桶橫躺輸送）
// 原點：輸送中心線、地面；沿 +X 輸送；沙漏形（V 槽）滾輪的軸橫跨輸送方向，軸高 axisY。
// 滾輪兩端有短軸，兩側是側樑（frame）與支腳（legs）。圓桶落在 V 槽兩側斜面上，半角 vee。
export const vRollerConveyor = {
  meta: {
    id: 'v-roller-conveyor', name: 'V 槽滾輪輸送線', category: '輸送',
    source: 'ChemicalTankWashing',
    params: {
      length: { value: 2600, min: 600, max: 8000, step: 100, unit: 'mm', label: '長度' },
      axisY: { value: 440, min: 200, max: 1200, step: 5, unit: 'mm', label: '滾輪軸高' },
      pitch: { value: 330, min: 150, max: 800, step: 10, unit: 'mm', label: '滾輪間距' },
      vee: { value: 25, min: 5, max: 45, step: 1, unit: '°', label: 'V 槽半角' },
      waist: { value: 40, min: 15, max: 100, step: 1, unit: 'mm', label: '腰部半徑' },
      halfL: { value: 260, min: 100, max: 600, step: 10, unit: 'mm', label: '滾輪半長' },
    },
    states: { s: { value: 0, min: 0, max: 2000, unit: 'mm', label: '輸送距離' } },
    options: {
      span: '[起, 迄]：側樑在本地 X 的範圍（預設 [−length/2, length/2]）',
      rollers: '{ from=起+200, to=迄−170, closed=true, pitch, skip=[[中心, 半寬]…]（這些區段不裝）, segments=28, material=MAT.roller, contactR=100（set 用的接觸半徑） }',
      stubs: 'false 不裝；{ r=12, length=60, offset=halfL+30, segments=8, material=MAT.steelDark }：滾輪兩端的短軸',
      frame: 'false 不裝；{ h=140, w=50, y=axisY, offset=halfL+60, material=MAT.steel }：兩側側樑',
      legs: 'false 不裝；{ positions={ from: 起+100, to: 迄, pitch: 1150, closed: true }, size=[70, axisY−70, 70], offset=frame.offset, material=MAT.steelDark }',
      name: 'root 的名稱（預設 v-roller-conveyor）',
    },
    usage: "import { vRollerConveyor } from '@core/models/transport.js';\nconst line = vRollerConveyor.create({ length: 4600 }); line.root.position.set(x, 0, z); scene.add(line.root);\nline.set({ s: 輸送距離 });   // line.rollers 是滾輪網格（自轉用 rotation.y），line.positions 是各滾輪的本地 X",
  },
  create(p = {}) {
    const P = { ...defaults(vRollerConveyor.meta), ...p };
    const root = modelRoot(vRollerConveyor.meta, P);
    const [a0, a1] = P.span ?? [-P.length / 2, P.length / 2], { axisY, halfL } = P, va = P.vee * D2R, r0 = P.waist;
    const ro = { from: a0 + 200, to: a1 - 170, closed: true, pitch: P.pitch, ...P.rollers }, sb = part(P.stubs), fr = part(P.frame), lg = part(P.legs);
    // 沙漏形滾輪：所有滾輪共用一份幾何
    const hourglass = new THREE.LatheGeometry([[0, -halfL], [r0 + halfL * Math.tan(va), -halfL], [r0, 0], [r0 + halfL * Math.tan(va), halfL], [0, halfL]].map(([r, y]) => new THREE.Vector2(r, y)), ro.segments ?? 28);
    const rollers = [], positions = [], stubs = [];
    for (const x of seq(ro)) {
      if (skipped(x, ro.skip)) continue;
      const r = new THREE.Mesh(hourglass, ro.material ?? MAT.roller); r.name = 'v roller';
      r.rotation.x = Math.PI / 2; r.position.set(x, axisY, 0); r.castShadow = r.receiveShadow = true; root.add(r); rollers.push(r); positions.push(x);
      if (sb) for (const s of [-1, 1]) stubs.push(cylinder(root, sb.r ?? 12, sb.length ?? 60, [x, axisY, s * (sb.offset ?? halfL + 30)], sb.material ?? MAT.steelDark, 'z', sb.segments ?? 8));
    }
    const side = fr ? fr.offset ?? halfL + 60 : halfL + 60, frames = [], legs = [];
    if (fr) for (const s of [-1, 1]) frames.push(named(block(root, [a1 - a0, fr.h ?? 140, fr.w ?? 50], [(a0 + a1) / 2, fr.y ?? axisY, s * side], fr.material ?? MAT.steel), 'conveyor frame'));
    if (lg) {
      const size = lg.size ?? [70, axisY - 70, 70];
      for (const x of seq(lg.positions ?? { from: a0 + 100, to: a1, pitch: 1150, closed: true })) for (const s of [-1, 1])
        legs.push(named(block(root, size, [x, size[1] / 2, s * (lg.offset ?? side)], lg.material ?? MAT.steelDark), 'conveyor leg'));
    }
    const contactR = ro.contactR ?? 100;
    function set(v) { const s = typeof v === 'number' ? v : v?.s ?? 0; for (const r of rollers) r.rotation.y = -s / contactR; }
    return { root, params: P, rollers, positions, stubs, frames, legs, contactR, set };
  },
};

// ---------------------------------------------------------------- 止擋（氣缸升降的擋銷／擋板）
// 原點：止擋件的中心線、輸送面高度。止擋件裝在滑塊群組（slide）裡，set(1) 升起擋料、set(0) 降下 stroke。
// 止擋件預設是圓銷（pin）；給 blade 就改成擋板。body 是下方的氣缸本體（可不裝）。
export const stopper = {
  meta: {
    id: 'stopper', name: '止擋（氣缸升降）', category: '輸送',
    source: 'MilitaryGradePC、RobotArmPressSSD、PCB-CopperAssembly',
    params: {
      stroke: { value: 24, min: 5, max: 80, step: 1, unit: 'mm', label: '升降行程' },
    },
    states: { up: { value: 1, min: 0, max: 1, label: '升起（1 擋料、0 降下）' } },
    options: {
      pin: '{ r=6, h=26, y=−1（升起時的中心）, segments=16, material=MAT.chrome }：圓銷',
      blade: '給了就用擋板取代圓銷：{ size=[10, 24, 68], y=size[1]/2+2（升起時的中心）, material=MAT.yellow }',
      body: 'false 不裝；{ size=[30, 40, 30], pos=[6, −40, 0]（中心，相對原點）, material=MAT.black }：氣缸本體',
      up: '建立時的狀態（預設 1 升起）',
      partName: '止擋件網格的名稱（預設 stop pin／stop blade）', name: 'root 的名稱（預設 stopper）',
    },
    usage: "import { stopper } from '@core/models/transport.js';\nconst stop = stopper.create(); stop.root.position.set(止擋面 x, 輸送面高度, z); scene.add(stop.root);\nstop.set(0);   // 0 降下、1 升起（也可以給 { up }）；stop.slide 是升降的群組，stop.part 是止擋件網格，stop.body 是氣缸本體",
  },
  create(p = {}) {
    const P = { ...defaults(stopper.meta), ...p };
    const root = modelRoot(stopper.meta, P);
    const bo = part(P.body, {});
    const body = bo ? named(block(root, bo.size ?? [30, 40, 30], bo.pos ?? [6, -40, 0], bo.material ?? MAT.black), 'stop body') : null;
    const slide = new THREE.Group(); slide.name = 'stop slide'; root.add(slide);
    let stop;
    if (P.blade) {
      const b = P.blade === true ? {} : P.blade, size = b.size ?? [10, 24, 68];
      stop = named(block(slide, size, [0, b.y ?? size[1] / 2 + 2, 0], b.material ?? MAT.yellow), P.partName ?? 'stop blade');
    } else {
      const n = P.pin ?? {}, h = n.h ?? 26;
      stop = named(cylinder(slide, n.r ?? 6, h, [0, n.y ?? -1, 0], n.material ?? MAT.chrome, 'y', n.segments ?? 16), P.partName ?? 'stop pin');
    }
    function set(v) { if (v !== null && typeof v === 'object') v = v.up; slide.position.y = ((v === true ? 1 : +v || 0) - 1) * P.stroke; }
    set(P.up ?? 1);
    return { root, params: P, body, slide, part: stop, set };
  },
};

// ---------------------------------------------------------------- 萬向球旋轉台
// 原點：轉台中心、地面；承載面（球頂）高度 = top。轉盤（table 群組：盤面＋球座＋萬向球）繞 Y 轉，set({ angle }) 單位是度。
// base 是下方的迴轉支承，drive 是旁邊的伺服馬達（hardware.js 的 motor），都固定不轉。
export const ballTurntable = {
  meta: {
    id: 'ball-turntable', name: '萬向球旋轉台', category: '輸送',
    source: 'ChemicalTankWashing',
    params: {
      top: { value: 500, min: 200, max: 1200, step: 10, unit: 'mm', label: '承載面高度（球頂）' },
      radius: { value: 330, min: 150, max: 800, step: 10, unit: 'mm', label: '盤面半徑' },
      pitch: { value: 90, min: 50, max: 200, step: 5, unit: 'mm', label: '萬向球間距' },
      ballR: { value: 24, min: 10, max: 40, step: 1, unit: 'mm', label: '萬向球半徑' },
    },
    states: { angle: { value: 0, min: -180, max: 180, unit: '°', label: '轉盤角度' } },
    options: {
      grid: '{ span=radius−60（格點最遠的 X、Z）, limit=radius−30（離中心超過就不裝） }',
      disc: '{ h=30, y=top−85（中心）, segments=48, material=MAT.steelDark }：盤面',
      cup: '{ r=ballR+5, h=30, y=top−40, segments=28, material=MAT.steelDark }：球座',
      ball: '{ y=top−ballR, segments=[16, 10], material=MAT.roller }：萬向球（只投影、不受影）',
      base: 'false 不裝；{ r=180, h=90, y=top−145, segments=28, material=MAT.steelBlue }：迴轉支承',
      drive: 'false 不裝；{ pos=[225, 180, 0], scale=.65, yaw=0 }：伺服馬達',
      name: 'root 的名稱（預設 ball-turntable）',
    },
    usage: "import { ballTurntable } from '@core/models/transport.js';\nconst tt = ballTurntable.create({ top: 507.5 }); tt.root.position.set(x, 0, z); scene.add(tt.root);\ntt.set({ angle: 90 });   // 度；tt.table 是轉盤群組（也可以直接設 rotation.y），tt.balls 是萬向球網格",
  },
  create(p = {}) {
    const P = { ...defaults(ballTurntable.meta), ...p };
    const root = modelRoot(ballTurntable.meta, P);
    const { top } = P, gd = { span: P.radius - 60, limit: P.radius - 30, ...P.grid }, dc = P.disc ?? {}, cu = P.cup ?? {}, ba = P.ball ?? {};
    const table = new THREE.Group(); table.name = 'turntable'; root.add(table);
    const disc = named(cylinder(table, P.radius, dc.h ?? 30, [0, dc.y ?? top - 85, 0], dc.material ?? MAT.steelDark, 'y', dc.segments ?? 48), 'turntable disc');
    const balls = [], cups = [], [ws, hs] = ba.segments ?? [16, 10];
    for (let dx = -gd.span; dx <= gd.span; dx += P.pitch) for (let dz = -gd.span; dz <= gd.span; dz += P.pitch) {
      if (Math.hypot(dx, dz) > gd.limit) continue;
      cups.push(cylinder(table, cu.r ?? P.ballR + 5, cu.h ?? 30, [dx, cu.y ?? top - 40, dz], cu.material ?? MAT.steelDark, 'y', cu.segments ?? 28));
      const r = new THREE.Mesh(new THREE.SphereGeometry(P.ballR, ws, hs), ba.material ?? MAT.roller); r.name = 'ball transfer';
      r.position.set(dx, ba.y ?? top - P.ballR, dz); r.castShadow = true; table.add(r); balls.push(r);
    }
    const bs = part(P.base), dv = part(P.drive);
    const base = bs ? named(cylinder(root, bs.r ?? 180, bs.h ?? 90, [0, bs.y ?? top - 145, 0], bs.material ?? MAT.steelBlue, 'y', bs.segments ?? 28), 'turntable base') : null;
    const drive = dv ? motor(root, ...(dv.pos ?? [225, 180, 0]), dv.scale ?? .65, dv.yaw ?? 0) : null;
    function set(v) { const a = typeof v === 'number' ? v : v?.angle ?? 0; table.rotation.y = a * D2R; }
    return { root, params: P, table, disc, cups, balls, base, drive, set };
  },
};

// ---------------------------------------------------------------- 柔性供料盤（振動盤面＋背光＋補料斗）
// 原點：盤面中心在地面的投影；盤面（頂面）高度 = top，機身由 baseY−5 到 top−5（盤面比機身頂高 1 mm）。補料斗在 +X 側。
// 預設值是放在地面上的單機；裝在機台上時給 top 與 baseY（例如盤面 955、機身底 840 → baseY 845）。
const FEEDER_PLATE = std(0xe8eef2, .7, 0, { emissive: 0x9fb8c8, emissiveIntensity: .25 });
export const flexFeeder = {
  meta: {
    id: 'flex-feeder', name: '柔性供料盤（含補料斗）', category: '供料',
    source: 'PCB-CopperAssembly',
    params: {
      w: { value: 150, min: 60, max: 400, step: 5, unit: 'mm', label: '盤面寬（X）' },
      d: { value: 110, min: 60, max: 400, step: 5, unit: 'mm', label: '盤面深（Z）' },
      top: { value: 115, min: 60, max: 1400, step: 5, unit: 'mm', label: '盤面高度' },
      baseY: { value: 5, min: 5, max: 1300, step: 5, unit: 'mm', label: '機身底面高度＋5（裝在機台上時給機台面高度＋5）' },
    },
    options: {
      margin: '機身比盤面每邊大多少的兩倍（預設 40：機身 = 盤面 + 40）',
      bodyMaterial: '機身材質（預設 MAT.black）', plateMaterial: '盤面材質（預設白色背光）', plateT: '盤面厚（預設 4）',
      hopper: 'false 不裝；{ size=[80, 60, 60], pos=[w/2+60, top+10, 0], material=MAT.alu }：補料斗',
      name: 'root 的名稱（預設 flex-feeder）',
    },
    usage: "import { flexFeeder } from '@core/models/transport.js';\nconst f = flexFeeder.create({ w: 150, d: 110, top: 955, baseY: 845 }); f.root.position.set(x, 0, z); scene.add(f.root);\n// f.body、f.plate（盤面）、f.hopper 是網格；工件放在 y = top",
  },
  create(p = {}) {
    const P = { ...defaults(flexFeeder.meta), margin: 40, plateT: 4, ...p };
    const root = modelRoot(flexFeeder.meta, P);
    const { w, d, top } = P, ho = part(P.hopper);
    const body = named(block(root, [w + P.margin, top - P.baseY, d + P.margin], [0, (top + P.baseY) / 2 - 5, 0], P.bodyMaterial ?? MAT.black), 'feeder body');
    const plate = named(block(root, [w, P.plateT, d], [0, top - P.plateT / 2, 0], P.plateMaterial ?? FEEDER_PLATE), 'feeder plate');
    const hopper = ho ? named(block(root, ho.size ?? [80, 60, 60], ho.pos ?? [w / 2 + 60, top + 10, 0], ho.material ?? MAT.alu), 'feeder hopper') : null;
    return { root, params: P, body, plate, hopper };
  },
};
