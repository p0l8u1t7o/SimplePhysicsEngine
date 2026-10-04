// Run with the selected project's Three.js loader. Tests the rendered routing.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import * as THREE from 'three';
import {sampleTimes} from '../core/verify/clearance.mjs';
import {checkCableScenarios,CABLE_METHOD} from '../core/verify/cables.mjs';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};
const project=process.argv[2],interval=Number(process.env.CABLE_INTERVAL||.1);
const base=new URL('../project-site/'+project+'/web/js/',import.meta.url),imp=name=>import(new URL(name+'.js',base));
const {carrier,routeIntersectsBox,cable}=await import('@core/electrical/cable-routing.js');
// Independent controls: a route's empty bounding-box interior is clear, its
// material span is blocked, and the carrier endpoints obey an absolute stroke.
{
  const s=new THREE.Scene(),r=cable(s,'control',[[0,0,0],[0,100,0],[100,100,0]],{radius:2,clips:0});s.updateMatrixWorld(true);
  assert(!routeIntersectsBox(r.children[0],new THREE.Box3(new THREE.Vector3(48,48,-3),new THREE.Vector3(52,52,3))));
  assert(routeIntersectsBox(r.children[0],new THREE.Box3(new THREE.Vector3(-3,48,-3),new THREE.Vector3(3,52,3))));
  const c=carrier(s,'control carrier',{min:-100,max:100,radius:40});
  for(const x of [-100,-70,0,23,100]){c.set(x);assert(c.at(0).p.distanceTo(new THREE.Vector3(0,0,0))<1e-8);assert(c.at(c.length).p.distanceTo(new THREE.Vector3(x,80,0))<1e-8);}
  assert.throws(()=>c.set(101),/stroke/);
}
const scenarios=[],scene=()=>new THREE.Scene();
const meshList=root=>{const a=[];root.traverse(m=>{if(m.isMesh&&!m.userData.routingHardware&&m.geometry.type!=='PlaneGeometry')a.push(m);});return a;};
if(project==='PCB-CopperAssembly') {
  const {createSim}=await imp('sim'),{RECIPES,setRecipe}=await imp('layout');
  for(const key of Object.keys(RECIPES)) {setRecipe(key);const s=scene(),sim=createSim(s),m=sim.machine;
    const times=new Set(sampleTimes(0,sim.plan.cycle,interval));
    for(const tr of [sim.plan.s0,sim.plan.s4,sim.plan.s1.tr,sim.plan.s3.tr,...Object.values(sim.plan.heads).map(h=>h.tr)])for(const s of tr.steps){times.add(s.start);times.add(s.start+s.dur);}
    scenarios.push({name:key,scene:s,apply:t=>sim.apply(t),times:[...times].sort((a,b)=>a-b),obstacles:[...m.keepout,...meshList(m.occluders),...Object.values(m.heads).flatMap(h=>meshList(h.beam)),...Object.values(m.loaders).flatMap(h=>meshList(h.car)),...Object.values(m.scanners).flatMap(h=>meshList(h.beam)),...Object.values(m.feeders).flatMap(h=>meshList(h.cam.group))]});
  }
} else if(project==='AutomaticAcid-BaseTitration') {
  const {createSim}=await imp('sim'),s=scene(),sim=createSim(s);
  scenarios.push({name:'full-batch',scene:s,apply:t=>sim.apply(t),times:sim.plan.steps.flatMap(p=>sampleTimes(p.start,p.dur,p.kind==='wait'?p.dur||1:interval)),obstacles:[...sim.robot.clearanceParts.arm,...sim.robot.clearanceParts.tool,...sim.lab.keepout.map(k=>k.mesh)]});
} else if(project==='RobotArmPressSSD'||project==='shutter assembly') {
  const {createStation}=await imp('station'),{createSequence}=await imp('sequence');
  const modes=project==='RobotArmPressSSD'?Object.entries((await imp('recipes')).RECIPES).flatMap(([key,r])=>(r.multiPad?['bar','single']:['single']).map(insert=>({key:key+'/'+insert,recipe:r,insert}))):[{key:'OK',ng:false},{key:'NG',ng:true}];
  for(const mode of modes) {const s=scene(),st=mode.recipe?createStation(s,mode.recipe,mode.insert):createStation(s,mode);
    const seq=mode.recipe?createSequence({...st,...mode}):createSequence({robot:st.robot,apply:st.apply,ng:mode.ng});
    scenarios.push({name:mode.key,scene:s,apply:t=>{seq.sample(t);st.robot.snap();st.sync?.();},times:seq.steps.flatMap(p=>sampleTimes(p.start,p.dur,interval)),obstacles:[...st.robot.clearanceParts.arm,...meshList(st.robot.tool),...st.cell.keepout.flatMap(meshList),...meshList(st.cell.occluders)]});
    // Include the actual perforated tabletop, not just robot keepout proxies.
    if(project==='shutter assembly')s.traverse(m=>{if(m.isMesh&&['table-optical-port','esd-optical-port'].includes(m.name))scenarios.at(-1).obstacles.push(m);});
  }
} else if(project==='MilitaryGradePC') {
  const {createNotebook,NB,selectSku}=await imp('notebook'),{createCell,LAYOUT}=await imp('cell'),{createRobot}=await imp('robot'),{createSequence}=await imp('sequence');
  for(const sku of ['V110-STND','V110-RF']) {selectSku(sku);const s=scene(),nb=createNotebook(),cell=createCell(s),robot=createRobot(),holder=new THREE.Group();s.add(robot.root,holder);holder.add(nb.root);nb.root.position.y=-NB.H/2;robot.root.position.z=LAYOUT.railZ;
    const top=LAYOUT.conveyorTop+6+LAYOUT.palletH+LAYOUT.padH+LAYOUT.footOffset;
    const apply=q=>{holder.position.set(q.palletX,top+q.palletLift+q.lift+NB.H/2,0);holder.rotation.x=Math.PI*q.flip;nb.doors.forEach((d,i)=>d.set(q.doors[i].open,q.doors[i].latch));cell.cradle.lift.position.y=top+NB.H/2+q.cradleLift;cell.cradle.rot.rotation.x=Math.PI*q.flip;cell.cradle.setClamp(q.cradleClamp);cell.setHead(q.s1Head);s.updateMatrixWorld(true);};
    const seq=createSequence({nb,robot,apply});scenarios.push({name:sku,scene:s,apply:t=>{seq.sample(t);robot.snap();},times:seq.steps.flatMap(p=>sampleTimes(p.start,p.dur,interval)),obstacles:[...robot.clearanceParts.arm,...robot.clearanceParts.tool,...cell.keepout,...meshList(cell.occluders)]});
  }
} else throw new Error('Specify a supported project folder');

// 判定迴圈在 core/verify/cables.mjs（新專案的 electrical 檢查共用）；這裡只組各站的情境
const {report,failures}=checkCableScenarios(scenarios,{minRoutes:5});
const out={project,interval,method:CABLE_METHOD,report,failures};
const dir=new URL('../project-site/'+project+'/review/',import.meta.url);mkdirSync(dir,{recursive:true});writeFileSync(new URL('cables.json',dir),JSON.stringify(out,null,2));
console.log(JSON.stringify({...out,failures:out.failures.slice(0,35)},null,2));
if(out.failures.length)process.exitCode=1;
