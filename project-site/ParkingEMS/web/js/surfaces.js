// 可離線、固定種子的材質紋理；貼圖只在建構時產生，Node 與瀏覽器一致。
import * as THREE from 'three';
import { finished } from '@core/geom/materials.js';

function noiseTexture(kind) {
  const n=256,data=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const hash=((Math.imul(x+19,73856093)^Math.imul(y+73,19349663))>>>0)%251;
    const wave=Math.sin(x*.037+Math.sin(y*.023))*Math.cos(y*.031);
    const value=kind==='asphalt'?175+hash*.10:kind==='grass'?160+hash*.17+wave*5:195+hash*.10+wave*3;
    const i=(y*n+x)*4;data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;
  }
  const tex=new THREE.DataTexture(data,n,n);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.generateMipmaps=true;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;tex.anisotropy=8;tex.colorSpace=THREE.SRGBColorSpace;tex.needsUpdate=true;return tex;
}

export function surfaceMaterials(M){
  const result={};
  for(const [key,kind,color] of [['asphalt','asphalt',0x787976],['road','asphalt',0x666966],['grass','grass',0x71815a],['concrete','concrete',0xc7c5bc],['sidewalk','concrete',0xa6a69e]]){
    const mat=M[key].clone();mat.color.setHex(color);mat.map=noiseTexture(kind);mat.roughness=.92;mat.metalness=0;result[key]=mat;
  }
  result.steel=finished(M.steel,'metal',.6);result.galv=finished(M.galv,'metal',.35);
  result.cabinet=finished(M.cabinet,'polymer',.15);result.bess=finished(M.bess,'polymer',.15);
  const n=256,data=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const frame=x<3||y<3||x>252||y>252;
    const seam=x%42<2||y%21<1,wire=x%14===0;
    const c=frame?[164,177,184]:seam?[50,65,77]:wire?[70,87,110]:[18+(x%42)*.14,34,56+(y%21)*.18];
    data.set([...c,255],(y*n+x)*4);
  }
  const pvMap=new THREE.DataTexture(data,n,n);pvMap.colorSpace=THREE.SRGBColorSpace;pvMap.generateMipmaps=true;pvMap.minFilter=THREE.LinearMipmapLinearFilter;pvMap.magFilter=THREE.LinearFilter;pvMap.anisotropy=8;pvMap.needsUpdate=true;
  result.pv=new THREE.MeshPhysicalMaterial({color:0xffffff,map:pvMap,roughness:.26,metalness:.3,clearcoat:.7,clearcoatRoughness:.16});
  return result;
}

export function groundMaterial(base,w,d){
  if(!base.map)return base;
  const m=base.clone();m.map=base.map.clone();m.map.repeat.set(w/3200,d/3200);m.map.needsUpdate=true;
  m.bumpMap=m.map;m.bumpScale=.25;return m;
}
