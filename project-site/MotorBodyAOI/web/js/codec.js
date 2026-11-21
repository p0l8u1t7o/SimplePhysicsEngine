// 二進位陣列編碼：typed array ⇄ base64 字串（工件網格模組用它存，Node 與瀏覽器共用）
const TYPES = { i16: Int16Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array };

export function encode(arr) {
  const type = Object.keys(TYPES).find(k => arr instanceof TYPES[k]);
  if (!type) throw new Error('codec: 不支援的陣列型別');
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
