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
  expect(notices).toHaveLength(2);
  expect(notices[1].text).toStartWith('Zulip mention 5\n');
  expect(notices[1].text).toContain('stream chatter');
});

test('ordinary stream pages stay silent until a later private message carries their context', async () => {
  const notices: Stimulus[] = [];
  const pages = [
    [{id: 10, sender_id: 98, type: 'stream', content: 'background only'}],
    [{id: 11, sender_id: 97, type: 'private', content: 'a real question'}],
  ];
  const send = (async (url: URL) => new Response(JSON.stringify(
    url.pathname === '/api/v1/users/me' ? {user_id: 99} : {messages: pages.shift() ?? []},
  ))) as unknown as typeof fetch;
  const p = zulipPoller({credentials, events: () => [], send}, s => notices.push(s));
  await p.poll();
  expect(notices).toHaveLength(0);
  await p.poll();
  expect(notices).toHaveLength(1);
  expect(notices[0].text).toStartWith('Zulip private 11\n');
  expect(notices[0].text).toContain('background only');
});

test('only the configured numeric Zulip sender becomes an owner source; both sources restore the cursor', async () => {
  const notices: Stimulus[] = [];
  const send = (async (url: URL) => new Response(JSON.stringify(
    url.pathname === '/api/v1/users/me' ? {user_id: 99} : {messages: [
      {id: 20, sender_id: 100, type: 'private', content: 'owner'},
      {id: 21, sender_id: 101, type: 'private', content: 'outsider'},
    ]},
  ))) as unknown as typeof fetch;
  const p = zulipPoller({credentials, events: () => [], send, ownerId: 100}, s => notices.push(s));
  await p.poll();
  expect(notices.map(n => n.source)).toEqual(['owner:zulip', 'agent:zulip']);
  expect(notices[0].text).toContain('API-verified owner message.');
  expect(notices[1].text).toContain('Untrusted external');
  const anchors: string[] = [];
  const restartSend = (async (url: URL) => new Response(JSON.stringify(
    url.pathname === '/api/v1/users/me' ? {user_id: 99} : (anchors.push(url.searchParams.get('anchor')!), {messages: []}),
  ))) as unknown as typeof fetch;
  const events = notices.map(s => ({type: 'stimulus', ...s})) as JournalEvent[];
  await zulipPoller({credentials, events: () => events, send: restartSend, ownerId: 100}, () => {}).poll();
  expect(anchors).toEqual(['21']);
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

import { zulipReactionPoller, ZULIP_REACTION_SOURCE, ZULIP_QUEUE_CURSOR_KIND } from '../../body/zulip';

test('Zulip reaction queue baselines history, emits add/remove, and checkpoints after delivery', async () => {
  const notices: Stimulus[] = [];
  const checkpoints: any[] = [];
  const registrations: string[] = [];
  let eventCalls = 0;
  const send = (async (url: URL, init: RequestInit = {}) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({user_id:99}));
    if (url.pathname === '/api/v1/register') {
      registrations.push(String(init.body));
      return new Response(JSON.stringify({queue_id:'q1',last_event_id:10}));
    }
    eventCalls++;
    expect(url.searchParams.get('queue_id')).toBe('q1');
    return new Response(JSON.stringify({events:eventCalls === 1 ? [
      {id:11,type:'reaction',op:'add',message_id:7,user_id:42,emoji_name:'old',emoji_code:'1',reaction_type:'unicode_emoji'},
    ] : [
      {id:12,type:'reaction',op:'add',message_id:7,user_id:99,emoji_name:'self',emoji_code:'2',reaction_type:'unicode_emoji'},
      {id:13,type:'reaction',op:'add',message_id:7,user_id:42,emoji_name:'wave',emoji_code:'1f44b',reaction_type:'unicode_emoji'},
      {id:14,type:'message',id2:0},
      {id:15,type:'reaction',op:'remove',message_id:7,user_id:42,emoji_name:'wave',emoji_code:'1f44b',reaction_type:'unicode_emoji'},
    ]}));
  }) as unknown as typeof fetch;
  const events: JournalEvent[] = [];
  const p = zulipReactionPoller({credentials, events:()=>events, send, checkpoint:c=>{
    checkpoints.push(c);
    events.push({type:'note',kind:ZULIP_QUEUE_CURSOR_KIND,data:c} as JournalEvent);
  }}, s=>{ notices.push(s); events.push({type:'stimulus',...s} as JournalEvent); });
  await p.poll();
  expect(notices).toHaveLength(0);
  expect(registrations[0]).toContain('event_types');
  expect(registrations[0]).toContain('reaction');
  const registration = new URLSearchParams(registrations[0]);
  expect(JSON.parse(registration.get('client_capabilities')!)).toEqual({ notification_settings_null: true });
  expect(JSON.parse(registration.get('event_types')!)).toEqual(['reaction']);
  expect(checkpoints).toEqual([{queueId:'q1',eventId:11,site:'https://example.test',email:'mica@test'}]);
  await p.poll();
  expect(notices).toHaveLength(2);
  expect(notices.every(n=>n.source===ZULIP_REACTION_SOURCE)).toBe(true);
  expect(notices[0].text).toContain('"op":"add"');
  expect(notices[0].text).toContain('"message_id":7');
  expect(notices[1].text).toContain('"op":"remove"');
  expect(notices[0].text).toContain('not owner authority');
  expect(checkpoints.at(-1).eventId).toBe(15);
  // Restart from the journal cursor: no registration, no historical or duplicate wake.
  const anchors: string[]=[];
  const restartedSend=(async(url:URL)=>{
    if(url.pathname==='/api/v1/users/me')return new Response(JSON.stringify({user_id:99}));
    anchors.push(url.searchParams.get('last_event_id')!);
    return new Response(JSON.stringify({events:[]}));
  }) as unknown as typeof fetch;
  await zulipReactionPoller({credentials,events:()=>events,send:restartedSend},()=>{throw Error('duplicate')}).poll();
  expect(anchors).toEqual(['15']);
});

test('Zulip reaction queue retries a partial batch and does not checkpoint before emit returns', async () => {
  const events: JournalEvent[]=[]; const checkpoints:any[]=[]; let batches=0; let notices=0;
  const send=(async(url:URL)=>new Response(JSON.stringify(
    url.pathname==='/api/v1/users/me'?{user_id:99}:
    url.pathname==='/api/v1/register'?{queue_id:'q',last_event_id:0}:
    {events:batches++===0?[]:[
      {id:1,type:'reaction',op:'add',message_id:1,user_id:10,emoji_name:'a',emoji_code:'1',reaction_type:'unicode_emoji'},
      {id:2,type:'reaction',op:'add',message_id:1,user_id:11,emoji_name:'b',emoji_code:'2',reaction_type:'unicode_emoji'},
    ]},
  ))) as unknown as typeof fetch;
  const emit=(s:Stimulus)=>{
    notices++;
    events.push({type:'stimulus',...s} as JournalEvent);
    if(notices===1) throw Error('journal failed after append');
  };
  const p=zulipReactionPoller({credentials,events:()=>events,send,checkpoint:c=>{checkpoints.push(c);events.push({type:'note',kind:ZULIP_QUEUE_CURSOR_KIND,data:c} as JournalEvent)}},emit);
  await p.poll(); await p.poll();
  expect(checkpoints).toHaveLength(1); // baseline only
  await p.poll();
  expect(notices).toBe(2); // first event re-read, suppressed from journal, second delivered
  expect(checkpoints.at(-1).eventId).toBe(2);
});
