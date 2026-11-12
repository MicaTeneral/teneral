import { expect, test } from 'bun:test';
import type { EventBody, JournalEvent } from '../../kernel/journal';
import { episodeCandidates, episodeCandidateContext } from '../../body/episode-candidates';
import { buildMessages } from '../../body/context';
let n = 0;
const ev = (b: EventBody): JournalEvent => ({...b,id:`c${++n}`,ts:'',gen:'g',v:1});
const owner = () => ev({type:'stimulus',source:'terminal',text:'Discuss how we should preserve our conversation.'});
const reply = () => ev({type:'assistant',text:'Keep source-linked episodes instead of isolated fragments.',toolCalls:[]});
test('completed adjacent exchange is deterministic and bounded, terminal only',()=>{
 const events=[owner(),reply(),owner()];
 expect(episodeCandidates(events)).toHaveLength(1);
 expect(episodeCandidates(JSON.parse(JSON.stringify(events)))).toEqual(episodeCandidates(events));
 expect(episodeCandidateContext(events,2400)).toContain(events[0]!.id);
 expect(episodeCandidateContext(events,400)).toBe('');
 for(const source of ['clock','agent:mail','zulip']) expect(episodeCandidateContext([...events,ev({type:'stimulus',source,text:'hello'})],2400)).toBe('');
 expect(buildMessages(events,'system',12000).map(m=>m.content).join('')).toContain('[episode candidate]');
});
test('arrivals, tools, interruptions and lifecycle boundaries reject uncertain spans',()=>{
 const external=ev({type:'stimulus',source:'agent:other',text:'external'});
 for(const boundary of [external,owner(),ev({type:'turn.interrupted'}),ev({type:'mutation.requested',commit:'x',motive:'x'}),ev({type:'generation.ready',commit:'x'}),ev({type:'tool.result',callId:'x',ok:true,output:'x'})]) {
   expect(episodeCandidates([owner(),boundary,reply()])).toHaveLength(0);
 }
 expect(episodeCandidates([external,owner(),reply()])).toHaveLength(0);
 expect(episodeCandidates([owner(),ev({type:'assistant',text:'checking',toolCalls:[{id:'a',name:'read',args:{}}]}),reply()])).toHaveLength(0);
});
test('curation coverage survives deletion, invalid notes cannot suppress',()=>{
 const a=owner(), b=reply();
 const data={text:'discussion',tags:['decision'],sources:[a.id,b.id],episode:{decision:'Keep sources',reason:'Traceability',openQuestions:[]}};
 const note=ev({type:'note',kind:'memory.v1',data});
 const deletion=ev({type:'note',kind:'memory.v1',data:{text:'',tags:[],sources:[a.id],supersedes:note.id,deleted:true}});
 expect(episodeCandidates([a,b,note,deletion,owner()])).toHaveLength(0);
 expect(episodeCandidates([a,b,ev({type:'note',kind:'memory.v1',data:{...data,sources:['missing']}}),owner()])).toHaveLength(1);
});
test('malformed legacy replies and nonlinguistic filler are not episode evidence',()=>{
 const malformed = {...reply(),text:undefined,toolCalls:undefined} as unknown as JournalEvent;
 expect(episodeCandidates([owner(),malformed])).toHaveLength(0);
 expect(episodeCandidates([owner(),ev({type:'assistant',text:'😀'.repeat(40),toolCalls:[]})])).toHaveLength(0);
});
