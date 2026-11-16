import {test,expect} from 'bun:test';
import {cacheProbe} from '../../body/cache-probe';
test('wire probe retains bounded fingerprints and emits only aggregate metadata',()=>{
 const probe=cacheProbe();
 const first=probe({instructions:'private',input:['x'.repeat(5000)],tools:[]});
 expect(first.comparable).toBe(false);
 const next=probe({instructions:'private',input:['x'.repeat(5000),'new'],tools:[]});
 expect(next.staticEqual).toBe(true);expect(next.commonPrefixBytes).toBe(4096);
 expect(JSON.stringify(next)).not.toContain('private');
 expect(probe({instructions:'changed',input:['x'.repeat(5000)],tools:[]}).staticEqual).toBe(false);
 expect(probe({instructions:'changed',input:['z'.repeat(5000)],tools:[]}).commonPrefixBytes).toBe(0);
});
