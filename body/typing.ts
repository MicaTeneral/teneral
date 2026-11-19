import { zulipCredentials } from './zulip';
import type { JournalEvent } from '../brain/journal';

/** A Zulip destination obtained from the sensor's authenticated message, never from prose. */
export type ZulipTarget = { type: 'direct'; to: number[] } | { type: 'stream'; stream_id: number; topic: string };

export function zulipTypingTarget(e?: Extract<JournalEvent, { type: 'stimulus' }>): ZulipTarget | undefined {
  if (!e || (e.source !== 'agent:zulip' && e.source !== 'owner:zulip')) return;
  const first = e.text.split('\n', 1)[0];
  // Old arrivals before the typed-private/mention distinction have no route: fail silent rather
  // than guessing a recipient from history or a name in the content.
  if (!/^Zulip (private|mention|stream) [1-9][0-9]*$/.test(first ?? '')) return;
  const lines = e.text.split('\n').slice(2);
  // Ambient traffic is batched: use its last complete message, so typing stays in that exact topic.
  let m: Record<string, unknown> | undefined;
  for (const line of lines) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) m = parsed as Record<string, unknown>;
  }
  if (!m) return;
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

export type RayboardTypingTarget = { url: string; tokenFile: string; subject: string };

export function rayboardTypingTarget(e?: Extract<JournalEvent, { type: 'stimulus' }>, url = process.env.TENERAL_RAYBOARD_URL, tokenFile = process.env.TENERAL_RAYBOARD_TOKEN_FILE): RayboardTypingTarget | undefined {
  if ((e?.source !== 'agent:rayboard' && e?.source !== 'owner:rayboard') || !url || !tokenFile) return;
  const n = (() => { try { return JSON.parse(e.text.slice(e.text.indexOf('\n') + 1)); } catch { return null; } })();
  if (!n || !['message', 'mention', 'comment', 'dm'].includes(n.type) || typeof n.subject !== 'string') return;
  if (!/^(?:T-[1-9][0-9]*|dm:(?:a|u)_[a-z0-9]{8}:(?:a|u)_[a-z0-9]{8}|c_[a-z0-9]{8})$/.test(n.subject)) return;
  return { url, tokenFile, subject: n.subject };
}

/** An agent report uses the accepted server contract, including its bounded long-composition hold. */
export function rayboardTyping(o: { target: () => RayboardTypingTarget | undefined; lastTarget?: RayboardTypingTarget; send?: typeof fetch; refreshMs?: number; signal?: AbortSignal }): TypingStatus {
  const refreshMs = o.refreshMs ?? 30_000;
  let active = false, stopped = false, timer: ReturnType<typeof setInterval> | undefined;
  let sent: Promise<void> = Promise.resolve();
  let pending = false;
  const send = async (composing: boolean, target: RayboardTypingTarget): Promise<void> => {
    try {
      const token = (await Bun.file(target.tokenFile).text()).trim();
      if (!token) return;
      await (o.send ?? fetch)(target.url + '/api/call/typing', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: target.subject, composing, ...(composing ? { hold: 60 } : {}) }), redirect: 'error', signal: AbortSignal.timeout(5_000) });
    } catch { /* the answer must not depend on a presence indicator */ }
  };
  // Token I/O yields. Preserve invocation order so stop cannot overtake a start still reading its token.
  const queue = (composing: boolean): void => {
    if (composing && stopped) return;
    const target = o.lastTarget;
    pending ||= composing;
    sent = sent.then(async () => {
      const next = pending; pending = false;
      if (target === undefined) return;
      if (next) await send(true, target);
      if (stopped && !next) await send(false, target);
    });
  };
  const abort = () => status(false);
  o.signal?.addEventListener('abort', abort, { once: true });
  const status = (next: boolean) => {
    if (stopped || o.signal?.aborted) next = false;
    if (next && !o.target()) return;
    if (next && !active) {
      o.lastTarget = o.target();
      active = true;
      void queue(true);
      timer = setInterval(() => queue(true), refreshMs);
    }
    if (!next) {
      stopped = true; active = false;
      if (timer) clearInterval(timer);
      o.signal?.removeEventListener('abort', abort);
      void queue(false);
    }
  };
  return status;
}

export function rayboardTypingScope(e?: Extract<JournalEvent, { type: 'stimulus' }>): TypingStatus {
  return rayboardTyping({ target: () => rayboardTypingTarget(e) });
}
