import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readAgenda, saveAgenda, selectWork, updateAgenda } from '../../body/agenda';
import type { Work } from '../../body/work';
const task = (name: string, status: Work['status'] = 'queued'): Work => ({task:name,status,next:'Inspect receipt',attempts:0,due:0});
test('ordered agenda survives restart and advances past blocked/completed outcomes', () => {
 const dir=mkdtempSync(join(tmpdir(),'agenda-')), path=join(dir,'agenda.json');
 try {
 let a=readAgenda(path);expect(selectWork(a)).toBeUndefined();
 a=updateAgenda(a,{...task('A'),recovery:'receipt-A',outcome:'Verified A'});
 a=updateAgenda(a,task('B'));
 saveAgenda(path,a);a=readAgenda(path);
 expect(selectWork(a)?.task).toBe('A');
 a=updateAgenda(a,task('A','waiting'));
 expect(a.items[0].recovery).toBe('receipt-A');
 expect(selectWork(a)?.task).toBe('B');
 a=updateAgenda(a,task('B','done'));saveAgenda(path,a);
 expect(selectWork(readAgenda(path))).toBeUndefined();
 a=updateAgenda(readAgenda(path),task('A'));expect(selectWork(a)?.task).toBe('A');
 a=updateAgenda(a,task('A','done'));expect(selectWork(a)).toBeUndefined();
 expect(a.items.map(w=>w.task)).toEqual(['A','B']);
 } finally {rmSync(dir,{recursive:true});}
});
test('invalid existing agenda fails loudly; malformed updates cannot damage the input', () => {
 const dir=mkdtempSync(join(tmpdir(),'agenda-invalid-')),path=join(dir,'agenda.json');
 try {
 const a=updateAgenda(readAgenda(path),task('A'));
 expect(()=>updateAgenda(a,{...task('B'),attempts:-1})).toThrow();
 expect(a.items).toHaveLength(1);
 writeFileSync(path,'broken');expect(()=>readAgenda(path)).toThrow();
 writeFileSync(path,JSON.stringify({version:1,items:[task('A'),task('A')]}));expect(()=>readAgenda(path)).toThrow();
 } finally {rmSync(dir,{recursive:true});}
});

test('legacy checkpoint migrates on write and tool completion selects the next commitment', async () => {
 const dir=mkdtempSync(join(tmpdir(),'agenda-migrate-')),path=join(dir,'work.json');
 const { work, readWork, workContext, workFooter }=await import('../../body/work');
 const ctx={workspace:join(dir,'workspace')} as import('../../body/tools').ToolContext;
 try {
 writeFileSync(path,JSON.stringify({...task('Legacy'),recovery:'receipt',evidence:'started',outcome:'Verified'}));
 await work.run({status:'queued',task:'Second',next:'Inspect'},ctx);
 expect(readAgenda(path).items).toHaveLength(2);
 expect(readWork(path)?.task).toBe('Legacy');
 await work.run({status:'done',task:'Legacy',next:'Verified'},ctx);
 expect(readAgenda(path).items[0].recovery).toBe('receipt');
 expect(readWork(path)?.task).toBe('Second');
 expect(workContext(path)).toContain('Second');expect(workFooter(path)).toBe('');
 await work.run({status:'waiting',task:'Second',next:'Owner decision'},ctx);
 expect(selectWork(readAgenda(path))).toBeUndefined();
 expect(workContext(path)).toContain('BLOCKED');
 writeFileSync(path,'broken');
 await expect(work.run({status:'queued',task:'New',next:'Inspect'},ctx)).rejects.toThrow();
 expect(workContext(path)).toContain('unreadable');
 } finally {rmSync(dir,{recursive:true});}
});
