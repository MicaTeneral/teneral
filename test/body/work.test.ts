import { readAgenda } from '../../body/agenda';
import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWork, saveWork, resumeWork, workFooter, workContext } from '../../body/work';
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

test('agenda states never append unrelated automatic reply footers', () => {
 const dir=mkdtempSync(join(tmpdir(),'footer-'));const path=join(dir,'work.json');
 try {
 expect(workFooter(path)).toBe('');
 for(const status of ['queued','waiting','done'] as const){
 saveWork(path,{status,task:'Test task',next:'Concrete step',attempts:0,due:0});
 expect(workFooter(path)).toBe('');
 }
 } finally {rmSync(dir,{recursive:true});}
});

test('every-round work context follows persisted changes and does not invent fresh-install goals', () => {
 const dir=mkdtempSync(join(tmpdir(),'work-context-'));const path=join(dir,'work.json');
 try {
 expect(workContext(path)).toBe('');
 saveWork(path,{status:'queued',task:'Test outcome',next:'Inspect existing receipt',attempts:0,due:0});
 expect(workContext(path)).toContain('inbox traffic');
 expect(workContext(path)).toContain('continue concrete ready steps in this turn');
 expect(workContext(path)).toContain('A completed step or checkpoint update is not a reason to end the turn');
 expect(workContext(path)).toContain('timed-out action may already have succeeded');
 expect(workContext(path)).toContain('Inspect existing receipt');
 saveWork(path,{status:'waiting',task:'Test outcome',next:'Owner decision',attempts:1,due:0});
 expect(workContext(path)).toContain('BLOCKED');
 expect(workContext(path)).toContain('Owner decision');
 saveWork(path,{status:'done',task:'Test outcome',next:'Verified',attempts:1,due:0});
 expect(workContext(path)).toBe('');
 } finally {rmSync(dir,{recursive:true});}
});

test('checkpoint tool preserves same-task recovery but never imports it into another task', async () => {
 const dir=mkdtempSync(join(tmpdir(),'checkpoint-'));
 const ctx={workspace:join(dir,'workspace')} as import('../../body/tools').ToolContext;
 const {work}=await import('../../body/work');
 try {
 await work.run({status:'queued',task:'Counter',next:'Inspect receipt',outcome:'Counter equals one',recovery:'counter.json',evidence:'Not started'},ctx);
 await work.run({status:'queued',task:'Counter',next:'Read result'},ctx);
 expect(readWork(join(dir,'work.json'))?.recovery).toBe('counter.json');
 expect(workContext(join(dir,'work.json'))).toContain('Counter equals one');
 await work.run({status:'queued',task:'Other',next:'Inspect'},ctx);
 expect(readAgenda(join(dir,'work.json')).items.find(w=>w.task==='Other')?.recovery).toBeUndefined();
 } finally {rmSync(dir,{recursive:true});}
});

test('local recovery fixture: saved-but-unstarted and lost-response checkpoints retain a usable receipt pointer', async () => {
 const dir=mkdtempSync(join(tmpdir(),'receipt-recovery-'));
 const path=join(dir,'work.json'), receipt=join(dir,'receipt.json');
 const ctx={workspace:join(dir,'workspace')} as import('../../body/tools').ToolContext;
 const {work}=await import('../../body/work');
 // This fixture supplies an idempotent local action, not generic exactly-once execution.
 let executions=0;
 function reconcile(pointer:string) {
   if(existsSync(pointer)) return JSON.parse(readFileSync(pointer,'utf8'));
   executions++;
   const result={counter:executions};
   writeFileSync(pointer,JSON.stringify(result));
   return result;
 }
 try {
 await work.run({status:'queued',task:'Local counter',next:'Reconcile receipt before action',outcome:'Counter is one',recovery:receipt},ctx);
 // Reload models a new process with only persisted state, before work started.
 let checkpoint=readWork(path)!;
 expect(executions).toBe(0);
 expect(reconcile(checkpoint.recovery!).counter).toBe(1);
 // Simulate losing the response: leave the queued checkpoint unchanged.
 checkpoint=readWork(path)!;
 expect(checkpoint.status).toBe('queued');
 expect(reconcile(checkpoint.recovery!).counter).toBe(1);
 expect(executions).toBe(1);
 await work.run({status:'done',task:'Local counter',next:'No action remains',evidence:'Receipt counter verified as one'},ctx);
 expect(readWork(path)?.recovery).toBe(receipt);
 expect(workContext(path)).toBe('');
 } finally {rmSync(dir,{recursive:true});}
});

test('malformed checkpoints are rejected without overwriting valid saved work', async () => {
 const dir=mkdtempSync(join(tmpdir(),'bad-checkpoint-'));
 const path=join(dir,'work.json');
 const ctx={workspace:join(dir,'workspace')} as import('../../body/tools').ToolContext;
 const {work}=await import('../../body/work');
 try {
 for(const key of ['outcome','recovery','evidence']) {
  for(const value of [42,{},'x'.repeat(2001)]) {
   await work.run({status:'queued',task:'Valid',next:'Inspect'},ctx);
   const before=readFileSync(path,'utf8');
   await expect(work.run({status:'queued',task:'Invalid',next:'Inspect',[key]:value},ctx)).rejects.toThrow();
   expect(readFileSync(path,'utf8')).toBe(before);
   const corrupt=JSON.parse(before);corrupt.items[0][key]=value;
   writeFileSync(path,JSON.stringify(corrupt));
   expect(readWork(path)).toBeNull();
   writeFileSync(path,before);
  }
 }
 } finally {rmSync(dir,{recursive:true});}
});

test('an owner interrupt holds queued work until something arrives', async () => {
 const { heldByInterrupt } = await import('../../body/work');
 const t = (type: string) => ({ type });
 expect(heldByInterrupt([])).toBe(false);
 expect(heldByInterrupt([t('stimulus'), t('assistant')])).toBe(false);
 expect(heldByInterrupt([t('stimulus'), t('turn.interrupted')])).toBe(true);
 expect(heldByInterrupt([t('stimulus'), t('turn.interrupted'), t('note')])).toBe(true);
 expect(heldByInterrupt([t('turn.interrupted'), t('stimulus')])).toBe(false);
});
