// 時間軌（core/anim/track.js）：軌尾的 hold(until) 算進 end 與 total；取樣只看時間
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline } from '../track.js';

test('軌尾的 hold 算進 total；hold 在步驟之前則不影響', () => {
  const tl = createTimeline(), a = tl.track('a', { x: 0 }), b = tl.track('b', { y: 0 });
  a.add(2, { x: 1 });
  b.add(1, { y: 1 }); b.hold(5);                       // b 做完後要等到 5 s（例如等下一個週期）
  assert.equal(b.end, 5);
  assert.equal(tl.total, 5, '之前是 2：軌尾的等待沒算進 total');
  const c = tl.track('c', { z: 0 }); c.hold(1); c.add(1, { z: 1 });
  assert.equal(c.end, 2, 'hold 在前：end 就是最後一步結束');
});

test('取樣：倒著取和依序取結果相同，hold 期間維持最後狀態', () => {
  const tl = createTimeline(), a = tl.track('a', { x: 0 });
  a.add(2, { x: 10 }); a.hold(4);
  const fwd = [0, 1, 2, 3, 4].map(t => tl.sample(t).a.x), back = [4, 3, 2, 1, 0].map(t => tl.sample(t).a.x).reverse();
  assert.deepEqual(fwd, back);
  assert.equal(tl.sample(3.5).a.x, 10);
});
