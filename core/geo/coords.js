// core/geo/coords.js：大地座標轉換（WGS84／TWD97 TM2／UTM／通用橫麥卡托）與案場座標系。
// 純數學、沒有相依、沒有亂數，瀏覽器與 Node 結果相同（float64）。
//
// 橫麥卡托（Transverse Mercator）用 Krüger n 級數展到 n^6（Karney 2011，PROJ 6 起預設的 tmerc 也是這個做法），
// 離中央經線 ±3.5° 內誤差在奈米～微米級；只限 |Δλ| 不大的範圍（TM2、UTM 都在這個範圍內）。

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------------------------------------------------------------- 橢球
export const ELLIPSOIDS = {
  GRS80: { a: 6378137, f: 1 / 298.257222101 },
  WGS84: { a: 6378137, f: 1 / 298.257223563 },
};

function ellipsoid(e) {
  const el = typeof e === 'string' ? ELLIPSOIDS[e] : e;
  if (!el) throw new Error(`未知的橢球：${e}`);
  const { a, f } = el;
  const e2 = f * (2 - f);
  return { a, f, e2, e: Math.sqrt(e2), b: a * (1 - f) };
}

// ---------------------------------------------------------------- 橫麥卡托
/**
 * 建立橫麥卡托投影。
 * @param {object} p
 * @param {number} p.lon0 中央經線（度）
 * @param {number} [p.lat0=0] 原點緯度（度）
 * @param {number} [p.k0=0.9996] 中央經線尺度
 * @param {number} [p.x0=0] 東偏（m）
 * @param {number} [p.y0=0] 北偏（m）
 * @param {string|object} [p.ellps='WGS84']
 * @returns {{ forward(lat, lon): {E, N}, inverse(E, N): {lat, lon}, convergence(lat, lon): number, scale(lat, lon): number, params }}
 */
export function transverseMercator({ lon0, lat0 = 0, k0 = 0.9996, x0 = 0, y0 = 0, ellps = 'WGS84', name } = {}) {
  if (!Number.isFinite(lon0)) throw new Error('transverseMercator 需要 lon0');
  const el = ellipsoid(ellps);
  const { a, e } = el;
  const n = el.f / (2 - el.f);
  const n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  // Krüger 係數（Karney 2011，式 35、36）
  const alpha = [0,
    n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
    13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
    61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
    49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
    34729 * n5 / 80640 - 3418889 * n6 / 1995840,
    212378941 * n6 / 319334400,
  ];
  const beta = [0,
    n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360 - 81 * n5 / 512 + 96199 * n6 / 604800,
    n2 / 48 + n3 / 15 - 437 * n4 / 1440 + 46 * n5 / 105 - 1118711 * n6 / 3870720,
    17 * n3 / 480 - 37 * n4 / 840 - 209 * n5 / 4480 + 5569 * n6 / 90720,
    4397 * n4 / 161280 - 11 * n5 / 504 - 830251 * n6 / 7257600,
    4583 * n5 / 161280 - 108847 * n6 / 3991680,
    20648693 * n6 / 638668800,
  ];
  const lam0 = lon0 * D2R;

  // 地理緯度 → 等角緯度的 tan（τ'）
  const tauPrime = tau => {
    const sig = Math.sinh(e * Math.atanh(e * tau / Math.hypot(1, tau)));
    return tau * Math.hypot(1, sig) - sig * Math.hypot(1, tau);
  };
  // τ' → τ（牛頓法，Karney 2011 式 19～21）
  const tauFromPrime = tp => {
    let tau = tp;
    for (let i = 0; i < 8; i++) {
      const tpi = tauPrime(tau);
      const d = (tp - tpi) * (1 + (1 - el.e2) * tau * tau) / ((1 - el.e2) * Math.hypot(1, tpi) * Math.hypot(1, tau));
      tau += d;
      if (Math.abs(d) < 1e-14 * Math.max(1, Math.abs(tau))) break;
    }
    return tau;
  };

  function raw(lat, lon) {
    const phi = lat * D2R;
    let lam = lon * D2R - lam0;
    lam = Math.atan2(Math.sin(lam), Math.cos(lam));    // 正規化到 ±π
    const t = tauPrime(Math.tan(phi));
    const xip = Math.atan2(t, Math.cos(lam));
    const etap = Math.asinh(Math.sin(lam) / Math.hypot(t, Math.cos(lam)));
    let xi = xip, eta = etap;
    for (let j = 1; j <= 6; j++) {
      xi += alpha[j] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
      eta += alpha[j] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
    }
    return { xi, eta };
  }
  const xi0 = lat0 ? raw(lat0, lon0).xi : 0;

  function forward(lat, lon) {
    const { xi, eta } = raw(lat, lon);
    return { E: x0 + k0 * A * eta, N: y0 + k0 * A * (xi - xi0) };
  }

  function inverse(E, N) {
    const xi = (N - y0) / (k0 * A) + xi0;
    const eta = (E - x0) / (k0 * A);
    let xip = xi, etap = eta;
    for (let j = 1; j <= 6; j++) {
      xip -= beta[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      etap -= beta[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const tp = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip));
    const lam = Math.atan2(Math.sinh(etap), Math.cos(xip));
    const tau = tauFromPrime(tp);
    let lon = (lam0 + lam) * R2D;
    if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
    return { lat: Math.atan(tau) * R2D, lon };
  }

  // 子午線收斂角 γ（度）：真北在方格北的逆時針方向 γ（中央經線以東、北半球 γ > 0）。
  // 用數值中央差分（1e-5 rad ≈ 64 m），和 PROJ 相差 < 1e-9°；方格方位角 = 真方位角 − γ。
  function convergence(lat, lon) {
    const h = 1e-5 * R2D;
    const p = forward(lat + h, lon), m = forward(lat - h, lon);
    return -Math.atan2(p.E - m.E, p.N - m.N) * R2D;
  }
  // 點尺度係數 k（方格距離 ÷ 橢球面距離）
  function scale(lat, lon) {
    const h = 1e-4;
    const p = forward(lat, lon + h), m = forward(lat, lon - h);
    const phi = lat * D2R;
    const N = a / Math.sqrt(1 - el.e2 * Math.sin(phi) ** 2);       // 卯酉圈曲率半徑
    const ds = N * Math.cos(phi) * 2 * h * D2R;                       // 平行圈上的弧長
    return Math.hypot(p.E - m.E, p.N - m.N) / ds;
  }

  return {
    forward, inverse, convergence, scale,
    params: { name: name || 'tmerc', lon0, lat0, k0, x0, y0, ellps: typeof ellps === 'string' ? ellps : 'custom' },
  };
}

// ---------------------------------------------------------------- 常用座標系
/** TWD97 TM2（本島 121°E，EPSG:3826；澎湖 119°E，EPSG:3825）。TWD97 與 WGS84 視為同一基準（同 EPSG 定義的 towgs84=0）。 */
export function twd97(lon0 = 121) {
  return transverseMercator({ lon0, k0: 0.9999, x0: 250000, y0: 0, ellps: 'GRS80', name: `TWD97 TM2 ${lon0}` });
}

/** UTM（WGS84）。zone 1～60；south 為南半球（北偏 10,000 km）。台灣多半是 51N（EPSG:32651），120°E 以西是 50N。 */
export function utm(zone, south = false) {
  if (!(zone >= 1 && zone <= 60)) throw new Error(`UTM zone 不合法：${zone}`);
  return transverseMercator({ lon0: -183 + 6 * zone, k0: 0.9996, x0: 500000, y0: south ? 10000000 : 0, ellps: 'WGS84', name: `UTM ${zone}${south ? 'S' : 'N'}` });
}

/** 依經度算 UTM zone（不處理挪威、斯瓦巴例外） */
export const utmZone = lon => Math.min(60, Math.floor((lon + 180) / 6) + 1);

/**
 * 由 EPSG 代碼取得投影。回傳 null 表示不支援（例如 TWD67 需要基準轉換）。
 * 地理座標（4326、3824 TWD97 經緯度）回傳 { geographic: true }。
 */
export function crsFromEPSG(code) {
  code = Number(code);
  if (code === 3826) return Object.assign(twd97(121), { epsg: 3826 });
  if (code === 3825) return Object.assign(twd97(119), { epsg: 3825 });
  if (code >= 32601 && code <= 32660) return Object.assign(utm(code - 32600, false), { epsg: code });
  if (code >= 32701 && code <= 32760) return Object.assign(utm(code - 32700, true), { epsg: code });
  if (code === 4326 || code === 3824 || code === 4979) return { geographic: true, epsg: code };
  return null;
}

// ---------------------------------------------------------------- 地心座標（ECEF）與 ENU
export function geodeticToECEF(lat, lon, h = 0, ellps = 'WGS84') {
  const { a, e2 } = ellipsoid(ellps);
  const phi = lat * D2R, lam = lon * D2R;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return {
    x: (N + h) * Math.cos(phi) * Math.cos(lam),
    y: (N + h) * Math.cos(phi) * Math.sin(lam),
    z: (N * (1 - e2) + h) * Math.sin(phi),
  };
}

/** ECEF 向量在 (lat, lon) 處的東、北、上分量 */
export function ecefToENU(dx, dy, dz, lat, lon) {
  const phi = lat * D2R, lam = lon * D2R;
  const sp = Math.sin(phi), cp = Math.cos(phi), sl = Math.sin(lam), cl = Math.cos(lam);
  return {
    e: -sl * dx + cl * dy,
    n: -sp * cl * dx - sp * sl * dy + cp * dz,
    u: cp * cl * dx + cp * sl * dy + sp * dz,
  };
}

// ---------------------------------------------------------------- 案場座標系
/**
 * 案場座標系（框架慣例：單位 mm、+X 東、+Y 上、+Z 南，也就是北 = −Z；和 ParkingEMS 等站一致）。
 *
 * 平面用投影的方格座標（TM2 或 UTM 公尺）相對原點，高程用正高（DSM 的高程，通常是 TWVD2001）相對原點高程。
 * - `rotation`（度，選用）：案場座標再繞 +Y 轉，讓排列方向對齊 X 軸；正值表示案場 +X 從方格東往北轉（俯視逆時針）。
 * - `ground: true`（選用）：除以原點的綜合尺度係數（點尺度 × 高程尺度），讓案場長度等於地面實長（鋼構切長用）；
 *   預設 false，案場長度等於方格長度，和空拍成果（正射、DSM、點雲都在方格座標）一致。
 *
 * @param {object} o
 * @param {object} o.crs 投影（twd97()、utm()…）
 * @param {{E:number,N:number,H?:number}|{lat:number,lon:number,H?:number}} o.origin 原點（方格公尺或經緯度）
 * @param {number} [o.rotation=0]
 * @param {boolean} [o.ground=false]
 */
export function createSiteFrame({ crs, origin, rotation = 0, ground = false } = {}) {
  if (!crs || !crs.forward) throw new Error('createSiteFrame 需要 crs');
  const o = 'E' in origin ? { E: origin.E, N: origin.N } : crs.forward(origin.lat, origin.lon);
  const H0 = origin.H || 0;
  const ll = crs.inverse(o.E, o.N);
  const gamma = crs.convergence(ll.lat, ll.lon);
  const kPoint = crs.scale(ll.lat, ll.lon);
  const kHeight = 6371000 / (6371000 + H0);                    // 高程尺度（平均地球半徑近似）
  const kCombined = kPoint * kHeight;
  const s = ground ? 1000 / kCombined : 1000;                  // 公尺 → mm（含尺度）
  const r = rotation * D2R, cr = Math.cos(r), sr = Math.sin(r);

  /** 方格 E、N、正高 H（m）→ 案場 {x, y, z}（mm） */
  function fromMap(E, N, H = H0) {
    const de = (E - o.E) * s, dn = (N - o.N) * s;
    // 先轉成未旋轉的 (x=東, z=南)，再繞 Y 轉 rotation
    const x0 = de, z0 = -dn;
    return { x: cr * x0 - sr * z0 + 0, y: (H - H0) * 1000 + 0, z: sr * x0 + cr * z0 + 0 };   // + 0：不輸出 −0
  }
  /** 案場 (x, y, z) mm → 方格 {E, N, H} */
  function toMap(x, y = 0, z = 0) {
    const x0 = cr * x + sr * z, z0 = -sr * x + cr * z;
    return { E: o.E + x0 / s, N: o.N - z0 / s, H: H0 + y / 1000 };
  }
  const fromLatLon = (lat, lon, H = H0) => { const p = crs.forward(lat, lon); return fromMap(p.E, p.N, H); };
  const toLatLon = (x, y = 0, z = 0) => { const m = toMap(x, y, z); const g = crs.inverse(m.E, m.N); return { lat: g.lat, lon: g.lon, H: m.H }; };

  /** 真方位角（度，北起順時針）→ 案場平面的單位向量 {x, z}（案場 x、z 分量） */
  function directionFromAzimuth(azTrue) {
    const az = (azTrue - gamma) * D2R;                         // 方格方位角
    const x0 = Math.sin(az), z0 = -Math.cos(az);
    return { x: cr * x0 - sr * z0, z: sr * x0 + cr * z0 };
  }
  /** 案場平面方向 → 真方位角（度，0～360） */
  function azimuthOf(x, z) {
    const x0 = cr * x + sr * z, z0 = -sr * x + cr * z;
    const az = Math.atan2(x0, -z0) * R2D + gamma;
    return ((az % 360) + 360) % 360;
  }

  return {
    crs, origin: { E: o.E, N: o.N, H: H0, lat: ll.lat, lon: ll.lon },
    rotation, ground,
    convergence: gamma,          // 度；真北 = 方格北逆時針轉 γ
    scaleFactor: kPoint, combinedScale: kCombined,
    fromMap, toMap, fromLatLon, toLatLon, directionFromAzimuth, azimuthOf,
    /** 給 core/solar 用：案場 −Z（方格北）相對真北的方位差（度）。太陽方位角要減掉這個值再換成案場方向。 */
    northOffset: gamma - rotation,
  };
}

// ---------------------------------------------------------------- 浮動原點
/**
 * float32 在某個量級的有效間隔（ULP，單位同輸入）。例：float32Spacing(5e6) = 0.5（5 km 用 mm 時頂點量化 0.5 mm）。
 */
export function float32Spacing(v) {
  const m = Math.abs(v);
  if (m === 0) return 1.401298464324817e-45;
  return 2 ** (Math.floor(Math.log2(m)) - 23);
}

/**
 * 浮動原點（重定原點）：場景內容放在 `root` 群組底下，相機離目前原點超過 `threshold` 時，
 * 把 root、相機（與 controls.target）一起平移，平移量取 `step` 的整數倍，讓渲染用的座標一直在相機附近。
 *
 * three.js 在 CPU 上以 float64 算 modelViewMatrix，所以「物件原點離相機很遠」本身沒問題；
 * 會抖的是 (1) 頂點本身的座標太大（一整片 km 級網格放在一個 BufferGeometry 裡），
 * (2) shader 裡用世界座標的東西（陰影貼圖座標、環境反射、worldPosition）是 float32。
 * 第 (1) 項用分塊（每塊頂點相對自己的中心、塊的位置放在 Object3D.position）解決，見 terrain.js；
 * 第 (2) 項在案場超過約 8 km（8e6 mm，float32 間隔 1 mm）或要很近看細節時才需要本函式。
 *
 * 決定性：平移量只依相機位置與 step 決定；`apply(t)` 與檢查工具不呼叫 update()，看到的就是原始的案場座標。
 *
 * @param {object} o
 * @param {THREE.Object3D} o.root 案場內容的根群組（直接放在 scene 底下）
 * @param {THREE.Camera} o.camera
 * @param {{target: THREE.Vector3, update?: Function}} [o.controls]
 * @param {number} [o.threshold=2e6] 相機離原點多遠（mm）才平移
 * @param {number} [o.step=1e5] 平移量的格距（mm）
 */
export function createFloatingOrigin({ root, camera, controls, threshold = 2e6, step = 1e5 } = {}) {
  const offset = { x: 0, y: 0, z: 0 };    // 目前的原點在案場座標的位置（root.position = −offset）
  const listeners = [];
  function shift(dx, dy, dz) {
    if (!dx && !dy && !dz) return false;
    offset.x += dx; offset.y += dy; offset.z += dz;
    root.position.set(0 - offset.x, 0 - offset.y, 0 - offset.z);
    root.updateMatrixWorld(true);
    camera.position.x -= dx; camera.position.y -= dy; camera.position.z -= dz;
    camera.updateMatrixWorld(true);
    if (controls && controls.target) { controls.target.x -= dx; controls.target.y -= dy; controls.target.z -= dz; }
    for (const f of listeners) f({ dx, dy, dz, offset: { ...offset } });
    return true;
  }
  return {
    offset,
    /** 每格呼叫：相機（渲染座標）離原點超過門檻就平移，回傳是否有平移 */
    update() {
      const p = camera.position;
      if (Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) < threshold) return false;
      const snap = v => Math.round(v / step) * step;
      return shift(snap(p.x), snap(p.y), snap(p.z));
    },
    /** 回到案場原點（截圖、檢查前） */
    reset() { return shift(-offset.x, -offset.y, -offset.z); },
    /** 渲染座標 ↔ 案場座標 */
    toSite: v => ({ x: v.x + offset.x, y: v.y + offset.y, z: v.z + offset.z }),
    toRender: v => ({ x: v.x - offset.x, y: v.y - offset.y, z: v.z - offset.z }),
    onShift(f) { listeners.push(f); },
  };
}
