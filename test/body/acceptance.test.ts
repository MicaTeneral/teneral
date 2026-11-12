import { expect, test } from 'bun:test';
import { acceptanceNotes, watchJournal } from '../../body/acceptance';
import { needsTurn, buildMessages } from '../../body/context';
import type { EventBody, JournalEvent } from '../../kernel/journal';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let n=0;
const ev=(b:EventBody):JournalEvent=>({...b,id:`a${++n}`,v:1,ts:'',gen:'g'});
const commit='a'.repeat(40);
const reject=()=>ev({type:'mutation.rejected',commit:'candidate',gate:'species',output:`this moves to ${commit}, and with that its kernel. Your owner has not accepted that commit`});
const done=()=>ev({type:'assistant',text:'Waiting for consent',toolCalls:[]});
const accept=()=>ev({type:'species.accepted',commit,route:'talk'});
test('matching consent owes one turn, is visible, and does not loop after answer',()=>{
 const events=[reject(),done(),accept()];
 expect(needsTurn(events)).toBe(true);
 expect(buildMessages(events,'system').map(m=>m.content).join('')).toContain('Owner accepted species');
 expect(needsTurn([...events,done()])).toBe(false);
 expect(needsTurn([...events,done(),accept()])).toBe(false);
 expect(acceptanceNotes(JSON.parse(JSON.stringify(events))).size).toBe(1);
});
test('unrelated, canceled, superseded and ordinary consent remains silent',()=>{
 expect(needsTurn([accept()])).toBe(false);
 expect(needsTurn([reject(),done(),ev({type:'species.accepted',commit:'b'.repeat(40),route:'box'})])).toBe(false);
 for(const boundary of [ev({type:'turn.interrupted'}),ev({type:'mutation.requested',commit:'new',motive:'new'}),ev({type:'generation.promoted',commit:'new',previous:'old'}),ev({type:'mutation.rejected',commit:'candidate',gate:'tests',output:'failed'})]) {
  expect(acceptanceNotes([reject(),done(),boundary,done(),accept()]).size).toBe(0);
 }
 expect(needsTurn([reject(),done(),accept(),ev({type:'turn.interrupted'})])).toBe(false);
});
test('journal watcher wakes idle process on append and stops cleanly',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'consent-watch-'));const path=join(dir,'journal');
 let wakes=0;writeFileSync(path,'');const stop=watchJournal(path,()=>wakes++,5);
 try {
  await Bun.sleep(25);const before=wakes;
  writeFileSync(path,'consent');await Bun.sleep(25);expect(wakes).toBeGreaterThan(before);
  const stable=wakes;await Bun.sleep(20);expect(wakes).toBe(stable);
  stop();writeFileSync(path,'more consent');await Bun.sleep(20);expect(wakes).toBe(stable);
 } finally {stop();rmSync(dir,{recursive:true,force:true});}
});
