import { expect, test } from 'bun:test';
import { memoryContext } from '../../body/memory';
import type { JournalEvent } from '../../brain/journal';

// Synthetic diagnostic selected by the same agent after initial exploration.
// Not independent/blind evaluation; do not tune a synonym dictionary to it.
const documents = [
  ['backup', 'Retain encrypted backups on a separate machine. Restore drills detect damaged archives.'],
  ['meeting', 'Schedule weekly planning meetings on Tuesday. Reserve afternoons for focused work.'],
  ['release', 'Pin dependency versions and verify archive hashes before installation.'],
  ['account', 'Service mailbox: helper@example.invalid.'],
  ['travel', 'Travel by train rather than airplane to reduce emissions.'],
] as const;
const queries: [string | null, string][] = [
  ['backup', 'encrypted backups'], ['backup', 'How do we recover lost files?'],
  ['meeting', 'weekly planning meetings'], ['meeting', 'Когда обсуждаем планы команды?'],
  ['release', 'dependency versions archive hashes'], ['release', 'Как проверяем целостность скачанного пакета?'],
  ['account', 'helper@example.invalid'], ['account', 'почта'],
  ['travel', 'train emissions'], ['travel', 'Почему не летим?'],
  [null, 'weekly exercise planning'], [null, 'train a language model'],
  [null, 'решение о ремонте кухни'], [null, 'verify meeting attendance'],
];
function fixture(genericTags: boolean): JournalEvent[] {
  return documents.flatMap(([id, text]): JournalEvent[] => [
    {type:'stimulus', source:'terminal', text:'Synthetic discussion', id:`source-${id}`, ts:'', gen:'g', v:1},
    {type:'note', kind:'memory.v1', data:{text,tags:id==='account'?['email']:genericTags?['decision']:[],sources:[`source-${id}`]}, id, ts:'', gen:'g', v:1},
  ]);
}
function evaluate(genericTags: boolean) {
  let hits=0, falsePositiveQueries=0;
  const results = queries.map(([expected, text]) => {
    const events: JournalEvent[] = [...fixture(genericTags), {type:'stimulus',source:'terminal',text,id:'query',ts:'',gen:'g',v:1}];
    const output=memoryContext(events,6000);
    const records=output ? output.trimEnd().split('\n').slice(1).map(row=>JSON.parse(row)) : [];
    const selected=records.map(r=>r.id);
    for(const r of records) expect(r.sources).toEqual([`source-${r.id}`]);
    expect(output.length).toBeLessThanOrEqual(6000);
    expect(memoryContext([...events.slice(0,-1),{type:'stimulus',source:'agent:other',text,id:'external',ts:'',gen:'g',v:1}],6000)).toBe(output);
    if(expected && selected.includes(expected)) hits++;
    if(!expected && selected.length) falsePositiveQueries++;
    return {text,expected,selected};
  });
  return {hits,falsePositiveQueries,results};
}
test('diagnostic baseline: paraphrase misses and off-topic retrieval remain visible',()=>{
  const baseline=evaluate(true);
  expect(baseline.hits).toBe(6);
  expect(baseline.falsePositiveQueries).toBe(4);
});
test('counterfactual generic-tag removal isolates only one noise source, preserving email',()=>{
  const candidate=evaluate(false);
  expect(candidate.hits).toBe(6);
  expect(candidate.falsePositiveQueries).toBe(3);
  expect(candidate.results.find(r=>r.text==='почта')!.selected).toEqual(['account']);
  expect(candidate.results.find(r=>r.text==='helper@example.invalid')!.selected).toEqual(['account']);
  expect(candidate.results.find(r=>r.text==='решение о ремонте кухни')!.selected).toEqual([]);
});
