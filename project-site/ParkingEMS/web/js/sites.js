// 三種標準場型的配置與設備規模（單位 mm；X 往東、Y 往上、Z 往南）。
// 車位分級照提案：旗艦型 100 車位以上、住商型 50–99、都會型 20–49。照片只用於空間辨識，
// 車位數、設備位置、容量與契約容量都是「假設」，要依現勘、用電資料與設備報價重算。
// 車位 2.5 × 5.0 m、車道 6 m、交叉車道 6 m（假設）；北側是 −Z，街道在南側（+Z）。

export const STALL = { w: 2500, d: 5000 };
export const AISLE = 6000;
export const CAR = { len: 4500, w: 1820, h: 1450, wheelR: 330, wheelBase: 2800 };
export const STRIP = 3000;          // 場地外緣的人行與植栽帶

// 版面字串：R＝一排車位、A＝車道（由北往南）
function buildLot(perRow, pattern, removed = []) {
  const depth = [...pattern].reduce((s, c) => s + (c === 'R' ? STALL.d : AISLE), 0);
  const halfX = perRow * STALL.w / 2;
  let z = -depth / 2;
  const bands = [...pattern].map(c => { const b = { c, z0: z, z1: z + (c === 'R' ? STALL.d : AISLE) }; z = b.z1; b.zc = (b.z0 + b.z1) / 2; return b; });
  const rows = [], aisles = bands.filter(b => b.c === 'A').map(b => ({ zc: b.zc, z0: b.z0, z1: b.z1 }));
  bands.forEach((b, i) => {
    if (b.c !== 'R') return;
    // 車從相鄰車道開進來，車頭朝離開車道的方向（dir：車頭沿 Z 的方向）
    const prev = bands[i - 1]?.c === 'A' ? bands[i - 1] : null, next = bands[i + 1]?.c === 'A' ? bands[i + 1] : null;
    const aisle = prev || next, dir = prev ? 1 : -1;
    rows.push({ i: rows.length, z0: b.z0, z1: b.z1, zc: b.zc, dir, aisleZ: aisle.zc, x0: -halfX, n: perRow });
  });
  const gone = new Set(removed);
  const stalls = [];
  for (const r of rows) for (let j = 0; j < r.n; j++) if (!gone.has(`${r.i},${j}`)) stalls.push({ row: r.i, j, x: r.x0 + (j + .5) * STALL.w, z: r.zc, dir: r.dir, aisleZ: r.aisleZ });
  return {
    perRow, pattern, rows, aisles, stalls, removed: [...gone],
    x0: -halfX - AISLE, x1: halfX + AISLE, z0: -depth / 2, z1: depth / 2, halfX, depth,
    west: { x0: -halfX - AISLE, x1: -halfX, xc: -halfX - AISLE / 2 }, east: { x0: halfX, x1: halfX + AISLE, xc: halfX + AISLE / 2 },
  };
}
export const stallAt = (lot, row, j) => { const r = lot.rows[row]; return { row, j, x: r.x0 + (j + .5) * STALL.w, z: r.zc, dir: r.dir, aisleZ: r.aisleZ }; };

// ---------------------------------------------------------------- 旗艦型：150 車位級，開闊露天、光電車棚
const F = buildLot(25, 'RARRARRAR', ['4,22', '4,23']);       // 第 5 排東端兩格改成 DC 充電島
const fCarport = (() => {
  // T 型雙懸臂車棚蓋在背對背的第 2、3 排（z −13000～−3000），立柱在兩排車頭交界線上
  const zLine = F.rows[1].z1;                                  // −8000
  const cols = [2, 5, 8, 11, 14, 17, 20, 23].map(j => F.rows[1].x0 + j * STALL.w);   // 立柱在車位分隔線上，跨距 7.5 m
  const mod = { w: 1134, l: 2278, gap: 20, kw: .52 };          // 520 Wp 模組（假設）、直放 4 片
  const nx = 48, ny = 4, len = nx * (mod.w + mod.gap) - mod.gap, wid = ny * (mod.l + mod.gap) - mod.gap;
  return { zLine, cols, mod, nx, ny, x0: -len / 2, x1: len / 2, z0: zLine - wid / 2, z1: zLine + wid / 2, bays: 8, colH: 3400, tiltDeg: 3, kwp: +(nx * ny * mod.kw).toFixed(1) };
})();

export const SITES = {
  flagship: {
    id: 'flagship', name: '旗艦型', short: '旗艦', cls: '100 車位以上', title: '旗艦型：光電車棚＋儲能＋充電',
    scene: '開闊露天場域：評估光電遮蔭、樑柱位置與地主同意',
    lot: F, carport: fCarport,
    entrance: { lane: [F.west.x0, F.west.x1], zLot: F.z1, zGate: F.z1 - 3500, zStreet: F.z1 + STRIP, length: STRIP },   // 閘門設在場內交叉車道，等候車輛不占用街道
    street: { z0: F.z1 + STRIP, z1: F.z1 + STRIP + 10000 },
    yard: { x0: F.east.x1, x1: F.east.x1 + 9000, z0: -6500, z1: 6500 },
    // 設備（假設）：原案 100 kWp／100 kW·215 kWh，充電依需求：AC 7 kW × 8（掛在車棚立柱）、DC 60 kW × 2
    pv: { kwp: fCarport.kwp },
    bess: [{ x: F.east.x1 + 5600, z: 1800, kw: 100, kwh: 215, size: [1700, 2400, 1400], yaw: Math.PI / 2 }],
    msb: { x: F.east.x1 + 2200, z: -3600, size: [2400, 2000, 800] },
    transformer: { x: F.east.x1 + 6200, z: -3900, size: [1900, 1800, 1500] },
    ems: { x: F.east.x1 + 3900, z: -3600 },
    pole: { x: F.east.x1 + 7600, z: F.z1 + STRIP - 700 },
    chargers: [
      ...[2, 3, 4, 5].flatMap((k, n) => [
        { id: `AC${2 * n + 1}`, type: 'AC', kw: 7, mount: 'column', col: k, stall: stallAt(F, 1, [2, 5, 8, 11, 14, 17, 20, 23][k]) },       // 柱東側那格（第 2 排車頭朝南，柱在車的右前方）
        { id: `AC${2 * n + 2}`, type: 'AC', kw: 7, mount: 'column', col: k, stall: stallAt(F, 2, [2, 5, 8, 11, 14, 17, 20, 23][k] - 1) },   // 柱西側那格（第 3 排車頭朝北）
      ]),
      { id: 'DC1', type: 'DC', kw: 60, mount: 'island', stall: stallAt(F, 3, 22) },
      { id: 'DC2', type: 'DC', kw: 60, mount: 'island', stall: stallAt(F, 3, 23) },
    ],
    contract: 150, base: 5,
    socTarget: .35, socMin: .12, shaveHalf: .55,      // 離峰只補到 35%，白天留空間給光電
    buildings: [
      [-30000, -46000, 22000, 14000, 42000], [-4000, -47000, 18000, 16000, 33000], [20000, -45000, 20000, 12000, 48000],
      [72000, -18000, 14000, 22000, 36000], [74000, 14000, 16000, 18000, 27000], [-66000, -12000, 14000, 26000, 30000],
      [-64000, 22000, 16000, 14000, 21000], [-20000, 64000, 26000, 14000, 24000], [16000, 66000, 22000, 16000, 36000], [52000, 62000, 18000, 14000, 18000],
    ],
  },

  // ---------------------------------------------------------------- 住商型：70 車位級，住商周邊平面場域、不建光電
  mixed: (() => {
    const L = buildLot(18, 'RARRAR');
    return {
      id: 'mixed', name: '住商型', short: '住商', cls: '50–99 車位', title: '住商型：離峰市電＋儲能＋充電',
      scene: '住商周邊平面場域：評估夜泊需求、噪音與儲能隔離空間',
      lot: L, carport: null,
      entrance: { lane: [L.west.x0, L.west.x1], zLot: L.z1, zGate: L.z1 - 3500, zStreet: L.z1 + STRIP, length: STRIP },
      street: { z0: L.z1 + STRIP, z1: L.z1 + STRIP + 9000 },
      // 儲能放在遠離住宅（北側）的東南角，北、西兩面隔音牆
      yard: { x0: L.east.x1, x1: L.east.x1 + 7500, z0: 3000, z1: L.z1 },
      pv: null,
      bess: [{ x: L.east.x1 + 4600, z: 10300, kw: 50, kwh: 100, size: [1300, 2300, 1300], yaw: Math.PI / 2 }],
      msb: { x: L.east.x1 + 2000, z: 5400, size: [1800, 1900, 700] },
      transformer: null,
      ems: { x: L.east.x1 + 3700, z: 5400 },
      pole: { x: L.east.x1 + 6200, z: L.z1 + STRIP - 700 },
      // AC 7 kW × 10 在北排（住戶夜泊）；DC 只預留管路與基座（評估）
      chargers: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((j, k) => ({ id: `AC${k + 1}`, type: 'AC', kw: 7, mount: 'post', stall: stallAt(L, 0, j) })),
      reserved: [{ id: 'DC 預留', type: 'DC', kw: 60, stall: stallAt(L, 3, 16) }],
      contract: 60, base: 3,
      socTarget: .95, socMin: .12, shaveHalf: .45,
      buildings: [
        [-30000, -32000, 16000, 12000, 45000], [-10000, -33000, 14000, 14000, 52000], [8000, -32000, 16000, 12000, 48000], [28000, -33000, 14000, 14000, 55000],
        [0, 36000, 60000, 12000, 7000], [-52000, -4000, 12000, 22000, 33000], [50000, -18000, 12000, 16000, 39000], [-46000, 30000, 12000, 12000, 24000],
      ],
      residentialRow: 0,
    };
  })(),

  // ---------------------------------------------------------------- 都會型：30 車位級，狹長入口、車道受限、不建光電
  urban: (() => {
    const L = buildLot(14, 'RAR');
    const laneLen = 20000;
    return {
      id: 'urban', name: '都會型', short: '都會', cls: '20–49 車位', title: '都會型：小占地模組儲能＋充電',
      scene: '狹長入口／車道受限：優先確認避讓、設備占地與逃生動線',
      lot: L, carport: null,
      // 狹長入口：5.5 m 寬、20 m 長；閘門離街道 6.5 m，等候車輛不占用街道
      entrance: { lane: [L.west.x0 + 250, L.west.x1 - 250], zLot: L.z1, zGate: L.z1 + laneLen - 6500, zStreet: L.z1 + laneLen, length: laneLen, narrow: true },
      street: { z0: L.z1 + laneLen, z1: L.z1 + laneLen + 8000 },
      yard: { x0: L.east.x1, x1: L.east.x1 + 4200, z0: L.z0, z1: L.z0 + 7600 },
      pv: null,
      // 模組儲能 30 kW／64 kWh（假設），使用率提高後再加一組
      bess: [
        { x: L.east.x1 + 2700, z: L.z0 + 1100, kw: 30, kwh: 64, size: [1100, 2100, 1000], yaw: Math.PI / 2 },
        { x: L.east.x1 + 2700, z: L.z0 + 3100, kw: 30, kwh: 64, size: [1100, 2100, 1000], yaw: Math.PI / 2, expand: true },
      ],
      msb: { x: L.east.x1 + 2700, z: L.z0 + 5300, size: [1400, 1800, 600], yaw: Math.PI / 2 },
      transformer: null,
      ems: { x: L.east.x1 + 2900, z: L.z0 + 6700, yaw: Math.PI / 2 },
      pole: { x: L.west.x0 - 1800, z: L.z1 + laneLen - 700 },
      chargers: [
        { id: 'DC1', type: 'DC', kw: 40, mount: 'wall', stall: stallAt(L, 0, 12) },
        { id: 'DC2', type: 'DC', kw: 40, mount: 'wall', stall: stallAt(L, 0, 13) },
        { id: 'AC1', type: 'AC', kw: 7, mount: 'post', stall: stallAt(L, 1, 12) },
        { id: 'AC2', type: 'AC', kw: 7, mount: 'post', stall: stallAt(L, 1, 13) },
        { id: 'DC3', type: 'DC', kw: 40, mount: 'wall', stall: stallAt(L, 0, 11), expand: true },
      ],
      contract: 45, contractExpanded: 75, base: 2,     // 擴充時一併檢討契約容量（假設 75 kW）
      socTarget: .9, socMin: .1, shaveHalf: .9,
      fireLane: true,
      buildings: [
        // 北、東側緊鄰中高樓（巷弄型基地）；南側壓低，全景才看得到場內
        [-6000, -17000, 40000, 8000, 30000], [26000, -17500, 10000, 9000, 24000], [36000, 2000, 8000, 16000, 33000],
        [-36000, -6000, 12000, 20000, 27000], [6000, 19500, 20000, 9000, 9000], [-40000, 26000, 14000, 14000, 12000],
      ],
    };
  })(),
};

// 充電樁的安裝位置與朝向（root：底面中心或柱面；yaw 給 rotation.y，螢幕朝本地 +Z）
export function chargerPose(site, c) {
  const S = c.stall;
  if (c.mount === 'column') {
    const cp = site.carport, x = S.dir > 0 ? S.x - STALL.w / 2 : S.x + STALL.w / 2;
    return S.dir > 0 ? { x, y: 0, z: cp.zLine - 150, yaw: Math.PI } : { x, y: 0, z: cp.zLine + 150, yaw: 0 };
  }
  const head = S.dir > 0 ? S.z + STALL.d / 2 : S.z - STALL.d / 2;           // 車頭那一側的車位邊線
  if (c.mount === 'island') return { x: S.x, y: 150, z: head + 600 * S.dir, yaw: S.dir > 0 ? Math.PI : 0 };
  if (c.type === 'DC') return { x: S.x, y: 0, z: head + 700 * S.dir, yaw: S.dir > 0 ? Math.PI : 0 };
  // AC 立柱：放在車的右前方（車頭朝 +Z 時右邊是 −X）
  return { x: S.x - 800 * S.dir, y: 0, z: head + 450 * S.dir, yaw: S.dir > 0 ? Math.PI : 0 };
}

export const SITE_IDS = ['flagship', 'mixed', 'urban'];
export const siteOf = id => SITES[id] || SITES.flagship;

// 提案的三種場型比較（側欄表格；與簡報第 6 頁一致）
export const COMPARE = [
  ['車位分級', '100 個以上', '50–99 個', '20–49 個'],
  ['光電板', '建置（須具適合場地）', '不建置', '不建置'],
  ['儲能來源', '太陽能＋離峰市電', '離峰市電', '離峰市電'],
  ['充電服務', 'AC＋需求支持的 DC', 'AC 為主，評估 DC', '少量 AC／適量 DC'],
  ['憑證收益', '合格光電可評估', '市電儲能不產生', '市電儲能不產生'],
];
