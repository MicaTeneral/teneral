import {test, expect} from 'bun:test';
import {retrieveSources} from '../../body/sources';
const source={repository:'owner/repo',commit:'a'.repeat(40),path:'src/main.ts'};
test('preflight rejects escapes and duplicate sources before fetch', async()=>{
 let calls=0; const send=(async()=>{calls++;return new Response('x');}) as unknown as typeof fetch;
 for(const path of ['../secret','/etc/passwd','a//b','%2e%2e/x','x?y','x#y','a\\b','']) {
  await expect(retrieveSources([{...source,path}],send)).rejects.toThrow();
 }
 await expect(retrieveSources([source,source],send)).rejects.toThrow();
 await expect(retrieveSources([{...source,commit:'main'}],send)).rejects.toThrow();
 expect(calls).toBe(0);
});
test('retrieval binds content to host provenance and omits credentials/redirects',async()=>{
 const send=(async(url:unknown,init?:RequestInit)=>{
  expect(String(url)).toBe(`https://raw.githubusercontent.com/owner/repo/${source.commit}/src/main.ts`);
  expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit');expect(init?.headers).toBeUndefined();
  return new Response('source');
 }) as typeof fetch;
 const result=await retrieveSources([source],send);
 expect(result[0]!.text).toBe('source');expect(result[0]!.sha256).toHaveLength(64);expect(result[0]!.untrusted).toBe(true);
});
test('redirects, oversized streams, aggregate overflow and invalid UTF8 fail closed',async()=>{
 for(const make of [()=>new Response('',{status:302}),()=>new Response('x'.repeat(16001)),()=>new Response(new Uint8Array([255]))]) {
  await expect(retrieveSources([source],(async()=>make()) as unknown as typeof fetch)).rejects.toThrow();
 }
 await expect(retrieveSources(['a','b','c'].map(path=>({...source,path})),(async()=>new Response('x'.repeat(16000))) as unknown as typeof fetch)).rejects.toThrow('limit');
});
test('deadline bounds ignored fetch abort and cancels stalled response reader',async()=>{
 await expect(retrieveSources([source],(async()=>new Promise(()=>{})) as unknown as typeof fetch,10)).rejects.toThrow('deadline');
 let cancelled=false;
 const send=(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))) as unknown as typeof fetch;
 await expect(retrieveSources([source],send,10)).rejects.toThrow();expect(cancelled).toBe(true);
});
