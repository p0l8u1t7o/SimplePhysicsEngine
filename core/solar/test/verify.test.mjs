// 站層日照檢查（core/verify/solar.mjs）：固定式排距夠／不夠、追日回溯、對照組有效、決定性
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySolar } from '../../verify/solar.mjs';
import { winterSolsticePitch } from '../layout.js';

const site = { lat: 23.0, lon: 120.2, elevation: 15, tz: 8 };
const module = { length: 2278, width: 1134 };
const fixed = pitch => ({ verify: { solar: { site, step: 0.5, samples: [8, 2], layout: { type: 'fixed', rows: 3, modulesPerRow: 4, nUp: 2, module, tilt: 20, azimuth: 180, pitch, frontHeight: 600 } } } });

test('固定式：排距用冬至公式算的夠就通過；縮短就抓到遮陰', () => {
  const slope = 2 * module.length + 20, need = winterSolsticePitch({ lat: site.lat, slopeLength: slope, tilt: 20 }).pitch;
  const ok = verifySolar(fixed(Math.ceil(need * 1.03)));
  assert.equal(ok.applicable, true);
  assert.ok(ok.ok, JSON.stringify(ok.rows));
  const bad = verifySolar(fixed(Math.round(need * 0.85)));
  assert.equal(bad.ok, false);
  assert.match(bad.rows[0].note, /排距不夠/);
  assert.deepEqual(verifySolar(fixed(Math.ceil(need * 1.03))).rows, ok.rows, '同樣的設定兩次結果相同');
});

test('追日：回溯時不遮、對照組抓得到，並列出真追日的遮陰', () => {
  const r = verifySolar({ verify: { solar: { site, step: 0.5, samples: [8, 2], hours: [8, 16],
    layout: { type: 'tracker', rows: 3, modulesPerRow: 4, module, pitch: module.length / 0.4, height: 1800, axisAzimuth: 180, maxAngle: 60 } } } });
  assert.equal(r.rows.length, 3);
  assert.ok(r.ok, JSON.stringify(r.rows));                                  // 含對照組：列距比設計短時回溯擋不住
  assert.ok(r.rows[2].value !== '0.0%', '冬至 8 點真追日應該會列間遮陰');
});

test('外部遮擋：南側的塔樓另列一列，只有給 obstacleTol 才判定；列間遮陰那一列不受影響', () => {
  const slope = 2 * module.length + 20, pitch = Math.ceil(winterSolsticePitch({ lat: site.lat, slopeLength: slope, tilt: 20 }).pitch * 1.03);
  const tower = { name: '塔樓', box: { min: [-3000, 0, 9000], max: [3000, 15000, 13000] } };   // 陣列正南方 9 m、高 15 m
  const base = fixed(pitch), withTower = { verify: { solar: { ...base.verify.solar, obstacles: [tower] } } };
  const info = verifySolar(withTower), strict = verifySolar({ verify: { solar: { ...withTower.verify.solar, obstacleTol: 0.005 } } });
  assert.equal(info.rows.length, 3);
  assert.deepEqual(info.rows.slice(0, 2), verifySolar(base).rows, '列間遮陰與對照組不變');
  assert.match(info.rows[2].name, /塔樓/);
  assert.ok(parseFloat(info.rows[2].value) > 1, `塔樓應該遮到：${info.rows[2].value}`);
  assert.ok(info.ok, '沒給 obstacleTol 只當資訊');
  assert.equal(strict.ok, false, 'obstacleTol 0.5% 時要擋');
  const hill = verifySolar({ verify: { solar: { ...base.verify.solar, obstacles: [{ name: '地形', terrain: () => -50, min: [-20000, -20000], max: [20000, 30000], step: 5000 }] } } });
  assert.equal(hill.rows[2].value, '0.0%', '在板子下方的平地不會遮');
});

test('全年發電列：預期值在 2% 內通過、差 5% 擋下；沒給預期值時和上次結果比', () => {
  const slope = 2 * module.length + 20, pitch = Math.ceil(winterSolsticePitch({ lat: site.lat, slopeLength: slope, tilt: 20 }).pitch * 1.03);
  const dir = dirname(fileURLToPath(import.meta.url));
  const withEnergy = expect => ({ verify: { solar: { ...fixed(pitch).verify.solar, energy: { weather: 'fixtures/synthetic-tainan.epw.gz', moduleW: 580, ...(expect ? { expect } : {}) } } } });
  const first = verifySolar(withEnergy(null), { dir });
  const row = r => r.rows.find(x => x.name === '全年發電');
  assert.ok(first.energy.acKWh > 0);
  assert.equal(row(first).ok, true);
  assert.match(row(first).note, /第一次/);
  const ac = first.energy.acKWh;
  assert.ok(row(verifySolar(withEnergy({ acKWh: ac * 1.01, source: 'pvlib' }), { dir })).ok, '差 1% 通過');
  assert.equal(row(verifySolar(withEnergy({ acKWh: ac * 1.05, source: 'pvlib' }), { dir })).ok, false, '差 5% 擋下');
  const reg = verifySolar(withEnergy(null), { dir, previous: { energy: { acKWh: ac * 0.9 } } });
  assert.equal(row(reg).ok, false, '和上次差 10%（回歸）擋下');
  assert.match(row(reg).note, /上次結果/);
  assert.ok(row(verifySolar(withEnergy(null), { dir, previous: first })).ok, '和上次相同通過');
});

test('鋼構宣告（structure）：板片照鋼構算、日照與鋼構檢查列一起出；追日回溯不遮、對照組有效', () => {
  const trk = verifySolar({ verify: { solar: { site, step: 0.5, samples: [6, 2], hours: [8, 16],
    structure: { kind: 'tracker', axisAzimuth: 180, params: { rows: 3, across: 8, pitch: 5500, follow: 'line' } } } } });
  const sun = trk.rows.filter(r => r.group === '日照'), steel = trk.rows.filter(r => r.group.startsWith('鋼構'));
  assert.equal(sun.length, 3, '列間遮陰、對照組、真追日');
  assert.ok(sun[0].ok && sun[1].ok, JSON.stringify(sun));
  assert.ok(steel.length >= 5 && steel.every(r => typeof r.ok === 'boolean'), `鋼構檢查列 ${steel.length}`);
  assert.ok(trk.ok, JSON.stringify(trk.failures));
  const fix = verifySolar({ verify: { solar: { site, step: 0.5, samples: [6, 2],
    structure: { kind: 'fixed', azimuth: 180, params: { rows: 3, across: 6, up: 2, tilt: 20, pitch: 7500 } } } } });
  assert.ok(fix.rows.some(r => r.group.startsWith('鋼構')), '固定式也有鋼構列');
  assert.ok(fix.rows.find(r => r.group === '日照').ok, JSON.stringify(fix.rows[0]));
});

test('沒有宣告就略過', () => assert.equal(verifySolar({}).applicable, false));
