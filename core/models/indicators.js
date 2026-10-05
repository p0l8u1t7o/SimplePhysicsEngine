// 指示與操作用的市購小件：三色燈（signal-tower）、人機介面（hmi）、急停／復歸按鈕（estop）。
// 這些原本各站自己畫；幾何、分段數、位置與材質都能用參數重現各站原樣（換用對照見 core/MIGRATION.md 1.9.0）。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、陣列、子物件設定）。
import * as THREE from 'three';
import { block, cylinder, decal, HAS_DOM } from '../geom/shapes.js';
import { MAT, std } from '../geom/materials.js';
import { housing } from '../geom/hardware.js';
import { defaults, shadow, pick } from './util.js';

// root.userData.coreModel＝模型 id：走線（cable 的線夾固定面）與全場檢查（安裝關係）靠它認得共用模型的根群組
const group = (name, id) => { const g = new THREE.Group(); g.name = name; g.userData.coreModel = id; return g; };

// ---------------------------------------------------------------- 三色燈
// 原點：安裝點（預設是燈桿底端）；燈節沿 +Y 疊放，lamps 由上而下列出。
// 燈節 y（中心）＝ base ＋（由下數第幾個）× pitch；base 預設是燈桿頂＋半個燈節高。
const LAMP_ALIAS = { yellow: 'amber' };
export const signalTower = {
  meta: {
    id: 'signal-tower', name: '三色燈', category: '指示與操作',
    source: 'PCB-CopperAssembly、WorkpieceMeasurement、RecycleSorter、MilitaryGradePC、RobotArmPressSSD、ChemicalTankWashing、shutter assembly',
    params: {
      radius: { value: 22, min: 10, max: 60, step: 1, unit: 'mm', label: '燈節半徑' },
      height: { value: 34, min: 15, max: 120, step: 1, unit: 'mm', label: '燈節高度' },
      pitch: { value: 35, min: 15, max: 130, step: 1, unit: 'mm', label: '燈節間距' },
      poleR: { value: 8, min: 0, max: 40, step: 1, unit: 'mm', label: '燈桿半徑（0 不裝）' },
      poleH: { value: 80, min: 0, max: 2000, step: 10, unit: 'mm', label: '燈桿長度' },
    },
    states: { lit: { value: 3, min: 0, max: 3, step: 1, label: '亮燈（0 全滅，1～3 由上而下）' } },
    options: {
      lamps: "由上而下的燈節：鍵名字串，或 { key, y?, material?: 'red'|'amber'|'green'|Material, color?: 0x… }；預設 ['red','yellow','green']",
      base: '最下面燈節的中心高度（預設：燈桿頂＋height/2）',
      segments: '燈節圓周分段（預設 20）',
      materials: '{ 鍵名: Material }：外部材質原樣使用（不複製，建立時不改亮度）',
      colors: '{ 鍵名: 0x… }＋lens { roughness=1, metalness=0, opacity=1 }：依顏色建立燈罩材質（emissive 同色）',
      on: '亮燈的 emissiveIntensity（預設 1.6）', off: '熄燈的 emissiveIntensity（預設 0.08）',
      pole: 'false 不裝；{ r, h, y（中心）, segments=20, material=MAT.frame }；方桿用 { size:[w,h,d], y, material }',
      shadow: 'true／false 或 { lamps, pole }（預設都投影）',
      name: 'root 的名稱（預設 signal-tower）',
    },
    usage: "import { signalTower } from '@core/models/indicators.js';\nconst tower = signalTower.create({ poleH: 300 }); tower.root.position.set(x, y, z); scene.add(tower.root);\ntower.set('green');   // 鍵名、編號（1 起算，由上而下）或 null（全滅）；tower.lamps.red、tower.lampList、tower.pole 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(signalTower.meta), lamps: ['red', 'yellow', 'green'], segments: 20, on: 1.6, off: .08, ...p };
    const root = group(P.name ?? 'signal-tower', 'signal-tower');
    // 燈桿
    let pole = null, poleTop = 0;
    const po = P.pole === undefined ? (P.poleR > 0 && P.poleH > 0 ? {} : false) : P.pole === true ? {} : P.pole;
    if (po) {
      const mat = po.material ?? MAT.frame;
      if (po.size) { const y = po.y ?? po.size[1] / 2; pole = block(root, po.size, [0, y, 0], mat); poleTop = y + po.size[1] / 2; }
      else { const h = po.h ?? P.poleH, y = po.y ?? h / 2; pole = cylinder(root, po.r ?? P.poleR, h, [0, y, 0], mat, 'y', po.segments ?? 20); poleTop = y + h / 2; }
      pole.name = 'tower pole'; shadow(pole, pick(P.shadow, 'pole'));
    }
    // 燈節
    const entries = P.lamps.map(e => typeof e === 'string' ? { key: e } : e), n = entries.length;
    const base = P.base ?? poleTop + P.height / 2;
    const material = e => {
      const given = e.material ?? P.materials?.[e.key];
      if (given?.isMaterial) return given;                              // 外部材質：原樣使用（可能是共用材質，建立時不改）
      const color = e.color ?? P.colors?.[e.key];
      if (color != null) {
        const L = P.lens || {}, opacity = L.opacity ?? 1;
        return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: P.off, roughness: L.roughness ?? 1, metalness: L.metalness ?? 0, transparent: opacity < 1, opacity });
      }
      const name = typeof given === 'string' ? given : e.key, src = MAT[LAMP_ALIAS[name] ?? name];
      if (!src?.emissive) throw new Error(`signal-tower: lamp "${e.key}" needs a material or a color`);
      const m = src.clone(); m.emissiveIntensity = P.off; return m;       // 共用指示燈材質各複製一份，亮暗各自控制
    };
    const geo = new THREE.CylinderGeometry(P.radius, P.radius, P.height, P.segments);
    const lamps = {}, lampList = [], lampShadow = pick(P.shadow, 'lamps');
    entries.forEach((e, i) => {
      const m = shadow(new THREE.Mesh(geo, material(e)), lampShadow);
      m.name = 'lamp ' + e.key; m.position.y = e.y ?? base + (n - 1 - i) * P.pitch; root.add(m);
      lamps[e.key] = m; lampList.push(m);
    });
    const keys = entries.map(e => e.key);
    let lit = null;
    // 亮哪一顆：鍵名、編號（1 起算，由上而下；0 全滅）、{ lit } 或 null
    function set(k) {
      if (k !== null && typeof k === 'object') k = k.lit;
      if (typeof k === 'number') k = keys[Math.round(k) - 1];
      lit = k ?? null;
      for (const key of keys) lamps[key].material.emissiveIntensity = key === lit ? P.on : P.off;
    }
    return { root, params: P, lamps, lampList, pole, keys, set, get lit() { return lit; } };
  },
};

// ---------------------------------------------------------------- 人機介面
// 原點：機身中心；螢幕朝 +Z。要傾斜或轉向時旋轉 root。
// 組成（都可以關掉）：機身（方塊或倒角外殼）、螢幕面板（panel，發光材質的薄板）、動態畫面（display，canvas 貼圖）、固定文字（text，decal）。
export const hmi = {
  meta: {
    id: 'hmi', name: '人機介面（HMI）', category: '指示與操作',
    source: 'PCB-CopperAssembly、WorkpieceMeasurement、RecycleSorter、MilitaryGradePC、RobotArmPressSSD、ChemicalTankWashing、shutter assembly',
    params: {
      w: { value: 380, min: 100, max: 800, step: 10, unit: 'mm', label: '寬' },
      h: { value: 280, min: 80, max: 600, step: 10, unit: 'mm', label: '高' },
      d: { value: 50, min: 10, max: 120, step: 2, unit: 'mm', label: '厚' },
      bevel: { value: 10, min: 0, max: 20, step: 1, unit: 'mm', label: '外殼倒角（0 為方塊）' },
    },
    options: {
      bodyMaterial: '機身材質（預設 MAT.cabinet；整塊就是螢幕的站傳 MAT.screen）',
      panel: 'false 不裝；{ w=w−20, h=h−30, t=6, z=d/2+1（中心）, material=MAT.screen }',
      display: 'false（預設）；true 或 { w, h, z, canvas:[寬,高]=[960,540], mipmaps=true, anisotropy }：canvas 貼圖的畫面，用 draw(fn) 更新',
      text: 'false（預設）；{ lines, w, h, z=最前面+1, options }：固定文字貼紙（shapes.js 的 decal，options 原樣傳入）',
      name: 'root 的名稱（預設 hmi）',
    },
    usage: "import { hmi } from '@core/models/indicators.js';\nconst panel = hmi.create({ display: true }); panel.root.position.set(x, 1500, z); scene.add(panel.root);\npanel.drawText(['標題', '運轉中', '節拍 12.0 s']);          // 內建文字畫面\npanel.draw((ctx, canvas) => { /* 自己畫 */ });             // 畫完自動 texture.needsUpdate\n// panel.body、panel.panel、panel.display、panel.label 是網格；panel.canvas、panel.ctx、panel.texture 可直接用",
  },
  create(p = {}) {
    const P = { ...defaults(hmi.meta), ...p };
    const root = group(P.name ?? 'hmi', 'hmi');
    const { w, h, d } = P, mat = P.bodyMaterial ?? MAT.cabinet;
    const body = P.bevel > 0 ? housing(root, w, h, d, mat, 0, 0, 0, P.bevel) : block(root, [w, h, d], [0, 0, 0], mat);
    body.name = 'hmi body';
    let face = d / 2, panel = null, pw = w, ph = h;                       // face：目前最前面的 Z
    const po = P.panel === undefined || P.panel === true ? {} : P.panel;
    if (po) {
      const t = po.t ?? 6, z = po.z ?? d / 2 + 1; pw = po.w ?? w - 20; ph = po.h ?? h - 30;
      panel = block(root, [pw, ph, t], [0, 0, z], po.material ?? MAT.screen); panel.name = 'hmi screen'; face = z + t / 2;
    }
    // 動態畫面：Node 檢查端由 dom-stub 提供 canvas（幾何相同、內容空白）
    let display = null, canvas = null, ctx = null, texture = null;
    const dp = P.display === true ? {} : P.display;
    if (dp && HAS_DOM) {
      const [cw, ch] = dp.canvas ?? [960, 540];
      canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch; ctx = canvas.getContext('2d');
      texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      if (dp.mipmaps === false) { texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; }   // 常更新的畫面不必每次重建 mipmap
      texture.anisotropy = dp.anisotropy ?? (dp.mipmaps === false ? 1 : 4);
      display = new THREE.Mesh(new THREE.PlaneGeometry(dp.w ?? pw - (panel ? 12 : 30), dp.h ?? ph - (panel ? 12 : 30)), new THREE.MeshBasicMaterial({ map: texture }));
      display.name = 'hmi display'; display.position.z = dp.z ?? face + (panel ? 1.5 : .75); root.add(display);
    }
    let label = null;
    if (P.text && HAS_DOM) {
      const t = P.text;
      label = decal(root, t.w ?? pw - 20, t.h ?? ph - 20, [0, 0, t.z ?? face + 1], [0, 0, 0], t.lines, t.options ?? {}); label.name = 'hmi label';
    }
    const draw = fn => { if (!ctx) return; fn(ctx, canvas); texture.needsUpdate = true; };
    // 內建文字畫面：第一行是標題列，第二行用強調色，其餘用次要色；版面以 680×410 為基準，依畫布高度等比例縮放
    function drawText(lines, { bg = '#0a1622', bar = '#12304a', title = '#dcecf7', accent = '#7fe0b4', fg = '#a9c0d2', font = '"Microsoft JhengHei",sans-serif' } = {}) {
      draw((g, c) => {
        const k = c.height / 410;
        g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.fillStyle = bar; g.fillRect(0, 0, c.width, 54 * k);
        g.fillStyle = title; g.font = `600 ${26 * k}px ${font}`; g.fillText(lines[0], 18 * k, 36 * k);
        g.font = `${22 * k}px ${font}`; lines.slice(1).forEach((s, i) => { g.fillStyle = i === 0 ? accent : fg; g.fillText(s, 18 * k, (96 + i * 38) * k); });
      });
    }
    return { root, params: P, body, panel, display, label, canvas, ctx, texture, draw, drawText };
  },
};

// ---------------------------------------------------------------- 急停／復歸按鈕
// 原點：安裝面上的按鈕中心；按鈕軸朝 +Z（朝操作者）。底座環（collar）與按鈕頭（cap）都是圓柱，另可加按鈕盒（box）。
const ESTOP_RED = std(0xd53730, 1, 0);
export const estop = {
  meta: {
    id: 'estop', name: '急停按鈕（含復歸鈕）', category: '指示與操作',
    source: 'MilitaryGradePC、RobotArmPressSSD、shutter assembly、RecycleSorter',
    params: {
      collarR: { value: 22, min: 8, max: 40, step: 1, unit: 'mm', label: '底座環半徑' },
      collarH: { value: 12, min: 4, max: 30, step: 1, unit: 'mm', label: '底座環厚' },
      capR: { value: 15, min: 6, max: 36, step: 1, unit: 'mm', label: '按鈕頭半徑' },
      capH: { value: 18, min: 6, max: 40, step: 1, unit: 'mm', label: '按鈕頭厚' },
      reset: { value: 0, min: 0, max: 1, step: 1, label: '復歸鈕（1：綠色）' },
    },
    options: {
      collarZ: '底座環中心的 Z（預設 collarH/2，貼在安裝面上）',
      capZ: '按鈕頭中心的 Z（預設 collarZ＋collarH/2＋capH/2−5：按鈕頭後段 5 mm 套在底座環裡）',
      segments: '圓周分段（預設 20）',
      collarMaterial: '預設 MAT.yellow（復歸鈕 MAT.green）', capMaterial: '預設紅色 0xd53730 不發光（復歸鈕 MAT.green）',
      box: 'false（預設）；true 或 { size:[w,h,d], z（中心，預設貼在底座環背面）, material=MAT.cabinet }：按鈕盒',
      name: 'root 的名稱（預設 estop／reset-button）',
    },
    usage: "import { estop } from '@core/models/indicators.js';\nconst e = estop.create(); e.root.position.set(x, 1150, 面板的 Z); scene.add(e.root);\nconst r = estop.create({ reset: 1, collarR: 13, capR: 10, capH: 14, box: { size: [52, 65, 16] } });   // 復歸鈕＋按鈕盒",
  },
  create(p = {}) {
    const P = { ...defaults(estop.meta), segments: 20, ...p };
    const reset = !!P.reset;
    const root = group(P.name ?? (reset ? 'reset-button' : 'estop'), 'estop');
    const collarZ = P.collarZ ?? P.collarH / 2, capZ = P.capZ ?? collarZ + P.collarH / 2 + P.capH / 2 - 5;
    let box = null;
    if (P.box) {
      const b = P.box === true ? {} : P.box, size = b.size ?? [P.collarR * 3.4, P.collarR * 3.4, 16];
      box = block(root, size, [0, 0, b.z ?? collarZ - P.collarH / 2 - size[2] / 2], b.material ?? MAT.cabinet); box.name = 'button box';
    }
    const collar = cylinder(root, P.collarR, P.collarH, [0, 0, collarZ], P.collarMaterial ?? (reset ? MAT.green : MAT.yellow), 'z', P.segments); collar.name = 'button collar';
    const cap = cylinder(root, P.capR, P.capH, [0, 0, capZ], P.capMaterial ?? (reset ? MAT.green : ESTOP_RED), 'z', P.segments); cap.name = 'button cap';
    return { root, params: P, collar, cap, box };
  },
};
