// 回收物（工件）造型與規格：依開案報告第 5 頁的照片與現場輸送帶影片影格的目測比例建模，尺寸為示意值。
// 每個工件是一個 Group，原點在「與帶面接觸的最低點」，長軸沿本地 +X；lying 的工件高度 = spec.H。
// 分類：food＝白色食品類 HDPE（抓到 A 帶）、nonfood＝白色非食品類 HDPE（抓到 B 帶）、other＝不抓取，隨主帶續流。
import * as THREE from 'three';
import { block, bevelBox, cylinder, rounded } from '@core/geom/shapes.js';
import { MAT, std } from '@core/geom/materials.js';
import { packageMaterial } from './appearance.js';

// ---------------------------------------------------------------- 專案專屬材質（瓶身、帶面在 MAT 之外自建）
export const ITEM_MAT = {
  hdpeFood: std(0xf1f4f3, .34, 0, { transparent: true, opacity: .93 }),     // 半透白 HDPE（牛奶、優酪乳）
  hdpeNon: std(0xe6e9ea, .46, 0),                                           // 不透白 HDPE（洗髮精、酒精、洗衣精）
  capBlue: std(0x2f6fd0, .45, .05), capRed: std(0xc03a32, .45, .05), capWhite: std(0xdfe4e6, .5, 0),
  pet: std(0xbfe4f0, .08, 0, { transparent: true, opacity: .42 }),          // 透明 PET
  petCap: std(0x4aa05a, .45, .05),
  tin: std(0xa9b2ba, .3, .85),                                              // 鐵罐
  film: std(0xaeb9bd, .7, 0, { transparent: true, opacity: .55, side: THREE.DoubleSide }),
  paper: std(0xbfa478, .85, 0),
  crushed: std(0xd3d7d6, .6, 0),
  label: std(0xd8dfe3, .7, 0),
};

/**
 * 模型庫 12 款，既有動畫展示 11 款；洗衣精罐尚未排入料流。
 * L＝長軸、W＝橫寬、H＝躺平高度（帶面到頂面），mm，皆為示意值。
 * form 決定建模方式；cls 決定分揀目的地。
 */
export const KINDS = {
  milkJug: { label: '牛奶罐 1 gal', cls: 'food', form: 'jug', L: 200, W: 112, H: 95, cap: 'capBlue' },
  milkBottle: { label: '鮮奶瓶 2 L', cls: 'food', form: 'bottle', L: 210, W: 80, H: 80, cap: 'capWhite' },
  yogurt: { label: '優酪乳罐', cls: 'food', form: 'bottle', L: 150, W: 70, H: 70, cap: 'capRed' },
  lactic: { label: '乳酸飲料瓶', cls: 'food', form: 'bottle', L: 170, W: 62, H: 62, cap: 'capBlue' },
  shampoo: { label: '洗髮精罐', cls: 'nonfood', form: 'flask', L: 220, W: 92, H: 72, cap: 'capWhite' },
  alcohol: { label: '酒精瓶 1 L', cls: 'nonfood', form: 'bottle', L: 190, W: 72, H: 72, cap: 'capRed' },
  detergent: { label: '洗衣精罐', cls: 'nonfood', form: 'jug', L: 228, W: 118, H: 94, cap: 'capWhite' },
  pet: { label: 'PET 寶特瓶', cls: 'other', form: 'pet', L: 215, W: 68, H: 68, cap: 'petCap' },
  can: { label: '鐵罐', cls: 'other', form: 'can', L: 120, W: 66, H: 66 },
  film: { label: '薄膜／塑膠袋', cls: 'other', form: 'film', L: 190, W: 165, H: 26 },
  crushed: { label: '壓扁件', cls: 'other', form: 'crushed', L: 195, W: 125, H: 32 },
  carton: { label: '紙盒', cls: 'other', form: 'box', L: 165, W: 96, H: 72 },
};

export const CLS_LABEL = { food: '食品 HDPE', nonfood: '非食品 HDPE', other: '其餘回收物' };

const bodyMat = k => k.cls === 'food' ? ITEM_MAT.hdpeFood : k.cls === 'nonfood' ? ITEM_MAT.hdpeNon
  : k.form === 'pet' ? ITEM_MAT.pet : k.form === 'can' ? ITEM_MAT.tin : k.form === 'film' ? ITEM_MAT.film
    : k.form === 'crushed' ? ITEM_MAT.crushed : ITEM_MAT.paper;

/** 建立一個工件：回傳 Group（原點在帶面接觸點，長軸沿 +X） */
export function buildItem(kindKey) {
  const k = KINDS[kindKey], g = new THREE.Group();
  g.name = 'item ' + kindKey;
  const mat = bodyMat(k), r = k.H / 2, capMat = ITEM_MAT[k.cap] || ITEM_MAT.capWhite;

  if (k.form === 'bottle' || k.form === 'pet' || k.form === 'can') {
    const neck = k.form === 'can' ? 0 : Math.min(46, k.L * .22), body = k.L - neck;
    const shell = cylinder(g, r, body, [-neck / 2, r, 0], packageMaterial(mat, k.cls, k.form), 'x', 24);
    // 包裝圖沿圓柱側面環繞；端面 UV 留在白色邊帶，不增加繪製批次。
    const uv = shell.geometry.attributes.uv, index = shell.geometry.index;
    for (const group of shell.geometry.groups.slice(1)) for (let i = group.start; i < group.start + group.count; i++) uv.setY(index.getX(i), .02);
    uv.needsUpdate = true;
    if (k.form === 'pet') for (let i = 0; i < 3; i++) cylinder(g, r * 1.02, 5, [-neck / 2 - body * .3 + i * body * .22, r, 0], mat, 'x', 24);
    if (neck) {
      cylinder(g, r * .42, neck * .62, [body / 2 - neck * .04, r, 0], mat, 'x', 18, r * .82);   // 肩部錐
      cylinder(g, r * .4, neck * .42, [body / 2 + neck * .5, r, 0], capMat, 'x', 18);
    } else {
      for (const x of [-body / 2 + 3, body / 2 - 3]) cylinder(g, r * 1.03, 4, [x, r, 0], ITEM_MAT.tin, 'x', 24);
    }
  } else if (k.form === 'jug') {
    // 提把壺（牛奶罐、洗衣精罐）：扁方瓶身 + 頸 + 側提把
    const h = k.H, body = bevelBox(k.L * .82, h, k.W, mat, 12); body.position.set(-k.L * .05, h / 2, 0); g.add(body);
    cylinder(g, h * .2, k.L * .14, [k.L * .45, h * .66, 0], mat, 'x', 18);
    cylinder(g, h * .19, k.L * .07, [k.L * .55, h * .66, 0], capMat, 'x', 18);
    block(g, [k.L * .2, h * .16, k.W * .22], [k.L * .24, h * .95, 0], mat);                    // 提把（頂面橫桿）
    block(g, [k.L * .5, h * .34, 2.5], [-k.L * .08, h * .48, k.W / 2 + 1.6], packageMaterial(ITEM_MAT.label, k.cls, k.form, true));
  } else if (k.form === 'flask') {
    // 扁橢圓罐（洗髮精）：圓角板 + 壓頭
    rounded(g, k.L * .86, k.W, k.H, k.W * .45, [-k.L * .06, 0, 0], mat);
    cylinder(g, k.H * .22, k.L * .1, [k.L * .45, k.H * .62, 0], mat, 'x', 18);
    cylinder(g, k.H * .2, k.L * .09, [k.L * .54, k.H * .62, 0], capMat, 'x', 18);
    block(g, [k.L * .5, k.H * .4, 2.5], [-k.L * .06, k.H * .5, k.W / 2 + 1.6], packageMaterial(ITEM_MAT.label, k.cls, k.form, true));
  } else if (k.form === 'box') {
    const b = bevelBox(k.L, k.H, k.W, mat, 6); b.position.y = k.H / 2; g.add(b);
    block(g, [k.L * .62, k.H * .46, 2.5], [0, k.H * .52, k.W / 2 + 1.6], ITEM_MAT.label);
  } else if (k.form === 'crushed') {
    const b = bevelBox(k.L, k.H * .72, k.W, mat, 8); b.position.y = k.H * .36; b.rotation.z = .07; g.add(b);
    block(g, [k.L * .5, k.H * .5, k.W * .55], [k.L * .14, k.H * .68, 0], mat).rotation.set(.12, .2, -.1);
  } else {  // film：皺摺薄片
    for (let i = 0; i < 3; i++) {
      const m = block(g, [k.L * (.9 - i * .18), k.H * .34, k.W * (.86 - i * .2)], [(i - 1) * 14, k.H * (.2 + i * .26), (i - 1) * 10], ITEM_MAT.film);
      m.rotation.set(.1 * i, .3 * i - .2, .08 * (1 - i));
    }
  }
  if (['jug', 'flask'].includes(k.form)) {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(k.L * .38, k.W * .5), packageMaterial(ITEM_MAT.label, k.cls, k.form, true));
    top.rotation.x = -Math.PI / 2; top.position.set(-k.L * .13, k.H + 1.5, 0); g.add(top);
  }
  return g;
}
