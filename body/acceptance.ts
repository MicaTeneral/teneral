import { statSync } from 'node:fs';
import { isMutationRejection, isMutationRequest, type JournalEvent } from '../brain/journal';

/** Exact match only; newer ancestor consent requires manual reconciliation. */
export function acceptanceNotes(events: JournalEvent[]): Map<string, string> {
  const notes = new Map<string, string>();
  let pending: { species: string; candidate: string } | undefined;
  for (const e of events) {
    if (isMutationRejection(e)) {
      pending = undefined;
      if (e.gate === 'species' && typeof e.output === 'string' && e.output.includes('Your owner has not accepted that commit')) {
        const species = e.output.match(/ to ([a-f0-9]{40}), and with that its kernel\./)?.[1];
        if (species) pending = { species, candidate: e.commit };
      }
    } else if (e.type === 'species.accepted' && pending && e.commit === pending.species) {
      notes.set(e.id, `[kernel] Owner accepted species ${e.commit} for pending candidate ${pending.candidate}. Reconcile current workspace and pending task; retry only if still appropriate. This records consent, not a successful mutation.`);
      pending = undefined;
    } else if (e.type === 'turn.interrupted' || isMutationRequest(e) || ['generation.promoted', 'generation.rolledback'].includes(e.type)) pending = undefined;
  }
  return notes;
}

/** Wake only; no synthetic owner message, consent or persistent side effect. */
export function watchJournal(path: string, wake: () => void, intervalMs = 1000): () => void {
  let previous = '';
  const poll = () => {
    try {
      const st = statSync(path);
      const signature = `${st.size}:${st.mtimeMs}`;
      if (signature !== previous) { previous = signature; wake(); }
    } catch { /* Journal may not exist yet; next poll retries. */ }
  };
  const timer = setInterval(poll, intervalMs);
  return () => clearInterval(timer);
}
