// 操作連續性、固定骨長、槍線端點與車輛互鎖；人體仍是姿勢代理，非人體碰撞驗證。
import '@core/verify/dom-stub.mjs';
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {createProject} from '../web/js/project.js';
import {SITE_IDS} from '../web/js/sites.js';
import {sampleInteraction} from '../web/js/customer-motion.js';

const failures=[],sites={};let assertions=0;
const check=(ok,message)=>{assertions++;if(!ok)failures.push(message);};
for(const id of SITE_IDS){
  const scene=new THREE.Scene(),p=createProject({scene,site:id}),H=p.seq.hero,D=p.details;
  const r={samples:0,handErrorMm:0,connectorSpeedMmS:0,cableEndpointErrorMm:0,cableMinHeightMm:Infinity,armScaleError:0,stationaryErrorMm:0};
  const dt=.025,hand=new THREE.Vector3(),tail=new THREE.Vector3(),park=new THREE.Vector3(H.ch.stall.x,0,H.ch.stall.z);
  let previous=null,prevHeld=false;
  for(let t=H.tPark;t<H.revT0;t+=dt){
    p.apply(t);scene.updateMatrixWorld(true);r.samples++;
    const m=sampleInteraction(H,t),held=m.visible&&(m.carry||m.handling);
    if(held){
      r.handErrorMm=Math.max(r.handErrorMm,D.driver.hand.getWorldPosition(hand).distanceTo(D.gun.position.clone().add(new THREE.Vector3(0,-110,0))));
      if(previous&&prevHeld)r.connectorSpeedMmS=Math.max(r.connectorSpeedMmS,previous.distanceTo(D.gun.position)/dt);
    }
    for(const arm of D.driver.arms)r.armScaleError=Math.max(r.armScaleError,arm.scale.distanceTo(new THREE.Vector3(1,1,1)),Math.abs(arm.joint.position.length()-340));
    tail.set(0,-194,40).applyEuler(D.gun.rotation).add(D.gun.position);
    const c=D.flexibleCable;r.cableEndpointErrorMm=Math.max(r.cableEndpointErrorMm,c.points[0].distanceTo(c.start),c.points.at(-1).distanceTo(tail));
    r.cableMinHeightMm=Math.min(r.cableMinHeightMm,...c.points.map(v=>v.y));
    r.stationaryErrorMm=Math.max(r.stationaryErrorMm,p.hero.root.position.distanceTo(park));
    previous=D.gun.position.clone();prevHeld=held;
  }
  check(r.handErrorMm<1,`${id}: hand contact within 1 mm`);
  check(r.connectorSpeedMmS<2500,`${id}: connector movement under 2.5 m/s`);
  check(r.cableEndpointErrorMm<.001,`${id}: cable anchored at both ends`);
  check(r.cableMinHeightMm>=70,`${id}: cable above ground`);
  check(r.armScaleError<1e-9,`${id}: fixed arm lengths`);
  check(r.stationaryErrorMm<.001,`${id}: car stationary during operation`);
  p.apply(H.plugT+1);
  check(p.presentation.hero.p===0&&p.presentation.hero.kwh===0,`${id}: no power before authorization completes`);
  p.apply(H.revT0+.01);
  check(!D.driver.root.visible&&!D.state.connected&&D.state.door===0,`${id}: driver seated, door closed and unplugged before reversing`);
  check(p.hero.lids.every(l=>l.rotation.x===0),`${id}: port lid closed before departure`);
  // 事件邊界兩側直接 seek，再倒序取樣，避免只驗證連續播放。
  const times=[H.tPark,H.plugT,H.plugT+1.1,H.leaveStart,H.unplugT,H.unplugT+.7,H.revT0].flatMap(t=>[t-.001,t,t+.001]);
  const snapshot=t=>{p.apply(t);scene.updateMatrixWorld(true);return JSON.stringify({phase:D.state.phase,door:D.state.door,gun:D.gun.matrixWorld.toArray(),hand:D.driver.hand.matrixWorld.toArray(),cable:D.flexibleCable.points.map(v=>v.toArray())});};
  const forward=times.map(snapshot);check(times.slice().reverse().every((t,i)=>snapshot(t)===forward[times.length-1-i]),`${id}: boundary seek deterministic`);
  sites[id]=r;
}
const result={ok:failures.length===0,assertions,sites,failures};
writeFileSync(new URL('../review/render-realism.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(!result.ok)process.exit(1);
