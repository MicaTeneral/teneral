import { test, expect } from 'bun:test';
import { zulipPoller, zulipCredentials } from '../../body/zulip';
import type { Stimulus } from '../../body/sensors';
import type { JournalEvent } from '../../brain/journal';
const credentials = () => ({ site: 'https://example.test', email: 'mica@test', api_key: 'fake' });
test('Zulip DMs sorted, marked untrusted, deduplicated across restart and paginated forward', async () => {
  const notices: Stimulus[] = [];
  const urls: URL[] = [];
  const send = (async (url: URL) => {
    if (url.pathname === "/api/v1/users/me") return new Response(JSON.stringify({user_id:99}));
    urls.push(new URL(url));
    return new Response(JSON.stringify({ messages: [{ id: 2, content: 'hello', type: 'private' }, { id: 1, content: 'earlier', type: 'private' }] }));
  }) as unknown as typeof fetch;
  const p = zulipPoller({ credentials, events: () => [], send }, s => notices.push(s));
  await p.poll(); await p.poll();
  expect(notices).toHaveLength(2);
  expect(notices[0].text).toStartWith('Zulip private 1\n');
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
  const send = (async (url: URL) => {
    if (url.pathname === "/api/v1/users/me") return new Response(JSON.stringify({user_id:99}));
    calls++;
    return new Response(JSON.stringify({ messages: [{ id: 10, content: 'hi', type: 'private' }] }));
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
    if (url.pathname === "/api/v1/users/me") return new Response(JSON.stringify({user_id:99}));
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

test('own echoes are silent; private wakes, plain stream is held, mention wakes', async () => {
  const notices: Stimulus[] = [];
  const anchors: string[] = [];
  const pages = [
    [{id: 1, sender_id: 99, sender_email: 'different@test', content: 'own reply', type: 'stream'}],
    [{id: 2, sender_id: 100, sender_email: 'mica@test', sender_full_name: 'Mica', content: 'own reply', type: 'private'},
     {id: 3, sender_id: 99, sender_email: 'different@test', content: 'own reply', type: 'private'}],
    [{id: 4, sender_id: 98, sender_email: 'a@test', content: 'stream chatter', type: 'stream'},
     {id: 5, sender_id: 97, sender_email: 'b@test', content: 'hello @mica', type: 'stream', flags: ['mentioned']}],
  ];
  const send = (async (url: URL) => {
    if (url.pathname === "/api/v1/users/me") return new Response(JSON.stringify({user_id:99}));
    anchors.push(url.searchParams.get('anchor')!);
    return new Response(JSON.stringify({messages: pages.shift() ?? []}));
  }) as unknown as typeof fetch;
  const p = zulipPoller({credentials, events: () => [], send}, s => notices.push(s));
  await p.poll(); expect(notices).toHaveLength(0);
  await p.poll();
  expect(notices).toHaveLength(1);
  expect(notices[0].text).toStartWith('Zulip private 2\n');
  await p.poll();
  expect(anchors).toEqual(['newest', '1', '3']);
  expect(notices).toHaveLength(3);
  expect(notices[1].text).toStartWith('Zulip mention 5\n');
  expect(notices[2].text).toStartWith('Zulip stream\n');
  expect(notices[2].text).toContain('stream chatter');
});

test('self echoes refetched after restart remain silent', async () => {
  let emitted = 0;
  const send = (async (url: URL) => new Response(JSON.stringify(url.pathname === "/api/v1/users/me" ? {user_id:99} : {messages: [
    {id: 5, sender_id: 99, sender_email: 'different@test'},
  ]}))) as unknown as typeof fetch;
  for (let restart = 0; restart < 2; restart++) {
    const p = zulipPoller({credentials, events: () => [], send}, () => { emitted++; });
    await p.poll(); p.stop();
  }
  expect(emitted).toBe(0);
});

test('identity failures preserve cursor; cache is reused and invalidated on credential rotation', async()=>{
 let key='first', lookups=0, reads=0; const notices:Stimulus[]=[];
 const send=(async(url:URL)=>{
  if(url.pathname==='/api/v1/users/me') {
   lookups++;
   if(lookups===1) return new Response('{}');
   return new Response(JSON.stringify({user_id:key==='first'?99:100}));
  }
  reads++;
  return new Response(JSON.stringify({messages:[{id:reads,sender_id:key==='first'?99:100}]}));
 }) as unknown as typeof fetch;
 const p=zulipPoller({credentials:()=>({...credentials(),api_key:key}),events:()=>[],send},s=>notices.push(s));
 await p.poll();expect(reads).toBe(0);
 await p.poll();await p.poll();expect(lookups).toBe(2);expect(reads).toBe(2);
 key='second';await p.poll();expect(lookups).toBe(3);expect(notices).toHaveLength(0);
});
