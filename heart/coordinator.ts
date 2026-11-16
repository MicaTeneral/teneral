import { idleTicks, offered, reportAsk, toAsk } from '../brain/agenda';
import { known, type Known } from '../brain/known';
import { needsTurn } from '../brain/memory';
import { standing } from '../brain/owned';
import type { JournalEvent } from '../brain/journal';
import { clockText, type Stimulus } from '../body/sensors';

export type Beat = 'turn' | 'reflect' | 'remember' | 'pulse' | 'wait';
export interface HeartState { look: boolean; pulse: boolean }
export const heartCommand = (line: string): boolean => line.trim() === '/heart';

export function afterTurn(state: HeartState, events: JournalEvent[], enabled = true): void {
  const last = events.findLast(e => e.type === 'stimulus');
  if (!enabled || last?.source === 'clock') return;
  const interrupted = last !== undefined && events.some(e => e.type === 'turn.interrupted' && e.ts >= last.ts);
  if (!interrupted) state.look = true;
}
export function pulseNeeded(held: Known, now: number): boolean {
  return held.intentions.some(i => !i.waits && (i.work?.status === 'queued' || i.origin === 'own')) || toAsk(held, now).length > 0;
}
/** A reflection may add nothing new even though an earlier promise still has a concrete next
 * step. Give that step one bounded look instead of silently waiting for a heartbeat. */
export function followUpNeeded(held: Known): boolean {
  return pulseNeeded(held, Date.now()) || held.intentions.some(i => !i.waits && i.work?.status === 'waiting');
}
export function agendaFor(events: JournalEvent[], now = Date.now(), reportMs?: number): string {
  const current = standing(events), held = known(current);
  return offered(held, now, idleTicks(current), reportAsk(current, now, reportMs));
}
export function agendaPulse(events: JournalEvent[], now = Date.now(), reportMs?: number): Stimulus {
  return { source: 'clock', text: `${clockText(new Date(now))} ${agendaFor(events, now, reportMs)}` };
}
export interface HeartDeps {
  events: () => JournalEvent[];
  emit: (s: Stimulus) => void;
  reflect: () => Promise<unknown>;
  remember: () => Promise<boolean>;
  onError: (error: unknown) => void;
  now?: () => number;
}

/** Chooses one bounded idle activity. Incoming work is checked before and after every request. */
export class Heart {
  private state: HeartState = { look: false, pulse: false };
  constructor(private d: HeartDeps) {}
  requestPulse(): void { this.state.pulse = true; }
  completed(events: JournalEvent[], enabled = true): void { afterTurn(this.state, events, enabled); }
  async next(): Promise<Beat> {
    if (needsTurn(standing(this.d.events()))) return 'turn';
    if (this.state.pulse) {
      this.state.pulse = false;
      this.d.emit(agendaPulse(this.d.events(), this.d.now?.()));
      return 'pulse';
    }
    if (this.state.look) {
      this.state.look = false;
      if (needsTurn(standing(this.d.events()))) return 'turn';
      try {
        await this.d.reflect();
        const after = standing(this.d.events());
        if (followUpNeeded(known(after))) this.d.emit(agendaPulse(after, this.d.now?.()));
      } catch (error) { this.d.onError(error); }
      return 'reflect';
    }
    if (await this.d.remember()) return 'remember';
    return 'wait';
  }
}
