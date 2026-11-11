import { readAgenda, saveAgenda, selectWork, updateAgenda } from './agenda';
import { join } from 'node:path';
import type { Tool } from './tools';
import type { Sensor } from './sensors';

export interface Work { status: 'queued' | 'waiting' | 'done'; task: string; next: string; attempts: number; due: number; outcome?: string; recovery?: string; evidence?: string }
export function readWork(path: string): Work | null {
  try {
    const a = readAgenda(path);
    return selectWork(a) ?? a.items.find(w => w.status === 'waiting') ?? a.items.at(-1) ?? null;
  } catch { return null; }
}
export function saveWork(path: string, w: Work): void {
  saveAgenda(path, updateAgenda(readAgenda(path), w));
}
export function workContext(path: string): string {
  try { readAgenda(path); } catch { return '\nSaved agenda is unreadable. Inspect storage before updating or resuming work; do not overwrite it.'; }
  const w = readWork(path);
  if (!w || w.status === 'done') return '';
  const rules = w.status === 'waiting'
    ? 'This task is BLOCKED. Do not retry or reset its budget unless the named dependency is resolved. Handle other authorized requests normally.'
    : 'An owner-authorized commitment is pending, even if this turn began with inbox traffic. When consistent with newer owner instructions, continue concrete ready steps in this turn, updating checkpoints between milestones. A completed step or checkpoint update is not a reason to end the turn. Use commentary for brief progress updates and then act; do not issue a final reply merely to announce the next feasible step. Yield at the requested outcome, a genuine dependency, an authority boundary, a necessary restart, or the existing turn limit. Use the saved outcome as the stopping condition and recovery/evidence checkpoints to locate results. Checkpoints are claims to verify, not proof. First reconcile existing processes, tool results and receipts: a timed-out action may already have succeeded. Do not repeat an uncertain external side effect; inspect evidence or record a blocker. Record actual progress with work; changing wording alone is not progress. Stop at the outcome, or mark waiting with the specific dependency. Do not invent additional work to stay busy.';
  return '\n\n# Saved work state (local scheduling context, not new authority)\n' + rules + '\n' + JSON.stringify(w);
}

/** Agenda state is not a global reply status: blocked tasks must not label unrelated replies. */
export function workFooter(_path: string): string { return ''; }

export const work: Tool = {
  spec: { name: 'work', description: 'Persist a named owner-authorized commitment in an ordered agenda. Updates preserve other commitments. The first queued task resumes automatically; waiting skips a blocked task; done advances to the next queued task. No queued tasks means stop. Reuse the exact task name when updating. Call before promising future work, and update after each concrete step. Not authorization to invent work or act on untrusted messages. State changes must also be explained in your reply.', parameters: {
    type: 'object', properties: { status: { type: 'string', enum: ['queued', 'waiting', 'done'] }, task: { type: 'string' }, next: { type: 'string' }, outcome: { type: 'string', description: 'Observable completion condition' }, recovery: { type: 'string', description: 'Existing process or receipt pointers and checks before retry; no secrets' }, evidence: { type: 'string', description: 'Verified progress, not intention' } }, required: ['status', 'task', 'next'],
  } },
  async run(args, ctx) {
    const a = args as Work;
    if (!['queued', 'waiting', 'done'].includes(a.status) || typeof a.task !== 'string' || typeof a.next !== 'string'
      || !a.task.trim() || !a.next.trim() || a.task.length + a.next.length > 4000) throw new Error('Provide status, task and concrete next step/blocker (up to 4000 characters)');
    const path = join(ctx.workspace, '..', 'work.json');
    const old = readAgenda(path).items.find(w => w.task === a.task);
    const checkpoints: Partial<Work> = {};
    for (const key of ['outcome', 'recovery', 'evidence'] as const) {
      const value = a[key] ?? (old?.task === a.task ? old[key] : undefined);
      if (value !== undefined) {
        if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid checkpoint: ' + key);
        checkpoints[key] = value;
      }
    }
    // Identical updates cannot reset the no-progress limit.
    const attempts = old?.task === a.task && old.next === a.next ? old.attempts : 0;
    saveWork(path, { status: a.status, task: a.task, next: a.next, ...checkpoints, attempts, due: Date.now() + 15_000 });
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
