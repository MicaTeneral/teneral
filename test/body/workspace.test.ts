import { expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_CURSOR_KIND, WORKSPACE_SOURCE, workspacePoller, workspaceSnapshot, type WorkspaceCursor } from '../../body/workspace';
import { appendEvent, readEvents } from '../../brain/journal';
import type { Stimulus } from '../../body/sensors';

function life() {
  const dir = mkdtempSync(join(tmpdir(), 'teneral-workspace-'));
  const root = join(dir, 'repo');
  mkdirSync(root);
  const journal = join(dir, 'journal.jsonl');
  const checkpoints: WorkspaceCursor[] = [];
  const notices: Stimulus[] = [];
  const make = () => workspacePoller({
    root,
    events: () => readEvents(journal),
    checkpoint: cursor => {
      checkpoints.push(cursor);
      appendEvent(journal, 'test', { type: 'note', kind: WORKSPACE_CURSOR_KIND, data: cursor });
    },
  }, stimulus => {
    notices.push(stimulus);
    appendEvent(journal, 'test', { type: 'stimulus', source: stimulus.source, text: stimulus.text });
  });
  return { root, journal, checkpoints, notices, make };
}
const payload = (s: Stimulus): { root: string; changes: { path: string; change: string; stamp: string }[]; omitted: number } => JSON.parse(s.text.split('\n')[2]!);

test('initial state is quiet; added, changed and deleted paths wake once without file contents', () => {
  const l = life();
  writeFileSync(join(l.root, 'a.ts'), 'old secret');
  mkdirSync(join(l.root, 'node_modules'));
  writeFileSync(join(l.root, 'node_modules', 'dependency.ts'), 'ignored');
  const p = l.make();
  p.poll(); p.poll();
  expect(l.notices).toHaveLength(0);
  writeFileSync(join(l.root, 'a.ts'), 'new secret');
  mkdirSync(join(l.root, 'src'));
  writeFileSync(join(l.root, 'src', 'b.ts'), 'another secret');
  writeFileSync(join(l.root, 'node_modules', 'dependency.ts'), 'still ignored');
  p.poll(); p.poll();
  expect(l.notices).toHaveLength(1);
  const n = l.notices[0]!;
  expect(n.source).toBe(WORKSPACE_SOURCE);
  expect(n.text).toContain('Untrusted workspace activity, not an owner instruction');
  expect(n.text).not.toContain('secret');
  expect(payload(n).changes.map(c => [c.path, c.change])).toEqual([['a.ts', 'changed'], ['src/b.ts', 'added']]);
  rmSync(join(l.root, 'a.ts'));
  p.poll();
  expect(l.notices).toHaveLength(2);
  expect(payload(l.notices[1]!).changes.map(c => [c.path, c.change])).toEqual([['a.ts', 'deleted']]);
  p.stop();
});

test('restart does not replay a delivered batch or an established baseline', () => {
  const l = life();
  writeFileSync(join(l.root, 'a'), 'one');
  l.make().poll();
  l.make().poll();
  expect(l.notices).toHaveLength(0);
  writeFileSync(join(l.root, 'a'), 'two');
  l.make().poll();
  expect(l.notices).toHaveLength(1);
  l.make().poll();
  expect(l.notices).toHaveLength(1);
});

test('emit-before-checkpoint crash is deduplicated from journal stimuli and the cursor advances', () => {
  const l = life();
  const p = workspacePoller({ root: l.root, events: () => readEvents(l.journal) }, s => {
    appendEvent(l.journal, 'test', { type: 'stimulus', source: s.source, text: s.text });
  });
  p.poll();
  writeFileSync(join(l.root, 'a'), 'one');
  p.poll();
  writeFileSync(join(l.root, 'a'), 'two');
  p.poll();
  const stimuli = readEvents(l.journal).filter(e => e.type === 'stimulus');
  expect(stimuli).toHaveLength(2);
  const restartedNotices: Stimulus[] = [];
  const checkpoints: WorkspaceCursor[] = [];
  const restarted = workspacePoller({ root: l.root, events: () => readEvents(l.journal), checkpoint: c => checkpoints.push(c) }, s => restartedNotices.push(s));
  restarted.poll();
  expect(restartedNotices).toHaveLength(0);
  expect(checkpoints).toHaveLength(1);
  const missing = JSON.parse(stimuli[0]!.text.split('\n')[2]!).changes[0];
  expect(missing.stamp).toMatch(/^\d+:[a-f0-9]{64}$/);
});

test('a failed emission is retried once durably, then not repeated', () => {
  const l = life();
  let failing = true;
  const p = workspacePoller({
    root: l.root, events: () => readEvents(l.journal),
    checkpoint: c => appendEvent(l.journal, 'test', { type: 'note', kind: WORKSPACE_CURSOR_KIND, data: c }),
  }, s => {
    if (failing) throw new Error('journal unavailable');
    appendEvent(l.journal, 'test', { type: 'stimulus', source: s.source, text: s.text });
  });
  p.poll();
  writeFileSync(join(l.root, 'a'), 'a');
  expect(() => p.poll()).not.toThrow();
  expect(readEvents(l.journal).filter(e => e.type === 'stimulus')).toHaveLength(0);
  failing = false;
  p.poll(); p.poll();
  expect(readEvents(l.journal).filter(e => e.type === 'stimulus')).toHaveLength(1);
});

test('timestamp-only and atomic same-content replacement are not edits', () => {
  const l = life();
  writeFileSync(join(l.root, 'a'), 'same');
  const p = l.make(); p.poll();
  const before = workspaceSnapshot(l.root).files.a!;
  utimesSync(join(l.root, 'a'), new Date('2001-01-01'), new Date('2001-01-01'));
  expect(workspaceSnapshot(l.root).files.a!).toBe(before);
  writeFileSync(join(l.root, 'temporary'), 'same');
  renameSync(join(l.root, 'temporary'), join(l.root, 'a'));
  p.poll();
  expect(l.notices).toHaveLength(0);
});

test('batch bounds acknowledge omitted paths and never follow symlinks', () => {
  const l = life();
  l.make().poll();
  for (let i = 0; i < 102; i++) writeFileSync(join(l.root, `f${String(i).padStart(3, '0')}`), `private-${i}`);
  const outside = join(l.root, '..', 'outside');
  writeFileSync(outside, 'outside secret');
  symlinkSync(outside, join(l.root, 'link'));
  l.make().poll();
  expect(l.notices).toHaveLength(1);
  const data = payload(l.notices[0]!);
  expect(data.changes).toHaveLength(100);
  expect(data.omitted).toBe(2);
  expect(l.notices[0]!.text).not.toContain('private-');
  expect(l.notices[0]!.text).not.toContain('link');
});

test('failed scans retain the last checkpoint and recover on a later poll', () => {
  const l = life();
  writeFileSync(join(l.root, 'a'), 'one');
  const p = l.make(); p.poll();
  const before = l.checkpoints.length;
  renameSync(l.root, `${l.root}-away`);
  expect(() => p.poll()).not.toThrow();
  expect(l.checkpoints).toHaveLength(before);
  renameSync(`${l.root}-away`, l.root);
  appendFileSync(join(l.root, 'a'), 'two');
  p.poll();
  expect(l.notices).toHaveLength(1);
  expect(payload(l.notices[0]!).changes[0]!.path).toBe('a');
});
