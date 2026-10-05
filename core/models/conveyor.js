// 滾筒輸送線（參數化）：長度、寬度、高度、滾筒間距；state.s 為滾筒轉動距離（mm），用來表現輸送中。
// 預設外觀與用法不變；meta.options 的選項（輸送方向、本體範圍、跳過某幾段滾筒、軸承座、側樑與支腳的位置）
// 讓站內原本自己畫的滾筒輸送線能照原樣換用（對照見 core/migrations/1.10.0-transport.md）。
import * as THREE from 'three';
import { block, cylinder } from '../geom/shapes.js';
import { MAT } from '../geom/materials.js';
import { foot } from '../geom/hardware.js';
import { seq, part } from './transport.js';

export const meta = {
  id: 'conveyor', name: '滾筒輸送線', category: '輸送',
  params: {
    length: { value: 2400, min: 600, max: 8000, step: 100, unit: 'mm', label: '長度' },
    width: { value: 500, min: 200, max: 1200, step: 10, unit: 'mm', label: '滾筒長' },
    height: { value: 800, min: 300, max: 1200, step: 10, unit: 'mm', label: '輸送面高' },
    pitch: { value: 120, min: 60, max: 400, step: 10, unit: 'mm', label: '滾筒間距' },
    roller: { value: 30, min: 15, max: 60, step: 1, unit: 'mm', label: '滾筒半徑' },
  },
  states: { s: { value: 0, min: 0, max: 2000, unit: 'mm', label: '輸送距離' } },
  options: {
    axis: "輸送方向 'x'（預設）或 'z'；滾筒軸與它垂直",
    span: '[起, 迄]：側樑在輸送方向的本地範圍（預設 [−length/2, length/2]）',
    rollers: '{ from=起+pitch/2, to（給了就是 < to；沒給則排到迄−pitch/2）, pitch, skip=[[中心, 半寬]…]（這些區段不裝）, y=height−roller, segments=20, material=MAT.roller }',
    brackets: 'false（預設）；{ size=[滾筒軸向, 高, 輸送向]=[26, 68, 70], offset=width/2+7, y=height−roller−6, material=MAT.steelDark }：每支滾筒兩端的軸承座',
    frame: 'false 不裝；{ h=150, w=50, y=height−roller−h/2+20（中心）, offset=width/2+25, material=MAT.steel }：兩側側樑',
    legs: 'false 不裝；{ positions（預設依長度平均分 2 支以上）, size=[60, 側樑底高, 60], offset=frame.offset, material=MAT.steelDark, foot=120（腳座邊長，false 不裝） }',
    name: 'root 的名稱（預設 conveyor）',
  },
  usage: "import { create as conveyor } from '@core/models/conveyor.js';\nconst c = conveyor({ length: 3000 }); scene.add(c.root); c.set({ s: 500 });",
};

// 原點：輸送線中心、地面；沿 +X 輸送（axis 'z' 時沿 +Z）；頂面（滾筒頂）高度 = height
export function create(p = {}) {
  const P = { ...Object.fromEntries(Object.entries(meta.params).map(([k, v]) => [k, v.value])), ...p };
  const root = new THREE.Group(); root.name = P.name ?? 'conveyor'; root.userData.coreModel = meta.id;
  const X = P.axis !== 'z', at = (along, y, across) => X ? [along, y, across] : [across, y, along];   // 沿輸送向、高、橫向 → [x, y, z]
  const [a0, a1] = P.span ?? [-P.length / 2, P.length / 2], len = a1 - a0;
  const fr = part(P.frame), lg = part(P.legs), bk = part(P.brackets ?? false);
  const top = P.height, frameH = fr?.h ?? 150, side = fr?.offset ?? P.width / 2 + 25;
  const frames = [], legs = [];
  if (fr) for (const s of [-1, 1]) frames.push(block(root, at(len, frameH, fr.w ?? 50), at((a0 + a1) / 2, fr.y ?? top - P.roller - frameH / 2 + 20, s * side), fr.material ?? MAT.steel));
  if (lg) {
    const n = Math.max(2, Math.ceil(len / 1500) + 1), h = lg.size?.[1] ?? top - P.roller - frameH + 20, off = lg.offset ?? side;
    const xs = lg.positions ? seq(lg.positions) : Array.from({ length: n }, (_, i) => a0 + 80 + i * (len - 160) / (n - 1));
    for (const x of xs) for (const s of [-1, 1]) {
      legs.push(block(root, lg.size ?? [60, h, 60], at(x, h / 2, s * off), lg.material ?? MAT.steelDark));
      if (lg.foot !== false) { const [fx, , fz] = at(x, 0, s * off); foot(root, fx, fz, lg.foot ?? 120); }
    }
  }
  const ro = { from: a0 + P.pitch / 2, to: a1 - P.pitch / 2 + 1e-6, pitch: P.pitch, closed: P.rollers?.to === undefined, ...P.rollers };
  const rollers = [], positions = [], brackets = [];
  for (const x of seq(ro)) {
    if ((ro.skip || []).some(([c, half]) => Math.abs(x - c) < half)) continue;
    const r = cylinder(root, P.roller, P.width, at(x, ro.y ?? top - P.roller, 0), ro.material ?? MAT.roller, X ? 'z' : 'x', ro.segments ?? 20); rollers.push(r); positions.push(x);
    if (bk) for (const s of [-1, 1]) {
      const [across, bh, along] = bk.size ?? [26, 68, 70];
      brackets.push(block(root, at(along, bh, across), at(x, bk.y ?? top - P.roller - 6, s * (bk.offset ?? P.width / 2 + 7)), bk.material ?? MAT.steelDark));
    }
  }
  return {
    root, params: P, top, rollers, positions, brackets, frames, legs,
    // 滾筒繞自己的軸轉（軸沿 Z 的滾筒自轉軸是本地 Y；軸沿 X 的用 rotation.x）
    set({ s = 0 } = {}) { for (const r of rollers) r.rotation[X ? 'y' : 'x'] = -s / P.roller; },
  };
}
