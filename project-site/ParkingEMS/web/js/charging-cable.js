// 固定數目的線段取樣柔性槍線；所有變形都寫進物件矩陣，讓決定性與場景檢查可取樣。
import * as THREE from 'three';

export function createChargingCable(parent,material){
  const root=new THREE.Group();root.name='ev cable customer';parent.add(root);
  const count=24,geo=new THREE.CylinderGeometry(16,16,1,8);
  const segments=Array.from({length:count},(_,i)=>{const m=new THREE.Mesh(geo,material);m.name=i===count-1?'connector cable end':'charging cable segment';m.castShadow=true;root.add(m);return m;});
  const up=new THREE.Vector3(0,1,0),a=new THREE.Vector3(),b=new THREE.Vector3(),d=new THREE.Vector3();
  const points=Array.from({length:count+1},()=>new THREE.Vector3());
  const start=new THREE.Vector3(),end=new THREE.Vector3();
  return {root,segments,points,start,end,set(from,to,visible){
    root.visible=visible;start.copy(from);end.copy(to);
    // 使用下垂曲線且全線離地至少 70 mm，未做繩索動力學或線長可達認證。
    const low=Math.max(70,Math.min(from.y,to.y)-650);
    for(let i=0;i<=count;i++){
      const u=i/count,v=1-u;
      points[i].copy(from).multiplyScalar(v*v*v).addScaledVector(to,u*u*u);
      points[i].x+=3*v*v*u*from.x+3*v*u*u*to.x;
      points[i].z+=3*v*v*u*from.z+3*v*u*u*to.z;
      points[i].y+=3*v*v*u*low+3*v*u*u*low;
    }
    for(let i=0;i<count;i++){a.copy(points[i]);b.copy(points[i+1]);d.copy(b).sub(a);const m=segments[i];m.position.copy(a).add(b).multiplyScalar(.5);m.scale.y=d.length();m.quaternion.setFromUnitVectors(up,d.normalize());}
  }};
}
