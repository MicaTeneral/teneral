/** Reproducible usage-only report: bun body/cache-report.ts JOURNAL [GENERATION].
 * Continuations = assistant events after tool-calling assistant events in the
 * same uninterrupted turn. Unknown cached usage is excluded, never treated as 0.
 */
import {readEvents, type JournalEvent} from '../kernel/journal';
export function cacheReport(events: JournalEvent[], generation?: string) {
 type Row = {input:number; cached?:number};
 const all: Row[] = [], within: Row[] = [];
 let continuing = false;
 for (const e of events) {
  if (e.type === 'turn.interrupted' || e.type === 'generation.ready') continuing = false;
  if (e.type !== 'assistant') continue;
  if ((!generation || e.gen === generation) && e.usage && e.usage.input > 0) {
   all.push(e.usage);
   if (continuing) within.push(e.usage);
  }
  continuing = (e.toolCalls?.length ?? 0) > 0;
 }
 const summary=(rows:Row[])=>{
  const known=rows.filter((r):r is Row & {cached:number}=>typeof r.cached==='number');
  return {requests:rows.length,reportedCache:known.length,zero:known.filter(r=>r.cached===0).length,
   above08:known.filter(r=>r.cached/r.input>.8).length,
   fractionAbove08:known.length?known.filter(r=>r.cached/r.input>.8).length/known.length:null,
   meanInput:rows.length?rows.reduce((s,r)=>s+r.input,0)/rows.length:null,
   weightedCachedInput:known.length?known.reduce((s,r)=>s+r.cached,0)/known.reduce((s,r)=>s+r.input,0):null};
 };
 return {generation:generation??'all',all:summary(all),withinTurn:summary(within)};
}
if (import.meta.main) {
 if (!process.argv[2]) throw Error('Usage: bun body/cache-report.ts JOURNAL [GENERATION]');
 console.log(JSON.stringify(cacheReport(readEvents(process.argv[2]),process.argv[3]),null,2));
}
