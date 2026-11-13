import {test,expect} from 'bun:test';
import {bindCards,renderMap} from '../../body/episode-map';
// Exact query-blind worker card, b240ccbb-6f4d-42be-9613-9322cec0eaca.
const card={id:'2',title:'Project deployment schedule correction',summary:'B initially scheduled Cedar for Friday and Birch for Monday. G corrected Cedar to Tuesday, not Friday, and confirmed Birch remained Monday.',sources:['B','G']};
const sources=[{id:'B',text:'Project Cedar deploys on Friday. Project Birch deploys on Monday.'},{id:'G',text:'Correction to B: Cedar now deploys Tuesday, not Friday. Birch remains Monday.'}];
test('map preserves exact card and refuses invented provenance',()=>{
 const bound=bindCards([card],sources);expect(renderMap(bound,sources,1000).cards).toEqual([card]);
 expect(()=>bindCards([{...card,sources:['invented']}],sources)).toThrow();
 expect(()=>bindCards([card,card],sources)).toThrow();
});
test('changed or removed dependency invalidates card; cap reports omission',()=>{
 const bound=bindCards([card],sources);
 expect(renderMap(bound,[sources[0]!,{id:'G',text:'Cedar now Wednesday'}],1000).stale).toEqual(['2']);
 expect(renderMap(bound,[sources[0]!],1000).cards).toEqual([]);
 const capped=renderMap(bound,sources,20);expect(capped.cards).toEqual([]);expect(capped.omitted).toEqual(['2']);expect(capped.cardCoverage).toBe('partial');
});

import {episodeCards,episodeSources} from './episode-map-fixture';
test('full exact worker map covers all six sources; appended correction exposes coverage gap',()=>{
 const bound=bindCards(episodeCards,episodeSources);
 const full=renderMap(bound,episodeSources,10000);
 expect(full.cards).toEqual(episodeCards);expect(full.sourceCoverage).toBe('complete');expect(full.uncoveredSourceIds).toEqual([]);
 const correction={id:'H',text:'Correction to G: Cedar now deploys Wednesday.'};
 const appended=renderMap(bound,[...episodeSources,correction],10000);
 expect(appended.cardCoverage).toBe('complete');expect(appended.sourceCoverage).toBe('partial');expect(appended.uncoveredSourceIds).toEqual(['H']);
 // Caller-supplied eligibility removes superseded G. This is not a tested
 // automatic semantic resolver; original B remains historical evidence.
 const eligible=[...episodeSources.filter(s=>s.id!=='G'),correction];
 const resolved=renderMap(bound,eligible,10000);
 expect(resolved.stale).toEqual(['2']);expect(resolved.uncoveredSourceIds).toEqual(['B','H']);
 const capped=renderMap(bound,episodeSources,2);
 expect(capped.uncoveredSourceIds).toEqual(episodeSources.map(s=>s.id));expect(capped.omitted).toHaveLength(5);
});

import {eligibleSources} from '../../body/episode-map';
test('explicit whole-source replacement invalidates dependencies without dropping unrelated evidence',()=>{
 const bound=bindCards(episodeCards,episodeSources);
 const replacement={id:'H',text:'Replacement for G: Cedar Wednesday; Birch Monday.',supersedes:'G'};
 const eligible=eligibleSources([...episodeSources,replacement]);
 const rendered=renderMap(bound,eligible,10000);
 expect(rendered.stale).toEqual(['2']);expect(rendered.uncoveredSourceIds).toEqual(['B','H']);
 expect(rendered.cards.map(c=>c.id)).toEqual(['1','3','4','5']);
 const chained=eligibleSources([...episodeSources,replacement,{id:'I',text:'Cedar Thursday; Birch Monday.',supersedes:'H'}]);
 expect(chained.map(s=>s.id)).not.toContain('G');expect(chained.map(s=>s.id)).not.toContain('H');expect(chained.at(-1)?.id).toBe('I');
 expect(()=>eligibleSources([{id:'X',text:'x',supersedes:'future'}])).toThrow();
 expect(()=>eligibleSources([...episodeSources,replacement,{id:'I',text:'x',supersedes:'G'}])).toThrow();
 expect(()=>eligibleSources([...episodeSources,episodeSources[0]!])).toThrow();
});

test('partial correction chains dirty dependent cards without retiring original evidence',()=>{
 const old=[{id:'J1',text:'Date May9; bay East; contact Mira.'}];
 const current=[...old,{id:'J2',text:'Date May12; other fields unchanged.'},{id:'J8',text:'Contact Noor; date/bay unchanged.'}];
 const corrections=[{source:'J2',affects:'J1'},{source:'J8',affects:'J2'}];
 const initial={id:'shipment',title:'Shipment',summary:old[0]!.text,sources:['J1']};
 const stale=renderMap(bindCards([initial],old),current,10000,corrections);
 expect(stale.stale).toEqual(['shipment']);expect(stale.uncoveredSourceIds).toEqual(['J1','J2','J8']);
 const rebuilt={...initial,summary:'May12; East; Noor.',sources:['J1','J2','J8']};
 expect(renderMap(bindCards([rebuilt],current,corrections),current,10000,corrections).cards).toEqual([rebuilt]);
 expect(current[0]).toEqual(old[0]!);
 expect(()=>renderMap([],current,1000,[{source:'J1',affects:'J8'}])).toThrow();
 expect(()=>renderMap([],current,1000,[{source:'missing',affects:'J1'}])).toThrow();
 expect(()=>renderMap([],current,1000,[corrections[0]!,corrections[0]!])).toThrow();
});

test('graph snapshot invalidates additions AND withdrawals; order is irrelevant',()=>{
 const current=[{id:'a',text:'original'},{id:'b',text:'correction'},{id:'c',text:'another correction'}];
 const card={id:'x',title:'x',summary:'corrected',sources:['a','b','c']};
 const edges=[{source:'b',affects:'a'},{source:'c',affects:'b'}];
 const bound=bindCards([card],current,edges);
 expect(renderMap(bound,current,1000,edges).cards).toEqual([card]);
 expect(renderMap(bound,current,1000,[...edges].reverse()).cards).toEqual([card]);
 expect(renderMap(bound,current,1000,edges.slice(0,1)).stale).toEqual(['x']);
 expect(renderMap(bound,current,1000,[]).stale).toEqual(['x']);
 expect(renderMap(bindCards([card],current),current,1000,edges).stale).toEqual(['x']);
});
