// 市購小件模型（indicators.js、sensors.js、lights.js）共用的小工具。
// 預設參數：取 meta.params 每一項的 value
export const defaults = meta => Object.fromEntries(Object.entries(meta.params || {}).map(([k, v]) => [k, v.value]));
// 陰影旗標：各站原本的寫法不一（例如燈罩不投影、燈桿投影），換用共用模型時要能照原樣設定
export const shadow = (mesh, on = true) => { mesh.castShadow = mesh.receiveShadow = !!on; return mesh; };
// 選項可以是布林值（整組）或物件（逐項）：pick(P.shadow, 'lamps') → true／false
export const pick = (v, key, fallback = true) => v === undefined ? fallback : v !== null && typeof v === 'object' ? (v[key] ?? fallback) : !!v;
