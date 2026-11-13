import {test,expect} from 'bun:test';
import type {JournalEvent} from '../../kernel/journal';
import {correctionEdges} from '../../body/episode-corrections';
const base={v:1 as const,gen:'test',ts:'2026'};
const source=(id:string,channel='terminal'):JournalEvent=>({...base,id,type:'stimulus',source:channel,text:id});
const note=(id:string,data:Record<string,string>):JournalEvent=>({...base,id,type:'note',kind:'episode.correction.v1',data});
const add=note('n',{op:'add',source:'b',affects:'a'});
const history=[source('a'),source('b'),add];
test('withdrawal replays without deleting originals and cannot resurrect withdrawn link',()=>{
 expect(correctionEdges(history)).toEqual([{source:'b',affects:'a'}]);
 const removed=[...history,note('w',{op:'withdraw',target:'n'})];
 expect(correctionEdges(removed)).toEqual([]);
 expect(correctionEdges([...removed,note('x',{op:'withdraw',target:'w'})])).toEqual([]);
 expect(correctionEdges([...removed,note('new',{op:'add',source:'b',affects:'a'})])).toHaveLength(1);
 expect(history[0]).toEqual(source('a'));
});
test('eligibility, ordering, schema, audience and edge budget fail closed',()=>{
 expect(correctionEdges([source('a'),add,source('b')])).toEqual([]);
 expect(correctionEdges([source('a','clock'),source('b'),add])).toEqual([]);
 expect(correctionEdges([...history,source('clock','clock')])).toEqual(correctionEdges(history));
 expect(correctionEdges([...history.slice(0,2),note('bad',{op:'add',source:'a',affects:'b'})])).toEqual([]);
 expect(correctionEdges([...history.slice(0,2),note('bad',{op:'add',source:'b',affects:'a',extra:'x'})])).toEqual([]);
 expect(()=>correctionEdges(history,0)).toThrow();
 expect(()=>correctionEdges(history,129)).toThrow();
});

test('duplicate assertions share an edge but withdrawal removes only its own assertion',()=>{
 const duplicate=note('n2',{op:'add',source:'b',affects:'a'});
 expect(correctionEdges([...history,duplicate])).toHaveLength(1);
 const once=[...history,duplicate,note('w',{op:'withdraw',target:'n'})];
 expect(correctionEdges(once)).toHaveLength(1);
 expect(correctionEdges([...once,note('w2',{op:'withdraw',target:'n2'})])).toEqual([]);
 expect(()=>correctionEdges([...history,duplicate],1)).toThrow();
});
