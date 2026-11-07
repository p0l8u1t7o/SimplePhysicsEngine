// 參考站（2026-11-07 使用者同意）：從本庫 project-site/ 挑 1～2 個已完成的站給代理參考（唯讀），讓它看得到細節水準與寫法。
//   - 指定：專案 studio.json 的 references: ["MilitaryGradePC", …]；寫 [] 或 false 就不用參考站。
//   - 自動：專案 AGENTS.md＋配置提案，和各站 project.json 的標題、說明＋AGENTS.md＋README.md 比關鍵字（中文兩字詞、英數單字，
//     依出現在幾個站加權、每站都有的字不算，再依該站的字數正規化），取分數最高的 2 個；同分依名稱排序，結果是決定性的。
//   - 本庫模式不會把自己這站當參考；工作區模式要 app 在本庫裡執行（studio/ 的上一層有 core/ 與 project-site/）才有參考站。
// 給代理的方式：程式資料夾 <站>/web 用 --add-dir（Claude）或在提示列出絕對路徑（Codex 的沙箱可以讀）；
//   規格摘要（AGENTS.md、README.md）複製到專案的 .studio/references/<站>/。
//   各站的 docs/、.studio/、TEMP/ 是使用者的本機資料，不給：不加進 --add-dir，Claude 另由寫檔關卡擋下讀取（guard.mjs 的 VS3D_NOREAD）。
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, readJson, readText, writeText, hashTree } from './util.mjs';
import { isRepo, readClientNames, redactNames } from './workspace.mjs';

export const REF_ROLES = new Set(['plan', 'build', 'review', 'render']);   // 修正與光學角色不需要
export const REF_MAX = 2;
export const LOCAL_ONLY = ['docs', '.studio', 'TEMP'];
const DOCS = ['AGENTS.md', 'README.md'];

// 參考站來源：本庫模式是本庫本身；工作區模式是 app 所在的本庫（部署版沒有 project-site/ 就沒有）
export const refRootFor = (ws, J) => J.repo ? ws : isRepo(REPO) ? REPO : null;

export function listStations(root, exclude = null) {
  const dir = join(root, 'project-site');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== exclude && existsSync(join(dir, e.name, 'project.json')))
    .map(e => e.name).sort().map(name => {
      const d = join(dir, name), pj = readJson(join(d, 'project.json'), {}) || {};
      return { name, dir: d, title: String(pj.title || name), summary: String(pj.summary || ''), text: [pj.title, pj.summary, ...DOCS.map(f => readText(join(d, f)))].join('\n') };
    });
}

// 關鍵字：中文取相鄰兩字、英數取 3 個字元以上的單字（小寫）
export function tokens(s) {
  const out = new Set(), t = String(s || '').toLowerCase();
  for (const m of t.matchAll(/[a-z][a-z0-9]{2,}/g)) out.add(m[0]);
  for (const m of t.matchAll(/[㐀-鿿]+/g)) for (let i = 0; i + 1 < m[0].length; i++) out.add(m[0].slice(i, i + 2));
  return out;
}

// 分數：共有的關鍵字依 log((N+1)/(df+1)) 加權（df＝幾個站有這個字），再除以該站關鍵字數的平方根（文件長的站不會因為字多就佔優勢）；
// 回傳依分數高到低、同分依名稱排序
export function rankStations(projectText, stations) {
  const mine = tokens(projectText), sets = stations.map(s => tokens(s.text)), df = new Map();
  for (const set of sets) for (const k of set) df.set(k, (df.get(k) || 0) + 1);
  const N = stations.length;
  return stations.map((s, i) => {
    let score = 0;
    for (const k of sets[i]) if (mine.has(k)) score += Math.log((N + 1) / (df.get(k) + 1));
    return { ...s, score: Math.round(score / Math.sqrt(sets[i].size || 1) * 10000) / 10000 };
  }).sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// 挑參考站：{ list: [站], how: 'set'｜'auto'｜'off', unknown: [指定了但找不到的名稱] }
export function pickReferences({ root, J, studioJson = {}, enabled = true, max = REF_MAX }) {
  const set = studioJson.references;
  if (!enabled || !root || set === false || (Array.isArray(set) && !set.length)) return { list: [], how: 'off', unknown: [] };
  const stations = listStations(root, J.repo ? J.id : null);
  if (Array.isArray(set)) {
    const names = set.map(String), list = names.map(n => stations.find(s => s.name === n)).filter(Boolean);
    return { list, how: 'set', unknown: names.filter(n => !stations.some(s => s.name === n)) };
  }
  const text = [readText(J.agents), readText(join(J.plan, 'proposal.md'))].join('\n');
  return { list: rankStations(text, stations).filter(s => s.score > 0).slice(0, max), how: 'auto', unknown: [] };
}

// 規格摘要複製到 .studio/references/<站>/（遮掉用戶名稱；舊的先清掉），回傳給提示與代理用的路徑
export function prepareReferences(ws, J, list, root) {
  const out = join(J.studio, 'references'), names = [...new Set([...readClientNames(ws), ...(root ? readClientNames(root) : [])])], redact = s => redactNames(s, names);
  rmSync(out, { recursive: true, force: true });
  return list.map(s => {
    const docs = DOCS.filter(f => existsSync(join(s.dir, f)));
    for (const f of docs) writeText(join(out, s.name, f), redact(readText(join(s.dir, f))));
    return { name: s.name, title: redact(s.title), summary: redact(s.summary), dir: s.dir, web: join(s.dir, 'web'), docs: docs.map(f => `.studio/references/${s.name}/${f}`),
      noRead: LOCAL_ONLY.map(d => join(s.dir, d)) };
  });
}

// 工作區模式的保護：參考站在工作區外，每輪前後比對 web/ 與規則檔的雜湊（只回報，不還原：那是使用者的工作目錄）
const SKIP = r => /(^|\/)(node_modules|TEMP|docs|\.studio)(\/|$)/.test(r);
export const snapshotRefs = refs => Object.fromEntries(refs.map(r => [r.name, hashTree(r.dir, (p, isDir) => SKIP(p) || (!isDir && !p.includes('/') && !DOCS.includes(p) && p !== 'project.json') || (isDir && !p.includes('/') && p !== 'web'))]));
export function diffRefs(refs, before) {
  const after = snapshotRefs(refs), out = [];
  for (const r of refs) {
    const a = before[r.name] || {}, b = after[r.name] || {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push({ area: `參考站 ${r.name}`, path: k, change: !(k in b) ? 'deleted' : !(k in a) ? 'added' : 'modified', restored: false });
  }
  return out;
}
