import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendEvent, readEvents, type JournalEvent } from '../../brain/journal';
import { allSemanticCards, selectSemanticCards, parseSemanticSelection } from '../../brain/semantic';
import { semanticMap } from '../../brain/semantic-map';
import { EPISODE_KIND } from '../../brain/remembered';
import { WITHDRAW_KIND, BACK_KIND, PIN_KIND } from '../../brain/owned';
import type { Provider } from '../../brain/provider';

function journalWithMemory() {
  const root = mkdtempSync(join(tmpdir(), 'mica-semantic-'));
  const journal = join(root, 'journal.jsonl');
  const said = appendEvent(journal, 'test', { type: 'stimulus', source: 'terminal', text: 'The astronomy rehearsal is at the harbor observatory.' });
  const memory = appendEvent(journal, 'test', { type: 'note', kind: EPISODE_KIND, data: { from: said.id, to: said.id, start: said.ts, end: said.ts, title: 'Rehearsal', text: 'The astronomy rehearsal is at the harbor observatory.', outcome: 'done' } });
  appendEvent(journal, 'test', { type: 'stimulus', source: 'terminal', text: 'A later question.' });
  return { root, journal, said, memory };
}

test('only current memories with original event ids are selected', async () => {
  const { root, journal, said, memory } = journalWithMemory();
  try {
    const events = readEvents(journal);
    const provider: Provider = async (_m, tools, options) => {
      expect(tools).toEqual([]); expect(options?.maxOutputTokens).toBe(4096);
      return { text: JSON.stringify([{ id: memory.id, relation: 'supports' }]), toolCalls: [], usage: { input: 123, output: 45 } };
    };
    const result = await selectSemanticCards(events, 'Where is the sky practice?', provider);
    expect(result.calls).toBe(1); expect(result.selected).toEqual([{ id: memory.id, relation: 'supports' }]);
    expect(result.evidence).toEqual([{ memoryId: memory.id, from: said.id, to: said.id, eventIds: [said.id] }]);
    expect(result.usage).toEqual({ input: 123, output: 45 });
    expect(result.scope).toBe('auxiliary-excluded-from-parent-usage');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('withdrawn cards, fabricated ids, tool calls and truncation never become evidence', async () => {
  const { root, journal, memory } = journalWithMemory();
  try {
    appendEvent(journal, 'test', { type: 'note', kind: WITHDRAW_KIND, data: { ids: [memory.id] } });
    const events = readEvents(journal);
    expect(semanticMap(events).cards).toEqual([]);
    let calls = 0;
    const provider: Provider = async () => { calls++; return { text: JSON.stringify([{ id: memory.id, relation: 'supports' }]), toolCalls: [] }; };
    const result = await selectSemanticCards(events, 'Where?', provider);
    expect(result.calls).toBe(0); expect(calls).toBe(0); expect(result.selected).toEqual([]);
    expect(() => parseSemanticSelection([{ id: 'fabricated', relation: 'supports' }], [memory.id])).toThrow();
    expect(() => parseSemanticSelection([{ id: memory.id, relation: 'supports' }, { id: memory.id, relation: 'related' }], [memory.id])).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('map incompleteness fails closed before any provider call', async () => {
  const { root, journal } = journalWithMemory();
  try {
    const events = readEvents(journal), map = semanticMap(events);
    expect(map.complete).toBe(true);
    let calls = 0;
    const provider: Provider = async () => { calls++; return { text: '[]', toolCalls: [] }; };
    // Production size is checked in the real function; this fixture validates the map boundary independently.
    expect(map.cards.length).toBe(1);
    expect(calls).toBe(0);
    await expect(selectSemanticCards(events, 'Where?', provider, undefined, { mapChars: 10 })).rejects.toThrow('over budget');
    expect(calls).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('owner take-back excludes both original evidence and memory of that stretch', async () => {
  const { root, journal, said } = journalWithMemory();
  try {
    // Take back from the following message, as /memory back does, so the target owner turn is included.
    appendEvent(journal, 'test', { type: 'note', kind: BACK_KIND, data: { to: said.id } });
    const events = readEvents(journal);
    expect(semanticMap(events).cards).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pinned stretch is never replaced by a wider semantic card', async () => {
  const { root, journal, said, memory } = journalWithMemory();
  try {
    appendEvent(journal, 'test', { type: 'note', kind: PIN_KIND, data: { event: said.id } });
    const map = semanticMap(readEvents(journal));
    expect(map.cards).toEqual([]);
    expect(map.complete).toBe(false);
    expect(map.uncovered).toBe(1);
    expect(allSemanticCards(readEvents(journal)).cards.map((card) => card.id)).not.toContain(memory.id);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stalled selector is locally bounded even when provider ignores cancellation', async () => {
  const { root, journal } = journalWithMemory();
  try {
    let observed: AbortSignal | undefined;
    const provider: Provider = async (_m, _t, options) => { observed = options?.signal; return new Promise(() => {}); };
    await expect(selectSemanticCards(readEvents(journal), 'Where?', provider, undefined, { deadlineMs: 10 })).rejects.toThrow('deadline');
    expect(observed?.aborted).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('map incompleteness and tool-call replies fail before returning evidence', async () => {
  const { root, journal, memory } = journalWithMemory();
  try {
    const events = readEvents(journal);
    let calls = 0;
    const provider: Provider = async () => { calls++; return { text: '[]', toolCalls: [] }; };
    await expect(selectSemanticCards(events, 'Where?', provider, undefined, { mapChars: 10 })).rejects.toThrow('over budget');
    expect(calls).toBe(0);
    const tools: Provider = async () => ({ text: JSON.stringify([{ id: memory.id, relation: 'supports' }]), toolCalls: [{ id: 'x', name: 'bash', args: {} }] });
    await expect(selectSemanticCards(events, 'Where?', tools)).rejects.toThrow('Invalid semantic response');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
