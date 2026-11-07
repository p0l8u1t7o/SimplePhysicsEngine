// 不用 OpenFOAM 的案例檢查：語法（每個字典都能解析）＋語意（OpenFOAM 會在執行時才報的常見錯誤）。
// 輸入是 { 相對路徑: 內容 } 的對照表（產生器的輸出或從資料夾讀進來的檔案），回傳 { errors, warnings, checked }。
// 涵蓋：FoamFile 檔頭、blockMesh 頂點與面（索引範圍、朝外法向、六面各一次）、snappy 的 geometry 對照、
// locationInMesh 在域內且不在障礙物裡、0.orig 欄位的 dimensions 與每個 patch 都有邊界條件、
// 邊界條件型別在白名單裡、常數檔的必要鍵、Allrun 的換行與步驟。
// 不涵蓋：OpenFOAM 各型別的必要參數全部組合、網格品質（要 checkMesh）、收斂性。
import { parseFoamDict, entry, sub, keys, valueOf, plain, FoamSyntaxError } from './foam-dict.js';

const NOT_DICT = /(^|\/)(Allrun|Allclean)$|\.(stl|json|md|eMesh|obj|vtk|dat)$/;

const BC_TYPES = new Set([
  'fixedValue', 'zeroGradient', 'calculated', 'noSlip', 'slip', 'symmetry', 'symmetryPlane', 'empty', 'inletOutlet', 'outletInlet',
  'atmBoundaryLayerInletVelocity', 'atmBoundaryLayerInletK', 'atmBoundaryLayerInletOmega', 'atmBoundaryLayerInletEpsilon',
  'kqRWallFunction', 'omegaWallFunction', 'nutkWallFunction', 'nutUSpaldingWallFunction', 'nutkAtmRoughWallFunction',
  'turbulentIntensityKineticEnergyInlet', 'turbulentMixingLengthFrequencyInlet', 'surfaceNormalFixedValue',
  'totalPressure', 'pressureInletOutletVelocity', 'flowRateInletVelocity', 'fixedFluxPressure',
]);
const FIELD_CLASS = { U: 'volVectorField', p: 'volScalarField', k: 'volScalarField', omega: 'volScalarField', nut: 'volScalarField' };

export function validateFiles(files) {
  const errors = [], warnings = [];
  const parsed = {};
  const err = (f, m) => errors.push(`${f}：${m}`);
  const warn = (f, m) => warnings.push(`${f}：${m}`);

  // ---------- 語法
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (NOT_DICT.test(path)) continue;
    if (/\r/.test(text)) warn(path, '含 CR 字元（Windows 換行）；OpenFOAM 可讀，但 Allrun 類腳本不行');
    try {
      const d = parseFoamDict(text);
      parsed[path] = d;
      const head = sub(d, 'FoamFile');
      if (!head) { err(path, '缺 FoamFile 檔頭'); continue; }
      for (const k of ['version', 'format', 'class', 'object']) if (valueOf(head, k) === undefined) err(path, `FoamFile 缺 ${k}`);
      const obj = valueOf(head, 'object'), base = path.split('/').pop();
      if (obj !== undefined && String(obj) !== base) err(path, `FoamFile object（${obj}）和檔名（${base}）不同`);
    } catch (e) {
      err(path, e instanceof FoamSyntaxError ? `語法錯誤，${e.message}` : e.message);
    }
  }
  const need = p => { if (!files[p]) err(p, '缺少檔案'); return parsed[p]; };

  // ---------- blockMeshDict
  const bm = need('system/blockMeshDict');
  const patchNames = [], patchTypes = {};
  let bounds = null;
  if (bm) {
    const verts = valueOf(bm, 'vertices');
    if (!Array.isArray(verts) || verts.length !== 8 || !verts.every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) err('system/blockMeshDict', 'vertices 要是 8 個三維點');
    else {
      bounds = { min: [0, 1, 2].map(i => Math.min(...verts.map(v => v[i]))), max: [0, 1, 2].map(i => Math.max(...verts.map(v => v[i]))) };
      const blocks = entry(bm, 'blocks')?.value?.tokens?.[0];
      const items = blocks?.items || [];
      const hexIdx = items.findIndex(t => t.v === 'hex');
      const ids = items[hexIdx + 1] ? plain(items[hexIdx + 1]) : null;
      const cells = items[hexIdx + 2] ? plain(items[hexIdx + 2]) : null;
      if (hexIdx < 0 || !Array.isArray(ids) || ids.length !== 8 || ids.some(i => !(i >= 0 && i < 8))) err('system/blockMeshDict', 'blocks 的 hex 頂點索引要是 0～7 的 8 個數');
      if (!Array.isArray(cells) || cells.length !== 3 || cells.some(n => !(Number.isInteger(n) && n > 0))) err('system/blockMeshDict', 'blocks 的格數要是 3 個正整數');
      const center = [0, 1, 2].map(i => verts.reduce((a, v) => a + v[i], 0) / 8);
      const seen = new Map();
      const bnd = entry(bm, 'boundary')?.value?.tokens?.[0];
      const bItems = bnd?.items || [];
      for (let i = 0; i < bItems.length; i++) {
        const t = bItems[i];
        if (t.t !== 'word' || !bItems[i + 1]?.dict) { err('system/blockMeshDict', 'boundary 清單格式要是 名稱 { … }'); break; }
        const name = t.v, d = { entries: bItems[i + 1].dict }; i++;
        patchNames.push(name); patchTypes[name] = valueOf(d, 'type');
        const faces = valueOf(d, 'faces');
        for (const f of faces || []) {
          if (!Array.isArray(f) || f.length !== 4 || f.some(k => !(k >= 0 && k < 8))) { err('system/blockMeshDict', `patch ${name} 的面索引錯誤`); continue; }
          const key = [...f].sort().join(',');
          if (seen.has(key)) err('system/blockMeshDict', `面 (${f.join(' ')}) 重複出現在 ${seen.get(key)} 與 ${name}`);
          seen.set(key, name);
          // 朝外法向：(v1-v0)×(v2-v0) 和面心往外的方向同號
          const P = f.map(k => verts[k]);
          const a = P[1].map((x, j) => x - P[0][j]), b = P[2].map((x, j) => x - P[0][j]);
          const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const fc = [0, 1, 2].map(j => P.reduce((s, p) => s + p[j], 0) / 4);
          const out = fc.map((x, j) => x - center[j]);
          if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) err('system/blockMeshDict', `patch ${name} 的面 (${f.join(' ')}) 法向朝內`);
        }
      }
      if (seen.size !== 6) err('system/blockMeshDict', `單一 hex 的六個面要剛好各屬於一個 patch（目前 ${seen.size} 個）`);
    }
  }

  // ---------- snappyHexMeshDict
  const sh = need('system/snappyHexMeshDict');
  const obstacleGroups = new Map(); // patch 名稱 → 群組
  const solids = [];
  if (sh) {
    const geo = sub(sh, 'geometry');
    const geoNames = new Map();
    for (const e of geo?.entries || []) {
      if (!e.value?.dict) continue;
      const d = { entries: e.value.dict };
      const type = valueOf(d, 'type');
      const nm = type === 'triSurfaceMesh' ? (valueOf(d, 'name') ?? e.key.replace(/\.(stl|obj)$/, '')) : e.key;
      geoNames.set(nm, { type, d, key: e.key });
      if (type === 'triSurfaceMesh' && !files[`constant/triSurface/${e.key}`]) err('system/snappyHexMeshDict', `geometry ${e.key} 找不到 constant/triSurface/${e.key}`);
      const v = k => valueOf(d, k);
      if (type === 'searchableBox') { if (!(v('min')?.length === 3 && v('max')?.length === 3) || v('min').some((x, i) => x >= v('max')[i])) err('system/snappyHexMeshDict', `${e.key}：searchableBox 的 min 要小於 max`); }
      else if (type === 'searchableRotatedBox') { for (const k of ['span', 'origin', 'e1', 'e3']) if (v(k)?.length !== 3) err('system/snappyHexMeshDict', `${e.key}：searchableRotatedBox 缺 ${k}`); }
      else if (type === 'searchableCylinder') { if (v('point1')?.length !== 3 || v('point2')?.length !== 3 || !(v('radius') > 0)) err('system/snappyHexMeshDict', `${e.key}：searchableCylinder 要有 point1、point2、radius`); }
      else if (type !== 'triSurfaceMesh') warn('system/snappyHexMeshDict', `${e.key}：未檢查的 geometry 型別 ${type}`);
    }
    const cmc = sub(sh, 'castellatedMeshControls');
    if (!cmc) err('system/snappyHexMeshDict', '缺 castellatedMeshControls');
    else {
      const rs = sub(cmc, 'refinementSurfaces');
      for (const e of rs?.entries || []) {
        if (!geoNames.has(e.key)) err('system/snappyHexMeshDict', `refinementSurfaces 的 ${e.key} 不在 geometry 裡`);
        const d = { entries: e.value?.dict || [] };
        const lv = valueOf(d, 'level');
        if (!Array.isArray(lv) || lv.length !== 2 || lv[0] > lv[1]) err('system/snappyHexMeshDict', `${e.key} 的 level 要是 (最小 最大)`);
        const groups = valueOf(d, 'patchInfo', 'inGroups');
        obstacleGroups.set(e.key, Array.isArray(groups) ? groups : groups ? [groups] : []);
        const g = geoNames.get(e.key);
        if (g) solids.push(g);
      }
      for (const e of sub(cmc, 'refinementRegions')?.entries || []) if (!geoNames.has(e.key)) err('system/snappyHexMeshDict', `refinementRegions 的 ${e.key} 不在 geometry 裡`);
      const feats = valueOf(cmc, 'features') || [];
      for (const f of feats) {
        const file = f?.dict ? valueOf({ entries: f.dict }, 'file') : null;
        if (!file) continue;
        const stl = String(file).replace(/"/g, '').replace(/\.eMesh$/, '.stl');
        if (!files['system/surfaceFeatureExtractDict'] || !sub(parsed['system/surfaceFeatureExtractDict'] || { entries: [] }, stl)) err('system/snappyHexMeshDict', `features 的 ${file} 沒有對應的 surfaceFeatureExtractDict 項目`);
      }
      const loc = valueOf(cmc, 'locationInMesh');
      if (!Array.isArray(loc) || loc.length !== 3) err('system/snappyHexMeshDict', '缺 locationInMesh');
      else if (bounds) {
        if (loc.some((x, i) => !(x > bounds.min[i] && x < bounds.max[i]))) err('system/snappyHexMeshDict', `locationInMesh (${loc.join(' ')}) 不在計算域內`);
        for (const g of solids) if (insideGeometry(loc, g)) err('system/snappyHexMeshDict', `locationInMesh 落在障礙物 ${g.key} 裡`);
      }
    }
    const mq = sub(sh, 'meshQualityControls');
    const inc = mq?.entries.find(e => e.directive && e.key === '#include');
    if (inc && !files[`system/${inc.args[0]?.replace(/"/g, '')}`]) err('system/snappyHexMeshDict', `#include 的 ${inc.args[0]} 不存在`);
    if (!mq) err('system/snappyHexMeshDict', '缺 meshQualityControls');
  }

  // 所有 patch 與群組
  const allPatches = [...patchNames.map(n => ({ name: n, groups: [], type: patchTypes[n] })), ...[...obstacleGroups].map(([n, g]) => ({ name: n, groups: g, type: 'wall' }))];
  const cp = parsed['system/createPatchDict'];
  if (cp) {
    for (const it of valueOf(cp, 'patches') || []) {
      const d = it?.dict ? { entries: it.dict } : null;
      if (!d) { err('system/createPatchDict', 'patches 要是字典清單'); continue; }
      const g = valueOf(d, 'patchInfo', 'inGroups');
      allPatches.push({ name: valueOf(d, 'name'), groups: Array.isArray(g) ? g : g ? [g] : [], type: valueOf(d, 'patchInfo', 'type') });
      const set = valueOf(d, 'set');
      const ts = parsed['system/topoSetDict'];
      const acts = ts ? (valueOf(ts, 'actions') || []).map(a => valueOf({ entries: a.dict }, 'name')) : [];
      if (!acts.includes(set)) err('system/createPatchDict', `set ${set} 不在 topoSetDict 的 actions 裡`);
    }
  }

  // ---------- controlDict、fvSchemes、fvSolution
  const cd = need('system/controlDict');
  if (cd) {
    for (const k of ['application', 'startFrom', 'endTime', 'deltaT', 'writeControl', 'writeInterval']) if (valueOf(cd, k) === undefined) err('system/controlDict', `缺 ${k}`);
    for (const e of sub(cd, 'functions')?.entries || []) {
      if (!e.value?.dict) continue;
      const d = { entries: e.value.dict };
      if (!valueOf(d, 'type')) err('system/controlDict', `function ${e.key} 缺 type`);
      if (!valueOf(d, 'libs')) warn('system/controlDict', `function ${e.key} 沒有 libs`);
      const pts = valueOf(d, 'patches');
      for (const p of [].concat(pts || [])) {
        if (!allPatches.some(q => q.name === p || q.groups.includes(p))) err('system/controlDict', `function ${e.key} 的 patch ${p} 不存在`);
      }
      if (valueOf(d, 'type') === 'surfaces') {
        for (const s of sub(d, 'surfaces')?.entries || []) {
          const sd = { entries: s.value?.dict || [] };
          for (const p of [].concat(valueOf(sd, 'patches') || [])) if (!allPatches.some(q => q.name === p || q.groups.includes(p))) err('system/controlDict', `surface ${s.key} 的 patch ${p} 不存在`);
        }
      }
      if (valueOf(d, 'type') === 'probes' && bounds) {
        for (const p of valueOf(d, 'probeLocations') || []) {
          if (p.some((x, i) => !(x > bounds.min[i] && x < bounds.max[i]))) err('system/controlDict', `probe (${p.join(' ')}) 不在計算域內`);
          for (const g of solids) if (insideGeometry(p, g)) warn('system/controlDict', `probe (${p.join(' ')}) 在障礙物 ${g.key} 裡`);
        }
      }
    }
  }
  const fs = need('system/fvSchemes');
  if (fs) {
    for (const k of ['ddtSchemes', 'gradSchemes', 'divSchemes', 'laplacianSchemes', 'interpolationSchemes', 'snGradSchemes']) if (!sub(fs, k)) err('system/fvSchemes', `缺 ${k}`);
    const div = sub(fs, 'divSchemes');
    if (div && valueOf(div, 'default') === 'none') for (const k of ['div(phi,U)', 'div(phi,k)', 'div(phi,omega)']) if (!entry(div, k)) err('system/fvSchemes', `divSchemes default none，卻缺 ${k}`);
  }
  const fsol = need('system/fvSolution');
  if (fsol) {
    const sol = sub(fsol, 'solvers');
    for (const f of ['p', 'U', 'k', 'omega']) if (!matchKey(keys(sol || { entries: [] }), f)) err('system/fvSolution', `solvers 沒有涵蓋 ${f}`);
    if (!sub(fsol, 'SIMPLE')) err('system/fvSolution', '缺 SIMPLE');
  }

  // ---------- 常數
  const tp = need('constant/transportProperties');
  if (tp && !(Number(valueOf(tp, 'nu')) > 0)) err('constant/transportProperties', 'nu 要是正數');
  const tu = need('constant/turbulenceProperties');
  if (tu && valueOf(tu, 'simulationType') === 'RAS' && !valueOf(tu, 'RAS', 'RASModel')) err('constant/turbulenceProperties', 'RAS 缺 RASModel');

  // ---------- 初始欄位
  const dir = files['0.orig/U'] ? '0.orig' : '0';
  for (const [f, cls] of Object.entries(FIELD_CLASS)) {
    const path = `${dir}/${f}`;
    const d = need(path);
    if (!d) continue;
    if (valueOf(d, 'FoamFile', 'class') !== cls) err(path, `class 要是 ${cls}`);
    const dm = entry(d, 'dimensions')?.value?.tokens?.[0];
    if (!dm || dm.group !== '[' || dm.items.length !== 7) err(path, 'dimensions 要是 7 個數的 [ ]');
    if (!entry(d, 'internalField')) err(path, '缺 internalField');
    const bf = sub(d, 'boundaryField');
    if (!bf) { err(path, '缺 boundaryField'); continue; }
    const bkeys = keys(bf);
    for (const p of allPatches) {
      const k = bkeys.find(k => k === p.name) || bkeys.find(k => p.groups.includes(k)) || bkeys.find(k => /^".*"$/.test(k) && new RegExp(`^${k.slice(1, -1)}$`).test(p.name));
      if (!k) { err(path, `patch ${p.name} 沒有邊界條件`); continue; }
      const type = valueOf(bf, k, 'type');
      if (!BC_TYPES.has(type)) err(path, `${k} 的型別 ${type} 不在已知清單（拼字？）`);
      if ((p.type === 'symmetry' || p.type === 'empty') && type !== p.type) err(path, `${p.name} 是 ${p.type} patch，邊界條件也要是 ${p.type}`);
      const bd = sub(bf, k);
      if (['fixedValue', 'inletOutlet', 'calculated', 'kqRWallFunction', 'omegaWallFunction', 'nutkWallFunction', 'nutkAtmRoughWallFunction'].includes(type) && !entry(bd, 'value')) err(path, `${k}（${type}）缺 value`);
      if (type === 'inletOutlet' && !entry(bd, 'inletValue')) err(path, `${k} 缺 inletValue`);
      if (/^atmBoundaryLayerInlet/.test(type)) for (const kk of ['flowDir', 'zDir', 'Uref', 'Zref', 'z0', 'd']) if (!entry(bd, kk)) err(path, `${k} 缺 ${kk}`);
    }
    for (const k of bkeys) if (!/^"/.test(k) && !allPatches.some(p => p.name === k || p.groups.includes(k))) warn(path, `boundaryField 的 ${k} 沒有對應的 patch`);
  }

  // ---------- 腳本
  for (const s of ['Allrun', 'Allclean']) {
    const t = files[s];
    if (!t) { err(s, '缺少檔案'); continue; }
    if (!t.startsWith('#!/bin/sh') && !t.startsWith('#!/bin/bash')) err(s, '第一行要是 #!/bin/sh');
    if (/\r/.test(t)) err(s, '含 CR（Windows 換行），Linux 會執行失敗');
  }
  if (files.Allrun) {
    for (const step of ['blockMesh', 'snappyHexMesh', 'restore0Dir']) if (!files.Allrun.includes(step)) err('Allrun', `沒有 ${step} 步驟`);
    if (files['system/topoSetDict'] && !files.Allrun.includes('topoSet')) err('Allrun', '有 topoSetDict 卻沒有跑 topoSet');
    if (files['system/surfaceFeatureExtractDict'] && !files.Allrun.includes('surfaceFeatureExtract')) err('Allrun', '有 surfaceFeatureExtractDict 卻沒有跑 surfaceFeatureExtract');
  }

  return { errors, warnings, checked: Object.keys(parsed).length };
}

function matchKey(ks, name) {
  return ks.some(k => k === name || (/^".*"$/.test(k) && new RegExp(`^${k.slice(1, -1)}$`).test(name)));
}

function insideGeometry(p, g) {
  const v = k => valueOf(g.d, k);
  if (g.type === 'searchableBox') return p.every((x, i) => x >= v('min')[i] && x <= v('max')[i]);
  if (g.type === 'searchableRotatedBox') {
    const e1 = v('e1'), e3 = v('e3'), o = v('origin'), s = v('span');
    const e2 = [e3[1] * e1[2] - e3[2] * e1[1], e3[2] * e1[0] - e3[0] * e1[2], e3[0] * e1[1] - e3[1] * e1[0]];
    const d = p.map((x, i) => x - o[i]);
    return [e1, e2, e3].every((e, j) => { const t = d[0] * e[0] + d[1] * e[1] + d[2] * e[2]; return t >= 0 && t <= s[j]; });
  }
  if (g.type === 'searchableCylinder') {
    const a = v('point1'), b = v('point2'), r = v('radius');
    const ax = b.map((x, i) => x - a[i]), L = Math.hypot(...ax), u = ax.map(x => x / L);
    const d = p.map((x, i) => x - a[i]), t = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    if (t < 0 || t > L) return false;
    return Math.hypot(...d.map((x, i) => x - u[i] * t)) <= r;
  }
  return false;
}
