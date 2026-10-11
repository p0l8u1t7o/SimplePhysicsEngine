// 結構光與取像狀態全部由主時間 t 驅動；使用既有網格的著色器，不增加投影光源或陰影通道。
import * as THREE from 'three';
import { OPTICS } from './layout.js';

// 艙內東南上方看入 U 形開口（視線從南側屏的東端外通過）；取像中心射線同時避開三片屏與兩種產品姿態下的前臂。
export const OPTICS_VIEW = { eye: [-80, 1820, 520], target: [OPTICS.S[0], OPTICS.S[1] - 20, OPTICS.S[2]] };

export function createEffects(products, cell) {
  const uniforms = { clock: { value: 0 }, scanning: { value: 0 }, glow: { value: 0 } };
  const surface = products.L.children.find(m => m.isMesh);
  const overlay = new THREE.Mesh(surface.geometry, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: `varying vec3 p; void main(){ vec4 w=modelMatrix*vec4(position,1.0); p=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `varying vec3 p; uniform float clock; uniform float scanning; uniform float glow;
      void main(){ float band=smoothstep(.5,.85,sin(p.y*.24+p.x*.10-clock*9.0));
      gl_FragColor=vec4(mix(vec3(.65,.8,1.),vec3(.08,.5,1.),scanning),scanning*band*.65+glow*.08); }`,
  }));
  overlay.name = 'structured light surface overlay'; overlay.userData.fx = true; products.L.add(overlay);
  function led(parent, p, name) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshBasicMaterial({ color: 0x183b45 }));
    mesh.name = name; mesh.position.set(...p); mesh.userData.fx = true; parent.add(mesh); return mesh;
  }
  const head = cell.scanBeam.parent;
  const scanLeds = [-1, 1].map(s => led(head, [s * 140, 23, 48], 'scan camera status'));
  const trigger = led(cell.cam.root, [33, 90, 12], 'hardware trigger status');
  const settle = led(cell.cam.root, [-33, 90, 12], 'settle status');
  const status = { trigger: false, settle: false };
  function set(st, step, t, mode) {
    const elapsed = Math.max(0, t - step.start), capturing = step.capture != null;
    status.trigger = capturing && (elapsed < OPTICS.capture.fringe * 8 ? elapsed % OPTICS.capture.fringe < .026 : elapsed - OPTICS.capture.fringe * 8 < .055);
    status.settle = /穩定/.test(step.action);
    uniforms.clock.value = t; uniforms.scanning.value = st.scan ? 1 : 0; uniforms.glow.value = capturing ? 1 : 0;
    overlay.visible = !!st.scan || capturing;
    scanLeds.forEach(m => m.material.color.setHex(st.scan ? 0x4dbbff : 0x183b45));
    trigger.material.color.setHex(status.trigger ? 0x63ffca : 0x143b32);
    settle.material.color.setHex(status.settle ? 0xffc35a : 0x3c321b);
    cell.cam.set(status.trigger); cell.colorCam.set(mode === 'white' && status.trigger);
  }
  return { overlay, uniforms, scanLeds, trigger, settle, status, set };
}
