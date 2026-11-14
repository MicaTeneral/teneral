import type { JournalEvent } from './journal';
import { episodes } from './episodes';
import { BACK_KIND, pinned, standing } from './owned';
import { remembered, type Memory, type Merge } from './remembered';
import { known } from './known';
import type { SemanticCard } from './semantic';

export interface SemanticMap {
  cards: SemanticCard[];
  levels: number[];
  /** Every remembered episode is represented exactly once. The live tail is outside this map. */
  complete: boolean;
  episodes: number;
  uncovered: number;
  chars: number;
}

/**
 * A compact map of the same remembered spans the logbook uses. A wider merge is used only when
 * its whole range is available and contains no pinned or taken-back conversation. It never hides
 * a gap: unremembered episodes make complete=false and have no selectable card.
 */
export function semanticMap(history: JournalEvent[]): SemanticMap {
  const events = standing(history), all = remembered(events), kept = episodes(events, all.spans).filter((episode) => episode.why === 'kept');
  const active = new Set([...all.memories.values(), ...all.merges].map((memory) => memory.id));
  const at = new Map(events.map((event, i) => [event.id, i]));
  const held = pinned(events);
  const cards: SemanticCard[] = [], levels: number[] = [];
  let uncovered = 0;
  const taken: number[] = [];
  for (const event of events) {
    if (event.type !== 'note' || event.kind !== BACK_KIND) continue;
    const target = (event.data as { to?: unknown }).to, from = at.get(target as string), to = at.get(event.id);
    if (from !== undefined && to !== undefined && to >= from) taken.push(from, to);
  }
  const isTaken = (from: number, to: number): boolean => {
    // Span `to` is an inclusive event id; episode `to` is exclusive. A pinned stretch stays atomic.
    for (let i = 0; i < taken.length; i += 2) if (from < taken[i + 1]! && to - 1 >= taken[i]!) return true;
    return events.slice(from, to).some((event) => held.has(event.id));
  };
  const add = (memory: Memory | Merge): void => {
    if (!active.has(memory.id) || memory.outcome === 'quiet') return;
    const level = 'level' in memory ? memory.level : 1;
    cards.push({ id: memory.id, kind: 'memory', level, text: `${memory.title}\n${memory.text}`, from: memory.from, to: memory.to });
    levels.push(level);
  };
  for (let i = 0; i < kept.length;) {
    const episode = kept[i]!;
    let chosen: Memory | Merge | null = null, reach = i;
    const candidates: (Memory | Merge)[] = [...all.merges.filter((merge) => merge.from === episode.first && merge.to !== episode.last)];
    const single = all.memories.get(episode.first);
    if (single !== undefined) candidates.push(single);
    for (const memory of candidates) {
      const to = at.get(memory.to);
      if (to === undefined || to < episode.from) continue;
      const toEpisode = kept.findIndex((candidate) => candidate.to === to + 1);
      if (toEpisode < 0 || toEpisode < i || toEpisode >= kept.length || isTaken(episode.from, to + 1)) continue;
      const level = 'level' in memory ? memory.level : 1;
      const chosenLevel = chosen !== null && 'level' in chosen ? chosen.level : 1;
      if (toEpisode > reach || chosen === null || (toEpisode === reach && level > chosenLevel)) { chosen = memory; reach = toEpisode; }
    }
    if (chosen === null) uncovered += 1;
    else add(chosen);
    i = reach + 1;
  }
  // Current facts are independent of episode coverage; provenance remains the fact's own id.
  for (const fact of known(events).facts) cards.push({ id: fact.id, kind: 'fact', level: 0, text: fact.text, from: null, to: null });
  return { cards, levels, complete: uncovered === 0, episodes: kept.length, uncovered, chars: JSON.stringify(cards).length + (uncovered > 0 ? JSON.stringify({ uncovered }).length : 0) };
}
