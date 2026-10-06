// 評估報告（評估平台 Q6，2026-10-06 拍板：評估資料只放資料庫，使用者在介面上匯出時才產生檔案；匯出檔不留在主機）。
//   HTML：單一檔（樣式與截圖內嵌），封面結論、配置提案、可行性分析、成本摘要與明細、AOI 方案、3D 截圖
//   PDF：同一份 HTML 用無頭 Chrome 印出（core/tools/cdp.mjs）
//   Markdown：配置提案與可行性分析原文＋成本摘要
// 不得顯示的名稱由呼叫端的 redact 替換（匯出前後都檢查）。
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mdToHtml, esc } from './md.mjs';
import { REPO } from './util.mjs';

// 文件開頭的大標（# 配置提案）和報告的章節標題重複，拿掉
const body = md => mdToHtml(String(md || '').replace(/^\s*#\s[^\n]*\n/, ''));
const money = n => n == null ? '—' : Math.round(n).toLocaleString('en-US');
const STATUS = { ok: '✓ 符合', warn: '！注意', fail: '✗ 不符合', info: '' };
const CSS = `
:root { --g: #217346; --line: #d8e4dc; --mute: #5f6f66; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.65 "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif; color: #1d2b23; background: #fff; }
main { max-width: 980px; margin: 0 auto; padding: 32px 28px 60px; }
header.cover { border-bottom: 3px solid var(--g); padding-bottom: 18px; margin-bottom: 26px; }
header.cover .kind { color: var(--g); font-weight: 700; letter-spacing: .08em; }
header.cover h1 { margin: 6px 0 8px; font-size: 28px; }
.meta { color: var(--mute); font-size: 13px; }
.verdict { display: inline-block; padding: 4px 14px; border-radius: 999px; font-weight: 700; margin: 10px 0; }
.v-ok { background: #e3f3e8; color: #1b6b3c; } .v-cond { background: #fff3d6; color: #7a5200; } .v-no { background: #fde4e1; color: #a1281b; }
h2.sec { color: var(--g); border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-top: 36px; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 13px; }
th, td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #eef5f0; }
td.num, th.num { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; background: #f6faf7; }
.doc h1 { font-size: 20px; } .doc h2 { font-size: 17px; } .doc h3 { font-size: 15px; }
pre { background: #f4f6f5; padding: 10px; overflow: auto; }
blockquote { margin: 8px 0; padding: 4px 14px; border-left: 3px solid var(--line); color: var(--mute); }
.shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.shots img { width: 100%; border: 1px solid var(--line); }
.note { color: var(--mute); font-size: 12.5px; }
ul.cond li { margin: 2px 0; }
@media print { main { padding: 0; } h2.sec { page-break-before: auto; } table { page-break-inside: auto; } tr { page-break-inside: avoid; } }
@page { size: A4; margin: 16mm 14mm; }
`;

// 報告的資料：db（partsdb）、project（資料庫裡的專案代號）、title、components、shots（截圖的絕對路徑）
export function reportData(db, { project, title, components = [], shots = [] }) {
  const proposal = db.assess.latest(project, 'proposal'), feasibility = db.assess.latest(project, 'feasibility');
  const bom = db.bom.get(project), aoi = db.aoi.list(project);
  return { project, title, components, proposal, feasibility, bom, aoi: aoi.filter(s => s.status === 'chosen').length ? aoi.filter(s => s.status === 'chosen') : aoi, shots: shots.slice(0, 6), at: new Date() };
}

export function reportHtml(d) {
  const f = d.feasibility, data = f?.data || {}, s = d.bom?.summary;
  const vcls = { 可行: 'v-ok', 有條件可行: 'v-cond', 不可行: 'v-no' }[f?.verdict] || '';
  const sec = (t, body) => body ? `<h2 class="sec">${esc(t)}</h2>\n${body}` : '';
  const sections = d.bom ? [...new Set(d.bom.lines.map(l => l.section || '（未分段）'))].map(name => {
    const ls = d.bom.lines.filter(l => (l.section || '（未分段）') === name);
    return { name, n: ls.length, subtotal: ls.reduce((a, l) => a + l.subtotal, 0) };
  }) : [];
  const cost = d.bom && `<table><thead><tr><th>子系統</th><th class="num">行數</th><th class="num">小計（NT$）</th></tr></thead><tbody>
${sections.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${x.n}</td><td class="num">${money(x.subtotal)}</td></tr>`).join('\n')}
<tr><td>設備與材料</td><td></td><td class="num">${money(s.equipment)}</td></tr><tr><td>工程人日（${s.laborDays} 人日）</td><td></td><td class="num">${money(s.labor)}</td></tr>
${s.option ? `<tr><td>選配</td><td></td><td class="num">${money(s.option)}</td></tr>` : ''}<tr><td>預備費（${Math.round(d.bom.settings.contingency * 100)}%）</td><td></td><td class="num">${money(s.contingency)}</td></tr>
<tr class="total"><td>總計（未稅）</td><td></td><td class="num">${money(s.total)}</td></tr><tr><td>估價範圍</td><td></td><td class="num">${money(s.low)} ～ ${money(s.high)}</td></tr>
<tr><td>含稅（${Math.round(d.bom.settings.tax * 100)}%）</td><td></td><td class="num">${money(s.taxed)}</td></tr></tbody></table>
<p class="note">${[s.flags.estimate && `${s.flags.estimate} 行是估價（C 級）`, s.flags.pending && `${s.flags.pending} 行的元件待確認`, s.flags.expired && `${s.flags.expired} 行報價過期`, s.flags.noPrice && `${s.flags.noPrice} 行沒有單價`].filter(Boolean).join('；') || '所有行都有單價。'}等級 A／B／C 的估價幅度 ±${d.bom.settings.gradeRange.A * 100}%／±${d.bom.settings.gradeRange.B * 100}%／±${d.bom.settings.gradeRange.C * 100}%。</p>`;
  const lines = d.bom && `<table><thead><tr><th>行</th><th>名稱</th><th>型號／規格</th><th class="num">數量</th><th class="num">單價（NT$）</th><th class="num">小計（NT$）</th><th>等級</th></tr></thead><tbody>
${d.bom.lines.map(l => `<tr><td>${esc(l.line)}</td><td>${esc(l.name)}${l.code ? `<div class="note">${esc(l.code)} v${l.part_version}</div>` : ''}</td><td>${esc([l.model, l.spec].filter(Boolean).join('｜'))}</td><td class="num">${l.qty} ${esc(l.unit)}</td><td class="num">${money(l.unit_twd)}</td><td class="num">${money(l.subtotal)}</td><td>${esc(l.grade)}</td></tr>`).join('\n')}
</tbody></table>`;
  const aoi = d.aoi.length && d.aoi.map(a => `<h3>${esc(a.name)}${a.status === 'chosen' ? '（選用）' : ''}</h3><table><tbody>${(a.result.results || []).filter(r => r.status !== 'info' || r.value != null).map(r =>
    `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.value ?? '—')} ${esc(r.unit || '')}</td><td>${STATUS[r.status] || ''}</td><td class="note">${esc(r.note || '')}</td></tr>`).join('')}</tbody></table>`).join('\n');
  const shots = d.shots.length && `<div class="shots">${d.shots.map(p => `<figure><img alt="${esc(basename(p))}" src="data:image/png;base64,${readFileSync(p).toString('base64')}"><figcaption class="note">${esc(basename(p, '.png'))}</figcaption></figure>`).join('')}</div>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.title)} 評估報告</title><style>${CSS}</style></head><body><main>
<header class="cover"><div class="kind">自動化設備評估報告</div><h1>${esc(d.title)}</h1>
${f ? `<div class="verdict ${vcls}">${esc(f.verdict)}</div><p>${esc(data.summary || '')}</p>` : '<p class="note">還沒有可行性分析。</p>'}
${(data.conditions || []).length ? `<b>關鍵條件</b><ul class="cond">${data.conditions.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
${s ? `<p><b>總計（未稅）NT$ ${money(s.total)}</b>　估價範圍 ${money(s.low)} ～ ${money(s.high)}　含稅 ${money(s.taxed)}</p>` : ''}
<div class="meta">產生時間 ${d.at.toLocaleString('zh-TW', { hour12: false })}｜${[d.proposal && `配置提案 v${d.proposal.version}`, f && `可行性分析 v${f.version}`, d.bom && `成本表 ${d.bom.bom.name}（${d.bom.bom.updated_at.slice(0, 10)}）`].filter(Boolean).join('｜')}</div></header>
${sec('配置提案', d.proposal && `<div class="doc">${body(d.proposal.content)}</div>`)}
${sec('可行性分析', f && `<div class="doc">${body(f.content)}</div>`)}
${sec('成本摘要', cost)}
${sec('成本明細', lines)}
${sec('AOI 方案', aoi)}
${sec('3D 動畫截圖', shots)}
<p class="note" style="margin-top:40px">本報告由 3D工作室 從資料庫產生；成本依元件庫鎖定的版本計算，估價行的實際金額以正式報價為準。</p>
</main></body></html>`;
}

export function reportMarkdown(d) {
  const f = d.feasibility, s = d.bom?.summary;
  return [`# ${d.title} 評估報告`, '', f ? `**結論：${f.verdict}**　${f.data?.summary || ''}` : '（還沒有可行性分析）', '',
    s ? `總計（未稅）NT$ ${money(s.total)}（估價範圍 ${money(s.low)}～${money(s.high)}），含稅 NT$ ${money(s.taxed)}` : '', '',
    d.proposal ? `---\n\n${d.proposal.content.trim()}\n` : '', f ? `---\n\n${f.content.trim()}\n` : '',
    d.bom ? ['---', '', '## 成本明細', '', '| 行 | 子系統 | 名稱 | 數量 | 小計（NT$） |', '|---|---|---|---|---|',
      ...d.bom.lines.map(l => `| ${l.line} | ${l.section} | ${String(l.name).replace(/\|/g, '／')} | ${l.qty} ${l.unit} | ${money(l.subtotal)} |`), ''].join('\n') : '',
    `\n產生時間 ${d.at.toLocaleString('zh-TW', { hour12: false })}`].join('\n');
}

// HTML → PDF（無頭 Chrome 的 Page.printToPDF）
export async function reportPdf(html) {
  const { openBrowser } = await import(pathToFileURL(join(REPO, 'core', 'tools', 'cdp.mjs')).href);
  const dir = mkdtempSync(join(tmpdir(), 'vs3d-report-')), file = join(dir, 'report.html');
  writeFileSync(file, html);
  const b = await openBrowser({ width: 1000, height: 1400 });
  try {
    await b.goto(pathToFileURL(file).href, 'document.readyState === "complete"');
    const r = await b.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
    if (!r.result?.data) throw new Error(`PDF 產生失敗：${JSON.stringify(r.error || r).slice(0, 200)}`);
    return Buffer.from(r.result.data, 'base64');
  } finally { await b.close(); rmSync(dir, { recursive: true, force: true }); }
}
