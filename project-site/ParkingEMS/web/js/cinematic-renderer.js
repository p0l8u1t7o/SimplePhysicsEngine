// 本站 HDR 後處理：由對數深度重建視空間，補接觸遮蔽與輕微亮部擴散。
// 不改共用 renderer.render；相機子畫面及其他站沿用原管線。
import * as THREE from 'three';

export function createCinematicRenderer({renderer,scene,camera,quality,useLog}){
  const high=quality==='high',size=new THREE.Vector2(),oldViewport=new THREE.Vector4();
  const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true,samples:high?4:0});
  target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const uniforms={colorMap:{value:target.texture},depthMap:{value:target.depthTexture},pixel:{value:new THREE.Vector2(1,1)},invProjection:{value:new THREE.Matrix4()},farPlane:{value:camera.far},logDepth:{value:useLog}};
  const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,
    vertexShader:'varying vec2 uvScreen;void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:`varying vec2 uvScreen;
      uniform sampler2D colorMap,depthMap;uniform vec2 pixel;uniform mat4 invProjection;uniform float farPlane;uniform bool logDepth;
      vec3 positionAt(vec2 uv,float depth){
        vec4 q=invProjection*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
        if(!logDepth)return q.xyz/q.w;
        vec4 ray=invProjection*vec4(uv*2.0-1.0,1.0,1.0);
        return ray.xyz/(-ray.z)*(exp2(depth*log2(farPlane+1.0))-1.0);
      }
      void main(){
        vec2 uv=uvScreen;vec3 color=texture2D(colorMap,uv).rgb;float depth=texture2D(depthMap,uv).r;
        if(depth<.999999){
          vec3 p=positionAt(uv,depth),normal=normalize(cross(dFdx(p),dFdy(p)));
          float radius=550.0,ao=0.0;vec2 scale=vec2(1.0/abs(invProjection[0][0]),1.0/abs(invProjection[1][1]))*radius/max(300.0,-p.z)*.5;
          for(int i=0;i<16;i++){
            float f=float(i),angle=f*2.399963,ring=.25+.75*sqrt((f+.5)/16.0);vec2 v=uv+vec2(cos(angle),sin(angle))*scale*ring;
            float z=texture2D(depthMap,v).r;vec3 delta=positionAt(v,z)-p;float distance=length(delta);
            float valid=step(0.0,v.x)*step(v.x,1.0)*step(0.0,v.y)*step(v.y,1.0)*step(z,.999999);
            ao+=max(0.0,dot(normal,delta)/max(distance,1.0)-.10)*(1.0-smoothstep(radius*.2,radius,distance))*valid;
          }
          color*=1.0-clamp(ao/16.0*2.8,0.0,.45);
        }
        vec3 glow=vec3(0.0);
        for(int i=0;i<8;i++){float a=float(i)*.785398;vec2 o=vec2(cos(a),sin(a))*pixel*3.0;glow+=max(vec3(0.0),texture2D(colorMap,uv+o).rgb-vec3(1.8));}
        color+=glow*.018;
        float l=dot(color,vec3(.2126,.7152,.0722));color=mix(vec3(l),color,.96);
        color*=1.0-.055*smoothstep(.35,.85,length(uv-.5));gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
  const screen=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material),view=new THREE.Camera();screen.add(quad);
  let width=0,height=0;
  return {quality,render(){
    if(!high){renderer.render(scene,camera);return;}
    renderer.getDrawingBufferSize(size);
    if(size.x!==width||size.y!==height){width=size.x;height=size.y;target.setSize(width,height);uniforms.pixel.value.set(1/width,1/height);}
    uniforms.invProjection.value.copy(camera.projectionMatrixInverse);uniforms.farPlane.value=camera.far;
    const previous=renderer.getRenderTarget();renderer.getViewport(oldViewport);
    try{renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(previous);renderer.render(screen,view);}
    finally{renderer.setRenderTarget(previous);renderer.setViewport(oldViewport);}
  },dispose(){target.dispose();quad.geometry.dispose();material.dispose();}};
}
