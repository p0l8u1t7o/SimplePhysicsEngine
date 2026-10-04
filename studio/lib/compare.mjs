// 渲染與細節補強的前後對照頁：同檔名的截圖並排、效能數字、補強項目與審查結果。
// 輸出到 <專案>/TEMP/render-compare/index.html（圖片用相對路徑，不複製）。
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { writeText } from './util.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shots = dir => dir && existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.png') && !f.endsWith('.diff.png')).sort() : [];
const view = f => f.replace(/@[\d.]+\.png$/, '');

export function writeComparePage(J, { id, before, after, basePerf, perf, items = [], review, notes = [] }) {
  const out = join(J.temp, 'render-compare'), page = join(out, 'index.html');
  const src = (dir, f) => relative(out, join(dir, id, f)).split(sep).join('/');
  const b = shots(before && join(before, id)), a = shots(after && join(after, id));
  const pairs = b.map(f => [f, a.find(x => x === f) || a.find(x => view(x) === view(f))]);
  for (const f of a) if (!pairs.some(([, y]) => y === f)) pairs.push([null, f]);
  const fig = (dir, f, cap) => f ? `<figure><img src="${esc(src(dir, f))}" loading="lazy"><figcaption>${cap}・${esc(f)}</figcaption></figure>` : '<div class="none">（沒有對應截圖）</div>';
  const n = (x, k) => x?.max?.[k] ?? '—';
  const row = (label, k) => `<tr><td>${label}</td><td>${n(basePerf, k)}</td><td>${n(perf, k)}</td><td>${basePerf?.max?.[k] && perf?.max?.[k] ? (perf.max[k] / basePerf.max[k]).toFixed(2) + ' 倍' : '—'}</td></tr>`;
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>補強前後對照</title><style>
:root{--bg:#f6f7f9;--fg:#1d2433;--mute:#5b6577;--card:#fff;--line:#dfe3ea}
@media (prefers-color-scheme:dark){:root{--bg:#11151c;--fg:#e6e9ef;--mute:#9aa4b5;--card:#1a2029;--line:#2c3440}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 "Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif}main{max-width:1400px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:24px;margin:0}h2{font-size:19px;margin:28px 0 10px;border-bottom:1px solid var(--line)}.mute{color:var(--mute)}
table{border-collapse:collapse;background:var(--card)}td,th{border:1px solid var(--line);padding:4px 10px;text-align:left}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:6px;overflow:hidden}
figure img{width:100%;display:block}figcaption{padding:3px 8px;font-size:13px;color:var(--mute)}.none{border:1px dashed var(--line);border-radius:6px;padding:30px;text-align:center;color:var(--mute)}
@media (max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body><main>
<h1>${esc(id)}：渲染與細節補強前後對照</h1><p class="mute">左：補強前　右：補強後。排程指紋、空間檢核與檢查都已通過守門檢查。</p>
<h2>效能</h2><table><tr><th></th><th>補強前</th><th>補強後</th><th>比例</th></tr>${row('三角面數（最多的視角）', 'triangles')}${row('draw call（最多的視角）', 'calls')}${row('貼圖數', 'textures')}
<tr><td>手機幀率（無頭、CPU 降速 4 倍）</td><td>${basePerf?.phoneFps ?? '—'}</td><td>${perf?.phoneFps ?? '—'}</td><td></td></tr></table>
${notes.length ? `<p class="mute">${notes.map(esc).join('<br>')}</p>` : ''}
<h2>補強項目（${items.length}）</h2><ul>${items.map(x => `<li><b>${esc(x.id)}</b>［${esc(x.area || '其他')}］${esc(x.item)}</li>`).join('') || '<li>（代理自行判斷）</li>'}</ul>
${review?.must?.length ? `<h2>審查後仍未解決的必修</h2><ul>${review.must.map(m => `<li><b>${esc(m.id)}</b> ${esc(m.issue)}</li>`).join('')}</ul>` : ''}
<h2>截圖</h2>${pairs.map(([x, y]) => `<div class="pair">${fig(before, x, '補強前')}${fig(after, y, '補強後')}</div>`).join('') || '<p class="mute">（沒有截圖）</p>'}
</main></body></html>`;
  writeText(page, html);
  return page;
}
