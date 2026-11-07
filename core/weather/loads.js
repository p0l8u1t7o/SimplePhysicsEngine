// 面板（斜面）上的雪載重與風載重「估算」：照規範的公式形式算，給方案比較與支架初估用。
// ⚠ 正式設計一律依案場適用的規範原文與結構技師；這裡的係數表是從規範整理的常用值，部分標「待核對」。
//
//   snowLoad({ method, ground | depth, tilt, … })     → { flat, slopeFactor, sloped, perPanelArea, normal, tangential, … }（kN/m²）
//   velocityPressure({ code, V, z, exposure, … })     → { q（N/m²）, Kz, … }
//   panelWindLoad({ q, tilt, area, G, Cn })           → { down, up（N/m²）, forceDown, forceUp（N）, … }
//
// 單位：載重 kN/m²（雪）或 N/m²（風壓）、力 N、高度 m、風速 m/s、角度度。雪載重的 sloped 是「每 m² 水平投影面積」，
// perPanelArea 是「每 m² 面板（斜面）面積」= sloped × cosβ；再分成垂直面板（normal = sloped × cos²β）與沿面板（tangential = sloped × cosβ sinβ）。
const D2R = Math.PI / 180, clamp01 = x => Math.max(0, Math.min(1, x));

// ---------------------------------------------------------------- 雪
// method：
//   'asce7'（ASCE 7-16 第 7 章形式）：pf = 0.7 Ce Ct Is pg；ps = Cs pf。Cs 依 Ct 與表面是否光滑（slippery，PV 玻璃算光滑、而且下緣不能擋雪）：
//            光滑：Ct ≤ 1.0 → 5° 以下 1、到 70° 線性降到 0；Ct = 1.1 → 10°；Ct ≥ 1.2（不加熱、開放結構，PV 陣列）→ 15°。
//            不光滑：30°／37.5°／45° 以下 1，到 70° 降到 0。（ASCE 7-22 改了地面雪載重圖與部分係數，換版要核對）
//   'en1991'（EN 1991-1-3 單斜屋頂）：s = μ1 Ce Ct sk；μ1 = 0.8（0～30°）、0.8 (60 − α)／30（30～60°）、0（≥ 60°）。下緣有擋雪時 μ1 不得折減。
//   'jis'（日本建築基準法施行令第 86 條形式，JIS C 8955 引用）：S = Cs × P × Zs；P = 單位重 N/m²/cm（一般 20、多雪區 30），
//            Zs = 地面積雪深（cm），Cs = √cos(1.5β)（β ≤ 60°）、0（β > 60°）。（JIS C 8955:2017 對架台另有規定，待核對）
export function snowLoad({ method = 'asce7', ground, depth, unitWeight = 20, tilt = 0, Ce = 1, Ct, Is = 1, slippery = true } = {}) {
  const b = tilt * D2R;
  Ct ??= method === 'asce7' ? 1.2 : 1;                      // ASCE 7：不加熱的開放結構（PV 陣列）1.2；EN 1991：一般 1.0
  let flat, factor, note;
  if (method === 'asce7') {
    if (!(ground >= 0)) throw new Error('snowLoad asce7：要給 ground（地面雪載重 pg，kN/m²）');
    flat = 0.7 * Ce * Ct * Is * ground;
    const knee = slippery ? (Ct <= 1.0 ? 5 : Ct < 1.2 ? 10 : 15) : (Ct <= 1.0 ? 30 : Ct < 1.2 ? 37.5 : 45);
    factor = tilt <= knee ? 1 : clamp01((70 - tilt) / (70 - knee));
    note = `ASCE 7-16 形式：pf = 0.7·Ce·Ct·Is·pg，Cs（${slippery ? '光滑' : '不光滑'}、Ct ${Ct}）在 ${knee}° 以下 1、70° 為 0`;
  } else if (method === 'en1991') {
    if (!(ground >= 0)) throw new Error('snowLoad en1991：要給 ground（地面雪載重 sk，kN/m²）');
    flat = Ce * Ct * ground;
    factor = tilt <= 30 ? 0.8 : tilt < 60 ? 0.8 * (60 - tilt) / 30 : 0;
    note = 'EN 1991-1-3 單斜屋頂：s = μ1·Ce·Ct·sk（μ1 已含在 slopeFactor；flat 是 Ce·Ct·sk）';
  } else if (method === 'jis') {
    if (!(depth >= 0)) throw new Error('snowLoad jis：要給 depth（地面積雪深 Zs，cm）');
    flat = unitWeight * depth / 1000;                         // N/m² → kN/m²
    factor = tilt <= 60 ? Math.sqrt(Math.max(0, Math.cos(1.5 * b))) : 0;
    note = `建築基準法施行令 86 條形式：S = Cs·P·Zs（P = ${unitWeight} N/m²/cm），Cs = √cos(1.5β)`;
  } else throw new Error(`snowLoad：不支援的 method ${method}`);
  const sloped = flat * factor;
  return { method, tilt, flat: r3(flat), slopeFactor: r3(factor), sloped: r3(sloped), perPanelArea: r3(sloped * Math.cos(b)),
    normal: r3(sloped * Math.cos(b) ** 2), tangential: r3(sloped * Math.cos(b) * Math.sin(b)), unit: 'kN/m²', estimate: true, note };
}
const r3 = x => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- 風
// 速度壓 q（N/m²）：
//   'asce7'（ASCE 7-16 第 26 章）：q = 0.613 Kz Kzt Kd Ke V²；Kz = 2.01 (max(z, 4.57)／zg)^(2／α)；
//            地況 B：α 7.0、zg 365.76 m；C：9.5、274.32 m；D：11.5、213.36 m。Kd（風向因子）預設 0.85，Ke（海拔）1。
//   'tw'（建築物耐風設計規範形式）：q = 0.06 K(z) Kzt (I V10(C))²（kgf/m²）× 9.80665 → N/m²；K(z) = 2.774 (max(z, zs)／zg)^(2α)；
//            地況 A：α 0.32、zg 500 m；B：0.25、400 m；C：0.15、300 m。zs（最小高度）暫定 A 18 m／B 9 m／C 4.5 m（待核對規範原文）。
export const EXPOSURE = {
  asce7: { B: { alpha: 7.0, zg: 365.76, zmin: 4.57 }, C: { alpha: 9.5, zg: 274.32, zmin: 4.57 }, D: { alpha: 11.5, zg: 213.36, zmin: 4.57 } },
  tw: { A: { alpha: 0.32, zg: 500, zmin: 18 }, B: { alpha: 0.25, zg: 400, zmin: 9 }, C: { alpha: 0.15, zg: 300, zmin: 4.5 } },
};
export function velocityPressure({ code = 'tw', V, z = 3, exposure = 'C', Kzt = 1, Kd, Ke = 1, I = 1 } = {}) {
  if (!(V > 0)) throw new Error('velocityPressure：要給基本風速 V（m/s）');
  const e = EXPOSURE[code]?.[exposure]; if (!e) throw new Error(`velocityPressure：${code} 沒有地況 ${exposure}`);
  const zz = Math.max(z, e.zmin);
  if (code === 'asce7') {
    const Kz = 2.01 * (zz / e.zg) ** (2 / e.alpha), kd = Kd ?? 0.85, q = 0.613 * Kz * Kzt * kd * Ke * V * V;
    return { code, q: Math.round(q * 10) / 10, Kz: r3(Kz), Kzt, Kd: kd, Ke, V, z, exposure, unit: 'N/m²', estimate: true, note: 'ASCE 7-16：q = 0.613·Kz·Kzt·Kd·Ke·V²' };
  }
  const Kz = 2.774 * (zz / e.zg) ** (2 * e.alpha), kd = Kd ?? 1, q = 0.06 * 9.80665 * Kz * Kzt * kd * (I * V) ** 2;
  return { code, q: Math.round(q * 10) / 10, Kz: r3(Kz), Kzt, Kd: kd, I, V, z, exposure, unit: 'N/m²', estimate: true, note: '耐風規範形式：q = 0.06·K(z)·Kzt·(I·V10)²（kgf/m² 換成 N/m²）；zs 待核對' };
}

// 面板淨風壓 p = q × G × C（N/m²，垂直面板）。C 沒給時用 JIS C 8955 地面型陣列的式子（傾角 θ 適用 15～45°，範圍外夾到邊界）：
//   正壓（風從正面吹，壓向支架）Ca = 0.65 + 0.009 θ；負壓（風從背面吹，上揚）Ca = 0.71 + 0.016 θ。
// G（陣風因子）預設 1（JIS 的 q 已含陣風）；用 ASCE 7 的 q 時改 G = 0.85 並換成 ASCE 7 開放式單斜屋頂的 CN（圖 27.3-4）。
export function panelWindLoad({ q, tilt = 20, area = 2, G = 1, Cn } = {}) {
  if (!(q >= 0)) throw new Error('panelWindLoad：要給速度壓 q（N/m²，velocityPressure().q）');
  const th = Math.max(15, Math.min(45, tilt));
  const down = Cn?.down ?? 0.65 + 0.009 * th, up = Cn?.up ?? 0.71 + 0.016 * th;
  const pd = q * G * down, pu = q * G * up;
  return { q, G, tilt, Cdown: r3(down), Cup: r3(up), down: Math.round(pd * 10) / 10, up: Math.round(pu * 10) / 10,
    forceDown: Math.round(pd * area), forceUp: Math.round(pu * area), area, unit: 'N/m²／N', estimate: true,
    note: Cn ? '自訂係數' : `JIS C 8955 陣列係數（θ 夾在 15～45°，用 ${th}°）` };
}
