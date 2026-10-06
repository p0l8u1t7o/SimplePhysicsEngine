// core 內建檢查的執行入口（由 core/tools/check.mjs 以子程序呼叫，也可單獨執行）：
//   node core/tools/run.mjs <專案> ../core/verify/run.mjs <檢查> [--dt=0.5] [--variant=名稱]
// 檢查：scene（全場干涉＋重合面）、determinism（倒序一致）、layout（空間檢核）、
//       electrical（電控元件在櫃內、不重疊、櫃內連線、穿板孔；project.verify.cables 宣告時另做配線動態取樣；場景沒有電控時略過）、
//       bom（場景的共用模型對照平台的 BOM：場景有但沒列進成本、BOM 有但沒畫出來；只警告，沒有 BOM 資料就略過）
//       physics（core/physics 的烘焙：決定性、靜止接觸穿透、烘焙時間；沒用物理就略過）
//       cycle（節拍分析：各站佔用時間、稼動率、瓶頸；只印一行 CYCLE {...}，給 studio 回填可行性分析）
//       fingerprint（排程指紋＋空間檢核結果，只輸出一行 JSON，供渲染補強前後比對）
// 讀取專案 web/js/project.js 的 createProject({ scene, headless, ...params })，結果寫入 <專案>/review/<檢查>.json。
// project.json 的 "variants": [{ "name": "NG", "params": { "ng": "A1" } }] 會在預設情境之外各跑一次
// （配方、SKU、NG 情境等不同參數會建出不同場景）。
import './dom-stub.mjs';
import * as THREE from 'three';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyScene, sceneText } from './scene.mjs';
import { verifyDeterminism } from './determinism.mjs';
import { fingerprint } from './fingerprint.mjs';
import { verifyElectrical } from './electrical.mjs';
import { verifyPhysics } from './physics.mjs';
import { verifyBom } from './bom.mjs';
import { cycleReport } from '../anim/cycle.js';

const check = process.argv[2], opts = Object.fromEntries(process.argv.slice(3).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')).map(([k, v]) => [k, v === undefined ? true : isNaN(+v) ? v : +v]));
const dir = process.cwd(), file = join(dir, 'web', 'js', 'project.js');
if (!existsSync(file)) { console.log(`略過：${file} 不存在`); process.exit(0); }
const { createProject } = await import(pathToFileURL(file).href);
const meta = existsSync(join(dir, 'project.json')) ? JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) : {};
const variants = [{ name: '預設', params: {} }, ...(meta.variants || [])].filter(v => !opts.variant || v.name === opts.variant);

const t0 = Date.now(), runs = [];
for (const v of variants) {
  const scene = new THREE.Scene(), project = await createProject({ scene, headless: true, ...v.params });
  let r;
  if (check === 'scene') r = verifyScene(project, scene, { dt: opts.dt, report: s => console.log(`[${v.name}] ${s}`) });
  else if (check === 'determinism') r = verifyDeterminism(project, scene);
  else if (check === 'layout') { const rows = project.layoutChecks?.() || []; r = { ok: rows.every(x => x.ok), count: rows.length, failures: rows.filter(x => !x.ok), rows }; }
  else if (check === 'electrical') r = verifyElectrical(project, scene, { interval: opts.dt, name: v.name });
  else if (check === 'physics') r = await verifyPhysics(project);
  else if (check === 'bom') { project.apply(0); scene.updateMatrixWorld(true); r = verifyBom(scene, dir); }
  else if (check === 'cycle') { console.log('CYCLE ' + JSON.stringify(cycleReport(project))); process.exit(0); }
  else if (check === 'fingerprint') r = { ok: true, ...fingerprint(project, scene), layout: (project.layoutChecks?.() || []).map(x => [x.group || '', x.name, !!x.ok, x.value ?? null]) };
  else { console.log('未知檢查：' + check); process.exit(2); }
  runs.push({ variant: v.name, params: v.params, ...r });
  // 配線檢查的額外情境（verify.cables.variants）：只在預設情境宣告一次，各自建場景、只跑配線取樣
  if (check === 'electrical' && v === variants[0]) for (const cv of project.verify?.cables?.variants || []) {
    const s2 = new THREE.Scene(), p2 = await createProject({ scene: s2, headless: true, ...cv.params });
    runs.push({ variant: '配線 ' + cv.name, params: cv.params, ...verifyElectrical(p2, s2, { interval: opts.dt, name: cv.name, cablesOnly: true }) });
  }
}
// 用 runs 而不是 variants 判斷：electrical 的配線額外情境（cables.variants）也在 runs 裡，要一起寫進報告、一起決定通過與否
const result = runs.length === 1 ? runs[0] : { ok: runs.every(r => r.ok), variants: runs };
// 排程指紋只印一行 JSON 給 studio 比對，不寫 review（避免每次跑都產生 git 差異）
if (check === 'fingerprint') { console.log('FINGERPRINT ' + JSON.stringify(result)); process.exit(0); }
// 耗時只印在終端機、不寫進 review（提交的報告只在結果改變時才有差異）
const seconds = +((Date.now() - t0) / 1000).toFixed(1);
const name = { scene: 'scene-verification', determinism: 'determinism', layout: 'layout-checks', electrical: 'electrical-checks', physics: 'physics-checks', bom: 'bom-checks' }[check];
// 沒有電控的專案不產生 electrical 報告
if (!['electrical', 'physics', 'bom'].includes(check) || runs.some(r => r.applicable)) { mkdirSync(join(dir, 'review'), { recursive: true }); writeFileSync(join(dir, 'review', name + '.json'), JSON.stringify(result, null, 2)); }
if (check === 'scene') writeFileSync(join(dir, 'review', name + '.txt'), runs.map(r => (runs.length > 1 ? `# ${r.variant}\n` : '') + sceneText(r)).join('\n'));

for (const r of runs) {
  const tag = runs.length > 1 ? `[${r.variant}] ` : '';
  if (check === 'scene') {
    console.log(tag + JSON.stringify({ ok: r.ok, meshes: r.meshes, moving: r.moving, joints: r.joints, samples: r.samples, dynamic: r.dynamic.length, static: r.static.length, zfight: r.zfight.length }));
    if (Object.keys(r.envelope).length) console.log(tag + 'envelope', JSON.stringify(r.envelope));
    for (const d of r.dynamic.slice(0, 30)) console.log(tag + 'DYN', d.worst, d.first + '-' + d.last + 's', d.a, '<>', d.b);
    for (const s of r.static.slice(0, 30)) console.log(tag + 'STA', s.worst, s.a, '<>', s.b);
    for (const z of r.zfight.slice(0, 40)) console.log(tag + 'ZF ', z.area + 'mm²', 't=' + z.t, z.a, '<>', z.b);
  } else if (check === 'electrical') {
    if (!r.applicable) { console.log(`${tag}略過：場景沒有電控元件、電盤，也沒有宣告 verify.cables`); continue; }
    console.log(tag + JSON.stringify(r.cablesOnly ? { ok: r.ok, routes: r.cables.report[0].routes, times: r.cables.report[0].samples } : { ok: r.ok, devices: r.devices, connections: r.connections, glands: r.feedthroughs.glands, routes: r.cables?.report[0]?.routes ?? null, times: r.cables?.report[0]?.samples ?? null }));
    for (const f of r.failures.slice(0, 30)) console.log(tag + '  ✗ ' + f);
  } else if (check === 'bom') {
    if (!r.applicable) { console.log(`${tag}略過：沒有 BOM 資料（本機沒有平台資料庫，或站還沒有成本表）`); continue; }
    console.log(tag + JSON.stringify({ ok: r.ok, models: r.sceneModels, lines: r.bomLines, matched: r.matched, sceneOnly: r.sceneOnly.length, bomOnly: r.bomOnly.length }));
    for (const w of r.warnings.slice(0, 30)) console.log(tag + '  ! ' + w);
  } else if (check === 'physics') {
    if (!r.applicable) { console.log(`${tag}略過：沒有用 core/physics`); continue; }
    console.log(tag + JSON.stringify({ ok: r.ok, bakes: r.bakes, bodies: r.bodies, rest: r.rest, ms: r.ms }));
    for (const f of r.failures) console.log(tag + '  ✗ ' + f);
  } else if (check === 'determinism') {
    console.log(`${tag}${r.ok ? '一致' : '不一致'}：${r.objects} 個物件、${r.samples} 個時間點`);
    for (const f of r.failures) console.log('  ', JSON.stringify(f));
  } else {
    console.log(`${tag}${r.count - r.failures.length}/${r.count} 通過`);
    for (const f of r.failures) console.log('  ✗', f.group || '', f.name, f.value ?? '', f.note ?? '');
  }
}
console.log(`（${seconds} s）`);
process.exit(result.ok ? 0 : 1);
