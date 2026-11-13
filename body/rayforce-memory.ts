// Read-only, rebuildable Rayforce projections. The journal is the only source of truth:
// Rayforce supplies candidate ids and TypeScript renders evidence from the original events.

import { createHash } from 'node:crypto';
import type { JournalEvent } from '../brain/journal';
import { narrationLine, secretLine, tagsOf } from './memory';
import { queryRayforce } from './rayforce';

export interface MemoryRow {
  id: string;
  text: string;
  tags: string[];
  sources: string[];
  ts: string;
  kind: 'assistant claim' | 'owner statement' | 'curated claim' | 'curated episode claim';
  episode?: { decision: string; reason: string; openQuestions: string[] };
  supersedes?: string;
  deleted?: boolean;
}

/** Keep automatic-memory ingestion eligibility identical to memoryRecords. */
export function projectable(events: JournalEvent[]): { rows: MemoryRow[]; sources: Set<string> } {
  const rows: MemoryRow[] = [];
  const sources = new Set<string>();
  let terminal = false;
  for (const e of events) {
    if (e.type === 'stimulus') terminal = e.source === 'terminal';
    if (e.type === 'assistant') sources.add(e.id);
    if ((e.type === 'stimulus' && terminal) || (e.type === 'assistant' && terminal)) {
      sources.add(e.id);
      if (typeof e.text !== 'string') continue;
      e.text.split('\n').forEach((text, i) => {
        if (text.length < 8 || text.length > 1000 || secretLine.test(text) || narrationLine.test(text)) return;
        const tags = tagsOf(text);
        if (!tags.length) return;
        rows.push({ id: `${e.id}:${i}`, text, tags, sources: [e.id], ts: e.ts, kind: e.type === 'assistant' ? 'assistant claim' : 'owner statement' });
      });
    }
    if (e.type !== 'note' || e.kind !== 'memory.v1' || !terminal) continue;
    const d = e.data as Partial<MemoryRow> | null;
    if (!d || typeof d.text !== 'string' || d.text.length > 1000 || secretLine.test(d.text)
      || !Array.isArray(d.tags) || d.tags.length > 12 || d.tags.some((t) => typeof t !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(t))
      || !Array.isArray(d.sources) || !d.sources.length || d.sources.length > 12 || d.sources.some((s) => typeof s !== 'string' || !sources.has(s))) continue;
    rows.push({ id: e.id, text: d.text, tags: d.tags, sources: d.sources, ts: e.ts, kind: d.episode ? 'curated episode claim' : 'curated claim', episode: d.episode as MemoryRow['episode'], supersedes: d.supersedes, deleted: d.deleted });
  }
  return { rows, sources };
}

/** Every source recall may search, not only tag-bearing automatic-memory lines. */
export function recallProjection(events: JournalEvent[]): { id: string; search: string }[] {
  const rows: { id: string; search: string }[] = [];
  for (const e of events) {
    if (e.type !== 'assistant' && !(e.type === 'stimulus' && e.source === 'terminal')) continue;
    if (typeof e.text !== 'string') continue;
    const lines = e.text.split('\n').filter(line => line.length <= 1000 && !secretLine.test(line));
    rows.push({ id: e.id, search: lines.join('\n').toLocaleLowerCase() });
  }
  return rows;
}

/** A correction can replace text without changing counts, so counts alone are not freshness. */
export function projectionFingerprint(events: JournalEvent[]): string {
  return createHash('sha256').update(JSON.stringify({ memory: projectable(events).rows, recall: recallProjection(events) })).digest('hex');
}

const FIELDS = ['text', 'tags', 'sources', 'ts', 'kind', 'episode', 'supersedes', 'deleted'] as const;
type Field = (typeof FIELDS)[number];
function value(row: MemoryRow, field: Field): string {
  if (field === 'deleted') return row.deleted ? '1' : '0';
  const v = row[field];
  if (Array.isArray(v)) return v.join(' ');
  if (typeof v === 'object' && v !== null) return [v.decision, v.reason, ...v.openQuestions].join(' ');
  return v === undefined ? '' : String(v);
}
/** ray_table_fn takes one vector per column. Use typed STR vectors: a generic
 * `list` call is limited to 64 arguments by the evaluator. */
function table(name: string, field: string, rows: { id: string }[], text: (row: any) => string): string {
  const column = (values: string[]) => `[${values.map(v => JSON.stringify(v)).join(' ')}]`;
  return `(set ${name} (table [id ${field}] (list ${column(rows.map(r => r.id))} ${column(rows.map(text))})))`;
}
function buildRfl(events: JournalEvent[]): string {
  const rows = projectable(events).rows;
  const statements: string[] = [];
  for (const [prefix, group] of [['ex', rows.filter(r => r.kind !== 'curated episode claim')], ['ep', rows.filter(r => r.kind === 'curated episode claim')]] as const) {
    for (const field of FIELDS) statements.push(table(`${prefix}_${field}`, field, group, r => value(r, field)));
  }
  // Case-fold in JavaScript with the same operation as the journal renderer.
  statements.push(table('rc_search', 'search', recallProjection(events), r => r.search));
  return `(do ${statements.join(' ')} 1)`;
}

export interface ProjectionWatermark { excerpts: number; episodes: number; recall: number }
export async function projectionWatermark(port: number): Promise<ProjectionWatermark> {
  const r = await queryRayforce(port, '(list (count ex_text) (count ep_text) (count rc_search))');
  if (!('items' in r) || r.items.length !== 3) throw Error('Invalid Rayforce memory watermark');
  const counts = r.items.map(c => 'value' in c ? Number(c.value) : NaN);
  if (!counts.every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid Rayforce memory counts');
  return { excerpts: counts[0]!, episodes: counts[1]!, recall: counts[2]! };
}

/** Replace the whole derived snapshot and verify exact cardinalities before exposing the port. */
export async function rebuildProjection(port: number, events: JournalEvent[]): Promise<ProjectionWatermark> {
  const rows = projectable(events).rows;
  const expected = { excerpts: rows.filter(r => r.kind !== 'curated episode claim').length, episodes: rows.filter(r => r.kind === 'curated episode claim').length, recall: recallProjection(events).length };
  await queryRayforce(port, buildRfl(events));
  const actual = await projectionWatermark(port);
  if (actual.excerpts !== expected.excerpts || actual.episodes !== expected.episodes || actual.recall !== expected.recall) {
    throw Error(`Rayforce memory watermark mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return actual;
}
