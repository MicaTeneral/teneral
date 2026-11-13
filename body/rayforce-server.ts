// Lazy lifecycle for the derived Rayforce memory projection. The teneral journal is
// authoritative; a running server is reused only after its snapshot is synchronized.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { appendEvent, type JournalEvent } from '../brain/journal';
import { projectionFingerprint, rebuildProjection } from './rayforce-memory';
import { evalRayforce } from './rayforce';

const PORT = 19796;
interface ServerState { key: string; fingerprint: string; child: ChildProcess | null }
const states = new Map<number, ServerState>();
const queues = new Map<number, Promise<void>>();

export interface MemoryServerOptions {
  /** Test isolation; production uses the fixed loopback port and pinned organ. */
  port?: number;
  organs?: string;
}

async function answers(port: number): Promise<boolean> {
  try { await evalRayforce(port, '(+ 1 1)', 1500); return true; }
  catch { return false; }
}

async function synchronize(journal: string, events: JournalEvent[], organs: string, port: number, fingerprint: string): Promise<void> {
  const key = `${organs}:${journal}`;
  const state = states.get(port);
  if (state?.key === key && state.fingerprint === fingerprint && await answers(port)) return;
  if (!await answers(port)) {
    const child = spawn(join(organs, 'rayforce', 'rayforce'), ['-p', `127.0.0.1:${port}`, '-c', '1'], { stdio: 'ignore', detached: false });
    states.set(port, { key, fingerprint: '', child });
    // The projection is rebuilt from the journal; a second Rayforce journal would only
    // duplicate every replacement snapshot. No -l here.
    child.on('exit', () => {
      const current = states.get(port);
      if (current?.child === child) states.set(port, { ...current, fingerprint: '', child: null });
    });
    child.on('error', () => {
      const current = states.get(port);
      if (current?.child === child) states.set(port, { ...current, fingerprint: '', child: null });
    });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (await answers(port)) { ready = true; break; }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!ready) throw Error('Rayforce memory server did not start in time');
  }
  appendEvent(journal, process.env.TENERAL_GEN ?? 'unknown', { type: 'note', kind: 'memory.projection.v1', data: { status: 'started', fingerprint } });
  try {
    const counts = await rebuildProjection(port, events);
    states.set(port, { key, fingerprint, child: states.get(port)?.child ?? null });
    appendEvent(journal, process.env.TENERAL_GEN ?? 'unknown', { type: 'note', kind: 'memory.projection.v1', data: { status: 'completed', fingerprint, counts } });
  } catch (error) {
    const current = states.get(port);
    if (current) states.set(port, { ...current, fingerprint: '' });
    appendEvent(journal, process.env.TENERAL_GEN ?? 'unknown', { type: 'note', kind: 'memory.projection.v1', data: { status: 'failed', fingerprint, error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

/** Synchronize and read under the same per-port queue. A later journal cannot replace the
 * snapshot between those steps. Null means no organ or an engine failure; callers may fall back. */
export function withRayforceMemory<T>(journal: string, events: JournalEvent[], read: (port: number) => Promise<T>, options: MemoryServerOptions = {}): Promise<T | null> {
  const organs = options.organs ?? process.env.TENERAL_ORGANS;
  if (!organs) return Promise.resolve(null);
  const port = options.port ?? PORT;
  const fingerprint = projectionFingerprint(events);
  const previous = queues.get(port) ?? Promise.resolve();
  const run = previous.then(async () => {
    await synchronize(journal, events, organs, port, fingerprint);
    return await read(port);
  }).catch(() => null);
  const tail = run.then(() => undefined);
  queues.set(port, tail);
  void tail.then(() => { if (queues.get(port) === tail) queues.delete(port); });
  return run;
}

/** Stop owned processes only. An independently started server reused on the port is left alone. */
export async function stopRayforceMemory(port?: number): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const [p, state] of states) {
    if (port !== undefined && p !== port) continue;
    const child = state.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      waits.push(new Promise(resolve => child.once('exit', () => resolve())));
      child.kill('SIGTERM');
    }
    states.delete(p);
  }
  await Promise.all(waits);
}
