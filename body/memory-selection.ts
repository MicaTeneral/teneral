/** Model output is untrusted; this contract validates structure, not relevance. */
export type EvidenceRelation = 'supports' | 'contradicts' | 'related';
export interface Selection { id: string; relation: EvidenceRelation }
export function validateSelection(raw: unknown, eligibleIds: readonly string[], limit = 12): Selection[] | null {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 12 || !Array.isArray(raw) || raw.length > limit) return null;
  const eligible = new Set(eligibleIds);
  const seen = new Set<string>();
  const result: Selection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'id') || !Object.hasOwn(item, 'relation')
      || typeof item.id !== 'string' || !eligible.has(item.id) || seen.has(item.id)
      || !['supports', 'contradicts', 'related'].includes(item.relation)) return null;
    seen.add(item.id);
    result.push({ id: item.id, relation: item.relation });
  }
  return result;
}
/** Merely topical matches must not silently become answer evidence. */
export function answerEvidence(selection: readonly Selection[]): Selection[] {
  return selection.filter(s => s.relation !== 'related').map(s => ({ ...s }));
}
