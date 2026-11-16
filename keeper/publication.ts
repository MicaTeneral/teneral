import { realpathSync } from 'node:fs';
import { run } from '../species/offerkey';
import { speciesRef } from '../species/species';
import type { Paths } from '../stem/supervisor';

/** A local fact about the checkout, not proof that a remote publication or merge succeeded. */
export interface Publication {
  /** Short local commit awaiting publication; null when the species ref is not known here. */
  commit: string | null;
  pending: boolean;
}

/** Local lineage newer than its species ref. Never uses or needs a credential. */
export function publication(p: Pick<Paths, 'candidate'>, env: NodeJS.ProcessEnv = process.env): Publication {
  try {
    const root = realpathSync(p.candidate);
    const head = run(['git', 'rev-parse', 'HEAD'], { cwd: root, timeoutMs: 2000 });
    const species = speciesRef(root, env.TENERAL_UPSTREAM);
    if ('problem' in species || head.code !== 0) return { commit: null, pending: false };
    const commit = head.stdout.toString().trim();
    const count = run(['git', 'rev-list', '--count', `${species.ref}..HEAD`], { cwd: root, timeoutMs: 2000 });
    if (!/^[0-9a-f]{40}$/.test(commit) || count.code !== 0) return { commit: null, pending: false };
    return { commit: commit.slice(0, 12), pending: Number(count.stdout.toString().trim()) > 0 };
  } catch {
    // No checkout or no species ref: do not make a pending-publication claim.
    return { commit: null, pending: false };
  }
}
