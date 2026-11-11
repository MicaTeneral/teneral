import { test, expect } from 'bun:test';
import { subagent } from '../../body/subagent';
import type { ToolContext } from '../../body/tools';
const ctx = {} as ToolContext;
test('worker gets explicit context only, no tools; result is attributed and capped', async () => {
 const worker = subagent(async (messages, tools, options) => {
  expect(messages).toHaveLength(2); expect(tools).toEqual([]);
  expect(messages[1]!.content).toBe(JSON.stringify({task:'Review', context:'data'}));
  expect(options?.signal).toBeDefined();
  return {text:'x'.repeat(13000),toolCalls:[]};
 });
 const result=JSON.parse(await worker.run({task:'Review',context:'data'},ctx));
 expect(result.worker).toBeString(); expect(result.untrusted).toBe(true);
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
