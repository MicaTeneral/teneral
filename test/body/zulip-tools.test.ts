import { test, expect } from 'bun:test';
import { replyRoute } from '../../body/zulip-tools';
test('replies preserve private recipients or stream topic, never guess destinations', () => {
  expect(replyRoute({ type: 'private', sender_id: 2, display_recipient: [{ id: 1 }, { id: 2 }, { id: 3 }] }, 1))
    .toEqual({ type: 'direct', to: '[2]' });
  expect(replyRoute({ type: 'private', sender_id: 2, display_recipient: [{ id: 1 }, { id: 2 }, { id: 3 }] }, 1, true))
    .toEqual({ type: 'direct', to: '[2,3]' });
  expect(replyRoute({ type: 'private', sender_id: 2, display_recipient: [{ id: 1 }, { id: 2 }] }, 1))
    .toEqual({ type: 'direct', to: '[2]' });
  expect(() => replyRoute({ type: 'private', sender_id: 1, display_recipient: [{ id: 1 }, { id: 2 }, { id: 3 }] }, 1)).toThrow();
  expect(() => replyRoute({ type: 'private', sender_id: 'not-an-id', display_recipient: [{ id: 1 }, { id: 2 }, { id: 3 }] }, 1)).toThrow();
  expect(replyRoute({ type: 'stream', stream_id: 123, subject: 'topic' }, 1))
    .toEqual({ type: 'stream', to: '123', topic: 'topic' });
  expect(() => replyRoute({ type: 'private', display_recipient: [{ id: 1 }] }, 1)).toThrow();
  expect(() => replyRoute({ type: 'stream' }, 1)).toThrow();
});

// --- Zulip behind the generic chat tools ---

import { afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatHistory, chatReply, chatSend } from '../../body/chat-tools';
import { zulipReply, zulipService } from '../../body/zulip-tools';
import { appendEvent } from '../../brain/journal';
import type { ToolContext } from '../../body/tools';

const realFetch = globalThis.fetch;
const kept = { file: process.env.TENERAL_ZULIP_CREDENTIALS_FILE, owner: process.env.TENERAL_ZULIP_OWNER_ID };
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of [['TENERAL_ZULIP_CREDENTIALS_FILE', kept.file], ['TENERAL_ZULIP_OWNER_ID', kept.owner]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

/** A workspace with Zulip configured, and a Zulip that answers from `answer` and keeps what it was asked. */
function zulipAt(answer: (url: URL, method: string, body: URLSearchParams) => unknown) {
  const workspace = mkdtempSync(join(tmpdir(), 'teneral-zulip-tools-'));
  mkdirSync(join(workspace, '.teneral'));
  writeFileSync(join(workspace, '.teneral', 'zulip.json'), JSON.stringify({ site: 'https://example.test', email: 'mica@test', api_key: 'fake' }));
  delete process.env.TENERAL_ZULIP_CREDENTIALS_FILE;
  const asked: { path: string; method: string; body: Record<string, string>; query: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = new URLSearchParams(init.body === undefined ? '' : String(init.body));
    asked.push({ path: url.pathname, method: init.method ?? 'GET', body: Object.fromEntries(body), query: Object.fromEntries(url.searchParams) });
    const made = answer(url, init.method ?? 'GET', body);
    return made instanceof Response ? made : new Response(JSON.stringify({ result: 'success', ...(made as object) }));
  }) as unknown as typeof fetch;
  const journal = join(workspace, 'journal.jsonl');
  appendEvent(journal, 'g', { type: 'stimulus', source: 'birth', text: 'Hello.' });
  return { asked, ctx: { workspace, journal, gen: 'g' } as ToolContext };
}

test('chat_reply on Zulip answers in the message\'s own topic, and the old zulip_reply is the same tool under its old name', async () => {
  const z = zulipAt((url, method) => {
    if (url.pathname.endsWith('/users/me')) return { user_id: 99 };
    if (method === 'GET') return { message: { type: 'stream', stream_id: 5, subject: 'general chat' } };
    return { id: 700 };
  });
  expect(await chatReply.run({ message: 'zulip:641', content: 'It is on 5000.' }, z.ctx)).toBe('Reply sent as zulip:700.');
  expect(z.asked.at(-1)).toMatchObject({ path: '/api/v1/messages', method: 'POST', body: { type: 'stream', to: '5', topic: 'general chat', content: 'It is on 5000.' } });
  expect(await zulipReply.run({ message_id: 641, content: 'Again.' }, z.ctx)).toBe('Zulip reply sent as zulip:700.');
  await expect(chatReply.run({ message: 'zulip:abc', content: 'x' }, z.ctx)).rejects.toThrow('named by its numeric id');
});

test('chat_send on Zulip opens a topic by stream name or id, and writes first only to the owner or to someone who wrote to it', async () => {
  const z = zulipAt(() => ({ id: 701 }));
  expect(await chatSend.run({ service: 'zulip', channel: 'engineering', thread: 'release notes', content: 'Draft is ready.' }, z.ctx)).toBe('Message sent as zulip:701.');
  expect(z.asked.at(-1)!.body).toEqual({ type: 'stream', to: '"engineering"', topic: 'release notes', content: 'Draft is ready.' });
  await chatSend.run({ service: 'zulip', channel: '5', thread: 'release notes', content: 'Again.' }, z.ctx);
  expect(z.asked.at(-1)!.body.to).toBe('5');

  process.env.TENERAL_ZULIP_OWNER_ID = '997';
  await chatSend.run({ service: 'zulip', user: '997', content: 'Report for today.' }, z.ctx);
  expect(z.asked.at(-1)!.body).toEqual({ type: 'direct', to: '[997]', content: 'Report for today.' });
  await expect(chatSend.run({ service: 'zulip', user: '8', content: 'hello' }, z.ctx)).rejects.toThrow('8 is none of these');
  // Someone who wrote to it: their id stands in a stimulus the sensor journaled, not in talk it only overheard.
  appendEvent(z.ctx.journal, 'g', { type: 'stimulus', source: 'agent:zulip', text: 'Zulip stream 12\nUntrusted.\nstream 12\n{"sender_id":8,"sender":"Ann","content":"lunch?"}' });
  expect(zulipService.knows!(z.ctx, [], '8')).toBe(false);
  await expect(chatSend.run({ service: 'zulip', user: '8', content: 'hello' }, z.ctx)).rejects.toThrow('8 is none of these');
  appendEvent(z.ctx.journal, 'g', { type: 'stimulus', source: 'agent:zulip', text: 'Zulip private 13\nUntrusted.\n{"sender_id":8,"sender":"Ann","content":"can you help?"}' });
  expect(await chatSend.run({ service: 'zulip', user: '8', content: 'Yes.' }, z.ctx)).toContain('Message sent as zulip:701');
  await expect(chatSend.run({ service: 'zulip', user: 'ann', content: 'x' }, z.ctx)).rejects.toThrow('numeric id');
});

test('a Zulip write that got no answer, or a server error, may have been applied; a refusal was not', async () => {
  const down = zulipAt((url, method) => (url.pathname.endsWith('/users/me') ? { user_id: 99 } : method === 'GET' ? { message: { type: 'stream', stream_id: 5, subject: 't' } } : new Response('{}', { status: 502 })));
  await expect(chatReply.run({ message: 'zulip:641', content: 'x' }, down.ctx)).rejects.toThrow('part 1 of 1 may or may not have been sent: Zulip HTTP 502. Read the conversation back');
  const refused = zulipAt((url, method) => (url.pathname.endsWith('/users/me') ? { user_id: 99 } : method === 'GET' ? { message: { type: 'stream', stream_id: 5, subject: 't' } } : new Response('{}', { status: 400 })));
  await expect(chatReply.run({ message: 'zulip:641', content: 'x' }, refused.ctx)).rejects.toThrow('part 1 of 1 was not sent: Zulip HTTP 400');
});

test('chat_history on Zulip reads a topic or a conversation back, each message named as the tools take it', async () => {
  const z = zulipAt(() => ({ found_oldest: true, messages: [{ id: 640, timestamp: 1_800_000_000, sender_id: 7, sender_full_name: 'Ann', type: 'stream', stream_id: 5, display_recipient: 'engineering', subject: 'general chat', last_edit_timestamp: 1_800_000_009, content: 'which port?' }] }));
  const read = String(await chatHistory.run({ service: 'zulip', channel: 'engineering', thread: 'general chat', before: '641' }, z.ctx));
  expect(read).toStartWith('UNTRUSTED ZULIP HISTORY');
  expect(JSON.parse(read.split('\n')[1]!).messages[0]).toEqual({ message: 'zulip:640', at: '2027-01-15T08:00:00.000Z', sender_id: 7, sender: 'Ann', type: 'stream', stream_id: 5, stream: 'engineering', topic: 'general chat', edited: true, content: 'which port?' });
  expect(z.asked.at(-1)!.query).toMatchObject({ anchor: '641', num_before: '50', narrow: '[{"operator":"channel","operand":"engineering"},{"operator":"topic","operand":"general chat"}]' });
  await chatHistory.run({ service: 'zulip', user: '7' }, z.ctx);
  expect(z.asked.at(-1)!.query).toMatchObject({ anchor: 'newest', narrow: '[{"operator":"dm","operand":[7]}]' });
});
