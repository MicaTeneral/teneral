import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { appendEvent, readEvents, type JournalEvent } from '../../brain/journal';
import { openPast, type Past } from '../../brain/past';
import { bySubstring, examine, questionsOf, type Question } from '../../brain/exam';
import { EPISODE_KIND } from '../../brain/remembered';

/**
 * Frozen questions and answer-memory ids from the first independently authored
 * paraphrase evaluation. It is a validation fixture, never a parameter-tuning set.
 * The caller's journal must still contain those ids.
 */
export function paraphraseQuestions(file: string): Question[] {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof value !== 'object' || value === null) throw new Error('Invalid paraphrase fixture');
  const schema = (value as { schema?: unknown }).schema;
  if (schema !== 'memory.paraphrase.eval.v1') throw new Error('Unknown paraphrase fixture');
  const out: Question[] = [];
  for (const item of (value as { questions?: unknown }).questions as unknown[]) {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid paraphrase question');
    const q = item as { question?: unknown; events?: unknown };
    if (typeof q.question !== 'string' || !Array.isArray(q.events) || !q.events.length || !q.events.every((id) => typeof id === 'string')) throw new Error('Invalid paraphrase answer');
    out.push({ question: q.question, events: q.events as string[] });
  }
  return out;
}

/** Evaluate the same frozen questions over exact memories or their original spans. */
export function paraphraseScore(past: Past, events: JournalEvent[], questions: Question[], sourceSpans = false) {
  const memory = new Map(events.flatMap((event) => event.type === 'note' && event.kind === EPISODE_KIND ? [[event.id, event]] : []));
  const expanded = questions.map((q) => {
    if (!sourceSpans) return q;
    const ids = q.events.flatMap((id) => {
      const event = memory.get(id);
      if (event?.type !== 'note') throw new Error('Fixture memory is missing');
      const data = event.data as { from?: unknown; to?: unknown };
      if (typeof data.from !== 'string' || typeof data.to !== 'string') throw new Error('Fixture memory has no span');
      const from = events.findIndex((e) => e.id === data.from), to = events.findIndex((e) => e.id === data.to);
      if (from < 0 || to < from) throw new Error('Fixture span is missing');
      return events.slice(from, to + 1).map((e) => e.id);
    });
    return { ...q, events: ids };
  });
  // The map above is deliberately independent of recall's index and ranking.
  return examine((question, limit) => past.find(question, { limit }).map((hit) => hit.event.id), expanded);
}

test('the frozen paraphrase fixture is well formed and unchanged', async () => {
  const fixture = join(import.meta.dir, 'paraphrase-eval-v1.json');
  const questions = paraphraseQuestions(fixture);
  expect(questions).toHaveLength(12);
  expect(new Set(questions.map((q) => q.question)).size).toBe(12);
  expect(new Set(questions.flatMap((q) => q.events)).size).toBe(12);
  expect(createHash('sha256').update(await Bun.file(fixture).bytes()).digest('hex')).toBe('3d4c453e4a35a9418fa6bb59a6bc08ca671af4c38364c2f726cfc4b00e7ac327');
});

test('the offline runner measures current recall and substring without tuning', () => {
  const root = mkdtempSync(join(tmpdir(), 'mica-paraphrase-'));
  try {
    const journal = join(root, 'journal.jsonl');
    const said = appendEvent(journal, 'test', { type: 'stimulus', source: 'terminal', text: 'The cedar rehearsal stayed at the eastern court.' });
    appendEvent(journal, 'test', { type: 'assistant', text: 'I recorded the rehearsal result.', toolCalls: [] });
    appendEvent(journal, 'test', { type: 'note', kind: EPISODE_KIND, data: { from: said.id, to: said.id, start: said.ts, end: said.ts, title: 'Rehearsal', text: 'A rehearsal remained at the eastern court.', outcome: 'done' } });
    appendEvent(journal, 'test', { type: 'stimulus', source: 'terminal', text: 'A later question.' });
    const events = readEvents(journal), memory = events.find((e) => e.type === 'note' && e.kind === EPISODE_KIND)!;
    const questions: Question[] = [{ question: 'Which activity was held at the court?', events: [memory.id] }];
    const past = openPast(journal, null);
    try {
      expect(paraphraseScore(past, events, questions).passed).toBe(1);
      expect(paraphraseScore(past, events, questions, true).passed).toBe(1);
      expect(examine(bySubstring(events), [{ question: 'court', events: [said.id] }]).passed).toBe(1);
      // This also verifies the standard file parser rejects unrelated JSON.
      expect(questionsOf(events)).toEqual([]);
    } finally { past.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
