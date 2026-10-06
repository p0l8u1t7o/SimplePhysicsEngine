// 光學配置的 3D 檢視（評估平台 Q4；studio 的光學工作台用 iframe 嵌入）：相機（core 的 camera 模型）、視野（視錐與工件上的範圍）、
// 景深的上下限、光源的位置與照射錐、工件。設定由網址 #<JSON> 或 postMessage({ type: 'optics', setup }) 傳入；
// 數字用 core/optics 的 evaluate 算，和工作台的結果表是同一份公式。座標：工件表面在 y = 0，相機在正上方往下看，單位 mm。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { create as cameraModel } from '@core/models/camera.js';
import { evaluate } from './optics.js';

const $ = id => document.getElementById(id);
const stage = createStage({ canvas: $('c'), camera: { near: 1, far: 20000 }, exposure: 1.05, sun: { position: [-600, 1500, 900], target: [0, 0, 0] } });
const { scene } = stage;
const grid = new THREE.GridHelper(2000, 40, 0x3a4652, 0x2a333c); grid.position.y = -0.5; scene.add(grid);
let group = null;
const C = { fov: 0x61d5ff, dof: 0x69efb0, light: 0xffd079, part: 0xb7c3cd };
const line = (pts, color, opacity = 1) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
const rect = (w, d, y, color, opacity = 1) => line([[-w / 2, y, -d / 2], [w / 2, y, -d / 2], [w / 2, y, d / 2], [-w / 2, y, d / 2], [-w / 2, y, -d / 2]], color, opacity);
const plane = (w, d, y, color, opacity) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; };

function build(setup) {
  if (group) scene.remove(group);
  group = new THREE.Group(); scene.add(group);
  const r = evaluate(setup), d = r.derived, cam = setup.camera || {}, lens = setup.lens || {}, light = setup.light || {}, sc = setup.scene || {};
  $('msg').textContent = r.results.filter(x => x.status === 'fail').map(x => `${x.label}：${x.note || '不符合'}`).join('；');
  const wd = d.wd || 300, fov = d.fov, tgt = sc.target || {};
  // 工件：目標尺寸的方塊（高低差當厚度）
  const tw = tgt.w || (fov ? fov[0] * .8 : 50), th = tgt.h || (fov && fov[1] ? fov[1] * .8 : tw * .75), tz = Math.max(.5, tgt.heightRange || 2);
  const part = new THREE.Mesh(new THREE.BoxGeometry(tw, tz, th), new THREE.MeshStandardMaterial({ color: C.part, roughness: .6, metalness: .2 }));
  part.position.y = -tz / 2; part.receiveShadow = true; group.add(part);
  // 相機：core 的相機模型（感光元件與焦距照設定；遠心時鏡筒畫長一點）
  const sensorW = d.sensor?.w || 8.8, sensorH = d.sensor?.h || 6.6, tele = d.telecentric;
  const body = cameraModel({ sensorW, sensorH, focal: Math.min(200, Math.max(4, lens.focal || 25)), lensL: tele ? Math.min(200, Math.max(60, wd * .6)) : 45, lensD: tele ? 60 : 34, ring: 0 });      // 光源另外畫在設定的高度
  body.root.position.y = wd; group.add(body.root);
  if (fov) {
    const fw = fov[0], fd = fov[1] || Math.max(2, fw * .02);
    group.add(rect(fw, fd, 0.3, C.fov));
    // 視錐：一般鏡頭從鏡頭前緣張開；遠心鏡頭是平行光（直筒）
    const top = tele ? [fw / 2, fd / 2] : [Math.min(fw / 2, 17), Math.min(fd / 2, 17) * (fd / fw || 1)];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) group.add(line([[sx * top[0], wd, sz * top[1]], [sx * fw / 2, 0, sz * fd / 2]], C.fov, .8));
    if (d.dof) for (const y of [d.dof / 2, -d.dof / 2]) { group.add(plane(fw, fd, y, C.dof, .16)); group.add(rect(fw, fd, y, C.dof, .9)); }
  }
  // 光源：畫在設定的高度（同軸、背光、穹頂只標位置）；照射錐用光束角
  if (light.type && light.distance) {
    const h = light.distance, rr = (light.size || 60) / 2;
    const lm = new THREE.Mesh(light.type === '條形' ? new THREE.BoxGeometry(light.size || 100, 12, 30) : new THREE.TorusGeometry(rr, Math.max(1.5, rr * .06), 10, 48),
      new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xffe9a8, emissiveIntensity: .8 }));
    if (light.type !== '條形') lm.rotation.x = Math.PI / 2;
    lm.position.y = h; group.add(lm);
    const spot = d.lightSpot ? d.lightSpot / 2 : rr;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; group.add(line([[Math.cos(a) * rr, h, Math.sin(a) * rr], [Math.cos(a) * spot * .9, 0, Math.sin(a) * spot * .9]], C.light, .55)); }
  }
  stage.invalidate(true);
  return r;
}
// 取景：整組（相機、光源、視錐、工件）的外框；c 是中心高度，s 是最大邊長
const VIEWS = { iso: (s, c) => [[s * .9, c + s * .45, s * 1.2], [0, c, 0]], side: (s, c) => [[0, c, s * 1.5], [0, c, 0]], top: s => [[0.01, s * 1.6, 0], [0, 0, 0]] };
const view = (k = 'iso', instant = true) => {
  const box = new THREE.Box3().setFromObject(group), size = box.getSize(new THREE.Vector3()), s = Math.max(size.x, size.y, size.z, 60);
  const [p, t] = VIEWS[k](s, (box.min.y + box.max.y) / 2); stage.goTo(p, t, instant);
};
document.querySelectorAll('#views button').forEach(b => { b.onclick = () => view(b.dataset.v, false); });

let current = null;
function show(setup, fit = true) { current = setup; build(setup); if (fit) view('iso'); }
addEventListener('message', e => { if (e.data?.type === 'optics' && e.data.setup) show(e.data.setup, e.data.fit !== false); });
try { show(location.hash.length > 1 ? JSON.parse(decodeURIComponent(location.hash.slice(1))) : { camera: { sensorW: 8.8, sensorH: 6.6, pixel: 3.45, hPx: 2448, vPx: 2048 }, lens: { focal: 25, fNumber: 8 }, scene: { wd: 300 } }); }
catch (e) { $('msg').textContent = '設定格式不對：' + e.message; }
stage.loop(() => false);
exposeSim({ seekTo: () => {}, setView: k => view(k), views: Object.keys(VIEWS), total: 0, show: s => show(s), get setup() { return current; } });
