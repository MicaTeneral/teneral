import { test, expect } from 'bun:test';
import { subagent, subagents } from '../../body/subagent';
import { research } from '../../body/research';
import { retrieveSources } from '../../body/sources';
import type { ToolContext } from '../../body/tools';
const ctx = {} as ToolContext;
const sources = [{repository:'RayforceDB/rayforce',commit:'a'.repeat(40),path:'README.md'}];
const jobs = [{label:'a',task:'Review',source:0}];
test('pre-aborted workers and research never start provider or fetch', async () => {
 const c = new AbortController(); c.abort(); let calls=0;
 const provider = async () => { calls++; return {text:'',toolCalls:[]}; };
 const fetcher = (async () => { calls++; return new Response('data'); }) as unknown as typeof fetch;
 await expect(subagent(provider).run({task:'Review',context:''},ctx,c.signal)).rejects.toThrow();
 await expect(subagents(provider).run({jobs:[{label:'a',task:'Review',context:''}]},ctx,c.signal)).rejects.toThrow();
 await expect(research(provider,fetcher).run({sources,jobs},ctx,c.signal)).rejects.toThrow();
 expect(calls).toBe(0);
});
test('parent cancellation settles all workers even when provider ignores it', async () => {
 const c = new AbortController(); const signals: AbortSignal[]=[];
 const tool = subagents(async (_m,_t,o) => { signals.push(o!.signal!); return new Promise(()=>{}); });
 const pending = tool.run({jobs:['a','b','c'].map(label=>({label,task:'Review',context:''}))},ctx,c.signal);
 expect(signals.length).toBe(3); c.abort();
 const result = JSON.parse(await pending);
 expect(signals.every(s=>s.aborted)).toBe(true);
 expect(result.results.map((r:any)=>r.status)).toEqual(['cancelled','cancelled','cancelled']);
});
test('research cancellation aborts stalled fetch and never launches workers', async () => {
 const c = new AbortController(); let observed: AbortSignal | undefined; let workers=0;
 const pending = research(async()=>{workers++;return {text:'',toolCalls:[]};},(async (_u: unknown,o?: RequestInit)=>{
  observed=o?.signal as AbortSignal; return new Promise(()=>{});
 }) as unknown as typeof fetch).run({sources,jobs},ctx,c.signal);
 c.abort(); await expect(pending).rejects.toThrow();
 expect(observed?.aborted).toBe(true); expect(workers).toBe(0);
});
test('retrieval cancellation cancels stalled response stream', async () => {
 const c = new AbortController(); let cancelled=false; let started!:()=>void;
 const reading = new Promise<void>(r=>{started=r;});
 const pending = retrieveSources(sources,(async()=>new Response(new ReadableStream({
  pull(){started();},cancel(){cancelled=true;}
 }))) as unknown as typeof fetch,15000,c.signal);
 await reading; c.abort(); await expect(pending).rejects.toThrow();
 await Bun.sleep(0); expect(cancelled).toBe(true);
});
test('research propagates cancellation after retrieval to analysis', async () => {
 const c = new AbortController(); let signal: AbortSignal | undefined; let start!:()=>void;
 const ready = new Promise<void>(r=>{start=r;});
 const pending = research(async(_m,_t,o)=>{signal=o?.signal;start();return new Promise(()=>{});},
  (async()=>new Response('synthetic evidence')) as unknown as typeof fetch).run({sources,jobs},ctx,c.signal);
 await ready; c.abort(); const result=JSON.parse(await pending);
 expect(signal?.aborted).toBe(true); expect(result.results[0].status).toBe('cancelled');
});
