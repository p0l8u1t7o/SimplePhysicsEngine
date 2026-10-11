// 產品檔的二進位陣列編碼：typed array ⇄ base64 字串（產品模組裡的網格與逐面資料用它存，Node 與瀏覽器共用）。
const TYPES = { i32: Int32Array, u32: Uint32Array, u16: Uint16Array, u8: Uint8Array, f32: Float32Array };

export function encode(arr) {
  const type = Object.keys(TYPES).find(k => arr instanceof TYPES[k]);
  if (!type) throw new Error('codec: unsupported array');
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `${type}:${btoa(s)}`;
}

export function decode(str) {
  const [type, data] = str.split(':'), bin = atob(data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TYPES[type](bytes.buffer);
}

// 索引陣列：頂點數 < 65536 用 Uint16，否則 Uint32
export const indexArray = (n, len) => n < 65536 ? new Uint16Array(len) : new Uint32Array(len);
