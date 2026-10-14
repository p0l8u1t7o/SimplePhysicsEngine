// 新增細節的正序／倒序、操作端點與燈光／能量方向驗證；不取代 scene 與 UI。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {createProject,daylight} from '../web/js/project.js';
import {SITE_IDS,CAR} from '../web/js/sites.js';
import {wheelTravel,transactionAt} from '../web/js/detail-state.js';
import {projectPlate} from '../web/js/lpr-overlay.js';

const failures=[],sites={};let assertions=0;
const check=(ok,msg)=>{assertions++;if(!ok)failures.push(msg);};
for(const id of SITE_IDS) {
  const scene=new THREE.Scene(),p=createProject({scene,site:id}),H=p.seq.hero,D=p.details;
  const times=[0,p.seq.dayStart,p.seq.dayStart+27,H.tPark,H.plugT-.01,H.plugT,H.plugT+.5,H.plugT+1.1,H.unplugT-.01,H.unplugT,H.revT0,H.revT0+.1,H.t1,...H.gates.lprIn,...H.gates.lprOut,...p.constructionDetails.pits.map(x=>x.b.t0-.25),p.constructionDetails.deliveryEnd-.1];
  const snapshot=t=>{
    p.apply(t);scene.updateMatrixWorld(true);
    return JSON.stringify({driver:D.driver.root.matrixWorld.toArray(),hand:D.driver.hand.matrixWorld.toArray(),gun:D.gun.matrixWorld.toArray(),state:D.state,
      head:p.hero.headMat.emissiveIntensity,tail:p.hero.tailMat.emissiveIntensity,reverse:p.hero.reverseMat.emissiveIntensity,
      wheels:p.hero.wheels.map(w=>w.rotation.z),lids:p.hero.lids.map(l=>l.rotation.x),scans:D.scans.map(s=>s.g.visible),lights:D.spots.map(s=>s.intensity),
      arrows:D.arrowGroups.map(a=>[a.g.visible,a.mat.opacity,...a.arrows.map(m=>m.matrixWorld.toArray())]),
      pits:p.constructionDetails.pits.map(x=>[x.g.visible,x.cage.visible]),truck:p.constructionDetails.truck.matrixWorld.toArray()});
  };
  const forward=new Map(times.map(t=>[t,snapshot(t)]));
  for(const t of [...times].reverse())check(snapshot(t)===forward.get(t),`${id} reverse ${t}`);
  p.apply(H.plugT);scene.updateMatrixWorld(true);
  check(D.driver.root.visible&&Math.hypot(D.driver.root.position.x-D.portStand.x,D.driver.root.position.z-D.portStand.z)<1&&D.driver.root.position.y>=-180,`${id} driver at port with crouch`);
  check(D.driver.root.position.distanceTo(D.pick)<3000,`${id} driver near charger`);
  check(D.driver.hand.getWorldPosition(new THREE.Vector3()).distanceTo(D.gun.position.clone().add(new THREE.Vector3(0,-110,0)))<1,`${id} hand follows connector`);
  check(p.hero.lids.some(l=>Math.abs(l.rotation.x)>1),`${id} charge lid open upward`);
  check(D.driver.root.userData.operatorProxy&&p.verify.skip(D.driver.root),`${id} operatorProxy excluded`);
  check(!p.verify.skip(D.gun)&&!D.gun.userData.fx,`${id} connector remains physical`);
  check(transactionAt(H,H.tPark,null)==='確認費率（示意）',`${id} rate confirmation`);
  check(transactionAt(H,H.plugT,null)==='授權',`${id} authorization`);
  check(transactionAt(H,H.plugT+.5,null)==='啟動成功',`${id} start confirmed`);
  check(transactionAt(H,H.unplugT,null)==='完成',`${id} completion`);
  // 獨立依每一腿的弧長與 easing 算轉角；倒車有負位移，停車間隔不多轉。
  let cumulative=0;
  for(const leg of H.legs) {
    const len=((leg.s1??leg.path.length)-(leg.s0??0))*(leg.path.reverse?-1:1);
    const t=(leg.t0+leg.t1)/2,u=.5,e=leg.ease?leg.ease(u):.5;
    p.apply(t);
    check(Math.abs(p.hero.wheels[0].rotation.z+(cumulative+len*e)/CAR.wheelR)<1e-8,`${id} wheel arc length`);
    const night=1-daylight(p.presentation.hour);
    check(p.hero.root.userData.headlights===(night>.5),`${id} night driving lights`);
    check(p.hero.root.userData.reversing===!!leg.path.reverse,`${id} reverse lights`);
    cumulative+=len;
  }
  check(Math.abs(wheelTravel(H.legs,H.t1)-cumulative)<1e-6,`${id} final wheel distance`);
  p.apply(H.gates.lprIn[0]+.1);check(D.scans[0].g.visible,`${id} LPR beam active`);
  p.apply(H.gates.lprIn[1]);check(!D.scans[0].g.visible,`${id} LPR beam end`);
  const camera=new THREE.PerspectiveCamera(50,16/9,10,20000);
  p.apply(H.gates.lprIn[0]+.15);scene.updateMatrixWorld(true);
  const pos=p.hero.plate.getWorldPosition(new THREE.Vector3());camera.position.copy(p.hero.plate.localToWorld(new THREE.Vector3(0,1500,4000)));camera.lookAt(pos);
  const box=projectPlate(p.hero.plate,camera,800,450);check(box&&box.w>0&&box.h>0,`${id} projected plate`);
  p.apply(H.unplugT+.05);check(D.state.settlement==='停車＋充電合併結算 ✓',`${id} combined settlement`);
  p.apply(0);check(!D.board.mesh.visible,`${id} energy board hidden before operation`);
  p.apply(p.seq.dayStart+27);check(D.board.mesh.visible,`${id} energy board shown`);
  for(const a of D.arrowGroups) {
    check(a.g.visible===(a.f.mesh.visible&&Math.abs(a.f.power)>.3),`${id} power arrows ${a.f.r.id}`);
  }
  sites[id]={samples:times.length,lights:D.spots.length,allowRules:p.verify.allow.length,total:p.total};
}
const result={ok:!failures.length,assertions,sites,failures};
writeFileSync(new URL('../review/animation-details.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.ok)process.exit(1);
