// 手臂動力學（core 1.18.0，2026-11-07 拍板導入 MuJoCo）：MuJoCo（WebAssembly）逆動力學。
// 輸入站的關節角取樣 q(t)（arm.q，rad），以有限差分求 q̇、q̈，逐點 mj_inverse 求各軸所需扭矩，
// 回傳時間序列、峰值、對上限的比例，以及 layoutChecks 格式的列。
// 單位：介面上長度 mm、質量 kg、時間 s、角度 rad、扭矩 N·m；MuJoCo 內部用 m（產生 MJCF 時換算）。
// 不依賴 three，也不依賴 node:*；瀏覽器與 Node 同一份程式。

// MuJoCo：core/vendor/mujoco/（mujoco.js＋內嵌的 wasm，說明在該資料夾的 README.md）
const VENDOR = new URL('../vendor/mujoco/', import.meta.url);
const G = 9.81;

let loading = null;
/** 載入 MuJoCo 一次（之後共用）。wasm 內嵌在 mujoco-wasm.mjs（gzip＋base64），解開後以 wasmBinary 交給 Emscripten：
 *  Node 與瀏覽器同一條路，不另外抓 .wasm（伺服器 MIME 不對也不會在主控台報錯），單一 HTML 匯出也能內嵌 */
export function loadMujoco() {
  loading ??= (async () => {
    const [{ default: factory }, { default: b64 }] = await Promise.all([import(new URL('mujoco.js', VENDOR).href), import(new URL('mujoco-wasm.mjs', VENDOR).href)]);
    const gz = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const wasmBinary = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return factory({ wasmBinary });
  })();
  return loading;
}

// ---------------------------------------------------------------- MJCF 產生
const f = v => +v.toFixed(9);                      // 數字輸出：去掉浮點尾巴，讓 XML 文字穩定
const mm = a => a.map(v => f(v / 1000)).join(' ');
function geomXml(g) {
  if (g.box) return `<geom type="box" size="${mm(g.box.map(v => v / 2))}" pos="${mm(g.pos)}" mass="${g.mass}"/>`;
  const { r, h, axis } = g.cyl;
  // 圓柱預設沿局部 z：x 軸繞 y 轉 90°、y 軸繞 x 轉 −90°
  const quat = axis === 'x' ? '0.707106781 0 0.707106781 0' : axis === 'y' ? '0.707106781 -0.707106781 0 0' : '1 0 0 0';
  return `<geom type="cylinder" size="${f(r / 1000)} ${f(h / 2000)}" pos="${mm(g.pos)}" quat="${quat}" mass="${g.mass}"/>`;
}

/**
 * 負載（工具＋工件）：{ mass（kg）, com（mm，工具座標：arm.tool，+Z 為工具前進方向）, inertia（kg·m²，對質心、工具座標的主軸 [Ixx, Iyy, Izz]；省略時當半徑 20 mm 的實心球）}
 * gravity：手臂基座座標的重力（m/s²，預設 [0, −9.81, 0]）；倒吊、斜裝的手臂把世界重力轉到基座座標再傳入
 * 回傳 MuJoCo XML（座標同 three.js：+Y 朝上，重力 −Y）
 */
export function toMJCF(spec, { payload = null, armature = true, gravity = [0, -G, 0], name = spec.id } = {}) {
  const ind = n => '  '.repeat(n);
  const lines = [`<mujoco model="${name}">`,
    `${ind(1)}<compiler angle="radian" inertiafromgeom="true" autolimits="true"/>`,
    // 只做逆動力學：關掉接觸與限位約束，qfrc_inverse 就是剛體方程式 M q̈ + c(q, q̇) + g(q)（+ armature）
    `${ind(1)}<option gravity="${gravity.map(f).join(' ')}" timestep="0.001"><flag contact="disable" constraint="disable"/></option>`,
    `${ind(1)}<default><geom contype="0" conaffinity="0" density="0"/></default>`,
    `${ind(1)}<worldbody>`];
  lines.push(`${ind(2)}<body name="base">`, ...spec.base.map(g => ind(3) + geomXml(g)), `${ind(2)}</body>`);
  let depth = 2;
  for (const l of spec.links) {
    const arm = armature ? ` armature="${spec.armature[l.joint] ?? 0}"` : '';
    lines.push(`${ind(depth)}<body name="${l.joint}" pos="${mm(l.pos)}">`,
      `${ind(depth + 1)}<joint name="${l.joint}" type="hinge" axis="${l.axis.join(' ')}"${arm}/>`,
      ...l.geoms.map(g => ind(depth + 1) + geomXml(g)));
    depth++;
  }
  // 工具安裝座（arm.tool）與負載：焊在最後一節上
  lines.push(`${ind(depth)}<body name="tool" pos="${mm(spec.tool.pos)}" quat="${spec.tool.quat.map(f).join(' ')}">`,
    `${ind(depth + 1)}<site name="tcp"/>`);
  if (payload && payload.mass > 0) {
    const r2 = 0.4 * payload.mass * 0.02 ** 2;
    const I = payload.inertia ?? [r2, r2, r2];
    lines.push(`${ind(depth + 1)}<body name="payload" pos="${mm(payload.com ?? [0, 0, 0])}">`,
      `${ind(depth + 2)}<inertial pos="0 0 0" mass="${payload.mass}" diaginertia="${I.map(f).join(' ')}"/>`,
      `${ind(depth + 1)}</body>`);
  }
  lines.push(`${ind(depth)}</body>`);
  for (let d = depth - 1; d >= 2; d--) lines.push(`${ind(d)}</body>`);
  lines.push(`${ind(1)}</worldbody>`, '</mujoco>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- 模型
/** 編譯一個手臂（＋負載）模型；用完呼叫 dispose()（WebAssembly 記憶體不會被 GC 回收） */
export async function createArmModel(spec, opts = {}) {
  const mj = await loadMujoco();
  const model = mj.MjModel.from_xml_string(toMJCF(spec, opts));
  const data = new mj.MjData(model);
  const J = mj.mjtObj.mjOBJ_JOINT.value;
  const adr = spec.joints.map(n => { const id = mj.mj_name2id(model, J, n); if (id < 0) throw new Error('MJCF 缺關節 ' + n); return [model.jnt_qposadr[id], model.jnt_dofadr[id]]; });
  const qpos = data.qpos, qvel = data.qvel, qacc = data.qacc, out = data.qfrc_inverse;   // 直接指向 WebAssembly 記憶體的視圖
  /** 一個姿態的逆動力學：q、qd、qdd 為依 spec.joints 順序的陣列（rad、rad/s、rad/s²），結果寫進 tau */
  function inverse(q, qd, qdd, tau = new Float64Array(adr.length)) {
    for (let i = 0; i < adr.length; i++) { qpos[adr[i][0]] = q[i]; qvel[adr[i][1]] = qd ? qd[i] : 0; qacc[adr[i][1]] = qdd ? qdd[i] : 0; }
    mj.mj_inverse(model, data);
    for (let i = 0; i < adr.length; i++) tau[i] = out[adr[i][1]];
    return tau;
  }
  const totalMass = () => Array.from(model.body_mass).reduce((a, b) => a + b, 0);
  return { mj, model, data, inverse, totalMass, dispose() { data.delete(); model.delete(); } };
}

// ---------------------------------------------------------------- 有限差分
/** 不等間距三點差分：回傳 { qd, qdd }（每軸一個 Float64Array）；端點用單邊差分，加速度沿用相鄰點 */
export function differentiate(t, q) {
  const n = t.length, qd = q.map(() => new Float64Array(n)), qdd = q.map(() => new Float64Array(n));
  for (let j = 0; j < q.length; j++) {
    const x = q[j], v = qd[j], a = qdd[j];
    for (let i = 1; i < n - 1; i++) {
      const h0 = t[i] - t[i - 1], h1 = t[i + 1] - t[i], s = h0 * h1 * (h0 + h1);
      v[i] = (h0 * h0 * x[i + 1] - h1 * h1 * x[i - 1] + (h1 * h1 - h0 * h0) * x[i]) / s;
      a[i] = 2 * (h0 * x[i + 1] - (h0 + h1) * x[i] + h1 * x[i - 1]) / s;
    }
    if (n > 1) { v[0] = (x[1] - x[0]) / (t[1] - t[0]); v[n - 1] = (x[n - 1] - x[n - 2]) / (t[n - 1] - t[n - 2]); }
    if (n > 2) { a[0] = a[1]; a[n - 1] = a[n - 2]; }
  }
  return { qd, qdd };
}

/**
 * 平滑關節角：三角窗（半寬 w 秒）加權平均，只用四則運算（瀏覽器與 Node 逐位元相同）。
 * 動畫軌跡在步驟接縫有速度折角、直線段的逐點 IK 有 0.01 mm 級雜訊，二次差分會放大成假的加速度尖峰；
 * 實際控制器也會做加減速平滑，所以預設 w = 0.03 s（約 30 Hz 頻寬）。w = 0 不平滑。
 */
export function smoothSeries(t, q, w) {
  if (!(w > 0)) return q;
  const n = t.length;
  return q.map(x => {
    const y = new Float64Array(n);
    let lo = 0;
    for (let i = 0; i < n; i++) {
      while (t[i] - t[lo] >= w) lo++;
      let sw = 0, sx = 0;
      for (let k = lo; k < n && t[k] - t[i] < w; k++) { const wt = 1 - Math.abs(t[k] - t[i]) / w; sw += wt; sx += wt * x[k]; }
      y[i] = sx / sw;
    }
    return y;
  });
}

// FNV-1a（32 位元）：決定性比對用，Node 與瀏覽器同一份
export function hashArrays(arrays) {
  let h = 0x811c9dc5;
  for (const a of arrays) { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- 負載的靜態檢查（不需要軌跡）
/** 負載對手腕的靜態力矩與慣量（型錄「手腕容許力矩／容許慣性力矩」的算法：J4／J5 以 J5 旋轉中心、J6 以 J6 軸） */
export function payloadWrist(spec, payload) {
  const { mass: m, com = [0, 0, 0] } = payload;
  const [w, x, y, z] = spec.tool.quat;   // 工具座標 → j6 座標
  const rot = v => {                     // 四元數旋轉 v（mm）
    const [vx, vy, vz] = v, ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  };
  const c = rot(com).map((v, i) => v + spec.tool.pos[i]);              // 負載質心在 j6 座標（mm），j6 軸 = x 軸
  const j5x = -spec.links.at(-1).pos[0];                                 // J5 中心在 j6 座標的 x
  const L5 = Math.hypot(c[0] - j5x, c[1], c[2]) / 1000, r6 = Math.hypot(c[1], c[2]) / 1000;
  const r2 = 0.4 * m * 0.02 ** 2, Ic = Math.max(...(payload.inertia ?? [r2, r2, r2]));
  return {
    moment: { j4: m * G * L5, j5: m * G * L5, j6: m * G * r6 },
    inertia: { j4: Ic + m * L5 * L5, j5: Ic + m * L5 * L5, j6: Ic + m * r6 * r6 },   // 保守：取質心慣量的最大主軸
    distance: { j5: L5 * 1000, j6: r6 * 1000 },
  };
}

// ---------------------------------------------------------------- 主函式
/**
 * 沿一段關節軌跡做逆動力學。
 *   spec：手臂動力學參數（例：VS068_DYNAMICS）
 *   samples：[{ t, q }]，q 是 { j1..j6 }（rad，arm.q 的複本）或依 spec.joints 順序的陣列；t 遞增（相同時間的重複點會略過）
 *   opts：{ payload, armature = true, gravity（基座座標，見 toMJCF）, smooth = 0.03（秒，見 smoothSeries；0 不平滑）, warn = 0.8（扭矩比例超過就在 note 註記）, group = '手臂動力學' }
 * 回傳 { joints, t, q, qd, qdd, tau, gravity, peak, speed, jumps, wrist, hash, ms, rows }
 */
export async function inverseDynamics(spec, samples, opts = {}) {
  const { payload = null, armature = true, gravity: gravityVec, smooth = 0.03, warn = 0.8, group = '手臂動力學' } = opts;
  const J = spec.joints, rating = spec.rating ?? {};
  // 整理取樣：轉成每軸的 Float64Array，去掉重複時間
  const rowsIn = [];
  for (const s of samples) { if (rowsIn.length && !(s.t > rowsIn.at(-1).t)) continue; rowsIn.push(s); }
  const n = rowsIn.length, t = new Float64Array(n), q = J.map(() => new Float64Array(n));
  rowsIn.forEach((s, i) => { t[i] = s.t; J.forEach((name, j) => { q[j][i] = Array.isArray(s.q) || ArrayBuffer.isView(s.q) ? s.q[j] : s.q[name]; }); });
  const { qd, qdd } = differentiate(t, smoothSeries(t, q, smooth));

  // 跳點：相鄰兩點的關節角變化超過型錄最高速度 ×1.5（跳播、IK 換解、J4／J6 ±360° 折返），這些點的扭矩不可信
  const jumps = [];
  for (let i = 1; i < n; i++) for (let j = 0; j < J.length; j++) {
    const vmax = rating.speed?.[J[j]]; if (!vmax) continue;
    const dq = Math.abs(q[j][i] - q[j][i - 1]);
    if (dq > vmax * 1.5 * (t[i] - t[i - 1]) + 1e-9) jumps.push({ t: t[i], joint: J[j], dq });
  }

  const arm = await createArmModel(spec, { payload, armature, gravity: gravityVec });
  const tau = J.map(() => new Float64Array(n)), gravity = J.map(() => new Float64Array(n));
  const qi = new Float64Array(J.length), vi = new Float64Array(J.length), ai = new Float64Array(J.length), ti = new Float64Array(J.length);
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const t0 = now();
  try {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < J.length; j++) { qi[j] = q[j][i]; vi[j] = qd[j][i]; ai[j] = qdd[j][i]; }
      arm.inverse(qi, vi, ai, ti); for (let j = 0; j < J.length; j++) tau[j][i] = ti[j];
      arm.inverse(qi, null, null, ti); for (let j = 0; j < J.length; j++) gravity[j][i] = ti[j];   // 靜止保持扭矩（只有重力）
    }
  } finally { arm.dispose(); }
  const ms = now() - t0;

  const peak = {}, speed = {}, rows = [];
  J.forEach((name, j) => {
    let k = 0, kg = 0, kv = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(tau[j][i]) > Math.abs(tau[j][k])) k = i;
      if (Math.abs(gravity[j][i]) > Math.abs(gravity[j][kg])) kg = i;
      if (Math.abs(qd[j][i]) > Math.abs(qd[j][kv])) kv = i;
    }
    const limit = rating.torque?.[name] ?? null, v = Math.abs(tau[j][k]);
    peak[name] = { tau: v, t: t[k], gravity: Math.abs(gravity[j][kg]), limit, ratio: limit ? v / limit : null };
    const vmax = rating.speed?.[name] ?? null, sv = Math.abs(qd[j][kv]);
    speed[name] = { peak: sv, t: t[kv], limit: vmax, ratio: vmax ? sv / vmax : null };
    if (limit) {
      const r = v / limit;
      rows.push({ group, name: `${name.toUpperCase()} 峰值扭矩`, ok: r <= 1, value: +v.toFixed(2),
        note: `${(r * 100).toFixed(0)}% of ${limit} N·m（上限為估計值）@ t=${t[k].toFixed(2)} s；靜止保持最大 ${Math.abs(gravity[j][kg]).toFixed(1)} N·m${r > warn ? '；超過 ' + warn * 100 + '%，向廠商確認' : ''}` });
    }
  });
  let wrist = null;
  if (payload && payload.mass > 0) {
    if (rating.payload) rows.push({ group, name: '負載質量', ok: payload.mass <= rating.payload, value: payload.mass, note: `型錄最大可搬重量 ${rating.payload} kg` });
    wrist = payloadWrist(spec, payload);
    for (const k of ['j4', 'j5', 'j6']) {
      if (rating.moment?.[k]) rows.push({ group, name: `${k.toUpperCase()} 負載力矩`, ok: wrist.moment[k] <= rating.moment[k], value: +wrist.moment[k].toFixed(2), note: `容許 ${rating.moment[k]} N·m（型錄，需核對）` });
      if (rating.inertia?.[k]) rows.push({ group, name: `${k.toUpperCase()} 負載慣量`, ok: wrist.inertia[k] <= rating.inertia[k], value: +wrist.inertia[k].toFixed(4), note: `容許 ${rating.inertia[k]} kg·m²（型錄，需核對）` });
    }
  }
  rows.push({ group, name: '關節軌跡連續', ok: jumps.length === 0, value: jumps.length, note: jumps.length ? `第一個跳點 t=${jumps[0].t.toFixed(3)} s ${jumps[0].joint}（跳點附近的扭矩不可信）` : `取樣 ${n} 點` });

  return { joints: J, t, q, qd, qdd, tau, gravity, peak, speed, jumps, wrist, hash: hashArrays(tau), ms, rows };
}
