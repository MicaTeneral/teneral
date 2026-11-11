import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { Work } from './work';

export interface Agenda { version: 1; items: Work[] }
export function validWork(w: unknown): w is Work {
  if (!w || typeof w !== 'object') return false;
  const a = w as Work;
  return ['queued', 'waiting', 'done'].includes(a.status)
    && typeof a.task === 'string' && !!a.task.trim() && a.task.length <= 2000
    && typeof a.next === 'string' && !!a.next.trim() && a.next.length <= 4000
    && Number.isSafeInteger(a.attempts) && a.attempts >= 0 && Number.isFinite(a.due)
    && ['outcome', 'recovery', 'evidence'].every(k => {
      const v = (a as unknown as Record<string, unknown>)[k];
      return v === undefined || (typeof v === 'string' && v.length <= 2000);
    });
}
export function validateAgenda(value: unknown): Agenda {
  const a = value as Agenda;
  if (!a || a.version !== 1 || !Array.isArray(a.items) || a.items.length > 100
    || !a.items.every(validWork) || new Set(a.items.map(w => w.task)).size !== a.items.length) {
    throw new Error('Invalid saved agenda; inspect and recover it before writing');
  }
  return a;
}
export function readAgenda(path: string): Agenda {
  if (!existsSync(path)) return { version: 1, items: [] };
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (validWork(value)) return { version: 1, items: [value] };
  return validateAgenda(value);
}
export function saveAgenda(path: string, agenda: Agenda): void {
  validateAgenda(agenda);
  writeFileSync(path + '.tmp', JSON.stringify(agenda), { mode: 0o600 });
  renameSync(path + '.tmp', path);
}
/** Stable insertion order is priority. Due time throttles wakes, not selection. */
export function selectWork(agenda: Agenda): Work | undefined {
  return agenda.items.find(w => w.status === 'queued');
}
/** Updating a named commitment never removes another or changes its priority. */
export function updateAgenda(agenda: Agenda, update: Work): Agenda {
  validateAgenda(agenda);
  if (!validWork(update)) throw new Error('Invalid work update');
  const index = agenda.items.findIndex(w => w.task === update.task);
  const items = agenda.items.slice();
  if (index < 0) items.push({ ...update });
  else items[index] = { ...items[index], ...update };
  return validateAgenda({ version: 1, items });
}
