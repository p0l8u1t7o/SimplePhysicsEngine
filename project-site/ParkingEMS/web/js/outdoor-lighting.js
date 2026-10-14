// 戶外天空與反射獨立於共用舞台；不改其他站的照明。
import * as THREE from 'three';

export function createOutdoorLighting({scene,renderer,radius,center}){
  const uniforms={top:{value:new THREE.Color(0x568fcb)},horizon:{value:new THREE.Color(0xdce4e5)},ground:{value:new THREE.Color(0x697463)}};
  const material=new THREE.ShaderMaterial({uniforms,side:THREE.BackSide,depthWrite:false,
    vertexShader:'varying vec3 ray; void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec3 ray; uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; void main(){float y=normalize(ray).y;vec3 c=y>0.0?mix(horizon,top,pow(y,0.6)):mix(horizon,ground,min(1.0,-y*4.0));gl_FragColor=vec4(c,1.0);}'
  });
  const sky=new THREE.Mesh(new THREE.SphereGeometry(radius*15,32,16),material);sky.name='outdoor sky';sky.position.set(center[0],0,center[1]);sky.userData.fx=true;scene.add(sky);
  const envScene=new THREE.Scene(),envSky=new THREE.Mesh(new THREE.SphereGeometry(100,32,16),material.clone());envScene.add(envSky);
  const pmrem=new THREE.PMREMGenerator(renderer),target=pmrem.fromScene(envScene,.04);pmrem.dispose();envSky.geometry.dispose();envSky.material.dispose();
  scene.environment?.dispose();scene.environment=target.texture;
  const materials=new Set();scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m?.isMeshStandardMaterial)materials.add(m);});
  const dayTop=new THREE.Color(0x568fcb),dayHorizon=new THREE.Color(0xdce4e5),nightTop=new THREE.Color(0x071225),nightHorizon=new THREE.Color(0x253449),dayGround=new THREE.Color(0x697463),nightGround=new THREE.Color(0x0a1119);
  return {apply(day){
    uniforms.top.value.copy(nightTop).lerp(dayTop,day);uniforms.horizon.value.copy(nightHorizon).lerp(dayHorizon,day);uniforms.ground.value.copy(nightGround).lerp(dayGround,day);
    scene.background.copy(uniforms.horizon.value);scene.fog?.color.copy(uniforms.horizon.value);
    for(const m of materials)m.envMapIntensity=.12+day*.625;
  }};
}
