import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEvents } from '../../brain/journal';
import { known } from '../../brain/known';
import { importLegacyWork, work } from '../../body/work';
import type { ToolContext } from '../../body/tools';

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-journal-'));
  return { dir, journal: join(dir, 'journal.jsonl'), legacy: join(dir, 'work.json'), ctx: { journal: join(dir, 'journal.jsonl'), gen: 'g1' } as ToolContext };
};
const item = (journal: string, task: string) => known(readEvents(journal)).intentions.find((i) => i.text === task);

test('legacy commitments migrate once with checkpoints; done never reopens an intention', async () => {
  const s = setup();
  try {
    writeFileSync(s.legacy, JSON.stringify({ version: 1, items: [
      { status: 'queued', task: 'Legacy', next: 'Inspect receipt', outcome: 'Verified', recovery: 'receipt', evidence: 'started', attempts: 1, due: 0 },
      { status: 'waiting', task: 'Blocked', next: 'A real dependency', attempts: 0, due: 0 },
    ] }));
    expect(importLegacyWork(s.journal, 'g1', s.legacy)).toBe(2);
    expect(item(s.journal, 'Legacy')?.work).toMatchObject({ status: 'queued', next: 'Inspect receipt', outcome: 'Verified', recovery: 'receipt', evidence: 'started', attempts: 1 });
    expect(item(s.journal, 'Blocked')?.work?.status).toBe('waiting');
    const before = readFileSync(s.legacy, 'utf8');
    expect(importLegacyWork(s.journal, 'g1', s.legacy)).toBe(0);
    expect(readFileSync(s.legacy, 'utf8')).toBe(before);

    await work.run({ status: 'done', task: 'Legacy', next: 'Verified against receipt' }, s.ctx);
    expect(item(s.journal, 'Legacy')).toBeUndefined();
    expect(importLegacyWork(s.journal, 'g1', s.legacy)).toBe(0);
    expect(item(s.journal, 'Legacy')).toBeUndefined();
    expect(readEvents(s.journal).filter((e) => e.type === 'note' && e.kind === 'memory.work.import.v1')).toHaveLength(2);
  } finally { rmSync(s.dir, { recursive: true }); }
});

test('existing open and historical intentions are reused rather than duplicated', async () => {
  const s = setup();
  try {
    await work.run({ status: 'queued', task: 'Same', next: 'Old step', outcome: 'Keep this' }, s.ctx);
    await work.run({ status: 'done', task: 'Closed', next: 'Already verified' }, s.ctx);
    const id = item(s.journal, 'Same')?.id;
    writeFileSync(s.legacy, JSON.stringify({ version: 1, items: [
      { status: 'waiting', task: 'Same', next: 'New blocker', attempts: 0, due: 0 },
      { status: 'done', task: 'Closed', next: 'Old copy', attempts: 0, due: 0 },
    ] }));
    expect(importLegacyWork(s.journal, 'g1', s.legacy)).toBe(1);
    expect(item(s.journal, 'Same')).toMatchObject({ id, work: { status: 'waiting', next: 'New blocker', outcome: 'Keep this' } });
    expect(item(s.journal, 'Closed')).toBeUndefined();
    expect(known(readEvents(s.journal)).intentions.filter((i) => i.text === 'Same')).toHaveLength(1);
  } finally { rmSync(s.dir, { recursive: true }); }
});

test('malformed or duplicate legacy queues fail loudly and leave the journal unchanged', () => {
  const s = setup();
  try {
    writeFileSync(s.legacy, 'broken');
    expect(() => importLegacyWork(s.journal, 'g1', s.legacy)).toThrow();
    expect(readEvents(s.journal)).toHaveLength(0);
    writeFileSync(s.legacy, JSON.stringify({ version: 1, items: [
      { status: 'queued', task: 'Same', next: 'One', attempts: 0, due: 0 },
      { status: 'queued', task: 'Same', next: 'Two', attempts: 0, due: 0 },
    ] }));
    expect(() => importLegacyWork(s.journal, 'g1', s.legacy)).toThrow('Invalid legacy agenda');
    expect(readEvents(s.journal)).toHaveLength(0);
  } finally { rmSync(s.dir, { recursive: true }); }
});
