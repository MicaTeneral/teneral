import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bearerIdentities, Workspace, type Actor } from '../../body/collaboration';

const actors: Record<string, Actor> = { a: { id: 'mica', role: 'agent' }, b: { id: 'morsel', role: 'agent' }, o: { id: 'anton', role: 'owner' } };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'mica-workspace-'));
  const workspace = new Workspace({ dir, authenticate: bearerIdentities(actors) });
  const call = (path: string, actor = 'a', method = 'GET', input?: Record<string, unknown>, key?: string) => workspace.handle(new Request(`http://local${path}`, { method, headers: { authorization: `Bearer ${actor}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }) }, body: input === undefined ? undefined : JSON.stringify({ ...input, ...(key ? { request_id: key } : {}) }) }));
  return { dir, workspace, call };
}
async function create(call: ReturnType<typeof setup>['call'], key = 'create') {
  const response = await call('/items', 'a', 'POST', { kind: 'task', title: 'Shared task', outcome: 'Both agents see the result', next: 'Morsel comments', participants: ['morsel'] }, key);
  expect(response.status).toBe(201);
  return (await response.json() as any).item;
}
describe('collaborative workspace', () => {
  test('authenticates agents, shares comments, and resumes the durable change feed', async () => {
    const { dir, call } = setup();
    expect((await call('/items', 'wrong')).status).toBe(401);
    const item = await create(call);
    expect((await call('/items', 'b')).status).toBe(200);
    const comment = await call(`/items/${item.id}/comments`, 'b', 'POST', { body: 'I can take this part' }, 'c1');
    expect(comment.status).toBe(201);
    const duplicate = await call(`/items/${item.id}/comments`, 'b', 'POST', { body: 'I can take this part' }, 'c1');
    expect(await duplicate.json()).toEqual(await comment.json());
    const other = new Workspace({ dir, authenticate: bearerIdentities(actors) });
    const full = await other.handle(new Request(`http://local/items/${item.id}`, { headers: { authorization: 'Bearer a' } }));
    const data = await full.json() as any;
    expect(data.comments.rows).toHaveLength(1);
    expect(data.comments.rows[0].author).toBe('morsel');
    const changes = await (await call('/changes?since=0')).json() as any;
    expect(changes.events.rows.map((e: any) => e.type)).toEqual(['create', 'comment']);
    expect(readFileSync(join(dir, 'workspace-v1.jsonl'), 'utf8')).not.toContain('Bearer');
  });
  test('independent concurrent comments survive and stale task updates lose', async () => {
    const { call } = setup();
    const item = await create(call);
    const [a, b] = await Promise.all([
      call(`/items/${item.id}/comments`, 'a', 'POST', { body: 'from Mica' }, 'ca'),
      call(`/items/${item.id}/comments`, 'b', 'POST', { body: 'from Morsel' }, 'cb'),
    ]);
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const current = await (await call(`/items/${item.id}`)).json() as any;
    expect(current.comments.rows).toHaveLength(2);
    const stale = await call(`/items/${item.id}`, 'b', 'PATCH', { base_revision: 0, state: 'in_progress' }, 'stale');
    expect(stale.status).toBe(409);
    expect((await stale.json() as any).current.revision).toBe(1);
  });
  test('idempotency is actor-scoped and cannot be used with a different payload', async () => {
    const { call } = setup();
    await create(call);
    const duplicate = await call('/items', 'a', 'POST', { kind: 'task', title: 'Shared task', outcome: 'Both agents see the result', next: 'Morsel comments', participants: ['morsel'] }, 'create');
    expect(duplicate.status).toBe(201);
    expect((await duplicate.json() as any).item.title).toBe('Shared task');
    expect((await call('/items', 'a', 'POST', { kind: 'note', title: 'Different' }, 'create')).status).toBe(409);
    expect((await call('/items', 'b', 'POST', { kind: 'note', title: 'Morsel note' }, 'create')).status).toBe(201);
  });
  test('pagination uses stable ids and a list includes the change boundary', async () => {
    const limited = new Workspace({ dir: mkdtempSync(join(tmpdir(), 'mica-workspace-page-')), authenticate: bearerIdentities(actors), limit: 1 });
    const request = async (key: string) => {
      const r = await limited.handle(new Request('http://local/items', { method: 'POST', headers: { authorization: 'Bearer a', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'note', title: key, request_id: key }) }));
      expect(r.status).toBe(201);
    };
    await request('1'); await request('2');
    const first = await (await limited.handle(new Request('http://local/items', { headers: { authorization: 'Bearer a' } }))).json() as any;
    expect(first.items.next_cursor).toBe('i1');
    const second = await (await limited.handle(new Request('http://local/items?cursor=i1', { headers: { authorization: 'Bearer a' } }))).json() as any;
    expect(second.items.rows.map((i: any) => i.title)).toEqual(['2']);
    expect(second.changes_cursor).toBe(2);
  });
  test('a participant can update; reassignment is explicit and audited', async () => {
    const { call } = setup();
    const item = await create(call);
    expect((await call(`/items/${item.id}`, 'b', 'PATCH', { base_revision: 1, state: 'in_progress', next: 'Contribute' }, 'update')).status).toBe(200);
    expect((await call(`/items/${item.id}/reassign`, 'a', 'POST', { base_revision: 2, owner: 'morsel' }, 'assign')).status).toBe(200);
    const update = await call(`/items/${item.id}`, 'b', 'PATCH', { base_revision: 3, state: 'in_progress', next: 'Start bounded investigation' }, 'work');
    expect(update.status).toBe(200);
    const audit = await (await call(`/items/${item.id}`)).json() as any;
    expect(audit.audit.rows.map((e: any) => e.type)).toEqual(['create', 'update', 'reassign', 'update']);
  });
});
