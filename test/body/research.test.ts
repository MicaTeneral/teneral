import {test,expect} from 'bun:test';
import {research} from '../../body/research';
import type {ToolContext} from '../../body/tools';
const ctx={} as ToolContext;
const source={repository:'owner/repo',commit:'a'.repeat(40),path:'file.txt'};
test('research supplies complete provenance-bound evidence to concurrent no-tools jobs',async()=>{
 let started=0;let release!:()=>void;const barrier=new Promise<void>(r=>release=r);
 const tool=research(async(messages,tools)=>{
  expect(tools).toEqual([]);
  const payload=JSON.parse(messages[1]!.content as string);const evidence=JSON.parse(payload.context);
  expect(evidence.text).toBe('untrusted source');expect(evidence.commit).toBe(source.commit);
  if(++started===2) release();await barrier;
  return {text:'assessment',toolCalls:[]};
 },(async()=>new Response('untrusted source')) as unknown as typeof fetch);
 const result=JSON.parse(await tool.run({sources:[source],jobs:['one','two'].map(label=>({label,task:'review',source:0}))},ctx));
 expect(started).toBe(2);expect(result.sources[0].sha256).toHaveLength(64);
 expect(result.sources[0].text).toBeUndefined();expect(result.results).toHaveLength(2);expect(result.assignments[1].source).toBe(0);
});
test('invalid jobs never fetch; escaped or aggregate context overflow never launches workers',async()=>{
 let fetches=0,calls=0;let text='x';
 const tool=research(async()=>{calls++;return {text:'ok',toolCalls:[]};},(async()=>{fetches++;return new Response(text);}) as unknown as typeof fetch);
 await expect(tool.run({sources:[source],jobs:[{label:'x',task:'review',source:1}]},ctx)).rejects.toThrow();expect(fetches).toBe(0);
 text='\n'.repeat(15000);
 await expect(tool.run({sources:[source],jobs:[{label:'x',task:'review',source:0}]},ctx)).rejects.toThrow('context budget');
 text='x'.repeat(15000);
 await expect(tool.run({sources:[source],jobs:['a','b','c'].map(label=>({label,task:'review',source:0}))},ctx)).rejects.toThrow('context budget');expect(calls).toBe(0);
});
