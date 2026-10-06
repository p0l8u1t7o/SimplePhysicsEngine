// 節拍分析（評估平台 Q9）：從排程的事件算各站（或各軌）的佔用時間、稼動率與瓶頸，給可行性分析的節拍核算回填用。
//   const r = cycleReport(project);   // { total, cycle, bottleneck, stations: [{ station, busy, util, steps, first, last }] }
// 事件來源和排程指紋相同：project.timeline（createTimeline）／project.sequence（createStepSequence）／project.events，
// 每筆 { time|start, dur, station|track }；同一站重疊的步驟只算一次（取聯集）。
// cycle：每件的節拍。站自己知道就給 project.cycleTime（秒／件），沒給就用動畫總長。
export function cycleReport(project, { cycle } = {}) {
  const raw = project.timeline?.events || project.sequence?.events || project.events || [];
  const ev = raw.map(e => ({ t: e.time ?? e.start ?? e.t ?? 0, dur: e.dur ?? 0, station: String(e.station ?? e.track ?? '—') })).filter(e => e.dur > 0);
  const total = project.total ?? Math.max(0, ...ev.map(e => e.t + e.dur));
  const by = new Map();
  for (const e of ev) { if (!by.has(e.station)) by.set(e.station, []); by.get(e.station).push([e.t, e.t + e.dur]); }
  const stations = [...by].map(([station, spans]) => {
    spans.sort((a, b) => a[0] - b[0]);
    let busy = 0, cur = null;
    for (const [a, b] of spans) { if (!cur || a > cur[1]) { if (cur) busy += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }
    if (cur) busy += cur[1] - cur[0];
    return { station, busy: +busy.toFixed(3), util: total ? +(busy / total).toFixed(3) : 0, steps: spans.length, first: +spans[0][0].toFixed(3), last: +Math.max(...spans.map(s => s[1])).toFixed(3) };
  }).sort((a, b) => b.busy - a.busy);
  return { total: +total.toFixed(3), cycle: +(cycle ?? project.cycleTime ?? project.verify?.cycle ?? total).toFixed(3), bottleneck: stations[0]?.station ?? null, stations };
}
