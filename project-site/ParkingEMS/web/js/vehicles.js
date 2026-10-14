// 參數化轎車外觀；尺寸沿用本站包絡，非特定車款。背景車共用同一組網格，以實例化繪製。
import * as THREE from 'three';
import { block, cylinder, bevelBox } from '@core/geom/shapes.js';
import { liveScreen } from '@core/models/equipment.js';
import { CAR } from './sites.js';

const mesh = (g, name, geo, mat) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
const group = (g, name) => { const o = new THREE.Group(); o.name = name; g?.add(o); return o; };
const panel = (g, name, pts, mat) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
  return mesh(g, name, geo, mat);
};

// 橫向截面沿車長放樣，肩線與前後保桿均有曲度；門的位置留實際開口。
function bodyGeometry() {
  const sections = [[-2250,660,740],[-2100,790,840],[-1750,840,900],[-1050,850,910],[-500,820,910],[650,780,910],[1100,750,905],[1750,690,860],[2130,590,770],[2250,480,680]];
  const vertices=[],indices=[];
  for(const [x,y,w] of sections) {
    const arch = Math.max(...[-1400,1400].map(c => Math.abs(x-c)<390 ? 330+Math.sqrt(Math.max(0,390**2-(x-c)**2)) : 200));
    for(const [py,pz] of [[200,-w*.76],[Math.min(y-95,arch),-w*.98],[y-65,-w],[y,-w*.77],[y,w*.77],[y-65,w],[Math.min(y-95,arch),w*.98],[200,w*.76]])vertices.push(x,py,pz);
  }
  for(let i=0;i<sections.length-1;i++)for(let j=0;j<8;j++) {
    if(i===4&&(j===1||j===5))continue;
    const a=i*8+j,b=i*8+(j+1)%8,c=(i+1)*8+(j+1)%8,d=(i+1)*8+j;
    indices.push(a,b,d,b,c,d);
  }
  for(const i of [0,sections.length-1])for(let j=1;j<7;j++)indices.push(i*8,i*8+(i?j:j+1),i*8+(i?j+1:j));
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}
const BODY = bodyGeometry();
const TIRE = new THREE.TorusGeometry(247,83,12,32);

export function detailedCar(name,color,M) {
  const root=group(null,name), paint=new THREE.MeshPhysicalMaterial({color,roughness:.28,metalness:.35,clearcoat:.8,clearcoatRoughness:.18,side:THREE.DoubleSide});
  const glass=new THREE.MeshPhysicalMaterial({color:0x233b48,roughness:.12,metalness:.35,clearcoat:1,side:THREE.DoubleSide});
  mesh(root,'car body',BODY,paint);
  block(root,[2300,150,1440],[-200,320,0],M.cabinetDark).name='car floor';
  // 前後玻璃與車頂分離，避免舊版方盒車艙的垂直輪廓。
  panel(root,'car windshield',[[950,800,-770],[120,1410,-665],[120,1410,665],[950,800,770]],glass);
  panel(root,'car rear glass',[[-1710,850,770],[-780,1380,660],[-780,1380,-660],[-1710,850,-770]],glass);
  const roof=bevelBox(970,65,1380,paint,30);roof.position.set(-350,1420,0);roof.name='car roof';root.add(roof);
  for(const s of [-1,1]) {
    panel(root,'rear quarter glass',[[-1680,865,s*787],[-790,1365,s*680],[-540,1378,s*690],[-540,834,s*895]],glass);
    panel(root,'rear pillar',[[-1720,855,s*793],[-810,1400,s*681],[-730,1400,s*690],[-1620,855,s*807]],paint);
    panel(root,'front pillar',[[980,800,s*788],[160,1410,s*680],[90,1410,s*680],[890,805,s*800]],paint);
    block(root,[65,550,38],[-520,1100,s*790],M.cabinetDark).name='car B pillar';
    block(root,[1950,65,30],[-230,340,s*892],M.cabinetDark).name='car sill';
    const mirror=bevelBox(220,110,160,paint,30);mirror.position.set(640,930,s*985);mirror.name='car mirror';root.add(mirror);
    block(root,[24,70,110],[530,930,s*990],M.glass).name='mirror glass';
  }
  // 車門以車頭側鉸鏈轉動；門板與窗框一起動，門內留座椅與深色內裝。
  const doors=[-1,1].map(s=>{
    const g=group(root,'front door hinge');g.position.set(650,0,s*904);
    panel(g,'front door skin',[[-1140,395,-s*5],[0,395,-s*5],[0,770,0],[-1140,810,0]],paint);
    panel(g,'front door glass',[[-1140,837,-s*20],[-1140,1375,-s*218],[-540,1390,-s*230],[220,817,-s*110]],glass);
    block(g,[170,32,18],[-920,780,s*9],M.galv).name='car door handle';
    block(g,[1050,30,22],[-560,824,-s*14],paint).name='door belt trim';
    return {g,side:s};
  });
  for(const s of [-1,1]) {
    const seat=bevelBox(530,180,550,M.cabinetDark,45);seat.position.set(-260,530,s*420);seat.name='car seat';root.add(seat);
    const back=bevelBox(160,520,530,M.cabinetDark,50);back.position.set(-530,830,s*420);back.rotation.z=.15;back.name='seat back';root.add(back);
  }
  const wheels=[],steering=[];
  for(const x of [-1400,1400])for(const s of [-1,1]) {
    const axle=group(root,'wheel steering');axle.position.set(x,CAR.wheelR,s*810);steering.push({axle,front:x>0});
    mesh(axle,'car tire',TIRE,M.tire).scale.z=1.28;
    const hub=group(axle,'car wheel rotation');hub.position.z=s*107;wheels.push(hub);
    cylinder(hub,196,20,[0,0,0],M.rim,'z',24).name='wheel rim';
    cylinder(hub,147,24,[0,0,s*12],M.cabinetDark,'z',24).name='wheel recess';
    for(let j=0;j<5;j++){const sp=block(hub,[39,300,12],[0,0,s*30],M.rim);sp.rotation.z=j*Math.PI*2/5;sp.name='wheel spoke';}
    cylinder(hub,48,30,[0,0,s*30],M.rim,'z',12).name='wheel center';
  }
  const headMat=M.head.clone(),tailMat=M.tail.clone(),reverseMat=M.head.clone();
  for(const s of [-1,1]) {
    const h=bevelBox(110,100,440,headMat,25);h.position.set(2150,595,s*525);h.name='car headlight';root.add(h);
    block(root,[35,82,470],[-2155,710,s*510],tailMat).name='car taillight';
    block(root,[30,52,135],[-2190,470,s*490],reverseMat).name='car reverse light';
  }
  block(root,[50,115,1050],[2205,340,0],M.cabinetDark).name='front lower grille';
  const plate=liveScreen(520,130,384,96);plate.mesh.rotation.y=Math.PI/2;plate.mesh.position.set(2266,470,0);plate.mesh.name='hero front plate';root.add(plate.mesh);
  plate.draw(name,(c,w,h)=>{c.fillStyle='#eeeee6';c.fillRect(0,0,w,h);c.fillStyle='#17232d';c.font='bold 65px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(name.startsWith('hero')?'EVA-0588':'EV',w/2,h/2);});
  const ports=[1,-1].map(s=>{const p=block(root,[220,160,12],[CAR.len/2-650,760,s*(CAR.w/2+4)],M.ledOff);p.name='car port';p.userData.side=s;return p;});
  const lids=ports.map(p=>{const g=group(root,'charge port lid hinge');g.position.copy(p.position).add(new THREE.Vector3(0,90,p.userData.side*18));block(g,[225,170,10],[0,-85,0],paint).name='charge port lid';return g;});
  return {root,ports,wheels,lids,doors,headMat,tailMat,reverseMat,plate:plate.mesh,
    setDetail({distance=0,night=0,moving=false,reverse=false,brake=false,side=0,open=false,steer=0}={}){
      for(const w of wheels)w.rotation.z=-distance/CAR.wheelR;
      for(const {axle,front} of steering)axle.rotation.y=front?steer:0;
      headMat.emissiveIntensity=moving?.25+night*3:.05;tailMat.emissiveIntensity=brake?3:moving?.3+night:.05;reverseMat.emissiveIntensity=reverse&&moving?3:0;
      lids.forEach((g,i)=>{g.rotation.x=ports[i].userData.side===side?-side*1.35*Math.max(0,Math.min(1,Number(open))):0;});
      Object.assign(root.userData,{wheelDistance:distance,headlights:moving&&night>.5,reversing:reverse&&moving,braking:brake});
    },
    setDoor(side,amount){for(const d of doors)d.g.rotation.y=d.side===side?d.side*Math.max(0,Math.min(1,amount))*.46:0;},
    portWorld(side){return ports[side>0?0:1].getWorldPosition(new THREE.Vector3());},
    setCharging(side,state){ports.forEach(p=>{p.material=p.userData.side===side?(state==='charging'?M.ledBlue:state==='done'?M.ledGreen:state==='wait'?M.ledAmber:M.ledOff):M.ledOff;});}
  };
}

export function detailedFleet(name,count,colors,M){
  const root=group(null,name),base=detailedCar('fleet prototype',0xffffff,M);base.root.updateMatrixWorld(true);
  // 不複製文字／操作附件；曲面車身、玻璃、車輪與燈具仍共享幾何。
  const parts=[];base.root.traverse(o=>{if(!o.isMesh||/plate|port|seat|door handle|spoke|wheel center|mirror glass|sill|trim/.test(o.name))return;
    const im=new THREE.InstancedMesh(o.geometry,o.material,count);im.name='fleet '+o.name;im.castShadow=im.receiveShadow=true;im.frustumCulled=false;root.add(im);
    if(o.material===base.root.getObjectByName('car body').material){const c=new THREE.Color();for(let i=0;i<count;i++)im.setColorAt(i,c.setHex(colors[(i*7+3)%colors.length]));}
    parts.push({im,local:o.matrixWorld.clone()});
  });
  const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3(1,1,1),up=new THREE.Vector3(0,1,0),tmp=new THREE.Matrix4(),zero=new THREE.Matrix4().makeScale(0,0,0);
  return {root,set(slots){slots.forEach((slot,i)=>{m.compose(p.set(slot.x,0,slot.z),q.setFromAxisAngle(up,slot.yaw),s);for(const part of parts)part.im.setMatrixAt(i,slot.on?tmp.multiplyMatrices(m,part.local):zero);});for(const part of parts)part.im.instanceMatrix.needsUpdate=true;}};
}
