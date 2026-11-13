import {test,expect} from 'bun:test';
import {recallJournal} from '../../body/recall';
import type {JournalEvent} from '../../brain/journal';
// Single query-only worker sample e40d4f12-faad-47c0-abbf-ccd9c3819301.
// Worker never received these documents. Fixtures overlap prior selector probes;
// not a held-out benchmark and not a live inference test.
const docs=[
 ['A','Do not use cloud backups for client records; keep encrypted offline copies because of contractual restrictions.'],
 ['B','Project Cedar deploys on Friday. Project Birch deploys on Monday.'],
 ['C','Our old support mailbox was old@example.invalid; it was replaced by help@example.invalid.'],
 ['D','We postponed GPU purchase because of cost, not power consumption.'],
 ['F','We chose to stay on the incumbent platform after the vendor withdrew its warranty.'],
];
function events(rows=docs):JournalEvent[]{return rows.map(([id,text])=>({type:'stimulus',source:'terminal',id:id!,text:text!,ts:'2026-01-01',v:1,gen:'g'}));}
const probes=[
 ['Why keep customer archives disconnected?','customer archives disconnected offline isolated airgap isolation rationale архивы клиентов отключены изоляция','A'],
 ['Почему пока не покупаем видеокарту?','видеокарта GPU graphics card покупка закупка отложена отсрочка причины бюджет дефицит','D'],
 ['Current support email?','support email contact current helpdesk поддержка почта адрес актуальный контакты','C'],
 ['When does Project Maple deploy?','Project Maple deployment deploy rollout launch release schedule date запуск развертывание сроки',null],
 ['What encryption algorithm protects the offline copies?','encryption algorithm offline copies backups cipher шифрование алгоритм автономные копии резервные',null],
 ['Why did we abandon the migration?','migration abandoned canceled halted rollback reasons миграция отмена отказ остановка причины','F'],
 ['Когда запускаем Cedar?','Cedar запуск старт релиз развертывание дата сроки launch rollout deployment schedule','B'],
 ['What are cloud formations?','cloud formations clouds types meteorology cumulus stratus cirrus облака образование облачность',null],
] as const;
function ids(output:string){return output.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s).id as string);}
test('observed query expansion improves candidate recall but does not solve relevance or zero overlap',()=>{
 let baseline=0,expanded=0,baselineNonanswers=0,expandedNonanswers=0;
 for(const [query,terms,target] of probes){
  const a=ids(recallJournal(events(),query)); const b=ids(recallJournal(events(),terms));
  if(target){baseline+=Number(a.includes(target));expanded+=Number(b.includes(target));}
  else{baselineNonanswers+=Number(a.length>0);expandedNonanswers+=Number(b.length>0);}
 }
 console.log({baseline,expanded,answerTargets:5,baselineNonanswers,expandedNonanswers,nonanswerQueries:3});
 expect(expanded).toBeGreaterThan(baseline);
 expect(ids(recallJournal(events(),probes[5][1]))).not.toContain('F');
 // A deployment mention does not answer about a different project.
 expect(ids(recallJournal(events(),probes[3][1]))).toContain('B');
 expect(expandedNonanswers).toBe(3);
});
test('expansion can crowd out relevant old results; explicit paging recovers them',()=>{
 const rows=[docs[0]!,...Array.from({length:9},(_,i)=>[`noise${i}`,'Offline game archives are available.'])];
 const first=recallJournal(events(rows),probes[0][1]);
 expect(ids(first)).not.toContain('A');
 const cursor=first.split('before=')[1]!;
 expect(ids(recallJournal(events(rows),probes[0][1],cursor))).toContain('A');
});
