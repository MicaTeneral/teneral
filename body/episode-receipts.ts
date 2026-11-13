/** Unregistered journal adapter. Own receipt IDs only, not a note-kind exemption. */
import {randomUUID} from 'node:crypto';
import {appendEvent,readEvents} from '../kernel/journal';
import type {Provider} from './provider';
import {retrieveEpisodes} from './episode-retrieval';
export function retrieveJournalEpisodes(query:string,journal:string,gen:string,provider:Provider,signal?:AbortSignal,timeoutMs=30000,onReceipt?:(id:string)=>void) {
 const request=randomUUID(), own=new Set<string>();
 return retrieveEpisodes(query,()=>readEvents(journal).filter(e=>!own.has(e.id)),provider,signal,{
  timeoutMs,
  receipt:receipt=>{
   const event=appendEvent(journal,gen,{type:'note',kind:'episode.receipt.v1',data:{request,...receipt}});
   own.add(event.id);
   onReceipt?.(event.id);
  },
 });
}
