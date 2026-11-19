import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaybeSent, OPENED_MAX, chatHistory, chatReply, chatSend, parts, reference, register, type ChatService, type Destination } from '../../body/chat-tools';
import { appendEvent } from '../../brain/journal';
import type { ToolContext } from '../../body/tools';

// A service that does not exist: the tools may know nothing of a real one.
function parley(more: Partial<ChatService> = {}) {
  const sent: { to: string | Destination; content: string; everyone?: boolean }[] = [];
  let next = 100;
  const service: ChatService = {
    name: 'parley', limit: 40,
    reply: async (_ctx, id, content, everyone) => { sent.push({ to: id, content, everyone }); return String(++next); },
    send: async (_ctx, to, content) => { sent.push({ to, content }); return String(++next); },
    history: async (_ctx, where) => `history of ${JSON.stringify(where)}`,
    knows: (_ctx, _events, user) => user === 'u7',
    ...more,
  };
  register(service);
  const journal = join(mkdtempSync(join(tmpdir(), 'teneral-chat-')), 'journal.jsonl');
  appendEvent(journal, 'g', { type: 'stimulus', source: 'birth', text: 'Hello.' });
  return { sent, ctx: { journal, gen: 'g', workspace: '/nowhere' } as ToolContext };
}

test('a message is named by its service and id, and nothing else passes for one', () => {
  parley();
  expect(reference('parley:m-12').id).toBe('m-12');
  expect(reference(' parley:12 ').service.name).toBe('parley');
  expect(() => reference('12')).toThrow('the service, a colon and its id');
  expect(() => reference('nowhere:12')).toThrow('no chat service of that name. Known:');
  expect(() => reference(12)).toThrow();
});

test('a long text is cut between paragraphs, then lines, then words, and a code block cut in two is closed and opened again', () => {
  expect(parts('short', 40)).toEqual(['short']);
  const two = parts(`${'a'.repeat(30)}\n\n${'b'.repeat(30)}`, 40);
  expect(two).toEqual(['a'.repeat(30), 'b'.repeat(30)]);
  for (const part of parts('word '.repeat(60), 40)) expect(part.length).toBeLessThanOrEqual(40);
  const code = parts(`intro\n\`\`\`ts\n${'let x = 1;\n'.repeat(8)}\`\`\`\nend`, 60);
  expect(code.length).toBeGreaterThan(1);
  for (const part of code) {
    expect(part.length).toBeLessThanOrEqual(60);
    expect((part.match(/^```/gm) ?? []).length % 2).toBe(0);
  }
  expect(code.join('\n')).toContain('end');
});

test('chat_reply answers where the message was said, in parts when it is long, and only to the sender of a group unless told', async () => {
  const p = parley();
  expect(await chatReply.run({ message: 'parley:9', content: 'hello there' }, p.ctx)).toBe('Reply sent as parley:101.');
  expect(p.sent).toEqual([{ to: '9', content: 'hello there', everyone: false }]);
  const long = `${'first paragraph '.repeat(2).trim()}\n\n${'second paragraph '.repeat(2).trim()}`;
  expect(await chatReply.run({ message: 'parley:9', content: long, everyone: true }, p.ctx)).toBe('Reply sent as parley:102, parley:103 (2 parts).');
  expect(p.sent.slice(1).map((s) => [s.content, s.everyone])).toEqual([['first paragraph first paragraph', true], ['second paragraph second paragraph', true]]);
  await expect(chatReply.run({ message: 'parley:9', content: '  ' }, p.ctx)).rejects.toThrow('content must say something');
  await expect(chatReply.run({ message: 'parley:9', content: 'x '.repeat(400) }, p.ctx)).rejects.toThrow('say it shorter, or put it in a file');
});

test('a send that failed half-way says which parts went out, and one that may have gone out says to look before sending again', async () => {
  let calls = 0;
  const p = parley({ reply: async () => { calls += 1; if (calls === 2) throw new MaybeSent('no answer from Parley'); return `m${calls}`; } });
  const long = `${'a'.repeat(30)}\n\n${'b'.repeat(30)}\n\n${'c'.repeat(30)}`;
  await expect(chatReply.run({ message: 'parley:9', content: long }, p.ctx)).rejects.toThrow(
    'part 2 of 3 may or may not have been sent: no answer from Parley. Read the conversation back before you send it again. Already sent: parley:m1 (part 1 of 3); do not send those again.');
  expect(calls).toBe(2);
  const refused = parley({ reply: async () => { throw new Error('Parley HTTP 403'); } });
  await expect(chatReply.run({ message: 'parley:9', content: 'hello' }, refused.ctx)).rejects.toThrow('part 1 of 1 was not sent: Parley HTTP 403.');
});

test('chat_send opens a topic or writes to a person, but first only to those who wrote to it, and not endlessly in one channel', async () => {
  const p = parley();
  expect(await chatSend.run({ service: 'parley', user: 'u7', content: 'the build is green' }, p.ctx)).toBe('Message sent as parley:101.');
  expect(p.sent[0]).toEqual({ to: { user: 'u7' }, content: 'the build is green' });
  await expect(chatSend.run({ service: 'parley', user: 'u9', content: 'hello' }, p.ctx)).rejects.toThrow('you may write first only to your owner and to people who have written to you on parley; u9 is neither');
  await expect(chatSend.run({ service: 'parley', channel: 'lobby', content: 'hello' }, p.ctx)).rejects.toThrow('with channel, give thread');
  await expect(chatSend.run({ service: 'parley', channel: 'lobby', thread: 't', user: 'u7', content: 'hello' }, p.ctx)).rejects.toThrow('give either channel with thread, or user');
  await expect(chatSend.run({ service: 'parley', content: 'hello' }, p.ctx)).rejects.toThrow('give either channel with thread, or user');

  // The loop journals the intent before the tool runs; the count is of those, so a restart does not give the hour back.
  const open = async (channel: string): Promise<unknown> => {
    const args = { service: 'parley', channel, thread: 'news', content: 'something new' };
    appendEvent(p.ctx.journal, 'g', { type: 'tool.intent', callId: 'c', name: 'chat_send', args });
    return chatSend.run(args, p.ctx);
  };
  for (let i = 0; i < OPENED_MAX; i++) expect(await open('lobby')).toContain('Message sent as');
  await expect(open('lobby')).rejects.toThrow(`you have opened ${OPENED_MAX} messages nobody asked for in lobby within the hour`);
  expect(await open('other')).toContain('Message sent as');
  expect(p.sent.at(-1)).toEqual({ to: { channel: 'other', thread: 'news' }, content: 'something new' });
});

test('what a service cannot do, the tool says, and history is asked of the service by place', async () => {
  const p = parley();
  expect(await chatHistory.run({ service: 'parley', channel: 'lobby', thread: 'news', before: '12' }, p.ctx)).toBe('history of {"channel":"lobby","thread":"news","before":"12"}');
  const bare = parley({ send: undefined, history: undefined });
  await expect(chatSend.run({ service: 'parley', user: 'u7', content: 'x' }, bare.ctx)).rejects.toThrow('parley can only be answered: use chat_reply');
  await expect(chatHistory.run({ service: 'parley' }, bare.ctx)).rejects.toThrow('keeps no history');
});
