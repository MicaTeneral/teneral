import { createHash, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Actor = { id: string; role: 'owner' | 'agent' };
export type Item = {
  id: string; kind: 'task' | 'note'; title: string; body: string;
  state: 'open' | 'in_progress' | 'waiting' | 'blocked' | 'done' | 'dropped';
  next: string; owner: string; participants: string[]; outcome: string;
  evidence: unknown[]; dependencies: unknown[]; waiting_reason: string;
  revision: number; created_by: string; created_at: string; updated_at: string;
};
type Comment = { id: string; item_id: string; author: string; body: string; created_at: string };
type Event = { id: number; item_id: string; actor: string; type: string; from: unknown; to: unknown; at: string; request_id: string };
type Receipt = { actor: string; key: string; hash: string; status: number; body: unknown };
type Stored = { items: Item[]; comments: Comment[]; events: Event[]; receipts: Receipt[]; ids: number; event: number };
export type WorkspaceOptions = { dir: string; now?: () => Date; authenticate: (token: string) => Actor | null; limit?: number };

/** A private, durable collaboration store. Only the host supplies identities and starts a listener. */
export class Workspace {
  private state: Stored = { items: [], comments: [], events: [], receipts: [], ids: 0, event: 0 };
  private readonly file: string;
  private readonly now: () => Date;
  private readonly authenticate: WorkspaceOptions['authenticate'];
  private readonly limit: number;
  constructor(options: WorkspaceOptions) {
    this.file = join(options.dir, 'workspace-v1.jsonl');
    this.now = options.now ?? (() => new Date());
    this.authenticate = options.authenticate;
    this.limit = options.limit ?? 100;
    if (existsSync(this.file)) {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) if (line !== '') this.state = JSON.parse(line) as Stored;
    }
  }
  /** Handle one request with no listening side effect. Every mutation is one durable snapshot. */
  async handle(request: Request): Promise<Response> {
    let input: Record<string, unknown> = {};
    if (request.method === 'POST' || request.method === 'PATCH') {
      if (Number(request.headers.get('content-length') ?? 0) > 1_000_000) return answer(413, { error: 'request_too_large' });
      try { input = await request.json() as Record<string, unknown>; } catch { return answer(400, { error: 'invalid_json' }); }
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const actor = this.authenticate(token);
    if (actor === null) return answer(401, { error: 'unauthenticated' });
    const url = new URL(request.url);
    if (url.pathname === '/items' && request.method === 'GET') {
      const items = this.state.items.filter(i => !url.searchParams.has('state') || i.state === url.searchParams.get('state'))
        .filter(i => !url.searchParams.has('assignee') || i.owner === url.searchParams.get('assignee'));
      return answer(200, { items: page(items, url.searchParams.get('cursor'), this.limit), changes_cursor: this.state.event });
    }
    if (url.pathname === '/changes' && request.method === 'GET') {
      const events = this.state.events.filter(e => e.id > integer(url.searchParams.get('since') ?? '0'));
      return answer(200, { events: page(events, url.searchParams.get('cursor'), this.limit) });
    }
    const match = /^\/items\/([a-z0-9-]+)(?:\/(comments|reassign))?$/.exec(url.pathname);
    if (match && request.method === 'GET' && match[2] === undefined) {
      const item = this.state.items.find(i => i.id === match[1]);
      if (!item) return answer(404, { error: 'not_found' });
      const comments = this.state.comments.filter(c => c.item_id === item.id);
      const events = this.state.events.filter(e => e.item_id === item.id);
      return answer(200, { item, comments: page(comments, url.searchParams.get('comments_cursor'), this.limit), audit: page(events, url.searchParams.get('audit_cursor'), this.limit) });
    }
    if (request.method !== 'POST' && request.method !== 'PATCH') return answer(404, { error: 'not_found' });
    const key = text(input.request_id, 'request_id', 200);
    if (typeof key === 'object') return answer(400, key);
    const hash = createHash('sha256').update(JSON.stringify({ method: request.method, path: url.pathname, input })).digest('hex');
    const before = this.state.receipts.find(r => r.actor === actor.id && r.key === key);
    if (before) {
      if (before.hash !== hash) return answer(409, { error: 'idempotency_conflict', current_request_id: before.key });
      return answer(before.status, before.body);
    }
    if (url.pathname === '/items' && request.method === 'POST') return this.mutate(actor, key, hash, () => this.create(actor, input));
    if (!match) return answer(404, { error: 'not_found' });
    if (match[2] === 'comments' && request.method === 'POST') return this.mutate(actor, key, hash, () => this.comment(actor, match[1], input));
    if (match[2] === 'reassign' && request.method === 'POST') return this.mutate(actor, key, hash, () => this.patch(actor, match[1], input, true));
    if (match[2] === undefined && request.method === 'PATCH') return this.mutate(actor, key, hash, () => this.patch(actor, match[1], input, false));
    return answer(404, { error: 'not_found' });
  }
  private mutate(actor: Actor, key: string, hash: string, operation: () => { status: number; body: unknown }): Response {
    // Mutations run in one synchronous transaction. The receipt is persisted with the operation.
    const result = operation();
    if (result.status < 400) {
      this.state.receipts.push({ actor: actor.id, key, hash, ...result });
      appendFileSync(this.file, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    }
    return answer(result.status, result.body);
  }
  private create(actor: Actor, input: Record<string, unknown>) {
    const kind = input.kind === 'note' ? 'note' : input.kind === 'task' ? 'task' : null;
    const title = text(input.title, 'title', 10000);
    const owner = text(input.owner ?? actor.id, 'owner', 200);
    const outcome = stringField(input.outcome);
    if (outcome.length > 10000) return { status: 400, body: { error: 'invalid_outcome' } };
    if (typeof title !== 'string' || typeof owner !== 'string') return invalid([title, owner].find(x => typeof x === 'object'));
    if (kind === null) return { status: 400, body: { error: 'kind_must_be_task_or_note' } };
    const at = this.now().toISOString();
    const item: Item = { id: `i${++this.state.ids}`, kind, title, body: stringField(input.body), state: 'open', next: stringField(input.next), owner, participants: strings(input.participants), outcome, evidence: array(input.evidence), dependencies: array(input.dependencies), waiting_reason: '', revision: 1, created_by: actor.id, created_at: at, updated_at: at };
    this.state.items.push(item);
    this.record(actor, item, 'create', null, item, stringField(input.request_id));
    return { status: 201, body: { item } };
  }
  private comment(actor: Actor, id: string, input: Record<string, unknown>) {
    const item = this.state.items.find(i => i.id === id);
    if (!item) return { status: 404, body: { error: 'not_found' } };
    const body = text(input.body, 'body', 100000);
    if (typeof body !== 'string') return { status: 400, body: body };
    const comment: Comment = { id: `c${++this.state.ids}`, item_id: id, author: actor.id, body, created_at: this.now().toISOString() };
    this.state.comments.push(comment);
    this.record(actor, item, 'comment', null, comment, stringField(input.request_id));
    return { status: 201, body: { comment, revision: item.revision } };
  }
  private patch(actor: Actor, id: string, input: Record<string, unknown>, reassign: boolean) {
    const item = this.state.items.find(i => i.id === id);
    if (!item) return { status: 404, body: { error: 'not_found' } };
    const base = integer(input.base_revision);
    if (base !== item.revision) return { status: 409, body: { error: 'stale_revision', current: item } };
    if (actor.role !== 'owner' && actor.id !== item.owner && !item.participants.includes(actor.id)) return { status: 403, body: { error: 'not_a_participant' } };
    const fields = reassign ? ['owner'] : ['title', 'body', 'state', 'next', 'owner', 'participants', 'outcome', 'evidence', 'dependencies', 'waiting_reason'] as const;
    if (Object.keys(input).some(k => !['base_revision', 'request_id', ...fields].includes(k))) return { status: 400, body: { error: 'unknown_field' } };
    const from = structuredClone(item);
    for (const field of fields) if (field in input) {
      const value = input[field];
      if (field === 'participants' && Array.isArray(value) && value.every(v => typeof v === 'string')) item.participants = value;
      else if ((field === 'evidence' || field === 'dependencies') && Array.isArray(value)) item[field] = value;
      else if (typeof value === 'string' && value.length <= 100000) (item as unknown as Record<string, unknown>)[field] = value;
      else return { status: 400, body: { error: `invalid_${field}` } };
    }
    if (!['open', 'in_progress', 'waiting', 'blocked', 'done', 'dropped'].includes(item.state) || (['waiting', 'blocked'].includes(item.state) && (item.dependencies.length === 0 || item.waiting_reason === '')) || (['done', 'dropped'].includes(item.state) && item.next !== '') || (item.kind === 'task' && item.state === 'in_progress' && item.next === '')) return { status: 400, body: { error: 'invalid_state_contract', current: from } };
    item.revision++;
    item.updated_at = this.now().toISOString();
    this.record(actor, item, reassign ? 'reassign' : 'update', from, item, stringField(input.request_id));
    return { status: 200, body: { item } };
  }
  private record(actor: Actor, item: Item, type: string, from: unknown, to: unknown, requestId: string) {
    this.state.events.push({ id: ++this.state.event, item_id: item.id, actor: actor.id, type, from, to, at: this.now().toISOString(), request_id: requestId });
  }
}
function answer(status: number, body: unknown): Response { return Response.json(body, { status }); }
function invalid(error: unknown) { return { status: 400, body: typeof error === 'object' && error !== null ? error : { error: 'invalid_field' } }; }
function text(value: unknown, field: string, max: number): string | object { return typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : { error: `invalid_${field}` }; }
function stringField(value: unknown): string { return typeof value === 'string' ? value : ''; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function integer(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : -1; }
function page<T extends { id: string | number }>(rows: T[], cursor: string | null, limit: number): { rows: T[]; next_cursor: string | null } {
  const index = cursor === null ? 0 : rows.findIndex(r => String(r.id) === cursor) + 1;
  if (cursor !== null && index === 0) throw new RangeError('unknown cursor');
  const remaining = rows.slice(index);
  const bounded = remaining.slice(0, limit);
  return { rows: bounded, next_cursor: remaining.length > limit ? String(bounded.at(-1)?.id) : null };
}

/** Constant-time bearer comparison for hosts that configure per-agent credentials. */
export function bearerIdentities(tokens: Record<string, Actor>): (token: string) => Actor | null {
  return token => {
    const given = Buffer.from(token);
    for (const [stored, actor] of Object.entries(tokens)) {
      const expected = Buffer.from(stored);
      if (given.length === expected.length && timingSafeEqual(given, expected)) return actor;
    }
    return null;
  };
}
