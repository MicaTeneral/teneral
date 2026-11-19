import { expect, test } from 'bun:test';
import { HALF_LIFE_DAYS, HEARD_KIND, openCommunity, tieOf, tieWord, type Community, type How } from '../../body/community';
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
function both(events: JournalEvent[], clock: () => number = () => T0 + 300 * 60_000): Community[] {
  const rows = openCommunity(null, events, clock);
  expect(rows.by).toBe('rows');
  if (library === null) return [rows];
  const database = openCommunity(ray(), events, clock);
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


test('a tie grows with what someone says to the agent and what it answers, fades without it, and is the same asked of the database or of the rows', () => {
  const day = 24 * 60;
  const events = [
    // Ann writes to the agent alone and is answered, three times.
    ...[0, 10, 20].flatMap((minute) => [heard(minute, '7', 'Ann', 'dm:7', 'dm'), heard(minute + 1, '99', 'Mica', 'dm:7', 'own')]),
    // Bo only talks in a room the agent sits in, many times.
    ...Array.from({ length: 12 }, (_, i) => heard(30 + i, '8', 'Bo', '#eng', 'none')),
    // Cy mentioned it once, long ago.
    heard(-90 * day, '9', 'Cy', '#eng', 'mention'),
  ];
  const at = T0 + 60 * 60_000;
  const [first, ...rest] = both(events, () => at).map((c) => c.people());
  for (const other of rest) expect(other).toEqual(first!);
  const by = new Map(first!.map((p) => [p.name, p]));
  // Three direct messages, each answered: 3 x (3 + 2) of weight, hardly faded.
  expect(by.get('Ann')!.tie).toBe(tieOf(15 * 0.5 ** (1 / (HALF_LIFE_DAYS * 24))));
  expect(tieWord(by.get('Ann')!.tie)).toBe('strong');
  // A dozen messages near the agent are worth less than one conversation with it.
  expect(by.get('Bo')!.tie).toBeLessThan(by.get('Ann')!.tie);
  expect(tieWord(by.get('Bo')!.tie)).toBe('slight');
  // Three months on, a single mention has all but faded.
  expect(by.get('Cy')!.tie).toBeLessThanOrEqual(1);
  // Later still, with nothing new, Ann's tie has faded as well: it is kept up or it goes.
  const later = both(events, () => at + 63 * day * 60_000)[0]!.people().find((p) => p.name === 'Ann')!;
  expect(later.tie).toBeLessThan(by.get('Ann')!.tie / 2);
  expect([tieOf(0), tieWord(0), tieWord(30)]).toEqual([0, 'none', 'steady']);
});

test('importance is someone\'s standing among the others: who is answered by most, heard most and in most places, whatever they are to the agent', () => {
  const events = [
    // Ann speaks in two places and three different people speak after her; she never addresses the agent.
    heard(0, '7', 'Ann', '#eng', 'none'), heard(1, '8', 'Bo', '#eng', 'none'),
    heard(2, '7', 'Ann', '#eng', 'none'), heard(3, '9', 'Cy', '#eng', 'none'),
    heard(4, '7', 'Ann', '#random', 'none'), heard(5, '10', 'Dee', '#random', 'none'),
    // Eli writes to the agent directly and nobody else answers him.
    heard(30, '11', 'Eli', 'dm:11', 'dm'), heard(31, '99', 'Mica', 'dm:11', 'own'),
  ];
  for (const c of both(events)) {
    const by = new Map(c.people().map((p) => [p.name, p]));
    expect(by.get('Ann')).toMatchObject({ reach: 3, heard: 3, places: 2, importance: 100 });
    // Bo is answered by one, heard once, in one place: half of nothing, a third of thirty, half of twenty.
    expect(by.get('Bo')).toMatchObject({ reach: 1, importance: Math.round(100 * (0.5 * 1 / 3 + 0.3 * 1 / 3 + 0.2 * 1 / 2)) });
    // The strongest tie and the highest standing are different people.
    expect(by.get('Eli')!.tie).toBeGreaterThan(by.get('Ann')!.tie);
    expect(by.get('Eli')!.importance).toBeLessThan(by.get('Ann')!.importance);
    expect(c.standing(['zulip:7'])).toEqual({ tie: by.get('Ann')!.tie, importance: 100 });
    // Two accounts of one contact: the ties add, the standing is that of the higher.
    expect(c.standing(['zulip:7', 'zulip:11'])!.tie).toBeGreaterThanOrEqual(by.get('Eli')!.tie);
    expect(c.standing(['zulip:7', 'zulip:11'])!.importance).toBe(100);
    expect(c.standing(['zulip:404'])).toBeNull();
  }
});
