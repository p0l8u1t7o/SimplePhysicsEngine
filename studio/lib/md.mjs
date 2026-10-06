// 簡單的 Markdown → HTML（評估報告與介面的可行性分析共用；不需要 npm 套件）。
// 支援：標題、段落、粗體、行內程式碼、連結（只收 http／https）、項目與編號清單（一層縮排）、表格、程式碼區塊、引言、分隔線。
// 所有文字都先跳脫，代理或使用者寫的 HTML 不會被執行。
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

export function mdToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let i = 0;
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) { const body = []; i++; while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]); i++; out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(l);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*>/.test(l)) { const body = []; while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${mdToHtml(body.join('\n'))}</blockquote>`); continue; }
    if (isList(l)) {
      const ordered = /^\s*\d/.test(l), items = [];
      while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const x = lines[i++];
        if (isList(x) && !/^\s{2,}/.test(x)) items.push({ text: x.replace(/^\s*([-*+]|\d+[.)])\s+/, ''), sub: [] });
        else items.at(-1).sub.push(x.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim());
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(it => `<li>${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map(s => `<li>${inline(s)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*\|)/.test(lines[i]) && !isList(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}
