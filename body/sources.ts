import { cancellation } from './cancellation';
import { createHash } from 'node:crypto';

export interface Source { repository: string; commit: string; path: string }
export function validateSources(value: unknown): Source[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('Provide 1–3 sources');
  const seen = new Set<string>();
  return value.map(s => {
    if (!s || typeof s.repository !== 'string' || !/^[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(s.repository)
      || typeof s.commit !== 'string' || !/^[a-f0-9]{40}$/.test(s.commit)
      || typeof s.path !== 'string' || s.path.length > 300 || !s.path.split('/').every((p: string) => /^[A-Za-z0-9_.-]+$/.test(p) && p !== '.' && p !== '..')) throw new Error('Invalid immutable GitHub source');
    const source = {repository:s.repository, commit:s.commit, path:s.path};
    const key = JSON.stringify(source);
    if (seen.has(key)) throw new Error('Duplicate source');
    seen.add(key); return source;
  });
}

/** Fixed-origin host retrieval. Trusts platform DNS/TLS; no child networking. */
export async function retrieveSources(input: unknown, send: typeof fetch = fetch, timeoutMs = 15000, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const sources = validateSources(input);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 15000) throw new Error('Invalid retrieval deadline');
  const controller = new AbortController();
  const parent = cancellation(signal, controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let total = 0;
  const run = async () => {
    const results = [];
    for (const source of sources) {
      controller.signal.throwIfAborted();
      const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${source.path}`;
      const response = await send(url, {redirect:'error', credentials:'omit', signal:controller.signal});
      if (controller.signal.aborted || response.status !== 200 || response.redirected || !response.body) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Source fetch failed');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, {once:true});
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const {done, value} = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          size += value.byteLength; total += value.byteLength;
          if (size > 16000 || total > 32000) throw new Error('Source byte limit exceeded');
          chunks.push(value);
        }
        const bytes = Buffer.concat(chunks);
        const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
        if (text.includes('\0')) throw new Error('Binary source refused');
        results.push({...source, url, retrievedAt:new Date().toISOString(), sha256:createHash('sha256').update(bytes).digest('hex'), untrusted:true, text});
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        cancel();
      }
    }
    return results;
  };
  try {
    return await Promise.race([parent.cancelled, run(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => {controller.abort(); reject(new Error('Source deadline exceeded'));},timeoutMs);
    })]);
  } finally { clearTimeout(timer); parent.dispose(); controller.abort(); }
}
