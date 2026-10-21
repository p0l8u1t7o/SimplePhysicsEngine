// 機器人的運動學模型（與假 SPE 的 RobotModel 相同的時間規則）：關節線性插值移動（q 單位 rad，順序同 MD robots[].joints），
// 任務 start → running，固定時長後 done。move 的位姿目標（pos／rot）交給站提供的 ik(target)；站沒有提供時關節不變、忙碌 1 s（同假 SPE）。

// md：MD 的 robots[] 一筆；q：初始關節角（rad）
export function createRobot(md, q) {
  const n = md.joints?.length ?? 6;
  return {
    md, q: Array.from({ length: n }, (_, i) => q?.[i] ?? 0),
    from: null, to: null, moveStartUs: 0, moveUs: 0,
    task: 'idle', taskName: null, taskEndUs: 0, fault: null,
    get moving() { return this.to !== null; },
    get busy() { return this.moving || this.task === 'running'; },
    // 各關節的 vMax（rad/s）：MD 是 deg/s，沒寫時 180 deg/s（同假 SPE）
    vmax(i) { return (md.joints?.[i]?.vMax ?? 180) * Math.PI / 180; },
    // 關節移動：時間 = max(|Δq_i| / vMax_i) ÷ (speed / 100)，整數 µs 進位、至少 1 µs
    moveJoints(target, speed, nowUs) {
      let seconds = 0;
      for (let i = 0; i < target.length; i++) seconds = Math.max(seconds, Math.abs(target[i] - this.q[i]) / this.vmax(i));
      this.start(target, Math.ceil(seconds / (speed / 100) * 1e6), nowUs);
    },
    start(target, durationUs, nowUs) { this.from = this.q; this.to = [...target]; this.moveStartUs = nowUs; this.moveUs = Math.max(1, durationUs); },
    halt() { this.from = null; this.to = null; },
    update(tUs) {
      if (this.to && this.from) {
        const elapsed = tUs - this.moveStartUs;
        if (elapsed >= this.moveUs) { this.q = this.to; this.to = null; this.from = null; }
        else { const r = elapsed / this.moveUs, f = this.from, t = this.to; this.q = f.map((v, i) => v + (t[i] - v) * r); }
      }
      if (this.task === 'running' && tUs >= this.taskEndUs) this.task = 'done';
    },
    state(rail) {
      const s = { q: this.q, busy: this.busy, task: this.task, taskName: this.taskName, fault: this.fault };
      if (rail !== undefined) s.rail = rail;
      return s;
    },
  };
}
