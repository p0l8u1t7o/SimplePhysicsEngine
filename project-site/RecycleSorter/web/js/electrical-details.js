// 第二段安裝外觀；附件尺寸、線號配置與散熱構造皆為示意，不改元件表或製程。
import * as THREE from 'three';
import { MAT, finished, std } from '@core/geom/materials.js';
import { block, plate } from '@core/geom/shapes.js';
import { cable, CABLE } from '@core/electrical/cable-routing.js';
import { detailBatch, SURFACE } from './appearance.js';

const dark = finished(MAT.steelDark, 'polymer', .025);
const copper = std(0xb97842, .4, .7);
const labelStyle = { bg: '#152a35', fg: '#edf5f4', w: 1024, h: 256, font: 'bold 56px "Microsoft JhengHei",sans-serif' };
// 小型標示共用圖集，避免每條線的兩端各占一張貼圖與材質。
// 標牌使用 512 × 128，線號保留原本 256 × 128；大安全標牌仍使用獨立高解析貼圖。
let atlas;
function labelAtlas(text, sleeve = false) {
  if (!atlas) {
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    atlas={canvas,ctx:canvas.getContext('2d'),texture,tiles:new Map(),
      plate:new THREE.MeshStandardMaterial({map:texture,roughness:.6}),
      sleeve:new THREE.MeshStandardMaterial({map:texture,roughness:.7,side:THREE.DoubleSide})};
  }
  const key=JSON.stringify([text,sleeve]);
  if (!atlas.tiles.has(key)) {
    const i=atlas.tiles.size;
    if(i>=64) throw new Error('電控標示圖集已滿');
    const x=(i%4)*512,y=Math.floor(i/4)*128,w=sleeve?256:512,h=128,c=atlas.ctx;
    c.fillStyle=sleeve?'#ece4bd':'#152a35';c.fillRect(x,y,512,h);
    c.fillStyle=sleeve?'#152a35':'#edf5f4';c.font=`bold ${sleeve?42:28}px "Microsoft JhengHei",sans-serif`;
    c.textAlign='center';c.textBaseline='middle';
    const rows=Array.isArray(text)?text:[text];
    rows.forEach((row,j)=>c.fillText(row,x+w/2,y+h*(j+.5)/rows.length,w-12));
    atlas.tiles.set(key,{x,y,w,h});atlas.texture.needsUpdate=true;
  }
  const tile=atlas.tiles.get(key);
  return {material:sleeve?atlas.sleeve:atlas.plate,mapUV(geo){
    const uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i,(tile.x+1+uv.getX(i)*(tile.w-2))/2048,
      1-(tile.y+tile.h-1-uv.getY(i)*(tile.h-2))/2048);
    return geo;
  }};
}
function tag(parent, text, size, pos, rot = 0) {
  const label=labelAtlas(text),mesh=new THREE.Mesh(label.mapUV(new THREE.PlaneGeometry(...size)),label.material);
  mesh.position.set(...pos);mesh.rotation.y=rot;parent.add(mesh);return mesh;
}
function tube(parent, outer, inner, length, pos, mat = dark) {
  const shape = new THREE.Shape(); shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 12 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, -length / 2, 0);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(...pos); parent.add(mesh); return mesh;
}

export function cameraDetails(vision, cam, i) {
  const z = cam.root.position.z;
  // 開口內徑 40 mm、延伸 22 mm，離光軸邊界仍有餘裕，不裁切既有視野。
  tube(cam.root, 23, 20, 24, [0, -10, 0]);
  tube(cam.root, 23, 17.6, 5, [0, 4.5, 0]);
  // 頂部接頭護套與服務餘長，線材接回既有 M12 與上方幹線。
  const boot = tube(vision, 9, 6.4, 14, [-700, 1671, z]);
  boot.userData.routingHardware = 'strain-relief';
  const bend = new THREE.Mesh(new THREE.TorusGeometry(10, 2.2, 6, 12, Math.PI / 2), dark);
  bend.position.set(-710, 1678, z); vision.add(bend);
  cable(vision, `CAM${i + 1} / 接頭餘長圈（示意）`, [[-700,1678,z],[-700,1716,z],[-717,1730,z],[-738,1716,z],[-730,1698,z]],
    { radius: 2.2, color: CABLE.signal, clips: 0, ends: false });
  // 滑座使用真正的長孔，板厚與原吊板一致；兩軌與光軸不動。
  const shape = new THREE.Shape(); shape.moveTo(-102,-21); shape.lineTo(102,-21); shape.lineTo(102,21); shape.lineTo(-102,21); shape.closePath();
  for (const x of [-80,80]) {
    const hole = new THREE.Path(); hole.moveTo(x-12,-4); hole.lineTo(x+12,-4); hole.absarc(x+12,0,4,-Math.PI/2,Math.PI/2,false);
    hole.lineTo(x-12,4); hole.absarc(x-12,0,4,Math.PI/2,Math.PI*1.5,false); shape.holes.push(hole);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 8, bevelEnabled: false, curveSegments: 5 }); geo.rotateX(-Math.PI/2); geo.translate(0,-4,0);
  const slider = new THREE.Mesh(geo, SURFACE.extrusion); slider.position.set(-700,1685,z+38); vision.add(slider);
  const batch = detailBatch(vision);
  for (const x of [-780,-620]) batch.bolt([x,1691,z+38],4);
  for (let j=0;j<9;j++) batch.box([1,1, j%4 ? 4:8],[-732+j*8,1690.2,z+49],MAT.black);
  batch.flush();
  tag(vision, [i ? 'CAM-R｜滑座（示意）' : 'CAM-L｜滑座（示意）', 'WD 800｜工作距離待確認'], [144,28], [-700,1686,z+60]);
}

export function curtainSign(frame) {
  const g = new THREE.Group(); g.position.set(-850,1700,720); frame.add(g);
  const b = detailBatch(g);
  b.box([520,110,3],[0,0,-3],dark);
  for (const y of [-53.5,53.5]) b.box([520,3,8],[0,y,-8.5],SURFACE.extrusion);
  for (const x of [-258.5,258.5]) b.box([3,104,8],[x,0,-8.5],SURFACE.extrusion);
  // 兩支 L 托架從標牌背面回接立柱正面 Z 700，側翼夾持 Z 670。
  for (const sign of [-1,1]) {
    b.box([8,34,3],[sign*36,0,-6],MAT.steelDark);
    b.box([8,3,46],[sign*36,-15.5,-28],MAT.steelDark);
    b.box([3,30,20],[sign*31.5,-2,-50],MAT.steelDark);
    b.bolt([sign*36,8,-3.5],3,'z');
  }
  b.box([512,3,1],[0,-49,0],MAT.amber); b.flush();
  plate(g, ['安全光幕（示意）｜Type 4／解析度 30 mm',
    '保護高度 1200 mm｜危險點距離 ≥ 668 mm', '依 ISO 13855｜實機位置待風險評估'], 508,96,[0,3,0],0,
    { ...labelStyle, w:1400,h:300,font:'bold 64px "Microsoft JhengHei",sans-serif' });
  return g;
}

export function trayCover(tray, length) {
  const b = detailBatch(tray), count = Math.ceil(length/300), pitch = length/count;
  for (let i=0;i<count;i++) {
    const x=-length/2+(i+.5)*pitch;
    b.box([pitch-3,2,48],[x,10,0],SURFACE.sheet);
    for (const dx of [-pitch*.35,pitch*.35]) b.bolt([x+dx,12.2,16],2.3);
    for (let dx=-pitch/2+18;dx<pitch/2-10;dx+=28) b.box([2,1,32],[x+dx,11.8,0],MAT.steelDark);
  }
  b.flush();
}

// 每段直線等距束帶；合併同一路徑的實例，不讓固定夾數量隨長度增加 draw call。
export function dressRoute(g, number, ordinal = 0) {
  const pts = g.userData.cable.points.map(p=>new THREE.Vector3(...p));
  const rings = [], geo = new THREE.TorusGeometry(g.userData.cable.radius+1,.8,4,10), obj = new THREE.Object3D();
  let next = 150, walked = 0;
  for(let i=1;i<pts.length;i++) {
    const a=pts[i-1], d=pts[i].clone().sub(a), length=d.length();
    while(next<=walked+length) {
      obj.position.copy(a).addScaledVector(d,(next-walked)/length);
      obj.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),d.clone().normalize()); obj.updateMatrix(); rings.push(obj.matrix.clone()); next+=300;
    }
    walked+=length;
  }
  if(rings.length) {
    const mesh=new THREE.InstancedMesh(geo,MAT.steelDark,rings.length); rings.forEach((m,i)=>mesh.setMatrixAt(i,m));
    mesh.userData.detailBatch=true; mesh.userData.routingHardware='clamp'; g.add(mesh);
  }
  if(!number) return;
  // 線號直接印於套管曲面；共用幹線的號碼管錯開，避免平面標牌重疊。
  for(const end of [0,1]) {
    if (end && g.userData.cable.length<90) continue;
    const ordered=end?[...pts].reverse():pts;
    let distance=Math.min(g.userData.cable.length*.3,26+(ordinal%7)*24), p=ordered[0], dir;
    for(let i=1;i<ordered.length;i++) {
      const d=ordered[i].clone().sub(ordered[i-1]), length=d.length();
      if(distance<=length) {dir=d.normalize();p=ordered[i-1].clone().addScaledVector(dir,distance);break;} distance-=length;
    }
    if(!dir) continue;
    const radius=g.userData.cable.radius;
    const label=labelAtlas([number,number],true);
    const ring=new THREE.Mesh(label.mapUV(new THREE.CylinderGeometry(radius+.7,radius+.7,18,12,1,true)),label.material);
    ring.position.copy(p); g.add(ring);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
    ring.userData.routingHardware='strain-relief';
  }
}

export function cabinetDetails(cab, shell, panel) {
  const b=detailBatch(cab), door=shell.group.children.find(o=>o.name.includes('removable door'));
  const dg=new THREE.Group(); dg.position.set(-300,-600,1760); door.add(dg);
  // 所有門上附件隨原門一起剖視／隱藏，位置以世界座標表達。
  tag(dg,['機台銘牌｜回收物自動分揀展示機','AC 220 V／20 A｜24 VDC 240 W（示意）'],[390,66],[300,975,-1605]);
  tag(dg,['⚡ 注意高壓','作業前切離電源（QS1）','櫃體 IP54（示意）'],[260,125],[270,850,-1614.5],Math.PI);
  // 內側文件袋：開口薄盒與折頁，向櫃內凸出 14 mm，避開元件深度。
  block(dg,[252,176,2],[300,500,-1615],dark);
  block(dg,[252,16,13],[300,420,-1622.5],SURFACE.extrusion);
  for(const x of [175,425]) block(dg,[2,156,13],[x,506,-1622.5],SURFACE.extrusion);
  block(dg,[242,105,2],[300,470,-1630],SURFACE.sheet);
  tag(dg,['接線圖／維護紀錄（示意）','QS1 → QF1／QF2 → X1','折頁 A｜B｜C'],[232,145],[300,515,-1627],Math.PI);
  tag(dg,'接線圖袋',[200,28],[300,470,-1632],Math.PI);
  const db=detailBatch(dg);
  for(const x of [14,586]) db.box([4,1138,3],[x,588,-1615],MAT.black);
  for(const y of [18,1158]) db.box([568,4,3],[300,y,-1615],MAT.black); db.flush();
  // 背板下緣接地排，安裝於絕緣座；接線避開四列元件與兩側線槽。
  b.box([300,16,4],[300,183,-1850],copper);
  for(const x of [170,430]) b.box([12,16,10],[x,183,-1858],MAT.black);
  for(let x=175;x<=425;x+=50) b.bolt([x,183,-1846],3,'z');
  tag(cab,'PE｜等電位接合（示意）',[200,22],[300,158,-1847]);
  const earth=(name,points)=>{
    const g=cable(cab,name,points,{radius:2,color:0x55a54a,clips:0,ends:false});
    dressRoute(g,null);
    // 黃綠條紋直接印於線材，不增加與接地柱重疊的裝飾實體。
    const map=new THREE.DataTexture(new Uint8Array([238,208,55,255,60,145,67,255]),2,1);
    map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;map.repeat.x=g.userData.cable.length/30;map.needsUpdate=true;
    const jacket=g.children.find(o=>o.userData.routingHardware==='jacket'); jacket.material.map=map;jacket.material.color.setHex(0xffffff);
  };
  earth('PE / 背板接地柱',[[175,183,-1846],[125,183,-1844],[125,276,-1860]]);
  earth('PE / 門接合服務彎',[[225,183,-1846],[225,128,-1820],[90,128,-1690],[90,310,-1638],[175,310,-1616]]);
  earth('PE / 側板',[[275,183,-1846],[275,105,-1810],[595,105,-1810]]);
  earth('PE / 櫃底',[[325,183,-1846],[325,70,-1780],[325,7,-1780]]);
  earth('PE / 穿板接頭板',[[425,183,-1846],[568,183,-1815],[568,1155,-1815],[568,1177,-1815]]);
  // 實際接頭 E1…E6 對應前六組端子；後六組是預留，避免虛構連線。
  const uses=['E1 進線','E2 馬達','E3 手臂','E4 相機','E5 I/O','E6 安全'];
  for(let i=0;i<12;i++) {
    const x=300+(i-5.5)*25;
    tag(cab,[`X1-${i+1}`,uses[i]??'預留'],[23,20],[x,860,-1832]);
    b.box([21,3,1],[x,847,-1833],i<3?MAT.amber:i===5?MAT.green:MAT.steelBlue);
  }
  b.box([1.2,34,25],[225,870,-1844],MAT.amber);
  b.box([1.2,34,25],[300,870,-1844],MAT.steelDark);
  // 頂部保留六個已用孔，沒有未用孔；空心分色環不堵穿板通道。
  for(let i=0;i<6;i++) {
    const radius=i===0?16:i<3?14:12;
    tube(cab,radius+3.8,radius+1.8,3,[100+i*80,1211,-1840],i<3?MAT.amber:MAT.steelBlue);
    const t=tag(cab,`E${i+1}｜${i<3?'動力':'訊號'}`,[68,22],[100+i*80,1201,-1788]); t.rotation.x=-Math.PI/2;
  }
  // 防塵簷下方保留 26 mm 以上出線空間，後緣敞開供六條立管轉折。
  b.box([626,3,318],[300,1270,-1750],SURFACE.cabinet);
  for(const x of [-8,608]) b.box([3,65,248],[x,1236,-1728],SURFACE.sheet);
  b.box([620,18,3],[300,1259,-1589],SURFACE.sheet);
  // 右側上下對流口：側板真的開孔，再加濾網與下斜百葉；IP54 是待確認的示意假設。
  const side=shell.group.children.find(o=>o.isMesh&&o.name.endsWith('/ side')&&o.position.x>0);
  const shape=new THREE.Shape(); shape.moveTo(-150,-588); shape.lineTo(150,-588); shape.lineTo(150,588); shape.lineTo(-150,588); shape.closePath();
  for(const y of [-280,280]) { const hole=new THREE.Path(); hole.moveTo(-68,y-78);hole.lineTo(-68,y+78);hole.lineTo(68,y+78);hole.lineTo(68,y-78);hole.closePath();shape.holes.push(hole); }
  const geo=new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false});geo.translate(0,0,-1.5);geo.rotateY(Math.PI/2);side.geometry.dispose();side.geometry=geo;
  const vents=new THREE.Group();vents.userData.electricalCover=true;cab.add(vents);const vb=detailBatch(vents);
  for(const y of [310,870]) {
    for(const z of [-1833,-1687]) vb.box([7,174,8],[604,y,z],SURFACE.sheet);
    for(const dy of [-83,83]) vb.box([7,8,138],[604,y+dy,-1760],SURFACE.sheet);
    for(let dy=-66;dy<=66;dy+=22) vb.box([15,2,133],[608,y+dy,-1760],SURFACE.extrusion,[0,0,-.4]);
    for(let dz=-60;dz<=60;dz+=12) vb.box([1,150,1.5],[595,y,-1760+dz],MAT.black);
  }
  vb.flush();
  // IPC／驅動器右側導風薄板，保留線槽及端子前方通道。
  b.box([2,430,85],[500,410,-1782],SURFACE.sheet); b.flush();
}

export function lightAdjusters(vision, v) {
  const b=detailBatch(vision);
  for(const x of v.ledX) {
    b.box([46,46,3],[x,1345,-604],SURFACE.sheet);
    b.bolt([x,1345,-607],5,'z');
    tag(vision,['0° · 45° · 90°','角度可調（示意）'],[64,32],[x,1390,-604],Math.PI);
  }
  b.flush();
}
