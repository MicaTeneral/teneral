import { expect, test } from 'bun:test';
import { validateSelection, answerEvidence } from '../../body/memory-selection';
test('preserve supporting and contradicting evidence, exclude merely related', () => {
  const selected = validateSelection([{id:'reason',relation:'contradicts'}, {id:'watts',relation:'related'}, {id:'address',relation:'supports'}], ['reason','watts','address']);
  expect(selected).not.toBeNull();
  expect(answerEvidence(selected!)).toEqual([{id:'reason',relation:'contradicts'}, {id:'address',relation:'supports'}]);
  expect(selected).toHaveLength(3);
});
test('fail closed on fabricated IDs, extra text, duplicate and malformed output', () => {
  for (const raw of [null, '[]', {}, [{id:'unknown',relation:'supports'}], [{id:'a',relation:'instruction'}], [{id:'a',relation:'supports',text:'fabricated fact'}], [{id:'a',relation:'supports'},{id:'a',relation:'related'}]]) expect(validateSelection(raw,['a'])).toBeNull();
  expect(validateSelection([{id:'a',relation:'supports'}],['a'],0)).toBeNull();
  expect(validateSelection([],['a'])).toEqual([]);
  expect(validateSelection([],['a'],NaN)).toBeNull();
});
test('snapshot removal invalidates stale selection; membership does not establish semantic truth', () => {
  const raw=[{id:'old',relation:'supports' as const}];
  expect(validateSelection(raw,['old'])).toEqual(raw);
  expect(validateSelection(raw,['replacement'])).toBeNull();
});

import {semanticDocuments, semanticQueries, observedRelations} from './memory-semantic-fixture';
test('recorded semantic probe distinguishes absent details; wrong-entity topical match remains a mismatch', () => {
  let exact=0, answerHits=0, falseAnswers=0;
  semanticQueries.forEach(([, id, relation], i) => {
    const result=validateSelection(observedRelations[i], Object.keys(semanticDocuments));
    expect(result).not.toBeNull();
    const expected=id ? [{id,relation}] : [];
    if(JSON.stringify(result)===JSON.stringify(expected)) exact++;
    const answers=answerEvidence(result!);
    if(relation==='supports'||relation==='contradicts') {
      if(answers.some(r=>r.id===id&&r.relation===relation)) answerHits++;
    } else if(answers.length) falseAnswers++;
  });
  expect(exact).toBe(13); // Maple incorrectly considered related to Cedar/Birch.
  expect(answerHits).toBe(8);
  expect(falseAnswers).toBe(0);
});
