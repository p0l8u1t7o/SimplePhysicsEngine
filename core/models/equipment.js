// 專用設備與周邊的市購品（一）：氣源（空壓機、儲氣筒、分配座）、櫃側散熱風扇、教導器、離子風嘴、操作電腦、安全雷射掃描器，
// 以及會畫文字的小螢幕 liveScreen（天平讀值、儀器與電腦畫面共用）。實驗室儀器在 equipment-lab.js，製程設備在 equipment-process.js。
// 這些原本各站自己畫；幾何、分段數、位置與材質都能用參數重現各站原樣（換用對照見 core/migrations/1.10.0-equipment.md）。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、標示文字、子物件設定）。外部傳入的材質原樣使用。
import * as THREE from 'three';
import { block, cylinder, decal, plate } from '../geom/shapes.js';
import { MAT, std } from '../geom/materials.js';
import { defaults } from './util.js';

const group = (name, id) => { const g = new THREE.Group(); g.name = name; g.userData.coreModel = id; return g; };
// 直立標示牌（shapes.js 的 plate）：L 是 { lines, w, h, pos, rotY, options }，沒給的欄位用模型的預設；Node 檢查端沒有 DOM 時回傳 null
const addPlate = (root, L, d) => L ? plate(root, L.lines ?? d.lines, L.w ?? d.w, L.h ?? d.h, L.pos ?? d.pos, L.rotY ?? d.rotY ?? 0, L.options ?? d.options ?? {}) : null;
// 文字貼紙（shapes.js 的 decal）：L 是 { lines, w, h, pos, rot, options }
const addDecal = (root, L, d) => L ? decal(root, L.w ?? d.w, L.h ?? d.h, L.pos ?? d.pos, L.rot ?? d.rot ?? [0, 0, 0], L.lines ?? d.lines, L.options ?? d.options ?? {}) : null;

// ---------------------------------------------------------------- 會畫文字的小螢幕（不是模型，是模型共用的零件）
// 回傳 { mesh, draw(key, fn(ctx, 寬, 高)), canvas, texture }：key 沒變就不重畫。
// 沒有 window 的環境（Node 檢查）不建 canvas，網格改用深色的 fallback 材質，draw 不做事；幾何相同。
const SCREEN_OFF = new THREE.MeshBasicMaterial({ color: 0x0b1220 });
export function liveScreen(w, h, pxW = 512, pxH = 160, { fallback = SCREEN_OFF } = {}) {
  const real = typeof window !== 'undefined';
  const canvas = real ? document.createElement('canvas') : null; if (canvas) { canvas.width = pxW; canvas.height = pxH; }
  const texture = canvas ? new THREE.CanvasTexture(canvas) : null; if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), texture ? new THREE.MeshBasicMaterial({ map: texture }) : fallback);
  let last = '';
  function draw(key, fn) { if (!canvas || key === last) return; last = key; const ctx = canvas.getContext('2d'); fn(ctx, pxW, pxH); texture.needsUpdate = true; }
  return { mesh, draw, canvas, texture };
}

// ---------------------------------------------------------------- 空壓機（靜音無油式、雙缸）
// 原點：機座底面中心；馬達軸沿 X（風扇罩在 −X 端），雙缸在 +X 端。固定尺寸（機座 480 × 340、總高約 340）。
const COMPRESSOR_BLUE = std(0x2c4f86, .5, .3);
export const airCompressor = {
  meta: {
    id: 'air-compressor', name: '空壓機（靜音無油式，雙缸）', category: '氣動與公用', source: 'RecycleSorter',
    params: {},
    options: {
      material: '馬達與缸體的材質（預設藍色 0x2c4f86）',
      label: 'false（預設）；{ lines, w=320, h=50, pos=[0,420,−172], rotY=π, options }：直立標示牌（shapes.js 的 plate）',
      name: 'root 的名稱（預設 air-compressor）',
    },
    usage: "import { airCompressor } from '@core/models/equipment.js';\nconst c = airCompressor.create({ label: { lines: ['空壓機'] } }); c.root.position.set(x, 地面, z); parent.add(c.root);\n// c.base、c.motor、c.heads（兩個缸體）是網格",
  },
  create(p = {}) {
    const P = { ...defaults(airCompressor.meta), ...p };
    const root = group(P.name ?? 'air-compressor', 'air-compressor'), mat = P.material ?? COMPRESSOR_BLUE;
    const base = block(root, [480, 50, 340], [0, 25, 0], MAT.steelDark);                      // 機座
    const motor = cylinder(root, 95, 250, [-60, 190, 0], mat, 'x', 28);                       // 馬達
    cylinder(root, 105, 30, [-200, 190, 0], MAT.black, 'x', 28);                              // 風扇罩
    const heads = [];
    for (const s of [-1, 1]) { heads.push(block(root, [100, 170, 100], [150, 240, s * 75], mat)); block(root, [112, 16, 112], [150, 333, s * 75], MAT.steel); }   // 雙缸＋缸頭
    block(root, [120, 110, 130], [150, 105, 0], MAT.steel);                                   // 曲軸箱
    const label = addPlate(root, P.label, { w: 320, h: 50, pos: [0, 420, -172], rotY: Math.PI });
    return { root, params: P, base, motor, heads, label };
  },
};

// ---------------------------------------------------------------- 儲氣筒（直立）
// 原點：三支腳的底面中心。筒身由 y 130 起；壓力表在 −Z 面，安全閥在頂部 +X 側。
const TANK_RED = std(0xc23b2f, .45, .3);
export const airTank = {
  meta: {
    id: 'air-tank', name: '儲氣筒（直立，含壓力表與安全閥）', category: '氣動與公用', source: 'RecycleSorter',
    params: {
      radius: { value: 160, min: 80, max: 400, step: 10, unit: 'mm', label: '筒身半徑' },
      height: { value: 420, min: 200, max: 1500, step: 10, unit: 'mm', label: '筒身（直段）高度' },
    },
    options: {
      material: '筒身與封頭的材質（預設紅色 0xc23b2f）',
      label: 'false（預設）；{ lines, w=190, h=50, pos=[0,250,−radius−4], rotY=π, options }：直立標示牌',
      name: 'root 的名稱（預設 air-tank）',
    },
    usage: "import { airTank } from '@core/models/equipment.js';\nconst t = airTank.create({ label: { lines: ['儲氣筒'] } }); t.root.position.set(x, 地面, z); parent.add(t.root);\n// t.body 是筒身，t.gauge 是壓力表面，t.valve 是安全閥",
  },
  create(p = {}) {
    const P = { ...defaults(airTank.meta), ...p };
    const root = group(P.name ?? 'air-tank', 'air-tank'), mat = P.material ?? TANK_RED, tr = P.radius, H = P.height;
    for (let k = 0; k < 3; k++) { const a = k * 2.094 + .5; block(root, [40, 90, 40], [Math.cos(a) * (tr - 50), 45, Math.sin(a) * (tr - 50)], MAT.steelDark); }   // 腳
    const body = cylinder(root, tr, H, [0, 130 + H / 2, 0], mat, 'y', 32);                    // 筒身
    cylinder(root, tr - 60, 46, [0, 107, 0], mat, 'y', 32, tr);                               // 下封頭
    cylinder(root, tr, 46, [0, 130 + H + 23, 0], mat, 'y', 32, tr - 60);                      // 上封頭
    const gauge = cylinder(root, 34, 16, [0, 130 + H / 2 + 80, -tr - 8], MAT.cap, 'z', 20);   // 壓力表
    cylinder(root, 8, 30, [0, 130 + H / 2 + 80, -tr + 6], MAT.steel, 'z', 10);
    const valve = cylinder(root, 12, 40, [70, 130 + H + 62, 0], MAT.steel, 'y', 12);          // 安全閥
    const label = addPlate(root, P.label, { w: 190, h: 50, pos: [0, 250, -tr - 4], rotY: Math.PI });
    return { root, params: P, body, gauge, valve, label };
  },
};

// ---------------------------------------------------------------- 氣源分配座（含調壓、過濾，示意）
// 原點：座體中心；長邊沿 X，壓力表與標示朝 −Z，固定座在 +Z 側（貼背板）。座體網格名稱是 air manifold。
export const airManifold = {
  meta: {
    id: 'air-manifold', name: '氣源分配座（含調壓表）', category: '氣動與公用', source: 'RecycleSorter',
    params: {
      length: { value: 560, min: 120, max: 1200, step: 10, unit: 'mm', label: '座體長度' },
    },
    options: {
      mounts: 'false 不裝；{ xs=[−120,120], size=[40,30,15], z=32.5（中心） }：固定在背板上的座',
      label: 'false（預設）；{ lines, w=240, h=26, pos=[0,−36,−26], rot=[0,π,0], options }：文字貼紙（shapes.js 的 decal）',
      name: 'root 的名稱（預設 air-manifold-unit）',
    },
    usage: "import { airManifold } from '@core/models/equipment.js';\nconst m = airManifold.create(); m.root.position.set(x, y, 背板 z − 40); parent.add(m.root);\n// m.body（名稱 air manifold）、m.gauge、m.mounts 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(airManifold.meta), ...p };
    const root = group(P.name ?? 'air-manifold-unit', 'air-manifold');
    const body = block(root, [P.length, 40, 50], [0, 0, 0], MAT.steel); body.name = 'air manifold';
    const mo = P.mounts === undefined || P.mounts === true ? {} : P.mounts, mounts = [];
    if (mo) for (const x of mo.xs ?? [-120, 120]) mounts.push(block(root, mo.size ?? [40, 30, 15], [x, 0, mo.z ?? 32.5], MAT.steelDark));
    const gauge = cylinder(root, 26, 12, [0, 0, -31], MAT.cap, 'z', 18);
    const label = addDecal(root, P.label, { w: 240, h: 26, pos: [0, -36, -26], rot: [0, Math.PI, 0] });
    return { root, params: P, body, mounts, gauge, label };
  },
};

// ---------------------------------------------------------------- 櫃側散熱風扇
// 原點：風扇框中心；框的薄邊沿 X（裝在 ±X 的側板內面），葉輪蓋在 facing 那一側凸出。
export const cabinetFan = {
  meta: {
    id: 'cabinet-fan', name: '櫃側散熱風扇', category: '電控周邊', source: 'RecycleSorter',
    params: {
      size: { value: 120, min: 40, max: 250, step: 5, unit: 'mm', label: '框邊長' },
      depth: { value: 20, min: 10, max: 60, step: 1, unit: 'mm', label: '框厚' },
      facing: { value: 1, min: -1, max: 1, step: 2, label: '葉輪蓋朝向（+1：+X，−1：−X）' },
    },
    options: { hub: '{ r=46, t=6, offset=12（中心離框中心）, segments=20 }：葉輪蓋', name: 'root 的名稱（預設 cabinet-fan）' },
    usage: "import { cabinetFan } from '@core/models/equipment.js';\nconst f = cabinetFan.create({ facing: -1 }); f.root.position.set(側板內面 x ± 10, y, z); cabinet.add(f.root);",
  },
  create(p = {}) {
    const P = { ...defaults(cabinetFan.meta), ...p };
    const root = group(P.name ?? 'cabinet-fan', 'cabinet-fan'), h = P.hub ?? {};
    const frame = block(root, [P.depth, P.size, P.size], [0, 0, 0], MAT.black);
    const hub = cylinder(root, h.r ?? 46, h.t ?? 6, [P.facing * (h.offset ?? 12), 0, 0], MAT.steelDark, 'x', h.segments ?? 20);
    return { root, params: P, frame, hub };
  },
};

// ---------------------------------------------------------------- 教導器（FlexPendant 型）與掛座
// 原點：掛座底面中心；教導器斜放在座上（繞 X 往後仰 tilt），螢幕朝上偏 −Z，急停在 −X 側。固定尺寸。
const PENDANT_GREY = std(0xc9ced2, .6, .2), PENDANT_WHITE = std(0xe4e6e3, .5, 0);
export const teachPendant = {
  meta: {
    id: 'teach-pendant', name: '教導器與掛座（FlexPendant 型）', category: '電控周邊', source: 'RecycleSorter',
    params: {
      tilt: { value: .5, min: 0, max: 1.2, step: .05, unit: 'rad', label: '後仰角' },
    },
    options: {
      holderMaterial: '掛座材質（預設淺灰 0xc9ced2）', bodyMaterial: '教導器機身材質（預設白 0xe4e6e3）',
      name: 'root 的名稱（預設 teach-pendant）',
    },
    usage: "import { teachPendant } from '@core/models/equipment.js';\nconst tp = teachPendant.create(); tp.root.position.set(x, 架頂, z); parent.add(tp.root);\n// tp.holder、tp.body、tp.screen、tp.estop 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(teachPendant.meta), ...p };
    const root = group(P.name ?? 'teach-pendant', 'teach-pendant');
    const holder = block(root, [190, 50, 150], [0, 25, 0], P.holderMaterial ?? PENDANT_GREY);
    const body = block(root, [290, 26, 190], [0, 96, -20], P.bodyMaterial ?? PENDANT_WHITE); body.rotation.x = -P.tilt;
    const screen = block(root, [180, 4, 120], [30, 104, -34], MAT.black); screen.rotation.x = -P.tilt;
    const estop = cylinder(root, 16, 22, [-120, 130, 30], MAT.red, 'y', 16);                   // 教導器急停
    return { root, params: P, holder, body, screen, estop };
  },
};

// ---------------------------------------------------------------- 離子風嘴（靜電消除器）
// 原點：機身底面中心（安裝面）；噴頭朝 +X，標示在 +Z 面。
export const ionizer = {
  meta: {
    id: 'ionizer', name: '離子風嘴（靜電消除）', category: '製程設備', source: 'shutter assembly',
    params: {
      w: { value: 16, min: 8, max: 60, step: 1, unit: 'mm', label: '機身寬／深' },
      h: { value: 40, min: 15, max: 150, step: 1, unit: 'mm', label: '機身高' },
      nozzleR: { value: 4, min: 1, max: 15, step: .5, unit: 'mm', label: '噴頭半徑' },
      nozzleL: { value: 18, min: 5, max: 80, step: 1, unit: 'mm', label: '噴頭長' },
    },
    options: {
      nozzle: '{ x=12, y=36, segments=12 }：噴頭中心位置（預設值對應 16 × 40 的機身）',
      label: "false 不貼；{ lines='ION', w=14, h=6, pos=[0,28,8.7], rot, options={ color:'#2c5f86', center:true } }：文字貼紙",
      material: '機身材質（預設 MAT.cabinet）', nozzleMaterial: '噴頭材質（預設 MAT.black）',
      name: 'root 的名稱（預設 ionizer）',
    },
    usage: "import { ionizer } from '@core/models/equipment.js';\nconst ion = ionizer.create(); ion.root.position.set(x, 台面, z); parent.add(ion.root);\n// ion.body、ion.nozzle 是網格（要列入避讓清單時用這兩個）",
  },
  create(p = {}) {
    const P = { ...defaults(ionizer.meta), ...p };
    const root = group(P.name ?? 'ionizer', 'ionizer'), n = P.nozzle ?? {};
    const body = block(root, [P.w, P.h, P.w], [0, P.h / 2, 0], P.material ?? MAT.cabinet);
    const nozzle = cylinder(root, P.nozzleR, P.nozzleL, [n.x ?? 12, n.y ?? 36, 0], P.nozzleMaterial ?? MAT.black, 'x', n.segments ?? 12);
    const label = addDecal(root, P.label === undefined || P.label === true ? {} : P.label, { lines: 'ION', w: 14, h: 6, pos: [0, 28, 8.7], options: { color: '#2c5f86', center: true } });
    return { root, params: P, body, nozzle, label };
  },
};

// ---------------------------------------------------------------- 操作電腦（螢幕＋腳座＋鍵盤）
// 原點：桌面上、螢幕腳座旁；螢幕朝 +Z（操作者），鍵盤在螢幕前方。畫面是 liveScreen，用 screen.draw(key, fn) 更新。固定尺寸。
const KEY_GREY = new THREE.MeshStandardMaterial({ color: 0x8c949c, roughness: .5, metalness: .2 });
export const operatorPc = {
  meta: {
    id: 'operator-pc', name: '操作電腦（螢幕＋鍵盤）', category: '指示與操作', source: 'AutomaticAcid-BaseTitration',
    params: {},
    options: {
      material: '機身材質（預設 MAT.black）', keyMaterial: '鍵帽材質（預設灰 0x8c949c）',
      canvas: '畫面解析度 [寬, 高]（預設 [1000, 610]）', screenFallback: '沒有 canvas 時（Node）畫面網格的材質',
      name: 'root 的名稱（預設 operator-pc）',
    },
    usage: "import { operatorPc } from '@core/models/equipment.js';\nconst pc = operatorPc.create(); pc.root.position.set(x, 桌面, z); parent.add(pc.root);\npc.screen.draw(key, (ctx, w, h) => { /* 畫面；key 沒變就不重畫 */ });   // pc.monitor、pc.keyboard 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(operatorPc.meta), ...p };
    const root = group(P.name ?? 'operator-pc', 'operator-pc'), mat = P.material ?? MAT.black, keyMat = P.keyMaterial ?? KEY_GREY;
    block(root, [160, 10, 120], [0, 5, -20], mat); block(root, [30, 280, 20], [0, 150, -40], mat);          // 腳座、立柱
    const monitor = block(root, [400, 250, 24], [0, 300, -30], mat);
    const [cw, ch] = P.canvas ?? [1000, 610];
    const screen = liveScreen(384, 234, cw, ch, P.screenFallback ? { fallback: P.screenFallback } : {}); screen.mesh.position.set(0, 300, -16.8); root.add(screen.mesh);
    const keyboard = block(root, [300, 12, 90], [-20, 6, 45], mat);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 14; col++) block(root, [16, 1.2, 14], [-153 + col * 20, 12.5, 15 + row * 19], keyMat);
    return { root, params: P, monitor, screen, keyboard };
  },
};

// ---------------------------------------------------------------- 安全雷射掃描器（地面）＋減速區／停止區
// 原點：機身底面中心（地面）；保護區是朝 +Z 的半圓。兩片區域只是示意（userData.fx，不列入干涉）。
const ZONE_WARN = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide });
const ZONE_STOP = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide });
export const safetyScanner = {
  meta: {
    id: 'safety-scanner', name: '安全雷射掃描器（含減速區、停止區）', category: '感測與安全', source: 'AutomaticAcid-BaseTitration',
    params: {
      warn: { value: 1500, min: 300, max: 5000, step: 50, unit: 'mm', label: '減速區半徑' },
      stop: { value: 700, min: 200, max: 3000, step: 50, unit: 'mm', label: '停止區半徑' },
    },
    states: { zones: { value: 1, min: 0, max: 1, step: 1, label: '顯示保護區' } },
    options: {
      size: '機身 [寬, 高, 深]（預設 [110, 150, 110]）', material: '機身材質（預設 MAT.yellow）',
      arc: '保護區張角（rad，預設 π）', segments: '保護區圓周分段（預設 48）',
      warnMaterial: '減速區材質（預設橘色半透明）', stopMaterial: '停止區材質（預設紅色半透明）',
      zoneY: '兩片區域離地高度 [減速, 停止]（預設 [3, 4]）',
      name: 'root 的名稱（預設 safety-scanner）',
    },
    usage: "import { safetyScanner } from '@core/models/equipment.js';\nconst s = safetyScanner.create(); s.root.position.set(x, 0, z); parent.add(s.root);\ns.set({ zones: 0 });   // 隱藏保護區；s.body 是機身，s.zones = [減速區, 停止區]（不是實體，專案的 verify.skip 不必再列）",
  },
  create(p = {}) {
    const P = { ...defaults(safetyScanner.meta), ...p };
    const root = group(P.name ?? 'safety-scanner', 'safety-scanner');
    const [w, h, d] = P.size ?? [110, 150, 110], arc = P.arc ?? Math.PI, seg = P.segments ?? 48, [yw, ys] = P.zoneY ?? [3, 4];
    const body = block(root, [w, h, d], [0, h / 2, 0], P.material ?? MAT.yellow);
    const zone = (r, mat, y) => { const m = new THREE.Mesh(new THREE.RingGeometry(0, r, seg, 1, 0, arc), mat); m.rotation.x = Math.PI / 2; m.position.y = y; m.userData.fx = true; root.add(m); return m; };
    const zones = [zone(P.warn, P.warnMaterial ?? ZONE_WARN, yw), zone(P.stop, P.stopMaterial ?? ZONE_STOP, ys)];   // 半圓朝 +Z
    function set(v) { if (v !== null && typeof v === 'object') v = v.zones; for (const z of zones) z.visible = !!v; }
    return { root, params: P, body, zones, set };
  },
};
