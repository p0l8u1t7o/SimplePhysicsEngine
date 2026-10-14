// 三場型固定事件截圖與桌面播放量測；截圖是人工外觀驗收依據，FPS 為本機無頭瀏覽器數值。
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {startServer} from '../../../core/tools/serve.mjs';
import {openBrowser,sleep} from '../../../core/tools/cdp.mjs';

const args=process.argv.slice(2),out=resolve(args[0]||'TEMP/pems-realism-shots'),port=Number(args[1]||8848);
mkdirSync(out,{recursive:true});
const server=await startServer({port,quiet:true}),browser=await openBrowser(),report={sites:{},errors:[]};
try{
  for(const site of ['flagship','mixed','urban']){
    if(!await browser.goto(`http://127.0.0.1:${port}/ParkingEMS/?pause&site=${site}`))throw new Error(`${site}: not ready`);
    await sleep(500);
    const cases=await browser.evaluate(`(()=>{const p=window.sim.project,h=p.seq.hero;return [
      ['overview','iso',p.seq.dayStart+18],['entry','gate',h.t0+2.9],['equipment','energy',p.seq.dayStart+18],
      ['night','charging',p.seq.dayStart+2],['door','charging',h.tPark+1.3],['pickup','charging',h.tPark+2.6+h.interaction.take+.7],
      ['insert','charging',h.plugT],['connected','charging',h.plugT+2.5],['return','charging',h.unplugT+h.interaction.carry*.5],
      ['crane','iso',p.seq.lifts[0].t0+1],...(p.carport?[['canopy','carport',p.seq.dayStart+18]]:[])];})()`);
    const r=report.sites[site]={shots:[],performance:null};
    for(const [name,view,time]of cases){
      await browser.evaluate(`window.sim.seekTo(${time});window.sim.setView(${JSON.stringify(view)},true);true`);
      await browser.frames();await sleep(160);await browser.frames();
      const file=`${site}-${name}.png`;writeFileSync(join(out,file),await browser.screenshot());r.shots.push({name,view,time,file});
    }
    r.performance=await browser.evaluate(`(async()=>{
      const s=globalThis.__coreStages[0],gl=s.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info'),gpu=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      window.sim.seekTo(window.sim.project.seq.hero.tPark);window.sim.setView('charging',true);window.sim.play();await new Promise(r=>setTimeout(r,500));
      const times=[];let previous=performance.now(),start=previous;await new Promise(done=>{const frame=t=>{times.push(t-previous);previous=t;t-start<3000?requestAnimationFrame(frame):done();};requestAnimationFrame(frame);});window.sim.pause();
      const sorted=times.slice(1).sort((a,b)=>a-b),quantile=u=>sorted[Math.floor((sorted.length-1)*u)];
      s.renderer.info.autoReset=false;s.renderer.info.reset();s.invalidate?.();await new Promise(r=>requestAnimationFrame(r));
      const drawCalls=s.renderer.info.render.calls,triangles=s.renderer.info.render.triangles;s.renderer.info.autoReset=true;
      return {gpu,userAgent:navigator.userAgent,width:innerWidth,height:innerHeight,samples:sorted.length,p50Ms:quantile(.5),p95Ms:quantile(.95),maxMs:sorted.at(-1),fps:1000/(sorted.reduce((a,b)=>a+b,0)/sorted.length),drawCalls,triangles};
    })()`);
    // GPU 查詢涵蓋主場景與後處理，避免只把 rAF 排程頻率當成 GPU 完成速度。
    r.performance.gpuTimer=await browser.evaluate(`(async()=>{
      const s=__coreStages[0],renderer=s.renderer,gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if(!ext)return {available:false,reason:'GPU timer extension unavailable'};
      const original=renderer.render,queries=[];let current=null;
      renderer.render=function(scene,camera){
        if(scene===s.scene&&!current&&queries.length<60){current=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,current);}
        try{return original.call(this,scene,camera);}finally{if(current&&(scene!==s.scene||sim.renderQuality==='low')){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(current);current=null;}}
      };
      try{
        sim.play();for(let i=0;i<90&&queries.length<60;i++)await new Promise(requestAnimationFrame);sim.pause();
        const until=performance.now()+3000;while(queries.some(q=>!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))&&performance.now()<until)await new Promise(requestAnimationFrame);
        const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT),ready=queries.every(q=>gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE));
        if(disjoint||!ready||!queries.length)return {available:false,reason:disjoint?'GPU disjoint':'GPU result timeout'};
        const ms=queries.map(q=>gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6).sort((a,b)=>a-b);
        return {available:true,samples:ms.length,p50Ms:ms[Math.floor(ms.length*.5)],p95Ms:ms[Math.floor(ms.length*.95)],maxMs:ms.at(-1)};
      }finally{renderer.render=original;if(current){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(current);}for(const q of queries)gl.deleteQuery(q);sim.pause();}
    })()`);
    report.errors.push(...browser.errors.map(error=>({site,error})));
    console.log(`${site}: ${r.shots.length} shots, ${r.performance.fps.toFixed(1)} fps, p95 ${r.performance.p95Ms.toFixed(1)} ms`);
  }
}finally{await browser.close();server.close();writeFileSync(join(out,'render-review.json'),JSON.stringify(report,null,2));}
if(report.errors.length){console.error(report.errors);process.exitCode=1;}
