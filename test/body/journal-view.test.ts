import { expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { journalView } from '../../body/journal-view';
import { appendEvent, readEvents } from '../../brain/journal';

test('the journal is read once and then only what was appended, with the same events as reading it whole', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'teneral-view-')), 'journal.jsonl');
  const view = journalView(path);
  expect(view()).toEqual([]);
  for (let i = 0; i < 5; i++) appendEvent(path, 'g', { type: 'stimulus', source: 'terminal', text: `line ${i}` });
  const first = view();
  expect(first).toEqual(readEvents(path));
  // Nothing new: the very same array, not a new reading.
  expect(view()).toBe(first);
  appendEvent(path, 'g', { type: 'assistant', text: 'reply', toolCalls: [] });
  const second = view();
  expect(second).toEqual(readEvents(path));
  // What was handed out before is not changed under whoever holds it.
  expect(first).toHaveLength(5);
  expect(second).toHaveLength(6);
  // A line another process appended while this one was reading comes back twice from the file; it is taken once.
  const line = JSON.stringify(second.at(-1));
  appendFileSync(path, `${line}\n`);
  expect(view()).toHaveLength(6);
  // A journal that got shorter is another journal: it is read anew.
  writeFileSync(path, `${JSON.stringify(first[0])}\n`);
  expect(view()).toEqual(readEvents(path));
  expect(view()).toHaveLength(1);
});
