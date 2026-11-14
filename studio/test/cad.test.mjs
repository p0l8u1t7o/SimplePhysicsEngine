// CAD 預處理（lib/cad.mjs）：文字與二進位 DXF、圖塊插入的座標換算、Big5 文字、尺寸；STEP 檔頭、跳脫字元、單位與近似外形
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDxf, extractDxf, parseStep, extractStep, extractCadUploads } from '../lib/cad.mjs';

const pairs = list => list.map(([c, v]) => `${c}\n${v}`).join('\n') + '\n';
// 文字 DXF：1 單位 = mm；一個圖塊（基準點 10,0）裡有一條線，插入在 (100, 50)、轉 90°、放大 2 倍
const TEXT_DXF = pairs([
  [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1027'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [8, '0'], [2, 'PIN'], [10, 10], [20, 0], [0, 'LINE'], [8, '0'], [10, 10], [20, 0], [11, 20], [21, 0], [0, 'ENDBLK'], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'ENTITIES'],
  [0, 'LINE'], [8, '牆'], [10, 0], [20, 0], [11, 1000], [21, 0],
  [0, 'CIRCLE'], [8, '設備'], [10, 500], [20, 300], [40, 50],
  [0, 'LWPOLYLINE'], [8, '設備'], [90, 3], [70, 0], [10, 0], [20, 600], [42, 1], [10, 200], [20, 600], [10, 200], [20, 800],
  [0, 'TEXT'], [8, '標註'], [10, 100], [20, 900], [1, '上料區'],
  [0, 'DIMENSION'], [8, '標註'], [10, 0], [20, 0], [11, 500], [21, -50], [42, 1000], [1, '<>'],
  [0, 'INSERT'], [8, '設備'], [2, 'PIN'], [10, 100], [20, 50], [41, 2], [42, 2], [50, 90],
  [0, 'ENDSEC'], [0, 'EOF']]);

test('文字 DXF：單位、圖層、文字、尺寸、圖塊插入的座標換算、弧度', () => {
  const d = parseDxf(Buffer.from(TEXT_DXF, 'utf8'));
  assert.equal(d.units, 'mm'); assert.equal(d.mmPerUnit, 1); assert.equal(d.encoding, 'utf-8');
  assert.equal(d.counts.entities, 7);       // 模型空間 6 個＋圖塊裡 1 個
  const ins = d.model.find(x => x.k === 'insert');
  assert.equal(ins.name, 'PIN'); assert.equal(ins.rot, Math.PI / 2);
  const lw = d.model.filter(x => x.k === 'poly')[2];
  assert.ok(lw.pts.length > 6, '弧段要拆成多點');
  const dir = mkdtempSync(join(tmpdir(), 'cad-'));
  try {
    writeFileSync(join(dir, 'a.dxf'), TEXT_DXF);
    const r = extractDxf(join(dir, 'a.dxf'), join(dir, 'out'), 'a.dxf');
    assert.ok(existsSync(join(dir, 'out', 'preview.png')) && existsSync(join(dir, 'out', 'tile-4.png')));
    const md = readFileSync(join(dir, 'out', 'text.md'), 'utf8');
    assert.match(md, /單位：mm/); assert.match(md, /上料區/); assert.match(md, /- 1,000　@\(500, -50\)/);
    assert.match(md, /- 牆：1/); assert.match(md, /- PIN：1/);
    assert.match(r.summary, /1 種文字、1 個尺寸/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// 二進位 DXF（R13 以後）：2 位元組群組碼；2004 以前的檔依 $DWGCODEPAGE 解碼（Big5）
function binaryDxf(list) {
  const parts = [Buffer.from('AutoCAD Binary DXF\r\n\x1a\0', 'latin1')];
  for (const [c, v, t] of list) {
    const code = Buffer.alloc(2); code.writeUInt16LE(c); parts.push(code);
    if (t === 'd') { const b = Buffer.alloc(8); b.writeDoubleLE(v); parts.push(b); }
    else if (t === 'h') { const b = Buffer.alloc(2); b.writeInt16LE(v); parts.push(b); }
    else parts.push(Buffer.isBuffer(v) ? v : Buffer.from(v, 'latin1'), Buffer.from([0]));
  }
  return Buffer.concat(parts);
}
test('二進位 DXF：Big5 圖層與文字、線段座標', () => {
  const big5 = Buffer.from([0xa4, 0xa4]);     // 「中」
  const buf = binaryDxf([[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [9, '$DWGCODEPAGE'], [3, 'ANSI_950'], [9, '$INSUNITS'], [70, 6, 'h'], [0, 'ENDSEC'],
    [0, 'SECTION'], [2, 'ENTITIES'], [0, 'LINE'], [8, big5], [10, 1, 'd'], [20, 2, 'd'], [11, 3, 'd'], [21, 4, 'd'], [0, 'TEXT'], [8, big5], [10, 0, 'd'], [20, 0, 'd'], [1, big5], [0, 'ENDSEC'], [0, 'EOF']]);
  const d = parseDxf(buf);
  assert.equal(d.encoding, 'big5'); assert.equal(d.units, 'm'); assert.equal(d.mmPerUnit, 1000);
  assert.deepEqual(d.model[0], { k: 'poly', layer: '中', pts: [1, 2, 3, 4] });
  assert.equal(d.model[1].s, '中');
});

const STEP = `ISO-10303-21;
HEADER;
FILE_NAME('tank','2026-10-27T16:27:29',('某作者'),('某公司'),'Open CASCADE','FreeCAD','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = PRODUCT('P1','1000L \\\\X2\\\\687669FD\\\\X0\\\\','',(#2));
#3 = PRODUCT('P2','O''Ring','',(#2));
#5 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#6 = CARTESIAN_POINT('',(0.,0.,0.));
#7 = CARTESIAN_POINT('',(1000.,500.,1500.));
#8 = MANIFOLD_SOLID_BREP('',#9);
ENDSEC;
END-ISO-10303-21;
`;
test('STEP：跳脫字元（含雙反斜線）、單位、零件名稱、近似外形；不列作者與公司', async () => {
  const s = parseStep(STEP);
  assert.equal(s.unit, 'mm'); assert.equal(s.mm, 1); assert.equal(s.solids, 1);
  assert.deepEqual(s.products, ['1000L 桶槽', "O'Ring"]);
  assert.deepEqual([s.box.x1, s.box.y1, s.box.z1], [1000, 500, 1500]);
  const dir = mkdtempSync(join(tmpdir(), 'cad-'));
  try {
    writeFileSync(join(dir, 't.stp'), STEP);
    const r = await extractCadUploads(dir, ['t.stp', 'x.txt'], { occtDir: null });
    assert.match(r.info['t.stp'], /已抽出/); assert.equal(r.info['x.txt'], undefined);
    const md = readFileSync(join(dir, 't.stp.extract', 'text.md'), 'utf8');
    assert.match(md, /1,000 × 500 × 1,500/); assert.match(md, /沒有預覽圖/);
    assert.ok(!/某作者|某公司/.test(md), '檔頭的作者與公司不列出');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
