// VTK legacy（.vtk）讀取：ASCII 與 BINARY（大端序），DATASET POLYDATA 與 UNSTRUCTURED_GRID。純 JS，瀏覽器與 Node 都能用。
// 用途：OpenFOAM 的 surfaces（cuttingPlane、patch）、streamLine、foamToVTK -surfaceFields 等輸出。
// 支援：POINTS、VERTICES／LINES／POLYGONS／TRIANGLE_STRIPS（舊式「n size」與 VTK 5.1 的 OFFSETS／CONNECTIVITY）、
//       CELLS＋CELL_TYPES、POINT_DATA／CELL_DATA 的 SCALARS（含 LOOKUP_TABLE）、VECTORS、NORMALS、TENSORS、
//       TEXTURE_COORDINATES、FIELD（含資料集層級的 FieldData）、METADATA 區塊（略過）。
// 不支援：STRUCTURED_POINTS／STRUCTURED_GRID／RECTILINEAR_GRID、bit 型別、XML 格式（.vtp／.vtu，見 README）。
// 回傳的點座標是 Float64Array；資料陣列保留原型別轉成 Float32Array 或 Float64Array（double）。
// UNSTRUCTURED_GRID 只取面（三角形 5、多邊形 7、四邊形 9、畫素 8）與線（3、4）；體元素（四面體、六面體…）計入 skipped3D。

const SIZES = {
  unsigned_char: 1, char: 1, unsigned_short: 2, short: 2, unsigned_int: 4, int: 4,
  unsigned_long: 8, long: 8, // 現代 VTK（LP64）的寫法；OpenFOAM 不會寫這兩種
  vtktypeint8: 1, vtktypeuint8: 1, vtktypeint16: 2, vtktypeuint16: 2, vtktypeint32: 4, vtktypeuint32: 4,
  vtktypeint64: 8, vtktypeuint64: 8, float: 4, double: 8, vtktypefloat32: 4, vtktypefloat64: 8,
};

export class VtkError extends Error {}

class Reader {
  constructor(bytes) { this.b = bytes; this.pos = 0; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.binary = false; }
  eof() { return this.pos >= this.b.length; }
  rawLine() {
    const b = this.b; let i = this.pos;
    while (i < b.length && b[i] !== 10) i++;
    let s = '';
    for (let k = this.pos; k < i; k++) s += String.fromCharCode(b[k]);
    this.pos = Math.min(i + 1, b.length);
    return s.replace(/\r$/, '');
  }
  // 下一個非空白行（關鍵字行）
  line() {
    while (!this.eof()) { const s = this.rawLine().trim(); if (s) return s; }
    return null;
  }
  peekWord() {
    let i = this.pos; const b = this.b;
    while (i < b.length && (b[i] === 32 || b[i] === 9 || b[i] === 10 || b[i] === 13)) i++;
    let s = '';
    while (i < b.length && b[i] > 32 && s.length < 16) s += String.fromCharCode(b[i++]);
    return s;
  }
  token() {
    const b = this.b;
    while (this.pos < b.length && b[this.pos] <= 32) this.pos++;
    const st = this.pos;
    while (this.pos < b.length && b[this.pos] > 32) this.pos++;
    if (st === this.pos) throw new VtkError('資料提前結束');
    let s = '';
    for (let k = st; k < this.pos; k++) s += String.fromCharCode(b[k]);
    return s;
  }
  // 讀 n 個值。整數型別回傳 Float64Array（索引用），浮點回傳 Float32Array／Float64Array
  values(n, type) {
    type = type.toLowerCase();
    const size = SIZES[type];
    if (!size) throw new VtkError(`不支援的資料型別：${type}`);
    const isF = /float|double/.test(type);
    const out = (type === 'float' || type === 'vtktypefloat32') ? new Float32Array(n) : new Float64Array(n);
    if (!this.binary) {
      for (let i = 0; i < n; i++) { const t = this.token(); const v = Number(t); if (Number.isNaN(v) && !/nan/i.test(t)) throw new VtkError(`不是數字：${t}`); out[i] = v; }
      return out;
    }
    if (this.pos + n * size > this.b.length) throw new VtkError(`二進位資料不足：要 ${n * size} bytes`);
    const dv = this.dv; let p = this.pos;
    for (let i = 0; i < n; i++, p += size) {
      let v;
      switch (type) {
        case 'float': case 'vtktypefloat32': v = dv.getFloat32(p, false); break;
        case 'double': case 'vtktypefloat64': v = dv.getFloat64(p, false); break;
        case 'int': case 'vtktypeint32': v = dv.getInt32(p, false); break;
        case 'unsigned_int': case 'vtktypeuint32': v = dv.getUint32(p, false); break;
        case 'short': case 'vtktypeint16': v = dv.getInt16(p, false); break;
        case 'unsigned_short': case 'vtktypeuint16': v = dv.getUint16(p, false); break;
        case 'char': case 'vtktypeint8': v = dv.getInt8(p); break;
        case 'unsigned_char': case 'vtktypeuint8': v = dv.getUint8(p); break;
        case 'long': case 'vtktypeint64': v = Number(dv.getBigInt64(p, false)); break;
        case 'unsigned_long': case 'vtktypeuint64': v = Number(dv.getBigUint64(p, false)); break;
        default: throw new VtkError(`不支援的資料型別：${type}`);
      }
      out[i] = v;
    }
    this.pos = p;
    void isF;
    return out;
  }
}

const toBytes = input => {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new VtkError('輸入要是字串、ArrayBuffer 或 Uint8Array');
};

// 一組 cells：舊式「n size」後接 size 個整數（每個 cell 先寫點數），或 VTK 5.1 的 OFFSETS／CONNECTIVITY
function readCells(r, n, size) {
  if (r.peekWord() === 'OFFSETS') {
    const offLine = r.line().split(/\s+/);
    const offsets = r.values(n, offLine[1] || 'vtktypeint64');
    const conLine = r.line().split(/\s+/);
    if (conLine[0] !== 'CONNECTIVITY') throw new VtkError('OFFSETS 之後要接 CONNECTIVITY');
    const conn = r.values(size, conLine[1] || 'vtktypeint64');
    return { offsets: Uint32Array.from(offsets), connectivity: Uint32Array.from(conn) };
  }
  const raw = r.values(size, 'int');
  const offsets = new Uint32Array(n + 1), conn = new Uint32Array(size - n);
  let p = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const k = raw[p++];
    if (!(k >= 0) || p + k > size) throw new VtkError('cells 資料長度不符');
    offsets[i] = c;
    for (let j = 0; j < k; j++) conn[c++] = raw[p++];
  }
  offsets[n] = c;
  return { offsets, connectivity: conn };
}

export function parseVtk(input) {
  const r = new Reader(toBytes(input));
  const head = r.rawLine();
  if (!/^#\s*vtk DataFile Version/i.test(head)) throw new VtkError('不是 VTK legacy 檔（第一行要是 # vtk DataFile Version）');
  const title = r.rawLine().trim();
  const fmtLine = r.line();
  if (fmtLine === 'BINARY') r.binary = true;
  else if (fmtLine !== 'ASCII') throw new VtkError(`第三行要是 ASCII 或 BINARY：${fmtLine}`);
  const ds = r.line()?.split(/\s+/);
  if (!ds || ds[0] !== 'DATASET') throw new VtkError('缺 DATASET');
  const dataset = ds[1];
  if (dataset !== 'POLYDATA' && dataset !== 'UNSTRUCTURED_GRID') throw new VtkError(`不支援的 DATASET：${dataset}（只支援 POLYDATA、UNSTRUCTURED_GRID）`);

  const out = {
    title, format: r.binary ? 'binary' : 'ascii', dataset,
    points: new Float64Array(0), nPoints: 0,
    polys: null, lines: null, verts: null, strips: null,
    cellTypes: null, cells: null, nCells: 0,
    pointData: {}, cellData: {}, fieldData: {}, skipped3D: 0,
  };
  let target = null, targetN = 0;

  const readField = (n, dest) => {
    for (let i = 0; i < n; i++) {
      let l = r.line();
      while (l === 'METADATA') { skipMeta(); l = r.line(); }
      const [name, nc, nt, type] = l.split(/\s+/);
      const comps = Number(nc), tuples = Number(nt);
      dest[name] = { components: comps, values: r.values(comps * tuples, type) };
    }
  };
  const skipMeta = () => { while (!r.eof()) { const s = r.rawLine().trim(); if (!s) break; } };

  for (;;) {
    const l = r.line();
    if (l === null) break;
    const w = l.split(/\s+/);
    const kw = w[0].toUpperCase();
    switch (kw) {
      case 'METADATA': skipMeta(); break;
      case 'FIELD': readField(Number(w[2]), target || out.fieldData); break;
      case 'POINTS': {
        out.nPoints = Number(w[1]);
        const v = r.values(out.nPoints * 3, w[2]);
        out.points = v instanceof Float64Array ? v : Float64Array.from(v);
        break;
      }
      case 'VERTICES': case 'LINES': case 'POLYGONS': case 'TRIANGLE_STRIPS': {
        const key = { VERTICES: 'verts', LINES: 'lines', POLYGONS: 'polys', TRIANGLE_STRIPS: 'strips' }[kw];
        out[key] = readCells(r, Number(w[1]), Number(w[2]));
        if (out[key].offsets.length === Number(w[1])) out[key].count = Number(w[1]) - 1; // VTK 5.1：OFFSETS 有 n 個（含尾端）
        else out[key].count = Number(w[1]);
        break;
      }
      case 'CELLS': {
        out.cells = readCells(r, Number(w[1]), Number(w[2]));
        out.cells.count = out.cells.offsets.length - 1;
        break;
      }
      case 'CELL_TYPES': out.cellTypes = Uint8Array.from(r.values(Number(w[1]), 'int')); break;
      case 'POINT_DATA': target = out.pointData; targetN = Number(w[1]); break;
      case 'CELL_DATA': target = out.cellData; targetN = Number(w[1]); break;
      case 'SCALARS': {
        const comps = Number(w[3] || 1);
        // LOOKUP_TABLE 行一定是文字（二進位檔也一樣），可以省略
        if (r.peekWord() === 'LOOKUP_TABLE') r.line();
        if (!target) throw new VtkError('SCALARS 出現在 POINT_DATA／CELL_DATA 之前');
        target[w[1]] = { components: comps, values: r.values(targetN * comps, w[2]) };
        break;
      }
      case 'VECTORS': case 'NORMALS':
        if (!target) throw new VtkError(`${kw} 出現在 POINT_DATA／CELL_DATA 之前`);
        target[w[1]] = { components: 3, values: r.values(targetN * 3, w[2]) };
        break;
      case 'TENSORS':
        target[w[1]] = { components: 9, values: r.values(targetN * 9, w[2]) };
        break;
      case 'TEXTURE_COORDINATES':
        target[w[1]] = { components: Number(w[2]), values: r.values(targetN * Number(w[2]), w[3]) };
        break;
      case 'LOOKUP_TABLE': // 獨立的色表（SCALARS 之後才會有），跳過
        if (r.binary) r.pos += Number(w[2]) * 4; else r.values(Number(w[2]) * 4, 'float');
        break;
      case 'COLOR_SCALARS': {
        const nv = Number(w[2]);
        if (r.binary) r.pos += targetN * nv; else r.values(targetN * nv, 'float');
        break;
      }
      default:
        throw new VtkError(`不認得的關鍵字：${w[0]}`);
    }
  }

  // UNSTRUCTURED_GRID：依 CELL_TYPES 拆成 polys／lines，記住每個 cell 在原始順序的索引（對應 CELL_DATA）
  if (dataset === 'UNSTRUCTURED_GRID' && out.cells) {
    if (!out.cellTypes) throw new VtkError('UNSTRUCTURED_GRID 缺 CELL_TYPES');
    const n = out.cells.count;
    out.nCells = n;
    const pick = types => {
      const offs = [0], conn = [], ids = [];
      for (let i = 0; i < n; i++) {
        const t = out.cellTypes[i];
        if (!types.includes(t)) continue;
        let a = out.cells.offsets[i], b = out.cells.offsets[i + 1];
        let pts = Array.from(out.cells.connectivity.subarray(a, b));
        if (t === 8) pts = [pts[0], pts[1], pts[3], pts[2]]; // VTK_PIXEL 的點順序轉成 quad
        conn.push(...pts); offs.push(conn.length); ids.push(i);
      }
      return ids.length ? { offsets: Uint32Array.from(offs), connectivity: Uint32Array.from(conn), count: ids.length, cellIds: Uint32Array.from(ids) } : null;
    };
    out.polys = pick([5, 7, 8, 9]);
    out.lines = pick([3, 4]);
    for (let i = 0; i < n; i++) if (out.cellTypes[i] >= 10) out.skipped3D++;
  } else {
    // POLYDATA：cell 順序是 VERTICES、LINES、POLYGONS、TRIANGLE_STRIPS
    let base = 0;
    for (const key of ['verts', 'lines', 'polys', 'strips']) {
      const c = out[key];
      if (!c) continue;
      c.cellIds = new Uint32Array(c.count);
      for (let i = 0; i < c.count; i++) c.cellIds[i] = base + i;
      base += c.count;
    }
    out.nCells = base;
    // 三角帶轉成三角形（polys），沿用 cell 編號
    if (out.strips) {
      const offs = out.polys ? Array.from(out.polys.offsets) : [0];
      const conn = out.polys ? Array.from(out.polys.connectivity) : [];
      const ids = out.polys ? Array.from(out.polys.cellIds) : [];
      const s = out.strips;
      for (let i = 0; i < s.count; i++) {
        const a = s.offsets[i], b = s.offsets[i + 1];
        for (let k = a; k + 2 < b; k++) {
          const tri = (k - a) % 2 ? [s.connectivity[k + 1], s.connectivity[k], s.connectivity[k + 2]] : [s.connectivity[k], s.connectivity[k + 1], s.connectivity[k + 2]];
          conn.push(...tri); offs.push(conn.length); ids.push(s.cellIds[i]);
        }
      }
      out.polys = { offsets: Uint32Array.from(offs), connectivity: Uint32Array.from(conn), count: ids.length, cellIds: Uint32Array.from(ids) };
    }
  }

  // 資料長度檢查
  for (const [name, a] of Object.entries(out.pointData)) if (a.values.length !== out.nPoints * a.components) throw new VtkError(`POINT_DATA ${name} 長度不符`);
  for (const [name, a] of Object.entries(out.cellData)) if (a.values.length !== out.nCells * a.components) throw new VtkError(`CELL_DATA ${name} 長度不符（${a.values.length / a.components} 對 ${out.nCells} 個 cell）`);
  const maxIdx = c => (c ? c.connectivity.reduce((m, v) => (v > m ? v : m), 0) : -1);
  for (const key of ['polys', 'lines', 'verts']) if (out[key] && out[key].count && maxIdx(out[key]) >= out.nPoints) throw new VtkError(`${key} 的點索引超出範圍`);
  return out;
}
