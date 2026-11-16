import { stemNote } from './stemnote';
import type { JournalEvent } from './journal';

/** Written before a request. The id is the last journal event that request may contain. */
export const SHOWN_KIND = 'brain.shown.v1';

function shownAt(e: JournalEvent): string | null {
  if (e.type !== 'note' || e.kind !== SHOWN_KIND) return null;
  const through = (e.data as { through?: unknown } | null)?.through;
  return typeof through === 'string' ? through : null;
}

/** Whether a reply saw the latest event that calls for a turn. */
export function replyIsCurrent(events: JournalEvent[], reply: JournalEvent): boolean {
  const at = events.findIndex(e => e.id === reply.id);
  if (at < 0 || reply.type !== 'assistant') return false;
  let latest: JournalEvent | undefined;
  for (const e of events.slice(0, at)) {
    if (e.type === 'stimulus' || stemNote(e) !== null) latest = e;
  }
  // A boundary belongs to this request, not a later one: stop at the previous reply.
  let previousReply = -1;
  for (let i = at - 1; i >= 0; i--) if (events[i]!.type === 'assistant') { previousReply = i; break; }
  if (latest === undefined) return true;
  for (let i = at - 1; i > previousReply; i--) {
    const through = shownAt(events[i]!);
    if (through === null) continue;
    if (through === latest.id) return true;
    const boundary = events.findIndex(e => e.id === through);
    if (boundary < 0) return false;
    const target = events.findIndex(e => e.id === latest!.id);
    return target >= 0 && target <= boundary;
  }
  // Old journals have no boundary. Do not make all their history permanently owe a turn.
  return true;
}
