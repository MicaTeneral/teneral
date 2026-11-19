import { journalSize, readEvents, readEventsFrom, type JournalEvent } from '../brain/journal';

// The journal as the body's sensors look at it between turns. They look often, every few
// seconds, and the journal only grows; read whole each time, a journal of a week costs a tenth of
// a second of parsing a look, for ever more as it gets longer. So what was read is kept, and a
// look reads only what was appended since. The array handed out is never changed afterwards: a
// longer one takes its place.

/** How many of the latest events are remembered by id, so that a line read twice across two looks is taken once. */
const RECENT = 512;

/** A reader of `path` that parses each line once. A journal that got shorter is not the journal that was read: it is read anew. */
export function journalView(path: string): () => JournalEvent[] {
  let events: JournalEvent[] = [];
  let reached = 0;
  let recent = new Set<string>();
  return () => {
    const size = journalSize(path);
    if (size === reached) return events;
    if (size < reached) {
      events = readEvents(path);
    } else {
      // Another process, the stem, may append while this one reads: what comes back may reach past
      // `size`, and the next look begins at `size` again. An event already taken is passed over.
      const more = readEventsFrom(path, reached).filter((e) => !recent.has(e.id));
      if (more.length > 0) events = events.concat(more);
    }
    reached = size;
    recent = new Set(events.slice(-RECENT).map((e) => e.id));
    return events;
  };
}
