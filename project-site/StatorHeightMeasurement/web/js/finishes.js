// 本站表面加工紋理：固定種子生成，不讀 DOM、不使用逐格亂數；貼圖與材質全站共用。
import * as THREE from 'three';

function texture(w, h, sample) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = sample(x, y); data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  const t = new THREE.DataTexture(data, w, h);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
const noise = (x, y) => { const a = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return a - Math.floor(a); };
const valueNoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = noise(ix, iy) * (1 - u) + noise(ix + 1, iy) * u;
  const b = noise(ix, iy + 1) * (1 - u) + noise(ix + 1, iy + 1) * u;
  return a * (1 - v) + b * v;
};
const brush = texture(256, 256, (x, y) => {
  const v = 190 + noise(Math.floor(x / 48), y) * 38 + noise(x, y) * 12;
  return [v, v, v];
});
const stone = texture(256, 256, (x, y) => {
  const n = noise(x, y), grain = noise(Math.floor(x / 3), Math.floor(y / 3));
  const v = 65 + grain * 55 + (n > .91 ? 65 : n * 20); return [v, v, v + 3];
});
const worn = texture(512, 512, (x, y) => {
  const n = noise(x, y), patch = valueNoise(x / 75, y / 75);
  const oil = Math.max(0, patch - .48) * 85;
  const scratches = noise(Math.floor(x / 26), y) > .985 ? 34 : 0;
  const wear = Math.max(0, valueNoise(x / 22, y / 22) - .55) * 55;
  const v = 144 + n * 13 + scratches + wear - oil; return [v, v * .98, v * .95];
});
export const stainless = new THREE.MeshStandardMaterial({ color: 0xd4d9de, metalness: .88, roughness: .31, map: brush, roughnessMap: brush });
export const polished = new THREE.MeshStandardMaterial({ color: 0xd8e0e6, metalness: .92, roughness: .22, roughnessMap: brush });
export const wornSteel = new THREE.MeshStandardMaterial({ color: 0xb5b5ae, metalness: .72, roughness: .64, map: worn, roughnessMap: worn });
export const granite = new THREE.MeshStandardMaterial({ color: 0x55565a, metalness: .04, roughness: .48, map: stone });
export const hoseMat = new THREE.MeshStandardMaterial({ color: 0x23323c, roughness: .58 });
export const blueHose = new THREE.MeshStandardMaterial({ color: 0x367fba, roughness: .46 });

// 端面使用兩格圖集：左邊定子、右邊轉子。淺凹鉚接痕以明暗及粗糙度呈現，不挖成通孔。
export const punchedFace = texture(512, 256, (x, y) => {
  const rotor = x >= 256, px = ((x % 256) / 255 - .5) * 48, py = (y / 255 - .5) * 48;
  let v = 208 + noise(x, y) * 22 + Math.sin(y * 1.8) * 5;
  const centers = rotor ? [[0, 16, 2.5, .8], [16, 0, .8, 2.5], [0, -16, 2.5, .8], [-16, 0, .8, 2.5]] : [[0, 8.5, 3, 1.2], [0, -3, 1.2, 3]];
  for (const [cx, cy, w, h] of centers) {
    const dx = Math.abs(px - cx) / (w / 2), dy = Math.abs(py - cy) / (h / 2);
    if (dx < 1 && dy < 1) v = 90 + (py - cy) / h * 90;
    else if (dx < 1.35 && dy < 1.35) v = 245;
  }
  return [v, v, v];
});
