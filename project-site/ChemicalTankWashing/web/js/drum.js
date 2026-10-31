// 200 L 閉口 HDPE 桶：模型在共用模型庫（core/models/drum-200l.js）。
// 本站另加旋蓋面 3 張標籤（1 張無條碼＋2 張條碼，條碼讀值與側標相同），避開 2"（+X）與 3/4"（−X）桶塞。
import * as THREE from 'three';
import { DRUM } from '@core/models/drum-200l.js';
import { HAS_DOM } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
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

// 窄弧夾爪（從 2×2 棧板夾桶用）：兩片爪對向，每片 JAW_ARC 寬，中心在局部 ±X；core 的 drumJaws 每片約 80°，
// 夾棧板上的桶時不管轉到哪個方位，爪片邊緣都會掃到同板相鄰的桶。窄爪轉到對角（棧板外側與對角桶方向）就不會碰到。
// 局部 +Y 為桶軸、原點在桶中心；set(v)：1 夾緊、0 全開（每片往外 stroke mm）。
export const JAW_ARC = 30 * Math.PI / 180;
export function narrowJaws(parent, stroke = 90) {
  const jaws = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); parent.add(g);
    const a0 = (s > 0 ? Math.PI / 2 : -Math.PI / 2) - JAW_ARC / 2;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.R + 12, DRUM.R + 12, 420, 8, 1, true, a0, JAW_ARC), MAT.pu);
    pad.material.side = THREE.DoubleSide; pad.castShadow = true; g.add(pad);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.R + 32, DRUM.R + 32, 440, 8, 1, true, a0 - .02, JAW_ARC + .04), MAT.steel);
    back.castShadow = true; g.add(back);
    jaws.push({ g, s });
  }
  return { set(v) { for (const { g, s } of jaws) g.position.x = s * (1 - v) * stroke; } };
}
