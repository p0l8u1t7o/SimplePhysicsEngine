// 太陽能板：拆成可各自移動的零件——層壓板（玻璃＋電池片＋背板）、接線盒、四支鋁框。
// 每個零件群組的原點都是「板的原點」（玻璃面中心，見 layout.js 的 PANEL），整板時四個群組的位姿相同；
// 拆框後各零件改由自己的位姿決定（鋁框跟夾爪外拉、落入收集槽；接線盒被刮刀推落）。
import * as THREE from 'three';
import { block, HAS_DOM } from '@core/geom/shapes.js';
import { MAT } from '@core/geom/materials.js';
import { PANEL } from './layout.js';

const P = PANEL;
const backsheet = new THREE.MeshStandardMaterial({ color: 0xe9ecee, roughness: .7 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9cfd4, roughness: .32, metalness: .75 });
const jboxMat = new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: .55 });

// 電池片貼圖：多晶矽的藍色斑紋＋白色匯流條與片間隙（瀏覽器才畫；Node 端只用底色）
let cellMat = null;
function cellMaterial() {
  if (cellMat) return cellMat;
  cellMat = new THREE.MeshPhysicalMaterial({ color: HAS_DOM ? 0xffffff : 0x1d3f7a, roughness: .18, metalness: .1, clearcoat: .8, clearcoatRoughness: .08 });
  if (HAS_DOM) {
    const [nx, nz] = P.cells, px = 64, c = document.createElement('canvas'); c.width = nx * px; c.height = nz * px;
    const g = c.getContext('2d');
    g.fillStyle = '#d7dde2'; g.fillRect(0, 0, c.width, c.height);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x0 = i * px + 2, y0 = j * px + 2, w = px - 4;
      g.fillStyle = '#1d3f7a'; g.fillRect(x0, y0, w, w);
      for (let k = 0; k < 40; k++) {                       // 多晶矽晶粒斑紋
        const l = 30 + rnd() * 30; g.fillStyle = `hsl(${212 + rnd() * 14},${45 + rnd() * 25}%,${l}%)`;
        g.globalAlpha = .35; g.fillRect(x0 + rnd() * w * .8, y0 + rnd() * w * .8, 4 + rnd() * 16, 4 + rnd() * 16);
      }
      g.globalAlpha = 1; g.fillStyle = '#c9d0d6';
      for (let b = 1; b <= 3; b++) g.fillRect(x0 + w * b / 4 - 1, y0, 2, w);   // 匯流條
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    cellMat.map = t;
  }
  return cellMat;
}

const group = name => { const g = new THREE.Group(); g.name = name; return g; };

// 建立一片板的零件。raw：整板（含鋁框與接線盒）；否則只有層壓板（出料棧板上的既有板）。
export function createPanelParts(parent, name, { raw = true } = {}) {
  const lam = group(name + ' laminate');
  // 上層：玻璃＋電池片（貼圖在上表面），下層：背板；兩層合計 PANEL.lam
  const top = block(lam, [P.glassL, 3.2, P.glassW], [0, -1.6, 0], cellMaterial()); top.name = 'panel glass';
  const back = block(lam, [P.glassL, P.lam - 3.2, P.glassW], [0, -3.2 - (P.lam - 3.2) / 2, 0], backsheet); back.name = 'panel backsheet';
  parent.add(lam);
  const out = { lam, jbox: null, frames: [] };
  if (!raw) return out;

  const jbox = group(name + ' jbox');
  const [bx, bh, bz] = P.jbox.size;
  block(jbox, [bx, bh, bz], [P.jbox.x, -P.lam - bh / 2, 0], jboxMat).name = 'junction box';
  for (const s of [-1, 1]) block(jbox, [16, 12, 60], [P.jbox.x + s * 40, -P.lam - bh + 6, bz / 2 + 30], jboxMat).name = 'junction cable';
  parent.add(jbox); out.jbox = jbox;

  // 鋁框斷面（由外往內）：上緣蓋住玻璃 10 mm（離玻璃 0.5 mm）、槽外壁、下方本體（離背板 1 mm）
  const e = P.edge, bodyTop = -P.lam - 1, bottom = -(P.T - P.lip);
  function bar(len, along, side) {
    const g = group(`${name} frame ${along}${side > 0 ? '+' : '-'}`);
    const at = (a, y, n) => along === 'x' ? [a, y, n] : [n, y, a];
    const size = (a, h, n) => along === 'x' ? [a, h, n] : [n, h, a];
    const c = side * ((along === 'x' ? P.W : P.L) / 2 - e / 2);         // 斷面中心（法向座標）
    const lamEdge = (along === 'x' ? P.glassW : P.glassL) / 2;
    const wallIn = lamEdge + 1, outer = (along === 'x' ? P.W : P.L) / 2;
    block(g, size(len, P.lip - .5, e), at(0, .5 + (P.lip - .5) / 2, c), frameMat).name = 'frame lip';
    block(g, size(len, .5 - bodyTop, outer - wallIn), at(0, (bodyTop + .5) / 2, side * (wallIn + outer) / 2), frameMat).name = 'frame wall';
    block(g, size(len, bodyTop - bottom, e), at(0, (bodyTop + bottom) / 2, c), frameMat).name = 'frame body';
    parent.add(g); return g;
  }
  // 長邊全長，短邊夾在兩支長邊之間
  out.frames = [bar(P.L, 'x', 1), bar(P.L, 'x', -1), bar(P.W - 2 * e, 'z', 1), bar(P.W - 2 * e, 'z', -1)];
  return out;
}

// 把零件群組放到板的位姿（position、quaternion 為板原點的世界位姿）
export function placeParts(parts, position, quaternion) {
  for (const g of [parts.lam, parts.jbox, ...parts.frames]) if (g) { g.position.copy(position); g.quaternion.copy(quaternion); }
}
// 鋁框的外拉方向（板座標）：南北長邊沿 ±Z、東西短邊沿 ±X
export const FRAME_OUT = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
