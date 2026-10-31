// 200 L 閉口 HDPE 桶：模型在共用模型庫（core/models/drum-200l.js）。
// 本站另加旋蓋面 3 張標籤（1 張無條碼＋2 張條碼，條碼讀值與側標相同），避開 2"（+X）與 3/4"（−X）桶塞。
import * as THREE from 'three';
import { DRUM } from '@core/models/drum-200l.js';
import { HAS_DOM } from '@core/geom/shapes.js';
export * from '@core/models/drum-200l.js';

const TOP_Y = DRUM.H / 2 - 12.5 + .8;   // 桶頂板（凹在 L 環內）上方 0.8 mm
// 桶局部座標：[中心 x, 中心 z, 寬（x 向）, 深（z 向）, 有條碼]；桶塞在 x ±200（半徑 36／18），標籤 x 範圍 ≤ ±130
export const TOP_LABELS = [[0, 0, 150, 90, false], [0, -165, 260, 100, true], [0, 165, 220, 100, true]];
const texCache = new Map();
function topTexture(id, barcode) {
  if (!HAS_DOM) return null;
  const key = id + barcode; if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 112; const g = c.getContext('2d');
  g.fillStyle = '#fbfbf7'; g.fillRect(0, 0, 256, 112); g.fillStyle = '#111'; g.textAlign = 'center';
  if (barcode) {
    let seed = [...id].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let x = 18; x < 238;) { const w = 2 + Math.floor(rnd() * 4); if (rnd() > .45) g.fillRect(x, 10, w, 66); x += w + 1 + Math.floor(rnd() * 3); }
    g.font = 'bold 22px Consolas,monospace'; g.fillText(id, 128, 100);
  } else {
    g.font = 'bold 30px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.fillText('品名／警示', 128, 52);
    g.font = '20px "Noto Sans TC","Microsoft JhengHei",sans-serif'; g.fillText('依填裝液體列印', 128, 88);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texCache.set(key, t); return t;
}
// 掛在桶的 root 上
export function addTopLabels(drum, id = drum.id) {
  const g = new THREE.Group(); g.name = 'top labels'; g.visible = false; drum.root.add(g);
  for (const [x, z, w, d, bar] of TOP_LABELS) {
    const tex = topTexture(id, bar);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0xf4f4ee, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, TOP_Y, z); g.add(m);
  }
  // set(n)：顯示前 n 張（true 為全部）
  return { group: g, set(n) { const k = n === true ? 3 : +n || 0; g.visible = k > 0; g.children.forEach((c, i) => { c.visible = i < k; }); } };
}
