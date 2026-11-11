import { test, expect } from 'bun:test';
import { zulipPoller, zulipCredentials } from '../../body/zulip';
import type { Stimulus } from '../../body/sensors';
import type { JournalEvent } from '../../kernel/journal';
const credentials = () => ({ site: 'https://example.test', email: 'mica@test', api_key: 'fake' });
test('Zulip DMs sorted, marked untrusted, deduplicated across restart and paginated forward', async () => {
  const notices: Stimulus[] = [];
  const urls: URL[] = [];
  const send = (async (url: URL) => {
    urls.push(new URL(url));
    return new Response(JSON.stringify({ messages: [{ id: 2, content: 'hello' }, { id: 1, content: 'earlier' }] }));
  }) as unknown as typeof fetch;
  const p = zulipPoller({ credentials, events: () => [], send }, s => notices.push(s));
  await p.poll(); await p.poll();
  expect(notices).toHaveLength(2);
  expect(notices[0].text).toStartWith('Zulip DM 1\n');
  expect(notices[0].text).toContain('Untrusted external');
  expect(urls[1].searchParams.get('anchor')).toBe('2');
  expect(urls[1].searchParams.get('num_after')).toBe('100');
  const events = notices.map(s => ({ type: 'stimulus', ...s })) as JournalEvent[];
  const restart = zulipPoller({ credentials, events: () => events, send }, s => notices.push(s));
  await restart.poll(); expect(notices).toHaveLength(2);
  restart.stop(); const count = urls.length; await restart.poll(); expect(urls).toHaveLength(count);
});
test('Zulip absent credentials do not fetch; failure retries without advancing cursor', async () => {
  expect(zulipCredentials('/nonexistent/mica-zulip.json')).toBeUndefined();
  let calls = 0, attempts = 0;
  const send = (async () => {
    calls++;
    return new Response(JSON.stringify({ messages: [{ id: 10, content: 'hi' }] }));
  }) as unknown as typeof fetch;
  await zulipPoller({ credentials: () => undefined, events: () => [], send }, () => {}).poll();
  expect(calls).toBe(0);
  const p = zulipPoller({ credentials, events: () => [], send }, () => {
    attempts++; if (attempts === 1) throw Error('journal unavailable');
  });
  await p.poll(); await p.poll(); await p.poll();
  expect(attempts).toBe(2);
});

test('conversation mode fetches streams as well as DMs and publishes presence after polling', async () => {
  const urls: string[] = [];
  const send = (async (url: URL, init: RequestInit) => {
    urls.push(String(url));
    if (urls.length === 1) {
      expect(url.searchParams.get('narrow')).toBe('[]');
      return new Response(JSON.stringify({ messages: [] }));
    }
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('status=active');
    return new Response('{}');
  }) as unknown as typeof fetch;
  await zulipPoller({ credentials, events: () => [], send, conversations: true }, () => {}).poll();
  expect(urls[1]).toEndWith('/users/me/presence');
});

test('own echoes are silent, self-only pages advance, and incoming identity is not guessed from text', async () => {
  const notices: Stimulus[] = [];
  const anchors: string[] = [];
  const pages = [
    [{id: 1, sender_email: 'mica@test', content: 'own reply'}],
    [{id: 2, sender_email: 'human@test', sender_full_name: 'Mica', content: 'own reply'},
     {id: 3, sender_email: 'mica@test', content: 'own reply'}],
    [{id: 4, content: 'unknown sender still delivered'}],
  ];
  const send = (async (url: URL) => {
    anchors.push(url.searchParams.get('anchor')!);
    return new Response(JSON.stringify({messages: pages.shift() ?? []}));
  }) as unknown as typeof fetch;
  const p = zulipPoller({credentials, events: () => [], send}, s => notices.push(s));
  await p.poll(); expect(notices).toHaveLength(0);
  await p.poll(); await p.poll();
  expect(anchors).toEqual(['newest', '1', '3']);
  expect(notices).toHaveLength(2);
  expect(notices[0].text).toStartWith('Zulip DM 2\n');
  expect(notices[1].text).toStartWith('Zulip DM 4\n');
});

test('self echoes refetched after restart remain silent', async () => {
  let emitted = 0;
  const send = (async () => new Response(JSON.stringify({messages: [
    {id: 5, sender_email: 'mica@test'},
  ]}))) as unknown as typeof fetch;
  for (let restart = 0; restart < 2; restart++) {
    const p = zulipPoller({credentials, events: () => [], send}, () => { emitted++; });
    await p.poll(); p.stop();
  }
  expect(emitted).toBe(0);
});
