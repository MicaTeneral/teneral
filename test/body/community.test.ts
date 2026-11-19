import { expect, test } from 'bun:test';
import { HEARD_KIND, openCommunity, type Community, type How } from '../../body/community';
import { CONTACT_KIND } from '../../body/participants';
import type { EventBody, JournalEvent } from '../../brain/journal';
import { library, ray } from '../brain/rayforce';

let n = 0;
const T0 = Date.parse('2026-11-19T10:00:00.000Z');
const ev = (body: EventBody, minute: number): JournalEvent => ({ ...body, v: 1, id: `e${++n}`, ts: new Date(T0 + minute * 60_000).toISOString(), gen: 'g' }) as JournalEvent;
let id = 0;
const heard = (minute: number, sender: string, name: string, where: string, how: How, service = 'zulip'): JournalEvent =>
  ev({ type: 'note', kind: HEARD_KIND, data: { service, id: ++id, place: where, where, sender, name, how } }, minute);

/** A morning in two channels and a direct conversation. The agent is zulip:99. */
const morning = (): JournalEvent[] => [
  heard(0, '7', 'Ann', '#eng', 'none'),
  heard(1, '8', 'Bo', '#eng', 'none'),
  heard(2, '7', 'Ann', '#eng', 'mention'),
  heard(3, '99', 'Mica', '#eng', 'own'),
  heard(4, '8', 'Bo', '#eng', 'follow'),
  heard(60, '8', 'Bo', '#random', 'none'),
  heard(61, 'u_x', 'Cy', 'dm:u_x', 'dm', 'rayboard'),
  heard(62, 'a_me', 'Mica', 'dm:u_x', 'own', 'rayboard'),
  heard(200, '7', 'Ann', '#eng', 'none'),
  ev({ type: 'stimulus', source: 'terminal', text: 'Ann is my colleague' }, 201),
  ev({ type: 'note', kind: CONTACT_KIND, data: { key: 'zulip:7', circle: 'colleague', words: 'Ann is my colleague' } }, 202),
  ev({ type: 'note', kind: CONTACT_KIND, data: { key: 'rayboard:u_x', circle: 'friend', words: 'x' } }, 203),
];

/** The same questions put to both ways of answering, where the database is at hand; to the rows alone otherwise. */
function both(events: JournalEvent[]): Community[] {
  const rows = openCommunity(null, events);
  expect(rows.by).toBe('rows');
  if (library === null) return [rows];
  const database = openCommunity(ray(), events);
  expect(database.by).toBe('database');
  return [rows, database];
}

test('what was heard of someone is counted: how often, since when, and how often the agent answered', () => {
  for (const c of both(morning())) {
    expect(c.messages()).toBe(9);
    // Ann spoke three times; the two before the agent's message in that channel were answered by it, the one hours later was not.
    expect(c.indicators(['zulip:7'])).toEqual({ heard: 3, answered: 2, first: '2026-11-19T10:00:00.000Z', last: '2026-11-19T13:20:00.000Z' });
    // Bo's first was answered too; what he said after the agent spoke, and elsewhere, was not.
    expect(c.indicators(['zulip:8'])).toMatchObject({ heard: 3, answered: 1 });
    // One contact with accounts on two services.
    expect(c.indicators(['zulip:7', 'rayboard:u_x'])).toMatchObject({ heard: 4, answered: 3 });
    expect(c.indicators(['zulip:404'])).toEqual({ heard: 0, first: null, last: null, answered: 0 });
    // The agent's own messages are no one heard.
    expect(c.indicators(['zulip:99'])).toMatchObject({ heard: 0 });
  }
});

test('the people, the places, who speaks after whom, who has gone quiet, and the owner\'s circles', () => {
  for (const c of both(morning())) {
    expect(c.people().map((p) => [p.name, p.heard, p.addressed, p.answered, p.places])).toEqual([['Ann', 3, 1, 2, 1], ['Bo', 3, 1, 1, 2], ['Cy', 1, 1, 1, 1]]);
    expect(c.people(1)).toHaveLength(1);
    expect(c.places().map((p) => [p.where, p.messages, p.speakers, p.mine])).toEqual([['#eng', 6, 2, 1], ['dm:u_x', 2, 1, 1], ['#random', 1, 1, 0]]);
    // Bo after Ann, Ann after Bo, the agent after Ann, Bo after the agent, the agent after Cy: each once, within ten minutes of the other.
    expect(c.pairs().map((p) => `${p.who} after ${p.after}: ${p.times}`).sort()).toEqual(['Ann after Bo: 1', 'Bo after Ann: 1', 'Bo after Mica: 1', 'Mica after Ann: 1', 'Mica after Cy: 1']);
    // Not heard since noon: Bo and Cy; Ann spoke after.
    expect(c.quiet(T0 + 120 * 60_000).map((p) => p.name)).toEqual(['Bo', 'Cy']);
    expect(c.circles()).toEqual([{ circle: 'colleague', people: 1, heard: 3, answered: 2 }, { circle: 'friend', people: 1, heard: 1, answered: 1 }, { circle: '', people: 1, heard: 3, answered: 1 }]);
  }
});

test('what the journal gains is taken in, a message noted twice is one message, and a new circle is seen at once', () => {
  const events = morning();
  for (const c of both(events)) {
    const more = [...events, heard(210, '9', 'Dee', '#eng', 'name'), { ...events[0]!, id: 'again' } as JournalEvent, ev({ type: 'note', kind: CONTACT_KIND, data: { key: 'zulip:9', circle: 'family', words: 'x' } }, 211)];
    c.refresh(more);
    expect(c.messages()).toBe(10);
    expect(c.indicators(['zulip:9'])).toMatchObject({ heard: 1, answered: 0 });
    expect(c.circles().map((x) => x.circle)).toEqual(['colleague', 'family', 'friend', '']);
    // Nothing heard: every question has an empty answer, and none fails.
    const empty = openCommunity(c.by === 'database' ? ray() : null, []);
    expect([empty.people(), empty.places(), empty.pairs(), empty.circles(), empty.quiet(0)]).toEqual([[], [], [], [], []]);
  }
});
