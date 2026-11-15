import {test,expect} from 'bun:test';
import {cacheReport} from '../../body/cache-report';
import type {JournalEvent} from '../../brain/journal';
test('cache report separates continuations and unknown cache usage',()=>{
 const events=[
  {type:'assistant',gen:'g',toolCalls:[{}],usage:{input:100,output:1,cached:0}},
  {type:'assistant',gen:'g',toolCalls:[{}],usage:{input:100,output:1,cached:90}},
  {type:'assistant',gen:'g',toolCalls:[],usage:{input:100,output:1}},
  {type:'assistant',gen:'h',toolCalls:[],usage:{input:100,output:1,cached:0}},
 ] as unknown as JournalEvent[];
 const r=cacheReport(events,'g');
 expect(r.all.requests).toBe(3); expect(r.all.reportedCache).toBe(2);
 expect(r.all.inputTokens).toBe(300); expect(r.all.outputTokens).toBe(3);
 expect(r.all.cachedInputTokens).toBe(90); expect(r.all.cacheCoverage).toBe(2/3);
 expect(r.withinTurn.requests).toBe(2); expect(r.withinTurn.fractionAbove08).toBe(1);
 expect(r.all.weightedCachedInput).toBe(.45);
});

test('cache report uses half-open journal interval without inventing missing usage',()=>{
 const events=[
  {type:'assistant',gen:'g',ts:'2026-11-14T23:59:59Z',usage:{input:900,output:9,cached:900}},
  {type:'assistant',gen:'g',ts:'2026-11-15T00:00:00Z',toolCalls:[{}],usage:{input:100,output:2,cached:25}},
  {type:'assistant',gen:'h',ts:'2026-11-15T00:01:00Z',usage:{input:200,output:3,cached:50}},
  {type:'assistant',gen:'g',ts:'2026-11-15T00:02:00Z',usage:{input:300,output:4}},
  {type:'assistant',gen:'g',ts:'2026-11-15T00:03:00Z'},
  {type:'assistant',gen:'g',ts:'2026-11-16T00:00:00Z',usage:{input:900,output:9,cached:900}},
 ] as unknown as JournalEvent[];
 const r=cacheReport(events,'-','2026-11-15T00:00:00Z','2026-11-16T00:00:00Z');
 expect(r.all).toMatchObject({requests:3,reportedCache:2,cacheCoverage:2/3,inputTokens:600,outputTokens:9,cachedInputTokens:75,weightedCachedInput:75/300});
 // Generation filtering does not break turn continuity; missing usage still breaks it.
 expect(r.withinTurn).toMatchObject({requests:1,inputTokens:200,cachedInputTokens:50});
 expect(()=>cacheReport(events,undefined,'bad')).toThrow('since must be an ISO date');
 expect(()=>cacheReport(events,undefined,'2026-11-16','2026-11-15')).toThrow('since must precede until');
});
