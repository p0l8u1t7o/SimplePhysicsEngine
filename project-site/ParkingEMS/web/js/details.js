// 既有排程上的顯示細節。人物為姿勢示意，光束／箭頭為 fx；其餘網格照常檢查。
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { liveScreen } from '@core/models/equipment.js';
import { M } from './models.js';
import { CAR } from './sites.js';
import { sampleInteraction,createInteractionSample } from './customer-motion.js';
import { createChargingCable } from './charging-cable.js';
import { createOperator } from './operator.js';
import { clamp, transactionAt, displaySoc } from './detail-state.js';

const group = (parent, name) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
const v = a => new THREE.Vector3(...a);

export function createDetails({ scene, site, seq, hero, chargers, cableOf, lot, flows, carport }) {
  const root = group(scene, 'animation details'), H = seq.hero;
  const driver = createOperator(root, 'driver pose proxy');
  const ch=chargers.find(k=>k.c.id===H.chId);
  const {side,yaw:carYaw,door,port,portStand,out,pick}=H.interaction.g;
  const gun = group(root, 'customer charging connector');
  block(gun, [90, 90, 220], [0, 0, 0], M.cabinetDark).name = 'connector body';
  block(gun, [60, 140, 65], [0, -105, 40], M.accent).name = 'connector handle';
  // 槍口留接合間距；線纜從底部出線，沿向下彎曲的路徑接到槍把尾端。
  const gunEnd = port.clone().add(v([0, 0, side * 126]).applyAxisAngle(new THREE.Vector3(0, 1, 0), carYaw));
  const flexibleCable=createChargingCable(root,M.cableBlack);
  const cableAnchor=out.clone().add(new THREE.Vector3(0,-400,0));
  const approach=gunEnd.clone().add(v([0,0,side*300]).applyAxisAngle(new THREE.Vector3(0,1,0),carYaw));
  const chargerNormal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),ch.pose.yaw);
  const dock=out.clone().addScaledVector(chargerNormal,126),extracted=dock.clone().addScaledVector(chargerNormal,240);
  const grip=new THREE.Vector3(),tail=new THREE.Vector3(),carried=new THREE.Vector3();
  const motionSample=createInteractionSample(),facingSample=createInteractionSample();

  const arrowGroups = flows.map(f => {
    const g = group(root, `power arrows ${f.r.id}`); g.userData.fx = true;
    const mat = new THREE.MeshBasicMaterial({ color: f.r.color, transparent: true, opacity: .8, depthWrite: false });
    const arrows = Array.from({length: 5}, () => { const m = new THREE.Mesh(new THREE.ConeGeometry(115, 360, 5), mat); g.add(m); return m; });
    return { f, g, mat, arrows, curve: f.mesh.geometry.parameters.path };
  });
  const scans = [lot.gate.lprIn, lot.gate.lprOut].map((lpr, i) => {
    const g = group(root, `lpr scan ${i}`); g.userData.fx = true;
    const mat = new THREE.MeshBasicMaterial({color:0x70edff, transparent:true, opacity:.12, side:THREE.DoubleSide, depthWrite:false});
    const m = new THREE.Mesh(new THREE.ConeGeometry(450, 1, 4, 1, true), mat); g.add(m); return {g,m,lpr};
  });
  const beams = group(hero.root, 'headlight beams'); beams.userData.fx = true;
  for (const s of [-1,1]) {
    const geo = new THREE.ConeGeometry(1000, 6500, 12, 1, true); geo.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0xffe9b2, transparent:true, opacity:.055, depthWrite:false, side:THREE.DoubleSide}));
    m.position.set(CAR.len / 2 + 3250, 420, s * 620); m.scale.y = .22; beams.add(m);
  }
  // 少量無陰影投射燈：避免每根燈桿都增加一個逐像素光源。
  const spots = [];
  const nearest=p=>lot.lights.reduce((best,l)=>l.root.position.distanceToSquared(p)<best.root.position.distanceToSquared(p)?l:best,lot.lights[0]);
  const entrance=new THREE.Vector3((site.entrance.lane[0]+site.entrance.lane[1])/2,0,site.entrance.zGate);
  const selected=new Set([nearest(portStand),nearest(entrance),nearest(new THREE.Vector3(site.ems.x,0,site.ems.z)),lot.lights[0],lot.lights.at(-1)]);
  for (const light of selected) {
    const s = new THREE.SpotLight(0xffe7b8, 0, 26000, 1.18, .7, 0); s.position.set(1000, 6840, 0); s.target.position.set(1000, 0, 0); light.root.add(s, s.target); spots.push(s);
  }
  const ledMat = M.lamp.clone();
  if (carport) {
    carport.beams.forEach((b, i) => {
      block(b, [1100, 35, 100], [950, site.carport.colH - 80, 1100], ledMat).name = 'canopy led';
      if (i === 3) { const s = new THREE.SpotLight(0xe0edff, 0, 16000, 1.05, .8, 0); s.position.set(950, site.carport.colH - 110, 1100); s.target.position.set(950, 0, 1100); b.add(s, s.target); spots.push(s); }
    });
  }
  // 三行數值牌集中於能源區上方；只在全天調度、客戶情境與擴充後調度顯示。
  const board = liveScreen(3900, 1450, 780, 290); board.mesh.name = 'energy live board'; root.add(board.mesh);
  board.mesh.position.set((site.yard.x0 + site.yard.x1) / 2+1000, 4500, site.yard.z0+1000);
  if(site.id==='urban'){board.mesh.position.y=3500;board.mesh.scale.setScalar(.75);}
  board.mesh.rotation.set(-.28,.6,0);
  board.mesh.userData.fx = true;
  const settlement = liveScreen(900, 480, 600, 320); settlement.mesh.name = 'exit settlement display';
  settlement.mesh.position.set(0, 1300, -62); settlement.mesh.rotation.y = Math.PI; lot.gate.lprOut.root.add(settlement.mesh);
  const settlementText = t => t >= H.unplugT && t <= H.t1 ? '停車＋充電合併結算 ✓' : '停車／充電服務';
  function bill(screen, t) {
    const text = settlementText(t);
    screen.draw(text, (c,w,h) => {
      c.fillStyle = '#102f39'; c.fillRect(0,0,w,h); c.textAlign = 'center'; c.fillStyle = '#d6ffe5';
      c.font = `bold ${w * .07}px sans-serif`; c.fillText(text, w/2,h*.34);
      c.font = `${w*.048}px sans-serif`; c.fillText('EVA-0588（示意）',w/2,h*.59); c.fillText('金額：示意',w/2,h*.8);
    });
  }
  const up = new THREE.Vector3(0,1,0), a = new THREE.Vector3(), b = new THREE.Vector3();
  let state = {};
  function apply(t, h, energy, S, day) {
    const session = S.sessionAt(h)[H.chId], motion=sampleInteraction(H,t,motionSample);
    const {phase}=motion;
    driver.root.visible=hero.root.visible&&motion.visible;
    driver.root.position.copy(motion.position);
    // 將轉身分散在 0.9 秒內；角度逐段展開，避免跨過正負 π 時跳向。
    let angle=0,previous=0,sum=0,weight=0;
    for(let i=0;i<=40;i++){
      const s=sampleInteraction(H,t+(i/40-.5)*.9,facingSample),raw=Math.atan2(s.look.x-s.position.x,s.look.z-s.position.z);
      angle=i?angle+Math.atan2(Math.sin(raw-previous),Math.cos(raw-previous)):raw;previous=raw;
      const w=1-Math.abs(i/20-1);sum+=angle*w;weight+=w;
    }
    driver.root.rotation.y=sum/weight;
    driver.pose(t,motion.walk,motion.handling?.8:0);
    const crouch=168*Math.max(Math.min(clamp((t-H.plugT+1.1)/.5),clamp((H.plugT+1.5-t)/.4)),Math.min(clamp((t-H.unplugT+1.1)/.5),clamp((H.unplugT+.7-t)/.7)));
    driver.root.position.y-=crouch;
    if(crouch>0)driver.legs.forEach(l=>{l.rotation.x=-.62*crouch/168;l.joint.rotation.x=1.24*crouch/168;});
    if(motion.seated>0){driver.root.rotation.z=-.28*motion.seated;driver.legs.forEach(l=>{l.rotation.x=-1.1*motion.seated;l.joint.rotation.x=1.4*motion.seated;});}
    else driver.root.rotation.z=0;
    hero.setDoor(side,hero.root.visible?motion.door:0);
    carried.set(0,1000,200);driver.root.updateWorldMatrix(true,false);driver.root.localToWorld(carried);
    gun.visible=hero.root.visible;
    gun.position.copy(motion.connected?gunEnd:motion.carry?carried:dock);
    gun.rotation.set(0,motion.connected||motion.carry?carYaw+(side>0?0:Math.PI):ch.pose.yaw,0);
    if(phase==='take connector'||phase==='holster connector'){
      const u=phase==='take connector'?motion.gunU:1-motion.gunU;
      gun.position.copy(u<.5?dock:extracted).lerp(u<.5?extracted:carried,u<.5?u*2:(u-.5)*2);
      const targetYaw=carYaw+(side>0?0:Math.PI),delta=Math.atan2(Math.sin(targetYaw-ch.pose.yaw),Math.cos(targetYaw-ch.pose.yaw));
      gun.rotation.y=ch.pose.yaw+delta*Math.max(0,(u-.5)*2);
    }
    if(phase==='insert connector')gun.position.copy(motion.gunU<.4?carried:approach).lerp(motion.gunU<.4?approach:gunEnd,motion.gunU<.4?motion.gunU/.4:(motion.gunU-.4)/.6);
    if(phase==='withdraw connector')gun.position.copy(motion.gunU<.5?gunEnd:approach).lerp(motion.gunU<.5?approach:carried,motion.gunU<.5?motion.gunU*2:(motion.gunU-.5)*2);
    if(driver.root.visible&&gun.visible&&(motion.carry||motion.handling)){
      grip.copy(gun.position);grip.y-=110;driver.reachTo(grip);
    }
    tail.set(0,-194,40).applyEuler(gun.rotation).add(gun.position);
    flexibleCable.set(cableAnchor,tail,gun.visible);
    if(ch.m.coil)ch.m.coil.visible=!gun.visible;
    if(hero.root.visible)cableOf[H.chId].mesh.visible=false;
    beams.visible = hero.root.visible && !!hero.root.userData.headlights;
    for (const {g,m,lpr} of scans) {
      const win = lpr === lot.gate.lprIn ? H.gates.lprIn : H.gates.lprOut;
      g.visible = t >= win[0] && t < win[1];
      a.set(0,1660,365); lpr.root.localToWorld(a);
      b.copy(hero.plate.getWorldPosition(new THREE.Vector3()));
      m.position.copy(a).lerp(b,.5); m.scale.y = a.distanceTo(b); m.quaternion.setFromUnitVectors(up,a.clone().sub(b).normalize());
    }
    const operation = t >= seq.dayStart && (t <= H.t1 || (seq.hourMap.some(s => s.expanded && t >= s.t0 && t <= s.t1)));
    for (const {f,g,mat,arrows,curve} of arrowGroups) {
      const p = f.power ?? 0; g.visible = operation && f.mesh.visible && Math.abs(p) > .3;
      mat.opacity = Math.min(.95,.3+Math.abs(p)/80);
      for (let i=0;i<arrows.length;i++) {
        const u = ((i/arrows.length + t*(.035+Math.min(100,Math.abs(p))*.0007)*(p>=0?1:-1))%1+1)%1;
        curve.getPointAt(u,a); arrows[i].position.copy(a); arrows[i].position.y+=180;
        curve.getTangentAt(u,b).multiplyScalar(p>=0?1:-1); arrows[i].quaternion.setFromUnitVectors(up,b.normalize());
      }
    }
    for (const s of spots) s.intensity = (1-day)*5.5;
    ledMat.emissiveIntensity=(1-day)*2.8;
    board.mesh.visible = operation;
    const power = energy.dis-energy.chg;
    board.draw(`${Math.round(energy.pv)}|${Math.round(power)}|${Math.round(energy.soc*100)}|${Math.round(energy.grid)}`, (c,w,hh) => {
      c.fillStyle='#0c2433'; c.fillRect(0,0,w,hh); c.textAlign='left'; c.font='bold 46px sans-serif';
      c.fillStyle='#ffe070'; c.fillText(`光電 ${energy.pv.toFixed(0)} kW${site.pv?'':'（未建置）'}`,28,67);
      c.fillStyle='#76edb5'; c.fillText(`儲能 ${power>=0?'+':''}${power.toFixed(0)} kW · SOC ${Math.round(energy.soc*100)}%`,28,143);
      c.fillStyle='#83c7ff'; c.fillText(`市電 ${energy.grid.toFixed(0)} kW`,28,219);
      c.font='24px sans-serif'; c.fillStyle='#c4d8de'; c.fillText('功率與 SOC：EMS 模型示意　儲能 + 放電／− 充電',28,269);
    });
    bill(lot.gate.kiosk.screen,t); bill(settlement,t);
    state = { transaction:transactionAt(H,t,session), driverVisible:driver.root.visible, connectorVisible:gun.visible, settlement:settlementText(t), soc:displaySoc(session?.got||0), phase, door:motion.door, connected:motion.connected };
  }
  return {root,driver,gun,flexibleCable,port,portStand,pick,side,spots,scans,arrowGroups,board,apply,get state(){return state;}};
}
