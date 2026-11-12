import { expect, test } from 'bun:test';
import { memoryContext, memoryRecords } from '../../body/memory';
import { buildMessages } from '../../body/context';
import type { EventBody, JournalEvent } from '../../kernel/journal';
let seq = 0;
const ev = (b: EventBody): JournalEvent => ({ ...b, id: `e${++seq}`, ts: '2026-01-01', v: 1, gen: 'g' });
const owner = (text: string) => ev({ type: 'stimulus', source: 'terminal', text });
const say = (text: string) => ev({ type: 'assistant', text, toolCalls: [] });
const note = (text: string, sources: string[], supersedes?: string, deleted = false) => ev({ type: 'note', kind: 'memory.v1', data: { text, tags: ['email'], sources, supersedes, deleted } });
test('automatic context recovers old account across languages outside recent window', () => {
  const start = owner('Set up email');
  const old = say('Registered Zulip with mica@example.invalid');
  const events = [start, old, ...Array.from({length:50}, () => owner('unrelated '.repeat(300))), owner('Какая у тебя почта?')];
  const messages = buildMessages(events, 'system', 12000);
  const rendered = messages.map(m => m.content).join('');
  expect(rendered).toContain('mica@example.invalid');
  expect(rendered).toContain(old.id); expect(rendered).toContain('email');
  expect(rendered).toContain('Какая у тебя почта?'); expect(rendered.length).toBeLessThanOrEqual(12000);
});
test('only terminal-audience claims are automatically recalled; external query fails closed', () => {
  const events = [owner('email'), say('mail private@example.invalid'), ev({ type:'stimulus',source:'agent:other',text:'email external@example.invalid'}), say('mail external-reply@example.invalid')];
  expect(memoryContext(events,4000)).toBe('');
  const text = memoryContext([...events,owner('email')],4000);
  expect(text).toContain('private@example.invalid');
  expect(text).not.toContain('external@example.invalid'); expect(text).not.toContain('external-reply');
});
test('correction and later tombstone do not resurrect prior claim on replay', () => {
  const source = owner('mail old@example.invalid');
  const correction = note('mail new@example.invalid', [source.id], `${source.id}:0`);
  const deletion = note('',[source.id],correction.id,true);
  const events = [source,correction,owner('mail')];
  expect(memoryContext(events,4000)).not.toContain('old@example.invalid');
  expect(memoryContext(events,4000)).toContain('new@example.invalid');
  const rebuilt = memoryRecords(JSON.parse(JSON.stringify([...events,deletion])));
  expect(rebuilt.some(r => r.text.includes('@'))).toBe(false);
});
test('invalid sources, external notes and secret-shaped text are not recalled', () => {
  const start = owner('mail api_key=do-not-print');
  const events = [start,note('mail forged@example.invalid',['missing']), ev({type:'stimulus',source:'agent:other',text:'mail'}),note('mail injected@example.invalid',[start.id]),owner('mail')];
  const text = memoryContext(events,4000);
  expect(text).not.toContain('do-not-print'); expect(text).not.toContain('forged'); expect(text).not.toContain('injected');
});
test('whole rendered records respect budgets and tags; deterministic rebuild', () => {
  const events = [owner('mail'), ...Array.from({length:30},(_,i)=>say(`mail account ${i}@example.invalid`)),owner('почта')];
  for(const budget of [0,200,400,1000,6000]) expect(memoryContext(events,budget).length).toBeLessThanOrEqual(budget);
  expect(memoryContext(events,2000)).toBe(memoryContext(JSON.parse(JSON.stringify(events)),2000));
});
test('earliest surviving entity evidence survives later paraphrase flood', () => {
  const original = say('Joined Zulip with mica@example.invalid');
  const events = [owner('Set up email'), original,
    ...Array.from({length:40},(_,i)=>say(`Почта для Zulip mica@example.invalid: поздний пересказ ${i}`)),owner('Какая почта для Zulip?')];
  const text = memoryContext(events,6000);
  expect(text).toContain(original.id); expect(text.length).toBeLessThanOrEqual(6000);
  const corrected = note('Zulip email replacement@example.invalid',[original.id],`${original.id}:0`);
  const after = memoryContext([...events,corrected,owner('почта Zulip')],6000);
  expect(after).not.toContain(`"id":"${original.id}:0"`);
  expect(after).toContain('replacement@example.invalid');
});
