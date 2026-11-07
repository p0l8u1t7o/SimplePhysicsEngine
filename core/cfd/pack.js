// 結果包（.cfdpack）：把 OpenFOAM 的取樣結果轉成瀏覽器直接用的格式。純 JS，決定性。
//
// 檔案格式（小端序）：
//   0  'CFDP'（4 bytes）
//   4  uint32 版本（1）
//   8  uint32 JSON 長度 L（已補空白到 4 的倍數）
//   12 JSON（UTF-8）
//   12+L 二進位區：Float32／Uint32 陣列依序排列，每個都從 4 的倍數開始；JSON 裡的 { offset, length, type } 指向這裡
//
// 座標一律轉回場景座標（cfd-case.json 的 foamToScene；預設 Y 向上、mm），向量（U、力）只轉方向。
// 壓力：simpleFoam 的 p 是運動壓力（p/ρ，m²/s²），匯入時乘 ρ 存成 Pa；另外算 Cp 與 |U|。
import { applyPoint, rotationOf } from './geometry.js';
import { magnitude, pressureCoefficient, robustRange } from './flow-field.js';

export const PACK_VERSION = 1;
const MAGIC = 0x50444643; // 'CFDP' 小端序

// 多邊形扇形三角化（OpenFOAM 的切面與 patch 面都是凸多邊形）
export function triangulate(polys) {
  const idx = [], triCell = [];
  if (!polys) return { indices: new Uint32Array(0), triCell: new Uint32Array(0) };
  for (let c = 0; c < polys.count; c++) {
    const a = polys.offsets[c], b = polys.offsets[c + 1];
    for (let k = a + 1; k + 1 < b; k++) { idx.push(polys.connectivity[a], polys.connectivity[k], polys.connectivity[k + 1]); triCell.push(c); }
  }
  return { indices: Uint32Array.from(idx), triCell: Uint32Array.from(triCell) };
}

function transformPoints(points, m) {
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const q = applyPoint(m, [points[i], points[i + 1], points[i + 2]]);
    out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2];
  }
  return out;
}
function rotateVectors(v, R) {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) {
    out[i] = R[0] * v[i] + R[1] * v[i + 1] + R[2] * v[i + 2];
    out[i + 1] = R[3] * v[i] + R[4] * v[i + 1] + R[5] * v[i + 2];
    out[i + 2] = R[6] * v[i] + R[7] * v[i + 1] + R[8] * v[i + 2];
  }
  return out;
}

// 把一組 VTK 資料陣列（point 或 cell）轉成結果包的場：U 轉方向、p 換成 Pa、加 Umag 與 Cp
function convertFields(src, { R, rho, Uref, pRefKin, kinematic, pick }) {
  const out = {};
  for (const [name, a] of Object.entries(src)) {
    let vals = pick ? pick(a.values, a.components) : Float32Array.from(a.values);
    if (a.components === 3 && /^U(Mean)?$/.test(name)) vals = rotateVectors(vals, R);
    if (name === 'p' && kinematic) { const p = new Float32Array(vals.length); for (let i = 0; i < p.length; i++) p[i] = vals[i] * rho; vals = p; }
    out[name] = { components: a.components, values: vals };
  }
  if (out.U && out.U.components === 3) out.Umag = { components: 1, values: magnitude(out.U.values) };
  if (out.p && out.p.components === 1 && Uref > 0) out.Cp = { components: 1, values: pressureCoefficient(out.p.values, { rho, Uref, pRef: (pRefKin ?? 0) * (kinematic ? rho : 1) }) };
  return out;
}

const UNITS = { U: 'm/s', Umag: 'm/s', p: 'Pa', Cp: '-', k: 'm²/s²', nut: 'm²/s', omega: '1/s' };

// surfaces: [{ name, kind: 'slice'|'patch', obstacle?, vtk }]，lines: [{ name, vtk }]（streamLine）
export function buildPack({ meta, surfaces = [], lines = [], forces = [], probes = null, yPlus = null, residuals = null, time = null, sources = [], synthetic = false }) {
  const M = meta.frame.foamToScene;
  const R = rotationOf(M);
  const rho = meta.flow.rho, Uref = meta.flow.Uref;
  const kinematic = /kinematic/.test(meta.flow.pressure || '');
  // 參考靜壓：上游參考探針最後一個時間的 p（運動壓力）
  let pRefKin = 0, pRefSource = 'outlet (p = 0)';
  if (probes?.p && meta.sampling?.referenceProbe) {
    const i = meta.sampling.probes.findIndex(p => p.name === meta.sampling.referenceProbe);
    const last = probes.p.values.at(-1);
    if (i >= 0 && last && Number.isFinite(last[i])) { pRefKin = last[i]; pRefSource = `probe ${meta.sampling.referenceProbe}`; }
  }
  const ctx = { R, rho, Uref, pRefKin, kinematic };

  const blobs = [];
  let size = 0;
  const put = (arr, type) => {
    const view = type === 'u32' ? (arr instanceof Uint32Array ? arr : Uint32Array.from(arr)) : (arr instanceof Float32Array ? arr : Float32Array.from(arr));
    const ref = { offset: size, length: view.length, type };
    blobs.push(view); size += view.byteLength;
    return ref;
  };
  const fieldRefs = (fields, location) => Object.keys(fields).sort().map(name => {
    const f = fields[name];
    const r = f.components === 1 ? robustRange(f.values) : robustRange(magnitude(f.values));
    return { name, location, components: f.components, unit: UNITS[name] || '', range: [r.min, r.max], robust: [r.lo, r.hi], data: put(f.values, 'f32') };
  });

  const outSurfaces = surfaces.map(s => {
    const v = s.vtk;
    const tri = triangulate(v.polys);
    // cell data 只留 polys 的部分，順序和 triangulate 的 cell 編號一致
    const cellPick = v.polys ? (vals, comps) => {
      const o = new Float32Array(v.polys.count * comps);
      for (let c = 0; c < v.polys.count; c++) for (let k = 0; k < comps; k++) o[c * comps + k] = vals[v.polys.cellIds[c] * comps + k];
      return o;
    } : null;
    const pd = convertFields(v.pointData, ctx), cd = cellPick ? convertFields(v.cellData, { ...ctx, pick: cellPick }) : {};
    return {
      name: s.name, kind: s.kind, obstacle: s.obstacle || null,
      nPoints: v.nPoints, nTriangles: tri.indices.length / 3, nCells: v.polys?.count || 0,
      positions: put(transformPoints(v.points, M), 'f32'),
      indices: put(tri.indices, 'u32'),
      triCell: put(tri.triCell, 'u32'),
      fields: [...fieldRefs(pd, 'point'), ...fieldRefs(cd, 'cell')],
    };
  });

  const outLines = lines.map(l => {
    const v = l.vtk;
    const seg = [];
    let nLines = 0;
    if (v.lines) for (let c = 0; c < v.lines.count; c++) {
      const a = v.lines.offsets[c], b = v.lines.offsets[c + 1];
      for (let k = a; k + 1 < b; k++) seg.push(v.lines.connectivity[k], v.lines.connectivity[k + 1]);
      nLines++;
    }
    const pd = convertFields(v.pointData, ctx);
    return { name: l.name, nPoints: v.nPoints, nLines, nSegments: seg.length / 2, positions: put(transformPoints(v.points, M), 'f32'), segments: put(seg, 'u32'), fields: fieldRefs(pd, 'point') };
  });

  // 力：轉成場景座標方向，取最後值；面板另算法向力係數 CN = F·n / (q A)
  const q = 0.5 * rho * Uref * Uref;
  const outForces = forces.map(f => {
    const ob = meta.obstacles.find(o => o.name === f.obstacle);
    const toScene = v => (v ? [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]] : null);
    const total = f.series.total.map(toScene);
    const last = total.at(-1);
    const out = { obstacle: f.obstacle, label: ob?.label || null, time: [f.series.time[0], f.series.time.at(-1)], samples: f.series.time.length, total: last, pressure: toScene(f.series.pressure?.at(-1)), viscous: toScene(f.series.viscous?.at(-1)), unit: 'N' };
    // 收斂：最後 20% 的總力大小變化（相對）
    const mags = total.map(v => Math.hypot(...v));
    const tail = mags.slice(Math.floor(mags.length * 0.8));
    const mean = tail.reduce((a, b) => a + b, 0) / (tail.length || 1);
    out.tailVariation = mean ? (Math.max(...tail) - Math.min(...tail)) / mean : null;
    if (ob?.area && ob.normal) {
      const n = ob.normal;
      out.normalForce = last[0] * n[0] + last[1] * n[1] + last[2] * n[2];
      out.CN = out.normalForce / (q * ob.area);
      // 風向（場景）：foam +x 轉回場景
      const wind = [R[0], R[3], R[6]];
      out.drag = last[0] * wind[0] + last[1] * wind[1] + last[2] * wind[2];
      out.CD = out.drag / (q * ob.area);
      out.area = ob.area;
    }
    return out;
  });

  let outProbes = null;
  if (probes) {
    outProbes = { names: meta.sampling.probes.map(p => p.name), locations: meta.sampling.probes.map(p => p.point), fields: {} };
    for (const [name, pr] of Object.entries(probes)) {
      const last = pr.values.at(-1) || [];
      outProbes.fields[name] = {
        time: pr.time.at(-1) ?? null,
        missing: pr.missing,
        last: last.map(v => {
          if (Array.isArray(v)) { const s = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; return s; }
          return name === 'p' && kinematic ? v * rho : v;
        }),
        unit: UNITS[name] || '',
      };
    }
  }

  const header = {
    format: 'spe-cfd-pack', version: PACK_VERSION,
    case: { name: meta.name, kind: meta.kind, medium: meta.medium, solver: meta.solver, target: meta.target, time, synthetic },
    units: { length: meta.frame.units, velocity: 'm/s', pressure: 'Pa', force: 'N' },
    frame: { up: meta.frame.up },
    reference: { rho, Uref, q, pRef: pRefKin * (kinematic ? rho : 1), pRefSource },
    obstacles: meta.obstacles,
    surfaces: outSurfaces, lines: outLines, forces: outForces, probes: outProbes, yPlus, residuals,
    sources,
  };
  return encodePack(header, blobs, size);
}

function encodePack(header, blobs, size) {
  let json = JSON.stringify(header);
  let bytes = new TextEncoder().encode(json);
  const pad = (4 - (bytes.length % 4)) % 4;
  if (pad) { json += ' '.repeat(pad); bytes = new TextEncoder().encode(json); }
  const out = new Uint8Array(12 + bytes.length + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, PACK_VERSION, true); dv.setUint32(8, bytes.length, true);
  out.set(bytes, 12);
  let p = 12 + bytes.length;
  for (const b of blobs) {
    // 一律寫成小端序（瀏覽器與 x86／ARM 的原生序）
    const v = new DataView(out.buffer, p, b.byteLength);
    if (b instanceof Float32Array) for (let i = 0; i < b.length; i++) v.setFloat32(i * 4, b[i], true);
    else for (let i = 0; i < b.length; i++) v.setUint32(i * 4, b[i], true);
    p += b.byteLength;
  }
  return out;
}

// 解碼：回傳 JSON 標頭，所有 { offset, length, type } 換成 Float32Array／Uint32Array（直接指向原緩衝區，不複製）
export function decodePack(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.byteLength < 12 || dv.getUint32(0, true) !== MAGIC) throw new Error('不是 cfdpack 檔');
  const ver = dv.getUint32(4, true);
  if (ver !== PACK_VERSION) throw new Error(`不支援的 cfdpack 版本 ${ver}`);
  const L = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + L)));
  const base = u8.byteOffset + 12 + L;
  // 緩衝區起點不是 4 的倍數時（例如從較大的緩衝區切出來）複製一份
  const aligned = base % 4 === 0;
  const buf = aligned ? u8.buffer : u8.slice(12 + L).buffer;
  const b0 = aligned ? base : 0;
  const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  const view = r => {
    const C = r.type === 'u32' ? Uint32Array : Float32Array;
    if (le) return new C(buf, b0 + r.offset, r.length);
    const d = new DataView(buf, b0 + r.offset, r.length * 4), o = new C(r.length);
    for (let i = 0; i < r.length; i++) o[i] = r.type === 'u32' ? d.getUint32(i * 4, true) : d.getFloat32(i * 4, true);
    return o;
  };
  const resolve = o => {
    if (Array.isArray(o)) return o.map(resolve);
    if (o && typeof o === 'object') {
      if (typeof o.offset === 'number' && typeof o.length === 'number' && (o.type === 'f32' || o.type === 'u32') && Object.keys(o).length === 3) return view(o);
      const r = {};
      for (const [k, v] of Object.entries(o)) r[k] = resolve(v);
      return r;
    }
    return o;
  };
  return resolve(header);
}

export async function loadPack(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`讀不到 ${url}：${res.status}`);
  return decodePack(await res.arrayBuffer());
}
