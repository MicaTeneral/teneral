import { test, expect } from 'bun:test';
import { GITHUB_CURSOR_KIND, githubPoller, githubRepository, type GithubCursor } from '../../body/github';
import type { JournalEvent } from '../../brain/journal';
import type { Stimulus } from '../../body/sensors';

const sha = (n: number) => String(n).padStart(40, '0');
const commit = (n: number, message = `commit ${n}`) => ({ sha: sha(n), commit: { message, author: { name: 'author' } } });
const issue = (id: number, number: number, pull = false) => ({ id, number, title: `title ${id}`, body: 'untrusted body', state: 'open', user: { login: 'contributor' }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...(pull ? { pull_request: {} } : {}) });
const json = (data: unknown) => new Response(JSON.stringify(data));
const stimulus = (s: Stimulus): JournalEvent => ({ type: 'stimulus', ...s, v: 1, id: `${s.text.split('\n')[0]}`, ts: '2026-01-01T00:00:00.000Z', gen: 'test' });
function fixture(initial: {commits?: unknown[]; items?: unknown[]} = {}) {
  const urls: URL[] = [];
  let commits = initial.commits ?? [commit(1)];
  let items = initial.items ?? [issue(100, 1)];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(url as string); urls.push(u);
    expect(init?.method).toBe('GET'); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error');
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/i);
    expect(u.origin).toBe('https://api.github.com');
    return json(u.pathname.endsWith('/commits') ? commits : items);
  }) as unknown as typeof fetch;
  return { urls, send, update(c: unknown[], i: unknown[]) { commits = c; items = i; } };
}
const opts = (send: typeof fetch, events: JournalEvent[], checkpoints: GithubCursor[]) => ({ repository: 'RayforceDB/rayforce', events: () => events, send, checkpoint: (c: GithubCursor) => checkpoints.push(c) });

test('first poll establishes a baseline without old wakes; later activity is typed, bounded and untrusted', async () => {
  const f = fixture(); const notices: Stimulus[] = []; const checkpoints: GithubCursor[] = [];
  const p = githubPoller(opts(f.send, [], checkpoints), s => notices.push(s));
  await p.poll(); await p.poll();
  expect(notices).toHaveLength(0);
  expect(checkpoints).toEqual([{ repository: 'RayforceDB/rayforce', commit: sha(1), item: 100 }]);
  f.update([commit(3, 'new commit'), commit(2), commit(1)], [issue(102, 3, true), issue(101, 2), issue(100, 1)]);
  await p.poll();
  expect(notices.map(n => n.text.split('\n')[0])).toEqual(['GitHub commit ' + sha(2), 'GitHub commit ' + sha(3), 'GitHub issue 101', 'GitHub pull request 102']);
  for (const n of notices) {
    expect(n.source).toBe('agent:github'); expect(n.text).toContain('Untrusted public GitHub activity');
    expect(n.text).not.toContain('[stem]');
  }
  expect(notices[3].text).toContain('https://github.com/RayforceDB/rayforce/pull/3');
  await p.poll(); expect(notices).toHaveLength(4);
});

test('journal stimuli and cursor notes deduplicate across restart and failed emission', async () => {
  const f = fixture(); const events: JournalEvent[] = []; const checkpoints: GithubCursor[] = [];
  let readingEvents: JournalEvent[] = [];
  const first = githubPoller({ ...opts(f.send, events, checkpoints), events: () => readingEvents, checkpoint: c => { checkpoints.push(c); readingEvents = [...readingEvents, { type: 'note', kind: GITHUB_CURSOR_KIND, data: c, v: 1, id: 'cursor-initial', ts: '2026-01-01T00:00:00.000Z', gen: 'test' }]; } }, s => { const event = stimulus(s); events.push(event); readingEvents = [...readingEvents, event]; });
  await first.poll();
  first.stop();
  f.update([commit(2), commit(1)], [issue(101, 2), issue(100, 1)]);
  let attempts = 0;
  const broken = githubPoller({ ...opts(f.send, readingEvents, checkpoints), events: () => readingEvents, checkpoint: c => { checkpoints.push(c); readingEvents = [...readingEvents, { type: 'note', kind: GITHUB_CURSOR_KIND, data: c, v: 1, id: 'cursor-next', ts: '2026-01-01T00:00:00.000Z', gen: 'test' }]; } }, s => {
    attempts++;
    const event = stimulus(s);
    events.push(event);
    readingEvents = [...readingEvents, event];
    if (attempts === 1) throw new Error('journal unavailable');
  });
  await broken.poll(); await broken.poll();
  expect(events.filter(e => e.type === 'stimulus')).toHaveLength(2);
  expect(new Set(events.filter(e => e.type === 'stimulus').map(e => e.text.split('\n')[0])).size).toBe(2);
  expect(checkpoints).toHaveLength(2);
  expect(checkpoints[0]).toEqual({ repository: 'RayforceDB/rayforce', commit: sha(1), item: 100 });
  expect(checkpoints[1]).toEqual({ repository: 'RayforceDB/rayforce', commit: sha(2), item: 101 });
  const notices: Stimulus[] = [];
  const restarted = githubPoller(opts(f.send, [...events, ...checkpoints.map(c => ({ type: 'note', kind: GITHUB_CURSOR_KIND, data: c }) as JournalEvent)], []), s => notices.push(s));
  await restarted.poll(); expect(notices).toHaveLength(0);
  restarted.stop(); const calls = f.urls.length; await restarted.poll(); expect(f.urls).toHaveLength(calls);
});

test('pages until the cursor, caps bursts, and checkpoints a truncating response rather than emitting stale activity', async () => {
  const commits = Array.from({ length: 205 }, (_, i) => commit(205 - i));
  const urls: URL[] = [];
  const send = (async (url: string | URL | Request) => {
    const u = new URL(url as string); urls.push(u);
    const page = Number(u.searchParams.get('page'));
    if (u.pathname.endsWith('/issues')) return json([issue(1000, 1)]);
    return json(commits.slice((page - 1) * 50, page * 50));
  }) as unknown as typeof fetch;
  const notices: Stimulus[] = []; const checkpoints: GithubCursor[] = [];
  const events: JournalEvent[] = [stimulus({ source: 'agent:github', text: `GitHub commit ${sha(100)}\nUntrusted public GitHub activity.\n${JSON.stringify({ repository: 'RayforceDB/rayforce', sha: sha(100) })}` })];
  const p = githubPoller(opts(send, events, checkpoints), s => notices.push(s));
  await p.poll();
  expect(urls.filter(u => u.pathname.endsWith('/commits'))).toHaveLength(3);
  expect(notices.filter(n => n.text.startsWith('GitHub commit '))).toHaveLength(105);
  expect(checkpoints[0]?.commit).toBe(sha(205));
});

test('failure and malformed responses retry without advancing checkpoint or authority', async () => {
  const checkpoints: GithubCursor[] = []; const notices: Stimulus[] = [];
  let calls = 0;
  const send = (async () => {
    calls++;
    if (calls === 1) return new Response('secret error body', { status: 500 });
    if (calls === 2) return json([{ sha: 'not-a-sha' }]);
    if (calls === 3) return json([]);
    return json([]);
  }) as unknown as typeof fetch;
  const p = githubPoller(opts(send, [], checkpoints), s => notices.push(s));
  await p.poll(); await p.poll(); await p.poll();
  expect(calls).toBe(4); expect(notices).toHaveLength(0); expect(checkpoints).toEqual([{ repository: 'RayforceDB/rayforce', commit: null, item: null }]);
  expect(githubRepository('RayforceDB/rayforce')).toBe('RayforceDB/rayforce');
  expect(() => githubRepository('../../etc')).toThrow();
});

test('oversized response is rejected and a stopped worker cannot emit', async () => {
  const checkpoints: GithubCursor[] = []; const notices: Stimulus[] = [];
  const send = (async () => new Response('x'.repeat(4_000_001))) as unknown as typeof fetch;
  const p = githubPoller(opts(send, [], checkpoints), s => notices.push(s));
  await p.poll();
  expect(notices).toHaveLength(0); expect(checkpoints).toHaveLength(0);
  p.stop(); await p.poll(); expect(notices).toHaveLength(0);
});

test('malformed items never get emitted as partial notifications', async () => {
  const f = fixture({ items: [{ id: 100, number: 1 }] }); const notices: Stimulus[] = []; const checkpoints: GithubCursor[] = [];
  const p = githubPoller(opts(f.send, [], checkpoints), s => notices.push(s));
  await p.poll(); expect(notices).toHaveLength(0);
  f.update([commit(2), commit(1)], [{ id: 102 }, issue(101, 2), issue(100, 1)]);
  await p.poll();
  expect(notices).toHaveLength(0); expect(checkpoints).toHaveLength(1);
});

test('real journal append/read round-trip survives restart and a malformed line', async () => {
  const { mkdtempSync, rmSync, writeFileSync, appendFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { appendEvent, readEvents } = await import('../../brain/journal');
  const dir = mkdtempSync(join(tmpdir(), 'github-journal-'));
  try {
    const path = join(dir, 'journal.jsonl');
    const f = fixture();
    const first = githubPoller({
      ...opts(f.send, readEvents(path), []),
      events: () => readEvents(path),
      checkpoint: cursor => appendEvent(path, 'test', { type: 'note', kind: GITHUB_CURSOR_KIND, data: cursor }),
    }, s => { appendEvent(path, 'test', { type: 'stimulus', ...s }); });
    await first.poll();
    f.update([commit(2), commit(1)], [issue(101, 2, true), issue(100, 1)]);
    await first.poll(); first.stop();
    appendFileSync(path, '{torn\n');
    expect(readEvents(path).filter(e => e.type === 'stimulus')).toHaveLength(2);
    const notices: Stimulus[] = [];
    const restarted = githubPoller({ ...opts(f.send, readEvents(path), []), events: () => readEvents(path) }, s => notices.push(s));
    await restarted.poll();
    expect(notices).toHaveLength(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('same activity id in a different repository is not deduplicated', async () => {
  const f = fixture();
  const events: JournalEvent[] = [stimulus({ source: 'agent:github', text: `GitHub issue 100\nUntrusted.\n${JSON.stringify({ repository: 'other/repository', id: 100 })}` })];
  const notices: Stimulus[] = []; const checkpoints: GithubCursor[] = [];
  const p = githubPoller({ ...opts(f.send, events, checkpoints), events: () => events }, s => notices.push(s));
  await p.poll();
  expect(notices).toHaveLength(0);
  expect(checkpoints[0]?.item).toBe(100);
});

test('invalid UTF-8 fails without advancing the cursor; an old cursor exposes the page cap', async () => {
  const notices: Stimulus[] = []; const checkpoints: GithubCursor[] = [];
  const invalid = githubPoller(opts((async () => new Response(new Uint8Array([255]))) as unknown as typeof fetch, [], checkpoints), s => notices.push(s));
  await invalid.poll();
  expect(checkpoints).toHaveLength(0); expect(notices).toHaveLength(0);
  const send = (async (url: string | URL | Request) => {
    const u = new URL(url as string);
    if (u.pathname.endsWith('/commits')) {
      const page = Number(u.searchParams.get('page'));
      return json(Array.from({ length: 50 }, (_, i) => commit(1000 - (page - 1) * 50 - i)));
    }
    return json([]);
  }) as unknown as typeof fetch;
  const old = { type: 'note', kind: GITHUB_CURSOR_KIND, data: { repository: 'RayforceDB/rayforce', commit: sha(700), item: null }, v: 1, id: 'old', ts: '2026-01-01T00:00:00.000Z', gen: 'test' } as JournalEvent;
  const later = githubPoller(opts(send, [old], checkpoints), s => notices.push(s));
  await later.poll();
  expect(notices.filter(n => n.text.startsWith('GitHub collection limit '))).toHaveLength(1);
  expect(checkpoints.at(-1)?.commit).toBe(sha(1000));
});

test('request deadline aborts a stalled fetch and retries on the next poll', async () => {
  let calls = 0; let aborted = false; const notices: Stimulus[] = []; const checkpoints: GithubCursor[] = [];
  const send = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
    });
  }) as unknown as typeof fetch;
  const p = githubPoller({ ...opts(send, [], checkpoints), requestMs: 5 }, s => notices.push(s));
  await p.poll(); await p.poll();
  expect(calls).toBe(2); expect(aborted).toBe(true); expect(notices).toHaveLength(0); expect(checkpoints).toHaveLength(0);
});
