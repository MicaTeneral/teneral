/** Reproducible usage-only report: bun body/cache-report.ts JOURNAL [GENERATION [SINCE [UNTIL]]].
 * Dates are ISO bounds: since inclusive, until exclusive. Pass - as GENERATION for all.
 * Continuations = assistant events after tool-calling assistant events in the
 * same uninterrupted turn. Unknown cached usage is excluded, never treated as 0.
 * Token totals describe reported usage only; they do not measure provider latency.
 */
import {readEvents, type JournalEvent} from '../brain/journal';
function bound(value: string | undefined, name: string): number | undefined {
 if (value === undefined) return undefined;
 const at = Date.parse(value);
 if (!Number.isFinite(at)) throw Error(`${name} must be an ISO date`);
 return at;
}
export function cacheReport(events: JournalEvent[], generation?: string, since?: string, until?: string) {
 type Row = {input:number; output:number; cached?:number};
 const all: Row[] = [], within: Row[] = [];
 const from = bound(since, 'since'), before = bound(until, 'until');
 if (from !== undefined && before !== undefined && from >= before) throw Error('since must precede until');
 let continuing = false;
 for (const e of events) {
  if (e.type === 'turn.interrupted' || e.type === 'generation.ready') continuing = false;
  if (e.type !== 'assistant') continue;
  const at = Date.parse(e.ts);
  if ((!generation || generation === '-' || e.gen === generation)
   && (from === undefined || at >= from) && (before === undefined || at < before)
   && e.usage && e.usage.input > 0) {
   all.push(e.usage);
   if (continuing) within.push(e.usage);
  }
  continuing = (e.toolCalls?.length ?? 0) > 0;
 }
 const summary=(rows:Row[])=>{
  const known=rows.filter((r):r is Row & {cached:number}=>typeof r.cached==='number');
  return {requests:rows.length,reportedCache:known.length,
   cacheCoverage:rows.length?known.length/rows.length:null,
   inputTokens:rows.reduce((s,r)=>s+r.input,0),outputTokens:rows.reduce((s,r)=>s+r.output,0),
   cachedInputTokens:known.reduce((s,r)=>s+r.cached,0),
   zero:known.filter(r=>r.cached===0).length,
   above08:known.filter(r=>r.cached/r.input>.8).length,
   fractionAbove08:known.length?known.filter(r=>r.cached/r.input>.8).length/known.length:null,
   meanInput:rows.length?rows.reduce((s,r)=>s+r.input,0)/rows.length:null,
   weightedCachedInput:known.length?known.reduce((s,r)=>s+r.cached,0)/known.reduce((s,r)=>s+r.input,0):null};
 };
 return {generation:generation??'all',since:since??null,until:until??null,all:summary(all),withinTurn:summary(within)};
}
if (import.meta.main) {
 if (!process.argv[2]) throw Error('Usage: bun body/cache-report.ts JOURNAL [GENERATION [SINCE [UNTIL]]]');
 console.log(JSON.stringify(cacheReport(readEvents(process.argv[2]),...process.argv.slice(3,6) as [string?,string?,string?]),null,2));
}
