// 測試用：寫出 VTK legacy 檔（ASCII／BINARY、舊式 cells／VTK 5.1 OFFSETS、FIELD 或 SCALARS／VECTORS、POLYDATA／UNSTRUCTURED_GRID）。
// 盡量模仿 OpenFOAM.com 的 surfaceWriter（legacy）與 VTK 本身的輸出，用來測讀取器的各種分支。

const enc = new TextEncoder();

function numbersChunk(values, type, binary) {
  if (!binary) {
    const out = [];
    const f = type === 'float' || type === 'double' ? v => (Number.isInteger(v) ? String(v) : v.toPrecision(9)) : v => String(Math.round(v));
    for (let i = 0; i < values.length; i += 9) out.push(Array.from(values.slice(i, i + 9), f).join(' '));
    return enc.encode(out.join('\n') + '\n');
  }
  const size = { float: 4, double: 8, int: 4, vtktypeint64: 8 }[type];
  const b = new Uint8Array(values.length * size + 1);
  const dv = new DataView(b.buffer);
  values.forEach((v, i) => {
    if (type === 'float') dv.setFloat32(i * 4, v, false);
    else if (type === 'double') dv.setFloat64(i * 8, v, false);
    else if (type === 'int') dv.setInt32(i * 4, v, false);
    else dv.setBigInt64(i * 8, BigInt(v), false);
  });
  b[b.length - 1] = 10; // 二進位區塊後的換行
  return b;
}

export function writeVtk({
  title = 'synthetic', dataset = 'POLYDATA', binary = false, v51 = false, style = 'field',
  points, polys = [], lines = [], cellTypes = null, pointData = {}, cellData = {}, fieldData = null, pointType = 'float',
}) {
  const chunks = [];
  const text = s => chunks.push(enc.encode(s));
  text(`# vtk DataFile Version ${v51 ? '5.1' : '2.0'}\n${title}\n${binary ? 'BINARY' : 'ASCII'}\nDATASET ${dataset}\n`);
  if (fieldData) {
    text(`FIELD FieldData ${Object.keys(fieldData).length}\n`);
    for (const [n, a] of Object.entries(fieldData)) { text(`${n} ${a.components} ${a.values.length / a.components} double\n`); chunks.push(numbersChunk(a.values, 'double', binary)); }
  }
  const nP = points.length / 3;
  text(`POINTS ${nP} ${pointType}\n`);
  chunks.push(numbersChunk(points, pointType, binary));
  if (v51) text('METADATA\nINFORMATION 0\n\n');

  const cellBlock = (kw, cells) => {
    if (!cells.length) return;
    if (v51) {
      const offs = [0]; const conn = [];
      for (const c of cells) { conn.push(...c); offs.push(conn.length); }
      text(`${kw} ${offs.length} ${conn.length}\nOFFSETS vtktypeint64\n`);
      chunks.push(numbersChunk(offs, 'vtktypeint64', binary));
      text('CONNECTIVITY vtktypeint64\n');
      chunks.push(numbersChunk(conn, 'vtktypeint64', binary));
    } else {
      const flat = [];
      for (const c of cells) flat.push(c.length, ...c);
      text(`${kw} ${cells.length} ${flat.length}\n`);
      chunks.push(numbersChunk(flat, 'int', binary));
    }
  };
  if (dataset === 'POLYDATA') {
    cellBlock('LINES', lines);
    cellBlock('POLYGONS', polys);
  } else {
    const all = [...polys, ...lines];
    cellBlock('CELLS', all);
    text(`CELL_TYPES ${all.length}\n`);
    chunks.push(numbersChunk(cellTypes || all.map(c => (c.length === 2 ? 3 : c.length === 3 ? 5 : c.length === 4 ? 9 : 7)), 'int', binary));
  }

  const dataBlock = (kw, n, fields) => {
    const names = Object.keys(fields);
    if (!names.length) return;
    text(`${kw} ${n}\n`);
    if (style === 'field') {
      text(`FIELD attributes ${names.length}\n`);
      for (const name of names) { const a = fields[name]; text(`${name} ${a.components} ${n} float\n`); chunks.push(numbersChunk(a.values, 'float', binary)); }
    } else {
      for (const name of names) {
        const a = fields[name];
        if (a.components === 3) text(`VECTORS ${name} float\n`);
        else text(`SCALARS ${name} float ${a.components}\nLOOKUP_TABLE default\n`);
        chunks.push(numbersChunk(a.values, 'float', binary));
      }
    }
  };
  const nCells = polys.length + lines.length;
  dataBlock('CELL_DATA', nCells, cellData);
  dataBlock('POINT_DATA', nP, pointData);

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
