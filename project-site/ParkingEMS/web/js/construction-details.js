// 工序細節依既有 builds／lifts 顯示；暗色坑與管溝是地表剖面示意，未做地坪布林切除。
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { liveScreen } from '@core/models/equipment.js';
import { M } from './models.js';
import { createOperator } from './operator.js';
import { clamp } from './detail-state.js';

const group=(p,name)=>{const g=new THREE.Group();g.name=name;p.add(g);return g;};
export function createConstructionDetails({scene,site,seq,reg,flows}) {
  const root=group(scene,'construction details'), soil=new THREE.MeshStandardMaterial({color:0x241e17,roughness:1});
  const pits=seq.builds.filter(b=>/^footing|^bessPad$/.test(b.key)).map(b=>{
    const g=group(root,`excavation ${b.key}`), p=reg[b.key].pos;
    g.position.set(p.x,0,p.z);
    const size=b.key==='bessPad'?[site.bess[0].size[0]+1100,site.bess[0].size[2]+1100]:[1100,1100];
    block(g,[size[0],16,size[1]],[0,18,0],soil).name='foundation excavation section';
    const cage=group(g,'rebar cage');
    for(const x of [-200,200])for(const z of [-200,200])cylinder(cage,14,400,[x,225,z],M.steel,'y',8).name='rebar vertical';
    for(const y of [80,240,400]) {
      for(const z of [-200,200])block(cage,[400,16,16],[0,y,z],M.steel).name='rebar tie';
      for(const x of [-200,200])block(cage,[16,16,368],[x,y,0],M.steel).name='rebar tie';
    }
    return {b,g,cage};
  });
  const trenches=flows.map((f,i)=>{
    const g=group(root,`trench ${f.r.id}`), pts=f.r.pts;
    for(let j=1;j<pts.length;j++) {
      const [x0,z0]=pts[j-1],[x1,z1]=pts[j],len=Math.hypot(x1-x0,z1-z0);if(len<5)continue;
      const m=block(g,[Math.max(1,len-20),8,230],[(x0+x1)/2,12+i*1.2,(z0+z1)/2],soil);m.rotation.y=-Math.atan2(z1-z0,x1-x0);m.name='trench cut section';
    }
    return {g,b:seq.builds.find(b=>b.key===(f.r.expand?'conduitsX':'conduits'))};
  });
  const sign=group(root,'construction notice');
  sign.position.set(site.entrance.lane[1]+2400,0,site.entrance.zGate-2500);
  block(sign,[1800,100,700],[0,50,0],M.concrete).name='notice base';
  for(const x of [-620,620])block(sign,[70,1400,70],[x,800,-60],M.galv).name='notice post';
  block(sign,[1800,760,70],[0,1820,0],M.fenceOrange).name='notice board';
  const face=liveScreen(1700,660,680,264);face.mesh.position.set(0,1820,38);sign.add(face.mesh);
  face.draw('notice',(c,w,h)=>{c.fillStyle='#f6d68a';c.fillRect(0,0,w,h);c.fillStyle='#362816';c.font='bold 62px sans-serif';c.textAlign='center';c.fillText('分區施工　照常營業',w/2,100);c.font='34px sans-serif';c.fillText('請依現場引導通行（示意）',w/2,190);});
  const marshal=createOperator(root,'construction marshal proxy',true),installer=createOperator(root,'module installer proxy',true);
  const truck=group(root,'delivery flatbed');
  block(truck,[6700,330,2200],[0,820,0],M.craneDark).name='flatbed chassis';
  block(truck,[4700,100,2400],[-850,1040,0],M.galv).name='flatbed deck';
  block(truck,[1600,1500,2200],[2450,1720,0],M.cabinet).name='delivery cab';
  block(truck,[1610,650,1800],[2450,1950,0],M.glass).name='delivery windows';
  for(const x of [-2400,-1300,2400])for(const s of [-1,1])cylinder(truck,440,250,[x,440,s*1090],M.tire,'z',14).name='delivery wheel';
  const cargo=group(root,'delivered equipment crate');
  block(cargo,[1300,1700,1200],[0,850,0],M.cabinet).name='delivery crate';
  for(const z of [-480,480])block(cargo,[1320,90,100],[0,220,z],M.wood).name='crate skid';
  // 貨車只在第一吊前進入已封閉堆料區；卸料與退場以省略鏡頭表示，原吊裝腿段不變。
  const first=seq.lifts[0], deliveryEnd=first.t0-.15, deliveryStart=Math.max(0,deliveryEnd-2.3);
  const [px,,pz]=first.pick, yaw=site.id==='flagship'?0:Math.PI/2;
  const park=new THREE.Vector3(px+(site.id==='flagship'?3400:0),0,pz+(site.id==='flagship'?0:3900));
  const approach=new THREE.Vector3(site.id==='flagship'?5500:0,0,site.id==='flagship'?0:5000);
  const cargoStart=new THREE.Vector3(-1600,1100,0).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(park);
  function apply(t) {
    for(const {b,g,cage} of pits) {g.visible=t>=Math.max(3,b.t0-1.4)&&t<b.t0;cage.visible=t>=b.t0-.75;}
    for(const {b,g} of trenches) {g.visible=!!b&&t>=b.t0-.65&&t<b.t1+.4;g.scale.y=1;}
    sign.visible=seq.zones.some(z=>t>=z.t0&&t<z.t1);
    const lift=seq.lifts.find(l=>t>=l.t0&&t<=l.t1);
    marshal.root.visible=!!lift;
    if(lift)marshal.root.position.set(lift.pick[0]-2000,0,lift.pick[2]+2000);
    else marshal.root.position.set(0,0,0);
    marshal.root.rotation.y=.8;marshal.pose(t,0,.75+.2*Math.sin(t*5));
    const bay=seq.builds.find(b=>b.key.startsWith('bay')&&t>=b.t0&&t<b.t1);
    installer.root.visible=!!bay;
    if(bay){const b=reg[bay.key];installer.root.position.copy(b.pos).add(new THREE.Vector3(0,site.carport.colH+650,site.carport.zLine));}
    else installer.root.position.set(site.ems.x-900,0,site.ems.z+800);
    installer.pose(t,0,.9);
    truck.visible=t>=deliveryStart&&t<deliveryEnd;cargo.visible=truck.visible;
    const u=clamp((t-deliveryStart)/(deliveryEnd-deliveryStart));
    truck.position.copy(park).addScaledVector(approach,1-clamp(u/.45));truck.rotation.y=yaw;
    cargo.position.copy(cargoStart).addScaledVector(approach,1-clamp(u/.45));
    cargo.rotation.y=yaw;
  }
  return {root,pits,trenches,sign,marshal,installer,truck,cargo,deliveryStart,deliveryEnd,apply};
}
