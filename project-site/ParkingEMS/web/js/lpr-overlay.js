// 車牌框由 3D 車牌四角投影而來；僅在既有入口補光時段出現，非辨識結果。
import * as THREE from 'three';

export function projectPlate(plate, camera, width, height, scene = null) {
  plate.updateWorldMatrix(true,false); camera.updateMatrixWorld(true);
  const center=plate.getWorldPosition(new THREE.Vector3()),eye=camera.getWorldPosition(new THREE.Vector3());
  const normal=new THREE.Vector3(0,0,1).transformDirection(plate.matrixWorld);
  if(normal.dot(eye.clone().sub(center))<=0)return null;
  if(scene) {
    const dir=center.clone().sub(eye),distance=dir.length();
    const ray=new THREE.Raycaster(eye,dir.normalize(),camera.near,distance-2);
    const blocker=ray.intersectObjects(scene.children,true).find(hit=>{
      if(hit.object===plate)return false;
      for(let o=hit.object;o;o=o.parent)if(!o.visible||o.userData.fx||o.userData.operatorProxy)return false;
      return true;
    });
    if(blocker)return null;
  }
  const points = [[-260,-65],[260,-65],[260,65],[-260,65]].map(([x,y]) => {
    const p = plate.localToWorld(new THREE.Vector3(x,y,0)).project(camera);
    return {x:(p.x+1)*width/2,y:(1-p.y)*height/2,z:p.z};
  });
  if(points.some(p=>p.z < -1 || p.z > 1)) return null;
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  const w=Math.max(...points.map(p=>p.x))-x,h=Math.max(...points.map(p=>p.y))-y;
  return x+w<0||x>width||y+h<0||y>height ? null : {x,y,w,h};
}

export function createLprOverlay(project) {
  const host=document.createElement('div'), canvas=document.createElement('canvas');
  host.style.cssText='inset:0;pointer-events:none;width:100%;height:100%'; host.append(canvas);
  canvas.style.cssText='width:100%;height:100%;display:block';
  return {host,hide(){host.hidden=true;},draw(camera,rect,{time}) {
    host.hidden=false; const w=Math.round(rect.width),h=Math.round(rect.height);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const c=canvas.getContext('2d'); c.clearRect(0,0,w,h);
    const [t0,t1]=project.seq.hero.gates.lprIn;
    c.fillStyle='rgba(6,24,32,.78)';c.fillRect(0,0,w,28);c.fillStyle='#d4f3fb';c.font='12px sans-serif';c.fillText('入口虛擬影像 · 幾何投影示意',10,19);
    if(time<t0||time>=t1||!project.hero.root.visible) return;
    const box=projectPlate(project.hero.plate,camera,w,h,project.hero.root.parent.parent);if(!box)return;
    c.strokeStyle='#5affce';c.lineWidth=2;c.strokeRect(box.x-4,box.y-4,box.w+8,box.h+8);
    const x=Math.max(5,Math.min(w-158,box.x)),y=Math.max(45,box.y-12);
    c.fillStyle='#07382f';c.fillRect(x-3,y-17,158,23);c.fillStyle='#83ffdc';c.fillText('EVA-0588（示意）',x,y);
  }};
}
