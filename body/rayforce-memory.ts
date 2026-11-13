// A read-only projection of the journal into Rayforce, so recall and episode lookup
// can query the database instead of re-deriving arrays from the whole journal each time.
// The journal stays the source of truth: this is a derived, rebuildable index, never the record.
//
// What is projected mirrors body/memory.ts memoryRecords exactly:
//   - lines of terminal/owner stimuli, and assistant replies in those turns, that pass the
//     tag/secret filter (the auto-derived "excerpts");
//   - curated memory.v1 notes (facts and episodes).
// Eligibility and corrections stay in TypeScript so a rollback or rebuild reads the journal and
// finds the same data an older body understands. Rayforce is only the query engine.
//
// Rows load as RFL source produced by a small RFL-encoder (toRfl), so no executable symbol reaches
// the wire from message text and the data survives the wire's UTF-8 round-trip as plain literals.

import type { JournalEvent } from '../kernel/journal';
import { narrationLine, secretLine, tagsOf } from './memory';
import type { RayData } from './rayforce-values';
import { queryRayforce } from './rayforce';

/** One projected row, matching what memoryRecords yields for a note/excerpt. */
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

const EXCERPT_MIN = 8;
const EXCERPT_MAX = 1000;

/** Which journal events produce projected rows: same rule as memoryRecords, so the two never disagree. */
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
        if (text.length < EXCERPT_MIN || text.length > EXCERPT_MAX || secretLine.test(text) || narrationLine.test(text)) return;
        const tags = tagsOf(text);
        if (!tags.length) return;
        rows.push({ id: `${e.id}:${i}`, text, tags, sources: [e.id], ts: e.ts, kind: e.type === 'assistant' ? 'assistant claim' : 'owner statement' });
      });
    }
    if (e.type !== 'note' || e.kind !== 'memory.v1' || !terminal) continue;
    const d = e.data as Partial<MemoryRow> | null;
    if (!d || typeof d.text !== 'string' || d.text.length > EXCERPT_MAX || secretLine.test(d.text)
      || !Array.isArray(d.tags) || d.tags.length > 12 || d.tags.some((t) => typeof t !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(t))
      || !Array.isArray(d.sources) || !d.sources.length || d.sources.length > 12 || d.sources.some((s) => typeof s !== 'string' || !sources.has(s))) continue;
    rows.push({ id: e.id, text: d.text, tags: d.tags, sources: d.sources, ts: e.ts, kind: d.episode ? 'curated episode claim' : 'curated claim', episode: d.episode as MemoryRow['episode'], supersedes: d.supersedes, deleted: d.deleted });
  }
  return { rows, sources };
}

/** Serialize closed data to RFL source. Only the encodeRayData subset is produced. */
function toRfl(v: RayData): string {
  if (v === null) return '0N';
  if (typeof v === 'boolean') return v ? '1b' : '0b';
  if (typeof v === 'bigint') return v.toString() + 'l';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toString(); // RFL prints floats plainly
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '(list ' + v.map(toRfl).join(' ') + ')';
  throw new Error('Unsupported RFL value');
}

/** A row as a flat vector of scalar columns (RFL table rows are vectors, not nested lists).
 * All columns are strings so the table is homogeneous and Rayforce's strict table builtin accepts it. */
function rowData(r: MemoryRow): RayData[] {
  return [r.id, r.text, r.tags.join(' '), r.sources.join(' '), r.ts, r.kind, r.episode ? [r.episode.decision, r.episode.reason, ...r.episode.openQuestions].join(' ') : '', r.supersedes ?? '', r.deleted ? '1' : '0'];
}

const COLUMNS = ['id', 'text', 'tags', 'sources', 'ts', 'kind', 'episode', 'supersedes', 'deleted'];

/** The RFL that re-creates the projection whole. Idempotent: re-running replaces the tables.
 * Rayforce's table builtin accepts at most 2 columns, so the 9 fields are sharded into 2-column
 * pair-tables keyed by row id, joined on id at query time. Columns are bare symbols; at least two
 * rows are required, so single-row tables are padded. */
const FIELD_TABLES: [string, keyof MemoryRow | 'deletedStr'][] = [
  ['text', 'text'], ['tags', 'tags'], ['sources', 'sources'], ['ts', 'ts'],
  ['kind', 'kind'], ['episode', 'episode'], ['supersedes', 'supersedes'], ['deleted', 'deletedStr'],
];
function buildRfl(excerpts: MemoryRow[], episodes: MemoryRow[]): string {
  const val = (r: MemoryRow, f: keyof MemoryRow | 'deletedStr'): string => {
    if (f === 'deletedStr') return JSON.stringify(r.deleted ? '1' : '0');
    const v = r[f];
    if (Array.isArray(v)) return JSON.stringify(v.join(' '));
    if (v === undefined || v === null) return JSON.stringify('');
    if (typeof v === 'object') return JSON.stringify([v.decision, v.reason, ...v.openQuestions].join(' '));
    return JSON.stringify(String(v));
  };
  const mk = (prefix: string, rs: MemoryRow[]): string =>
    FIELD_TABLES.map(([suffix, field]) => {
      const name = `${prefix}_${suffix}`;
      const body = rs.map((r) => '[' + JSON.stringify(r.id) + ' ' + val(r, field) + ']').join(' ');
      const padded = rs.length >= 2 ? body : body + (rs.length === 1 ? ' ["_" "_"]' : ' ["_" "_"] ["_" "_"]');
      return `(set ${name} (table [id ${suffix}] (list ${padded})))`;
    }).join(' ');
  const groups: [string, MemoryRow[]][] = [
    ['ex', excerpts], ['ep', episodes],
  ];
  return `(do ${groups.map(([p, rs]) => mk(p, rs)).join(' ')} 1)`;
}

/** How a caller learns the projection is up to date: the row count in the id spine of each shard group. */
export async function projectionWatermark(port: number): Promise<{ excerpts: number; episodes: number }> {
  const r = await queryRayforce(port, '(list (count ex_text) (count ep_text))');
  const counts = ('items' in r ? r.items : []).map((c) => ('value' in c ? Number(c.value) : 0));
  return { excerpts: counts[0] ?? 0, episodes: counts[1] ?? 0 };
}

/**
 * Rebuild the projection from the journal. Idempotent: the tables are re-set whole, so the
 * projection always equals what the journal yields right now. Returns the row counts.
 */
export async function rebuildProjection(port: number, events: JournalEvent[]): Promise<{ excerpts: number; episodes: number }> {
  const { rows } = projectable(events);
  await queryRayforce(port, buildRfl(rows.filter((r) => r.kind !== 'curated episode claim'), rows.filter((r) => r.kind === 'curated episode claim')));
  return projectionWatermark(port);
}
