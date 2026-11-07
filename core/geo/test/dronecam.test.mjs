// 空拍相機對位：DJI 雲台角慣例、投影檢查、XMP／SRT 解析、視野角。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { droneCameraPose, fieldOfView, parseDJIXMP, parseDJISRT, extractXMP } from '../dronecam.js';
import { twd97, createSiteFrame } from '../coords.js';

const site = createSiteFrame({ crs: twd97(), origin: { lat: 23.0, lon: 120.2, H: 10 } });
const near = (v, x, y, z, eps = 1e-9) => Math.abs(v.x - x) < eps && Math.abs(v.y - y) < eps && Math.abs(v.z - z) < eps;

test('天底（pitch −90°、yaw 0）：往下看、畫面上方朝真北', () => {
  const pose = droneCameraPose({ lat: 23.0, lon: 120.2, alt: 110, yaw: 0, pitch: -90, roll: 0 }, site);
  assert.ok(near(pose.forward, 0, -1, 0));
  assert.ok(Math.abs(pose.position.y - 100000) < 1e-6);
  const n = site.directionFromAzimuth(0);
  assert.ok(near(pose.up, n.x, 0, n.z, 1e-9));
  // 投影：正下方的點在畫面中央，往真北 10 m 的點在畫面上半部
  const cam = new THREE.PerspectiveCamera(60, 4 / 3, 1, 1e7);
  droneCameraPose({ lat: 23.0, lon: 120.2, alt: 110, yaw: 0, pitch: -90 }, site, { camera: cam });
  cam.updateProjectionMatrix();
  const c = new THREE.Vector3(pose.position.x, 0, pose.position.z).project(cam);
  assert.ok(Math.abs(c.x) < 1e-9 && Math.abs(c.y) < 1e-9);
  const north = new THREE.Vector3(pose.position.x + n.x * 10000, 0, pose.position.z + n.z * 10000).project(cam);
  assert.ok(north.y > 0.1 && Math.abs(north.x) < 1e-9);
  const e = site.directionFromAzimuth(90);
  const east = new THREE.Vector3(pose.position.x + e.x * 10000, 0, pose.position.z + e.z * 10000).project(cam);
  assert.ok(east.x > 0.1 && Math.abs(east.y) < 1e-9);
});

test('水平看東（yaw 90、pitch 0）；roll 右側向下為正', () => {
  const p = droneCameraPose({ lat: 23.0, lon: 120.2, alt: 10, yaw: 90, pitch: 0, roll: 0 }, site);
  const e = site.directionFromAzimuth(90);
  assert.ok(near(p.forward, e.x, 0, e.z));
  assert.ok(near(p.up, 0, 1, 0));
  const r = droneCameraPose({ lat: 23.0, lon: 120.2, alt: 10, yaw: 0, pitch: 0, roll: 10 }, site);
  // 右側向下：相機上方向往右（東）偏
  const upEast = r.up.x * e.x + r.up.z * e.z;
  assert.ok(upEast > 0.17 && upEast < 0.18);
  // 往上仰 30°
  const u = droneCameraPose({ lat: 23.0, lon: 120.2, alt: 10, yaw: 0, pitch: 30 }, site);
  assert.ok(Math.abs(u.forward.y - 0.5) < 1e-9);
});

test('高度基準：橢球高減大地起伏；相對高度加起飛點', () => {
  const a = droneCameraPose({ lat: 23.0, lon: 120.2, alt: 130, yaw: 0, pitch: -90 }, site, { altitude: 'ellipsoidal', geoidN: 20 });
  assert.ok(Math.abs(a.position.y - 100000) < 1e-6);
  const b = droneCameraPose({ lat: 23.0, lon: 120.2, relAlt: 80, yaw: 0, pitch: -90 }, site, { altitude: 'relative', takeoffH: 30 });
  assert.ok(Math.abs(b.position.y - 100000) < 1e-6);
  assert.throws(() => droneCameraPose({ lat: 23, lon: 120.2, relAlt: 1, yaw: 0, pitch: 0 }, site, { altitude: 'relative' }), /takeoffH/);
});

test('XMP、SRT 解析與視野角', () => {
  const xmp = `<x:xmpmeta><rdf:Description drone-dji:GpsLatitude="+22.998765" drone-dji:GpsLongtitude="+120.201234"
    drone-dji:AbsoluteAltitude="+123.456" drone-dji:RelativeAltitude="+80.100" drone-dji:GimbalYawDegree="-12.30"
    drone-dji:GimbalPitchDegree="-89.90" drone-dji:GimbalRollDegree="+0.00" drone-dji:RtkFlag="50"/>
    <drone-dji:CalibratedFocalLength>3666.67</drone-dji:CalibratedFocalLength></x:xmpmeta>`;
  const m = parseDJIXMP(xmp);
  assert.equal(m.lat, 22.998765); assert.equal(m.lon, 120.201234);
  assert.equal(m.alt, 123.456); assert.equal(m.relAlt, 80.1);
  assert.equal(m.yaw, -12.3); assert.equal(m.pitch, -89.9); assert.equal(m.roll, 0);
  assert.equal(m.focalPx, 3666.67); assert.equal(m.rtkFlag, 50);
  const jpeg = new TextEncoder().encode('\xff\xd8 junk ' + xmp + ' tail');
  assert.ok(extractXMP(jpeg).includes('GimbalYawDegree'));
  const srt = `1\n00:00:00,000 --> 00:00:00,033\n<font size="28">FrameCnt: 1, DiffTime: 33ms\n2026-11-01 10:00:00.000\n[iso: 100] [shutter: 1/1000.0] [fnum: 2.8] [ev: 0] [focal_len: 24.00] [latitude: 22.998765] [longitude: 120.201234] [rel_alt: 80.100 abs_alt: 123.456] [gb_yaw: -12.3 gb_pitch: -45.0 gb_roll: 0.0] </font>\n\n2\n00:00:00,033 --> 00:00:00,066\n<font size="28">FrameCnt: 2\nGPS(120.201300,22.998800,80) </font>\n`;
  const f = parseDJISRT(srt);
  assert.equal(f.length, 2);
  assert.equal(f[0].lat, 22.998765); assert.equal(f[0].relAlt, 80.1); assert.equal(f[0].alt, 123.456);
  assert.equal(f[0].pitch, -45); assert.ok(Math.abs(f[1].t0 - 0.033) < 1e-9);
  assert.equal(f[1].lon, 120.2013); assert.equal(f[1].lat, 22.9988);
  // 24 mm 等效、4:3：對角 84°
  const v = fieldOfView({ focal35: 24, aspect: 4 / 3 });
  const diag = 2 * Math.atan(Math.hypot(Math.tan(v.hfov * Math.PI / 360), Math.tan(v.vfov * Math.PI / 360))) * 180 / Math.PI;
  assert.ok(Math.abs(diag - 84.06) < 0.05, `${diag}`);
});
