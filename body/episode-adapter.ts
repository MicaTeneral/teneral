/** Experimental journal-derived view, not a new store or runtime injection. */
import type {JournalEvent} from '../kernel/journal';
import {memoryRecords} from './memory';
import type {EpisodeCard} from './episode-map';
export function journalEpisodeCards(events:JournalEvent[]):EpisodeCard[] {
  const records=memoryRecords(events).filter(record=>record.episode!==undefined);
  if(records.length>MAX_CARDS) throw Error("Episode card budget exceeded");
  const cards=records.map(record=>({
    id:record.id,title:record.text, sources:[...record.sources],
    summary:JSON.stringify({claim:record.text,...record.episode}),
  }));
  boundedSnapshot(cards);
  return cards;
}

import {bindCards,type EpisodeSource} from './episode-map';
import {correctionEdges} from './episode-corrections';
/** Build-time snapshot for existing synchronous curated notes. Never rebind old
 * cards under today's graph. Future async builders need explicit input boundary. */
export function journalBoundEpisodes(events:JournalEvent[]) {
  const cards=journalEpisodeCards(events);
  return cards.flatMap(card=>{
    const end=events.findIndex(event=>event.id===card.id);
    if(end<0) return [];
    const prefix=events.slice(0,end+1);
    const sources:EpisodeSource[]=prefix.flatMap(event=>
      (event.type==='stimulus'||event.type==='assistant')&&card.sources.includes(event.id)
        ?[{id:event.id,text:event.text}]:[]);
    return bindCards([card],sources,correctionEdges(prefix));
  });
}

import {createHash} from 'node:crypto';
const MAX_CHARS=200000, MAX_CARDS=64;
function boundedSnapshot(value:unknown) {
  const text=JSON.stringify(value);
  if(text.length>MAX_CHARS) throw Error('Episode character budget exceeded');
  return createHash('sha256').update(text).digest('hex');
}
/** Retrieval projection token, not a guard for arbitrary episode creation. Local only;
 * append must follow validation synchronously, without another await. */
export function episodeRetrievalBoundary(events:JournalEvent[]) {
  if(!events.some(e=>e.type==='stimulus')) throw Error('Episode requires a query turn');
  const bound=journalBoundEpisodes(events);
  const ids=new Set(bound.flatMap(item=>item.card.sources));
  const sources=events.filter(event=>ids.has(event.id));
  const corrections=events.filter(event=>event.type==='note'&&event.kind==='episode.correction.v1');
  const audience=events.findLast(event=>event.type==='stimulus');
  return boundedSnapshot({bound,sources,corrections,graph:correctionEdges(events),audience});
}
export function episodeRetrievalUnchanged(boundary:string,events:JournalEvent[]):boolean {
  return episodeRetrievalBoundary(events)===boundary;
}
