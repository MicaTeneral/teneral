import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendEvent,readEvents} from '../../kernel/journal';
import {episodeRecall} from '../../body/episode-tool';
import type {ToolContext} from '../../body/tools';
test('explicit wrapper reports limited coverage, evidence and only own receipts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ep-tool-'));const ctx={journal:join(dir,'journal'),gen:'g'} as ToolContext;
 try{
 const source=appendEvent(ctx.journal,'g',{type:'stimulus',source:'terminal',text:'Shipment arrives Tuesday.'});
 let calls=0;
 const empty=episodeRecall(async()=>{calls++;return {text:'[]',toolCalls:[]};});
 const out=JSON.parse(await empty.run({query:'shipment'},ctx));
 expect(out.episodeCount).toBe(0);expect(out.absenceEvidence).toBe(false);expect(out.coverage).toBe('curated-episodes-only');expect(calls).toBe(0);
 const card=appendEvent(ctx.journal,'g',{type:'note',kind:'memory.v1',data:{text:'Shipment',tags:[],sources:[source.id],episode:{decision:'Tuesday',reason:'',openQuestions:[]}}});
 const tool=episodeRecall(async()=>{
 appendEvent(ctx.journal,'g',{type:'note',kind:'episode.receipt.v1',data:{foreign:true}});
 return {text:JSON.stringify([{id:card.id,relation:'supports'}]),toolCalls:[]};
 });
 const result=JSON.parse(await tool.run({query:'when?'},ctx));
 expect(result.status).toBe('completed');expect(result.episodeCount).toBe(1);expect(result.receiptIds).toHaveLength(3);
 expect(result.evidence[0].sources[0].id).toBe(source.id);
 expect(readEvents(ctx.journal).filter(e=>result.receiptIds.includes(e.id))).toHaveLength(3);
 await expect(tool.run({query:'x',extra:true},ctx)).rejects.toThrow();
 appendEvent(ctx.journal,'g',{type:'stimulus',source:'clock',text:'tick'});
 await expect(tool.run({query:'x'},ctx)).rejects.toThrow('terminal');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

for(const mode of ['failure','audience','cancel']) test(`wrapper ${mode} does not leak failed evidence`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ep-failure-'));const ctx={journal:join(dir,'journal'),gen:'g'} as ToolContext;
 try{
 const source=appendEvent(ctx.journal,'g',{type:'stimulus',source:'terminal',text:'Private shipment Tuesday.'});
 appendEvent(ctx.journal,'g',{type:'note',kind:'memory.v1',data:{text:'Shipment',tags:[],sources:[source.id],episode:{decision:'Tuesday',reason:'',openQuestions:[]}}});
 const abort=new AbortController();
 const tool=episodeRecall(async()=>{
  if(mode==='audience') appendEvent(ctx.journal,'g',{type:'stimulus',source:'clock',text:'tick'});
  if(mode==='cancel') abort.abort();
  throw Error('provider diagnostic contains private material');
 });
 if(mode==='failure'){
  const raw=await tool.run({query:'when?'},ctx,abort.signal),out=JSON.parse(raw);
  expect(out.status).toBe('failed');expect(out.evidence).toEqual([]);
  expect(out.receiptIds).toHaveLength(2);expect(raw).not.toContain('private material');
 }else await expect(tool.run({query:'when?'},ctx,abort.signal)).rejects.toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
