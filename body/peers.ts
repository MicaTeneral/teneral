import { existsSync, readFileSync } from 'node:fs';

export interface Peer { inbox: string; id?: string }

/** The owner keeps this file: a name maps to an inbox, or to an inbox and the sender id it uses. */
export function readPeers(path: string): Record<string, Peer> {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); }
  catch (err) { throw new Error(`the peers file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`the peers file ${path} must map peer names to inboxes`);
  const peers: Record<string, Peer> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'string') peers[name] = { inbox: value };
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const peer = value as Record<string, unknown>;
      if (typeof peer.inbox !== 'string' || (peer.id !== undefined && typeof peer.id !== 'string')) throw new Error(`peer ${name} must have an inbox string and an optional id string`);
      peers[name] = { inbox: peer.inbox, ...(typeof peer.id === 'string' ? { id: peer.id } : {}) };
    } else throw new Error(`peer ${name} must be an inbox string or an object`);
  }
  return peers;
}

/** A label never authenticates an envelope: it is only the owner's display name for its claimed id. */
export function peerName(peers: Record<string, Peer>, from: string): string | undefined {
  return Object.entries(peers).find(([name, peer]) => peer.id === from || (peer.id === undefined && name === from))?.[0];
}
