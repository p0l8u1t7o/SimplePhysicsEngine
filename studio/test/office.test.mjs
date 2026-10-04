// Office 抽取（lib/office.mjs）：zip 解析、pptx／docx／xlsx 文字與圖片、損壞檔與舊格式。
//   node --test studio/test/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readZip, decodeXml, extractOffice, extractUploads } from '../lib/office.mjs';
import { zip, pptx, docx, xlsx, PNG, JPG } from './office-fixtures.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vs3d-office-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const put = (name, buf) => { const f = join(dir, name); writeFileSync(f, buf); return f; };
const extract = (name, buf) => { const r = extractOffice(put(name, buf), join(dir, name + '.extract')); return { r, md: readFileSync(join(r.dir, 'text.md'), 'utf8') }; };

test('zip：stored 與 deflate、XML 實體', () => {
  const z = readZip(zip({ 'a.txt': '你好 hello'.repeat(50), 'b.bin': PNG }));
  assert.deepEqual(z.names, ['a.txt', 'b.bin']);
  assert.equal(z.text('a.txt'), '你好 hello'.repeat(50));
  assert.ok(z.get('b.bin').equals(PNG));
  assert.equal(z.get('nope'), null);
  assert.equal(decodeXml('&amp;lt; &lt;&gt;&quot;&apos; &#65;&#x6E2C;'), '&lt; <>"\' A測');
  assert.throws(() => readZip(Buffer.from('not a zip at all, just text')), /不是 zip/);
  assert.throws(() => readZip(Buffer.from('d0cf11e0a1b11ae1' + '00'.repeat(40), 'hex')), /密碼保護|舊版/);
});

test('pptx：投影片順序、標題、層級、表格、備忘稿、圖片標出投影片', () => {
  const { r, md } = extract('spec.pptx', pptx());
  assert.equal(r.slides, 2);
  assert.equal(r.summary, '2 張投影片、3 張圖');
  assert.ok(md.indexOf('## 投影片 1：流程 & 節拍') < md.indexOf('## 投影片 2（隱藏）'));   // 依 presentation.xml，不是檔名
  assert.match(md, /^- 輸送帶$/m);
  assert.match(md, /^ {2}- 速度 0\.2 m\/s\n {4}可調$/m);
  assert.match(md, /\| 項目 \| 規格 \|\n\| --- \| --- \|\n\| 節拍 \| 10 s<br>a\\\|b \|/);
  assert.match(md, /備忘稿：\n> 講者備忘 <重點>/);
  assert.doesNotMatch(md, /^- 7$/m);                                     // 投影片編號的版面配置區不抽
  assert.match(md, /- 測試/);
  assert.match(md, /圖片：slide01-image1\.png/);
  assert.match(md, /圖片：slide02-image2\.jpeg/);
  assert.match(md, /## 其他圖片[\s\S]*image3\.png/);
  assert.deepEqual(readdirSync(r.dir).sort(), ['image3.png', 'slide01-image1.png', 'slide02-image2.jpeg', 'text.md']);
  assert.ok(readFileSync(join(r.dir, 'slide02-image2.jpeg')).equals(JPG));
});

test('docx：標題樣式、清單、tab、表格、圖片位置；不重複 Fallback、不抽刪除的字', () => {
  const { r, md } = extract('spec.docx', docx());
  assert.match(md, /^## 規格說明$/m);
  assert.match(md, /^A<B\tC$/m);
  assert.match(md, /^- 項目一$/m);
  assert.match(md, /^ {2}- 子項$/m);
  assert.match(md, /\| 欄一 \| 欄二 \|\n\| --- \| --- \|\n\| 甲<br>乙 \|  \|/);
  assert.match(md, /見圖 \[圖片：image1\.png\]/);
  assert.equal(md.split('方塊文字').length - 1, 1);
  assert.doesNotMatch(md, /刪掉的字/);
  assert.deepEqual(r.images, ['image1.png']);
  assert.ok(existsSync(join(r.dir, 'image1.png')));
});

test('xlsx：工作表名稱、共用字串、數字、日期、百分比、布林、圖片錨點', () => {
  const { r, md } = extract('bom.xlsx', xlsx());
  assert.equal(r.sheets, 2);
  assert.match(md, /## 工作表 1：規格 & 數量/);
  assert.match(md, /## 工作表 2：圖（隱藏）/);
  assert.match(md, /\|  \| A \| B \| C \| D \| E \| F \|/);
  assert.match(md, /\| 1 \| 名稱 \| 數量 \|  \|  \|  \|  \|/);
  assert.match(md, /\| 2 \| 輸送帶 \| 0\.3 \| 2024-01-01 \| TRUE \| 12\.5% \|  \|/);   // 注音（rPh）不抽
  assert.match(md, /\| 4 \| ok \|  \|  \|  \|  \| X1\\\|Y \|/);
  assert.doesNotMatch(md, /\| 3 \|/);                                      // 空白列略過
  assert.match(md, /圖片：sheet2-image1\.png（B3）/);
  assert.match(md, /## 其他圖片[\s\S]*image2\.png/);
  assert.equal(r.images.length, 2);
});

test('整批上傳：損壞檔與舊格式只記警告，不讓建立失敗', () => {
  const docs = mkdtempSync(join(dir, 'docs-'));
  writeFileSync(join(docs, 'bad.pptx'), 'garbage');
  writeFileSync(join(docs, 'old.xls'), 'x');
  writeFileSync(join(docs, 'ok.docx'), docx());
  writeFileSync(join(docs, 'photo.jpg'), JPG);
  const { info, notes } = extractUploads(docs, ['bad.pptx', 'old.xls', 'ok.docx', 'photo.jpg']);
  assert.equal(info['ok.docx'], '已抽出文字與圖片：`docs/ok.docx.extract/text.md`，1 張圖');
  assert.equal(info['bad.pptx'], '無法抽出內容');
  assert.match(info['old.xls'], /舊版格式/);
  assert.equal(info['photo.jpg'], undefined);
  assert.ok(notes.some(n => /old\.xls.*另存成 \.xlsx/.test(n)));
  assert.ok(notes.some(n => /警告：bad\.pptx/.test(n)));
  assert.ok(!existsSync(join(docs, 'bad.pptx.extract')));
  assert.ok(existsSync(join(docs, 'ok.docx.extract', 'text.md')));
});
