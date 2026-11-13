import {test,expect} from 'bun:test';
import type {JournalEvent} from '../../kernel/journal';
import {journalEpisodeCards} from '../../body/episode-adapter';
const base={v:1 as const,gen:'test',ts:'2026-01-01'};
const original:JournalEvent={...base,id:'s1',type:'stimulus',source:'terminal',text:'Shipment Tuesday, bay East.'};
const correction:JournalEvent={...base,id:'s2',type:'stimulus',source:'terminal',text:'Date now Wednesday; bay unchanged.'};
function note(id:string,sources:string[],decision:string,supersedes?:string):JournalEvent {
 return {...base,id,type:'note',kind:'memory.v1',data:{text:'Shipment episode',tags:['decision'],sources,episode:{decision,reason:'',openQuestions:[]},...(supersedes?{supersedes}:{})}};
}
test('episode view replays curated replacement while retaining original provenance',()=>{
 const old=note('m1',['s1'],'Tuesday; East');
 const fresh=note('m2',['s1','s2'],'Wednesday; East','m1');
 const history=[original,old,correction,fresh];
 expect(journalEpisodeCards(history).map(c=>c.id)).toEqual(['m2']);
 expect(journalEpisodeCards(history)[0]?.sources).toEqual(['s1','s2']);
 expect(journalEpisodeCards(history)[0]?.summary).toContain('Wednesday; East');
 expect(journalEpisodeCards(history.slice(0,2))[0]?.id).toBe('m1');
 expect(journalEpisodeCards([...history,{...base,id:'clock',type:'stimulus',source:'clock',text:'tick'}])).toEqual([]);
});
test('invalid provenance cannot create adapter cards',()=>{
 expect(journalEpisodeCards([original,note('m1',['unknown'],'invented')])).toEqual([]);
});

import {bindCards,renderMap} from '../../body/episode-map';
import {validateSelection,answerEvidence} from '../../body/memory-selection';
test('journal replay to exact bounded map to evidence rejects stale or invented IDs',()=>{
 const history=[original,note('m1',['s1'],'Tuesday; East'),correction,note('m2',['s1','s2'],'Wednesday; East','m1')];
 const cards=journalEpisodeCards(history);
 const sources=[{id:original.id,text:original.text},{id:correction.id,text:correction.text}];
 const map=renderMap(bindCards(cards,sources),sources,4000);
 expect(map.cards).toEqual(cards);
 expect(map.sourceCoverage).toBe('complete');
 const ids=map.cards.map(c=>c.id);
 expect(validateSelection([{id:'m1',relation:'supports'}],ids)).toBeNull();
 expect(validateSelection([{id:'invented',relation:'supports'}],ids)).toBeNull();
 const selected=validateSelection([{id:'m2',relation:'supports'}],ids)!;
 const evidence=answerEvidence(selected).map(s=>map.cards.find(c=>c.id===s.id)!);
 expect(evidence[0]?.sources).toEqual(['s1','s2']);
 expect(evidence[0]?.summary).toContain('Wednesday; East');
 expect(answerEvidence(validateSelection([{id:'m2',relation:'related'}],ids)!)).toEqual([]);
 const omitted=renderMap(bindCards(cards,sources),sources,2);
 expect(validateSelection([{id:'m2',relation:'supports'}],omitted.cards.map(c=>c.id))).toBeNull();
});

import {journalBoundEpisodes} from '../../body/episode-adapter';
import {correctionEdges} from '../../body/episode-corrections';
test('creation-prefix graph survives replay and withdrawal makes stored summary stale',()=>{
 const edge:JournalEvent={...base,id:'edge',type:'note',kind:'episode.correction.v1',data:{op:'add',source:'s2',affects:'s1'}};
 const built=[original,correction,edge,note('m2',['s1','s2'],'Wednesday; East')];
 const sources=[{id:original.id,text:original.text},{id:correction.id,text:correction.text}];
 const bound=journalBoundEpisodes(built);
 expect(renderMap(bound,sources,4000,correctionEdges(built)).cards).toHaveLength(1);
 const withdrawn:JournalEvent={...base,id:'withdraw',type:'note',kind:'episode.correction.v1',data:{op:'withdraw',target:'edge'}};
 const later=[...built,withdrawn];
 expect(journalBoundEpisodes(later)).toEqual(bound);
 expect(renderMap(journalBoundEpisodes(later),sources,4000,correctionEdges(later)).stale).toEqual(['m2']);
 const rebuilt=[...later,note('m3',['s1','s2'],'Correction withdrawn; date unresolved; East','m2')];
 expect(renderMap(journalBoundEpisodes(rebuilt),sources,4000,correctionEdges(rebuilt)).cards.map(c=>c.id)).toEqual(['m3']);
 expect(journalBoundEpisodes([...later,{...base,id:'external',type:'stimulus',source:'clock',text:'tick'}])).toEqual([]);
});

import {episodeRetrievalBoundary,episodeRetrievalUnchanged} from '../../body/episode-adapter';
test('async input boundary rejects correction or audience change before proposal acceptance',()=>{
 const before=[original,note('m1',['s1'],'Tuesday; East')];
 const boundary=episodeRetrievalBoundary(before);
 expect(episodeRetrievalUnchanged(boundary,structuredClone(before))).toBe(true);
 expect(episodeRetrievalUnchanged(boundary,[...before,correction])).toBe(false);
 const edge:JournalEvent={...base,id:'edge',type:'note',kind:'episode.correction.v1',data:{op:'add',source:'s2',affects:'s1'}};
 expect(episodeRetrievalUnchanged(boundary,[...before,correction,edge])).toBe(false);
 expect(episodeRetrievalUnchanged(boundary,[...before,{...base,id:'clock',type:'stimulus',source:'clock',text:'tick'}])).toBe(false);
 expect(()=>episodeRetrievalBoundary([])).toThrow();
});
test('adapter rejects excessive replay work rather than silently truncating',()=>{
 expect(journalBoundEpisodes(Array.from({length:2001},()=>original))).toEqual([]);
 expect(()=>episodeRetrievalBoundary([{...original,text:'x'.repeat(200001)}])).toThrow();
 expect(()=>journalBoundEpisodes([original,...Array.from({length:65},(_,i)=>note(`m${i}`,['s1'],'Tuesday'))])).toThrow();
});

test('projection ignores irrelevant growth but retains source, correction and audience dependencies',()=>{
 const history=[original,note('m1',['s1'],'Tuesday; East')];
 const boundary=episodeRetrievalBoundary(history);
 const noise:JournalEvent[]=Array.from({length:3000},(_,i)=>({...base,id:`noise${i}`,type:'note',kind:'diagnostic',data:{text:'x'.repeat(100)}}));
 expect(episodeRetrievalUnchanged(boundary,[...history,...noise])).toBe(true);
 const changed=structuredClone(history);
 if(changed[0]?.type==='stimulus') changed[0].text='Changed source';
 expect(episodeRetrievalUnchanged(boundary,changed)).toBe(false);
 const correctionNote:JournalEvent={...base,id:'correction',type:'note',kind:'episode.correction.v1',data:{op:'withdraw',target:'unknown'}};
 expect(episodeRetrievalUnchanged(boundary,[...history,correctionNote])).toBe(false);
 expect(episodeRetrievalUnchanged(boundary,[...history,{...original,id:'new-turn'}])).toBe(false);
});

test('retrieval projection detects replacement and tombstone without reviving old cards',()=>{
 const before=[original,note('m1',['s1'],'Tuesday')];
 const boundary=episodeRetrievalBoundary(before);
 const replaced=[...before,note('m2',['s1'],'Updated','m1')];
 expect(episodeRetrievalUnchanged(boundary,replaced)).toBe(false);
 expect(journalBoundEpisodes(replaced).map(b=>b.card.id)).toEqual(['m2']);
 const tombstone:JournalEvent={...base,id:'deleted',type:'note',kind:'memory.v1',data:{text:'Removed',tags:[],sources:['s1'],supersedes:'m2',deleted:true}};
 const after=[...replaced,tombstone];
 expect(episodeRetrievalUnchanged(episodeRetrievalBoundary(replaced),after)).toBe(false);
 expect(journalBoundEpisodes(after)).toEqual([]);
});
test('correction projection budget rejects oversized notes even if graph ignores malformed data',()=>{
 const history=[original,note('m1',['s1'],'Tuesday')];
 const large:JournalEvent={...base,id:'large',type:'note',kind:'episode.correction.v1',data:{unknown:'x'.repeat(200001)}};
 expect(()=>episodeRetrievalBoundary([...history,large])).toThrow('budget');
});
