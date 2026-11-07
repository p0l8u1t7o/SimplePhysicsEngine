// CFD 結果範例頁（core/cfd）：?pack=<網址>（預設 ./demo.cfdpack.gz：tools/cfd/make-demo.mjs --example 產生的解析式假流場，只示範畫面）。
// 真的結果：tools/cfd 產生案例 → OpenFOAM（外部）→ import-results.mjs 匯成 results.cfdpack，放到網頁讀得到的位置再用 ?pack= 指定。
// 障礙物用結果包裡的外形畫成半透明方塊／圓柱（真正的站會用自己的設備模型）。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadPack } from '@core/cfd/pack.js';
import { COLORMAPS } from '@core/cfd/flow-field.js';
import { createFlowView, FIELD_LABELS } from '@core/cfd/flow-view.js';

const $ = id => document.getElementById(id);
const url = new URLSearchParams(location.search).get('pack') || './demo.cfdpack.gz';

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
const camera = new THREE.PerspectiveCamera(40, 1, 50, 400000);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xdde8f0, 0x334, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-1, 2, -1.5); scene.add(sun);

function obstacleMeshes(pack) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8796a3, metalness: 0.2, roughness: 0.7, transparent: true, opacity: 0.35, depthWrite: false });
  for (const o of pack.obstacles) {
    let m;
    if (o.axes) {
      m = new THREE.Mesh(new THREE.BoxGeometry(...o.size), mat);
      const M = new THREE.Matrix4().makeBasis(...o.axes.map(a => new THREE.Vector3(...a)));
      m.quaternion.setFromRotationMatrix(M);
      m.position.set(...o.center);
    } else {
      const a = new THREE.Vector3(...o.p1), b = new THREE.Vector3(...o.p2);
      m = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, a.distanceTo(b), 24), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    }
    g.add(m);
  }
  return g;
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

try {
  const pack = await loadPack(url);
  $('title').textContent = `CFD 結果：${pack.case.name}（${pack.case.solver.application}，第 ${pack.case.time} 步）`;
  if (pack.case.synthetic) $('note').textContent = '展示資料是解析式的假流場（測試用），不是 CFD 結果。';
  const flow = createFlowView(pack, { arrows: { surface: 'plan', stride: 5, color: 0x1b1f24 }, opacity: 0.85 });
  scene.add(flow.group, obstacleMeshes(pack));
  // 地面格線（mm）
  const grid = new THREE.GridHelper(80000, 80, 0x3a4652, 0x232b33); grid.position.y = -2; scene.add(grid);

  const fill = (sel, items, cur, label = x => x) => { sel.innerHTML = ''; for (const it of items) sel.add(new Option(label(it), it, false, it === cur)); };
  fill($('field'), flow.fields('slices'), 'Umag', f => FIELD_LABELS[f] || f);
  fill($('pfield'), flow.fields('patches'), 'Cp', f => FIELD_LABELS[f] || f);
  fill($('cmap'), COLORMAPS, 'turbo');
  const legends = () => { $('legends').replaceChildren(flow.legendElement('slices'), flow.legendElement('patches')); };
  $('field').onchange = e => { flow.setField(e.target.value); legends(); };
  $('pfield').onchange = e => { flow.setField(e.target.value, 'patches'); legends(); };
  $('cmap').onchange = e => { flow.setColormap(e.target.value); legends(); };
  for (const [name, m] of flow.meshes) {
    if (name.startsWith('patch_')) continue;
    const l = document.createElement('label');
    // 一開始只開水平切面、箭頭與流線；直立切面會擋住視線
    const on = !/^(elevation|behind)/.test(name);
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
    if (!on) flow.setVisible(name, false);
    cb.onchange = () => { flow.setVisible(name, cb.checked); legends(); };
    l.append(cb, ` ${name}`); $('vis').append(l);
    void m;
  }
  legends();
  const rows = flow.forcesTable();
  $('forces').innerHTML = '<tr><th></th><th>Fx</th><th>Fy</th><th>Fz</th><th>CN</th></tr>' + rows.map(r => `<tr><td>${r.label || r.obstacle}</td><td>${r.Fx.toFixed(0)}</td><td>${r.Fy.toFixed(0)}</td><td>${r.Fz.toFixed(0)}</td><td>${r.CN === null ? '–' : r.CN.toFixed(2)}</td></tr>`).join('');

  // 鏡頭：框住障礙物
  const box = new THREE.Box3();
  for (const o of pack.obstacles) box.expandByPoint(new THREE.Vector3(...(o.center || o.p1)));
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(8000, box.getSize(new THREE.Vector3()).length()) * 1.6;
  camera.position.set(c.x + r * 0.9, c.y + r * 0.9, c.z - r * 0.8); controls.target.copy(c); controls.update();
  window.flow = flow; window.sim = { ready: true, flow, pack };
} catch (e) {
  $('msg').textContent = `讀取失敗：${e.message}（預設的 demo.cfdpack.gz 用 node tools/cfd/make-demo.mjs --example 產生）`;
  console.error(e);
}
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
