/** Experimental replay only: no writer or runtime context wiring. */
import type {JournalEvent} from '../kernel/journal';
export function correctionEdges(events:JournalEvent[], limit=128) {
  if(!Number.isSafeInteger(limit)||limit<0||limit>128) throw Error('Invalid edge limit');
  const eligible=new Map<string,number>();
  const active=new Map<string,{source:string;affects:string}>();
  let terminal=false;
  for(const [index,e] of events.entries()){
    if(e.type==='stimulus') terminal=e.source==='terminal';
    // Match explicit curation eligibility, not automatic ingestion eligibility.
    if(e.type==='assistant'||(e.type==='stimulus'&&terminal)) eligible.set(e.id,index);
    if(e.type!=='note'||e.kind!=='episode.correction.v1'||!terminal) continue;
    const d=e.data;
    if(!d||typeof d!=='object'||Array.isArray(d)) continue;
    const o=d as Record<string,unknown>;
    if(o.op==='withdraw'&&Object.keys(o).sort().join(',')==='op,target'&&typeof o.target==='string') {
      active.delete(o.target); continue;
    }
    if(o.op!=='add'||Object.keys(o).sort().join(',')!=='affects,op,source'
      ||typeof o.source!=='string'||typeof o.affects!=='string'
      ||!eligible.has(o.source)||!eligible.has(o.affects)
      ||eligible.get(o.affects)!>=eligible.get(o.source)!) continue;
    if(active.has(e.id)) continue;
    if(active.size>=limit) throw Error('Correction edge budget exceeded');
    active.set(e.id,{source:o.source,affects:o.affects});
  }
  return [...new Map([...active.values()].map(edge=>[JSON.stringify([edge.source,edge.affects]),edge])).values()];
}
