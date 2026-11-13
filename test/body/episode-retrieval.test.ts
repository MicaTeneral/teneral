import {test,expect} from 'bun:test';
import type {JournalEvent} from '../../kernel/journal';
import {retrieveEpisodes} from '../../body/episode-retrieval';
const base={v:1 as const,gen:'g',ts:''};
const history:JournalEvent[]=[{...base,id:'s',type:'stimulus',source:'terminal',text:'GPU purchase postponed because of cost, not power.'},{...base,id:'m',type:'note',kind:'memory.v1',data:{text:'Purchase decision',tags:[],sources:['s'],episode:{decision:'GPU postponed due cost.',reason:'Cost',openQuestions:[]}}}];
test('strict selection returns original evidence and discards related-only matches',async()=>{
 const result=await retrieveEpisodes('Почему не покупаем видеокарту?',()=>history,async()=>({text:'[{"id":"m","relation":"supports"}]',toolCalls:[]}));
 expect(result[0]?.sources).toEqual([{id:'s',text:'GPU purchase postponed because of cost, not power.'}]);
 expect(await retrieveEpisodes('query',()=>history,async()=>({text:'[{"id":"m","relation":"related"}]',toolCalls:[]}))).toEqual([]);
});
test('malformed/invented selections and audience races fail closed',async()=>{
 for(const text of ['[{"id":"invented","relation":"supports"}]','[{"id":"m","relation":"supports","answer":"invented"}]','not json']) {
  await expect(retrieveEpisodes('query',()=>history,async()=>({text,toolCalls:[]}))).rejects.toThrow();
 }
 let current=history;
 await expect(retrieveEpisodes('query',()=>current,async()=>{
  current=[...history,{...base,id:'clock',type:'stimulus',source:'clock',text:'tick'}];
  return {text:'[{"id":"m","relation":"supports"}]',toolCalls:[]};
 })).rejects.toThrow('Stale');
 let called=false;
 expect(await retrieveEpisodes('query',()=>current,async()=>{called=true;return {text:'[]',toolCalls:[]};})).toEqual([]);
 expect(called).toBe(true);
});

test('deadline and cancellation bound uncooperative providers',async()=>{
 const receipts:string[]=[];
 await expect(retrieveEpisodes('query',()=>history,()=>new Promise(()=>{}),undefined,{timeoutMs:5,receipt:e=>receipts.push(e.status)})).rejects.toThrow('deadline');
 expect(receipts).toEqual(['started','timed_out']);
 const controller=new AbortController();
 await expect(retrieveEpisodes('query',()=>history,async()=>{controller.abort();return new Promise(()=>{});},controller.signal)).rejects.toThrow('cancelled');
});
test('usage receipt survives invalid output; sensitive originals and oversized query never call provider',async()=>{
 const receipts:{status:string;usage?:unknown}[]=[];
 await expect(retrieveEpisodes('query',()=>history,async()=>({text:'invalid',toolCalls:[],usage:{input:10,output:2}}),undefined,{receipt:e=>receipts.push(e)})).rejects.toThrow();
 expect(receipts.map(r=>r.status)).toEqual(['started','provider_completed','failed']);
 expect(receipts[1]?.usage).toEqual({input:10,output:2});
 let calls=0;
 const provider=async()=>{calls++;return {text:'[]',toolCalls:[]};};
 const sensitive=structuredClone(history);
 if(sensitive[0]?.type==='stimulus') sensitive[0].text='password: synthetic';
 await expect(retrieveEpisodes('query',()=>sensitive,provider)).rejects.toThrow('Sensitive');
 await expect(retrieveEpisodes('x'.repeat(1001),()=>history,provider)).rejects.toThrow('query');
 expect(calls).toBe(0);
});
