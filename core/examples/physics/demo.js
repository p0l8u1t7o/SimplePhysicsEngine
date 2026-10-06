// 剛體動力學範例頁（core/examples/physics/index.html）：選情境 → 烘焙（Rapier 決定性版）→ 播放或拖曳時間軸（可以倒著拖）。
// 固定物、輸送帶、夾爪用方塊畫；物體用 core/physics 的 createPhysicsView。網址 ?s=flow|chute|bin|grip 指定情境。
// 檢查（check.mjs）用 window.sim.bakeAll() 在瀏覽器裡把四個情境都烘焙一次，和 Node 的雜湊比對。
import * as THREE from 'three';
import { createStage, exposeSim } from '@core/ui/stage.js';
import { bake, createPhysicsView, quatOf, sampler } from '@core/physics/physics.js';
import { SCENARIOS } from './scenarios.js';

const $ = id => document.getElementById(id);
const stage = createStage({ canvas: $('c'), look: 'studio', extent: { center: [200, 400, 0], radius: 1800 }, camera: { near: 5, far: 30000 } });
const { scene } = stage;
let group = null, view = null, kin = null, baked = null, T = 0, playing = false, key = new URLSearchParams(location.search).get('s') || 'flow';
const fixedMat = new THREE.MeshStandardMaterial({ color: 0x8a96a3, roughness: .7, metalness: .2 }), beltMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: .8 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x313b45, roughness: .95 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0xd0a24b, roughness: .4, metalness: .5 });
const boxMesh = (size, mat, pos = [0, 0, 0], rot) => { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat); m.position.set(...pos); if (rot) { const q = quatOf(rot); m.quaternion.set(q.x, q.y, q.z, q.w); } m.castShadow = m.receiveShadow = true; return m; };

for (const [k, s] of Object.entries(SCENARIOS)) { const o = document.createElement('option'); o.value = k; o.textContent = s.title; $('pick').append(o); }
$('pick').value = key;

async function load(k) {
  key = k; playing = false; $('play').textContent = '▶ 播放';
  const s = SCENARIOS[k];
  $('note').textContent = s.note; $('stats').innerHTML = '<li>烘焙中…</li>'; $('meta').textContent = '';
  if (group) { scene.remove(group); view?.dispose(); }
  group = new THREE.Group(); scene.add(group);
  for (const st of s.spec.statics || []) group.add(boxMesh(st.size, st.id === '地面' ? floorMat : fixedMat, st.pos, st.rot));
  for (const c of s.spec.conveyors || []) group.add(boxMesh(c.size, beltMat, c.pos, c.rot));
  const t0 = performance.now();
  baked = await bake(s.spec);
  const ms = performance.now() - t0;
  view = createPhysicsView(baked); group.add(view.root);
  // 治具與夾爪手指：照烘焙的軌跡畫
  kin = baked.kinematics.filter(x => x.size).map(x => ({ x, m: group.add(boxMesh(x.size, gripMat)) && group.children.at(-1) }));
  const at = sampler(baked);
  kin.apply = t => { const now = new Map(at(t).map(o => [o.id, o])); for (const { x, m } of kin) { const o = now.get(x.id); m.position.set(...o.pos); m.quaternion.set(...o.quat); } };
  $('t').max = baked.duration;
  $('stats').innerHTML = s.analyze(baked).map(r => `<li><span>${r.label}</span><b>${r.value}</b></li>`).join('');
  $('meta').textContent = `${baked.stats.bodies} 個物體、${baked.stats.steps} 步（1/${Math.round(1 / baked.dt)} s），烘焙 ${Math.round(ms)} ms；靜止接觸最大穿透 ${baked.stats.maxPenetration} mm；雜湊 ${baked.stats.hash}`;
  stage.goTo(...s.view, true);
  seek(baked.duration * (k === 'grip' ? 0.6 : 0.5));
}
function seek(t) {
  if (!baked) return;
  T = Math.max(0, Math.min(baked.duration, t));
  view.apply(T); kin.apply(T);
  $('t').value = T; $('time').textContent = `${T.toFixed(2)} s`;
  stage.invalidate(true);
}
$('pick').onchange = () => { history.replaceState(null, '', `?s=${$('pick').value}`); load($('pick').value); };
$('t').oninput = () => { playing = false; $('play').textContent = '▶ 播放'; seek(+$('t').value); };
$('play').onclick = () => { if (!baked) return; if (!playing && T >= baked.duration - 1e-3) seek(0); playing = !playing; $('play').textContent = playing ? '⏸ 暫停' : '▶ 播放'; };
let last = performance.now();
stage.loop(() => { const now = performance.now(), dt = (now - last) / 1000; last = now; if (playing && baked) { seek(T + dt); if (T >= baked.duration) { playing = false; $('play').textContent = '▶ 播放'; } } return playing; });

exposeSim({
  get total() { return baked?.duration ?? 0; }, seekTo: t => seek(t), views: ['iso'], setView: () => stage.goTo(...SCENARIOS[key].view, true),
  get ready() { return !!baked; }, play: () => { if (!playing) $('play').click(); }, pause: () => { if (playing) $('play').click(); }, get stats() { return baked?.stats; },
  load: k => load(k),
  // 四個情境都在瀏覽器烘焙一次（檢查用）：{ 情境: 雜湊 }
  async bakeAll() { const out = {}; for (const [k, s] of Object.entries(SCENARIOS)) out[k] = (await bake(s.spec)).stats.hash; return out; },
});
load(key);
