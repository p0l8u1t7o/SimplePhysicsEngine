// 座標轉換：和 PROJ 9（pyproj）參考值、Snyder 書上的算例比對；案場座標系與浮動原點。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { crsFromEPSG, transverseMercator, twd97, utm, utmZone, createSiteFrame, float32Spacing, createFloatingOrigin, geodeticToECEF, ecefToENU } from '../coords.js';

const ref = JSON.parse(readFileSync(new URL('./fixtures/proj-ref.json', import.meta.url), 'utf8'));

test('TM 正算、反算、收斂角、尺度和 PROJ 一致（167 點、5 個座標系）', () => {
  for (const c of ref.cases) {
    const p = crsFromEPSG(c.epsg);
    for (const [lat, lon, E, N, g, k] of c.rows) {
      const f = p.forward(lat, lon);
      assert.ok(Math.hypot(f.E - E, f.N - N) < 1e-6, `${c.name} forward ${lat},${lon}`);           // < 1 µm
      const b = p.inverse(E, N);
      assert.ok(Math.abs(b.lat - lat) < 1e-10 && Math.abs(b.lon - lon) < 1e-10, `${c.name} inverse`); // < 0.01 mm
      assert.ok(Math.abs(p.convergence(lat, lon) - g) < 1e-8, `${c.name} convergence`);
      assert.ok(Math.abs(p.scale(lat, lon) - k) < 1e-9, `${c.name} scale`);
    }
  }
});

test('Snyder《Map Projections: A Working Manual》p.269 UTM 算例（Clarke 1866）', () => {
  const p = transverseMercator({ lon0: -75, k0: 0.9996, ellps: { a: 6378206.4, f: 1 - Math.sqrt(1 - 0.00676866) } });
  const f = p.forward(40.5, -73.5);
  assert.ok(Math.abs(f.E - 127106.5) < 0.1, `x = ${f.E}`);
  assert.ok(Math.abs(f.N - 4484124.4) < 0.1, `y = ${f.N}`);
});

test('TWD97 中央經線上的點：E = 250000、收斂角 0、尺度 0.9999', () => {
  const p = twd97();
  const f = p.forward(23.5, 121);
  assert.ok(Math.abs(f.E - 250000) < 1e-9);
  assert.ok(Math.abs(p.convergence(23.5, 121)) < 1e-8);
  assert.ok(Math.abs(p.scale(23.5, 121) - 0.9999) < 1e-9);
  assert.equal(utmZone(120.5), 51);
  assert.equal(utmZone(119.5), 50);
  assert.equal(utm(51).params.lon0, 123);
});

test('案場座標：+X 東、+Y 上、北 = −Z，單位 mm', () => {
  const site = createSiteFrame({ crs: twd97(), origin: { E: 250000, N: 2600000, H: 30 } });
  assert.deepEqual(site.fromMap(250001, 2600000, 30), { x: 1000, y: 0, z: 0 });
  assert.deepEqual(site.fromMap(250000, 2600002, 31.5), { x: 0, y: 1500, z: -2000 });
  const m = site.toMap(1234.5, 678, -9876.5);
  const back = site.fromMap(m.E, m.N, m.H);
  assert.ok(Math.abs(back.x - 1234.5) < 1e-6 && Math.abs(back.y - 678) < 1e-6 && Math.abs(back.z + 9876.5) < 1e-6);
  // 經緯度往返
  const g = site.toLatLon(500000, 0, -300000);
  const s = site.fromLatLon(g.lat, g.lon, g.H);
  assert.ok(Math.abs(s.x - 500000) < 1e-3 && Math.abs(s.z + 300000) < 1e-3);
});

test('案場旋轉、子午線收斂角與真方位角', () => {
  // 原點在中央經線以東 1°：γ ≈ Δλ·sinφ ≈ 0.4°
  const site = createSiteFrame({ crs: twd97(), origin: { lat: 23.5, lon: 122, H: 0 } });
  assert.ok(Math.abs(site.convergence - 1 * Math.sin(23.5 * Math.PI / 180)) < 0.002);
  // 真北方向：方格北逆時針 γ（往西偏），所以 x < 0
  const n = site.directionFromAzimuth(0);
  assert.ok(n.x < 0 && n.z < 0);
  assert.ok(Math.abs(site.azimuthOf(n.x, n.z)) < 1e-9 || Math.abs(site.azimuthOf(n.x, n.z) - 360) < 1e-9);
  // 沿著真北走 1 km 的經緯度，在案場裡就在 directionFromAzimuth(0) 方向上
  const p = site.fromLatLon(23.5 + 1000 / 110760, 122, 0);
  const ang = Math.atan2(p.x, -p.z) * 180 / Math.PI;
  assert.ok(Math.abs(ang - Math.atan2(n.x, -n.z) * 180 / Math.PI) < 1e-4, `${ang}`);
  // 旋轉 30°：案場 +X 從東往北轉 30°，所以方位角 60° 的方向落在案場 +X
  const r = createSiteFrame({ crs: twd97(), origin: { E: 250000, N: 2600000 }, rotation: 30 });
  const d = r.directionFromAzimuth(60 + r.convergence);
  assert.ok(Math.abs(d.x - 1) < 1e-12 && Math.abs(d.z) < 1e-12);
  const q = r.fromMap(250000 + Math.cos(Math.PI / 6) * 10, 2600000 + Math.sin(Math.PI / 6) * 10);
  assert.ok(Math.abs(q.x - 10000) < 1e-6 && Math.abs(q.z) < 1e-6);
});

test('ground：除以綜合尺度係數，案場長度等於地面實長', () => {
  const crs = twd97();
  const o = { lat: 23.0, lon: 120.3, H: 200 };
  const grid = createSiteFrame({ crs, origin: o });
  const gnd = createSiteFrame({ crs, origin: o, ground: true });
  assert.ok(gnd.combinedScale < 1 && gnd.combinedScale > 0.9998);
  const a = grid.fromMap(grid.origin.E + 1000, grid.origin.N), b = gnd.fromMap(gnd.origin.E + 1000, gnd.origin.N);
  // 1 km 方格距離換成地面距離差幾十 mm（TM2 邊緣＋200 m 高程）
  assert.ok(Math.abs(b.x - a.x / gnd.combinedScale) < 1e-6);
  assert.ok(Math.abs(b.x - a.x) > 10);
});

test('ECEF／ENU：往北 1″ 約 30.7 m', () => {
  const a = geodeticToECEF(23.5, 121, 0), b = geodeticToECEF(23.5 + 1 / 3600, 121, 0);
  const enu = ecefToENU(b.x - a.x, b.y - a.y, b.z - a.z, 23.5, 121);
  assert.ok(Math.abs(enu.n - 30.75) < 0.05 && Math.abs(enu.e) < 1e-6);
});

test('float32 間隔與浮動原點', () => {
  assert.equal(float32Spacing(5e6), 0.5);
  assert.equal(float32Spacing(1e7), 1);
  assert.equal(float32Spacing(2.6e9), 256);       // TM2 北距（mm）直接當頂點：256 mm 的量化
  const root = new THREE.Group();
  const cam = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3(3.05e6, 0, -10) };
  cam.position.set(3.04e6, 1000, 0);
  const fo = createFloatingOrigin({ root, camera: cam, controls, threshold: 2e6, step: 1e5 });
  assert.equal(fo.update(), true);
  assert.deepEqual(fo.offset, { x: 3.0e6, y: 0, z: 0 });
  assert.equal(root.position.x, -3e6);
  assert.ok(Math.abs(cam.position.x - 4e4) < 1e-9);
  assert.ok(Math.abs(controls.target.x - 5e4) < 1e-9);
  assert.equal(fo.update(), false);              // 已經在門檻內
  assert.deepEqual(fo.toSite({ x: 4e4, y: 1000, z: 0 }), { x: 3.04e6, y: 1000, z: 0 });
  // 相機在渲染座標的位置 + root 的位移 = 不變的相對關係
  const rel = cam.position.x - root.position.x;
  assert.equal(rel, 3.04e6);
  fo.reset();
  assert.equal(root.position.x, 0);
  assert.ok(Math.abs(cam.position.x - 3.04e6) < 1e-9);
});
