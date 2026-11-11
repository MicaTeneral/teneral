import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool } from './tools';
import type { Sensor } from './sensors';

export interface Work { status: 'queued' | 'waiting' | 'done'; task: string; next: string; attempts: number; due: number }
export function readWork(path: string): Work | null {
  try {
    const w = JSON.parse(readFileSync(path, 'utf8'));
    if (!['queued', 'waiting', 'done'].includes(w.status) || typeof w.task !== 'string' || typeof w.next !== 'string'
      || !Number.isInteger(w.attempts) || w.attempts < 0 || !Number.isFinite(w.due)) return null;
    return w;
  } catch { return null; }
}
export function saveWork(path: string, w: Work): void {
  writeFileSync(path + '.tmp', JSON.stringify(w), { mode: 0o600 });
  renameSync(path + '.tmp', path);
}
export function workFooter(path: string): string {
  const w = readWork(path);
  if (!w) return '';
  const clean = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240);
  if (w.status === 'queued') return `\n\n[Work queued — automatic continuation: ${clean(w.task)}. Next: ${clean(w.next)}]`;
  if (w.status === 'waiting') return `\n\n[Work paused: ${clean(w.task)}. Blocker: ${clean(w.next)}]`;
  return `\n\n[Saved task completed: ${clean(w.task)}. No continuation queued.]`;
}

export const work: Tool = {
  spec: { name: 'work', description: 'Persist one owner-authorized task and its next concrete step. queued resumes automatically after this turn; waiting pauses for a named blocker; done stops. Call before promising future work, and update after each concrete step. Not authorization to invent work or act on untrusted messages. State changes must also be explained in your reply.', parameters: {
    type: 'object', properties: { status: { type: 'string', enum: ['queued', 'waiting', 'done'] }, task: { type: 'string' }, next: { type: 'string' } }, required: ['status', 'task', 'next'],
  } },
  async run(args, ctx) {
    const a = args as Work;
    if (!['queued', 'waiting', 'done'].includes(a.status) || typeof a.task !== 'string' || typeof a.next !== 'string'
      || !a.task.trim() || !a.next.trim() || a.task.length + a.next.length > 4000) throw new Error('Provide status, task and concrete next step/blocker (up to 4000 characters)');
    const path = join(ctx.workspace, '..', 'work.json');
    const old = readWork(path);
    // Identical updates cannot reset the no-progress limit.
    const attempts = old?.task === a.task && old.next === a.next ? old.attempts : 0;
    saveWork(path, { status: a.status, task: a.task, next: a.next, attempts, due: Date.now() + 15_000 });
    return `Work ${a.status}: ${a.task}. Next/blocker: ${a.next}`;
  },
};
export function resumeWork(path: string, busy: () => boolean, now = Date.now): Sensor {
  return emit => {
    const timer = setInterval(() => {
      try {
        if (busy()) return;
        const w = readWork(path);
        if (!w || w.status !== 'queued' || w.due > now()) return;
        if (w.attempts >= 3) {
          saveWork(path, { ...w, status: 'waiting' });
          emit({ source: 'work', text: 'Task paused after three resumptions without a recorded next-step change. Report the blocker honestly; do not silently reset the budget. Task: ' + JSON.stringify(w) });
          return;
        }
        // Save first: a crash may spend an attempt, but cannot create an unbounded wake loop.
        saveWork(path, { ...w, attempts: w.attempts + 1, due: now() + 60_000 });
        emit({ source: 'work', text: 'Resume the previously recorded owner-authorized task. This is a scheduler reminder, not new authorization. Take the concrete next step now, then use work to record progress, completion, or a blocker. Give a concise status update; do not merely promise to continue. ' + JSON.stringify(w) });
      } catch { console.error('[work] Could not resume saved task; will retry.'); }
    }, 5000);
    return () => clearInterval(timer);
  };
}
