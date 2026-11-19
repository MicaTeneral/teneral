import { expect, test } from 'bun:test';
import type { JournalEvent } from '../../brain/journal';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rayboardTyping, rayboardTypingTarget } from '../../body/rayboard-typing';

const dir = mkdtempSync(join(tmpdir(), 'mica-rayboard-typing-'));
async function until<T>(read: () => readonly T[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && read().length < count; attempt++) await Bun.sleep(1);
}

test('Rayboard typing is scoped to an actual conversation and uses the accepted agent contract', async () => {
  const cases = [
    ['mention', 'c_6ayj5jkn', true], ['comment', 'T-477', true], ['dm', 'dm:a_4c5z3ehc:a_c8g6uodu', true],
    ['comment', 'u_k2wxzyex', false], ['task.done', 'T-477', false], ['message', 'private', false],
  ] as const;
  for (const [type, subject, expected] of cases) {
    const e = { type: 'stimulus', source: 'agent:rayboard', text: 'notice\n' + JSON.stringify({ type, subject }) } as Extract<JournalEvent, {type:'stimulus'}>;
    expect(rayboardTypingTarget(e, 'http://127.0.0.1:9', join(dir, 'rayboard-token')) !== undefined).toBe(expected);
  }
  expect(rayboardTypingTarget({ type: 'stimulus', source: 'clock', text: '' } as Extract<JournalEvent, {type:'stimulus'}>, 'http://127.0.0.1:9', 'none')).toBeUndefined();
  const tokenPath = join(dir, 'rayboard-token'); await Bun.write(tokenPath, 'test-token');
  const calls: { body: any; token: string }[] = [];
  const typing = rayboardTyping({ refreshMs: 10, target: () => rayboardTypingTarget({ type: 'stimulus', source: 'agent:rayboard', text: 'notice\n' + JSON.stringify({ type: 'mention', subject: 'c_6ayj5jkn' }) } as Extract<JournalEvent, {type:'stimulus'}>, 'http://127.0.0.1:9', tokenPath), send: (async (_url, init) => { calls.push({ body: JSON.parse(String(init?.body)), token: String(init?.headers && (init.headers as any).Authorization) }); return new Response('{"ok":true}'); }) as typeof fetch });
  typing(true); await until(() => calls, 2); typing(false); await until(() => calls, calls.length + 1);
  expect(calls.length).toBeGreaterThanOrEqual(3);
  expect(calls[0]?.body).toEqual({ to: 'c_6ayj5jkn', composing: true, hold: 60 });
  expect(calls.at(-1)?.body).toEqual({ to: 'c_6ayj5jkn', composing: false });
  expect(calls.every(c => c.token === 'Bearer test-token')).toBe(true);
});

test('Rayboard stop uses the last destination when the signal or environment has already gone', async () => {
  const tokenPath = join(dir, 'rayboard-last-token'); await Bun.write(tokenPath, 'test-token');
  let target: any = { url: 'http://127.0.0.1:9', tokenFile: tokenPath, subject: 'T-477' };
  const bodies: any[] = [];
  const send = (async (_url: any, init: any) => { bodies.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }) as typeof fetch;
  const typing = rayboardTyping({ target: () => target, send }); typing(true); target = undefined; typing(false); await until(() => bodies, 2);
  expect(bodies.map(b => [b.to,b.composing])).toEqual([['T-477',true],['T-477',false]]);
});
