// 寫 xlsx（純 Node，不用套件；評估平台 Q3，2026-10-06 拍板）：zip 用內建的 zlib（deflateRawSync、crc32），內容是最小的 SpreadsheetML。
// writeXlsx([{ name, cols: [欄寬…], rows: [[儲存格…]…], freeze: 'A2' }]) → Buffer
// 儲存格：null／undefined 是空白；字串、數字、布林直接寫；或 { v: 快取值, f: '公式（不含 =）', s: 樣式名稱 }。
// 公式同時寫快取值：不重算的檢視器（與平台自己讀回來核對時）也看得到數字；開檔時 Excel 會整本重算（fullCalcOnLoad）。
import { deflateRawSync, crc32 } from 'node:zlib';

// 樣式名稱 → cellXfs 的位置（styles.xml 依這個順序產生）
export const STYLES = ['default', 'head', 'money', 'moneyInput', 'pctInput', 'title', 'numInput', 'wrap', 'bold', 'moneyBold', 'pct', 'note'];
const xfIndex = Object.fromEntries(STYLES.map((s, i) => [s, i]));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
export const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

function cellXml(ref, c) {
  if (c == null) return '';
  const o = typeof c === 'object' && !Array.isArray(c) ? c : { v: c };
  const s = o.s ? ` s="${xfIndex[o.s] ?? 0}"` : '', f = o.f ? `<f>${esc(o.f)}</f>` : '';
  if (o.v == null && !o.f) return o.s ? `<c r="${ref}"${s}/>` : '';
  if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${ref}"${s}>${f}<v>${o.v}</v></c>`;
  if (typeof o.v === 'boolean') return `<c r="${ref}"${s} t="b">${f}<v>${o.v ? 1 : 0}</v></c>`;
  if (o.f) return `<c r="${ref}"${s} t="str">${f}<v>${esc(o.v ?? '')}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
}

function sheetXml({ rows, cols = [], freeze }) {
  const colsXml = cols.length ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = freeze ? (() => { const m = /^([A-Z]+)(\d+)$/.exec(freeze), x = m[1].split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, y = +m[2] - 1;
    return `<sheetViews><sheetView workbookViewId="0"><pane${x ? ` xSplit="${x}"` : ''}${y ? ` ySplit="${y}"` : ''} topLeftCell="${freeze}" activePane="${x && y ? 'bottomRight' : y ? 'bottomLeft' : 'topRight'}" state="frozen"/></sheetView></sheetViews>`; })() : '';
  const body = rows.map((r, ri) => { const cells = (r || []).map((c, ci) => cellXml(`${colName(ci)}${ri + 1}`, c)).join(''); return cells ? `<row r="${ri + 1}">${cells}</row>` : ''; }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${colsXml}<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><name val="Microsoft JhengHei"/></font>
<font><sz val="11"/><color rgb="FF1F4E9E"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="14"/><name val="Microsoft JhengHei"/></font>
<font><sz val="10"/><color rgb="FF6B7A72"/><name val="Microsoft JhengHei"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F1E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFC9D6CE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${STYLES.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="9" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// zip：每個檔案 deflate 壓縮；回傳 Buffer
export function zip(files) {
  const parts = [], central = [], d = new Date();
  // DOS 格式的修改時間與日期（寫 0 的話有些解壓程式會當成無效日期）
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), comp = deflateRawSync(data), nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12); cen.writeUInt16LE(dosDate, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, comp); central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

export function writeXlsx(sheets, { title = '' } = {}) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
    + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(title)}</dc:title><dc:creator>3D工作室</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;
  return zip([['[Content_Types].xml', ct], ['_rels/.rels', rels], ['docProps/core.xml', core], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', STYLES_XML],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])]);
}
