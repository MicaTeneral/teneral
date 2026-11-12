import { decodeRayScalar, type RayScalar } from './rayforce';
export type RayData = null | boolean | bigint | number | string | RayData[];
export type RayValue = RayScalar | { type: number; items: RayValue[] } | { type: 98; names: string[]; columns: RayValue[] };
const MAX = 1024 * 1024, COUNT = 10000, DEPTH = 32;
/** Closed data subset: no symbols, executable heads or object coercion. */
export function encodeRayData(value: RayData): Buffer {
  let bytes = 0, nodes = 0;
  const charge = (n: number) => { bytes += n; if (bytes > MAX) throw Error('Rayforce data byte limit'); };
  function enc(v: RayData, depth: number): Buffer {
    if (depth > DEPTH || ++nodes > COUNT) throw Error('Rayforce data complexity limit');
    if (v === null) { charge(1); return Buffer.from([126]); }
    if (Array.isArray(v)) {
      if (v.length > COUNT) throw Error('Rayforce list count limit');
      charge(10); const h = Buffer.alloc(10); h.writeBigInt64LE(BigInt(v.length), 2);
      const items: Buffer[] = [h];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw Error('Sparse Rayforce list');
        items.push(enc(v[i]!, depth + 1));
      }
      return Buffer.concat(items);
    }
    if (typeof v === 'string') {
      if (!v.isWellFormed() || v.length > MAX) throw Error('Invalid Rayforce text');
      const text = Buffer.from(v); charge(10 + text.length);
      const h = Buffer.alloc(10); h.writeInt8(-13); h.writeBigInt64LE(BigInt(text.length), 2);
      return Buffer.concat([h, text]);
    }
    if (typeof v === 'boolean') { charge(3); return Buffer.from([255, 0, Number(v)]); }
    if (typeof v === 'bigint') {
      charge(10); const b = Buffer.alloc(10); b.writeInt8(-5); b.writeBigInt64LE(v, 2); return b;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      charge(10); const b = Buffer.alloc(10); b.writeInt8(-7); b.writeDoubleLE(v, 2); return b;
    }
    throw Error('Unsupported Rayforce input');
  }
  return enc(value, 0);
}

/** Strict bounded wire-v3 subset. Vector attrs must be zero: nullable/sorted
 * vectors are refused until their semantics are implemented, not guessed. */
export function decodeRayValue(b: Buffer): RayValue {
  if (b.length > MAX) throw Error('Rayforce value byte limit');
  let p = 0, nodes = 0;
  const take = (n: number) => {
    if (n < 0 || p + n > b.length) throw Error('Truncated Rayforce value');
    const s = b.subarray(p, p + n); p += n; return s;
  };
  const len = (max = COUNT) => { const n = take(8).readBigInt64LE(); if (n < 0n || n > BigInt(max)) throw Error('Rayforce length limit'); return Number(n); };
  const text = (s: Buffer) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(s);
  const z = () => { const end = b.indexOf(0, p); if (end < 0) throw Error('Unterminated symbol'); const s = text(take(end - p)); take(1); return s; };
  const widths: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 4, 7: 8, 8: 4, 9: 4, 10: 8, 16: 8 };
  function dec(depth: number): RayValue {
    if (depth > DEPTH || ++nodes > COUNT) throw Error('Rayforce value complexity limit');
    const start = p, type = take(1).readInt8();
    if (type === 126) return { type, value: null };
    if (type === 127) { take(8); return decodeRayScalar(b.subarray(start, p)); }
    if (type < 0) {
      const flags = take(1)[0]!; if (flags & ~1) throw Error('Unsupported atom flags');
      if (type === -13) { const s = text(take(len(MAX))); return { type, value: flags ? null : s }; }
      if (type === -12) { const s = z(); return { type, value: flags ? null : s }; }
      const w = widths[-type]; if (!w) throw Error('Unsupported atom'); take(w);
      return decodeRayScalar(b.subarray(start, p));
    }
    const attrs = take(1)[0]!;
    // Schema symbol vectors are emitted with W64=3; cells remain NUL strings.
    if (attrs !== 0 && !(type === 12 && attrs === 3)) throw Error('Unsupported compound/vector attributes');
    if (type === 98) {
      const names = dec(depth + 1), cols = dec(depth + 1);
      if (names.type !== 12 || !('items' in names) || cols.type !== 0 || !('items' in cols)) throw Error('Invalid table layout');
      const keys = names.items.map(x => { if (!('value' in x) || typeof x.value !== 'string') throw Error('Invalid column name'); return x.value; });
      if (new Set(keys).size !== keys.length || keys.length !== cols.items.length) throw Error('Invalid table columns');
      let rows: number | undefined;
      for (const c of cols.items) { if (!('items' in c) || (rows !== undefined && c.items.length !== rows)) throw Error('Ragged/non-vector table'); rows = c.items.length; }
      return { type: 98, names: keys, columns: cols.items };
    }
    if (type !== 0 && type !== 12 && type !== 13 && !widths[type]) throw Error('Unsupported compound type');
    const n = len(); if (nodes + n > COUNT) throw Error('Rayforce element limit');
    const items: RayValue[] = [];
    for (let i = 0; i < n; i++) {
      if (type === 0) items.push(dec(depth + 1));
      else {
        nodes++;
        if (type === 12) items.push({ type: -12, value: z() });
        else if (type === 13) items.push({ type: -13, value: text(take(len(MAX))) });
        else {
          const h = Buffer.from([256 - type, 0]);
          items.push(decodeRayScalar(Buffer.concat([h, take(widths[type]!)])));
        }
      }
    }
    return { type, items };
  }
  const result = dec(0); if (p !== b.length) throw Error('Trailing Rayforce bytes'); return result;
}
