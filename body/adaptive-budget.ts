// How large one request may be is a trade this body can measure and make itself, instead of a
// constant that fits every provider and model by fitting none. The owner set the policy (his
// message of 2026-11-13): take the window from brain/providers.ts `contextWindow`, measure the
// provider's own feedback — how much of a request its cache answers, how often the front has to be
// cut, what a request costs in tokens, when a request was refused for length — and pick the budget
// and the cut step by the full cost of a turn, not by any single number. TENERAL_CONTEXT_CHARS, if
// the owner ever sets it, is only a ceiling on what this chooser may pick.
//
// Every input is a journal note this body wrote itself (budget.sent.v1 / budget.refused.v1), so
// the chooser is rebuildable from the journal and a rollback finds data an older body understands.

import type { JournalEvent } from '../brain/journal';

export const SENT_KIND = 'budget.sent.v1';
export const REFUSED_KIND = 'budget.refused.v1';
export const DECISION_KIND = 'budget.decision.v1';

/** Fraction of the token window a request may fill: the rest is the reply, tool specs and the error of measuring characters where the provider counts tokens. */
const SAFETY = 0.75;
/** Below this the conversation is too short to reason over, whatever the window says. */
const MIN_BUDGET_CHARS = 50_000;
/** What one token is worth in characters until the provider's own usage says otherwise. */
const FALLBACK_CHARS_PER_TOKEN = 4;
/** Only this many recent samples speak; older ones describe a model or budget no longer in use. */
const SAMPLE_WINDOW = 48;
/** A refusal only caps the budget while the request that followed it is still among the recent samples. */
const REFUSAL_WINDOW = 16;

/** The default share of the budget cut in one step (brain/memory.ts used to hard-code this). */
export const DEFAULT_STEP_SHARE = 0.2;
/** A finer cut when the cache answers little: less content dies per cut while the start barely pays for staying put. */
const FINE_STEP_SHARE = 0.1;
/** Below this cached share the cut moves finely; at or above it, coarsely. */
const FINE_CACHE_BELOW = 0.5;

/** What one sent request reported, under names this file wrote. */
interface Sent { chars: number; input: number; cached: number; dropped: number }
/** What one refused request reported. */
interface Refused { chars: number }

/** The numbers behind one decision, journaled for the owner and for the next generation's before/after comparison. */
export interface BudgetReport {
  samples: number;
  /** sum(cached)/sum(input) over recent samples, or null before any sample. */
  cachedRatio: number | null;
  /** What share of recent requests had to cut the front to fit, or null before any sample. */
  cutRate: number | null;
  /** The largest input a recent request was charged, in the provider's tokens. */
  peakTokens: number | null;
  /** Measured characters per charged input token, or null before any sample. */
  charsPerToken: number | null;
  /** How many refusals for length the recent window carries. */
  refused: number;
}

export interface BudgetDecision {
  budgetChars: number;
  stepShare: number;
  windowTokens: number | null;
  report: BudgetReport;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function readSent(data: unknown): Sent | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const chars = num(d.chars), input = num(d.input), cached = num(d.cached), dropped = num(d.dropped);
  if (chars === undefined || input === undefined || cached === undefined || dropped === undefined || input === 0) return null;
  return { chars, input, cached, dropped };
}

function readRefused(data: unknown): Refused | null {
  if (typeof data !== 'object' || data === null) return null;
  const chars = num((data as Record<string, unknown>).chars);
  return chars === undefined ? null : { chars };
}

function round(n: number): number {
  return Math.round(n);
}

/**
 * The budget and cut step for the next request, from the journal's own measurements.
 *
 * `windowTokens` is what brain/providers.ts `contextWindow` says for this provider and model;
 * null when nothing is known, where the historical default stands. `ceilingChars` is the owner's
 * TENERAL_CONTEXT_CHARS when set: it caps whatever the measurements ask for, never raises it.
 */
export function decideBudget(events: JournalEvent[], windowTokens: number | null, ceilingChars: number | undefined, fallbackChars: number): BudgetDecision {
  const sent: Sent[] = [];
  // Where each refusal sits among the sent requests that follow it: a refusal only caps the budget
  // while what it refused is still recent; one request under a new budget supersedes it.
  const refusals: { at: number; chars: number }[] = [];
  for (const e of events) {
    if (e.type !== 'note') continue;
    if (e.kind === SENT_KIND) {
      const s = readSent(e.data);
      if (s !== null) sent.push(s);
    } else if (e.kind === REFUSED_KIND) {
      const r = readRefused(e.data);
      if (r !== null) refusals.push({ at: sent.length, chars: r.chars });
    }
  }
  const recent = sent.slice(-SAMPLE_WINDOW);
  const totalSent = sent.length;
  const stillLive = refusals.filter((f) => totalSent - f.at <= REFUSAL_WINDOW);
  const refused = refusals.length;
  const refusedChars = stillLive.length > 0 ? stillLive[stillLive.length - 1]!.chars : null;
  const totals = recent.reduce((a, s) => ({ chars: a.chars + s.chars, input: a.input + s.input, cached: a.cached + s.cached, cuts: a.cuts + (s.dropped > 0 ? 1 : 0) }), { chars: 0, input: 0, cached: 0, cuts: 0 });
  const cachedRatio = recent.length > 0 ? totals.cached / totals.input : null;
  const cutRate = recent.length > 0 ? totals.cuts / recent.length : null;
  const peakTokens = recent.length > 0 ? Math.max(...recent.map((s) => s.input)) : null;
  const charsPerToken = recent.length > 0 ? totals.chars / totals.input : null;

  // What the measured traffic says the window is worth in characters. With no measurements the
  // fallback ratio carries it; with no known window the historical default stands.
  let budgetChars = windowTokens !== null ? round(windowTokens * (charsPerToken ?? FALLBACK_CHARS_PER_TOKEN) * SAFETY) : fallbackChars;
  budgetChars = Math.max(MIN_BUDGET_CHARS, budgetChars);
  // A refusal is the provider itself saying the request was too long: the next budget stays
  // clearly below what just failed, whatever the window or the cache suggested.
  if (refusedChars !== null) budgetChars = Math.max(MIN_BUDGET_CHARS, Math.min(budgetChars, round(refusedChars * 0.8)));
  if (ceilingChars !== undefined && ceilingChars > 0) budgetChars = Math.min(budgetChars, Math.floor(ceilingChars));

  const stepShare = cachedRatio !== null && cachedRatio < FINE_CACHE_BELOW ? FINE_STEP_SHARE : DEFAULT_STEP_SHARE;
  return { budgetChars, stepShare, windowTokens, report: { samples: recent.length, cachedRatio, cutRate, peakTokens, charsPerToken, refused } };
}
