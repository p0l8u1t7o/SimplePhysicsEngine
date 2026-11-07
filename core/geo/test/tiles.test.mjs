// 3D Tiles 的座標（core/geo/tiles.js）：ECEF ↔ 經緯度、剛體轉換的誤差隨距離增加、精確轉換和 site.fromLatLon 相同
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { twd97, createSiteFrame, geodeticToECEF } from '../coords.js';
import { ecefToGeodetic, siteFromECEF, siteFromECEFExact } from '../tiles.js';

const site = createSiteFrame({ crs: twd97(), origin: { E: 182000, N: 2543000, H: 30 } });
const ecef = (lat, lon, h) => { const p = geodeticToECEF(lat, lon, h); return [p.x, p.y, p.z]; };

test('ECEF → 經緯度：來回誤差 < 1e-9° 與 0.1 mm', () => {
  for (const [lat, lon, h] of [[23, 120.2, 30], [25.03, 121.56, 512.3], [-33.9, 151.2, 0], [60.1, 10.7, 1500], [0.1, -78, 2800]]) {
    const g = ecefToGeodetic(...ecef(lat, lon, h));
    assert.ok(Math.abs(g.lat - lat) < 1e-9 && Math.abs(g.lon - lon) < 1e-9 && Math.abs(g.h - h) < 1e-4, JSON.stringify(g));
  }
});

test('剛體轉換：原點對到 0、100 m 內和精確位置差 < 3 mm；1 km 外差到公分級（地球曲率），精確轉換和 fromLatLon 相同', () => {
  const M = siteFromECEF(site), o = site.origin;
  const at = (x, z) => { const ll = site.toLatLon(x, 0, z); return ll; };
  const rigid = p => new THREE.Vector3(...p).applyMatrix4(M);
  const p0 = rigid(ecef(o.lat, o.lon, o.H));
  assert.ok(p0.length() < 1e-3, `原點 ${p0.toArray()}`);
  const dev = (x, z) => {
    const ll = at(x, z), e = ecef(ll.lat, ll.lon, o.H), r = rigid(e), s = siteFromECEFExact(site, ...e);
    assert.ok(Math.abs(s[0] - x) < 1e-3 && Math.abs(s[2] - z) < 1e-3 && Math.abs(s[1]) < 1e-3, `精確轉換 ${s}`);
    return r.distanceTo(new THREE.Vector3(...s));
  };
  assert.ok(dev(100000, 0) < 3 && dev(0, -100000) < 3, `100 m：${dev(100000, 0).toFixed(2)} mm`);
  const far = dev(1000000, 0);
  assert.ok(far > 50 && far < 120, `1 km 的剛體誤差 ${far.toFixed(1)} mm（曲率約 78 mm）`);
});

test('geoidOffset：橢球高 = 正高 + N，原點仍對到 0', () => {
  const N = 20.3, M = siteFromECEF(site, { geoidOffset: N }), o = site.origin;
  const p = new THREE.Vector3(...ecef(o.lat, o.lon, o.H + N)).applyMatrix4(M);
  assert.ok(p.length() < 1e-3, p.toArray().join());
  const s = siteFromECEFExact(site, ...ecef(o.lat, o.lon, o.H + N + 1.5), { geoidOffset: N });
  assert.ok(Math.abs(s[1] - 1500) < 1e-3, `高 1.5 m → ${s[1]} mm`);
});

test('vendor 的 TilesRenderer 在 Node 載得進來', async () => {
  const { TilesRenderer } = await import('../../vendor/3d-tiles-renderer/index.three.js');
  assert.equal(typeof TilesRenderer, 'function');
});
