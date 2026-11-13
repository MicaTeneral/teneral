import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { parseOrgans } from '../../immune/organs';
import { appendEvent, readEvents, type JournalEvent } from '../../brain/journal';
import { rebuildProjection, projectionWatermark } from '../../body/rayforce-memory';
import { withRayforceMemory, stopRayforceMemory } from '../../body/rayforce-server';
import { recallJournal, recallRayforce } from '../../body/recall';

const ev = (id: string, type: 'assistant' | 'stimulus', text: string): JournalEvent => ({
  v: 1, id, ts: '2026-01-01T00:00:00Z', gen: 'g',
  ...(type === 'assistant' ? { type, text, toolCalls: [] } : { type, source: 'terminal', text }),
} as JournalEvent);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ev(`owner-${i}`, 'stimulus', `email row${i}@example.invalid`));
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test('real projection handles empty/small/65+ rows and recall is byte-identical to journal search', async () => {
  expect(() => parseOrgans(readFileSync('brain/engines.json', 'utf8'))).not.toThrow();
  const organs = process.env.TENERAL_ORGANS;
  if (!organs) return; // The organ gate supplies the pinned release; ordinary unit runs need no cache.
  const dir = mkdtempSync(join(tmpdir(), 'rayforce-projection-'));
  const journal = join(dir, 'journal.jsonl');
  const port = await freePort();
  try {
    const result = await withRayforceMemory(journal, [], async p => {
      const counts = [];
      for (const n of [0, 1, 2, 65]) counts.push(await rebuildProjection(p, rows(n)));
      const special = [ev('special', 'assistant', 'Unicode 世界 [literal] * ? % 100 "quoted" (set nope 1)'), ev('other', 'assistant', 'Other safe line')];
      await rebuildProjection(p, special);
      const parity = [];
      for (const query of ['世界', '[', '*', '%', '"quoted"', 'no_such_literal_93842', 'id:special']) {
        parity.push(await recallRayforce(special, p, query) === recallJournal(special, query));
      }
      const paging = [...Array.from({ length: 20 }, (_, i) => ev(`source-${i}`, 'assistant', `mail claim ${i}`)), ev('owner', 'stimulus', 'page owner@example.invalid')];
      await rebuildProjection(p, paging);
      for (const before of ['', 'source-12', 'source-4']) {
        parity.push(await recallRayforce(paging, p, 'mail', before) === recallJournal(paging, 'mail', before));
      }
      return { counts, parity };
    }, { organs, port });
    if (result === null) throw Error('Pinned Rayforce projection failed');
    expect(result.counts).toEqual([
      { excerpts: 0, episodes: 0, recall: 0 },
      { excerpts: 1, episodes: 0, recall: 1 },
      { excerpts: 2, episodes: 0, recall: 2 },
      { excerpts: 65, episodes: 0, recall: 65 },
    ]);
    expect(result.parity).toEqual(Array(10).fill(true));
  } finally {
    await stopRayforceMemory(port);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reuse, restart and concurrent journals cannot expose a stale or foreign snapshot', async () => {
  const organs = process.env.TENERAL_ORGANS;
  if (!organs) return;
  const dir = mkdtempSync(join(tmpdir(), 'rayforce-lifecycle-'));
  const journal = join(dir, 'one.jsonl'), other = join(dir, 'other.jsonl');
  const port = await freePort(), options = { organs, port };
  try {
    appendEvent(journal, 'g', { type: 'stimulus', source: 'terminal', text: 'old@example.invalid' });
    const first = readEvents(journal);
    expect(await withRayforceMemory(journal, first, p => recallRayforce(first, p, 'old@example.invalid'), options)).toContain('old@example.invalid');

    appendEvent(journal, 'g', { type: 'stimulus', source: 'terminal', text: 'new@example.invalid' });
    const fresh = readEvents(journal);
    const updated = await withRayforceMemory(journal, fresh, async p => ({ text: await recallRayforce(fresh, p, 'new@example.invalid'), counts: await projectionWatermark(p) }), options);
    expect(updated?.text).toContain('new@example.invalid');
    expect(updated?.counts).toEqual({ excerpts: 2, episodes: 0, recall: 2 });

    const receipts = () => readEvents(journal).filter(e => e.type === 'note' && e.kind === 'memory.projection.v1').length;
    const beforeReuse = receipts();
    expect(await withRayforceMemory(journal, fresh, p => recallRayforce(fresh, p, 'new@example.invalid'), options)).toContain('new@example.invalid');
    expect(receipts()).toBe(beforeReuse); // An unchanged snapshot is reused, not rebuilt.

    await stopRayforceMemory(port);
    expect(await withRayforceMemory(journal, fresh, p => recallRayforce(fresh, p, 'new@example.invalid'), options)).toContain('new@example.invalid');

    appendEvent(other, 'g', { type: 'stimulus', source: 'terminal', text: 'betaunique@example.invalid' });
    appendEvent(journal, 'g', { type: 'stimulus', source: 'terminal', text: 'alphaunique@example.invalid' });
    const a = readEvents(journal), b = readEvents(other);
    const [left, right] = await Promise.all([
      withRayforceMemory(journal, a, async p => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return recallRayforce(a, p, 'unique@example.invalid');
      }, options),
      withRayforceMemory(other, b, p => recallRayforce(b, p, 'unique@example.invalid'), options),
    ]);
    expect(left).toContain('alphaunique@example.invalid');
    expect(left).not.toContain('betaunique@example.invalid');
    expect(right).toContain('betaunique@example.invalid');
    expect(right).not.toContain('alphaunique@example.invalid');
  } finally {
    await stopRayforceMemory(port);
    rmSync(dir, { recursive: true, force: true });
  }
});
