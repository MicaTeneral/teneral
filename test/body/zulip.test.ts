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

test('a cursor that ran ahead of the journal is rewound so no DM is skipped', async () => {
  const notices: Stimulus[] = [];
  // Emitted stimuli land in `events` (the durable journal), but only after the synchronous part
  // of the emit returns. The first pass emits id 1 normally. The second pass fetches id 2 and
  // advances its in-memory cursor, but its emit is interrupted before it reaches the journal —
  // modelling a stop mid-turn. The durable floor stays at 1 while the in-memory cursor says 2.
  const events: JournalEvent[] = [];
  const pages = [
    [{id: 1, sender_id: 100, type: 'private', content: 'first'}],
    [{id: 2, sender_id: 100, type: 'private', content: 'second'}],
    [{id: 2, sender_id: 100, type: 'private', content: 'second'}],
  ];
  let pass = 0;
  const send = (async (url: URL) => new Response(JSON.stringify(
    url.pathname === '/api/v1/users/me' ? {user_id: 99} : {messages: pages.shift() ?? []},
  ))) as unknown as typeof fetch;
  const emit = (s: Stimulus) => {
    notices.push(s);
    events.push({type: 'stimulus', ...s} as JournalEvent);
    pass++;
    if (pass === 2) throw new Error('stop mid-turn before id 2 reaches the journal');
  };
  const p = zulipPoller({credentials, events: () => events, send}, emit);
  await p.poll();
  expect(notices).toHaveLength(1);
  // Second pass: id 2 is emitted into the poller's loop (cursor advances), then the throw keeps
  // it out of `events`. The catch in poll() swallows the throw and the pass ends with the
  // in-memory cursor at 2 but the durable floor at 1.
  await p.poll();
  // Third pass: the rewind must pull the cursor back to the floor (1) and re-fetch id 2.
  await p.poll();
  expect(notices).toHaveLength(2);
  expect(notices[1].text).toStartWith('Zulip private 2\n');
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
  await zulipPoller({credentials,events:()=>[],send,ownerId:100,keepImage:async b=>{kept.push(b);return '[image: memory/images/'+('a'.repeat(64))+'.png]'}},s=>notices.push(s)).poll();
  expect(fetched).toEqual(['/user_uploads/1/a/pic.png']);
  expect(kept).toEqual([png]);
  expect(notices[0].source).toBe('owner:zulip');
  expect(notices[0].text).toEndWith('[image: memory/images/'+('a'.repeat(64))+'.png]');
  expect(notices[1].text).not.toContain('[image:');
});

test('an inline image whose src is a thumbnail downloads the data-original-src original', async () => {
  // Zulip renders <img src="/user_uploads/thumbnail/..."> with the full image in
  // data-original-src; reading src alone yields only the downscaled thumbnail, which the
  // download filter discards, so the message used to emit with no image marker at all.
  // The raw markdown has no upload link (apply_markdown=false), so the trigger must not
  // depend on seeing "/user_uploads/" in the raw text.
  const notices: Stimulus[] = [], kept: Buffer[] = [], fetched: string[] = [];
  const png = Buffer.from('89504e470d0a1a0a000000', 'hex');
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({user_id:99}));
    if (url.pathname === '/api/v1/messages') return new Response(JSON.stringify({messages: [
      {id:50,sender_id:100,type:'private',content:'look at the screenshot'},
    ]}));
    if (url.pathname === '/api/v1/messages/50') return new Response(JSON.stringify({message:{content:'<p>shot<br><img alt="image.png" class="inline-image" data-original-src="/user_uploads/2/b/shot.png" src="/user_uploads/thumbnail/2/b/shot.png/840x560.webp"><br>done</p>'}}));
    fetched.push(url.pathname); return new Response(png);
  }) as unknown as typeof fetch;
  await zulipPoller({credentials,events:()=>[],send,ownerId:100,keepImage:async b=>{kept.push(b);return '[image: memory/images/'+('b'.repeat(64))+'.png]'}},s=>notices.push(s)).poll();
  expect(fetched).toEqual(['/user_uploads/2/b/shot.png']);
  expect(kept).toEqual([png]);
  expect(notices[0].source).toBe('owner:zulip');
  expect(notices[0].text).toEndWith('[image: memory/images/'+('b'.repeat(64))+'.png]');
});

test('a non-image owner attachment does not abort the batch; the message and later ones still emit', async () => {
  // Regression: an owner message whose upload is not a showable image (here a .md) made
  // keepImage throw inside the batch loop, aborting the whole poll pass so every pending
  // message was dropped. The attachment must degrade to a note and the rest of the batch emit.
  const notices: Stimulus[] = [];
  const mdBytes = Buffer.from('# not an image');
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({ user_id: 99 }));
    if (url.pathname === '/api/v1/messages') return new Response(JSON.stringify({ messages: [
      { id: 10, sender_id: 100, type: 'private', content: 'see the report [r](/user_uploads/1/a/r.md)' },
      { id: 11, sender_id: 100, type: 'private', content: 'follow up' },
    ] }));
    if (url.pathname === '/api/v1/messages/10') return new Response(JSON.stringify({ message: { content: '<a href="/user_uploads/1/a/r.md">r</a>' } }));
    if (url.pathname.startsWith('/user_uploads/')) return new Response(mdBytes, { headers: { 'content-type': 'text/markdown' } });
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  const keepImage = () => { throw new Error('not a PNG, JPEG, GIF or WebP image'); };
  await zulipPoller({ credentials, events: () => [], send, ownerId: 100, keepImage }, s => notices.push(s)).poll();
  expect(notices).toHaveLength(2); // both the .md message and the follow-up emit
  expect(notices[0].source).toBe('owner:zulip');
  expect(notices[0].text).toContain('see the report');
  expect(notices[0].text).toContain('[Zulip attachment could not be shown]');
  expect(notices[1].text).toContain('follow up');
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
  await zulipPoller({credentials,events:()=>[],send,ownerId:100,keepImage:()=>{kept++;return ''}},s=>notices.push(s)).poll();
  expect(kept).toBe(0); expect(notices).toHaveLength(1);
  expect(notices[0].text).toContain('[Zulip image exceeds 10 MB]');
});

test('a hung poll pass releases the busy latch so the sensor retries instead of going silent', async () => {
  // The whole point of the watchdog: an await inside poll() that never resolves (here the page
  // fetch hangs) must not leave `busy` latched, or every later interval returns early and the
  // sensor silently stops delivering. With a short test deadline the latch is force-released and
  // a subsequent healthy poll fetches and emits again.
  const notices: Stimulus[] = [];
  let hang = true, pageFetches = 0;
  const send = (async (url: URL) => {
    if (url.pathname === '/api/v1/users/me') return new Response(JSON.stringify({ user_id: 99 }));
    if (hang) return new Promise<Response>(() => {}); // never resolves
    pageFetches++;
    return new Response(JSON.stringify({ messages: [{ id: 7, content: 'late hello', type: 'private' }] }));
  }) as unknown as typeof fetch;
  const p = zulipPoller({ credentials, events: () => [], send, pollDeadlineMs: 5 }, s => notices.push(s));
  // First pass hangs on the page fetch; its watchdog force-releases the busy latch.
  const hung = p.poll();
  await new Promise(r => setTimeout(r, 20)); // let the 5ms watchdog fire and release busy
  hang = false; // from here the page fetch is healthy
  await p.poll(); // busy is now free, so this fetches and emits instead of early-returning
  expect(pageFetches).toBeGreaterThan(0);
  expect(notices).toHaveLength(1);
  expect(notices[0].text).toStartWith('Zulip private 7\n');
  await Promise.race([hung, new Promise(r => setTimeout(r, 50))]); // let the hung pass settle
  p.stop();
});
