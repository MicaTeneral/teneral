import { test, expect } from 'bun:test';
import { createServer } from 'node:net';
import { decodeRayScalar, evalRayforce } from '../../body/rayforce';
function integer(n: bigint) { const b = Buffer.alloc(10); b.writeInt8(-5); b.writeBigInt64LE(n, 2); return b; }
test('Rayforce bigint and typed null preserve type', () => {
  const b = integer(9007199254740993n);
  expect(decodeRayScalar(b)).toEqual({ type: -5, value: 9007199254740993n });
  b[1] = 1; expect(decodeRayScalar(b)).toEqual({ type: -5, value: null });
  expect(() => decodeRayScalar(Buffer.from([5]))).toThrow();
  expect(() => decodeRayScalar(Buffer.from([127, 116, 121, 112, 101, 0, 0, 0, 0]))).toThrow('Rayforce: type');
});
test('loopback IPC handles split handshake/frame and encodes source as string', async () => {
  let request = Buffer.alloc(0);
  const server = createServer(socket => {
    let greeting = true;
    socket.on('data', b => {
      request = Buffer.concat([request, Buffer.from(b)]);
      if (greeting && request.length >= 2) {
        expect([...request.subarray(0, 2)]).toEqual([3, 0]);
        request = request.subarray(2); greeting = false;
        socket.write(Buffer.from([3])); socket.write(Buffer.from([0])); return;
      }
      if (request.length < 16 || request.length < 16 + Number(request.readBigInt64LE(8))) return;
      expect(request.readInt8(16)).toBe(-13);
      expect(request.subarray(26).toString()).toBe('(+ 1 2)');
      const frame = Buffer.alloc(26); frame.writeUInt32LE(0xcefadefa); frame[4] = 3; frame[7] = 2; frame.writeBigInt64LE(10n, 8); integer(3n).copy(frame, 16);
      socket.write(frame.subarray(0, 12)); socket.end(frame.subarray(12));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { expect(await evalRayforce((server.address() as { port: number }).port, '(+ 1 2)')).toEqual({ type: -5, value: 3n }); }
  finally { server.close(); }
});
