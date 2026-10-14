// 既有排程上的顯示細節。人物為姿勢示意，光束／箭頭為 fx；其餘網格照常檢查。
import * as THREE from 'three';
import { block, cylinder } from '@core/geom/shapes.js';
import { liveScreen } from '@core/models/equipment.js';
import { M } from './models.js';
import { CAR } from './sites.js';
import { createOperator } from './operator.js';
import { clamp, transactionAt, displaySoc } from './detail-state.js';

const group = (parent, name) => { const g = new THREE.Group(); g.name = name; parent.add(g); return g; };
const v = a => new THREE.Vector3(...a);

export function createDetails({ scene, site, seq, hero, chargers, cableOf, lot, flows, carport }) {
  const root = group(scene, 'animation details'), H = seq.hero;
  const driver = createOperator(root, 'driver pose proxy');
  const ch = chargers.find(k => k.c.id === H.chId), side = cableOf[H.chId].side;
  const carYaw = -Math.atan2(H.ch.stall.dir, 0);
  const parked = new THREE.Matrix4().makeRotationY(carYaw).setPosition(H.ch.stall.x, 0, H.ch.stall.z);
  const door = v([200, 0, side * 1250]).applyMatrix4(parked);
  const port = v([CAR.len / 2 - 650, 760, side * (CAR.w / 2 + 4)]).applyMatrix4(parked);
  const portStand = v([CAR.len / 2 - 650, 0, side * 1420]).applyMatrix4(parked);
  const out = ch.m.outlet.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(ch.pose.yaw).setPosition(ch.pose.x, ch.pose.y, ch.pose.z));
  const pick = out.clone(); pick.y = 0; pick.add(v([0, 0, 650]).applyAxisAngle(new THREE.Vector3(0, 1, 0), ch.pose.yaw));
  const gun = group(root, 'customer charging connector');
  block(gun, [90, 90, 220], [0, 0, 0], M.cabinetDark).name = 'connector body';
  block(gun, [60, 140, 65], [0, -105, 40], M.accent).name = 'connector handle';
  // 連接器與車口留 8 mm，避免以穿插表示接合；纜線仍沿原有路徑。
  const gunEnd = port.clone().add(v([0, 0, side * 126]).applyAxisAngle(new THREE.Vector3(0, 1, 0), carYaw));

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
  for (const light of lot.lights.filter((_,i) => i % Math.max(1, Math.ceil(lot.lights.length / 2)) === 0).slice(0,2)) {
    const s = new THREE.SpotLight(0xffe7b8, 0, 18000, .85, .7, 0); s.position.set(1000, 6840, 0); s.target.position.set(1000, 0, 0); light.root.add(s, s.target); spots.push(s);
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
  board.mesh.position.set((site.yard.x0 + site.yard.x1) / 2, 5300, site.yard.z1);
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
    const session = S.sessionAt(h)[H.chId], active = t >= H.tPark && t < H.revT0;
    const beforePlug = t < H.plugT, afterPlug = t >= H.plugT && t < H.plugT + 1.1;
    const returning = t >= H.unplugT - .6;
    driver.root.visible = active && (beforePlug || afterPlug || returning);
    let walk = 0, reach = 0;
    if (beforePlug) {
      const u = clamp((t-H.tPark)/(H.plugT-H.tPark));
      if (u < .4) { a.copy(door).lerp(pick,u/.4); b.copy(pick); walk=1; }
      else { a.copy(pick).lerp(portStand,(u-.4)/.6); b.copy(port); walk=1; reach=.8; }
    } else if (afterPlug) { const u=clamp((t-H.plugT)/1.1); a.copy(portStand).lerp(door,u); b.copy(door); walk=1; reach=1-u; }
    else if (returning) {
      const u = clamp((t-(H.unplugT-.6))/(H.revT0-H.unplugT+.6));
      if(t < H.unplugT) { a.copy(door).lerp(portStand,clamp((t-H.unplugT+.6)/.6)); b.copy(port); walk=1; reach=1; }
      else { a.copy(portStand).lerp(door,clamp((t-H.unplugT)/(H.revT0-H.unplugT))); b.copy(door); walk=1; reach=1-u; }
    } else { a.copy(door); b.copy(pick); }
    driver.root.position.copy(a); driver.root.rotation.y = Math.atan2(b.x-a.x,b.z-a.z); driver.pose(t,walk,reach);
    const carry = beforePlug && t >= H.tPark + .4*(H.plugT-H.tPark);
    const takingBack = t>=H.unplugT&&t<H.revT0;
    gun.visible = active && (carry || (t >= H.plugT && t < H.unplugT) || takingBack);
    const carryU = clamp((t-H.tPark-.4*(H.plugT-H.tPark))/(.6*(H.plugT-H.tPark)));
    gun.position.copy(out).lerp(gunEnd, carry ? carryU : 1); gun.rotation.set(0,carYaw + (side > 0 ? 0 : Math.PI),0);
    if(carry)gun.position.y+=Math.sin(Math.PI*carryU)*700;
    if(takingBack) {
      const u=clamp((t-H.unplugT)/(H.revT0-H.unplugT));
      gun.position.copy(gunEnd).lerp(out,u);gun.position.y+=Math.sin(Math.PI*u)*700;
      driver.root.position.copy(portStand).lerp(pick,u);driver.root.rotation.y=ch.pose.yaw+Math.PI;
    }
    if(driver.root.visible && gun.visible)driver.reachTo(gun.position.clone().add(new THREE.Vector3(0,-110,0)));
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
    for (const s of spots) s.intensity = (1-day)*2.4;
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
    state = { transaction:transactionAt(H,t,session), driverVisible:driver.root.visible, connectorVisible:gun.visible, settlement:settlementText(t), soc:displaySoc(session?.got||0) };
  }
  return {root,driver,gun,port,portStand,pick,side,spots,scans,arrowGroups,board,apply,get state(){return state;}};
}
