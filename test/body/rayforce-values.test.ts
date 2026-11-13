import { test, expect } from 'bun:test';
import { encodeRayData, decodeRayValue } from '../../body/rayforce-values';
test('typed data roundtrips without source conversion', () => {
  const r = decodeRayValue(encodeRayData(['(set injected 1)', '世界\0text', 9007199254740993n, true, null, [1.5]]));
  expect(r).toEqual({ type: 0, items: [
    { type: -13, value: '(set injected 1)' }, { type: -13, value: '世界\0text' },
    { type: -5, value: 9007199254740993n }, { type: -1, value: true }, { type: 126, value: null },
    { type: 0, items: [{ type: -7, value: 1.5 }] },
  ] });
});
test('bounded data encoder rejects executable objects, cycles and invalid text', () => {
  for (const v of [{ type: 103 }, NaN, Infinity, '\ud800', 2n ** 63n]) expect(() => encodeRayData(v as never)).toThrow();
  const a: any[] = []; a.push(a); expect(() => encodeRayData(a)).toThrow();
  expect(() => encodeRayData(Array(10001).fill(null))).toThrow();
});
test('decoder rejects truncation, unknown attrs, trailing bytes and large counts', () => {
  const good = encodeRayData(['hello', [1n]]);
  for (let n = 0; n < good.length; n++) expect(() => decodeRayValue(good.subarray(0, n))).toThrow();
  expect(() => decodeRayValue(Buffer.concat([good, Buffer.from([0])]))).toThrow();
  const bad = Buffer.from(good); bad[1] = 128; expect(() => decodeRayValue(bad)).toThrow();
  bad[1] = 0; bad.writeBigInt64LE(9999999999n, 2); expect(() => decodeRayValue(bad)).toThrow();
});
test('table schema W64 marker and rectangular columns', () => {
  const schema = Buffer.alloc(10); schema[0] = 12; schema[1] = 3; schema.writeBigInt64LE(1n, 2);
  const raw = Buffer.concat([Buffer.from([98, 0]), schema, Buffer.from('text\0'), encodeRayData([['hello']])]);
  expect(decodeRayValue(raw)).toEqual({ type: 98, names: ['text'], columns: [{ type: 0, items: [{ type: -13, value: 'hello' }] }] });
});
test('STR vector permits HAS_NULLS while unknown attributes stay rejected', () => {
  // Rayforce v3.0.2 marks an empty STR vector element as canonical null with wire attr 0x40.
  const empty = Buffer.alloc(8), one = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 120]);
  const raw = Buffer.concat([Buffer.from([13, 0x40]), Buffer.from([2, 0, 0, 0, 0, 0, 0, 0]), empty, one]);
  expect(decodeRayValue(raw)).toEqual({ type: 13, items: [{ type: -13, value: '' }, { type: -13, value: 'x' }] });
  raw[1] = 0x80; expect(() => decodeRayValue(raw)).toThrow('Unsupported compound/vector attributes');
  const numeric = Buffer.from(raw); numeric[0] = 5; numeric[1] = 0x40;
  expect(() => decodeRayValue(numeric)).toThrow('Unsupported compound/vector attributes');
});
test('typed transport sends builtin list envelope to fake server', async () => {
  const { createServer } = await import('node:net');
  const { sendRayData } = await import('../../body/rayforce');
  let greeted = false, pending = Buffer.alloc(0);
  const server = createServer(socket => socket.on('data', chunk => {
    pending = Buffer.concat([pending, Buffer.from(chunk)]);
    if (!greeted) {
      if (pending.length < 2) return;
      pending = pending.subarray(2); greeted = true; socket.write(Buffer.from([3, 0]));
    }
    if (pending.length < 16 || pending.length < 16 + Number(pending.readBigInt64LE(8))) return;
    expect(pending.subarray(26, 31)).toEqual(Buffer.from([108, 105, 115, 116, 0]));
    expect(decodeRayValue(pending.subarray(31))).toEqual({ type: -13, value: '(set injected 1)' });
    const payload = encodeRayData(['(set injected 1)']);
    const header = Buffer.alloc(16); header.writeUInt32LE(0xcefadefa); header[4] = 3; header[7] = 2;
    header.writeBigInt64LE(BigInt(payload.length), 8); socket.end(Buffer.concat([header, payload]));
  }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await sendRayData((server.address() as { port: number }).port, '(set injected 1)');
    expect(r).toEqual({ type: 0, items: [{ type: -13, value: '(set injected 1)' }] });
  } finally { server.close(); }
});
test('reject sparse lists and preserve leading BOM as data', () => {
  expect(() => encodeRayData(new Array(2))).toThrow('Sparse');
  expect(decodeRayValue(encodeRayData('\ufeffhello'))).toEqual({ type: -13, value: '\ufeffhello' });
});
