// 視覺用的市購品：工業相機（vision-camera）、固定式讀碼器（code-reader）、線雷射輪廓儀（laser-profiler）。
// 這些原本各站自己畫；幾何型別、分段數、尺寸、位置、材質與陰影旗標都能用參數重現各站原樣（換用對照見 core/migrations/1.10.0-vision.md）。
// 既有的 camera.js（依感光元件與焦距決定外形與視角）外觀與用法不變；這裡的相機是「逐件設定」，給已經有固定外形的站換用。
// 條形光、穹頂光在 lights.js；相機旁的條形光由站內另外建立後加到相機的 root。
//
// 共同慣例：
//   axis   光軸方向：'-y'（朝下）、'+y'、'+z'、'-z'；其他方向旋轉 root。
//   at     零件中心在光軸上的座標（朝被攝物為正，從 root 原點量起）。原點由使用者決定：
//          相機預設在鏡頭前緣（機身在負側）；裝在手臂法蘭上的可以把原點放在法蘭面（各件 at 為正）。
//   size   截面 [a, b]：a 沿 X；b 在 Y 軸相機沿 Z、在 Z 軸相機沿 Y。
//   材質   可由外部傳入（原樣使用、不複製，建立時不改亮度）；shadow 可為布林或 { cast, receive }。
//   結構   實體網格都直接掛在 root 底下（螺絲是 shapes.js 的 screw 群組）；root.userData.coreModel＝模型 id。
// meta.params 是目錄頁可調的數值參數；meta.options 是只能由程式傳入的選項（材質、陣列、子物件設定）。
import * as THREE from 'three';
import { block, cylinder, bevelBox, screw, decal, HAS_DOM } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { defaults, pick } from './util.js';

const group = (name, id) => { const g = new THREE.Group(); g.name = name; g.userData.coreModel = id; return g; };
const level = v => v === true ? 1 : Math.min(1, Math.max(0, +v || 0));
const value = (v, key) => v !== null && typeof v === 'object' ? v[key] : v;
// 子物件選項：false／null 不裝；undefined／true 用預設；物件則逐欄蓋過預設
const part = (v, base) => v === false || v === null ? null : v === undefined || v === true ? (base ? { ...base } : null) : { ...base, ...v };
const flags = (m, v, fallback = true) => { m.castShadow = pick(v, 'cast', fallback); m.receiveShadow = pick(v, 'receive', fallback); return m; };

// 光軸座標系：at(沿光軸, 橫向 u, 橫向 v) → [x, y, z]；box(截面, 長度) → 方塊尺寸
const AXES = { '+y': ['y', 1], '-y': ['y', -1], '+z': ['z', 1], '-z': ['z', -1] };
function frame(axis) {
  const def = AXES[axis]; if (!def) throw new Error(`vision: axis must be one of ${Object.keys(AXES).join(' ')}`);
  const Y = def[0] === 'y', s = def[1], along = a => s > 0 ? a : a === 0 ? 0 : -a;
  return {
    Y, s, letter: def[0],
    at: (a = 0, u = 0, v = 0) => Y ? [u, along(a), v] : [u, v, along(a)],
    box: ([a, b], length) => Y ? [a, length, b] : [a, b, length],
    dir: new THREE.Vector3(0, Y ? s : 0, Y ? 0 : s),
  };
}
// 圓柱（實心）或套筒（bore > 0：環形截面擠出，例如遠心鏡筒、環形光外殼）
function barrel(root, F, o, material, name) {
  let m;
  if (o.bore > 0) {
    const shape = new THREE.Shape(); shape.absarc(0, 0, o.r, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, o.bore, 0, Math.PI * 2, true); shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: o.length, bevelEnabled: false, curveSegments: o.segments ?? 32 });
    if (F.Y) geo.rotateX(-Math.PI / 2);
    m = new THREE.Mesh(geo, material);
    const p = F.at(o.at); p[F.Y ? 1 : 2] -= o.length / 2;       // 擠出固定朝 +Y／+Z，網格位置是底端
    m.position.set(...p); root.add(m);
  } else m = cylinder(root, o.r, o.length, F.at(o.at), material, F.letter, o.segments ?? 32);
  m.name = o.name ?? name;
  return flags(m, o.shadow);
}
const torus = (root, F, r, tube, segments, a, material) => {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, ...segments), material);
  if (F.Y) m.rotation.x = Math.PI / 2;
  m.position.set(...F.at(a)); root.add(m); return m;
};
const LENS_GLASS = new THREE.MeshPhysicalMaterial({ color: 0x203b50, metalness: .3, roughness: .09 });
const SPOT = { color: 0xffffff, distance: 900, angle: .6, penumbra: .5, decay: 1, at: 0, target: 500, power: 600 };
const VIEW = { fov: 20, aspect: 1.5, near: 1, far: 3000 };

// 相機與讀碼器共用的組裝：機身、鏡頭、調焦環、保護玻璃、環形光（含外殼）、閃光燈、虛擬相機、螺絲、標籤
function assemble(root, F, P, D) {
  const out = { body: null, lens: null, bands: [], glass: null, ring: null, ringHousing: null, light: null, camera: null, screws: [], label: null };
  const mat = P.material ?? MAT.black;
  const bo = part(P.body, D.body), lo = part(P.lens, D.lens), ba = part(P.bands, D.bands), go = part(P.glass, D.glass);
  const ro = part(P.ring, D.ring), so = part(P.spot, D.spot), vo = part(P.view, D.view);
  if (bo) {
    const size = F.box(bo.size, bo.length), material = bo.material ?? mat;
    const m = bo.bevel > 0 ? bevelBox(...size, material, bo.bevel) : block(null, size, [0, 0, 0], material);
    m.position.set(...F.at(bo.at ?? 0, ...(bo.offset ?? [0, 0]))); m.name = bo.name ?? 'camera body'; root.add(m);
    out.body = flags(m, bo.shadow);
  }
  if (lo) out.lens = barrel(root, F, lo, lo.material ?? mat, 'lens barrel');
  if (ba) {
    // 調焦環／光圈環：tube > 0 是圓環（TorusGeometry），否則是薄圓柱；同一組共用幾何
    const ring = ba.tube > 0, material = ba.material ?? MAT.alu;
    const geo = ring ? new THREE.TorusGeometry(ba.r, ba.tube, ...(ba.segments ?? [6, 40])) : new THREE.CylinderGeometry(ba.r, ba.r, ba.length, ba.segments ?? 40);
    for (const a of ba.ats) {
      const m = new THREE.Mesh(geo, material);
      if (ring ? F.Y : !F.Y) m.rotation.x = Math.PI / 2;
      m.position.set(...F.at(a)); m.name = ba.name ?? 'lens band'; root.add(m);
      out.bands.push(flags(m, ba.shadow, !ring));
    }
  }
  if (go) {
    const m = cylinder(root, go.r, go.length, F.at(go.at), go.material ?? LENS_GLASS, F.letter, go.segments ?? 32);
    m.name = go.name ?? 'lens glass'; out.glass = flags(m, go.shadow);
  }
  if (ro) {
    if (ro.housing) out.ringHousing = barrel(root, F, ro.housing, ro.housing.material ?? mat, 'ring light housing');
    const material = ro.material ?? new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: ro.off });
    const m = torus(root, F, ro.r, ro.tube, ro.segments, ro.at, material);
    m.name = ro.name ?? 'ring light'; out.ring = flags(m, ro.shadow, false);
  }
  if (so) {
    const light = so.type === 'point' ? new THREE.PointLight(so.color, 0, so.distance, so.decay) : new THREE.SpotLight(so.color, 0, so.distance, so.angle, so.penumbra, so.decay);
    light.position.set(...F.at(so.at)); root.add(light);
    if (light.target) { light.target.position.set(...F.at(so.target)); root.add(light.target); }
    out.light = light;
  }
  if (vo) {
    let cam;
    if (vo.type === 'orthographic') { const [w, h] = vo.size; cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, vo.near, vo.far); }
    else cam = new THREE.PerspectiveCamera(vo.fov, vo.aspect, vo.near, vo.far);
    cam.position.set(...F.at(vo.at ?? (go ? go.at + go.length / 2 + .1 : 0)));
    // 朝向：預設用歐拉角（畫面上方：Y 軸相機朝下為 −Z、朝上為 +Z；Z 軸相機為 +Y）；給 up 時用 lookAt 矩陣（畫面上方＝up）
    if (vo.up) { cam.up.set(...vo.up); cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), F.dir, cam.up)); }
    else if (F.Y) cam.rotation.x = F.s > 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (F.s > 0) cam.rotation.y = Math.PI;
    cam.name = vo.name ?? 'camera view'; root.add(cam); out.camera = cam;
  }
  if (P.screws) for (const p of P.screws.points) out.screws.push(screw(root, p, P.screws.r ?? 2, P.screws.axis ?? F.letter));
  if (P.label && HAS_DOM) {
    const t = P.label;
    out.label = decal(root, t.w, t.h, t.pos, t.rot ?? [0, 0, 0], t.lines, t.options ?? {}); out.label.name = 'camera label';
  }
  out.parts = [out.body, out.lens, ...out.bands, out.glass, out.ringHousing, out.ring].filter(Boolean);
  // 亮度 0～1（或布林）：環形光 emissiveIntensity 在 off～on 之間，閃光燈強度＝亮度 × power
  out.setLight = v => {
    const k = level(v);
    if (out.ring && ro.glow !== false) out.ring.material.emissiveIntensity = k >= 1 ? ro.on : k <= 0 ? ro.off : ro.off + (ro.on - ro.off) * k;
    if (out.light) out.light.intensity = k * so.power;
  };
  return out;
}

// ---------------------------------------------------------------- 工業相機（逐件設定）
// 預設：光軸朝下（−Y）、原點在鏡頭前緣；鏡頭、機身往 +Y 疊，保護玻璃凸出鏡頭前緣 1 mm，環形光套在鏡頭前緣，
// 閃光燈與虛擬相機在前緣。零件的預設位置由 lensL／bodyL 推算；改了某一件的 at，其他件不會跟著動。
export const visionCamera = {
  meta: {
    id: 'vision-camera', name: '工業相機（逐件設定：機身、鏡頭、環形光、閃光、虛擬相機）', category: '視覺',
    source: 'PCB-CopperAssembly、MilitaryGradePC、RobotArmPressSSD、ChemicalTankWashing、shutter assembly',
    params: {
      bodyW: { value: 44, min: 20, max: 120, step: 1, unit: 'mm', label: '機身寬' },
      bodyD: { value: 34, min: 20, max: 120, step: 1, unit: 'mm', label: '機身深' },
      bodyL: { value: 47, min: 20, max: 200, step: 1, unit: 'mm', label: '機身長（沿光軸）' },
      lensR: { value: 15, min: 6, max: 50, step: .5, unit: 'mm', label: '鏡頭半徑' },
      lensL: { value: 36, min: 8, max: 200, step: 1, unit: 'mm', label: '鏡頭長度' },
      ringR: { value: 34, min: 0, max: 150, step: 1, unit: 'mm', label: '環形光半徑（0 不裝）' },
      fov: { value: 20, min: 2, max: 90, step: 1, unit: '°', label: '虛擬相機垂直視角' },
    },
    states: { light: { value: 1, min: 0, max: 1, label: '光源與閃光亮度' } },
    options: {
      axis: "光軸方向 '-y'（預設）、'+y'、'+z'、'-z'",
      material: '機身、鏡頭、環形光外殼的預設材質（預設 MAT.black）；各件可用自己的 material 蓋過',
      body: 'false 不畫；{ size:[bodyW,bodyD], length=bodyL, at=−(lensL+bodyL/2), offset:[u,v], bevel（>0 用 bevelBox）, material, shadow, name }',
      lens: 'false 不畫；{ r=lensR, length=lensL, at=−lensL/2, segments=32, bore（>0 為套筒，例如遠心鏡筒）, material, shadow, name }',
      bands: '預設不畫；{ ats:[…], r, length（薄圓柱）或 tube（圓環）, segments=40 或 [6,40], material=MAT.alu, shadow, name }：調焦環',
      glass: 'false 不畫；{ r=lensR×.7, length=1, at=.5, segments=32, material（預設深藍鍍膜）, shadow, name }：保護玻璃',
      ring: 'false 不裝（或 ringR=0）；{ r=ringR, tube=5, at=0, segments=[8,36], material（預設白色 emissive，每台各一份）, on=1.4, off=.05, glow（false：set 不改材質亮度）, shadow=false, housing:{ r, bore, length, at, segments, material, shadow, name } }',
      spot: "false 不裝；{ type:'spot'|'point', color=0xffffff, distance=900, angle=.6, penumbra=.5, decay=1, at=0, target=500（沿光軸）, power=600 }：閃光燈",
      view: "false 不裝；{ type:'perspective'|'orthographic', fov, aspect=1.5, near=1, far=3000, size:[寬,高]（正交）, at（預設玻璃前 .1）, up:[x,y,z]（畫面上方；不給時用預設朝向）, name }：虛擬相機",
      screws: '預設不畫；{ points:[[x,y,z]…]（root 座標）, r=2, axis }：機身固定螺絲（shapes.js 的 screw）',
      label: '預設不畫；{ lines, w, h, pos:[x,y,z], rot:[x,y,z], options }：機身標籤（shapes.js 的 decal，root 座標）',
      name: 'root 的名稱（預設 vision-camera）',
    },
    usage: "import { visionCamera } from '@core/models/vision.js';\nconst cam = visionCamera.create({ ringR: 45, fov: 21 }); cam.root.position.set(x, 鏡頭前緣高度, z); scene.add(cam.root);\ncam.set(true);   // 亮度 0～1、布林或 { light }：環形光＋閃光燈一起亮\nworkspace.renderCamera({ renderer, scene, camera: cam.camera, title: '上視相機' });\n// cam.body、cam.lens、cam.bands、cam.glass、cam.ring、cam.ringHousing 是網格（cam.parts 是全部），cam.light 是閃光燈，cam.camera 是虛擬相機",
  },
  create(p = {}) {
    const P = { ...defaults(visionCamera.meta), axis: '-y', ...p };
    const root = group(P.name ?? 'vision-camera', visionCamera.meta.id);
    const o = assemble(root, frame(P.axis), { ...P, ring: P.ring === undefined ? P.ringR > 0 : P.ring }, {
      body: { size: [P.bodyW, P.bodyD], length: P.bodyL, at: -(P.lensL + P.bodyL / 2) },
      lens: { r: P.lensR, length: P.lensL, at: -P.lensL / 2 },
      glass: { r: P.lensR * .7, length: 1, at: .5 },
      ring: { r: P.ringR, tube: 5, at: 0, segments: [8, 36], on: 1.4, off: .05 },
      spot: SPOT, view: { ...VIEW, fov: P.fov },
    });
    const { setLight, ...refs } = o;
    return { root, params: P, ...refs, set(v) { setLight(value(v, 'light')); } };
  },
};

// ---------------------------------------------------------------- 固定式讀碼器
// 預設：光軸 +Z、原點在機身中心；讀碼光束是示意用的兩片（水平光帶 beam、機身底緣的扇形 fan），userData.fx 不列入干涉，
// 建立時隱藏，set(true) 顯示。鏡頭、閃光燈、虛擬相機預設不裝（選項與相機相同）。
const READ_BEAM = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: .8, side: THREE.DoubleSide });
export const codeReader = {
  meta: {
    id: 'code-reader', name: '固定式讀碼器（含讀碼光束）', category: '視覺',
    source: 'AutomaticAcid-BaseTitration、MilitaryGradePC',
    params: {
      w: { value: 60, min: 20, max: 150, step: 1, unit: 'mm', label: '機身寬' },
      h: { value: 40, min: 20, max: 150, step: 1, unit: 'mm', label: '機身高' },
      length: { value: 70, min: 20, max: 200, step: 1, unit: 'mm', label: '機身長（沿光軸）' },
      beamW: { value: 70, min: 10, max: 300, step: 5, unit: 'mm', label: '光束寬' },
      beamL: { value: 100, min: 20, max: 600, step: 10, unit: 'mm', label: '光束長' },
    },
    states: { scan: { value: 1, min: 0, max: 1, step: 1, label: '讀碼中（顯示光束）' } },
    options: {
      axis: "光軸方向 '+z'（預設）、'-z'、'+y'、'-y'",
      material: '機身與鏡頭的預設材質（預設 MAT.black）',
      body: '{ size:[w,h], length, at=0, bevel, material, shadow, name }',
      lens: '預設不裝；{ r, length, at, segments=32, material, shadow, name }',
      beam: 'false 不畫；{ w=beamW, length=beamL, at=length/2+beamL/2（中心）, drop=0（垂直光軸的偏移）, material }：水平光帶',
      fan: 'false 不畫；{ apex=length/2, far=length/2+beamL−10, halfWidth=beamW/2+5, drop=−h/2, material }：扇形光束（三角形）',
      beamMaterial: '兩片光束的預設材質（預設紅色半透明雙面；外部材質原樣使用）',
      spot: '預設不裝；{ color, distance, angle, penumbra, decay, at, target, power }：讀碼閃光（set 設定強度＝亮度 × power）',
      view: '預設不裝；選項同 vision-camera',
      name: 'root 的名稱（預設 code-reader）',
    },
    usage: "import { codeReader } from '@core/models/vision.js';\nconst reader = codeReader.create(); reader.root.position.set(x, 機身中心高度, z); scene.add(reader.root);\nreader.set(true);   // 布林、0～1 或 { scan }：顯示光束（有閃光燈時一起亮）\n// reader.body、reader.lens 是網格，reader.beam、reader.fan 是光束，reader.light 是閃光燈",
  },
  create(p = {}) {
    const P = { ...defaults(codeReader.meta), axis: '+z', ...p };
    const F = frame(P.axis), root = group(P.name ?? 'code-reader', codeReader.meta.id);
    const o = assemble(root, F, { ...P, lens: P.lens ?? false, glass: P.glass ?? false, ring: P.ring ?? false, spot: P.spot ?? false, view: P.view ?? false },
      { body: { size: [P.w, P.h], length: P.length, at: 0 }, ring: { tube: 5, at: 0, segments: [8, 36], on: 1.4, off: .05 }, spot: SPOT, view: VIEW });
    const be = part(P.beam, { w: P.beamW, length: P.beamL, at: P.length / 2 + P.beamL / 2, drop: 0 });
    const fa = part(P.fan, { apex: P.length / 2, far: P.length / 2 + P.beamL - 10, halfWidth: P.beamW / 2 + 5, drop: -P.h / 2 });
    let beam = null, fan = null;
    if (be) {
      beam = new THREE.Mesh(new THREE.PlaneGeometry(be.w, be.length), be.material ?? P.beamMaterial ?? READ_BEAM);
      if (!F.Y) beam.rotation.x = -Math.PI / 2;
      beam.position.set(...F.at(be.at, 0, be.drop)); beam.name = 'read beam'; beam.visible = false; beam.userData.fx = true; root.add(beam);
    }
    if (fa) {
      const pts = [F.at(fa.apex), F.at(fa.far, -fa.halfWidth), F.at(fa.far, fa.halfWidth)].map(q => new THREE.Vector3(...q));
      fan = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(pts), fa.material ?? P.beamMaterial ?? READ_BEAM);
      fan.geometry.setIndex([0, 1, 2]);
      fan.position.set(...F.at(0, 0, fa.drop)); fan.name = 'read fan'; fan.visible = false; fan.userData.fx = true; root.add(fan);
    }
    const { setLight, ...refs } = o;
    function set(v) {
      const k = level(value(v, 'scan'));
      if (beam) beam.visible = k >= .5;
      if (fan) fan.visible = k >= .5;
      setLight(k);
    }
    return { root, params: P, ...refs, beam, fan, set };
  },
};

// ---------------------------------------------------------------- 3D 線雷射輪廓儀
// 預設：光軸 +Z（朝被測面）、原點在機身中心；雷射窗嵌在前面板（凸出 3 mm），雷射面是示意用的半透明面（沿光軸展開）。
// set({ laser })：雷射面不透明度＝亮度 × opacity，雷射窗 emissiveIntensity 在 glow[0]～glow[1] 之間。
export const laserProfiler = {
  meta: {
    id: 'laser-profiler', name: '3D 線雷射輪廓儀', category: '視覺',
    source: 'MilitaryGradePC',
    params: {
      w: { value: 70, min: 30, max: 200, step: 1, unit: 'mm', label: '機身寬' },
      h: { value: 40, min: 20, max: 120, step: 1, unit: 'mm', label: '機身高' },
      length: { value: 90, min: 30, max: 250, step: 1, unit: 'mm', label: '機身長（沿光軸）' },
      fanW: { value: 30, min: 5, max: 300, step: 1, unit: 'mm', label: '雷射面寬' },
      range: { value: 70, min: 10, max: 600, step: 5, unit: 'mm', label: '雷射面長（沿光軸）' },
    },
    states: { laser: { value: 1, min: 0, max: 1, label: '雷射' } },
    options: {
      axis: "光軸方向 '+z'（預設）、'-z'、'+y'、'-y'",
      material: '機身材質（預設 MAT.black）', shadow: '機身與雷射窗的陰影旗標（預設都投影）',
      window: 'false 不畫；{ size:[40,20], t=4, at=length/2+1（中心）, material（預設紅色 emissive，每台各一份）, glow:[1.5,3] }：雷射窗',
      plane: 'false 不畫；{ w=fanW, length=range, at=length/2+range/2（中心）, material（預設紅色半透明，每台各一份）, opacity=.35, fx=true（false：列入場景檢查，和原本站內寫法相同） }：雷射面',
      name: 'root 的名稱（預設 laser-profiler）',
    },
    usage: "import { laserProfiler } from '@core/models/vision.js';\nconst prof = laserProfiler.create(); prof.root.position.set(x, y, z); tool.add(prof.root);   // 工具安裝座的 +Z 朝被測面\nprof.set({ laser: 1 });   // 0～1 或布林；prof.body、prof.window、prof.plane 是網格",
  },
  create(p = {}) {
    const P = { ...defaults(laserProfiler.meta), axis: '+z', ...p };
    const F = frame(P.axis), root = group(P.name ?? 'laser-profiler', laserProfiler.meta.id);
    const body = flags(block(root, F.box([P.w, P.h], P.length), [0, 0, 0], P.material ?? MAT.black), P.shadow); body.name = 'profiler body';
    const wo = part(P.window, { size: [40, 20], t: 4, at: P.length / 2 + 1, glow: [1.5, 3] });
    const po = part(P.plane, { w: P.fanW, length: P.range, at: P.length / 2 + P.range / 2, opacity: .35, fx: true });
    let win = null, plane = null;
    if (wo) {
      win = flags(block(root, F.box(wo.size, wo.t), F.at(wo.at), wo.material ?? new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: wo.glow[0] })), P.shadow);
      win.name = 'profiler window';
    }
    if (po) {
      plane = new THREE.Mesh(new THREE.PlaneGeometry(po.w, po.length),
        po.material ?? new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      if (!F.Y) plane.rotation.x = Math.PI / 2;
      plane.position.set(...F.at(po.at)); plane.name = 'laser plane'; if (po.fx) plane.userData.fx = true; root.add(plane);
    }
    function set(v) {
      const k = level(value(v, 'laser'));
      if (plane) plane.material.opacity = k * po.opacity;
      if (win) win.material.emissiveIntensity = wo.glow[0] + (wo.glow[1] - wo.glow[0]) * k;
    }
    return { root, params: P, body, window: win, plane, set };
  },
};
