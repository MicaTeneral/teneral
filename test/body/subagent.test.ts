import { test, expect } from 'bun:test';
import { subagent } from '../../body/subagent';
import type { ToolContext } from '../../body/tools';
const ctx = {} as ToolContext;
test('worker gets explicit context only, no tools; result is attributed and capped', async () => {
 const worker = subagent(async (messages, tools, options) => {
  expect(messages).toHaveLength(2); expect(tools).toEqual([]);
  expect(messages[1]!.content).toBe(JSON.stringify({task:'Review', context:'data'}));
  expect(options?.signal).toBeDefined();
  expect(options?.maxOutputTokens).toBe(4096);
  return {text:'x'.repeat(13000),toolCalls:[],usage:{input:123,output:45,cached:67}};
 });
 const result=JSON.parse(await worker.run({task:'Review',context:'data'},ctx));
 expect(result.worker).toBeString(); expect(result.untrusted).toBe(true);
 expect(result.usage).toEqual({input:123,output:45,cached:67});
 expect(result.usageScope).toBe('auxiliary-excluded-from-parent-usage');
 expect(result.truncated).toBe(true);expect(result.text.length).toBe(12000);
});
test('deadline bounds waiting even when provider ignores cancellation', async () => {
 let signal: AbortSignal | undefined;
 const worker=subagent(async (_m,_t,o)=>{signal=o?.signal;return new Promise(()=>{});},10);
 const result=JSON.parse(await worker.run({task:'Review',context:''},ctx));
 expect(result.status).toBe('timed_out');expect(signal?.aborted).toBe(true);
});
test('invalid requests never reach provider and tool requests never execute', async () => {
 let calls=0;
 const worker=subagent(async()=>{calls++;return {text:'unsafe',toolCalls:[{id:'x',name:'bash',args:{command:'anything'}}]};});
 await expect(worker.run({task:'',context:''},ctx)).rejects.toThrow();expect(calls).toBe(0);
 const result=JSON.parse(await worker.run({task:'Review',context:''},ctx));
 expect(result.status).toBe('failed');expect(result.text).toBeUndefined();expect(calls).toBe(1);
});

test('batch starts all workers concurrently and preserves ordered independent results', async () => {
 const {subagents} = await import('../../body/subagent');
 let started=0; let release!:()=>void;
 const barrier=new Promise<void>(r=>{release=r;});
 const tool=subagents(async (messages, tools)=>{
  expect(tools).toEqual([]); started++;
  if(started===3) release();
  await barrier;
  const task=JSON.parse(messages[1]!.content as string).task;
  if(task==='fail') throw new Error('private transport details');
  if(task==='hang') return new Promise(()=>{});
  return {text:'ok',toolCalls:[],usage:{input:10,output:2,cached:task==='ok'?3:undefined}};
 },30);
 const result=JSON.parse(await tool.run({jobs:['ok','fail','hang'].map(task=>({label:task,task,context:''}))},ctx));
 expect(started).toBe(3);
 expect(result.results.map((r:any)=>r.status)).toEqual(['completed','failed','timed_out']);
 expect(result.results.map((r:any)=>r.label)).toEqual(['ok','fail','hang']);
 expect(new Set(result.results.map((r:any)=>r.worker)).size).toBe(3);
 expect(result.results[0].usage).toEqual({input:10,output:2,cached:3});
 expect(result.usage).toEqual({input:10,output:2,cached:3,reportedWorkers:1,totalWorkers:3,complete:false,scope:'auxiliary-excluded-from-parent-usage'});
 expect(JSON.stringify(result)).not.toContain('private transport');
});

test('entire batch is preflighted before any call', async () => {
 const {subagents} = await import('../../body/subagent');
 let calls=0; const tool=subagents(async()=>{calls++;return {text:'ok',toolCalls:[]};});
 const job={label:'a',task:'x',context:''};
 for(const jobs of [[], [job,job], [job,{...job,label:'b',task:''}], Array(4).fill(job),
  ['a','b','c'].map(label=>({label,task:'x',context:'x'.repeat(20000)})),
  [{...job,context:'x'.repeat(20001)}], [{...job,label:'bad label'}]]) {
  await expect(tool.run({jobs},ctx)).rejects.toThrow();
 }
 expect(calls).toBe(0);
});
