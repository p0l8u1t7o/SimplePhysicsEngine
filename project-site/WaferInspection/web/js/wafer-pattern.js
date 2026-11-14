// 外觀參考照片的程序圖樣；沒有照片像素、實際光罩或產品電路資料。
// 晶圓座標 mm；out = [明場亮度, 暗場亮度, R, G, B]，均為 0～1。
// 同一座標供 3D 與相機模擬使用。虹彩是外觀近似，並非薄膜／繞射求解。
const TYPES = [
  5, 5, 1, 0, 0, 3,
  2, 6, 1, 4, 0, 3,
  2, 6, 7, 4, 1, 1,
  0, 4, 3, 2, 5, 5,
  0, 4, 3, 2, 6, 1,
  1, 1, 7, 0, 6, 1,
];
const frac = v => v - Math.floor(v);
const tri = v => 1 - 4 * Math.abs(frac(v) - .5);
const clamp = v => Math.max(0, Math.min(1, v));

export function pattern(x, y, W, H, out = [0, 0, 0, 0, 0]) {
  const dx = Math.floor(x / W), dy = Math.floor(y / H);
  const u = (x / W - dx) * 6, v = (y / H - dy) * 6;
  const col = Math.floor(u), row = Math.floor(v), a = u - col, b = v - row;
  // 兩種 reticle 排列交錯，只交換特定區塊，保留照片中的規律。
  const variant = ((dx + dy) % 2 + 2) % 2;
  let type = TYPES[row * 6 + col];
  if (variant && (row === 2 || row === 4)) type = TYPES[row * 6 + (col + 3) % 6];
  let r = .52, g = .28, bl = .25, df = .018, ink = 0;
  const edge = Math.min(a, 1 - a, b, 1 - b);
  if (edge < .016) { r = .22; g = .19; bl = .17; df = .14; }
  else if (edge < .027) { r = .91; g = .79; bl = .64; df = .4; }
  else {
    if (type === 0) { // 栗紅大墊片、角落紅粉小方塊、白色長條邊框
      r = .53 + .025 * b; g = .28; bl = .26;
      if (a > .63 && a < .86 && b > .09 && b < .28) {
        const m = (Math.floor(a * 27) + Math.floor(b * 27)) % 3;
        r = .59 + m * .055; g = .30 + m * .035; bl = .29 + m * .045; df = .06;
      }
      ink = b > .055 && b < .076 && a > .08 && a < .94 ? 1 : 0;
    } else if (type === 1 || type === 7) { // 水平／垂直細線與梳齒
      const t = type === 1 ? b : a, cross = type === 1 ? a : b;
      const stripe = frac(t * 26);
      const active = cross > .08 && cross < .92 && !(type === 7 && a > .55 && b > .55);
      ink = active ? clamp((.18 - Math.abs(stripe - .5)) * 15) : 0;
      if (active && Math.abs(frac(cross * 11) - .5) < .07) ink *= .55;
    } else if (type === 2) { // 稀疏點陣
      const px = frac(a * 12) - .5, py = frac(b * 12) - .5;
      ink = clamp((.23 - Math.sqrt(px * px + py * py)) * 10);
    } else if (type === 3) { // 「0」形環墊：2 欄 × 4 列，圓角矩形
      const px = Math.abs(frac(a * 2) - .5), py = Math.abs(frac(b * 4) - .5);
      const qx = Math.max(0, px - .13), qy = Math.max(0, py - .16);
      const d = Math.sqrt(qx * qx + qy * qy) - .065;
      ink = clamp((.037 - Math.abs(d)) * 38);
    } else if (type === 4) { // 密線上的粉彩摩爾紋；淡藍／橘／粉，不用照片取色
      const wave = tri(a * 3.1 + b * .45), wave2 = tri(b * 3.6 - a * .3);
      const micro = tri(a * 47) * tri(b * 43) * .085;
      r = .79 + .11 * wave + micro; g = .67 + .13 * wave2 + micro;
      bl = .66 - .12 * wave + .08 * wave2 + micro;
      df = .12 + .08 * Math.abs(tri(a * 47));
      if (a > .72 && a < .84 && b < .48 || a > .5 && a < .72 && b > .38 && b < .48) { r = .40; g = .22; bl = .20; df = .025; }
    } else if (type === 5) { // 橄欖底、左右對稱電路與接點
      r = .38; g = .355; bl = .22;
      const xx = Math.abs(a - .5), yy = frac(b * 2), dy = Math.abs(yy - .5);
      const ring = Math.abs(Math.max(xx * 1.65, dy) - .22), inner = Math.abs(Math.max(xx * 2.5, dy * 1.7) - .22);
      ink = ring < .018 || inner < .016 || xx < .012 || dy < .015 && xx < .36 ? 1 : 0;
      if (xx > .3 && xx < .44 && Math.abs(frac(b * 14) - .5) < .13) ink = .9;
      if (xx > .2 && xx < .32 && Math.abs(dy - .16) < .018 || xx > .12 && xx < .2 && Math.abs(dy - .32) < .021) ink = .85;
    } else { // 小電路方塊陣列
      const px = frac(a * 4), py = frac(b * 6), d = Math.min(px, 1 - px, py, 1 - py);
      r = .36; g = .28; bl = .235;
      ink = d > .13 && d < .19 || px > .43 && px < .55 && py > .25 && py < .7 ? .9 : 0;
      if (px > .28 && px < .73 && py > .72 && py < .81 || px < .12 && py > .4 && py < .55) ink = .75;
    }
    r += (.98 - r) * ink; g += (.89 - g) * ink; bl += (.73 - bl) * ink;
    df = Math.max(df, .025 + .43 * ink);
  }
  out[2] = r; out[3] = g; out[4] = bl;
  out[0] = .2126 * r + .7152 * g + .0722 * bl; out[1] = df;
  return out;
}
