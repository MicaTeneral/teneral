import {test,expect} from 'bun:test';
import type {JournalEvent} from '../../kernel/journal';
import {memoryContext} from '../../body/memory';
import {validateSelection,answerEvidence} from '../../body/memory-selection';
import {episodeCards,episodeSources} from './episode-map-fixture';
import {bindCards,renderMap} from '../../body/episode-map';
const base={v:1 as const,gen:'g',ts:''};
const history:JournalEvent[]=[
 ...episodeSources.map(s=>({...base,type:'stimulus' as const,source:'terminal',id:s.id,text:s.text})),
 ...episodeCards.map(c=>({...base,type:'note' as const,kind:'memory.v1',id:c.id,data:{text:c.title,tags:[],sources:c.sources,episode:{decision:c.summary,reason:'',openQuestions:[]}}})),
];
// Recorded routing dddc0f79-8ddc-4a81-a7bc-d925df0e30c6, support labels
// assigned from original evidence. F is related, NOT a causal answer.
const probes=[
 ['Why keep customer archives disconnected?','1','supports'],
 ['Почему пока не покупаем видеокарту?','4','supports'],
 ['Current support email?','3','supports'],
 ['When does Project Maple deploy?',null,null],
 ['What encryption algorithm protects offline copies?','1','related'],
 ['Why did we abandon the migration?','5','related'],
 ['Когда запускаем Cedar?','2','supports'],
 ['What are cloud formations?',null,null],
] as const;
test('same recorded selector isolates candidate exposure benefit, not live model accuracy',()=>{
 const all=renderMap(bindCards(episodeCards,episodeSources),episodeSources,10000).cards.map(c=>c.id);
 const rows=probes.map(([query,target,relation])=>{
  const context=memoryContext([...history,{...base,id:'q',type:'stimulus',source:'terminal',text:query}],10000);
  const lexical=context.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s).id as string);
  const select=(ids:string[])=>validateSelection(target&&ids.includes(target)?[{id:target,relation}]:[],ids)!;
  return {query,target,lexical,lexicalHit:!!target&&lexical.includes(target),mapHit:!!target&&all.includes(target),lexicalEvidence:answerEvidence(select(lexical)).length,mapEvidence:answerEvidence(select(all)).length};
 });
 const result={lexicalCandidateHits:rows.filter(r=>r.lexicalHit).length,mapCandidateHits:rows.filter(r=>r.mapHit).length,relevantQueries:6,lexicalSupported:rows.reduce((n,r)=>n+r.lexicalEvidence,0),mapSupported:rows.reduce((n,r)=>n+r.mapEvidence,0),lexicalWrongTopicCandidates:rows.filter(r=>!r.target&&r.lexical.length).length};
 console.log(JSON.stringify({result,rows}));
 expect(result.mapCandidateHits).toBe(6);
 expect(result.mapSupported).toBe(4);
 expect(result.mapCandidateHits).toBeGreaterThan(result.lexicalCandidateHits);
 // Both arms reject wrong topics using the SAME recorded selection. This is
 // a controlled assumption, not evidence about fresh model false positives.
 expect(rows.filter(r=>!r.target).every(r=>r.lexicalEvidence===0&&r.mapEvidence===0)).toBe(true);
});
