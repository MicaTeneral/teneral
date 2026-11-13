import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendEvent,readEvents} from '../../kernel/journal';
import {retrieveJournalEpisodes} from '../../body/episode-receipts';
async function fixture(fn:(journal:string,id:string)=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'episode-receipt-')),journal=join(dir,'journal');
 const source=appendEvent(journal,'g',{type:'stimulus',source:'terminal',text:'Purchase postponed due to cost.'});
 const note=appendEvent(journal,'g',{type:'note',kind:'memory.v1',data:{text:'Purchase',tags:[],sources:[source.id],episode:{decision:'Postponed',reason:'Cost',openQuestions:[]}}});
 try{await fn(journal,note.id);}finally{rmSync(dir,{recursive:true,force:true});}
}
test('own durable receipts do not invalidate snapshot and retain auxiliary usage',()=>fixture(async(journal,id)=>{
 const result=await retrieveJournalEpisodes('why?',journal,'g',async()=>({text:JSON.stringify([{id,relation:'supports'}]),toolCalls:[],usage:{input:12,output:3}}));
 expect(result).toHaveLength(1);
 const notes=readEvents(journal).filter(e=>e.type==='note'&&e.kind==='episode.receipt.v1');
 expect(notes).toHaveLength(3);
 expect(JSON.stringify(notes)).toContain('auxiliary-excluded-from-kernel-totals');
 expect(JSON.stringify(notes)).toContain('"input":12');
}));
for(const kind of ['correction','audience']) test(`${kind} intervening event still invalidates snapshot`,()=>fixture(async(journal,id)=>{
 await expect(retrieveJournalEpisodes('why?',journal,'g',async()=>{
  if(kind==='audience') appendEvent(journal,'g',{type:'stimulus',source:'clock',text:'tick'});
  else appendEvent(journal,'g',{type:'note',kind:kind==='same-kind'?'episode.receipt.v1':'episode.correction.v1',data:{unrelated:true}});
  return {text:JSON.stringify([{id,relation:'supports'}]),toolCalls:[]};
 })).rejects.toThrow('Stale');
}));
