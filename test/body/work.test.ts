import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWork, saveWork, resumeWork } from '../../body/work';
test('durable task survives reload; waiting and done are explicit states', () => {
 const dir=mkdtempSync(join(tmpdir(),'work-')); const path=join(dir,'work.json');
 try {
 expect(readWork(path)).toBeNull();
 for(const status of ['queued','waiting','done'] as const){
 saveWork(path,{status,task:'owner task',next:'inspect source',attempts:1,due:0});
 expect(readWork(path)?.status).toBe(status);
 }
 } finally {rmSync(dir,{recursive:true});}
});
test('scheduler resumes once, stops while busy, and pauses at budget', async () => {
 const dir=mkdtempSync(join(tmpdir(),'work-')); const path=join(dir,'work.json'); let busy=true; const notices:string[]=[];
 saveWork(path,{status:'queued',task:'test',next:'step',attempts:2,due:0});
 const stop=resumeWork(path,()=>busy,()=>1000000)(s=>notices.push(s.text));
 try {
 await Bun.sleep(5100); expect(notices).toHaveLength(0);
 busy=false; await Bun.sleep(5100); expect(notices).toHaveLength(1); expect(readWork(path)?.attempts).toBe(3);
 const w=readWork(path)!;saveWork(path,{...w,due:0});
 await Bun.sleep(5100);expect(readWork(path)?.status).toBe('waiting');expect(notices).toHaveLength(2);
 } finally {stop();rmSync(dir,{recursive:true});}
},20000);
