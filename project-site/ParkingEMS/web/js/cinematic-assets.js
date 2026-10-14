// 素材封裝在本站，執行時只讀同源檔案；載入結果供介面及瀏覽器驗證查詢。
import * as THREE from 'three';
import { RGBELoader } from '../assets/vendor/RGBELoader.js';

// 常數 URL 讓 core 的單檔 HTML 匯出器能辨識並內嵌素材。
const files={
  'asphalt_02_Diffuse.jpg':new URL('../assets/materials/asphalt_02_Diffuse.jpg',import.meta.url).href,
  'asphalt_02_nor_gl.jpg':new URL('../assets/materials/asphalt_02_nor_gl.jpg',import.meta.url).href,
  'asphalt_02_Rough.jpg':new URL('../assets/materials/asphalt_02_Rough.jpg',import.meta.url).href,
  'concrete_floor_01_Diffuse.jpg':new URL('../assets/materials/concrete_floor_01_Diffuse.jpg',import.meta.url).href,
  'concrete_floor_01_nor_gl.jpg':new URL('../assets/materials/concrete_floor_01_nor_gl.jpg',import.meta.url).href,
  'concrete_floor_01_Rough.jpg':new URL('../assets/materials/concrete_floor_01_Rough.jpg',import.meta.url).href,
  'daylight.hdr':new URL('../assets/materials/daylight.hdr',import.meta.url).href,
  'daylight-4k.hdr':new URL('../assets/materials/daylight-4k.hdr',import.meta.url).href,
};
const asset=path=>files[path];
async function boundedLoad(promise,timeout=8000){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Asset load timeout')),timeout);})]);}
  finally{clearTimeout(timer);}
}
export async function loadCinematicAssets(scene,renderer,quality='high'){
  const failures=[],maps={},loader=new THREE.TextureLoader();
  const tasks=['asphalt_02','concrete_floor_01'].flatMap(id=>['Diffuse','nor_gl','Rough'].map(kind=>({id,kind,file:id+'_'+kind+'.jpg'})));
  await Promise.all(tasks.map(async({id,kind,file})=>{
    try{
      const t=await boundedLoad(loader.loadAsync(asset(file)));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());
      t.colorSpace=kind==='Diffuse'?THREE.SRGBColorSpace:THREE.NoColorSpace;(maps[id]??={})[kind]=t;
    }catch{failures.push(file);}
  }));
  const seen=new Set();scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material])){
    if(!m||seen.has(m))continue;seen.add(m);
    const kind=m.userData.surface,id=kind==='asphalt'?'asphalt_02':kind==='concrete'?'concrete_floor_01':null;
    if(!id||!maps[id]?.Diffuse||!maps[id]?.nor_gl||!maps[id]?.Rough)continue;
    const repeat=m.userData.surfaceRepeat||[1,1];
    const map=key=>{const t=maps[id][key].clone();t.repeat.set(...repeat);t.needsUpdate=true;return t;};
    m.map=map('Diffuse');m.normalMap=map('nor_gl');m.roughnessMap=map('Rough');m.bumpMap=null;
    m.normalScale.setScalar(kind==='asphalt'?.42:.3);m.color.setHex(kind==='asphalt'?0xc2c4c6:0xddddda);m.roughness=.92;m.needsUpdate=true;
  }});
  let environment=null;const skyFile=quality==='high'?'daylight-4k.hdr':'daylight.hdr';
  try{environment=await boundedLoad(new RGBELoader().loadAsync(asset(skyFile)),20000);environment.mapping=THREE.EquirectangularReflectionMapping;}catch{failures.push(skyFile);}
  return {environment,skyFile,failures,loaded:tasks.length+1-failures.length};
}
