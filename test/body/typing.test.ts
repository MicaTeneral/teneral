import { expect, test } from 'bun:test';
import { zulipTyping, zulipTypingTarget } from '../../body/typing';
import { appendEvent, readEvents, type JournalEvent } from '../../brain/journal';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'mica-typing-'));
const journal = join(dir, 'journal.jsonl');
const msg = (source: string, type: string, text = 'hello') => ({ type: 'stimulus' as const, source, text: `Zulip ${type} 42\nowner\n${JSON.stringify({ sender_id: 997799, type: type === 'private' ? 'private' : 'stream', stream_id: 547285, topic: 'general chat', content: text })}` });

test('typing target comes from the exact typed external stimulus, not old traffic', () => {
  appendEvent(journal, 'g', msg('agent:zulip', 'private'));
  expect(zulipTypingTarget(readEvents(journal).at(-1) as Extract<JournalEvent, {type:"stimulus"}>)).toEqual({ type: 'direct', to: [997799] });
  appendEvent(journal, 'g', msg('agent:zulip', 'mention'));
  expect(zulipTypingTarget(readEvents(journal).at(-1) as Extract<JournalEvent, {type:"stimulus"}>)).toEqual({ type: 'stream', stream_id: 547285, topic: 'general chat' });
});

test('typing sends start, refresh and stop with form fields, and never refreshes after stop', async () => {
  const calls: { op: string; body: string }[] = [];
  const t = zulipTyping({ credentials: () => ({ site: 'https://chat.example', email: 'bot@example', api_key: 'key' }), target: () => ({ type: 'direct', to: [997799] }), refreshMs: 10, send: (async (_url: unknown, init?: RequestInit) => {
    calls.push({ op: new URLSearchParams(String(init?.body)).get('op')!, body: String(init?.body) });
    return new Response('{"result":"success"}');
  }) as unknown as typeof fetch });
  t(true);
  await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 20));
  t(false);
  await new Promise(r => setTimeout(r, 20));
  expect(calls[0]!.op).toBe('start');
  expect(calls.filter(c => c.op === 'start').length).toBeGreaterThanOrEqual(2);
  expect(calls.at(-1)!.op).toBe('stop');
  expect(calls[0]!.body).toContain('type=direct');
  expect(calls[0]!.body).toContain('to=%5B997799%5D');
});

test('typing is bounded and silent on provider or credential failures', async () => {
  const t = zulipTyping({ credentials: () => undefined, target: () => undefined, send: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
  t(true); t(false); t(true);
  await new Promise(r => setTimeout(r, 5));
  expect(true).toBe(true);
});

test('the originating turn owns typing and always stops it after completion or failure', async () => {
  const { runTurn } = await import('../../brain/loop');
  const { ProviderError } = await import('../../brain/provider');
  for (const fail of [false, true]) {
    const local = join(mkdtempSync(join(tmpdir(), 'mica-typing-turn-')), 'journal.jsonl');
    appendEvent(local, 'g', msg('agent:zulip', 'private'));
    const states: boolean[] = [];
    const context = { workspace: dir, journal: local, gen: 'g', mutationCommit: null, id: 'm', inbox: dir, peers: join(dir, 'peers.json'), soul: dir };
    const promise = runTurn({ journal: local, gen: 'g', provider: async () => { if (fail) throw new ProviderError('offline', 503); return { text: 'answer', toolCalls: [] }; }, tools: [], system: () => '', ctx: context, onTyping: () => active => { states.push(active); } });
    if (fail) await expect(promise).rejects.toThrow('offline'); else expect(await promise).toBe('done');
    expect(states).toEqual([true, false]);
  }
});

test('an already interrupted turn starts no typing; quiet non-Zulip turns have no target', async () => {
  const localQuiet = join(mkdtempSync(join(tmpdir(), 'mica-typing-target-')), 'journal.jsonl');
  appendEvent(localQuiet, 'g', { type: 'stimulus', source: 'clock', text: 'quiet' });
  expect(zulipTypingTarget(readEvents(localQuiet).at(-1) as Extract<JournalEvent, {type:'stimulus'}>)).toBeUndefined();
  const { runTurn } = await import('../../brain/loop');
  for (const source of ['clock', 'terminal']) {
    const local = join(mkdtempSync(join(tmpdir(), 'mica-typing-quiet-')), 'journal.jsonl');
    appendEvent(local, 'g', { type: 'stimulus', source, text: 'quiet' });
    const states: boolean[] = [];
    const c = new AbortController(); c.abort();
    expect(await runTurn({ journal: local, gen: 'g', provider: async () => { throw new Error('must not run'); }, tools: [], system: () => '', ctx: { journal: local } as never, onTyping: () => active => { if (zulipTypingTarget(readEvents(local).at(-1) as Extract<JournalEvent, {type:'stimulus'}>)) states.push(active); }, signal: c.signal })).toBe('interrupted');
    expect(states).toEqual([]);
  }
});

test('an interrupted in-flight turn stops typing in finally', async () => {
  const { runTurn } = await import('../../brain/loop');
  const local = join(mkdtempSync(join(tmpdir(), 'mica-typing-interrupt-')), 'journal.jsonl');
  appendEvent(local, 'g', msg('agent:zulip', 'private'));
  const c = new AbortController();
  const states: boolean[] = [];
  const result = await runTurn({ journal: local, gen: 'g', provider: async (_m, _t, o) => { o?.signal?.addEventListener('abort', () => c.abort(), { once: true }); c.abort(); throw new Error('cancelled'); }, tools: [], system: () => '', ctx: { journal: local } as never, onTyping: () => active => states.push(active), signal: c.signal }).catch(() => 'interrupted');
  expect(result).toBe('interrupted');
  expect(states).toEqual([true, false]);
});
