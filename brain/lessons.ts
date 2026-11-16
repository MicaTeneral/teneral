import type { JournalEvent } from './journal';
import { episodes } from './episodes';

// A lesson is a hypothesis from one conversation, not a new owner rule. Only a later
// conversation, running a different generation, can make it permanent. The journal remains the
// store; expiry and the single switch affect both reading and writing.

export const LESSON_KIND = 'memory.lesson.v1';
export const LESSON_ACCEPT_KIND = 'memory.lesson.accept.v1';
export const LESSON_CHECK_KIND = 'memory.lesson.check.v1';
export const LESSON_LIMIT = 64;
export const PROPOSED_DAYS = 7;
export const ACCEPTED_DAYS = 90;
const CONTEXT_CHARS = 4000;

export interface Lesson {
  id: string;
  mark: string;
  text: string;
  topic: string;
  evidence: string[];
  /** First event of the episode in which it was proposed. */
  conversation: string;
  expected?: string;
  version: number;
  proposedGen: string;
  at: string;
  expiresAt: string;
  accepted?: { id: string; at: string; gen: string; conversation: string };
  checks: { id: string; at: string; outcome: 'observed' | 'not_observed'; evidence: string[] }[];
}

const validText = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const validIds = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= 80);
const future = (at: string, days: number): string => new Date(Date.parse(at) + days * 86_400_000).toISOString();
export const lessonExpiry = future;

/** Current lesson state. Malformed or stale-version notes are ignored, as old journal notes must be. */
export function lessons(events: JournalEvent[], now = Date.parse(events.at(-1)?.ts ?? '') || Date.now()): Lesson[] {
  const byEvent = new Map(events.map((e, i) => [e.id, i]));
  const episodeAt = new Map<string, string>();
  for (const ep of episodes(events)) for (let i = ep.from; i < ep.to; i++) episodeAt.set(events[i]!.id, ep.id);
  const held = new Map<string, Lesson>();
  for (const e of events) {
    if (e.type !== 'note' || typeof e.data !== 'object' || e.data === null) continue;
    const d = e.data as Record<string, unknown>;
    if (e.kind === LESSON_KIND) {
      if (!validText(d.text) || !validText(d.topic, 120) || !validIds(d.evidence) || typeof d.conversation !== 'string' || d.version !== 1) continue;
      const atMs = Date.parse(e.ts);
      if (!Number.isFinite(atMs) || atMs >= now + 1000) continue;
      const evidence = d.evidence as string[];
      const conversation = episodeAt.get(d.conversation);
      // The record itself belongs to the same conversation as its evidence; it must not be
      // silently folded into a later episode merely because no new stimulus intervened.
      if (conversation === undefined || d.conversation !== conversation || episodeAt.get(e.id) !== conversation || evidence.some(id => episodeAt.get(id) !== conversation)) continue;
      held.set(e.id, {
        id: e.id, mark: `L${e.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
        text: (d.text as string).trim(), topic: (d.topic as string).trim(), evidence,
        conversation, ...(validText(d.expected, 500) ? { expected: (d.expected as string).trim() } : {}),
        version: 1, proposedGen: e.gen, at: e.ts, expiresAt: future(e.ts, PROPOSED_DAYS), checks: [],
      });
    } else if (e.kind === LESSON_ACCEPT_KIND && typeof d.lesson === 'string') {
      const lesson = held.get(d.lesson);
      if (!lesson || lesson.accepted || d.basedOn !== lesson.version || e.gen === lesson.proposedGen) continue;
      if (e.gen === lesson.proposedGen) continue;
      const conversation = episodeAt.get(e.id);
      if (conversation === undefined || conversation === lesson.conversation) continue;
      lesson.accepted = { id: e.id, at: e.ts, gen: e.gen, conversation };
      lesson.expiresAt = future(e.ts, ACCEPTED_DAYS);
      // Acceptance is another reader's act, not a content edit by the proposer.
      lesson.version = 1;
    } else if (e.kind === LESSON_CHECK_KIND && typeof d.lesson === 'string') {
      const lesson = held.get(d.lesson);
      if (!lesson?.accepted || !lesson.expected || d.basedOn !== lesson.version || (d.outcome !== 'observed' && d.outcome !== 'not_observed') || !validIds(d.evidence)) continue;
      const evidence = d.evidence as string[];
      if (evidence.some(id => (byEvent.get(id) ?? -1) < (byEvent.get(lesson.accepted!.id) ?? events.length))) continue;
      lesson.checks.push({ id: e.id, at: e.ts, outcome: d.outcome, evidence });
      lesson.version += 1;
    }
  }
  return [...held.values()].filter(l => Date.parse(l.expiresAt) > now);
}

const words = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9_./-]{4,}/g) ?? []);

/** Relevant accepted lessons, plus proposals local to the conversation now being lived. */
export function lessonText(events: JournalEvent[], enabled = process.env.TENERAL_LESSONS !== '0', mark = '[memory]'): string | null {
  if (!enabled) return null;
  const all = lessons(events);
  if (all.length === 0) return null;
  const current = episodes(events).at(-1)?.id;
  const recent = events.slice(-30).filter(e => e.type === 'stimulus' || e.type === 'tool.intent').map(e => {
    const r = e as { text?: unknown; name?: unknown; args?: unknown };
    return `${typeof r.text === 'string' ? r.text : ''} ${typeof r.name === 'string' ? r.name : ''} ${r.args === undefined ? '' : JSON.stringify(r.args)}`;
  }).join(' ');
  const context = words(recent);
  const relevant = all.filter(l => l.accepted && [...words(`${l.topic} ${l.text}`)].some(w => context.has(w)))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
  const local = all.filter(l => !l.accepted && l.conversation === current).slice(-3);
  const lines: string[] = [];
  for (const l of [...local, ...relevant]) {
    const status = l.accepted ? `accepted; v${l.version}; expires ${l.expiresAt.slice(0, 10)}` : `local to ${l.conversation}; separate acceptance required`;
    const expected = l.expected ? ` Expected effect: ${l.expected} [${l.checks.length === 0 ? 'verification due' : `checked ${l.checks.at(-1)!.at.slice(0, 10)}: ${l.checks.at(-1)!.outcome}`}]` : '';
    lines.push(`${l.mark} [${status}] ${l.topic}: ${l.text} Evidence: ${l.evidence.join(', ')}.${expected}`);
  }
  if (lines.length === 0) return null;
  let text = `${mark} Lessons are evidence-linked working hypotheses, not owner rules:\n${lines.join('\n')}`;
  while (text.length > CONTEXT_CHARS && lines.length > 1) { lines.shift(); text = `${mark} Lessons are evidence-linked working hypotheses, not owner rules:\n${lines.join('\n')}`; }
  return text.slice(0, CONTEXT_CHARS);
}
