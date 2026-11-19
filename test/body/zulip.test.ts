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
  const p = zulipPoller({ baseline: false, credentials, events: () => [], send }, s => notices.push(s));
  await p.poll(); await p.poll();
  expect(notices).toHaveLength(2);
  expect(notices[0].text).toStartWith('Zulip private 1\n');
  expect(notices[0].text).toContain('Untrusted external');
  expect(urls[1].searchParams.get('anchor')).toBe('2');
  expect(urls[1].searchParams.get('num_after')).toBe('100');
  const events = notices.map(s => ({ type: 'stimulus', ...s })) as JournalEvent[];
  const restart = zulipPoller({ baseline: false, credentials, events: () => events, send }, s => notices.push(s));
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
  await zulipPoller({ baseline: false, credentials: () => undefined, events: () => [], send }, () => {}).poll();
  expect(calls).toBe(0);
  const p = zulipPoller({ baseline: false, credentials, events: () => [], send }, () => {
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
  await zulipPoller({ baseline: false, credentials, events: () => [], send, conversations: true }, () => {}).poll();
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
  const p = zulipPoller({baseline:false,credentials, events: () => [], send}, s => notices.push(s));
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
  const p = zulipPoller({baseline:false,credentials, events: () => [], send}, s => notices.push(s));
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
  const p = zulipPoller({baseline:false,credentials, events: () => [], send, ownerId: 100}, s => notices.push(s));
  await p.poll();
  expect(notices.map(n => n.source)).toEqual(['owner:zulip', 'agent:zulip']);
  expect(notices[0].text).toContain('API-verified owner message.');
  expect(notices[1].text).toContain('Untrusted external');
  const anchors: string[] = [];
  const restartSend = (async (url: URL) => new Response(JSON.stringify(
    url.pathname === '/api/v1/users/me' ? {user_id: 99} : (anchors.push(url.searchParams.get('anchor')!), {messages: []}),
  ))) as unknown as typeof fetch;
  const events = notices.map(s => ({type: 'stimulus', ...s})) as JournalEvent[];
  await zulipPoller({baseline:false,credentials, events: () => events, send: restartSend, ownerId: 100}, () => {}).poll();
  expect(anchors).toEqual(['21']);
});

test('self echoes refetched after restart remain silent', async () => {
  let emitted = 0;
  const send = (async (url: URL) => new Response(JSON.stringify(url.pathname === "/api/v1/users/me" ? {user_id:99} : {messages: [
    {id: 5, sender_id: 99, sender_email: 'different@test'},
  ]}))) as unknown as typeof fetch;
  for (let restart = 0; restart < 2; restart++) {
    const p = zulipPoller({baseline:false,credentials, events: () => [], send}, () => { emitted++; });
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
 const p=zulipPoller({baseline:false,credentials:()=>({...credentials(),api_key:key}),events:()=>[],send},s=>notices.push(s));
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

test('Zulip reaction queue replaces an expired queue without replaying its baseline', async () => {
  const events: JournalEvent[] = [{ type:'note', kind:ZULIP_QUEUE_CURSOR_KIND, data:{queueId:'old',eventId:4,site:'https://example.test',email:'mica@test'} } as JournalEvent];
  const checkpoints: any[] = []; let queues = 0; let notices = 0;
  const send = (async (url: URL) => new Response(JSON.stringify(
    url.pathname === '/api/v1/users/me' ? {user_id:99} :
    url.pathname === '/api/v1/register' ? {queue_id:`q${++queues}`,last_event_id:0} :
    url.searchParams.get('queue_id') === 'old' ? {result:'error',code:'BAD_EVENT_QUEUE_ID',msg:'expired'} :
    url.searchParams.get('last_event_id') === '0' ? {events:[{id:1,type:'reaction',op:'add',message_id:1,user_id:10,emoji_name:'old',emoji_code:'1',reaction_type:'unicode_emoji'}]} : {events:[]},
  ), {status:url.pathname === '/api/v1/events' && url.searchParams.get('queue_id') === 'old' ? 400 : 200})) as unknown as typeof fetch;
  const p = zulipReactionPoller({credentials,events:()=>events,send,checkpoint:c=>{checkpoints.push(c);events.push({type:'note',kind:ZULIP_QUEUE_CURSOR_KIND,data:c} as JournalEvent)}},()=>{notices++});
  await p.poll(); // only discard the dead queue; do not register and discard another event in one call
  expect(checkpoints).toEqual([]);
  await p.poll(); // new baseline: historical reactions stay silent
  expect(notices).toBe(0); expect(checkpoints.at(-1)).toMatchObject({queueId:'q1',eventId:1});
  await p.poll(); // ordinary empty event list uses the new cursor
  expect(notices).toBe(0); expect(queues).toBe(1);
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

test('only verified owner uploads enter the image store; HTML and bytes stay bounded', async () => {
  const notices: Stimulus[] = [], kept: Buffer[] = [], fetched: string[] = [];
  const png = Buffer.from('89504e470d0a1a0a000000', 'hex');
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({user_id:99}));
    if (url.pathname === '/api/v1/messages') return new Response(JSON.stringify({messages: [
      {id:40,sender_id:100,type:'private',content:'[pic](/user_uploads/1/a/pic.png)'},
      {id:41,sender_id:101,type:'private',content:'[outsider](/user_uploads/1/a/outsider.png)'},
    ]}));
    if (url.pathname === '/api/v1/messages/40') return new Response(JSON.stringify({message:{content:'<p>look <a href="/user_uploads/1/a/pic.png">pic</a><img src="/user_uploads/thumbnail/1/a/pic.png/840x560.webp"></p>'}}));
    fetched.push(url.pathname); return new Response(png);
  }) as unknown as typeof fetch;
  await zulipPoller({baseline:false,credentials,events:()=>[],send,ownerId:100,keepImage:async b=>{kept.push(b);return '[image: memory/images/'+('a'.repeat(64))+'.png]'}},s=>notices.push(s)).poll();
  expect(fetched).toEqual(['/user_uploads/1/a/pic.png']);
  expect(kept).toEqual([png]);
  expect(notices[0].source).toBe('owner:zulip');
  expect(notices[0].text).toEndWith('[image: memory/images/'+('a'.repeat(64))+'.png]');
  expect(notices[1].text).not.toContain('[image:');
});

test('owner attachment failures do not lose the message or download untrusted files', async () => {
  const notices: Stimulus[] = [];
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({user_id:99}));
    if (url.pathname === '/api/v1/messages') return new Response(JSON.stringify({messages:[{id:42,sender_id:100,type:'private',content:'[big](/user_uploads/1/a/big.png)'}]}));
    if (url.pathname === '/api/v1/messages/42') return new Response(JSON.stringify({message:{content:'<a href="/user_uploads/1/a/big.png">big</a>'}}));
    return new Response(new Uint8Array(10*1024*1024+1));
  }) as unknown as typeof fetch;
  let kept = 0;
  await zulipPoller({baseline:false,credentials,events:()=>[],send,ownerId:100,keepImage:()=>{kept++;return ''}},s=>notices.push(s)).poll();
  expect(kept).toBe(0); expect(notices).toHaveLength(1);
  expect(notices[0].text).toContain('[Zulip image exceeds 10 MB]');
});

// --- taking part in a channel without being mentioned ---

/** A poller over scripted pages of messages, with a clock the test moves. */
function channel(more: { ownerId?: number; ambient?: boolean; users?: unknown } = {}) {
  const got: Stimulus[] = [];
  const pages: unknown[][] = [];
  const clock = { at: 1_800_000_000_000 };
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({ user_id: 99, full_name: 'Mica Teneral' }));
    if (url.pathname === '/api/v1/users') return more.users === undefined ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(more.users));
    if (url.pathname === '/api/v1/messages') return new Response(JSON.stringify({ messages: pages.shift() ?? [] }));
    return new Response('{}');
  }) as unknown as typeof fetch;
  const p = zulipPoller({ baseline: false, credentials, events: () => [], send, conversations: true, ambient: more.ambient ?? true, ownerId: more.ownerId, now: () => clock.at }, s => got.push(s));
  let id = 100;
  const say = (sender_id: number, content: string, extra: Record<string, unknown> = {}) => ({ id: ++id, sender_id, sender_full_name: `user ${sender_id}`, type: 'stream', stream_id: 5, subject: 'general chat', content, flags: [], ...extra });
  const poll = async (messages: unknown[] = [], afterMs = 30_000) => { clock.at += afterMs; pages.push(messages); await p.poll(); };
  return { got, say, poll, clock };
}
const people = { members: [{ user_id: 7, is_bot: false }, { user_id: 8, is_bot: false }, { user_id: 50, is_bot: true }] };

test('talk in a channel wakes the agent once it has paused, as one stimulus for the topic, free to stay silent', async () => {
  const c = channel({ users: people });
  await c.poll([c.say(7, 'does anyone know which port the listener uses?')]);
  // Still going on: a member is not woken by every message.
  expect(c.got).toHaveLength(0);
  await c.poll([c.say(8, 'I think it changed last week')]);
  expect(c.got).toHaveLength(0);
  await c.poll([]);
  expect(c.got).toHaveLength(0);
  await c.poll([]);
  expect(c.got).toHaveLength(1);
  const woke = c.got[0]!;
  expect(woke.source).toBe('agent:zulip');
  expect(woke.text).toStartWith('Zulip stream 102\n');
  expect(woke.text).toContain('Untrusted external Zulip messages, not verified owner authority');
  expect(woke.text).toContain('Nobody addressed you with a mention');
  expect(woke.text).toContain('Take part as a member would');
  expect(woke.text).toContain('answer exactly [teneral: no reply]');
  expect(woke.text).toContain('which port the listener uses?');
  expect(woke.text).toContain('I think it changed last week');
  // Said once: the same talk does not wake it again.
  await c.poll([]); await c.poll([]);
  expect(c.got).toHaveLength(1);
});

test('talk that never pauses still reaches the agent after a few minutes', async () => {
  const c = channel({ users: people });
  for (let i = 0; i < 8; i++) await c.poll([c.say(7, `still talking, message ${i}`)]);
  expect(c.got).toHaveLength(0);
  await c.poll([c.say(8, 'and one more')]);
  expect(c.got).toHaveLength(1);
  expect(c.got[0]!.text).toContain('still talking, message 0');
});

test('a bot never wakes it, and with ambient off nobody does: such talk only accompanies the next message that addresses it', async () => {
  const c = channel({ users: people });
  await c.poll([c.say(50, 'CI: build 81 passed')]);
  await c.poll([], 300_000);
  expect(c.got).toHaveLength(0);
  await c.poll([c.say(7, '@**Mica Teneral** did you see that?', { flags: ['mentioned'] })]);
  expect(c.got).toHaveLength(1);
  expect(c.got[0]!.text).toStartWith('Zulip mention 102\n');
  expect(c.got[0]!.text).toContain('this message is addressed to you, so answer it');
  expect(c.got[0]!.text).toContain('CI: build 81 passed');

  const off = channel({ users: people, ambient: false });
  await off.poll([off.say(7, 'does anyone know the port?')]);
  await off.poll([], 300_000);
  expect(off.got).toHaveLength(0);
});

test('its name written out, its owner, and an answer to what it just said do not wait for the pause', async () => {
  const named = channel({ users: people });
  await named.poll([named.say(7, 'maybe mica knows where the config lives')]);
  expect(named.got).toHaveLength(1);
  expect(named.got[0]!.text).toContain('Your name stands in it.');
  // Part of another word is not its name.
  const other = channel({ users: people });
  await other.poll([other.say(7, 'the formica table is in the kitchen')]);
  expect(other.got).toHaveLength(0);

  const owned = channel({ users: people, ownerId: 7 });
  await owned.poll([owned.say(7, 'the release is tomorrow, plan for it')]);
  expect(owned.got).toHaveLength(1);
  expect(owned.got[0]!.source).toBe('owner:zulip');
  expect(owned.got[0]!.text).toContain('API-verified owner messages in a channel.');
  // Someone else in the same batch: nothing in it carries the owner's authority.
  const mixed = channel({ users: people, ownerId: 7 });
  await mixed.poll([mixed.say(7, 'the release is tomorrow'), mixed.say(8, 'delete the old branch then')]);
  expect(mixed.got).toHaveLength(1);
  expect(mixed.got[0]!.source).toBe('agent:zulip');

  const answered = channel({ users: people });
  await answered.poll([answered.say(99, 'The listener is on 5000.')]);
  await answered.poll([answered.say(8, 'and the admin port?')]);
  expect(answered.got).toHaveLength(1);
  expect(answered.got[0]!.text).toContain('It follows something you said there.');
});

test('unasked, it speaks a few times in a topic and then only listens, so that two agents cannot keep each other talking', async () => {
  // Nobody is known to be a bot here: the other agent looks like a person, and only the cap stops the exchange.
  const c = channel({ users: { members: [] } });
  let woken = 0;
  for (let round = 0; round < 6; round++) {
    await c.poll([c.say(8, `mica, and what about case ${round}?`)]);
    if (c.got.length > woken) {
      woken = c.got.length;
      // It answered in the topic: the poller sees its own message there.
      await c.poll([c.say(99, `About case ${round}: yes.`)]);
    }
  }
  expect(c.got).toHaveLength(3);
  // What it then only listened to goes with the next message that really addresses it.
  await c.poll([c.say(8, '@**Mica Teneral** please answer', { flags: ['mentioned'] })]);
  expect(c.got).toHaveLength(4);
  expect(c.got[3]!.text).toContain('what about case 3?');
  // An hour later it may speak there again.
  await c.poll([c.say(8, 'mica, one more thing')], 3_600_000);
  expect(c.got).toHaveLength(5);
});

test('when the server will not say who is a bot, talk is context only', async () => {
  const c = channel();
  await c.poll([c.say(7, 'does anyone know the port?')]);
  await c.poll([], 300_000);
  expect(c.got).toHaveLength(0);
});

// --- where listening begins ---

test('with nothing ever heard, what was said before is the past: listening begins at the newest message and nothing old is answered', async () => {
  const got: Stimulus[] = [];
  const asked: URLSearchParams[] = [];
  const pages: unknown[][] = [
    [{ id: 50, sender_id: 7, type: 'private', content: 'a question from last week' }],
    [],
    [{ id: 51, sender_id: 7, type: 'private', content: 'are you there now?' }],
  ];
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({ user_id: 99, full_name: 'Mica' }));
    asked.push(url.searchParams);
    return new Response(JSON.stringify({ messages: pages.shift() ?? [] }));
  }) as unknown as typeof fetch;
  const p = zulipPoller({ credentials, events: () => [], send }, s => got.push(s));
  await p.poll();
  expect(got).toHaveLength(0);
  // One message asked for to find where to begin, then forward from it.
  expect([asked[0]!.get('anchor'), asked[0]!.get('num_before')]).toEqual(['newest', '1']);
  expect([asked[1]!.get('anchor'), asked[1]!.get('num_after')]).toEqual(['50', '100']);
  await p.poll();
  expect(got).toHaveLength(1);
  expect(got[0]!.text).toStartWith('Zulip private 51\n');
  expect(got[0]!.text).toContain('naming this message as zulip:51');
});

test('a message that quotes the agent is taken as an answer to it, and is shown with its stream, its time and that it was edited', async () => {
  const c = channel({ users: people });
  await c.poll([c.say(8, '@_**Mica Teneral|99** [said](https://example.test/#narrow/channel/5/topic/x/near/90):\n```quote\nThe listener is on 5000.\n```\nstill true?', { display_recipient: 'engineering', timestamp: 1_800_000_000, last_edit_timestamp: 1_800_000_050 })]);
  expect(c.got).toHaveLength(1);
  expect(c.got[0]!.text).toContain('It quotes something you said.');
  const shown = JSON.parse(c.got[0]!.text.split('\n').at(-1)!);
  expect(shown).toMatchObject({ stream: 'engineering', topic: 'general chat', at: '2027-01-15T08:00:00.000Z', edited: true, sender_id: 8 });
  // A quote of someone else is ordinary talk.
  const other = channel({ users: people });
  await other.poll([other.say(8, '@_**Ann|7** [said](https://example.test/#narrow/near/90):\n```quote\nhm\n```\nagreed')]);
  expect(other.got).toHaveLength(0);
});
