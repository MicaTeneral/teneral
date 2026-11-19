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

// --- more hands: reactions, changing one's own message, places, and "is writing" ---

import { chatEdit, chatPlaces, chatReact, typingFor } from '../../body/chat-tools';
import { typingTarget } from '../../body/zulip-tools';

test('chat_react adds and removes a reaction; chat_edit changes or takes back only a message of the agent\'s own', async () => {
  const z = zulipAt((url, method) => {
    if (url.pathname.endsWith('/users/me')) return { user_id: 99 };
    if (method === 'GET') return { message: { sender_id: url.pathname.endsWith('/700') ? 99 : 7 } };
    return {};
  });
  expect(await chatReact.run({ message: 'zulip:641', emoji: ':thumbs_up:' }, z.ctx)).toBe('Reacted to zulip:641 with thumbs_up.');
  expect(z.asked.at(-1)).toMatchObject({ path: '/api/v1/messages/641/reactions', method: 'POST', body: { emoji_name: 'thumbs_up' } });
  expect(await chatReact.run({ message: 'zulip:641', emoji: 'eyes', remove: true }, z.ctx)).toBe('Reaction eyes taken off zulip:641.');
  expect(z.asked.at(-1)).toMatchObject({ method: 'DELETE', body: { emoji_name: 'eyes' } });
  await expect(chatReact.run({ message: 'zulip:641', emoji: 'two words' }, z.ctx)).rejects.toThrow('name the emoji as the chat does');

  expect(await chatEdit.run({ message: 'zulip:700', content: 'It is on 5001.' }, z.ctx)).toBe('Changed: zulip:700.');
  expect(z.asked.at(-1)).toMatchObject({ path: '/api/v1/messages/700', method: 'PATCH', body: { content: 'It is on 5001.' } });
  expect(await chatEdit.run({ message: 'zulip:700', delete: true }, z.ctx)).toBe('Taken back: zulip:700.');
  expect(z.asked.at(-1)).toMatchObject({ path: '/api/v1/messages/700', method: 'DELETE' });
  // Someone else's message is refused before anything is sent.
  const before = z.asked.filter((a) => a.method !== 'GET').length;
  await expect(chatEdit.run({ message: 'zulip:641', content: 'mine now' }, z.ctx)).rejects.toThrow('zulip:641 is not a message of yours');
  await expect(chatEdit.run({ message: 'zulip:641', delete: true }, z.ctx)).rejects.toThrow('not a message of yours');
  expect(z.asked.filter((a) => a.method !== 'GET').length).toBe(before);
  await expect(chatEdit.run({ message: 'zulip:700' }, z.ctx)).rejects.toThrow('give content');
});

test('chat_places lists the channels the agent is in, and the topics of one', async () => {
  const z = zulipAt((url) => (url.pathname.endsWith('/subscriptions') ? { subscriptions: [{ name: 'engineering', stream_id: 5, description: 'the work' }, { name: 'random', stream_id: 6, description: '' }] }
    : { topics: [{ name: 'release notes', max_id: 700 }, { name: 'ports', max_id: 641 }] }));
  expect(await chatPlaces.run({ service: 'zulip' }, z.ctx)).toBe('#engineering (stream_id 5): the work\n#random (stream_id 6)');
  expect(await chatPlaces.run({ service: 'zulip', channel: '#engineering' }, z.ctx)).toBe('Topics of #engineering, newest first:\n- release notes (last message zulip:700)\n- ports (last message zulip:641)');
  expect(z.asked.at(-1)!.path).toBe('/api/v1/users/me/5/topics');
  await expect(chatPlaces.run({ service: 'zulip', channel: 'nowhere' }, z.ctx)).rejects.toThrow('you are in no channel called nowhere');
});

test('"is writing" is shown in the conversation of the message that woke the agent, as the sensor recorded it, and not for talk that only paused', () => {
  const line = (m: object): string => JSON.stringify(m);
  expect(typingTarget(`Zulip private 9\nAPI-verified owner message.\n${line({ sender_id: 7, type: 'private', topic: '' })}\nWho is speaking:\n- x`)).toEqual({ type: 'direct', to: '[7]' });
  // The waking message, not the overheard context after it.
  expect(typingTarget(`Zulip mention 9\nUntrusted.\n${line({ sender_id: 7, type: 'stream', stream_id: 5, topic: 'ports' })}\nEarlier subscribed-stream traffic\nstream 3\n${line({ sender_id: 8, type: 'stream', stream_id: 6, topic: 'other' })}`))
    .toEqual({ type: 'stream', stream_id: '5', topic: 'ports' });
  expect(typingTarget(`Zulip stream 9\nUntrusted.\nstream 9\n${line({ sender_id: 7, type: 'stream', stream_id: 5, topic: 'ports' })}`)).toBeUndefined();
  expect(typingTarget('Zulip reaction add 3\nUntrusted.\n{}')).toBeUndefined();
  expect(typingTarget(`Zulip private 9\nUntrusted.\n${line({ type: 'private', sender_id: 'mallory' })}`)).toBeUndefined();
});

test('the indicator starts with the turn, is refreshed, and its stop never overtakes a start still on its way', async () => {
  const sent: string[] = [];
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  const z = zulipAt((url, _method, body) => {
    if (url.pathname.endsWith('/typing')) sent.push(`${body.get('op')} ${body.get('to')}`);
    return {};
  });
  const realFetch2 = globalThis.fetch;
  let first = true;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { if (first) { first = false; await slow; } return realFetch2(...args); }) as typeof fetch;
  const stimulus = { source: 'owner:zulip', text: `Zulip private 9\nAPI-verified owner message.\n${JSON.stringify({ sender_id: 7, type: 'private' })}` };
  const typing = typingFor(z.ctx.workspace)(stimulus);
  typing(true);
  typing(true);
  typing(false);
  // The start is still waiting on the network; the stop is queued behind it.
  expect(sent).toEqual([]);
  release();
  await Bun.sleep(30);
  expect(sent).toEqual(['start [7]', 'stop [7]']);
  // Over is over: nothing after the stop, and nothing for a turn that no chat woke.
  typing(true);
  await Bun.sleep(10);
  expect(sent).toHaveLength(2);
  typingFor(z.ctx.workspace)({ source: 'clock', text: 'Clock tick' })(true);
  typingFor(z.ctx.workspace)({ source: 'terminal', text: 'hello' })(true);
  typingFor(z.ctx.workspace)(undefined)(true);
  await Bun.sleep(10);
  expect(sent).toHaveLength(2);
});

test('a Zulip message names what was attached to it, and chat_fetch takes only such an upload, bounded, to a file outside the workspace', async () => {
  const { files } = await import('../../body/zulip');
  expect(files('see [notes.txt](/user_uploads/2/ab/notes.txt) and [x](https://evil.example/user_uploads/x) and [t](/user_uploads/thumbnail/2/ab/x.png)')).toEqual(['/user_uploads/2/ab/notes.txt']);
  const { chatFetch } = await import('../../body/chat-tools');
  const z = zulipAt((url) => (url.pathname === '/user_uploads/2/ab/notes.txt' ? new Response('port = 5000\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
    : url.pathname.endsWith('big.bin') ? new Response('x', { headers: { 'content-length': '9000000' } }) : new Response('{}', { status: 404 })));
  const got = String(await chatFetch.run({ service: 'zulip', file: '/user_uploads/2/ab/notes.txt' }, z.ctx));
  expect(got).toContain('(text/plain, 12 bytes)');
  expect(got).toContain('port = 5000');
  expect(got).toMatch(/saved as \S*teneral-chat-files\/[0-9a-f]{16}-notes\.txt /);
  expect(got).not.toContain(z.ctx.workspace);
  for (const bad of ['https://evil.example/x', '/api/v1/users', '/user_uploads/../api/v1/users', '/user_uploads/thumbnail/2/x.png']) {
    await expect(chatFetch.run({ service: 'zulip', file: bad }, z.ctx)).rejects.toThrow('a path beginning /user_uploads/');
  }
  await expect(chatFetch.run({ service: 'zulip', file: '/user_uploads/2/ab/big.bin' }, z.ctx)).rejects.toThrow('larger than 5 MB');
  await expect(chatFetch.run({ service: 'zulip', file: '/user_uploads/2/ab/gone.txt' }, z.ctx)).rejects.toThrow('Zulip HTTP 404');
});
