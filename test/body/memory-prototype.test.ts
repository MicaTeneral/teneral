import { expect, test } from 'bun:test';
import { recallMemory, type MemoryFact } from '../../body/memory-prototype';
const facts: MemoryFact[] = [
  { id: 'a', seq: 1, audience: 'private', text: 'Release is Monday', sources: ['event:1'], dependsOn: [] },
  { id: 'b', seq: 2, audience: 'private', text: 'Prepare Sunday', sources: ['event:2'], dependsOn: ['a'] },
  { id: 'c', seq: 3, audience: 'private', text: 'Release is Tuesday', sources: ['event:3'], dependsOn: [], supersedes: 'a' },
  { id: 'd', seq: 4, audience: 'public', text: 'Public announcement', sources: ['event:4'], dependsOn: [] },
];
// Synthetic counter: verifies budget mechanics, not a provider tokenizer.
const count = (s: string) => s.length;
test('historical recall and correction-dependent invalidation', () => {
  expect(recallMemory(facts, 2, 'private', 2000, count).ids).toEqual(['b', 'a']);
  expect(recallMemory(facts, 4, 'private', 2000, count).ids).toEqual(['c']);
  expect(recallMemory(facts, 4, 'public', 2000, count).ids).toEqual(['d']);
});
test('rendered provenance and headers count toward cap; zero budget is empty', () => {
  const full = recallMemory(facts, 4, 'private', 2000, count);
  expect(full.text).toContain('event:3');
  expect(recallMemory(facts, 4, 'private', full.tokens, count)).toEqual(full);
  expect(recallMemory(facts, 4, 'private', full.tokens - 1, count).ids).toEqual([]);
  expect(recallMemory(facts, 4, 'private', 0, count).text).toBe('');
});
test('reject duplicate IDs, absent provenance and cross-audience dependencies', () => {
  expect(() => recallMemory([...facts, { ...facts[0]!, seq: 5 }], 5, 'private', 100, count)).toThrow();
  expect(() => recallMemory([{ ...facts[0]!, sources: [] }], 1, 'private', 100, count)).toThrow();
  expect(() => recallMemory([...facts, { ...facts[3]!, id: 'e', seq: 5, dependsOn: ['a'] }], 5, 'public', 100, count)).toThrow();
});
