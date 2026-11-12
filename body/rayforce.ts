import { createConnection } from 'node:net';

export type RayScalar = { type: number; value: bigint | number | string | boolean | null };
const LIMIT = 1024 * 1024;
/** Wire v3 scalar decoder. Unknown types/flags fail closed; never decode i64 as JS number. */
export function decodeRayScalar(b: Buffer): RayScalar {
  if (!b.length) throw Error('Empty Rayforce response');
  const type = b.readInt8(0);
  if (type === 127 && b.length === 9) throw Error('Rayforce: ' + b.subarray(1, 9).toString().replace(/\0.*$/, ''));
  if (type === 126 && b.length === 1) return { type, value: null };
  if (type >= 0 || b.length < 2 || (b[1]! & ~1)) throw Error('Unsupported Rayforce type/flags');
  let value: RayScalar['value'];
  const t = -type;
  if ([5, 10, 16].includes(t) && b.length === 10) value = b.readBigInt64LE(2);
  else if (t === 7 && b.length === 10) value = b.readDoubleLE(2);
  else if (t === 6 && b.length === 6) value = b.readFloatLE(2);
  else if ([4, 8, 9].includes(t) && b.length === 6) value = b.readInt32LE(2);
  else if (t === 3 && b.length === 4) value = b.readInt16LE(2);
  else if (t === 2 && b.length === 3) value = b[2]!;
  else if (t === 1 && b.length === 3 && b[2]! <= 1) value = !!b[2];
  else if (t === 13 && b.length >= 10 && b.readBigInt64LE(2) === BigInt(b.length - 10)) value = b.subarray(10).toString('utf8');
  else if (t === 12 && b.length >= 3 && b.at(-1) === 0 && !b.subarray(2, -1).includes(0)) value = b.subarray(2, -1).toString('utf8');
  else throw Error('Unsupported or malformed Rayforce scalar');
  return { type, value: b[1] === 1 ? null : value };
}

/** Trusted RFL only: eval can mutate files/state. Loopback-only, no retry.
 * Timeout means outcome unknown, NOT rollback. Persistence is a separate contract.
 */
export function evalRayforce(port: number, source: string, timeoutMs = 5000): Promise<RayScalar> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return Promise.reject(Error('Invalid connection bounds'));
  const text = Buffer.from(source);
  if (text.length > LIMIT - 26) return Promise.reject(Error('Rayforce request too large'));
  const frame = Buffer.alloc(26 + text.length);
  frame.writeUInt32LE(0xcefadefa, 0); frame[4] = 3; frame[7] = 1;
  frame.writeBigInt64LE(BigInt(text.length + 10), 8);
  frame.writeInt8(-13, 16); frame.writeBigInt64LE(BigInt(text.length), 18); text.copy(frame, 26);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let data = Buffer.alloc(0), greeted = false, done = false;
    const finish = (err?: Error, value?: RayScalar) => {
      if (done) return; done = true; clearTimeout(timer); socket.destroy();
      if (err) reject(err); else resolve(value!);
    };
    const timer = setTimeout(() => finish(Error('Rayforce deadline exceeded; execution outcome unknown')), timeoutMs);
    socket.on('connect', () => socket.write(Buffer.from([3, 0])));
    socket.on('error', err => finish(err));
    socket.on('close', () => finish(Error('Rayforce closed before response; execution outcome unknown')));
    socket.on('data', chunk => {
      try {
        if (data.length + chunk.length > LIMIT + 18) throw Error('Rayforce response too large');
        data = Buffer.concat([data, Buffer.from(chunk)]);
        if (!greeted) {
          if (data.length < 2) return;
          if (data[0] !== 3 || data[1] !== 0) throw Error('Unsupported Rayforce handshake/auth');
          greeted = true; data = data.subarray(2); socket.write(frame);
        }
        if (data.length < 16) return;
        if (data.readUInt32LE(0) !== 0xcefadefa || data[4] !== 3 || data[5] !== 0 || data[6] !== 0 || data[7] !== 2) throw Error('Unsupported Rayforce frame');
        const n = data.readBigInt64LE(8);
        if (n < 1n || n > BigInt(LIMIT)) throw Error('Invalid Rayforce frame size');
        if (data.length < 16 + Number(n)) return;
        if (data.length !== 16 + Number(n)) throw Error('Unexpected extra Rayforce bytes');
        finish(undefined, decodeRayScalar(data.subarray(16)));
      } catch (e) { finish(e instanceof Error ? e : Error(String(e))); }
    });
  });
}
