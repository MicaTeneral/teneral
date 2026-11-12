import { expect, test } from 'bun:test';
import { recallJournal } from '../../body/recall';
import type { EventBody, JournalEvent } from '../../kernel/journal';
const ev = (body: EventBody, id = 'test'): JournalEvent => ({ ...body, id, ts: '2026-01-01T00:00:00Z', gen: 'g', v: 1 });
const owner = ev({ type: 'stimulus', source: 'terminal', text: 'Do you remember?' });
test('recovers old account claims beyond a large recent suffix, with provenance', () => {
  const old = ev({ type: 'assistant', text: 'Joined the chat using test@example.invalid.', toolCalls: [] }, 'old-record');
  const noise = Array.from({length: 1000}, () => ev({ type: 'assistant', text: 'unrelated '.repeat(100), toolCalls: [] }));
  const result = recallJournal([old, ...noise, owner], 'mail chat');
  expect(result).toContain('old-record'); expect(result).toContain('test@example.invalid');
  expect(result).toContain('assistant claim');
});
test('does not search external messages, notes or tool payloads', () => {
  const events = [ev({type:'stimulus',source:'agent:other',text:'needle external'}), ev({type:'note',kind:'test',data:'needle note'}), ev({type:'tool.result',callId:'x',ok:true,output:'needle tool'}), owner];
  expect(recallJournal(events,'needle')).toContain('No matches');
});
test('private recall fails closed on nonterminal wakes including clocks', () => {
  for (const source of ['agent:zulip', 'clock', 'agent:other']) {
    expect(() => recallJournal([owner,ev({type:'stimulus',source,text:'query'})], 'mail')).toThrow('terminal-owner');
  }
  expect(() => recallJournal([], 'mail')).toThrow();
});
test('omits secret-shaped lines and never searches assistant tool arguments', () => {
  const result = recallJournal([ev({type:'assistant',text:'mail password=DO_NOT_PRINT\nmail address test@example.invalid',toolCalls:[{id:'x',name:'bash',args:{command:'mail SECRET_ARGUMENT'}}]}),owner], 'mail');
  expect(result).not.toContain('DO_NOT_PRINT'); expect(result).not.toContain('SECRET_ARGUMENT');
  expect(result).toContain('test@example.invalid');
});
test('bounds output, validates query and identifies newest records first', () => {
  const events = Array.from({length: 100}, (_,i) => ev({type:'assistant',text:`needle ${i} `+'x'.repeat(900),toolCalls:[]}, `record-${i}`));
  const result = recallJournal([...events,owner], 'needle');
  expect(result.length).toBeLessThan(8500); expect(result).toContain('record-99'); expect(result).not.toContain('record-0"');
  expect(() => recallJournal([owner], '')).toThrow();
  expect(() => recallJournal([owner], 'x'.repeat(201))).toThrow();
});
