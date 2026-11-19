import type { JournalEvent } from '../brain/journal';

/** One best-effort external status callback. It must not delay or fail the response turn. */
export type TypingStatus = (active: boolean) => void;
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
