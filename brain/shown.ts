import { acceptanceNotes } from '../body/acceptance';
import { stemNote } from './stemnote';
import type { JournalEvent } from './journal';
import { standing } from './owned';

/** Written before a request. The id is the last journal event that request may contain. */
export const SHOWN_KIND = 'brain.shown.v1';

interface Shown { through: string }

function shownAt(e: JournalEvent): string | null {
  if (e.type !== 'note' || e.kind !== SHOWN_KIND) return null;
  const through = (e.data as Partial<Shown> | null)?.through;
  return typeof through === 'string' ? through : null;
}

/**
 * Whether the reply answers the latest thing that calls for a turn. A late stimulus is
 * journaled before the reply; order alone would otherwise lose it if the process dies
 * before the extra round. Requests and replies are paired by journal order.
 */
export function replyIsCurrent(events: JournalEvent[], reply: JournalEvent): boolean {
  const at = events.findIndex(e => e.id === reply.id);
  if (at < 0 || reply.type !== 'assistant') return false;
  const accepted = acceptanceNotes(events);
  const owed = (e: JournalEvent): boolean => e.type === 'stimulus' || stemNote(e) !== null || accepted.has(e.id);
  let latest: JournalEvent | undefined;
  for (const e of events.slice(0, at)) if (owed(e)) latest = e;
  // The boundary belongs to this request, not to a later one: stop at the previous reply.
  let previousReply = -1;
  for (let i = at - 1; i >= 0; i--) if (events[i]!.type === 'assistant') { previousReply = i; break; }
  if (latest === undefined) return true;
  // A late arrival that precedes a reply was included in its request if its id is at or
  // before the request boundary, even when the request is not the nearest preceding note
  // (a tool result or another reply may intervene).
  for (let i = at - 1; i > previousReply; i--) {
    const through = shownAt(events[i]!);
    if (through === null) continue;
    if (through === latest.id) return true;
    const boundary = events.findIndex(e => e.id === through);
    if (boundary < 0) return false; // taken back: no proof this reply saw the current event
    const target = events.findIndex(e => e.id === latest!.id);
    return target >= 0 && target <= boundary;
  }
  // Before request boundaries existed, an event before the reply is indistinguishable
  // from a late one. Do not make every historical journal permanently owe a turn.
  return true;
}
