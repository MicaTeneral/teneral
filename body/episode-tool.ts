/** Explicit supplementary lookup; never automatic context retrieval. */
import {readEvents} from '../brain/journal';
import {journalEpisodeCards} from './episode-adapter';
import {retrieveJournalEpisodes} from './episode-receipts';
import type {Provider} from '../brain/provider';
import type {Tool} from './tools';
export function episodeRecall(provider:Provider):Tool {
 return {
  spec:{name:'episode_recall',description:'Public-readable supplementary search over curated episodes ONLY, not all memory or journal. Empty results never establish absence; use recall for broader history. One auxiliary model call; usage excluded from kernel totals, timeout cost may be unknown.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}},
  async run(args,ctx,signal){
   signal?.throwIfAborted();
   const events=readEvents(ctx.journal);
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).join(',')!=='query'||typeof (args as {query?:unknown}).query!=='string') throw Error('Invalid query');
   const query=(args as {query:string}).query;
   const stimulus=events.findLast(e=>e.type==='stimulus')?.id;
   const assertAudience=()=>{
    const current=readEvents(ctx.journal);
    if(current.findLast(e=>e.type==='stimulus')?.id!==stimulus) throw Error('Episode result withheld: turn changed');
   };
   const metadata={coverage:'curated-episodes-only',comprehensive:false,absenceEvidence:false,fallback:'Use recall for broader journal history.',untrusted:true,usageScope:'auxiliary-excluded-from-kernel-totals'};
   // Capture IDs only for this synchronous invocation, not every historical receipt.
   const receiptIds:string[]=[];
   let count:number|undefined;
   try {
    count=journalEpisodeCards(events).length;
    const evidence=await retrieveJournalEpisodes(query,ctx.journal,ctx.gen,provider,signal,30000,id=>receiptIds.push(id));
    signal?.throwIfAborted();
    assertAudience();
    return JSON.stringify({...metadata,status:'completed',episodeCount:count,evidence,...receipts()});
   } catch {
    signal?.throwIfAborted();
    assertAudience();
    return JSON.stringify({...metadata,status:signal?.aborted?'cancelled':'failed',episodeCount:count,evidence:[],...receipts()});
   }
   function receipts(){
    const notes=receiptIds;
    return {receiptIds,cost:notes.length?'See auxiliary receipts; missing provider usage means unknown cost.':'No auxiliary receipt; no reported usage.'};
   }
  },
 };
}
