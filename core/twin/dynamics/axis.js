// 軸的運動學模型（不是物理）：梯形速度曲線閉式解、減速停止、原點復歸、追隨誤差。
// 時間一律是整數 µs，位置依固定運算順序以 IEEE double 計算，與 AutoSequence 假 SPE（FakeSpe/Kinematics/TrapezoidProfile.cs、
// EntityModels.cs 的 AxisModel）逐步相同，同一 tick 序列得到同一結果。單位：posUnit、posUnit/s、posUnit/s²。

// 從靜止的 p0 以 a 加速到 v、等速、再以 a 減速停在 p1；距離不足時為三角形曲線
export function trapezoid(startUs, p0, p1, v, a) {
  if (!(v > 0) || !(a > 0) || !Number.isFinite(v) || !Number.isFinite(a)) throw new RangeError('速度與加速度必須大於 0');
  const distance = Math.abs(p1 - p0), dir = p1 >= p0 ? 1 : -1, accelDistance = v * v / a;
  let tAcc, vPeak, tCruise;
  if (distance <= accelDistance) { tAcc = Math.sqrt(distance / a); vPeak = a * tAcc; tCruise = 0; }
  else { tAcc = v / a; vPeak = v; tCruise = (distance - accelDistance) / v; }
  // 到位時刻無條件進位到整數 µs，避免浮點誤差讓到位早於閉式解
  const durationUs = Math.ceil((2 * tAcc + tCruise) * 1e6);
  return {
    startUs, target: p1, durationUs, endUs: startUs + durationUs,
    at(tUs) {
      if (tUs >= this.endUs) return { pos: p1, vel: 0, done: true };
      const t = (tUs - startUs) / 1e6;
      if (t <= 0) return { pos: p0, vel: 0, done: false };
      let s, vel;
      if (t < tAcc) { s = 0.5 * a * t * t; vel = a * t; }
      else if (t < tAcc + tCruise) { s = 0.5 * a * tAcc * tAcc + vPeak * (t - tAcc); vel = vPeak; }
      else { const d = t - tAcc - tCruise; s = 0.5 * a * tAcc * tAcc + vPeak * tCruise + vPeak * d - 0.5 * a * d * d; vel = Math.max(0, vPeak - a * d); }
      if (s > distance) s = distance;
      return { pos: p0 + dir * s, vel: dir * vel, done: false };
    },
  };
}

// md：MD 的 axes[] 一筆；pos：初始位置（posUnit）
export function createAxis(md, pos) {
  const ax = {
    md, pos, vel: 0, enabled: true, homed: true, fault: null,
    move: null,          // trapezoid()
    stop: null,          // { startUs, pos, vel（帶正負號）, decel（> 0） }
    home: null,          // { startUs, from }
    following: 0,        // 生效中、未超差的追隨誤差（posUnit）：回報的 pos = 命令位置 + following
    get busy() { return !!(this.move || this.stop || this.home); },
    update(tUs, homeDurationUs) {
      if (this.move) {
        const r = this.move.at(tUs); this.pos = r.pos; this.vel = r.vel;
        if (r.done) { this.move = null; this.vel = 0; }
      } else if (this.stop) {
        const s = this.stop, duration = Math.abs(s.vel) / s.decel, t = (tUs - s.startUs) / 1e6, sign = s.vel >= 0 ? 1 : -1;
        if (t >= duration) { this.pos = s.pos + sign * s.vel * s.vel / (2 * s.decel); this.vel = 0; this.stop = null; }
        else { this.pos = s.pos + s.vel * t - sign * 0.5 * s.decel * t * t; this.vel = s.vel - sign * s.decel * t; }
      } else if (this.home) {
        const h = this.home, elapsed = tUs - h.startUs;
        if (elapsed >= homeDurationUs) { this.pos = 0; this.vel = 0; this.home = null; this.homed = true; }
        else { this.pos = h.from * (1 - elapsed / homeDurationUs); this.vel = -h.from / (homeDurationUs / 1e6); }
      }
    },
    // 立即停止（故障）：清掉所有運動、速度歸零
    halt() { this.move = null; this.stop = null; this.home = null; this.vel = 0; },
    state() {
      const busy = this.busy;
      return { pos: this.pos + this.following, vel: this.vel, busy, inPos: !busy, enabled: this.enabled, homed: this.homed, fault: this.fault };
    },
  };
  return ax;
}
