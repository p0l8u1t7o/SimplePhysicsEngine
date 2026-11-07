// 設計與現況比對：合成點雲帶已知偏差，報告要剛好抓到那幾項。
import test from 'node:test';
import assert from 'node:assert/strict';
import { measurePiles, asBuiltChecks, fitPlane, fitLine, summarize } from '../asbuilt.js';
import { twd97, createSiteFrame } from '../coords.js';
import { scenario } from './asbuilt-scenario.mjs';

const site = createSiteFrame({ crs: twd97(), origin: { E: 250000, N: 2600000, H: 20 } });

test('fitPlane／fitLine 基本性質', () => {
  const pts = [];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) pts.push({ x: x * 1000, y: -Math.tan(20 * Math.PI / 180) * z * 1000 + 5, z: z * 1000 });
  const f = fitPlane(pts, site);
  assert.ok(Math.abs(f.tiltDeg - 20) < 1e-9);
  assert.ok(Math.abs(f.downslope.z - 1) < 1e-12);                    // 往南（+Z）下坡
  assert.ok(Math.abs(f.aspectDeg - (180 + site.convergence)) < 1e-9); // 方格南 → 真方位角要加 γ
  const l = fitLine([{ x: 0, z: 0 }, { x: 1000, z: 10 }, { x: 2000, z: 0 }]);
  assert.ok(Math.abs(l.dir.z) < 1e-9 && l.maxResidual > 6 && l.maxResidual < 7);
});

test('點雲比對：抓到高程、平面、排距、缺樁、傾角偏差，其餘全部通過', () => {
  const sc = scenario();
  const piles = measurePiles(sc.design, { positions: sc.positions }, { searchRadius: 300 });
  const rows = asBuiltChecks(piles, { tables: sc.tables, site, tol: { aspectDeg: 2 } });
  const failed = rows.filter(r => !r.ok).map(r => r.name).sort();
  assert.deepEqual(failed, [
    '排 R2–R3 排距', '支架 R2 傾角', '樁 R1-P5 平面偏移', '樁 R2-P3 樁頂高程', '樁 R3-P6 找到',
    ...['R3-P1', 'R3-P2', 'R3-P3', 'R3-P4', 'R3-P5'].map(id => `樁 ${id} 平面偏移`),
  ].sort());
  const get = n => rows.find(r => r.name === n);
  assert.ok(Math.abs(get('樁 R2-P3 樁頂高程').dev - 45) < 5);
  assert.ok(Math.abs(get('樁 R1-P5 平面偏移').dev - 80) < 5);
  assert.ok(Math.abs(get('排 R2–R3 排距').dev - 120) < 5);
  assert.ok(Math.abs(get('排 R1–R2 排距').dev) < 5);
  assert.ok(Math.abs(get('支架 R2 傾角').dev - 2) < 0.05);
  assert.ok(Math.abs(get('支架 R1 傾角').dev) < 0.05);
  const s = summarize(rows);
  assert.equal(s.fail, failed.length);
  // 決定性
  assert.deepEqual(asBuiltChecks(measurePiles(sc.design, { positions: sc.positions }), { tables: sc.tables, site }), rows);
});

test('DSM（高程取樣）來源：樁頂高程與平面位置', () => {
  const sc = scenario();
  // 以理想 DSM（50 mm 像素）表示：樁的頂面是 100 mm 方形平台
  const heightAt = (x, z) => {
    for (const a of sc.asBuilt) if (!a.missing && Math.abs(x - a.x) <= 50 && Math.abs(z - a.z) <= 50) return a.top;
    return sc.ground(x, z);
  };
  const piles = measurePiles(sc.design, { heightAt, resolution: 25 }, { searchRadius: 300 });
  const p = piles.find(q => q.id === 'R2-P3');
  assert.ok(Math.abs(p.measured.top - p.design.top - 45) < 1e-6);
  const q = piles.find(q => q.id === 'R1-P5');
  assert.ok(Math.abs(q.measured.x - q.design.x - 80) <= 25);
  assert.equal(piles.find(q => q.id === 'R3-P6').measured, null);
});
