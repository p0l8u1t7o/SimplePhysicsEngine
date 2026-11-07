// OpenFOAM 案例產生器（純 JS，不碰檔案系統）：輸入 JSON → { files: { 相對路徑: 內容 }, meta, warnings }。
// 目標發行版：OpenFOAM.com（ESI／OpenCFD）v2412，Docker 映像 opencfd/openfoam-default:2412（v2306 以後的語法相同）。
// OpenFOAM.org（Foundation，v11 以後）的命名差異記在 README「發行版差異」，這裡不產生。
// 求解器：simpleFoam（穩態不可壓縮）＋ k-omega SST。interFoam（自由液面）列為之後的工作。
// 計算域兩種：
//   external：戶外風場（風洞式），入口 ABL 或均勻流、地面粗糙壁、頂面與兩側 symmetry、出口壓力 0。
//   enclosure：封閉空間（機櫃、廠房、水槽），六面都是牆，開口（inlet／outlet）用 topoSet＋createPatch 從牆上切出來。
import { foamFile, raw, dims, list, named, vec, str, fmt } from './foam-dict.js';
import {
  createFrame, orientedBoxFromInput, boxToFoam, boxCorners, axisAligned, rotatedBoxParams, cylinderFromInput,
  pointInBox, pointInCylinder, boxTriangles, cylinderTriangles, writeStl, v3, clean,
} from './geometry.js';
import { stringifyCompact } from './json.js';

export const GENERATOR_VERSION = '0.1.0';
export const TARGET = { distribution: 'openfoam.com', version: 'v2412', image: 'opencfd/openfoam-default:2412', minVersion: 'v2306' };

const MEDIA = {
  air: { nu: 1.5e-5, rho: 1.225 },     // 20 °C 空氣
  water: { nu: 1.0e-6, rho: 998.2 },   // 20 °C 水
};
const KAPPA = 0.41, CMU = 0.09;

const DIMS = {
  U: [0, 1, -1, 0, 0, 0, 0], p: [0, 2, -2, 0, 0, 0, 0], k: [0, 2, -2, 0, 0, 0, 0],
  omega: [0, 0, -1, 0, 0, 0, 0], nut: [0, 2, -1, 0, 0, 0, 0],
};

const safeName = s => {
  const n = String(s).replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(n)) throw new Error(`名稱要以英文字母開頭（OpenFOAM patch 名稱）：${s}`);
  return n;
};

// ---------------------------------------------------------------- 正規化輸入

export function normalize(input) {
  const warnings = [];
  const name = input.name || 'case';
  const fr = input.frame || {};
  const flowIn = input.flow || {};
  const medium = flowIn.medium || 'air';
  if (!MEDIA[medium]) throw new Error(`不支援的 medium：${medium}（air、water）`);
  const kind = input.domain?.kind || 'external';
  if (!['external', 'enclosure'].includes(kind)) throw new Error(`domain.kind 只能是 external 或 enclosure：${kind}`);
  const solverIn = input.solver || {};
  const app = solverIn.application || 'simpleFoam';
  if (app === 'interFoam') throw new Error('interFoam（自由液面）尚未支援，列為之後的工作；目前只有 simpleFoam');
  if (app !== 'simpleFoam') throw new Error(`不支援的求解器：${app}`);
  const turb = solverIn.turbulence || 'kOmegaSST';
  if (turb !== 'kOmegaSST') throw new Error(`目前只支援 kOmegaSST：${turb}`);

  const frame = createFrame({ up: fr.up || 'y', units: fr.units || 'mm', origin: fr.origin || [0, 0, 0], direction: kind === 'external' ? (flowIn.direction || [1, 0, 0]) : [1, 0, 0] });
  const s = frame.scale;
  const upIdx = frame.up === 'y' ? 1 : 2;
  const groundScene = input.ground?.level ?? 0;
  const gp = [0, 0, 0]; gp[upIdx] = groundScene;
  const zGround = frame.toFoam(gp)[2];

  // 障礙物
  const names = new Set();
  const obstacles = (input.obstacles || []).map((o, i) => {
    const nm = safeName(o.name || `obstacle${i + 1}`);
    if (names.has(nm)) throw new Error(`障礙物名稱重複：${nm}`);
    names.add(nm);
    const type = o.type || 'box';
    const base = { name: nm, type, group: o.group ? safeName(o.group) : null, report: o.report ?? (type === 'plate'), level: o.level || (type === 'plate' ? [4, 5] : [3, 4]), geometry: o.geometry || null, label: o.label || null };
    if (type === 'box' || type === 'plate') {
      const box = orientedBoxFromInput({ ...o, name: nm });
      return { ...base, sceneBox: box, foamBox: boxToFoam(box, frame), thicknessIn: type === 'plate' ? (o.thickness ?? 40) : null };
    }
    if (type === 'cylinder') {
      const c = cylinderFromInput({ ...o, name: nm });
      return { ...base, sceneCyl: c, foamCyl: { p1: frame.toFoam(c.p1), p2: frame.toFoam(c.p2), radius: clean(c.radius * s) } };
    }
    throw new Error(`障礙物 ${nm}：不支援的 type ${type}（box、plate、cylinder）`);
  });

  // 障礙物在 foam 座標的外框與高度 H
  const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const grow = p => { for (let i = 0; i < 3; i++) { bb.min[i] = Math.min(bb.min[i], p[i]); bb.max[i] = Math.max(bb.max[i], p[i]); } };
  for (const o of obstacles) {
    if (o.foamBox) boxCorners(o.foamBox).forEach(grow);
    else { const { p1, p2, radius: r } = o.foamCyl; for (const p of [p1, p2]) { grow(v3.add(p, [r, r, r])); grow(v3.sub(p, [r, r, r])); } }
  }
  const hasObs = obstacles.length > 0;
  const H = hasObs ? Math.max(bb.max[2] - zGround, 1e-3) : 1;

  // 長度：數字為輸入單位；字串 "5H" 為障礙物高度的倍數
  const len = (v, dflt) => {
    if (v === undefined || v === null) v = dflt;
    if (typeof v === 'number') return v * s;
    const m = /^\s*([\d.]+)\s*H\s*$/.exec(String(v));
    if (!m) throw new Error(`長度格式錯誤：${v}（數字或 "5H"）`);
    return Number(m[1]) * H;
  };

  // 計算域
  const dIn = input.domain || {};
  let dom;
  if (kind === 'external') {
    if (!hasObs && !dIn.min) throw new Error('external 計算域沒有障礙物時要給 domain.min／max');
    if (dIn.min && dIn.max) {
      const a = frame.toFoam(dIn.min), b = frame.toFoam(dIn.max);
      dom = { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) };
      dom.min[2] = zGround;
    } else {
      const up = len(dIn.upstream, '5H'), down = len(dIn.downstream, '15H'), lat = len(dIn.lateral, '5H'), hgt = len(dIn.height, '6H');
      dom = {
        min: [bb.min[0] - up, bb.min[1] - lat, zGround],
        max: [bb.max[0] + down, bb.max[1] + lat, Math.max(zGround + hgt, bb.max[2] + H)],
      };
    }
  } else {
    if (!dIn.min || !dIn.max) throw new Error('enclosure 計算域要給 domain.min／max（場景座標）');
    const a = frame.toFoam(dIn.min), b = frame.toFoam(dIn.max);
    dom = { min: a.map((v, i) => Math.min(v, b[i])), max: a.map((v, i) => Math.max(v, b[i])) };
  }
  // 網格：external 把計算域往外擴到基準格的整數倍，背景網格維持正立方體（snappy 需要）；enclosure 牆面位置不能動，只算格數
  const mIn = input.mesh || {};
  const baseCell = mIn.baseCell !== undefined ? len(mIn.baseCell) : (hasObs ? H / 4 : 0.25); // 預設 H/4
  const L0 = dom.max.map((v, i) => v - dom.min[i]);
  const cells = L0.map(l => Math.max(1, Math.ceil(l / baseCell - 1e-9)));
  if (kind === 'external' && !(dIn.min && dIn.max)) {
    const r6 = x => Math.round(x * 1e6) / 1e6; // 0.001 mm
    for (let i = 0; i < 3; i++) {
      const extra = cells[i] * baseCell - L0[i];
      if (i === 2) dom.max[2] = r6(dom.min[2] + cells[2] * baseCell);
      else { dom.min[i] = r6(dom.min[i] - extra / 2); dom.max[i] = r6(dom.min[i] + cells[i] * baseCell); }
    }
  }
  dom.min = dom.min.map(clean); dom.max = dom.max.map(clean);
  const L = dom.max.map((v, i) => v - dom.min[i]);
  const finest = lvl => baseCell / 2 ** lvl;
  const geometryMode = mIn.geometryMode || 'searchable';
  if (!['searchable', 'stl'].includes(geometryMode)) throw new Error(`mesh.geometryMode 只能是 searchable 或 stl：${geometryMode}`);

  // 薄板：厚度至少 minPlateCells 格（最細層），否則 snappy 會讓網格從板中間漏過或把板吃掉
  const minPlateCells = mIn.minPlateCells ?? 2;
  for (const o of obstacles) {
    if (o.type !== 'plate') continue;
    const need = minPlateCells * finest(o.level[1]);
    const t = o.foamBox.half[1] * 2;
    if (t < need - 1e-12) {
      warnings.push(`面板 ${o.name} 厚度 ${fmt(t * 1000)} mm 小於最細網格的 ${minPlateCells} 格（${fmt(need * 1000)} mm），已加厚到 ${fmt(need * 1000)} mm；要保留真實厚度就提高 level 或改用 baffle（之後的工作）`);
      o.foamBox.half[1] = clean(need / 2);
      o.inflated = clean(need);
    }
  }

  // 尾流加密區（external）：障礙物外框往上游 1H、下游 4H、側向 1H、高度 1.5H
  const regions = [];
  const wakeIn = mIn.wake === false ? null : (mIn.wake || {});
  if (kind === 'external' && hasObs && wakeIn) {
    const r = {
      name: 'wake', level: wakeIn.level ?? 2,
      min: [bb.min[0] - len(wakeIn.upstream, '1H'), bb.min[1] - len(wakeIn.lateral, '1H'), zGround],
      max: [bb.max[0] + len(wakeIn.downstream, '4H'), bb.max[1] + len(wakeIn.lateral, '1H'), zGround + len(wakeIn.height, '1.5H')],
    };
    r.min = r.min.map((v, i) => clean(Math.max(v, dom.min[i]))); r.max = r.max.map((v, i) => clean(Math.min(v, dom.max[i])));
    regions.push(r);
  }
  for (const [i, r] of (mIn.regions || []).entries()) {
    const corners = [];
    for (const x of [r.min[0], r.max[0]]) for (const y of [r.min[1], r.max[1]]) for (const z of [r.min[2], r.max[2]]) corners.push(frame.toFoam([x, y, z]));
    const mn = [0, 1, 2].map(k => clean(Math.min(...corners.map(c => c[k])))), mx = [0, 1, 2].map(k => clean(Math.max(...corners.map(c => c[k]))));
    regions.push({ name: safeName(r.name || `region${i + 1}`), level: r.level ?? 2, min: mn, max: mx });
  }

  // 流動條件
  const nu = flowIn.nu ?? MEDIA[medium].nu, rho = flowIn.rho ?? MEDIA[medium].rho;
  const profile = kind === 'external' ? (flowIn.profile || 'abl') : 'uniform';
  const Uref = flowIn.Uref ?? (kind === 'external' ? 10 : 1);
  const Zref = flowIn.Zref !== undefined ? len(flowIn.Zref) : 10; // 預設 10 m（氣象站高度）
  const z0 = flowIn.z0 !== undefined ? len(flowIn.z0) : 0.03;   // 預設 0.03 m（開闊草地）
  const intensity = flowIn.intensity ?? 0.05;
  const mixingLength = flowIn.mixingLength !== undefined ? len(flowIn.mixingLength) : (kind === 'external' ? 0.5 * H : 0.1);
  let turbInit;
  if (profile === 'abl') {
    const ustar = KAPPA * Uref / Math.log((Zref + z0) / z0);
    const k = ustar ** 2 / Math.sqrt(CMU);
    const omega = ustar / (KAPPA * Math.sqrt(CMU) * Zref);
    turbInit = { ustar, k, omega };
  } else {
    const k = 1.5 * (Uref * intensity) ** 2;
    const omega = Math.sqrt(k) / (CMU ** 0.25 * mixingLength);
    turbInit = { k, omega };
  }

  // 開口（enclosure）
  const openings = [];
  if (kind === 'enclosure') {
    for (const [i, op] of (dIn.openings || []).entries()) {
      const nm = safeName(op.name || `opening${i + 1}`);
      if (names.has(nm) || nm === 'walls') throw new Error(`開口名稱和其他 patch 重複：${nm}`);
      names.add(nm);
      const a = frame.toFoam(op.min), b = frame.toFoam(op.max);
      const mn = a.map((v, k) => Math.min(v, b[k])), mx = a.map((v, k) => Math.max(v, b[k]));
      // 找出開口貼在哪一面牆：某一軸的兩端都在計算域邊界上
      const tol = 1e-6 + 1e-4 * Math.max(...L);
      let wall = null;
      for (let k = 0; k < 3 && !wall; k++) {
        for (const side of [0, 1]) {
          const b0 = side ? dom.max[k] : dom.min[k];
          if (Math.abs(mn[k] - b0) <= tol && Math.abs(mx[k] - b0) <= tol) { wall = { axis: k, side }; break; }
        }
      }
      if (!wall) throw new Error(`開口 ${nm} 不在計算域的任何一面牆上（min／max 有一軸要等於牆面座標）`);
      const h = baseCell / 2; // 把貼牆那一軸撐開半格，boxToFace 才抓得到牆面的面心
      mn[wall.axis] -= h; mx[wall.axis] += h;
      const kindOp = op.kind || 'inlet';
      if (!['inlet', 'outlet'].includes(kindOp)) throw new Error(`開口 ${nm} 的 kind 只能是 inlet 或 outlet`);
      openings.push({ name: nm, kind: kindOp, min: mn.map(clean), max: mx.map(clean), wall, velocity: op.velocity ?? Uref, area: [0, 1, 2].filter(k => k !== wall.axis).reduce((A, k) => A * (mx[k] - mn[k]), 1) });
    }
    if (!openings.some(o => o.kind === 'inlet') || !openings.some(o => o.kind === 'outlet')) throw new Error('enclosure 至少要有一個 inlet 和一個 outlet 開口');
  }

  // 求解設定
  const solver = {
    application: app, turbulence: turb,
    iterations: solverIn.iterations ?? 1000,
    writeInterval: solverIn.writeInterval ?? 250,
    nProcs: solverIn.nProcs ?? 4,
    residual: solverIn.residual ?? 1e-4,
  };

  // 取樣
  const smIn = input.sampling || {};
  const reportObs = obstacles.filter(o => o.report);
  const slices = [];
  if (smIn.autoSlices !== false) {
    if (kind === 'external' && hasObs) {
      const zObs = obstacles.some(o => o.type === 'plate') ? obstacles.filter(o => o.type === 'plate') : reportObs;
      const zMid = zObs.length ? zObs.reduce((a, o) => a + (o.foamBox ? o.foamBox.center[2] : (o.foamCyl.p1[2] + o.foamCyl.p2[2]) / 2), 0) / zObs.length : (bb.min[2] + bb.max[2]) / 2;
      slices.push({ name: 'plan', point: [clean((dom.min[0] + dom.max[0]) / 2), clean((dom.min[1] + dom.max[1]) / 2), clean(zMid)], normal: [0, 0, 1] });
      slices.push({ name: 'elevation', point: [clean((bb.min[0] + bb.max[0]) / 2), clean((bb.min[1] + bb.max[1]) / 2 + 1e-4), clean((dom.min[2] + dom.max[2]) / 2)], normal: [0, 1, 0] });
    } else {
      const c = dom.min.map((v, i) => clean((v + dom.max[i]) / 2 + 1e-4));
      slices.push({ name: 'plan', point: c, normal: [0, 0, 1] }, { name: 'elevation', point: c, normal: [0, 1, 0] });
    }
  }
  for (const [i, sl] of (smIn.slices || []).entries()) {
    slices.push({ name: safeName(sl.name || `slice${i + 1}`), point: frame.toFoam(sl.point), normal: v3.norm(frame.dirToFoam(sl.normal)).map(clean) });
  }
  const probes = [];
  if (kind === 'external' && hasObs) {
    // 參考探針：障礙物上游、參考高度，拿來當 Cp 的參考靜壓
    probes.push({ name: 'ref', point: [clean((dom.min[0] + bb.min[0]) / 2), clean((bb.min[1] + bb.max[1]) / 2), clean(zGround + Math.min(Zref, (dom.max[2] - zGround) * 0.8))] });
  }
  for (const [i, pr] of (smIn.probes || []).entries()) {
    const pt = Array.isArray(pr) ? pr : pr.point;
    probes.push({ name: safeName(pr.name || `probe${i + 1}`), point: frame.toFoam(pt) });
  }
  const stIn = smIn.streamlines === false ? null : (smIn.streamlines || {});
  let streamSeeds = null;
  if (stIn) {
    const n = stIn.nSeeds ?? 24;
    if (kind === 'external' && hasObs) {
      const x = clean(Math.max(dom.min[0] + 1e-3, bb.min[0] - 0.5 * H)), y = clean((bb.min[1] + bb.max[1]) / 2 + 1e-4);
      streamSeeds = { start: [x, y, clean(zGround + 0.05 * H)], end: [x, y, clean(Math.min(dom.max[2] - 1e-3, bb.max[2] + 0.75 * H))], nPoints: n };
    } else {
      const a = dom.min.map((v, i) => clean(v + 0.1 * L[i])), b = dom.max.map((v, i) => clean(v - 0.1 * L[i]));
      streamSeeds = { start: a, end: b, nPoints: n };
    }
  }

  return {
    name, kind, medium, frame, zGround, H, bb: hasObs ? bb : null, domain: dom, size: L,
    mesh: { baseCell, cells, geometryMode, nCellsBetweenLevels: mIn.nCellsBetweenLevels ?? 3, regions, layers: mIn.layers ?? 0, finest },
    flow: { profile, Uref, Zref, z0, nu, rho, intensity, mixingLength, turbInit },
    obstacles, openings, solver,
    sampling: { slices, probes, streamSeeds, interval: smIn.writeInterval ?? solver.writeInterval },
    warnings,
  };
}

// ---------------------------------------------------------------- 各字典

function blockMeshDict(c) {
  const [x0, y0, z0] = c.domain.min, [x1, y1, z1] = c.domain.max;
  const V = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const F = { xmin: [0, 4, 7, 3], xmax: [2, 6, 5, 1], zmin: [0, 3, 2, 1], zmax: [4, 5, 6, 7], ymin: [1, 5, 4, 0], ymax: [3, 7, 6, 2] };
  const patch = (name, type, faces, extra = {}) => named(name, { type, ...extra, faces: raw(`(${faces.map(f => `(${f.join(' ')})`).join(' ')})`) });
  const boundary = c.kind === 'external'
    ? [
      patch('inlet', 'patch', [F.xmin]), patch('outlet', 'patch', [F.xmax]), patch('ground', 'wall', [F.zmin]),
      patch('top', 'symmetry', [F.zmax]), patch('sides', 'symmetry', [F.ymin, F.ymax]),
    ]
    : [patch('walls', 'wall', Object.values(F))];
  return foamFile({ object: 'blockMeshDict' }, {
    scale: 1,
    vertices: list(...V.map(v => vec(v))),
    blocks: list(raw(`hex (0 1 2 3 4 5 6 7) (${c.mesh.cells.join(' ')}) simpleGrading (1 1 1)`)),
    edges: list(),
    boundary: list(...boundary),
    mergePatchPairs: list(),
  });
}

function obstacleGeometry(c, o) {
  const mode = o.geometry || c.mesh.geometryMode;
  if (mode === 'stl') return { key: `${o.name}.stl`, dict: { type: 'triSurfaceMesh', name: o.name }, stl: true };
  if (o.foamBox) {
    const aa = axisAligned(o.foamBox);
    if (aa) return { key: o.name, dict: { type: 'searchableBox', min: vec(aa.min), max: vec(aa.max) } };
    const r = rotatedBoxParams(o.foamBox);
    return { key: o.name, dict: { type: 'searchableRotatedBox', span: vec(r.span), origin: vec(r.origin), e1: vec(r.e1), e3: vec(r.e3) } };
  }
  const { p1, p2, radius } = o.foamCyl;
  return { key: o.name, dict: { type: 'searchableCylinder', point1: vec(p1), point2: vec(p2), radius } };
}

function insideAnyObstacle(c, p, margin) {
  return c.obstacles.some(o => (o.foamBox ? pointInBox(p, o.foamBox, margin) : pointInCylinder(p, o.foamCyl, margin)));
}

// locationInMesh：在流體區內、不落在網格面上（用不整齊的比例）、不在任何障礙物裡
export function locationInMesh(c) {
  const fr = [[0.0737, 0.3719, 0.8131], [0.9213, 0.6173, 0.7417], [0.1171, 0.8923, 0.4567], [0.5521, 0.1279, 0.9137]];
  const margin = 2 * c.mesh.baseCell;
  for (const f of fr) {
    const p = c.domain.min.map((v, i) => clean(v + f[i] * c.size[i]));
    if (!insideAnyObstacle(c, p, margin)) return p;
  }
  throw new Error('找不到不在障礙物裡的 locationInMesh，請放大計算域');
}

function snappyHexMeshDict(c) {
  const geometry = {}, refinementSurfaces = {}, features = [], refinementRegions = {};
  for (const o of c.obstacles) {
    const g = obstacleGeometry(c, o);
    geometry[g.key] = g.dict;
    const groups = ['obstacles', o.group].filter(Boolean);
    refinementSurfaces[o.name] = { level: o.level, patchInfo: { type: 'wall', inGroups: raw(`(${groups.join(' ')})`) } };
    if (g.stl) features.push({ file: str(`${o.name}.eMesh`), level: o.level[1] });
  }
  for (const r of c.mesh.regions) {
    geometry[r.name] = { type: 'searchableBox', min: vec(r.min), max: vec(r.max) };
    refinementRegions[r.name] = { mode: 'inside', levels: raw(`((1e15 ${r.level}))`) };
  }
  const anyStl = features.length > 0;
  return foamFile({ object: 'snappyHexMeshDict' }, {
    castellatedMesh: true,
    snap: true,
    addLayers: c.mesh.layers > 0,
    geometry,
    castellatedMeshControls: {
      maxLocalCells: 2000000,
      maxGlobalCells: 20000000,
      minRefinementCells: 10,
      maxLoadUnbalance: 0.1,
      nCellsBetweenLevels: c.mesh.nCellsBetweenLevels,
      features: raw(features.length ? `(\n${features.map(f => `        { file ${f.file}; level ${f.level}; }`).join('\n')}\n    )` : '()'),
      refinementSurfaces,
      resolveFeatureAngle: 30,
      refinementRegions,
      locationInMesh: vec(locationInMesh(c)),
      allowFreeStandingZoneFaces: true,
    },
    snapControls: {
      nSmoothPatch: 3,
      tolerance: 2.0,
      nSolveIter: 50,
      nRelaxIter: 5,
      nFeatureSnapIter: 10,
      implicitFeatureSnap: !anyStl,
      explicitFeatureSnap: anyStl,
      multiRegionFeatureSnap: false,
    },
    addLayersControls: {
      relativeSizes: true,
      layers: Object.fromEntries(c.mesh.layers > 0 ? c.obstacles.map(o => [o.name, { nSurfaceLayers: c.mesh.layers }]) : []),
      expansionRatio: 1.2,
      finalLayerThickness: 0.5,
      minThickness: 0.1,
      nGrow: 0,
      featureAngle: 60,
      slipFeatureAngle: 30,
      nRelaxIter: 3,
      nSmoothSurfaceNormals: 1,
      nSmoothNormals: 3,
      nSmoothThickness: 10,
      maxFaceThicknessRatio: 0.5,
      maxThicknessToMedialRatio: 0.3,
      minMedialAxisAngle: 90,
      nBufferCellsNoExtrude: 0,
      nLayerIter: 50,
    },
    meshQualityControls: { '#include': str('meshQualityDict') },
    mergeTolerance: 1e-6,
  });
}

function surfaceFeatureExtractDict(c) {
  const body = {};
  for (const o of c.obstacles) {
    if ((o.geometry || c.mesh.geometryMode) !== 'stl') continue;
    body[`${o.name}.stl`] = {
      extractionMethod: 'extractFromSurface',
      extractFromSurfaceCoeffs: { includedAngle: 150 },
      subsetFeatures: { nonManifoldEdges: 'no', openEdges: 'yes' },
      writeObj: 'no',
    };
  }
  return Object.keys(body).length ? foamFile({ object: 'surfaceFeatureExtractDict' }, body) : null;
}

function controlDict(c) {
  const sm = c.sampling;
  const report = c.obstacles.filter(o => o.report);
  const surfaces = {};
  for (const sl of sm.slices) {
    surfaces[sl.name] = { type: 'cuttingPlane', planeType: 'pointAndNormal', pointAndNormalDict: { point: vec(sl.point), normal: vec(sl.normal) }, interpolate: true };
  }
  for (const o of report) surfaces[`patch_${o.name}`] = { type: 'patch', patches: raw(`(${o.name})`), interpolate: false };
  const functions = {
    surfaces: {
      type: 'surfaces', libs: raw('(sampling)'),
      writeControl: 'writeTime',
      surfaceFormat: 'vtk',
      formatOptions: { vtk: { format: 'ascii', legacy: true, precision: 7 } },
      fields: raw('(p U k nut)'),
      interpolationScheme: 'cellPoint',
      surfaces,
    },
  };
  if (sm.probes.length) {
    functions.probes = {
      type: 'probes', libs: raw('(sampling)'),
      writeControl: 'timeStep', writeInterval: 10,
      fields: raw('(p U)'),
      probeLocations: list(...sm.probes.map(p => vec(p.point))),
    };
  }
  for (const o of report) {
    const center = o.foamBox ? o.foamBox.center : v3.scale(v3.add(o.foamCyl.p1, o.foamCyl.p2), 0.5);
    functions[`forces_${o.name}`] = {
      type: 'forces', libs: raw('(forces)'),
      writeControl: 'timeStep', writeInterval: 10,
      patches: raw(`(${o.name})`),
      rho: 'rhoInf', rhoInf: c.flow.rho,
      CofR: vec(center.map(clean)),
      log: false,
    };
  }
  if (sm.streamSeeds) {
    functions.streamLines = {
      type: 'streamLine', libs: raw('(fieldFunctionObjects)'),
      writeControl: 'writeTime',
      setFormat: 'vtk',
      U: 'U',
      direction: 'forward',
      fields: raw('(p U)'),
      lifeTime: 10000,
      nSubCycle: 5,
      cloud: 'particleTracks',
      seedSampleSet: { type: 'uniform', axis: 'xyz', start: vec(sm.streamSeeds.start), end: vec(sm.streamSeeds.end), nPoints: sm.streamSeeds.nPoints },
    };
  }
  functions.yPlus = { type: 'yPlus', libs: raw('(fieldFunctionObjects)'), writeControl: 'writeTime' };
  functions.residuals = { type: 'solverInfo', libs: raw('(utilityFunctionObjects)'), fields: raw('(U p k omega)'), writeResidualFields: 'no' };

  return foamFile({ object: 'controlDict' }, {
    application: c.solver.application,
    startFrom: 'latestTime',
    startTime: 0,
    stopAt: 'endTime',
    endTime: c.solver.iterations,
    deltaT: 1,
    writeControl: 'timeStep',
    writeInterval: c.solver.writeInterval,
    purgeWrite: 2,
    writeFormat: 'binary',
    writePrecision: 8,
    writeCompression: 'off',
    timeFormat: 'general',
    timePrecision: 6,
    runTimeModifiable: true,
    functions,
  });
}

function fvSchemes() {
  return foamFile({ object: 'fvSchemes' }, {
    ddtSchemes: { default: 'steadyState' },
    gradSchemes: { default: 'Gauss linear', 'grad(U)': 'cellLimited Gauss linear 1', 'grad(k)': 'cellLimited Gauss linear 1', 'grad(omega)': 'cellLimited Gauss linear 1' },
    divSchemes: {
      default: 'none',
      'div(phi,U)': 'bounded Gauss linearUpwind grad(U)',
      'div(phi,k)': 'bounded Gauss limitedLinear 1',
      'div(phi,omega)': 'bounded Gauss limitedLinear 1',
      'div((nuEff*dev2(T(grad(U)))))': 'Gauss linear',
    },
    laplacianSchemes: { default: 'Gauss linear limited corrected 0.33' },
    interpolationSchemes: { default: 'linear' },
    snGradSchemes: { default: 'limited corrected 0.33' },
    wallDist: { method: 'meshWave' },
  });
}

function fvSolution(c) {
  return foamFile({ object: 'fvSolution' }, {
    solvers: {
      p: { solver: 'GAMG', smoother: 'GaussSeidel', tolerance: 1e-7, relTol: 0.1 },
      '"(U|k|omega)"': { solver: 'smoothSolver', smoother: 'symGaussSeidel', tolerance: 1e-8, relTol: 0.1 },
    },
    SIMPLE: {
      nNonOrthogonalCorrectors: 1,
      consistent: 'no',
      residualControl: { p: c.solver.residual, U: c.solver.residual / 10, '"(k|omega)"': c.solver.residual / 10 },
    },
    relaxationFactors: {
      fields: { p: 0.3 },
      equations: { U: 0.7, '"(k|omega)"': 0.7 },
    },
  });
}

function decomposeParDict(c) {
  return foamFile({ object: 'decomposeParDict' }, { numberOfSubdomains: c.solver.nProcs, method: 'scotch' });
}

function meshQualityDict() {
  return foamFile({ object: 'meshQualityDict' }, { '#includeEtc': str('caseDicts/meshQualityDict'), minFaceWeight: 0.02 });
}

function topoSetDict(c) {
  const actions = [];
  for (const op of c.openings) {
    actions.push({ name: `${op.name}Faces`, type: 'faceSet', action: 'new', source: 'boxToFace', box: raw(`(${op.min.map(fmt).join(' ')}) (${op.max.map(fmt).join(' ')})`) });
    actions.push({ name: `${op.name}Faces`, type: 'faceSet', action: 'subset', source: 'patchToFace', patch: 'walls' });
  }
  return foamFile({ object: 'topoSetDict' }, { actions: list(...actions) });
}

function createPatchDict(c) {
  return foamFile({ object: 'createPatchDict' }, {
    pointSync: false,
    patches: list(...c.openings.map(op => ({ name: op.name, patchInfo: { type: 'patch', inGroups: raw(`(${op.kind}s)`) }, constructFrom: 'set', set: `${op.name}Faces` }))),
  });
}

function transportProperties(c) {
  return foamFile({ object: 'transportProperties', location: 'constant' }, { transportModel: 'Newtonian', nu: c.flow.nu });
}

function turbulenceProperties() {
  return foamFile({ object: 'turbulenceProperties', location: 'constant' }, {
    simulationType: 'RAS',
    RAS: { RASModel: 'kOmegaSST', turbulence: 'on', printCoeffs: 'on' },
  });
}

// 0.orig 欄位
function fieldFile(name, cls, internal, boundaryField) {
  return foamFile({ cls, object: name, location: '0' }, { dimensions: dims(DIMS[name]), internalField: internal, boundaryField });
}

function initialFields(c) {
  const f = c.flow, { k, omega } = f.turbInit;
  const files = {};
  const obst = c.obstacles.length > 0;
  const uniform = v => (Array.isArray(v) ? `uniform (${v.map(fmt).join(' ')})` : `uniform ${fmt(v)}`);
  if (c.kind === 'external') {
    const abl = f.profile === 'abl';
    const ablKeys = { flowDir: vec([1, 0, 0]), zDir: vec([0, 0, 1]), Uref: f.Uref, Zref: clean(f.Zref), z0: `uniform ${fmt(f.z0)}`, d: `uniform ${fmt(c.zGround)}`, kappa: KAPPA, Cmu: CMU };
    const wallsU = obst ? { obstacles: { type: 'noSlip' } } : {};
    files['0.orig/U'] = fieldFile('U', 'volVectorField', uniform([f.Uref, 0, 0]), {
      inlet: abl ? { type: 'atmBoundaryLayerInletVelocity', ...ablKeys, value: '$internalField' } : { type: 'fixedValue', value: uniform([f.Uref, 0, 0]) },
      outlet: { type: 'inletOutlet', inletValue: uniform([0, 0, 0]), value: '$internalField' },
      ground: { type: 'noSlip' },
      top: { type: 'symmetry' }, sides: { type: 'symmetry' },
      ...wallsU,
    });
    files['0.orig/p'] = fieldFile('p', 'volScalarField', 'uniform 0', {
      inlet: { type: 'zeroGradient' }, outlet: { type: 'fixedValue', value: 'uniform 0' },
      ground: { type: 'zeroGradient' }, top: { type: 'symmetry' }, sides: { type: 'symmetry' },
      ...(obst ? { obstacles: { type: 'zeroGradient' } } : {}),
    });
    files['0.orig/k'] = fieldFile('k', 'volScalarField', uniform(k), {
      inlet: abl ? { type: 'atmBoundaryLayerInletK', ...ablKeys, value: '$internalField' } : { type: 'turbulentIntensityKineticEnergyInlet', intensity: f.intensity, value: '$internalField' },
      outlet: { type: 'inletOutlet', inletValue: '$internalField', value: '$internalField' },
      ground: { type: 'kqRWallFunction', value: '$internalField' },
      top: { type: 'symmetry' }, sides: { type: 'symmetry' },
      ...(obst ? { obstacles: { type: 'kqRWallFunction', value: '$internalField' } } : {}),
    });
    files['0.orig/omega'] = fieldFile('omega', 'volScalarField', uniform(omega), {
      inlet: abl ? { type: 'atmBoundaryLayerInletOmega', ...ablKeys, value: '$internalField' } : { type: 'turbulentMixingLengthFrequencyInlet', mixingLength: clean(f.mixingLength), value: '$internalField' },
      outlet: { type: 'inletOutlet', inletValue: '$internalField', value: '$internalField' },
      ground: { type: 'omegaWallFunction', value: '$internalField' },
      top: { type: 'symmetry' }, sides: { type: 'symmetry' },
      ...(obst ? { obstacles: { type: 'omegaWallFunction', value: '$internalField' } } : {}),
    });
    files['0.orig/nut'] = fieldFile('nut', 'volScalarField', 'uniform 0', {
      inlet: { type: 'calculated', value: 'uniform 0' }, outlet: { type: 'calculated', value: 'uniform 0' },
      ground: abl ? { type: 'nutkAtmRoughWallFunction', z0: `uniform ${fmt(f.z0)}`, value: 'uniform 0' } : { type: 'nutkWallFunction', value: 'uniform 0' },
      top: { type: 'symmetry' }, sides: { type: 'symmetry' },
      ...(obst ? { obstacles: { type: 'nutkWallFunction', value: 'uniform 0' } } : {}),
    });
  } else {
    // enclosure：牆（含障礙物）、inlets／outlets 兩個 patch 群組＋各開口
    const inl = c.openings.filter(o => o.kind === 'inlet');
    const perInletU = Object.fromEntries(inl.map(o => [o.name, { type: 'surfaceNormalFixedValue', refValue: `uniform ${fmt(-o.velocity)}`, value: 'uniform (0 0 0)' }]));
    files['0.orig/U'] = fieldFile('U', 'volVectorField', 'uniform (0 0 0)', {
      walls: { type: 'noSlip' }, ...(obst ? { obstacles: { type: 'noSlip' } } : {}),
      outlets: { type: 'inletOutlet', inletValue: 'uniform (0 0 0)', value: '$internalField' },
      ...perInletU,
    });
    files['0.orig/p'] = fieldFile('p', 'volScalarField', 'uniform 0', {
      walls: { type: 'zeroGradient' }, ...(obst ? { obstacles: { type: 'zeroGradient' } } : {}),
      inlets: { type: 'zeroGradient' }, outlets: { type: 'fixedValue', value: 'uniform 0' },
    });
    const wallish = (t, v) => ({ walls: { type: t, value: v }, ...(obst ? { obstacles: { type: t, value: v } } : {}) });
    files['0.orig/k'] = fieldFile('k', 'volScalarField', uniform(k), {
      ...wallish('kqRWallFunction', '$internalField'),
      inlets: { type: 'turbulentIntensityKineticEnergyInlet', intensity: f.intensity, value: '$internalField' },
      outlets: { type: 'inletOutlet', inletValue: '$internalField', value: '$internalField' },
    });
    files['0.orig/omega'] = fieldFile('omega', 'volScalarField', uniform(omega), {
      ...wallish('omegaWallFunction', '$internalField'),
      inlets: { type: 'turbulentMixingLengthFrequencyInlet', mixingLength: clean(f.mixingLength), value: '$internalField' },
      outlets: { type: 'inletOutlet', inletValue: '$internalField', value: '$internalField' },
    });
    files['0.orig/nut'] = fieldFile('nut', 'volScalarField', 'uniform 0', {
      ...wallish('nutkWallFunction', 'uniform 0'),
      inlets: { type: 'calculated', value: 'uniform 0' }, outlets: { type: 'calculated', value: 'uniform 0' },
    });
  }
  return files;
}

function allrun(c) {
  const stl = c.obstacles.some(o => (o.geometry || c.mesh.geometryMode) === 'stl');
  const par = c.solver.nProcs > 1;
  return [
    '#!/bin/sh',
    '# Generated by SimplePhysicsEngine cfd case generator. Target: OpenFOAM.com v2412 (works on v2306+).',
    '# Run inside an OpenFOAM environment (Docker opencfd/openfoam-default, WSL2 or Linux): ./Allrun',
    'cd "${0%/*}" || exit 1',
    '. "${WM_PROJECT_DIR:?}"/bin/tools/RunFunctions',
    '',
    'runApplication blockMesh',
    stl ? 'runApplication surfaceFeatureExtract' : null,
    'runApplication snappyHexMesh -overwrite',
    c.kind === 'enclosure' ? 'runApplication topoSet' : null,
    c.kind === 'enclosure' ? 'runApplication createPatch -overwrite' : null,
    'runApplication checkMesh',
    'restore0Dir',
    par ? 'runApplication decomposePar' : null,
    par ? 'runParallel "$(getApplication)"' : 'runApplication "$(getApplication)"',
    par ? 'runApplication reconstructPar -latestTime' : null,
    '',
    '# Results for the platform importer are in postProcessing/ (VTK surfaces, forces, probes, streamLines, yPlus, solverInfo).',
    'echo "done: $(ls -d postProcessing/* 2>/dev/null | tr \'\\n\' \' \')"',
    '',
  ].filter(l => l !== null).join('\n');
}

const allclean = () => [
  '#!/bin/sh',
  'cd "${0%/*}" || exit 1',
  '. "${WM_PROJECT_DIR:?}"/bin/tools/CleanFunctions',
  '',
  'cleanCase0',
  'rm -rf postProcessing',
  '',
].join('\n');

// 粗估網格數與時間（只給量級，實際取決於 snappy 的結果）
export function estimate(c) {
  const h0 = c.mesh.baseCell;
  let cells = c.mesh.cells[0] * c.mesh.cells[1] * c.mesh.cells[2];
  for (const r of c.mesh.regions) {
    const V = r.max.reduce((a, v, i) => a * Math.max(0, v - r.min[i]), 1);
    cells += V / h0 ** 3 * (8 ** r.level - 1);
  }
  for (const o of c.obstacles) {
    let A;
    if (o.foamBox) { const [a, b, d] = o.foamBox.half.map(x => 2 * x); A = 2 * (a * b + b * d + a * d); }
    else { const L = v3.len(v3.sub(o.foamCyl.p2, o.foamCyl.p1)), r = o.foamCyl.radius; A = 2 * Math.PI * r * L + 2 * Math.PI * r * r; }
    const h = h0 / 2 ** o.level[1];
    cells += A / h ** 2 * (c.mesh.nCellsBetweenLevels + 1) * 2;
  }
  cells = Math.round(cells);
  // simpleFoam 約每格每次疊代 2～4 µs（單核），這裡取 3 µs
  const seconds = cells * c.solver.iterations * 3e-6 / Math.max(1, c.solver.nProcs);
  const memoryMB = Math.round(cells * 1.5e-3); // 約 1.5 KB／格
  return { cells, seconds: Math.round(seconds), memoryMB };
}

// ---------------------------------------------------------------- 對外

export function generateCase(input) {
  const c = normalize(input);
  const files = {};
  files['system/blockMeshDict'] = blockMeshDict(c);
  files['system/snappyHexMeshDict'] = snappyHexMeshDict(c);
  files['system/meshQualityDict'] = meshQualityDict();
  const sfe = surfaceFeatureExtractDict(c);
  if (sfe) files['system/surfaceFeatureExtractDict'] = sfe;
  files['system/controlDict'] = controlDict(c);
  files['system/fvSchemes'] = fvSchemes();
  files['system/fvSolution'] = fvSolution(c);
  files['system/decomposeParDict'] = decomposeParDict(c);
  if (c.kind === 'enclosure') {
    files['system/topoSetDict'] = topoSetDict(c);
    files['system/createPatchDict'] = createPatchDict(c);
  }
  files['constant/transportProperties'] = transportProperties(c);
  files['constant/turbulenceProperties'] = turbulenceProperties();
  for (const o of c.obstacles) {
    if ((o.geometry || c.mesh.geometryMode) !== 'stl') continue;
    const tris = o.foamBox ? boxTriangles(o.foamBox) : cylinderTriangles(o.foamCyl, 32);
    files[`constant/triSurface/${o.name}.stl`] = writeStl(o.name, tris);
  }
  Object.assign(files, initialFields(c));
  files.Allrun = allrun(c);
  files.Allclean = allclean();

  const est = estimate(c);
  if (est.cells > 5e6) c.warnings.push(`粗估網格約 ${(est.cells / 1e6).toFixed(1)} M 格，單機跑會很久；考慮加大 baseCell 或降低 level`);
  const meta = buildMeta(c, est);
  files['cfd-case.json'] = stringifyCompact(meta) + '\n';
  return { files, meta, warnings: c.warnings, config: c };
}

function buildMeta(c, est) {
  const fr = c.frame;
  return {
    format: 'spe-cfd-case', version: 1, generator: GENERATOR_VERSION, target: TARGET,
    name: c.name, kind: c.kind, medium: c.medium,
    solver: { application: c.solver.application, turbulence: c.solver.turbulence, iterations: c.solver.iterations, nProcs: c.solver.nProcs },
    flow: { profile: c.flow.profile, Uref: c.flow.Uref, Zref: clean(c.flow.Zref), z0: clean(c.flow.z0), nu: c.flow.nu, rho: c.flow.rho, pressure: 'kinematic (p/rho), m2/s2' },
    frame: { up: fr.up, units: fr.units, scale: fr.scale, origin: fr.origin, headingDeg: fr.headingDeg, sceneToFoam: fr.sceneToFoam, foamToScene: fr.foamToScene },
    domain: { min: c.domain.min, max: c.domain.max, cells: c.mesh.cells, baseCell: clean(c.mesh.baseCell), zGround: c.zGround, H: clean(c.H) },
    obstacles: c.obstacles.map(o => {
      const out = { name: o.name, type: o.type, group: o.group, report: o.report, level: o.level, label: o.label };
      if (o.foamBox) {
        out.center = fr.toScene(o.foamBox.center);
        out.size = o.foamBox.half.map(h => clean(2 * h / fr.scale));
        // 面板的投影面積（m²，用來算力係數）：長 × 寬
        if (o.type === 'plate') out.area = clean(4 * o.foamBox.half[0] * o.foamBox.half[2]);
        out.normal = fr.dirToScene(o.foamBox.axes[1]);
        out.axes = o.foamBox.axes.map(ax => fr.dirToScene(ax)); // 場景座標的三軸（size 依序對應）
        if (o.inflated) out.inflatedThickness = clean(o.inflated / fr.scale);
      } else {
        out.p1 = fr.toScene(o.foamCyl.p1); out.p2 = fr.toScene(o.foamCyl.p2); out.radius = clean(o.foamCyl.radius / fr.scale);
      }
      return out;
    }),
    openings: c.openings.map(o => ({ name: o.name, kind: o.kind, velocity: o.velocity, area: clean(o.area) })),
    sampling: {
      slices: c.sampling.slices.map(s => ({ name: s.name, point: fr.toScene(s.point), normal: fr.dirToScene(s.normal) })),
      patches: c.obstacles.filter(o => o.report).map(o => `patch_${o.name}`),
      probes: c.sampling.probes.map(p => ({ name: p.name, point: fr.toScene(p.point) })),
      forces: c.obstacles.filter(o => o.report).map(o => `forces_${o.name}`),
      streamlines: !!c.sampling.streamSeeds,
      referenceProbe: c.sampling.probes.find(p => p.name === 'ref') ? 'ref' : null,
    },
    estimate: est,
    warnings: c.warnings,
  };
}
