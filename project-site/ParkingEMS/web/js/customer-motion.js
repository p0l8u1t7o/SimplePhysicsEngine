// 顧客操作使用動畫秒；行走 1.05 m/s 是展示假設。EMS 的一天時鐘由 sequence 另行對應。
import * as THREE from 'three';
import { CAR, chargerPose } from './sites.js';
import { clamp } from './detail-state.js';

export function interactionGeometry(site,ch){
  const yaw=-Math.atan2(ch.stall.dir,0),car=new THREE.Matrix4().makeRotationY(yaw).setPosition(ch.stall.x,0,ch.stall.z);
  const pose=chargerPose(site,ch),base=new THREE.Matrix4().makeRotationY(pose.yaw).setPosition(pose.x,pose.y,pose.z);
  const out=new THREE.Vector3(ch.type==='DC'?410:0,ch.type==='DC'?1200:1130,ch.type==='DC'?200:ch.mount==='column'?202:190).applyMatrix4(base);
  const local=(x,y,z)=>new THREE.Vector3(x,y,z).applyMatrix4(car);
  const side=local(1600,760,914).distanceTo(out)<local(1600,760,-914).distanceTo(out)?1:-1;
  const port=local(CAR.len/2-650,760,side*(CAR.w/2+4));
  const portStand=local(1600,0,side*1360),door=local(-180,0,side*1360);
  const pick=out.clone().add(new THREE.Vector3(0,0,ch.type==='DC'?700:590).applyAxisAngle(new THREE.Vector3(0,1,0),pose.yaw));pick.y=pose.y;
  // 充電樁在車頭外側；路徑保持在車側，避免直線穿過車身。
  const corner=local(2050,0,side*1360);
  return {yaw,pose,side,out,port,portStand,door,pick,corner,car,seat:local(-180,400,side*500)};
}

export function planInteraction(site,ch){
  const g=interactionGeometry(site,ch),speed=1050;
  const takePath=[g.door,g.corner,g.pick],carryPath=[g.pick,g.corner,g.portStand];
  const length=pts=>pts.slice(1).reduce((a,p,i)=>a+p.distanceTo(pts[i]),0);
  const take=length(takePath)/speed,carry=length(carryPath)/speed;
  const walkBack=g.portStand.distanceTo(g.door)/speed;
  const plugOffset=2.6+take+1.1+carry+1.1;
  const connectDuration=plugOffset+1.1+walkBack+2.6;
  const unplugOffset=2.6+walkBack+1.1;
  const returnOffset=unplugOffset+.7+carry+1.1;
  const leaveDuration=returnOffset+take+2.6;
  return {g,takePath,carryPath,returnCarryPath:[...carryPath].reverse(),returnTakePath:[...takePath].reverse(),walkToDoor:[g.portStand,g.door],walkToPort:[g.door,g.portStand],take,carry,walkBack,plugOffset,connectDuration,unplugOffset,returnOffset,leaveDuration};
}

export function pointAlong(points,u,target){
  let total=0;for(let i=1;i<points.length;i++)total+=points[i].distanceTo(points[i-1]);
  let distance=clamp(u)*total;
  for(let i=1;i<points.length;i++){const len=points[i].distanceTo(points[i-1]);if(distance<=len||i===points.length-1)return target.copy(points[i-1]).lerp(points[i],len?distance/len:0);distance-=len;}
  return target.copy(points[0]);
}

export const createInteractionSample=()=>({position:new THREE.Vector3(),look:new THREE.Vector3()});

export function sampleInteraction(H,t,state=createInteractionSample()){
  const I=H.interaction,g=I.g,position=state.position.copy(g.door),look=state.look.copy(g.pick);
  let visible=false,walk=0,door=0,carry=false,handling=false,seated=0,gunU=0,phase='seated';
  const connected=t>=H.plugT&&t<H.unplugT;
  const open=(u)=>Math.sin(Math.PI*clamp(u));
  const travel=(points,u)=>{pointAlong(points,u,position);pointAlong(points,Math.min(1,u+.02),look);if(look.distanceToSquared(position)<1)look.copy(position).add(points.at(-1)).sub(points.at(-2));walk=1;visible=true;};
  const connection=t>=H.tPark&&t<H.tPark+I.connectDuration;
  const departure=t>=H.leaveStart&&t<H.revT0;
  if(connection){
    const q=t-H.tPark;
    if(q<2.6){phase='exit';door=open(q/2.6);visible=q>.55;seated=1-clamp((q-.55)/1.5);position.lerp(g.seat,seated);look.copy(g.door);}
    else if(q<2.6+I.take){phase='walk to charger';travel(I.takePath,(q-2.6)/I.take);}
    else if(q<3.7+I.take){phase='take connector';visible=true;position.copy(g.pick);look.copy(g.out);handling=true;carry=true;gunU=clamp((q-2.6-I.take)/1.1);}
    else if(t<H.plugT-1.1){phase='carry connector';travel(I.carryPath,(q-3.7-I.take)/I.carry);carry=true;}
    else if(t<H.plugT){phase='insert connector';visible=true;position.copy(g.portStand);look.copy(g.port);handling=true;carry=true;gunU=clamp((t-H.plugT+1.1)/1.1);}
    else if(t<H.plugT+1.1){phase='authorize';visible=true;position.copy(g.portStand);look.copy(g.port);handling=true;}
    else if(t<H.plugT+1.1+I.walkBack){phase='return to car';travel(I.walkToDoor,(t-H.plugT-1.1)/I.walkBack);}
    else {phase='enter';const u=(t-H.plugT-1.1-I.walkBack)/2.6;door=open(u);visible=u<.8;seated=clamp(u/.8);position.lerp(g.seat,seated);look.copy(g.portStand);}
  }else if(departure){
    const q=t-H.leaveStart;
    if(q<2.6){phase='exit';door=open(q/2.6);visible=q>.55;seated=1-clamp((q-.55)/1.5);position.lerp(g.seat,seated);look.copy(g.door);}
    else if(q<2.6+I.walkBack){phase='walk to port';travel(I.walkToPort,(q-2.6)/I.walkBack);}
    else if(t<H.unplugT){phase='remove connector';visible=true;position.copy(g.portStand);look.copy(g.port);handling=true;}
    else if(t<H.unplugT+.7){phase='withdraw connector';visible=true;position.copy(g.portStand);look.copy(g.port);handling=true;carry=true;gunU=(t-H.unplugT)/.7;}
    else if(q<I.returnOffset-1.1){phase='return connector';travel(I.returnCarryPath,(t-H.unplugT-.7)/I.carry);carry=true;}
    else if(q<I.returnOffset){phase='holster connector';visible=true;position.copy(g.pick);look.copy(g.out);handling=true;carry=true;gunU=clamp((q-I.returnOffset+1.1)/1.1);}
    else if(q<I.returnOffset+I.take){phase='return to car';travel(I.returnTakePath,(q-I.returnOffset)/I.take);}
    else {phase='enter';const u=(q-I.returnOffset-I.take)/2.6;door=open(u);visible=u<.8;seated=clamp(u/.8);position.lerp(g.seat,seated);look.copy(g.portStand);}
  }
  state.visible=visible;state.walk=walk;state.door=door;state.carry=carry;state.handling=handling;state.seated=seated;state.gunU=gunU;state.phase=phase;state.connected=connected;return state;
}
