// 測試用的最小 Office 檔：在記憶體裡組 zip（stored 與 deflate 混用），不放二進位檔進版控。
import * as zlib from 'node:zlib';

export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
export const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

// entries：{ 路徑: 字串或 Buffer }；deflate 為 true 時文字檔用 deflate，其餘 stored
export function zip(entries, { deflate = true } = {}) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, v] of Object.entries(entries)) {
    const data = Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'), n = Buffer.from(name, 'utf8');
    const method = deflate && !Buffer.isBuffer(v) ? 8 : 0, body = method ? zlib.deflateRawSync(data) : data, crc = zlib.crc32?.(data) ?? 0;   // crc32 是 Node 22.2 起才有；讀取端不驗證
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, body); centrals.push(c, n);
    off += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(centrals.length / 2, 8); e.writeUInt16LE(centrals.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = list => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const sp = (ph, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
const ap = (text, lvl) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"><a:tabLst><a:tab pos="0"/></a:tabLst></a:pPr>` : ''}<a:r><a:t>${text}</a:t></a:r></a:p>`;

// 投影片順序故意和檔名相反：slide2.xml 是第 1 張
export const pptx = () => zip({
  '[Content_Types].xml': '<Types/>',
  'ppt/presentation.xml': `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': rels([['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'slide', 'slides/slide2.xml'], ['rId9', 'slideMaster', 'slideMasters/slideMaster1.xml']]),
  'ppt/slides/slide2.xml': `<p:sld ${NS}><p:cSld><p:spTree>${sp('title', ap('流程 &amp; 節拍'))}${sp('body', ap('輸送帶') + `<a:p><a:pPr lvl="1"/><a:r><a:t>速度 0.2 m/s</a:t></a:r><a:br/><a:r><a:t>可調</a:t></a:r></a:p>`)}${sp('sldNum', ap('7'))}`
    + `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody>${ap('項目')}</a:txBody></a:tc><a:tc><a:txBody>${ap('規格')}</a:txBody></a:tc></a:tr>`
    + `<a:tr><a:tc><a:txBody>${ap('節拍')}</a:txBody></a:tc><a:tc><a:txBody>${ap('10 s')}${ap('a|b')}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    + `<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', 'image', '../media/image1.png'], ['rId2', 'notesSlide', '../notesSlides/notesSlide1.xml'], ['rId3', 'slideLayout', '../slideLayouts/slideLayout1.xml']]),
  'ppt/notesSlides/notesSlide1.xml': `<p:notes ${NS}><p:cSld><p:spTree>${sp('sldImg', '')}${sp('body', ap('講者備忘 &lt;重點&gt;'))}${sp('sldNum', ap('7'))}</p:spTree></p:cSld></p:notes>`,
  'ppt/slides/slide1.xml': `<p:sld ${NS} show="0"><p:cSld><p:spTree>${sp('', ap('結尾') + ap('&#x6E2C;&#35430;'))}<p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`,
  'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', 'image', '../media/image2.jpeg']]),
  'ppt/media/image1.png': PNG, 'ppt/media/image2.jpeg': JPG, 'ppt/media/image3.png': PNG,
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const wp = (text, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
export const docx = () => zip({
  'word/document.xml': `<w:document ${W}><w:body>${wp('規格說明', '<w:pStyle w:val="1"/>')}`
    + `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>A&lt;B</w:t><w:tab/><w:t>C</w:t></w:r><w:del><w:r><w:delText>刪掉的字</w:delText></w:r></w:del></w:p>`
    + wp('項目一', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') + wp('子項', '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>')
    + `<w:tbl><w:tblGrid/><w:tr><w:tc>${wp('欄一')}</w:tc><w:tc>${wp('欄二')}</w:tc></w:tr><w:tr><w:tc>${wp('甲')}${wp('乙')}</w:tc><w:tc/></w:tr></w:tbl>`
    + `<w:p><w:r><w:t>見圖</w:t></w:r><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rId5"/></a:graphicData></a:graphic></w:drawing></w:r>`
    + `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent>${wp('方塊文字')}</w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent>${wp('方塊文字')}</w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>`
    + `<w:sectPr/></w:body></w:document>`,
  'word/styles.xml': `<w:styles ${W}><w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  'word/_rels/document.xml.rels': rels([['rId5', 'image', 'media/image1.png'], ['rId6', 'hyperlink', 'https://example.com" TargetMode="External']]),
  'word/media/image1.png': PNG,
});

const X = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
export const xlsx = () => zip({
  'xl/workbook.xml': `<workbook ${X}><workbookPr/><sheets><sheet name="規格 &amp; 數量" sheetId="1" r:id="rId1"/><sheet name="圖" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'styles', 'styles.xml']]),
  'xl/sharedStrings.xml': `<sst ${X} count="3"><si><t>名稱</t></si><si><r><t>輸送</t></r><r><rPr/><t>帶</t></r><rPh sb="0" eb="1"><t>ゆそう</t></rPh></si><si/><si><t>X_x0031_|Y</t></si></sst>`,
  'xl/styles.xml': `<styleSheet ${X}><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><cellStyleXfs><xf numFmtId="14"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
  'xl/worksheets/sheet1.xml': `<worksheet ${X}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>數量</t></is></c><c r="C1" s="1"/></row>`
    + `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>0.30000000000000004</v></c><c r="C2" s="1"><v>45292</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" s="2"><v>0.125</v></c></row>`
    + `<row r="3" spans="1:5"/><row r="4"><c r="A4" t="str"><f>"o"&amp;"k"</f><v>ok</v></c><c r="F4" t="s"><v>3</v></c></row></sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml': `<worksheet ${X}><sheetData/><drawing r:id="rId1"/></worksheet>`,
  'xl/worksheets/_rels/sheet2.xml.rels': rels([['rId1', 'drawing', '../drawings/drawing1.xml']]),
  'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`,
  'xl/drawings/_rels/drawing1.xml.rels': rels([['rId1', 'image', '../media/image1.png']]),
  'xl/media/image1.png': PNG, 'xl/media/image2.png': PNG,
}, { deflate: false });
