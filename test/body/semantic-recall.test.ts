import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendEvent,readEvents} from '../../kernel/journal';
import {semanticRecall} from '../../body/semantic-recall';
import type {ToolContext} from '../../body/tools';
async function fixture(fn:(ctx:ToolContext)=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'semantic-'));const ctx={journal:join(dir,'journal'),gen:'g'} as ToolContext;
 appendEvent(ctx.journal,'g',{type:'stimulus',source:'terminal',text:'We agreed to retain journal history.'});
 appendEvent(ctx.journal,'g',{type:'stimulus',source:'terminal',text:'Why keep history?'});
 try{await fn(ctx);}finally{rmSync(dir,{recursive:true,force:true});}
}
test('bounded call returns original provenance and separate usage',()=>fixture(async ctx=>{
 const tool=semanticRecall(async(messages,tools,options)=>{
  expect(tools).toEqual([]);expect(options?.maxOutputTokens).toBe(1024);
  const data=JSON.parse(messages[1]!.content as string);
  return {text:JSON.stringify([{id:data.records[0].id,relation:'supports'}]),toolCalls:[],usage:{input:10,output:3}};
 });
 const out=JSON.parse(await tool.run({query:'retain history'},ctx));
 expect(out.records[0].record.sources.length).toBe(1);expect(out.usage).toEqual({input:10,output:3});
 expect(out.usageScope).toContain('excluded');
 expect(readEvents(ctx.journal).filter(e=>e.type==='assistant')).toHaveLength(0);
}));
test('external audience allows call but changed turn discards result',()=>fixture(async ctx=>{
 let calls=0;
 const tool=semanticRecall(async()=>{calls++;appendEvent(ctx.journal,'g',{type:'stimulus',source:'agent:other',text:'hello'});return{text:'[]',toolCalls:[]};});
 expect(JSON.parse(await tool.run({query:'history'},ctx)).status).toBe('stale');
 expect(JSON.parse(await tool.run({query:'history'},ctx)).status).toBe('stale');expect(calls).toBe(2);
}));
test('malformed selection still retains usage receipt; timeout never retries',()=>fixture(async ctx=>{
 const tool=semanticRecall(async()=>({text:'not JSON',toolCalls:[],usage:{input:2,output:1}}));
 expect(JSON.parse(await tool.run({query:'history'},ctx)).status).toBe('failed');
 expect(readEvents(ctx.journal).some(e=>e.type==='note'&&JSON.stringify(e.data).includes('"input":2'))).toBe(true);
 let calls=0;const hung=semanticRecall(async()=>{calls++;return new Promise(()=>{});},5);
 expect(JSON.parse(await hung.run({query:'history'},ctx)).status).toBe('timed_out');expect(calls).toBe(1);
}));
test('correction during provider call invalidates snapshot',()=>fixture(async ctx=>{
 const tool=semanticRecall(async(messages)=>{
  const record=JSON.parse(messages[1]!.content as string).records[0];
  appendEvent(ctx.journal,'g',{type:'note',kind:'memory.v1',data:{text:'Corrected historical decision',tags:['decision'],sources:record.sources,supersedes:record.id}});
  return{text:JSON.stringify([{id:record.id,relation:'supports'}]),toolCalls:[]};
 });
 const out=JSON.parse(await tool.run({query:'history'},ctx));
 expect(out.status).toBe('stale');expect(out.records).toBeUndefined();
}));
test('oversized corpus refuses before call; fabricated ID fails closed',()=>fixture(async ctx=>{
 let calls=0;const tool=semanticRecall(async()=>{calls++;return{text:'[{"id":"fabricated","relation":"supports"}]',toolCalls:[]};});
 expect(JSON.parse(await tool.run({query:'history'},ctx)).status).toBe('failed');expect(calls).toBe(1);
 const source=readEvents(ctx.journal)[0]!.id;
 for(let i=0;i<30;i++) appendEvent(ctx.journal,'g',{type:'note',kind:'memory.v1',data:{text:`${i} ${'e'.repeat(900)}`,tags:['decision'],sources:[source]}});
 expect(JSON.parse(await tool.run({query:'history'},ctx)).status).toBe('corpus_too_large');expect(calls).toBe(1);
}));
test('cancellation stops local waiting even when transport ignores abort',()=>fixture(async ctx=>{
 const controller=new AbortController();let started!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});let passed:AbortSignal|undefined;
 const tool=semanticRecall(async(_m,_t,o)=>{passed=o?.signal;started();return new Promise(()=>{});});
 const pending=tool.run({query:'history'},ctx,controller.signal);
 await ready;controller.abort();
 expect(JSON.parse(await pending).status).toBe('cancelled');expect(passed?.aborted).toBe(true);
 await expect(tool.run({query:'history'},ctx,controller.signal)).rejects.toThrow();
}));
