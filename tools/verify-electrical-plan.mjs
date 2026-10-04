import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import {checkElectricalPlan} from '../core/verify/electrical.mjs';
globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};
const projects=['AutomaticAcid-BaseTitration','MilitaryGradePC','PCB-CopperAssembly','RobotArmPressSSD','shutter assembly'];
const report=[];
for(const project of projects){
 const scene=new THREE.Scene(),base=new URL('../project-site/'+project+'/web/js/',import.meta.url),imp=n=>import(new URL(n+'.js',base));
 if(project==='AutomaticAcid-BaseTitration'||project==='PCB-CopperAssembly'){const {createSim}=await imp('sim');createSim(scene).apply(0);}
 else if(project==='MilitaryGradePC'){const {createCell}=await imp('cell');createCell(scene);}
 else {const {createStation}=await imp('station');if(project==='RobotArmPressSSD'){const {RECIPES}=await imp('recipes');createStation(scene,Object.values(RECIPES)[0],'bar');}else createStation(scene,{ng:false});}
 // 判定在 core/verify/electrical.mjs（新專案的 electrical 檢查共用）
 const r=checkElectricalPlan(scene),failures=r.failures;
 assert(r.devices>8&&r.connections>5,project+' has no equipment');
 const {electricalActivity}=await import('@core/electrical/electrical-components.js');
 for(const role of ['motion','vision','force','io'])assert.equal(electricalActivity(role,{action:'壓合',vision:true,playing:true}),electricalActivity(role,{action:'壓合',vision:true,playing:false}),'Pause must freeze indicated process state');
 assert.equal(electricalActivity('motion',{action:'等待分析',motion:false}),false);
 assert.equal(electricalActivity('vision',{action:'移動',vision:false}),false);
 report.push({project,devices:r.devices,connections:r.connections,components:r.components,feedthroughs:r.feedthroughs,failures});console.log(project,r.devices+' components',failures.length?'FAIL':'PASS',failures.slice(0,15));
}
writeFileSync(new URL('./review/electrical-plan-checks.json',import.meta.url),JSON.stringify({scope:'Static component body containment, body overlap, functional wire/body checks and real feedthroughs; not electrical certification',passed:report.every(r=>!r.failures.length),report},null,2));
if(report.some(r=>r.failures.length))process.exitCode=1;
