// 場景 ↔ BOM（check.mjs 的 bom，評估平台 Q9）：場景裡用到的共用模型，成本表（平台的 BOM）有沒有列。
//   場景：標 userData.coreModel 的物件（共用模型的根），自己或祖先標 userData.noBom（現場既有設備等，寫原因）的不算；有 userData.partRef（元件編號）的優先用編號比對，沒有才用模型 id 比對 BOM 行的元件 model_id。
//   BOM：環境變數 VS3D_BOM_JSON 指的檔（studio 跑檢查前寫出），或本庫的 studio（有本機資料庫時執行 vs3d parts bom @<站> --json）；都沒有就略過。
// 舊站只警告、不擋部署；新站（project.json 的 "strict": true）有落差就不通過：場景有、BOM 沒有（沒列進成本）；BOM 有模型、場景沒有（沒畫出來；軟體、備品這類不畫的在 BOM 標 noScene）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export function sceneInventory(scene) {
  const out = [];
  scene.traverse(o => {
    if (!o.userData?.coreModel) return;
    for (let p = o; p; p = p.parent) if (p.userData?.noBom) return;      // 現場既有、不在這次採購範圍的設備：userData.noBom = '原因'
    for (let p = o.parent; p; p = p.parent) if (p.userData?.coreModel && !p.userData.coreModelPart) return;      // 模型裡面又包模型（例如相機的鏡頭）只算外層
    if (o.userData.coreModelPart) return;
    const path = []; for (let x = o; x && x.parent; x = x.parent) if (x.name) path.unshift(x.name);
    out.push({ model: o.userData.coreModel, partRef: o.userData.partRef || null, path: path.join('/') });
  });
  return out;
}

export function compareBom(inv, lines) {
  const withModel = lines.filter(l => l.model_id || l.code), used = new Set(), matchedScene = new Set();
  for (const s of inv) {
    const hit = s.partRef ? withModel.find(l => l.code === s.partRef) : withModel.find(l => l.model_id === s.model);
    if (hit) { used.add(hit); matchedScene.add(s); }
  }
  const group = list => Object.values(list.reduce((m, s) => { const k = s.partRef || s.model; (m[k] ||= { model: s.model, partRef: s.partRef, count: 0, paths: [] }).count++; m[k].paths.length < 3 && m[k].paths.push(s.path); return m; }, {}));
  const sceneOnly = group(inv.filter(s => !matchedScene.has(s)));
  const bomOnly = lines.filter(l => l.model_id && !l.no_scene && !used.has(l)).map(l => ({ line: l.line, code: l.code, model: l.model_id, name: l.name }));
  return { sceneModels: inv.length, bomLines: lines.length, matched: matchedScene.size, sceneOnly, bomOnly };
}

// BOM 的來源：VS3D_BOM_JSON，或本庫 studio 的命令列（站的資料夾往上兩層是本庫根目錄）
export function loadBom(dir) {
  const env = process.env.VS3D_BOM_JSON;
  if (env && existsSync(env)) return { source: env, ...JSON.parse(readFileSync(env, 'utf8')) };
  const root = resolve(dir, '..', '..'), cli = join(root, 'studio', 'vs3d.mjs');
  if (!existsSync(cli) || !existsSync(join(root, 'studio', 'data', 'studio.db'))) return null;
  const r = spawnSync(process.execPath, [cli, 'parts', 'bom', '@' + basename(dir), '--json'], { encoding: 'utf8', cwd: root, windowsHide: true });
  if (r.status !== 0) return { missing: true };      // 有平台資料庫，但這站沒有成本表
  try { return { source: `studio（@${basename(dir)}）`, ...JSON.parse(r.stdout) }; } catch { return null; }
}

// strict（新站，project.json 的 "strict": true；core/SITE-RULES.md 完成定義第 6 項）：有落差、或本機有平台資料庫卻沒有成本表，就不通過。
//   舊站只警告。沒有平台資料庫（例如 CI）一律略過。
export function verifyBom(scene, dir, { strict = false } = {}) {
  const bom = loadBom(dir);
  if (!bom) return { ok: true, applicable: false };
  if (bom.missing) return strict ? { ok: false, applicable: true, strict, sceneModels: 0, bomLines: 0, matched: 0, sceneOnly: [], bomOnly: [],
    warnings: ['新站要有成本表：寫好 .studio/plan/bom.json 後執行 node studio/vs3d.mjs assess "<站>" --repo import（core/SITE-RULES.md「評估簡報與成本表」）'] } : { ok: true, applicable: false };
  const r = compareBom(sceneInventory(scene), bom.lines || []);
  const warnings = [...r.sceneOnly.map(s => `場景有 ${s.partRef || s.model} ×${s.count}（${s.paths[0] || ''}），成本表沒有：沒列進成本，或建立模型時沒帶 partRef`),
    ...r.bomOnly.map(b => `成本表 ${b.line} ${b.code} ${b.name}（模型 ${b.model}）場景裡沒有：沒畫出來；不畫的在 BOM 標 noScene`)];
  // 新站的評估簡報（docs/ 只留本機）：還沒產生只提醒，不擋（樣板與 Python 不一定每台都有）
  const notes = strict && !(existsSync(join(dir, 'docs', 'assessment')) && readdirSync(join(dir, 'docs', 'assessment')).some(f => f.endsWith('.pptx')))
    ? ['還沒有評估簡報：3D 完成、截圖拍好後執行 node studio/vs3d.mjs assess "<站>" --repo deck（輸出到 docs/assessment/）'] : [];
  return { ok: !strict || !warnings.length, applicable: true, ...(strict ? { strict } : {}), source: bom.source, ...r, warnings: [...warnings, ...notes] };
}
