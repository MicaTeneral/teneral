/** Experimental derived index. Never authoritative; not wired into context. */
import { createHash } from 'node:crypto';
export type EpisodeCard = { id:string; title:string; summary:string; sources:string[] };
export type EpisodeSource = { id:string; text:string };
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
type Correction = {source:string; affects:string};
function graphSnapshot(edges:Correction[]) {
  if(edges.length>128) throw Error("Correction edge budget exceeded");
  return hash(JSON.stringify([...new Set(edges.map(e=>JSON.stringify([e.source,e.affects])))].sort()));
}
export function bindCards(cards:EpisodeCard[], sources:EpisodeSource[], corrections:Correction[] = []) {
  const graph=graphSnapshot(corrections);
  const byId=new Map(sources.map(s=>[s.id,s.text]));
  if(byId.size!==sources.length) throw Error('Duplicate source');
  const ids=new Set<string>();
  return cards.map(card=>{
    if(!card.id||ids.has(card.id)||!card.title||!card.summary||!card.sources.length
      ||new Set(card.sources).size!==card.sources.length||card.sources.some(id=>!byId.has(id))) throw Error('Invalid card provenance');
    ids.add(card.id);
    return {graph,card:structuredClone(card),dependencies:card.sources.map(id=>({id,hash:hash(byId.get(id)!)}))};
  });
}
export function renderMap(bound:ReturnType<typeof bindCards>, current:EpisodeSource[], cap:number, corrections:{source:string; affects:string}[] = []) {
  if(!Number.isSafeInteger(cap)||cap<0) throw Error('Invalid cap');
  const byId=new Map(current.map(s=>[s.id,s.text]));
  if(byId.size!==current.length) throw Error('Duplicate source');
  const positions=new Map(current.map((s,i)=>[s.id,i]));
  const edges=new Set<string>();
  for(const c of corrections){
    if(!positions.has(c.source)||!positions.has(c.affects)||positions.get(c.source)!<=positions.get(c.affects)!) throw Error("Correction must reference a prior current source");
    const key=JSON.stringify([c.source,c.affects]);
    if(edges.has(key)) throw Error("Duplicate correction");
    edges.add(key);
  }
  const graph=graphSnapshot(corrections);
  const cards:EpisodeCard[]=[],stale:string[]=[],omitted:string[]=[];
  for(const item of bound){
    if(item.graph!==graph){stale.push(item.card.id);continue;}
    const required=new Set(item.card.sources);
    let changed=true;
    while(changed){changed=false;for(const c of corrections){
      if(required.has(c.affects)&&!required.has(c.source)){required.add(c.source);changed=true;}
    }}
    if([...required].some(id=>!item.card.sources.includes(id))){stale.push(item.card.id);continue;}
    if(item.dependencies.some(d=>!byId.has(d.id)||hash(byId.get(d.id)!)!==d.hash)){stale.push(item.card.id);continue;}
    if(JSON.stringify([...cards,item.card]).length>cap){omitted.push(item.card.id);continue;}
    cards.push(structuredClone(item.card));
  }
  const covered=new Set(cards.flatMap(card=>card.sources));
  const uncoveredSourceIds=current.filter(source=>!covered.has(source.id)).map(source=>source.id);
  return {cards,stale,omitted,cardCoverage:stale.length||omitted.length?'partial':'complete',
    sourceCoverage:uncoveredSourceIds.length?'partial':'complete',uncoveredSourceIds};
}

/** Explicit whole-source replacement only. Caller must not infer these links
 * from prose or use them for a correction of only one field of a source. */
export function eligibleSources(sources:(EpisodeSource & {supersedes?:string})[]):EpisodeSource[] {
  const seen=new Set<string>(), retired=new Set<string>();
  for(const source of sources){
    if(!source.id||seen.has(source.id)) throw Error('Invalid source ID');
    if(source.supersedes!==undefined){
      if(!seen.has(source.supersedes)||retired.has(source.supersedes)) throw Error('Supersession must name an active prior source');
      retired.add(source.supersedes);
    }
    seen.add(source.id);
  }
  return sources.filter(s=>!retired.has(s.id)).map(({id,text})=>({id,text}));
}
