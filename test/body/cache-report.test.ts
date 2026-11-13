import {test,expect} from 'bun:test';
import {cacheReport} from '../../body/cache-report';
import type {JournalEvent} from '../../kernel/journal';
test('cache report separates continuations and unknown cache usage',()=>{
 const events=[
  {type:'assistant',gen:'g',toolCalls:[{}],usage:{input:100,output:1,cached:0}},
  {type:'assistant',gen:'g',toolCalls:[{}],usage:{input:100,output:1,cached:90}},
  {type:'assistant',gen:'g',toolCalls:[],usage:{input:100,output:1}},
  {type:'assistant',gen:'h',toolCalls:[],usage:{input:100,output:1,cached:0}},
 ] as unknown as JournalEvent[];
 const r=cacheReport(events,'g');
 expect(r.all.requests).toBe(3); expect(r.all.reportedCache).toBe(2);
 expect(r.withinTurn.requests).toBe(2); expect(r.withinTurn.fractionAbove08).toBe(1);
 expect(r.all.weightedCachedInput).toBe(.45);
});
