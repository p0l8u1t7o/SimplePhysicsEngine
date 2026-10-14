// 場地外觀層：建物與植栽沿用既有環境分類；排水溝及鋪面接縫是地表表現。
import * as THREE from 'three';
import { block } from '@core/geom/shapes.js';

export function createTrees(parent,positions,M){
  const bark=new THREE.MeshStandardMaterial({color:0x655e49,roughness:1});
  const leaves=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.93});
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(100,190,3000,7),bark,positions.length);
  const branches=new THREE.InstancedMesh(new THREE.CylinderGeometry(55,105,1800,6),bark,positions.length*3);
  const foliage=new THREE.IcosahedronGeometry(1,2),vertices=foliage.attributes.position;
  const normals=foliage.attributes.normal;
  for(let i=0;i<vertices.count;i++){const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i),r=1+.12*Math.sin(x*19+z*13)*Math.cos(y*17);vertices.setXYZ(i,x*r,y*r,z*r);normals.setXYZ(i,x,y,z);}
  const crown=new THREE.InstancedMesh(foliage,leaves,positions.length*7);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),p=new THREE.Vector3(),s=new THREE.Vector3(),col=new THREE.Color();
  positions.forEach(([x,z],i)=>{
    const k=.84+((i*37)%11)*.035;
    trunk.setMatrixAt(i,m.compose(p.set(x,1500*k,z),q.identity(),s.set(k,k,k)));
    for(let j=0;j<3;j++){const a=j*Math.PI*2/3+i;branches.setMatrixAt(i*3+j,m.compose(p.set(x+Math.sin(a)*420,2600*k,z+Math.cos(a)*420),q.setFromEuler(e.set(Math.cos(a)*.65,0,-Math.sin(a)*.65)),s.set(k,k,k)));}
    for(let j=0;j<7;j++){
      const a=j*2.4+i*.7,rad=j===6?0:1050;
      crown.setMatrixAt(i*7+j,m.compose(p.set(x+Math.sin(a)*rad*k,(j===6?4450:3450+(j%3)*330)*k,z+Math.cos(a)*rad*k),q.setFromEuler(e.set(j*.3,i*.17,j*.2)),s.set((1100+j%2*300)*k,(1050+j%3*220)*k,(1100+j%3*170)*k)));
      crown.setColorAt(i*7+j,col.setHSL(.24+(i%4)*.008,.38+(j%3)*.04,.055+(j%4)*.013));
    }
  });
  for(const [o,name] of [[trunk,'tree trunks'],[branches,'tree branches'],[crown,'tree foliage clusters']]){o.name=name;o.castShadow=o.receiveShadow=true;parent.add(o);}
}

export function buildingDetails(parent,b,i){
  const [x,z,w,d,h]=b,stone=new THREE.MeshStandardMaterial({color:[0xb1aaa0,0x9dabae,0xc2b6a0,0xaaa89e][i%4],roughness:.9});
  const trim=new THREE.MeshStandardMaterial({color:0x666e70,roughness:.7,metalness:.15});
  const floors=Math.floor(h/3200);
  for(let j=1;j<floors;j++){
    block(parent,[w+100,100,d+100],[x,j*3200,z],stone).name='building floor band';
    if(j%3===1)for(let k=0;k<Math.floor(w/7000);k++){
      const bx=x-w/2+3500+k*7000;
      block(parent,[2300,150,700],[bx,j*3200+80,z+d/2+350],stone).name='building balcony slab';
      block(parent,[2300,750,50],[bx,j*3200+530,z+d/2+675],trim).name='building balcony rail';
    }
  }
  // 屋頂機房、女兒牆與分段立面，避免相同窗格的單一長方體。
  block(parent,[w*.23,1900,d*.28],[x-w*.18,h+950,z],stone).name='building roof service';
  for(const dx of [-w/2+100,w/2-100])block(parent,[180,h,100],[x+dx,h/2,z+d/2+50],stone).name='building facade pier';
  block(parent,[w+100,700,120],[x,h+350,z+d/2],stone).name='building roof edge';
}

export function pavingDetails(parent,site,M){
  const L=site.lot,E=site.entrance,mat=new THREE.MeshStandardMaterial({color:0x343b3d,roughness:.85});
  const g=new THREE.Group();g.name='surface fixtures';parent.add(g);
  // 溝蓋以間隔格柵呈現，與地面保留高度差避免重合面。
  const width=E.lane[1]-E.lane[0],n=Math.floor(width/90);
  block(g,[width,18,340],[(E.lane[0]+E.lane[1])/2,11,E.zStreet-350],M.cabinetDark).name='entrance drainage channel';
  const bars=new THREE.InstancedMesh(new THREE.BoxGeometry(24,20,320),M.galv,n),m=new THREE.Matrix4();
  for(let j=0;j<n;j++)bars.setMatrixAt(j,m.makeTranslation(E.lane[0]+45+j*90,25,E.zStreet-350));g.add(bars);bars.name='drain grate';
  const stops=new THREE.InstancedMesh(new THREE.BoxGeometry(1500,100,150),M.concrete,L.stalls.length);
  L.stalls.forEach((s,i)=>stops.setMatrixAt(i,m.makeTranslation(s.x,50,s.z+s.dir*2320)));stops.name='wheel stops';stops.castShadow=stops.receiveShadow=true;g.add(stops);
  // 設備區的伸縮縫與小型檢修蓋，不更動設備的配置。
  const Y=site.yard;
  for(let x=Y.x0+2800;x<Y.x1;x+=3000)block(g,[8,4,Y.z1-Y.z0],[x,13,(Y.z0+Y.z1)/2],mat).name='yard expansion joint';
  for(const x of [L.west.xc,L.east.xc]){
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(310,310,15,24),mat);cap.position.set(x,10,L.z1-2100);cap.name='utility cover';g.add(cap);
  }
}
