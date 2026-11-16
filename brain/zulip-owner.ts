import type { JournalEvent } from './journal';

/**
 * A Zulip sender gets owner authority only from an owner console confirmation of the exact
 * numeric id. The normal installation setting takes precedence; this journal fallback also lets
 * a body running with the old environment learn a confirmation without silently weakening it.
 * Zulip messages, notes, quoted text and display names never establish identity.
 */
export function confirmedZulipOwnerId(events: JournalEvent[], fallback: number | undefined): number | undefined {
  if (fallback !== undefined) return fallback;
  let id: number | undefined;
  for (const event of events) {
    if (event.type !== 'stimulus' || event.source !== 'terminal') continue;
    const match = event.text.trim().match(/^Zulip user (\d+) is me$/);
    if (!match) continue;
    const confirmed = Number(match[1]);
    if (Number.isSafeInteger(confirmed) && confirmed > 0) id = confirmed;
  }
  return id;
}
