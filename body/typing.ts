import { zulipCredentials } from './zulip';
import type { JournalEvent } from '../brain/journal';

/** A Zulip destination obtained from the sensor's authenticated message, never from prose. */
export type ZulipTarget = { type: 'direct'; to: number[] } | { type: 'stream'; stream_id: number; topic: string };

export function zulipTypingTarget(e?: Extract<JournalEvent, { type: 'stimulus' }>): ZulipTarget | undefined {
  if (!e || (e.source !== 'agent:zulip' && e.source !== 'owner:zulip')) return;
  const first = e.text.split('\n', 1)[0];
  // Old arrivals before the typed-private/mention distinction have no route: fail silent rather
  // than guessing a recipient from history or a name in the content.
  if (!/^Zulip (private|mention) [1-9][0-9]*$/.test(first ?? '')) return;
  const line = e.text.split('\n')[2];
  let m: Record<string, unknown>;
  try { m = JSON.parse(line ?? ''); } catch { return; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return;
  if (m.type === 'private' && Number.isSafeInteger(m.sender_id) && (m.sender_id as number) > 0) return { type: 'direct', to: [m.sender_id as number] };
  if (m.type === 'stream' && Number.isSafeInteger(m.stream_id) && (m.stream_id as number) > 0 && typeof m.topic === 'string' && m.topic.length <= 200) return { type: 'stream', stream_id: m.stream_id as number, topic: m.topic };
  return;
}

interface TypingOptions {
  credentials: () => { site: string; email: string; api_key: string } | undefined;
  target: () => ZulipTarget | undefined;
  send?: typeof fetch;
  refreshMs?: number;
  signal?: AbortSignal;
}

/** One external status channel. The callback must remain bounded after an interruption. */
export type TypingStatus = (active: boolean) => void;
export type TypingScope = (target?: string) => TypingStatus;

/** Wires the individual's configured Zulip account to the current external stimulus only. */
export function zulipTypingScope(path: string): (stimulus?: Extract<JournalEvent, { type: 'stimulus' }>) => TypingStatus {
  return (stimulus) => {
    const target = zulipTypingTarget(stimulus);
    if (!target) return () => {};
    const typing = zulipTyping({ credentials: () => zulipCredentials(path), target: () => target });
    return active => typing(active);
  };
}

/**
 * Shows typing only while a real response turn is under way. No marker on clock, work or memory
 * turns. Start/refresh failures are deliberately invisible and never block or change the answer.
 * stop always runs in the caller's finally; the receiving client's TTL covers a crashed process.
 */
export function zulipTyping(o: TypingOptions): TypingStatus {
  const refreshMs = o.refreshMs ?? 10_000;
  let active = false, stopped = false, queued: boolean | null = null, sending = false;
  async function send(op: 'start' | 'stop'): Promise<void> {
    if (stopped && op === 'start') return;
    const c = o.credentials(), target = o.target();
    if (!c || !target) return;
    try {
      await (o.send ?? fetch)(new URL('/api/v1/typing', c.site), {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(c.email + ':' + c.api_key).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ type: target.type, op, ...(target.type === 'direct' ? { to: JSON.stringify(target.to) } : { stream_id: String(target.stream_id), topic: target.topic }) }),
        redirect: 'error', signal: AbortSignal.timeout(5_000),
      });
    } catch { /* a status never costs a response */ }
  }
  const drain = async () => {
    if (sending) return;
    sending = true;
    try {
      while (queued !== null) {
        const next = queued; queued = null;
        await send(next ? 'start' : 'stop');
        if (next) last = Date.now();
      }
    } finally { sending = false; }
  };
  let last = 0;
  const timer = setInterval(() => {
    if (active && !stopped && !o.signal?.aborted && Date.now() - last >= refreshMs) { queued = true; void drain(); }
  }, refreshMs);
  const abort = () => { active = false; queued = false; clearInterval(timer); void drain(); };
  o.signal?.addEventListener('abort', abort, { once: true });
  return (next) => {
    if (stopped || o.signal?.aborted) next = false;
    if (next && !o.target()) return;
    if (next === active) return;
    active = next; queued = next;
    if (!next) { stopped = true; clearInterval(timer); o.signal?.removeEventListener('abort', abort); }
    void drain();
  };
}
