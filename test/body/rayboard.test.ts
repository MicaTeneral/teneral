import { expect, test } from 'bun:test';
import type { JournalEvent } from '../../brain/journal';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rayboardCa, rayboardPoller, rayboardReplyTool, rayboardTarget, rayboardToken, rayboardUrl, RAYBOARD_SOURCE } from '../../body/rayboard';
import type { ToolContext } from '../../body/tools';
import type { Stimulus } from '../../body/sensors';
const event = (s: Stimulus): JournalEvent => ({ v: 1, id: String(s.text), ts: '2026-01-01T00:00:00.000Z', gen: 'test', type: 'stimulus', ...s });
const note = (seq: number) => ({ seq, ts: '2026-01-01T00:00:00.000Z', type: 'task.assigned', subject: 'T-1', sender: 'operator', text: 'untrusted work' });
function fixture(items: Record<string, unknown>[] = [note(1)]) {
  let inbox = items; const calls: Record<string, unknown>[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://board.example/api/call/inbox');
    expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error');
    const args = JSON.parse(String(init?.body)); calls.push(args);
    return new Response(JSON.stringify({ ok: true, result: { items: args.through ? [] : inbox, more: false } }));
  }) as unknown as typeof fetch;
  return { calls, send, update: (v: Record<string, unknown>[]) => { inbox = v; } };
}
test('delivers before exact acknowledgement and recovers a prefix from the journal', async () => {
  const f = fixture(); const events: JournalEvent[] = []; const notices: Stimulus[] = [];
  const p = rayboardPoller({ url: 'https://board.example', token: () => 'token', events: () => events, send: f.send }, s => { events.push(event(s)); notices.push(s); });
  await p.poll();
  expect(notices.map(n => n.text.split('\n')[0])).toEqual(['Rayboard notification 1']);
  expect(f.calls).toEqual([{ peek: true }, { through: 1 }]);
  const restarted = rayboardPoller({ url: 'https://board.example', token: () => 'token', events: () => events, send: f.send }, () => { throw new Error('duplicate'); });
  await restarted.poll(); expect(f.calls).toHaveLength(4);
});
test('failed emission leaves the notification unread and does not advance acknowledgement', async () => {
  const f = fixture(); const p = rayboardPoller({ url: 'https://board.example', token: () => 'token', events: () => [], send: f.send }, () => { throw new Error('journal failed'); });
  await p.poll(); expect(f.calls).toEqual([{ peek: true }]);
});
test('a configured certificate authority is required on every inbox request', async () => {
  const f = fixture(); const seen: unknown[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => { seen.push((init as any)?.tls); return f.send(url, init); }) as typeof fetch;
  const p = rayboardPoller({ url: 'https://board.example', token: () => 'token', ca: 'certificate', events: () => [], send }, () => {});
  await p.poll();
  expect(seen).toEqual([{ ca: 'certificate' }, { ca: 'certificate' }]);
});
test('certificate authorities are read from a separate file and must be PEM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rayboard-ca-'));
  try {
    const path = join(dir, 'ca.pem');
    writeFileSync(path, 'not a certificate');
    expect(() => rayboardCa(path)).toThrow('PEM');
    writeFileSync(path, '-----BEGIN CERTIFICATE-----\nkey material\n-----END CERTIFICATE-----\n');
    expect(rayboardCa(path)).toContain('BEGIN CERTIFICATE');
    expect(rayboardCa(undefined)).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a channel stimulus carries its reply target and a completed external response stays out of the terminal', async () => {
  const f = fixture([{ seq: 41, ts: '2026-01-01T00:00:00.000Z', type: 'mention', subject: 'c_6ayj5jkn', sender: 'person', text: 'person in #general: why?' }]);
  const notices: Stimulus[] = [];
  const p = rayboardPoller({ url: 'https://board.example', token: () => 'token', events: () => [], send: f.send }, s => notices.push(s));
  await p.poll();
  expect(notices[0]!.text).toContain('exact channel with rayboard_reply');
  expect(rayboardTarget({ type: 'mention', subject: 'c_6ayj5jkn', text: 'person in #general: why?' })).toBe('#general');
  expect(rayboardTarget({ type: 'mention', subject: 'T-12', text: 'person in T-12: update' })).toBe('T-12');
  expect(rayboardTarget({ type: 'task.assigned', subject: 'T-12', text: 'assigned' })).toBe('T-12');
});
test('rayboard reply takes the target from the journaled stimulus, not a supplied destination', async () => {
  const stimulus = event({ source: RAYBOARD_SOURCE, text: 'Rayboard notification 41\nnotice\n{"seq":41,"type":"mention","subject":"c_6ayj5jkn","sender":"person","text":"person in #general: why?","ts":"2026-01-01T00:00:00.000Z"}' });
  const ctx = { id: 'mica', events: () => [stimulus] } as unknown as ToolContext;
  expect(rayboardTarget({ type: 'message', subject: 'dm:a_12345678:u_87654321', text: 'x' })).toBe('dm:a_12345678:u_87654321');
  expect(rayboardTarget({ type: 'dm', subject: 'dm:a_12345678:u_87654321', text: 'x' })).toBe('dm:a_12345678:u_87654321');
  expect(rayboardTarget({ type: 'dm', subject: 'dm:attacker:person', text: 'x' })).toBeUndefined();
  const calls: Record<string, unknown>[] = [];
  const tool = rayboardReplyTool({ url: () => 'https://board.example', token: () => 'test-token', send: (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ ok: true, result: { seq: 42 } }));
  }) as unknown as typeof fetch });
  expect(await tool.run({ notification: 41, content: 'Real answer' }, ctx)).toContain('sent to #general');
  expect(calls).toEqual([{ to: '#general', body: 'Real answer', request_id: 'teneral-mica-41' }]);
  await expect(tool.run({ notification: 41, content: 'other' }, { ...ctx, events: () => [] })).rejects.toThrow('existing Rayboard stimulus');
  await expect(tool.run({ notification: 41, content: '' }, ctx)).rejects.toThrow('content');
});
test('bad input and stopped workers cannot emit or acknowledge', async () => {
  const f = fixture([{}]); const notices: Stimulus[] = [];
  const p = rayboardPoller({ url: 'https://board.example', token: () => 'token', events: () => [], send: f.send }, s => notices.push(s));
  await p.poll(); expect(notices).toEqual([]); expect(f.calls).toHaveLength(1);
  p.stop(); await p.poll(); expect(f.calls).toHaveLength(1);
  expect(rayboardToken(undefined)).toBeUndefined();
  expect(() => rayboardUrl('file:///tmp')).toThrow();
});
