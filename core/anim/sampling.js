// 取樣時間（網頁與檢查共用，不依賴 three）：配線檢查的 verify.cables.times、各站的干涉取樣都用這裡。
// sampleTimes(start, duration, interval)：含頭尾、等分，至少 2 點
export function sampleTimes(start, duration, interval) {
  const count = Math.max(1, Math.ceil(duration / interval));
  return Array.from({ length: count + 1 }, (_, i) => start + duration * i / count);
}

// stepTimes(steps, interval)：每個步驟 { start, dur } 各自取樣後接起來（相鄰步驟的交界點會重複，與既有檢查相同）。
// interval 可以是函式 step => 秒，例如等待步驟只取起訖：s => s.kind === 'wait' ? s.dur || 1 : .1
export const stepTimes = (steps, interval) =>
  steps.flatMap(s => sampleTimes(s.start, s.dur, typeof interval === 'function' ? interval(s) : interval));
