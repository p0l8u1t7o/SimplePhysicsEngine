// 工件持有權轉移（持有權運動學，不是物理；開發計畫 4.5 S6、藍圖 B3）：工件跟著持有者動，持有者由站定義的規則切換。
// 站的孿生描述 twin.transfers：
//   [{ from: 'cell/pallet', to: 'cell/cradle', when: ctx => ctx.state('act-S3-GRIP') === 'clamped' && Math.abs(ctx.pos('ax-CONV') - 1150) <= 2 }]
//   ctx.state(致動器 ID) → 端點狀態名稱（移動中為 null）；ctx.pos(軸 ID) → 位置；ctx.di(io ID) → 上一次回報的 PLC 位準
// 每個 tick 依工件建立順序、規則順序檢查，每個工件一個 tick 最多轉移一次；概念同排程的 latch（core/anim/sequence.js）。
export function applyTransfers(workpieces, rules, ctx) {
  const moved = [];
  if (!rules?.length) return moved;
  for (const w of workpieces) {
    const rule = rules.find(r => r.from === w.holder && r.when(ctx));
    if (!rule) continue;
    w.holder = rule.to;
    moved.push({ wp: w.wp, holder: rule.to });
  }
  return moved;
}
