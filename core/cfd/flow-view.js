// CFD 結果的 three.js 顯示（瀏覽器；Node 端也能建幾何做測試）。資料來自 lib/pack.js 的 decodePack／loadPack。
//
//   const pack = await loadPack('results.cfdpack');
//   const flow = createFlowView(pack, { field: 'Umag', patchField: 'Cp', arrows: { surface: 'plan' } });
//   scene.add(flow.group);
//   flow.setField('p'); flow.setRange([0, 12]); flow.setVisible('elevation', false);
//   panel.append(flow.legendElement('slices'), flow.legendElement('patches'));
//
// 兩個色彩通道：slices（切面、流線、箭頭；預設 |U|、turbo）與 patches（障礙物表面；預設 Cp、coolwarm、對稱範圍）。
// 表面一律用展開的三角形（non-indexed）：點資料內插、cell 資料整片同色都走同一條路。
// 障礙物表面往流體側推 patchOffset（場景單位，預設 3 mm），避免和設備模型的面重合閃爍（重合面要改幾何，不靠 polygonOffset）。
// OpenFOAM 的邊界面法向朝流體外（朝障礙物裡面），所以是沿面法向的反方向推。
// 顏色是資料色，用不受光照影響的 MeshBasicMaterial；色表數值是 sRGB，寫進頂點色前轉成線性。
import * as THREE from 'three';
import { colormap, colormapStops, niceTicks, resampleSlice, arrowSegments, traceStreamlines } from './flow-field.js';

export const FIELD_LABELS = { Umag: '風速 |U|', U: '速度 U', p: '靜壓 p', Cp: '風壓係數 Cp', k: '紊流動能 k', nut: '紊流黏度 νt', omega: '比消散率 ω' };

const toLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function fieldOf(item, name) {
  return item.fields.find(f => f.name === name) || null;
}

// 給一個範圍與色表，算每個展開頂點的顏色
function paintColors(attr, values, comps, map, lo, hi, vertexValue) {
  const arr = attr.array, n = arr.length / 3, span = hi - lo || 1;
  for (let i = 0; i < n; i++) {
    const v = vertexValue(i, values, comps);
    const c = colormap(map, (v - lo) / span);
    arr[3 * i] = toLinear(c[0]); arr[3 * i + 1] = toLinear(c[1]); arr[3 * i + 2] = toLinear(c[2]);
  }
  attr.needsUpdate = true;
}
const scalarAt = (values, comps, k) => (comps === 1 ? values[k] : Math.hypot(values[3 * k], values[3 * k + 1], values[3 * k + 2]));

function expandSurface(s, offset) {
  const P = s.positions, I = s.indices, nT = I.length / 3;
  const pos = new Float32Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
    let nx = 0, ny = 0, nz = 0;
    if (offset) {
      const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
      const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1; nx *= offset / L; ny *= offset / L; nz *= offset / L;
    }
    [a, b, c].forEach((k, j) => { pos[9 * t + 3 * j] = P[3 * k] + nx; pos[9 * t + 3 * j + 1] = P[3 * k + 1] + ny; pos[9 * t + 3 * j + 2] = P[3 * k + 2] + nz; });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nT * 9), 3));
  g.computeBoundingSphere();
  return g;
}

export function createFlowView(pack, opts = {}) {
  const o = {
    field: 'Umag', patchField: 'Cp', colormap: 'turbo', patchColormap: 'coolwarm',
    range: 'robust', patchRange: 'robust', patchSymmetric: true,
    opacity: 0.9, patchOffset: 3, streamlines: true, arrows: null, traced: null, surfaces: null,
    ...opts,
  };
  const group = new THREE.Group();
  group.name = 'cfd-flow';
  group.userData.noBom = 'CFD 結果顯示，不是設備';
  const channels = {
    slices: { field: o.field, colormap: o.colormap, range: o.range, symmetric: false, items: [] },
    patches: { field: o.patchField, colormap: o.patchColormap, range: o.patchRange, symmetric: o.patchSymmetric, items: [] },
  };
  const meshes = new Map();

  for (const s of pack.surfaces) {
    if (o.surfaces && !o.surfaces.includes(s.name)) continue;
    const isPatch = s.kind === 'patch';
    const geo = expandSurface(s, isPatch ? -o.patchOffset : 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: !isPatch && o.opacity < 1, opacity: isPatch ? 1 : o.opacity, depthWrite: isPatch || o.opacity >= 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `cfd:${s.name}`;
    mesh.userData.cfd = { surface: s.name, kind: s.kind, obstacle: s.obstacle };
    mesh.renderOrder = isPatch ? 0 : 1;
    group.add(mesh);
    meshes.set(s.name, mesh);
    channels[isPatch ? 'patches' : 'slices'].items.push({ kind: 'surface', src: s, obj: mesh });
  }

  const lineMat = () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  // color：給固定顏色（例如 0x1b1f24）時不跟色表走，箭頭疊在同色表的切面上比較看得清楚
  const addLines = (name, positions, valuesPerVertex, tag, color = null) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3));
    const ls = new THREE.LineSegments(g, color === null ? lineMat() : new THREE.LineBasicMaterial({ color }));
    ls.name = `cfd:${name}`; ls.userData.cfd = { lines: name, kind: tag };
    group.add(ls); meshes.set(name, ls);
    if (color === null) channels.slices.items.push({ kind: 'lines', values: valuesPerVertex, obj: ls, tag });
    return ls;
  };

  // 匯入的流線（OpenFOAM streamLine）：線段索引展開成端點對；顏色固定用 |U|
  if (o.streamlines) {
    for (const l of pack.lines) {
      const S = l.segments, P = l.positions, f = fieldOf(l, 'Umag');
      const pos = new Float32Array(S.length * 3), val = new Float32Array(S.length);
      for (let i = 0; i < S.length; i++) {
        const k = S[i];
        pos[3 * i] = P[3 * k]; pos[3 * i + 1] = P[3 * k + 1]; pos[3 * i + 2] = P[3 * k + 2];
        val[i] = f ? f.data[k] : NaN;
      }
      addLines(l.name, pos, val, 'streamline');
    }
  }

  // 切面上的箭頭與切面內流線（在瀏覽器裡算，決定性）
  const sliceGrid = (name, cell) => {
    const s = pack.surfaces.find(x => x.name === name);
    if (!s) throw new Error(`沒有切面 ${name}`);
    const U = s.fields.find(f => f.name === 'U' && f.location === 'point');
    if (!U) throw new Error(`切面 ${name} 沒有點上的 U`);
    return resampleSlice({ positions: s.positions, indices: s.indices }, U.data, 3, { cell });
  };
  for (const a of [].concat(o.arrows || [])) {
    const g = sliceGrid(a.surface, a.cell);
    const r = arrowSegments(g, a);
    addLines(`arrows:${a.surface}`, r.positions, r.magnitudes, 'arrows', a.color ?? null);
  }
  for (const t of [].concat(o.traced || [])) {
    const g = sliceGrid(t.surface, t.cell);
    const r = traceStreamlines(g, t);
    addLines(`traced:${t.surface}`, r.positions, r.magnitudes, 'traced', t.color ?? null);
  }

  // 目前範圍
  function rangeOf(ch) {
    const c = channels[ch];
    if (Array.isArray(c.range)) return c.range;
    let lo = Infinity, hi = -Infinity;
    for (const it of c.items) {
      if (!it.obj.visible) continue;
      if (it.kind === 'surface') {
        const f = fieldOf(it.src, c.field);
        if (!f) continue;
        const r = c.range === 'full' ? f.range : f.robust;
        lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]);
      } else if (c.field === 'Umag') {
        for (const v of it.values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (c.symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)); return [-m, m]; }
    if (c.field === 'Umag' && lo > 0 && lo < 0.25 * hi) lo = 0;
    return [lo, hi];
  }

  function repaint(ch) {
    const c = channels[ch];
    const [lo, hi] = rangeOf(ch);
    for (const it of c.items) {
      const attr = it.obj.geometry.getAttribute('color');
      if (it.kind === 'surface') {
        const f = fieldOf(it.src, c.field);
        if (!f) { attr.array.fill(0.25); attr.needsUpdate = true; continue; }
        const I = it.src.indices, TC = it.src.triCell;
        const vv = f.location === 'point'
          ? (i, vals, comps) => scalarAt(vals, comps, I[i])
          : (i, vals, comps) => scalarAt(vals, comps, TC[Math.floor(i / 3)]);
        paintColors(attr, f.data, f.components, c.colormap, lo, hi, vv);
      } else {
        // 線一律用 |U| 上色（欄位不是 |U| 時沿用 |U| 的範圍以免整條變單色）
        const [a, b] = c.field === 'Umag' ? [lo, hi] : linesRange();
        paintColors(attr, it.values, 1, c.colormap, a, b, (i, vals) => vals[i]);
      }
    }
    c.current = [lo, hi];
  }
  function linesRange() {
    let lo = Infinity, hi = -Infinity;
    for (const it of channels.slices.items) if (it.kind !== 'surface') for (const v of it.values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return Number.isFinite(lo) ? [Math.min(lo, 0), hi] : [0, 1];
  }
  repaint('slices'); repaint('patches');

  const fieldNames = ch => [...new Set(channels[ch].items.filter(it => it.kind === 'surface').flatMap(it => it.src.fields.map(f => f.name)))].sort();
  const unitOf = (ch, name) => { for (const it of channels[ch].items) if (it.kind === 'surface') { const f = fieldOf(it.src, name); if (f) return f.unit; } return name === 'Umag' ? 'm/s' : ''; };

  const api = {
    group, meshes, pack,
    fields: ch => fieldNames(ch || 'slices'),
    setField(name, ch = 'slices') { channels[ch].field = name; repaint(ch); },
    setRange(r, ch = 'slices') { channels[ch].range = r; repaint(ch); },
    setColormap(name, ch = 'slices') { channels[ch].colormap = name; repaint(ch); },
    setOpacity(a) { for (const it of channels.slices.items) if (it.kind === 'surface') { const m = it.obj.material; m.opacity = a; m.transparent = a < 1; m.depthWrite = a >= 1; m.needsUpdate = true; } },
    setVisible(name, on) { const m = meshes.get(name); if (m) { m.visible = on; repaint(channels.patches.items.some(i => i.obj === m) ? 'patches' : 'slices'); } },
    legend(ch = 'slices') {
      const c = channels[ch];
      const [min, max] = c.current;
      return { channel: ch, field: c.field, label: FIELD_LABELS[c.field] || c.field, unit: unitOf(ch, c.field), min, max, colormap: c.colormap, stops: colormapStops(c.colormap, 9), ticks: niceTicks(min, max, 5) };
    },
    // 色條：直接放進側欄；文字與底色跟著 CSS 變數（--fg、--panel），沒有就用中性色
    legendElement(ch = 'slices', doc = globalThis.document) {
      if (!doc) throw new Error('legendElement 需要 DOM');
      const L = api.legend(ch);
      const el = doc.createElement('div');
      el.className = 'cfd-legend';
      el.style.cssText = 'font:12px/1.4 system-ui,sans-serif;color:var(--fg,#e8edf2);background:var(--panel,rgba(20,26,32,.82));padding:8px 10px;border-radius:6px;min-width:180px';
      const title = doc.createElement('div'); title.textContent = `${L.label}${L.unit ? `（${L.unit}）` : ''}`; title.style.marginBottom = '4px';
      const bar = doc.createElement('div');
      bar.style.cssText = `height:10px;border-radius:3px;background:linear-gradient(to right,${L.stops.map(s => `${s.color} ${(s.t * 100).toFixed(1)}%`).join(',')})`;
      const ticks = doc.createElement('div'); ticks.style.cssText = 'position:relative;height:16px;font-variant-numeric:tabular-nums';
      const span = L.max - L.min || 1;
      for (const t of L.ticks) {
        const s = doc.createElement('span'); s.textContent = String(t);
        s.style.cssText = `position:absolute;left:${((t - L.min) / span * 100).toFixed(2)}%;transform:translateX(-50%);white-space:nowrap`;
        ticks.append(s);
      }
      el.append(title, bar, ticks);
      return el;
    },
    // 力的摘要表（每個回報的障礙物一列）
    forcesTable() {
      return pack.forces.map(f => ({ obstacle: f.obstacle, label: f.label, Fx: f.total[0], Fy: f.total[1], Fz: f.total[2], normalForce: f.normalForce ?? null, CN: f.CN ?? null, CD: f.CD ?? null, converged: f.tailVariation !== null && f.tailVariation < 0.02 }));
    },
    dispose() {
      group.traverse(m => { m.geometry?.dispose(); m.material?.dispose(); });
      group.removeFromParent();
    },
  };
  return api;
}
