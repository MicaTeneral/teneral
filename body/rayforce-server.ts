// Lifecycle for the Rayforce memory server: a lazily-started, journal-enabled instance of the
// organ's binary whose only job is to hold the read-only memory projection (body/rayforce-memory.ts).
// The teneral journal stays the source of truth; this is a derived, rebuildable index.
//
// The server is started on first use, not at boot, so a body that never recalls pays nothing.
// Its journal (-l) lets the projection survive a restart of the server process itself; the body
// rebuilds the projection from the teneral journal on start anyway, so the Rayforce journal is a
// second layer, never the record.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { rebuildProjection, projectionWatermark } from './rayforce-memory';
import { evalRayforce } from './rayforce';
import type { JournalEvent } from '../brain/journal';

const PORT = 19796;
let starting: Promise<number> | null = null;
let server: ChildProcess | null = null;

function organsDir(): string | undefined {
  return process.env.TENERAL_ORGANS;
}

/** Start the server if not running; returns the port, or null when the organ is absent. */
export function ensureRayforceMemory(journal: string, events: JournalEvent[]): Promise<number | null> {
  if (starting !== null) return starting.then((p) => (p === 0 ? null : p));
  const organs = organsDir();
  if (!organs) return Promise.resolve(null);
  starting = (async (): Promise<number> => {
    try {
      // If a server is already answering on the port, reuse it.
      await evalRayforce(PORT, '(+ 1 1)', 1500);
      return PORT;
    } catch { /* not running: start one */ }
    const dir = join(journal, '..', 'rayforce-mem');
    mkdirSync(dir, { recursive: true });
    const base = join(dir, 'mem');
    const bin = join(organs, 'rayforce', 'rayforce');
    server = spawn(bin, ['-l', base, '-p', `127.0.0.1:${PORT}`, '-c', '1'], {
      stdio: 'ignore', detached: false,
    });
    server.on('exit', () => { server = null; starting = null; });
    // Wait for the port to answer, then load the projection.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        await evalRayforce(PORT, '(+ 1 1)', 1500);
        await rebuildProjection(PORT, events);
        return PORT;
      } catch { /* not up yet */ }
    }
    throw new Error('Rayforce memory server did not start in time');
  })();
  return starting.then((p) => (p === 0 ? null : p)).catch(() => null);
}

/** Best-effort stop (e.g. on mutation exit); the projection is rebuildable from the journal. */
export function stopRayforceMemory(): void {
  if (server !== null) {
    server.kill('SIGTERM');
    server = null;
  }
  starting = null;
}
