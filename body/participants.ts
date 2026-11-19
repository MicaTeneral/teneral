import { appendEvent, type JournalEvent } from '../brain/journal';
import { known, type Fact } from '../brain/known';
import { standing } from '../brain/owned';

// Who the agent shares its chats with. A member of a chat knows who the others are: their names,
// which of them are programs, what each works on and answers for. The agent is told none of that
// by a message's sender id, so it is kept here, for every participant, a person, a bot or another
// agent alike.
//
// Two things are kept, both in the journal. That someone exists, as the service identifies them:
// their id there, their name, whether the service says they are a bot, and where the agent first
// met them. And what the agent knows of them, which is an ordinary fact naming them
// (brain/known.ts), set down by the agent itself when it learns it. When a message wakes the
// agent, it is shown who is speaking and what it knows of each, so that what it learned of
// someone last week is in front of it when they speak again.
//
// What someone says of themselves is theirs: such a fact is `read`, never the owner's word, and
// nobody becomes the owner by saying so.

export const PARTICIPANT_KIND = 'chat.participant.v1';
/** A place the agent heard from for the first time, with who was there then. */
export const PLACE_KIND = 'chat.place.v1';

export interface Participant {
  /** The service and the id it gives them: `zulip`, `7`. Together they are who this is; a name is not. */
  service: string;
  id: string;
  name: string;
  /** Whether the service says it is a bot; undefined when the service has not said. */
  bot?: boolean;
  /** Where the agent first met them, in the service's own words for the place. */
  met?: string;
}

const keyOf = (p: Pick<Participant, 'service' | 'id'>): string => `${p.service}:${p.id}`;

/** Everyone the journal holds, by service and id, as last recorded. */
export function participants(events: JournalEvent[]): Map<string, Participant> {
  const all = new Map<string, Participant>();
  for (const e of events) {
    if (e.type !== 'note' || e.kind !== PARTICIPANT_KIND || typeof e.data !== 'object' || e.data === null) continue;
    const d = e.data as Record<string, unknown>;
    if (typeof d.service !== 'string' || typeof d.id !== 'string' || typeof d.name !== 'string') continue;
    all.set(keyOf({ service: d.service, id: d.id }), {
      ...all.get(keyOf({ service: d.service, id: d.id })), service: d.service, id: d.id, name: d.name.slice(0, 200),
      ...(typeof d.bot === 'boolean' ? { bot: d.bot } : {}), ...(typeof d.met === 'string' ? { met: d.met.slice(0, 200) } : {}),
    });
  }
  return all;
}

/** The places the journal holds, by service and place id. */
export function places(events: JournalEvent[]): Set<string> {
  const all = new Set<string>();
  for (const e of events) {
    if (e.type === 'note' && e.kind === PLACE_KIND && typeof e.data === 'object' && e.data !== null) {
      const d = e.data as Record<string, unknown>;
      if (typeof d.service === 'string' && typeof d.id === 'string') all.add(`${d.service}:${d.id}`);
    }
  }
  return all;
}

/**
 * Records who was seen: a note for everyone not known yet, and for one whose name or kind the
 * service now gives differently. Returns those who are new. Nothing is written for the unchanged.
 */
export function meet(journal: string, gen: string, events: JournalEvent[], seen: Participant[]): Participant[] {
  const held = participants(events);
  const fresh: Participant[] = [];
  for (const p of seen) {
    const old = held.get(keyOf(p));
    if (old !== undefined && old.name === p.name && (p.bot === undefined || old.bot === p.bot)) continue;
    // Where they were first met is kept from the first meeting.
    const now = { ...p, ...(old?.met !== undefined ? { met: old.met } : {}) };
    appendEvent(journal, gen, { type: 'note', kind: PARTICIPANT_KIND, data: now });
    held.set(keyOf(p), now);
    if (old === undefined) fresh.push(now);
  }
  return fresh;
}

/** The most facts shown of one participant, and the most characters of each. */
const FACTS_EACH = 4;
const FACT_CHARS = 240;

/** The facts that name this participant: by the name the service gives, or its first word, spaces and case aside. */
export function knownOf(facts: Fact[], name: string): Fact[] {
  const flat = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const whole = flat(name);
  const first = whole.split(' ')[0] ?? '';
  if (whole.length < 3) return [];
  return facts.filter((f) => {
    const about = flat(f.about ?? '');
    return about.length >= 3 && (about === whole || about === first || whole.startsWith(`${about} `) || about.startsWith(`${whole} `));
  });
}

/**
 * Who is speaking, for the end of a stimulus: each participant with what kind they are and what
 * the agent knows of them. `fresh` are those met in this very message.
 */
export function whoLines(events: JournalEvent[], speakers: Participant[], fresh: Participant[] = []): string {
  if (speakers.length === 0) return '';
  const facts = known(standing(events)).facts;
  const rows = speakers.map((p) => {
    const kind = p.bot === true ? 'a bot' : p.bot === false ? 'not a bot, by the service' : 'kind not known';
    const of = knownOf(facts, p.name).slice(-FACTS_EACH);
    const first = fresh.some((f) => keyOf(f) === keyOf(p));
    const what = of.length === 0 ? (first ? 'you have not met them before' : 'you have set nothing down about them yet')
      : of.map((f) => `${f.mark} [${f.source}] ${f.text.replace(/\s+/g, ' ').slice(0, FACT_CHARS)}`).join(' · ');
    return `- ${p.name} (${keyOf(p)}, ${kind}): ${what}`;
  });
  return 'Who is speaking, and what you know of each:\n' + rows.join('\n')
    + '\nWhen one of them says who they are, what they work on or answer for, or how they want to be dealt with, set it down with `know`, naming them: it is here the next time they speak.';
}

/** How many members of a place are named when the agent first hears from it; the rest are counted. */
const ROSTER_SHOWN = 12;

/**
 * The agent hears from a place for the first time: everyone the service says is there is
 * recorded, the place is, and what the agent is told with its next wake is returned. Empty for a
 * place it has heard from before, or when the service gave no roster.
 */
export function enter(journal: string, gen: string, events: JournalEvent[], service: string, place: { id: string; name: string }, members: Participant[] | null): string {
  if (places(events).has(`${service}:${place.id}`)) return '';
  appendEvent(journal, gen, { type: 'note', kind: PLACE_KIND, data: { service, id: place.id, name: place.name, members: members?.length ?? null } });
  if (members === null || members.length === 0) return `This is the first you hear from ${place.name}.`;
  meet(journal, gen, events, members.map((m) => ({ ...m, met: place.name })));
  const named = members.slice(0, ROSTER_SHOWN).map((m) => `${m.name} (${keyOf(m)}${m.bot === true ? ', a bot' : ''})`).join(', ');
  return `This is the first you hear from ${place.name}. There with you: ${named}${members.length > ROSTER_SHOWN ? `, and ${members.length - ROSTER_SHOWN} more` : ''}.`;
}
