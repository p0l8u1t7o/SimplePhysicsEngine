// 綁定表：MD 實體 ↔ 站的孿生描述（machine-description README §5；SPE 開發計畫 4.1 設計要點 6）。
//
// 站的孿生描述 twin（各站 web/js/twin-binding.js 提供，規格見 core/twin/README.md）用到的欄位：
//   keys            可綁定的狀態鍵（MD scene.stateKey；例 palletX、clamp、q、q.rail）
//   setters         沒有 stateKey 的實體可用的物件路徑（例 cell/stops/S1、cell/tower/green），值寫在 view.paths
//   objects         邏輯路徑 → 物件（three.js Object3D）；查不到再沿 root 的物件名稱逐段解析
//   root            場景根（選填，逐段解析用）
//   initialView()   站的初始狀態：{ keys: { 鍵: 場景值 }, paths: { 路徑: 值 } }
//
// 場景值 = MD 值 × scale + offset（軸：位置；致動器：行程比例 0..1；機器人：關節角 rad，不套 scale）。
// 解析不到（沒有 scene、物件路徑或狀態鍵不存在）的實體列入 unbound（依 MD 陣列順序）；
// bindings = 綁定成功的軸＋致動器＋感測器＋機器人，加上有 scene 且解析成功的設備（twin-protocol README §2；不含 unbound）。

// 物件路徑 → 物件：先查 twin.objects，再沿 root 逐段以名稱往下找（每段在上一段的子孫中找第一個同名物件）
export function resolvePath(twin, path) {
  if (typeof path !== 'string' || !path) return null;
  if (twin.objects && Object.hasOwn(twin.objects, path)) return twin.objects[path] ?? null;
  let node = twin.root;
  if (!node) return null;
  for (const seg of path.split('/')) {
    node = node.getObjectByName?.(seg);
    if (!node) return null;
  }
  return node;
}

export function resolveBindings(index, twin) {
  const keys = new Set(twin.keys || []), setters = new Set(twin.setters || []);
  const init = twin.initialView?.() || { keys: {}, paths: {} };
  const unbound = [], axes = [], actuators = [], robots = [], sensors = [], devices = [];
  const channel = scene => {
    if (!scene || !resolvePath(twin, scene.object) && !setters.has(scene.object)) return null;
    if (scene.stateKey !== undefined) return keys.has(scene.stateKey) ? { key: scene.stateKey } : null;
    return setters.has(scene.object) ? { path: scene.object } : null;
  };
  const initial = (ch, scale, offset) => {
    const v = ch.key !== undefined ? init.keys?.[ch.key] : init.paths?.[ch.path];
    return typeof v === 'number' ? (v - offset) / scale : null;
  };
  for (const d of index.devices) {
    if (!d.scene) continue;
    if (resolvePath(twin, d.scene.object)) devices.push({ md: d, object: resolvePath(twin, d.scene.object) });
    else unbound.push(d.id);
  }
  for (const a of index.axes) {
    const ch = channel(a.scene);
    if (!ch) { unbound.push(a.id); continue; }
    const scale = a.scene.scale ?? 1, offset = a.scene.offset ?? 0;
    axes.push({ md: a, ...ch, scale, offset, initial: initial(ch, scale, offset) ?? 0 });
  }
  for (const a of index.actuators) {
    const ch = channel(a.scene);
    if (!ch) { unbound.push(a.id); continue; }
    const scale = a.scene.scale ?? 1, offset = a.scene.offset ?? 0, p = initial(ch, scale, offset);
    actuators.push({ md: a, ...ch, scale, offset, initial: p === null ? 0 : Math.min(1, Math.max(0, p)) });
  }
  for (const s of index.sensors) {
    // 幾何感測器（photoEye、proximity）要有射線／區域；frame = object 時物件要解析得到
    if (s.type === 'photoEye' || s.type === 'proximity') {
      const g = s.scene;
      if (!g || !Array.isArray(g.origin) || (g.frame === 'object' && !resolvePath(twin, g.object))) { unbound.push(s.id); continue; }
    }
    sensors.push({ md: s });
  }
  for (const r of index.robots) {
    const ch = channel(r.scene);
    if (!ch || ch.key === undefined) { unbound.push(r.id); continue; }
    const q = init.keys?.[ch.key];
    robots.push({ md: r, key: ch.key, initial: Array.isArray(q) ? [...q] : null });
  }
  const bindings = axes.length + actuators.length + sensors.length + robots.length + devices.length;
  return { axes, actuators, sensors, robots, devices, unbound, bindings };
}

// 目前的 MD 值 → 站的 view（場景值）；session 每個 tick 結束時呼叫，交給 twin.apply(view)
export function buildView(bound, values) {
  const view = { keys: {}, paths: {} };
  const put = (b, v) => { if (b.key !== undefined) view.keys[b.key] = v; else view.paths[b.path] = v; };
  for (const b of bound.axes) put(b, values.axes[b.md.id] * b.scale + b.offset);
  for (const b of bound.actuators) put(b, values.actuators[b.md.id] * b.scale + b.offset);
  for (const b of bound.robots) view.keys[b.key] = values.robots[b.md.id];
  return view;
}
