// core/geo/dronecam.js：空拍照片／影片畫格的相機對位（GPS＋雲台姿態 → three.js 相機在案場座標的位置與方向）。
//
// 假設（DJI 慣例，見 README「空拍相機對位」）：
// - 雲台角是 NED 機體座標的 Z-Y-X 歐拉角：yaw 從真北順時針（度），pitch 0 = 水平、−90 = 正下（天底），roll 右側向下為正。
// - GimbalYawDegree 是相對真北的絕對角（不是相對機頭）；若實測有固定偏差（磁偏角約 −4.5°），用 yawOffset 修正。
// - 高度：AbsoluteAltitude 的基準因機型而異（多數非 RTK 機型是 EGM96 正高，RTK 機型可能是橢球高），非 RTK 時誤差可達 ±10 m；
//   建議用 RelativeAltitude（相對起飛點）＋起飛點地面高程（DSM 取樣）。
// - 不處理鏡頭畸變（先用 DewarpData 或 OpenCV 去畸變），也不處理 GPS 天線到鏡頭的偏移（約 10～20 cm）。
import * as THREE from 'three';

const D2R = Math.PI / 180;

/**
 * 依 GPS 與雲台姿態算相機位姿。
 * @param {object} p
 * @param {number} p.lat
 * @param {number} p.lon
 * @param {number} [p.alt] 絕對高度（m，基準見 o.altitude）
 * @param {number} [p.relAlt] 相對起飛點高度（m；o.altitude = 'relative' 時用）
 * @param {number} p.yaw 度
 * @param {number} p.pitch 度
 * @param {number} [p.roll=0] 度
 * @param {object} site createSiteFrame()
 * @param {object} [o]
 * @param {'orthometric'|'ellipsoidal'|'relative'} [o.altitude='orthometric'] 高度基準（案場高程是正高）
 * @param {number} [o.geoidN=0] 大地起伏（m，橢球高 − 正高；台灣約 17～27 m）
 * @param {number} [o.takeoffH] 起飛點地面正高（m；relative 用）
 * @param {number} [o.yawOffset=0] 偏航修正（度）
 * @param {THREE.Camera} [o.camera] 給的話直接設定 position／quaternion
 * @returns {{ position: THREE.Vector3, quaternion: THREE.Quaternion, forward: THREE.Vector3, up: THREE.Vector3 }}
 */
export function droneCameraPose(p, site, o = {}) {
  const mode = o.altitude || 'orthometric';
  let H;
  if (mode === 'relative') {
    if (!Number.isFinite(o.takeoffH)) throw new Error('altitude = relative 需要 takeoffH（起飛點地面正高）');
    H = o.takeoffH + p.relAlt;
  } else H = mode === 'ellipsoidal' ? p.alt - (o.geoidN || 0) : p.alt;
  const s = site.fromLatLon(p.lat, p.lon, H);
  const position = new THREE.Vector3(s.x, s.y, s.z);

  // NED 歐拉角 → 旋轉矩陣 R = Rz(yaw)·Ry(pitch)·Rx(roll)
  const y = ((p.yaw || 0) + (o.yawOffset || 0)) * D2R, t = (p.pitch || 0) * D2R, r = (p.roll || 0) * D2R;
  const cy = Math.cos(y), sy = Math.sin(y), ct = Math.cos(t), st = Math.sin(t), cr = Math.cos(r), sr = Math.sin(r);
  const R = [
    [cy * ct, cy * st * sr - sy * cr, cy * st * cr + sy * sr],
    [sy * ct, sy * st * sr + cy * cr, sy * st * cr - cy * sr],
    [-st, ct * sr, ct * cr],
  ];
  const col = k => [R[0][k], R[1][k], R[2][k]];        // 機體軸在 NED 的分量：0 前、1 右、2 下
  // NED → 案場：北、東用真方位角換成案場平面方向（含子午線收斂角與案場旋轉），下 = −Y
  const dN = site.directionFromAzimuth(0), dE = site.directionFromAzimuth(90);
  const toSite = ([n, e, d]) => new THREE.Vector3(n * dN.x + e * dE.x, -d, n * dN.z + e * dE.z);
  const forward = toSite(col(0)).normalize();
  const right = toSite(col(1)).normalize();
  const up = toSite(col(2)).multiplyScalar(-1).normalize();
  // three.js 相機：+X 右、+Y 上、−Z 視線
  const m = new THREE.Matrix4().makeBasis(right, up, forward.clone().multiplyScalar(-1));
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  if (o.camera) {
    o.camera.position.copy(position);
    o.camera.quaternion.copy(quaternion);
    o.camera.updateMatrixWorld(true);
  }
  return { position, quaternion, forward, up };
}

/**
 * 視野角。給 35 mm 等效焦距，或實際焦距＋感測器尺寸。
 * @returns {{ hfov: number, vfov: number }} 度；three.js 的 PerspectiveCamera.fov 用 vfov
 */
export function fieldOfView({ focal35, focalMm, sensorWidth, sensorHeight, aspect = 4 / 3 }) {
  let w, h, f;
  if (focal35) {
    // 35 mm 等效焦距以對角線 43.27 mm 定義
    const diag = Math.hypot(36, 24);
    const d = diag / Math.hypot(1, 1 / aspect);
    w = d; h = d / aspect; f = focal35;
  } else { w = sensorWidth; h = sensorHeight; f = focalMm; }
  return { hfov: 2 * Math.atan(w / (2 * f)) / D2R, vfov: 2 * Math.atan(h / (2 * f)) / D2R };
}

const num = s => (s == null ? undefined : Number(String(s).replace(/^\+/, '')));

/**
 * 解析 DJI 照片的 XMP（屬性或元素寫法都可以；舊韌體把 Longitude 拼成 Longtitude 也認得）。
 * @param {string} xmp XMP 文字（照片檔裡 `<x:xmpmeta` … `</x:xmpmeta>` 那段）
 */
export function parseDJIXMP(xmp) {
  const get = name => {
    const re = new RegExp(`drone-dji:${name}\\s*=\\s*"([^"]*)"|<drone-dji:${name}>([^<]*)<`, 'i');
    const m = xmp.match(re);
    return m ? (m[1] ?? m[2]) : undefined;
  };
  return {
    lat: num(get('GpsLatitude') ?? get('Latitude')),
    lon: num(get('GpsLongitude') ?? get('GpsLongtitude') ?? get('Longitude')),
    alt: num(get('AbsoluteAltitude')),
    relAlt: num(get('RelativeAltitude')),
    yaw: num(get('GimbalYawDegree')), pitch: num(get('GimbalPitchDegree')), roll: num(get('GimbalRollDegree')),
    flightYaw: num(get('FlightYawDegree')), flightPitch: num(get('FlightPitchDegree')), flightRoll: num(get('FlightRollDegree')),
    focalPx: num(get('CalibratedFocalLength')),
    cx: num(get('CalibratedOpticalCenterX')), cy: num(get('CalibratedOpticalCenterY')),
    rtkFlag: num(get('RtkFlag')), rtkStd: [num(get('RtkStdLon')), num(get('RtkStdLat')), num(get('RtkStdHgt'))],
    dewarp: get('DewarpData'),
  };
}

/** 從 JPEG 位元組找出 XMP 文字（不解 EXIF） */
export function extractXMP(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const s = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 1 << 20)));
  const i = s.indexOf('<x:xmpmeta'), j = s.indexOf('</x:xmpmeta>');
  return i >= 0 && j > i ? s.slice(i, j + 12) : null;
}

/**
 * 解析 DJI 影片的 SRT 字幕（每格的 GPS、高度；部分機型有雲台角 gb_yaw／gb_pitch／gb_roll）。
 * @returns {Array<{ index, t0, t1, lat, lon, relAlt, alt, yaw?, pitch?, roll?, fields }>} t0、t1 秒
 */
export function parseDJISRT(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  const ts = s => { const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : NaN; };
  const out = [];
  for (const b of blocks) {
    const lines = b.trim().split('\n');
    if (lines.length < 2) continue;
    const tl = lines.find(l => l.includes('-->'));
    if (!tl) continue;
    const [a, c] = tl.split('-->');
    const body = lines.slice(lines.indexOf(tl) + 1).join(' ').replace(/<[^>]+>/g, ' ');
    const fields = {};
    for (const m of body.matchAll(/([A-Za-z_]+)\s*[:=]\s*([-+]?\d+(?:\.\d+)?)/g)) fields[m[1].toLowerCase()] = Number(m[2]);
    // 舊格式：GPS(lon,lat,alt)
    const g = body.match(/GPS\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)/);
    const f = {
      index: Number(lines[0]) || out.length + 1, t0: ts(a), t1: ts(c),
      lat: fields.latitude ?? (g ? Number(g[2]) : undefined),
      lon: fields.longitude ?? fields.longtitude ?? (g ? Number(g[1]) : undefined),
      relAlt: fields.rel_alt ?? fields.h, alt: fields.abs_alt ?? fields.altitude,
      yaw: fields.gb_yaw, pitch: fields.gb_pitch, roll: fields.gb_roll, fields,
    };
    out.push(f);
  }
  return out;
}
