// 場景傾印與比對：把站內自己畫的零件換成共用模型（或改 core）前後，確認「畫出來的東西」沒有變。
//   node core/tools/scene-dump.mjs <專案> --out <檔案.json> [--times 9]
//   node core/tools/scene-dump.mjs --diff <前.json> <後.json> [--ignore-names] [--show 8] [--all]
// 傾印：用網頁同一份 web/js/project.js 建立場景（預設情境＋project.json 的 variants＋verify.cables.variants），
//   在數個時間點（預設 9 個：total 的 0、1/8 … 1）記下每個可繪製物件的簽章：
//   種類、名稱、routingHardware、幾何型別與參數、頂點數、頂點座標雜湊、世界矩陣（1e-6）、材質主要屬性、陰影旗標、可見性；
//   另外記燈光與虛擬相機。同一時間點內排序後存檔，所以「多一層群組、建立順序不同」不算差異。檔案裡沒有時間戳，同一份場景重跑會逐位元組相同。
// 比對：逐情境、逐時間點列出缺少／多出／不同的數量與前幾筆；走線五金（userData.routingHardware）另外統計。
//   完全相同時離開碼 0，有差異 1，用法錯誤 2。--ignore-names：不比一般零件、燈光、虛擬相機的名稱（共用模型會給原本沒名稱的物件預設名稱）；走線五金的名稱照比。
//   畫面上看不出來的差別不算：實例批次自己的世界矩陣（各實例的世界矩陣照比）、燈光的旋轉（位置與目標點照比；RectAreaLight 例外）。
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = k => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const USAGE = '用法：node core/tools/scene-dump.mjs <專案> --out <檔案.json> [--times 9]\n      node core/tools/scene-dump.mjs --diff <前.json> <後.json> [--ignore-names] [--show 8] [--all]';
const FORMAT = 1;
// 簽章欄位（陣列的位置）；dict 裡每一筆是這個陣列的 JSON 字串
const F = { kind: 0, name: 1, hardware: 2, geometry: 3, params: 4, vertices: 5, hash: 6, matrix: 7, material: 8, shadow: 9, visible: 10 };
const LABEL = { name: '名稱', hardware: '走線五金標記', geometry: '幾何型別', params: '幾何參數', vertices: '頂點數', hash: '頂點座標', matrix: '世界矩陣', material: '材質', shadow: '陰影旗標', visible: '可見性' };

if (flag('--worker')) await worker();
else if (flag('--diff')) process.exit(diff());
else await main();

// ---------------------------------------------------------------- 入口：挑專案，帶著 register 在專案資料夾裡跑 worker
async function main() {
  const out = opt('--out', null), times = opt('--times', '9'), names = argv.filter(a => !a.startsWith('--'));
  if (!out || names.length !== 1) { console.log(USAGE); process.exit(2); }
  const { pickProjects } = await import('./projects.mjs'), { runScript } = await import('./run.mjs');
  const [p] = pickProjects(names), file = resolve(out);
  mkdirSync(dirname(file), { recursive: true });
  const { code } = await runScript(p, fileURLToPath(import.meta.url), ['--worker', '--out', file, '--times', times, '--id', p.id]);
  process.exit(code);
}

// ---------------------------------------------------------------- 傾印（子程序：cwd 是專案資料夾，已註冊 three／@core 的解析）
async function worker() {
  await import('../verify/dom-stub.mjs');
  const THREE = await import('three');
  const out = opt('--out'), N = Math.max(2, +opt('--times', 9) || 9), id = opt('--id', '');
  const dir = process.cwd(), { createProject } = await import(pathToFileURL(join(dir, 'web', 'js', 'project.js')).href);
  const meta = existsSync(join(dir, 'project.json')) ? JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) : {};
  const core = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();

  const r = (v, d = 6) => Number.isFinite(v) ? +v.toFixed(d) + 0 : String(v);        // +0：−0 與 0 視為相同
  const hex = c => c?.isColor ? c.getHexString() : null;
  // 幾何參數：只留數字、字串、布林與它們的陣列／一層物件（形狀、路徑等物件由頂點雜湊涵蓋）
  const plain = (v, depth = 0) => typeof v === 'number' ? r(v, 4) : typeof v === 'string' || typeof v === 'boolean' ? v
    : Array.isArray(v) ? (depth < 2 && v.every(x => typeof x !== 'object' || Array.isArray(x)) ? v.map(x => plain(x, depth + 1)) : `[${v.length}]`)
      : v && typeof v === 'object' && depth < 1 && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.keys(v).sort().map(k => [k, plain(v[k], depth + 1)]).filter(([, x]) => x !== undefined)) : v == null ? null : undefined;
  // 頂點座標雜湊：量化到 1e-4 mm 後做兩組 FNV-1a（同一格內共用的幾何只算一次）
  const hashOf = (array, scale = 1e4) => {
    let a = 0x811c9dc5, b = 0x01000193 ^ array.length;
    for (let i = 0; i < array.length; i++) { const q = Math.round(array[i] * scale) | 0; a = Math.imul(a ^ q, 0x01000193); b = Math.imul(b ^ (q + i), 0x85ebca6b); b ^= b >>> 13; }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  };
  const material = m => !m ? null : Array.isArray(m) ? m.map(material) : [m.type, hex(m.color), r(m.roughness ?? -1, 4), r(m.metalness ?? -1, 4), hex(m.emissive), r(m.emissiveIntensity ?? -1, 4),
    r(m.opacity, 4), +!!m.transparent, m.side, +(m.visible !== false), +(m.depthWrite !== false), m.map ? [r(m.map.offset.x, 4), r(m.map.offset.y, 4), r(m.map.repeat.x, 4), r(m.map.repeat.y, 4)] : 0];
  const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return 0; return 1; };
  const world = o => o.matrixWorld.elements.map(v => r(v));
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3();

  const dict = new Map(), key = sig => { const s = JSON.stringify(sig); if (!dict.has(s)) dict.set(s, dict.size); return dict.get(s); };
  function frame(scene) {
    const geo = new Map(), meshes = [], lights = [], cameras = [];
    scene.traverse(o => {
      if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
        const g = o.geometry, pos = g?.attributes?.position;
        if (g && !geo.has(g)) geo.set(g, pos ? hashOf(pos.array) : '');
        const sig = [o.isInstancedMesh ? 'instanced' : o.isMesh ? 'mesh' : o.isLine ? 'line' : o.isPoints ? 'points' : 'sprite', o.name || '', o.userData.routingHardware || '',
          g?.type || '', plain(g?.parameters || {}), pos ? pos.count : 0, g ? geo.get(g) : '', world(o), material(o.material), [+!!o.castShadow, +!!o.receiveShadow], shown(o)];
        if (o.isInstancedMesh) {   // 每個實例的世界矩陣（float32，取到 1e-3）排序後雜湊，另記實例數
          const rows = []; for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); rows.push(_m.elements.map(v => r(v, 3)).join(',')); }
          sig[F.params] = { ...sig[F.params], instances: o.count, instanceHash: hashOf(Array.from(rows.sort().join(';'), c => c.charCodeAt(0)), 1) };
        }
        meshes.push(key(sig));
      } else if (o.isLight) {
        const target = o.target ? _v.setFromMatrixPosition(o.target.matrixWorld).toArray().map(v => r(v)) : null;
        lights.push(key(['light', o.name || '', o.type, hex(o.color), r(o.intensity, 4), r(o.distance ?? -1, 4), r(o.angle ?? -1), r(o.penumbra ?? -1, 4), r(o.decay ?? -1, 4), +!!o.castShadow, shown(o), world(o), target]));
      } else if (o.isCamera) {
        const lens = o.isPerspectiveCamera ? [r(o.fov), r(o.aspect), r(o.near, 4), r(o.far, 4), r(o.zoom, 4)] : [r(o.left, 4), r(o.right, 4), r(o.top, 4), r(o.bottom, 4), r(o.near, 4), r(o.far, 4), r(o.zoom, 4)];
        cameras.push(key(['camera', o.name || '', o.type, lens, o.up.toArray().map(v => r(v)), shown(o), world(o)]));
      }
    });
    const sort = a => a.sort((x, y) => x - y);
    return { meshes: sort(meshes), lights: sort(lights), cameras: sort(cameras) };
  }

  const variants = [];
  async function dump(name, params) {
    const scene = new THREE.Scene(), project = await createProject({ scene, headless: true, ...params }), total = project.total;
    const frames = [];
    for (let i = 0; i < N; i++) {
      const t = +(total * i / (N - 1)).toFixed(6);
      project.apply(t); scene.updateMatrixWorld(true);
      frames.push({ t, ...frame(scene) });
    }
    variants.push({ name, params, total, frames });
    console.log(`[${name}] 總長 ${+total.toFixed(3)} s、${N} 個時間點；零件 ${frames[0].meshes.length}、燈光 ${frames[0].lights.length}、相機 ${frames[0].cameras.length}`);
    return project;
  }
  const first = await dump('預設', {});
  for (const v of meta.variants || []) await dump(v.name, v.params);
  for (const v of first.verify?.cables?.variants || []) await dump('配線 ' + v.name, v.params);
  // dict 的編號依出現順序；重新依字串排序再存，建立順序不同也會得到同一份檔案
  const sorted = [...dict.keys()].sort(), remap = new Map(sorted.map((s, i) => [dict.get(s), i])), fix = a => a.map(i => remap.get(i)).sort((x, y) => x - y);
  for (const v of variants) for (const f of v.frames) { f.meshes = fix(f.meshes); f.lights = fix(f.lights); f.cameras = fix(f.cameras); }
  writeFileSync(out, JSON.stringify({ tool: 'scene-dump', format: FORMAT, project: id, core, variants, dict: sorted }));
  console.log(`已寫入 ${out}（${variants.length} 個情境、${sorted.length} 種簽章）`);
}

// ---------------------------------------------------------------- 比對（不需要 three）
function diff() {
  const ignoreNames = flag('--ignore-names'), all = flag('--all'), SHOW = +opt('--show', 8), files = argv.filter(a => !a.startsWith('--'));
  if (files.length !== 2) { console.log(USAGE); return 2; }
  const [A, B] = files.map(f => JSON.parse(readFileSync(f, 'utf8')));
  for (const [d, f] of [[A, files[0]], [B, files[1]]]) if (d.tool !== 'scene-dump' || d.format !== FORMAT) { console.log(`✗ ${f} 不是 scene-dump 第 ${FORMAT} 版的傾印`); return 2; }
  console.log(`前：${files[0]}（${A.project}，core ${A.core}）\n後：${files[1]}（${B.project}，core ${B.core}）${ignoreNames ? '\n不比一般零件的名稱（--ignore-names）' : ''}`);
  // 簽章字串在比對前先正規化（畫面上看不出來的差別不算）：
  //   實例批次（InstancedMesh）：各實例的世界矩陣已經在 instanceHash 裡，批次自己的世界矩陣不比（批次掛在有位移的模型 root 裡、實例改用相對座標時畫面相同）
  //   燈光：除了 RectAreaLight，照射方向由位置與目標點決定，世界矩陣只比位置（閃光燈掛在轉過的相機 root 裡時畫面相同）
  //   --ignore-names：非走線五金的零件、燈光、虛擬相機的名稱清掉再比
  const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const norm = d => d.dict.map(s => {
    const a = JSON.parse(s);
    if (a[0] === 'light') { if (a[2] !== 'RectAreaLight') a[a.length - 2] = [...IDENTITY, ...a.at(-2).slice(12)]; if (ignoreNames) a[1] = ''; }
    else if (a[0] === 'camera') { if (ignoreNames) a[1] = ''; }
    else {
      if (a[0] === 'instanced') a[F.matrix] = [...IDENTITY, 0, 0, 0, 1];
      if (ignoreNames && !a[F.hardware]) a[F.name] = '';
    }
    return JSON.stringify(a);
  });
  const DA = norm(A), DB = norm(B);
  const bag = (list, D) => { const m = new Map(); for (const i of list) m.set(D[i], (m.get(D[i]) || 0) + 1); return m; };
  const minus = (x, y) => { const out = []; for (const [s, n] of x) for (let k = (y.get(s) || 0); k < n; k++) out.push(s); return out; };
  const at = a => a[0] === 'light' || a[0] === 'camera' ? a.at(a[0] === 'light' ? -2 : -1).slice(12, 15) : a[F.matrix].slice(12, 15);
  const brief = a => a[0] === 'light' || a[0] === 'camera' ? `${a[0] === 'light' ? '燈光' : '相機'} ${a[2]}${a[1] ? ' 「' + a[1] + '」' : ''} @(${at(a).map(v => Math.round(v)).join(',')})`
    : `${a[F.hardware] ? '[' + a[F.hardware] + '] ' : ''}${a[F.name] ? '「' + a[F.name] + '」' : ''}${a[F.geometry].replace('Geometry', '')}（${a[F.vertices]} 頂點）@(${at(a).map(v => typeof v === 'number' ? Math.round(v * 10) / 10 : v).join(',')})`;
  // 剩下的項目配對：同種類、同幾何型別、世界位置相同（0.1 mm）的視為「同一個零件但內容不同」
  const pairKey = a => a[0] === 'light' || a[0] === 'camera' ? a[0] + '|' + a[2] + '|' + at(a).map(v => Math.round(v * 10)).join(',') : [a[0], a[F.geometry], at(a).map(v => typeof v === 'number' ? Math.round(v * 10) : v).join(',')].join('|');
  const fields = (a, b) => {
    if (a[0] === 'light' || a[0] === 'camera') return a.map((v, i) => JSON.stringify(v) === JSON.stringify(b[i]) ? null : i).filter(i => i !== null).map(i => `欄位 ${i}：${JSON.stringify(a[i])} → ${JSON.stringify(b[i])}`);
    return Object.entries(F).filter(([, i]) => JSON.stringify(a[i]) !== JSON.stringify(b[i])).map(([k, i]) => {
      if (k === 'matrix') return `世界矩陣（最大差 ${Math.max(...a[i].map((v, j) => Math.abs(v - b[i][j]))).toPrecision(3)}）`;
      const s = v => { const t = JSON.stringify(v); return t.length > 90 ? t.slice(0, 90) + '…' : t; };
      if (k === 'params') { const keys = [...new Set([...Object.keys(a[i] || {}), ...Object.keys(b[i] || {})])].filter(p => JSON.stringify(a[i]?.[p]) !== JSON.stringify(b[i]?.[p])); return `幾何參數 ${keys.map(p => `${p}：${s(a[i]?.[p])} → ${s(b[i]?.[p])}`).join('、')}`; }
      return `${LABEL[k] || k}：${s(a[i])} → ${s(b[i])}`;
    });
  };
  function compare(la, lb) {
    const a = bag(la, DA), b = bag(lb, DB), onlyA = minus(a, b).map(s => JSON.parse(s)), onlyB = minus(b, a).map(s => JSON.parse(s));
    // 兩輪配對：先比位置，再比名稱（有名稱、位置跑掉的零件，例如改釘到別處的線夾腳，列成「不同」而不是一缺一多）
    const nameKey = a => a[0] === 'light' || a[0] === 'camera' ? (a[1] ? a[0] + '|' + a[2] + '|' + a[1] : null) : a[F.name] ? [a[0], a[F.geometry], a[F.hardware], a[F.name]].join('|') : null;
    let restA = onlyA, restB = onlyB; const changed = [];
    for (const keyOf of [pairKey, nameKey]) {
      const pool = new Map(); for (const y of restB) { const k = keyOf(y); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(y); }
      const left = [];
      for (const x of restA) { const k = keyOf(x), c = k === null ? null : pool.get(k); if (c?.length) changed.push([x, c.shift()]); else left.push(x); }
      restA = left; restB = [...pool.values()].flat();
    }
    return { changed, missing: restA, extra: restB };
  }
  const isHw = x => x[0] !== 'light' && x[0] !== 'camera' && !!x[F.hardware];
  let bad = 0, checked = 0;
  const namesA = A.variants.map(v => v.name), namesB = B.variants.map(v => v.name);
  for (const n of namesA) if (!namesB.includes(n)) { bad++; console.log(`✗ 情境「${n}」只在前一份`); }
  for (const n of namesB) if (!namesA.includes(n)) { bad++; console.log(`✗ 情境「${n}」只在後一份`); }
  for (const va of A.variants) {
    const vb = B.variants.find(v => v.name === va.name); if (!vb) continue;
    if (va.total !== vb.total || va.frames.length !== vb.frames.length) { bad++; console.log(`✗ [${va.name}] 時間軸不同：總長 ${va.total} → ${vb.total} s、時間點 ${va.frames.length} → ${vb.frames.length}（改用相同的 --times 重新傾印；總長變了就是排程變了）`); continue; }
    let detailed = false, variantBad = 0, lastCount = '', repeats = 0; const hwStat = { changed: 0, missing: 0, extra: 0 }, hwRows = [];
    const lines = [], flush = () => { if (repeats) lines.push(`  另外 ${repeats} 個時間點的數量相同（--all 逐一列出）`); repeats = 0; };
    va.frames.forEach((fa, i) => {
      const fb = vb.frames[i]; checked++;
      const m = compare(fa.meshes, fb.meshes), l = compare(fa.lights, fb.lights), c = compare(fa.cameras, fb.cameras);
      const count = r => r.changed.length + r.missing.length + r.extra.length, n = count(m) + count(l) + count(c);
      if (!n) return;
      variantBad++;
      const hw = { changed: m.changed.filter(([x]) => isHw(x)), missing: m.missing.filter(isHw), extra: m.extra.filter(isHw) };
      for (const k of Object.keys(hwStat)) hwStat[k] = Math.max(hwStat[k], hw[k].length);
      if (!hwRows.length) { for (const [x, y] of hw.changed) hwRows.push(`  不同 ${brief(x)}：${fields(x, y).join('；')}`); for (const x of hw.missing) hwRows.push(`  缺少 ${brief(x)}`); for (const y of hw.extra) hwRows.push(`  多出 ${brief(y)}`); }
      const summary = `零件 缺少 ${m.missing.length}、多出 ${m.extra.length}、不同 ${m.changed.length}（共 ${fa.meshes.length} → ${fb.meshes.length}）｜燈光 ${count(l)}｜相機 ${count(c)}`;
      if (detailed && !all && summary === lastCount) { repeats++; return; }      // 連續幾個時間點數量一樣就合併成一行
      flush(); lastCount = summary; lines.push(`  t=${fa.t}：${summary}`);
      if (detailed && !all) return;
      detailed = true;
      for (const [title, r] of [['零件', m], ['燈光', l], ['相機', c]]) {
        const rows = [...r.changed.map(([x, y]) => `不同 ${brief(x)}：${fields(x, y).join('；')}`), ...r.missing.map(x => `缺少 ${brief(x)}`), ...r.extra.map(y => `多出 ${brief(y)}`)];
        for (const row of rows.slice(0, SHOW)) lines.push(`      ${title} ${row}`);
        if (rows.length > SHOW) lines.push(`      …${title}還有 ${rows.length - SHOW} 筆（--show N 可多列）`);
      }
    });
    flush();
    const hwCount = k => (k === 'A' ? va : vb).frames[0].meshes.map(i => JSON.parse((k === 'A' ? DA : DB)[i])).filter(isHw);
    const kinds = list => { const m = {}; for (const x of list) m[x[F.hardware]] = (m[x[F.hardware]] || 0) + 1; return Object.keys(m).sort().map(k => `${k} ${m[k]}`).join('、') || '沒有'; };
    const ha = hwCount('A'), hb = hwCount('B');
    if (!variantBad) console.log(`✓ [${va.name}] ${va.frames.length} 個時間點完全相同（零件 ${va.frames[0].meshes.length}、燈光 ${va.frames[0].lights.length}、相機 ${va.frames[0].cameras.length}；走線五金 ${ha.length}）`);
    else {
      bad += variantBad;
      console.log(`✗ [${va.name}] ${variantBad}/${va.frames.length} 個時間點有差異`); for (const s of lines) console.log(s);
      console.log(`  走線五金：前 ${ha.length}（${kinds(ha)}）｜後 ${hb.length}（${kinds(hb)}）｜缺少 ${hwStat.missing}、多出 ${hwStat.extra}、不同 ${hwStat.changed}${hwStat.missing + hwStat.extra + hwStat.changed ? '' : '——走線五金沒有差異'}`);
      for (const s of hwRows.slice(0, SHOW)) console.log('  ' + s); if (hwRows.length > SHOW) console.log(`    …還有 ${hwRows.length - SHOW} 筆`);
    }
  }
  console.log(bad ? `結論：有差異（${bad} 處）` : `結論：完全相同（${A.variants.length} 個情境、${checked} 個時間點）`);
  return bad ? 1 : 0;
}
