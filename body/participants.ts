import { appendEvent, type JournalEvent } from '../brain/journal';
import { known, type Fact } from '../brain/known';
import { fromOwner, standing } from '../brain/owned';
import type { Community } from './community';

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

// Contacts. A participant is an account; a contact is whoever is behind it, with what places them
// in the agent's world. Three things are kept of a contact, each of a different standing.
//
// A circle: how they stand to the owner and so to the agent. Family, friends, colleagues, people
// only met in passing, other agents, services. The names are the owner's to choose; nothing here
// knows what a circle is called. A circle changes how far the agent goes with someone, so it is
// the owner's to give: it is recorded with the owner's own words, which must stand in a message
// of theirs. What the agent only supposes is kept apart, and shown as supposed.
//
// Characteristics: a few named things about them, a role, a language, how they like to be
// answered. These the agent sets down itself as it learns them, like any fact, and may be wrong.
//
// Indicators: what the journal itself shows of them, counted with no model asked: how often they
// were heard, when first and last, how often the agent answered them. They cannot be flattered.
// They are asked of the table every heard message is laid out in (body/community.ts).
//
// Several accounts can be one contact, on different services or the same: only on the owner's word.

export const CONTACT_KIND = 'chat.contact.v1';

export interface Contact {
  /** The account this record is kept under: `zulip:7`. */
  key: string;
  /** Other accounts the owner said are the same one. */
  same: string[];
  /** The circle the owner placed them in, with the words it was said in. */
  circle?: string;
  words?: string;
  /** A circle the agent supposes, until the owner says. */
  supposed?: string;
  /** Named characteristics, in the agent's own words. */
  traits: Record<string, string>;
}

/** The most characteristics kept of one contact, and the most characters of a name and of a value. */
const TRAITS_MAX = 12;
const TRAIT_NAME = /^[a-z][a-z0-9 _-]{0,30}$/;
const TRAIT_CHARS = 160;

/** The contacts the journal holds, each under the account it was first kept under; an account the owner joined to another answers as that one. */
export function contacts(events: JournalEvent[]): Map<string, Contact> {
  const all = new Map<string, Contact>();
  const alias = new Map<string, string>();
  const at = (key: string): Contact => {
    const root = alias.get(key) ?? key;
    let c = all.get(root);
    if (c === undefined) all.set(root, c = { key: root, same: [], traits: {} });
    return c;
  };
  for (const e of events) {
    if (e.type !== 'note' || e.kind !== CONTACT_KIND || typeof e.data !== 'object' || e.data === null) continue;
    const d = e.data as Record<string, unknown>;
    if (typeof d.key !== 'string') continue;
    const c = at(d.key);
    if (typeof d.circle === 'string' && typeof d.words === 'string') { c.circle = d.circle.slice(0, 40); c.words = d.words.slice(0, 300); delete c.supposed; }
    if (typeof d.supposed === 'string' && c.circle === undefined) c.supposed = d.supposed.slice(0, 40);
    if (typeof d.traits === 'object' && d.traits !== null) {
      for (const [name, value] of Object.entries(d.traits as Record<string, unknown>)) {
        if (value === null || value === '') delete c.traits[name];
        else if (typeof value === 'string' && TRAIT_NAME.test(name) && (name in c.traits || Object.keys(c.traits).length < TRAITS_MAX)) c.traits[name] = value.slice(0, TRAIT_CHARS);
      }
    }
    if (typeof d.same === 'string' && d.same !== c.key && !c.same.includes(d.same)) {
      // The other account's own record, if it had one, is folded into this one.
      const other = all.get(d.same);
      if (other !== undefined) {
        c.traits = { ...other.traits, ...c.traits };
        c.circle ??= other.circle; c.words ??= other.words;
        if (c.circle === undefined) c.supposed ??= other.supposed;
        for (const key of other.same) { alias.set(key, c.key); c.same.push(key); }
        all.delete(d.same);
      }
      alias.set(d.same, c.key);
      c.same.push(d.same);
    }
  }
  // By every account that answers as it.
  for (const [key, root] of alias) { const c = all.get(root); if (c !== undefined) all.set(key, c); }
  return all;
}

/** The owner's message that holds `words`, spaces and case aside; null when none does. A circle is the owner's to give, and is recorded only in the words it was given with. */
export function ownerSays(events: JournalEvent[], words: string): JournalEvent | null {
  const flat = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const wanted = flat(words);
  if (wanted.length < 2) return null;
  return events.findLast((e) => e.type === 'stimulus' && fromOwner(e.source) && flat(e.text).includes(wanted)) ?? null;
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
export function whoLines(events: JournalEvent[], speakers: Participant[], fresh: Participant[] = [], community?: Pick<Community, 'indicators'>): string {
  if (speakers.length === 0) return '';
  const facts = known(standing(events)).facts;
  const held = contacts(events);
  const rows = speakers.map((p) => {
    const kind = p.bot === true ? 'a bot' : p.bot === false ? 'not a bot, by the service' : 'kind not known';
    const of = knownOf(facts, p.name).slice(-FACTS_EACH);
    const first = fresh.some((f) => keyOf(f) === keyOf(p));
    const c = held.get(keyOf(p));
    const circle = c?.circle !== undefined ? `, ${c.circle}, by your owner's word` : c?.supposed !== undefined ? `, ${c.supposed}, as you suppose` : ', in no circle yet';
    const seen = community?.indicators([keyOf(p), ...(c?.same ?? [])]) ?? { heard: 0, first: null, last: null, answered: 0 };
    const count = seen.heard === 0 ? '' : `; heard ${seen.heard} ${seen.heard === 1 ? 'time' : 'times'} since ${seen.first!.slice(0, 10)}, answered ${seen.answered}`;
    const traits = Object.entries(c?.traits ?? {}).map(([name, value]) => `${name}: ${value}`).join('; ');
    const what = [traits, ...of.map((f) => `${f.mark} [${f.source}] ${f.text.replace(/\s+/g, ' ').slice(0, FACT_CHARS)}`)].filter((part) => part !== '').join(' · ');
    return `- ${p.name} (${keyOf(p)}, ${kind}${circle}${count}): ${what !== '' ? what : first ? 'you have not met them before' : 'you have set nothing down about them yet'}`;
  });
  return 'Who is speaking, and what you know of each:\n' + rows.join('\n')
    + '\nWhen one of them says who they are, what they work on or answer for, or how they want to be dealt with, set it down: a lasting characteristic with `contact`, anything else with `know`, naming them. It is here the next time they speak. '
    + 'A circle is your owner\'s to give; how far you go with someone follows the circle they are in, and with someone in none you are helpful and say nothing of your owner\'s affairs.';
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
