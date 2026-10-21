// SPE-AC-01 分框：只送 LF、無 BOM、單行緊湊 JSON；容忍 \r\n、忽略空行；超長 → LINE_TOO_LONG；BOM／非 JSON 物件 → BAD_JSON
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLineReader, parseMessage, encodeMessage, MIN_MAX_LINE } from '../framing.js';

const bytes = s => new TextEncoder().encode(s);

test('分行：LF、\\r\\n、空行、跨 chunk', () => {
  const r = createLineReader();
  assert.deepEqual(r.push(bytes('{"t":"a"}\r\n\n{"t":')).lines, ['{"t":"a"}']);
  assert.deepEqual(r.push(bytes('"b"}\n\r\n')).lines, ['{"t":"b"}']);
});

test('超過上限（含 LF）→ LINE_TOO_LONG，之後不再輸出', () => {
  const r = createLineReader({ maxLine: MIN_MAX_LINE });
  const ok = 'x'.repeat(MIN_MAX_LINE - 1) + '\n';
  assert.equal(r.push(bytes(ok)).lines.length, 1);
  const res = r.push(bytes('y'.repeat(MIN_MAX_LINE)));   // 還沒收到 LF 就已經放不下
  assert.equal(res.error.code, 'LINE_TOO_LONG');
  assert.deepEqual(r.push(bytes('{}\n')).lines, []);
  assert.ok(r.closed);
});

test('BOM、非 UTF-8 → BAD_JSON', () => {
  assert.equal(createLineReader().push(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a])).error.code, 'BAD_JSON');
  assert.equal(createLineReader().push(new Uint8Array([0xff, 0xfe, 0x0a])).error.code, 'BAD_JSON');
});

test('parseMessage：非 JSON、陣列、null → BAD_JSON', () => {
  for (const s of ['nope', '[1]', 'null', '3']) assert.equal(parseMessage(s).error.code, 'BAD_JSON');
  assert.deepEqual(parseMessage('{"t":"bye","reason":"done"}').msg, { t: 'bye', reason: 'done' });
});

test('encodeMessage：緊湊單行、只有結尾 LF；超過對方 maxLine 不送', () => {
  const { text, bytes: b } = encodeMessage({ t: 'event', msg: 'a\nb' });
  assert.equal(text, '{"t":"event","msg":"a\\nb"}\n');
  assert.equal(b.filter(x => x === 10).length, 1);
  assert.notEqual(b[0], 0xef);
  assert.equal(encodeMessage({ t: 'log', msg: 'x'.repeat(MIN_MAX_LINE) }, MIN_MAX_LINE).error.code, 'LINE_TOO_LONG');
});
