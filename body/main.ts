import { watchJournal } from "./acceptance";
import { decideBudget } from './adaptive-budget';
import { research } from './research';
import { github, githubNotificationPoller, GITHUB_CURSOR_KIND, GITHUB_NOTIFICATION_CURSOR_KIND, type GithubCursor, type GithubNotificationCursor } from './github';
import { hasToken } from '../species/github';
import { subagent, subagents } from './subagent';
import { heldByInterrupt, importLegacyWork, resumeWork } from './work';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendEvent, readEvents } from '../brain/journal';
import { contextWindow } from '../brain/providers';
import { needsTurn } from '../brain/memory';
import { DEFAULT_IMAGES, imageRoute, imageStore, keepImage, rootOf } from './images';
import { runTurn } from '../brain/loop';
import { ProviderError, connect, type Provider } from '../brain/provider';
import { PATIENCE, describeDelay, failureKind, refusalNote, retryDelayMs, verdict, type FailureKind } from '../brain/retry';
import { clock, clockMayTick, inbox, owner, ownerStimulus, terminal, type Sensor, type Stimulus } from './sensors';
import { RESULT_KIND, due, sit } from '../brain/exam';
import { noteOf, parseWord, standing, type Word } from '../brain/owned';
import { idleTicks, offered, ownSpend, reportAsk } from '../brain/agenda';
import { known } from '../brain/known';
import { openPast } from '../brain/past';
import { libraryAt } from '../brain/ray';
import { sleep } from '../brain/sleep';
import { birth, composeSystem } from '../brain/soul';
import { mail, mailKey } from './mail';
import { zulip, zulipCredentials, zulipReactionPoller, ZULIP_QUEUE_CURSOR_KIND, type ZulipQueueCursor } from './zulip';
import { confirmedZulipOwnerId } from '../brain/zulip-owner';
import { TOOLS, type ToolContext } from './tools';
import { stopCurrentJobs, stopPreviousJobs } from './jobs';

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }
  return value;
}

const gen = env('TENERAL_GEN');
const journal = env('TENERAL_JOURNAL');
const workspace = env('TENERAL_WORKSPACE');
// Which provider, over which protocol, with which credentials: brain/provider.ts reads that from the environment.
let provider: Provider;
try {
  provider = connect(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const heartbeatMinutes = Number(process.env.TENERAL_HEARTBEAT_MINUTES ?? '30');
// Tokens a day that turns woken by a clock tick may spend. Not positive or not set: no cap.
const ownSet = Number(process.env.TENERAL_OWN_TOKENS_DAY);
const ownTokensDay = ownSet > 0 ? Math.floor(ownSet) : null;
// Hours between reports to the owner of what was done on the agent's own. Unset: 24; not positive: none.
const reportHours = process.env.TENERAL_REPORT_HOURS === undefined ? 24 : Number(process.env.TENERAL_REPORT_HOURS) > 0 ? Number(process.env.TENERAL_REPORT_HOURS) : 0;
// Characters per request. Set and positive, it is a ceiling on what the budget chooser may pick,
// never a floor: body/adaptive-budget.ts measures the provider's own feedback and decides the rest.
const contextChars = Number(process.env.TENERAL_CONTEXT_CHARS);
const budgetCeiling = contextChars > 0 ? Math.floor(contextChars) : undefined;
const budgetChars = contextChars > 0 ? Math.floor(contextChars) : undefined;
// Characters of the conversation shown as it happened. Not a positive number, or not set: the default in brain/logbook.ts.
const tailSet = Number(process.env.TENERAL_TAIL_CHARS);
const tailChars = tailSet > 0 ? Math.floor(tailSet) : undefined;
// The budget for this run, chosen from the journal's measurements against the window the provider table gives this model.
const budgetChoice = decideBudget(readEvents(journal), contextWindow(process.env.TENERAL_PROVIDER ?? '', process.env.TENERAL_MODEL ?? ''), budgetCeiling, budgetChars ?? 0);
// Images in one request. Not a whole number of 0 or more, or not set: the default in body/images.ts. 0 sends none.
const imagesSet = process.env.TENERAL_IMAGES_PER_REQUEST?.trim() ?? '';
// The image store is `memory/images` in the directory that holds `memory/`, which the journal's own path gives.
const sight = { load: imageStore(rootOf(journal)), max: /^\d+$/.test(imagesSet) ? Number(imagesSet) : DEFAULT_IMAGES };
// Authenticated Zulip owner uploads enter the same content-addressed store as terminal images.
// A temporary file is required only because keepImage performs the byte-level image validation.
async function keepZulipImage(bytes: Buffer): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'mica-zulip-image-'));
  const file = join(dir, 'upload');
  try { writeFileSync(file, bytes); return keepImage(rootOf(journal), file).marker; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const prompt = readFileSync(join(import.meta.dir, '..', 'brain', 'prompt.md'), 'utf8');
const letter = readFileSync(join(import.meta.dir, '..', 'BIRTH.md'), 'utf8');
const soulDir = env('TENERAL_SOUL');
const inboxDir = env('TENERAL_INBOX');
const ownerDir = env('TENERAL_OWNER');
// Optional numeric Zulip user id, explicitly configured by the owner. Absent or invalid, no
// Zulip sender may shorten provider retry backoff; ordinary conversation still works.
const zulipOwnerSetting = process.env.TENERAL_ZULIP_OWNER_ID?.trim() ?? '';
const zulipOwnerNumber = /^\d+$/.test(zulipOwnerSetting) ? Number(zulipOwnerSetting) : 0;
const zulipOwnerId = Number.isSafeInteger(zulipOwnerNumber) && zulipOwnerNumber > 0 ? zulipOwnerNumber : undefined;
// Public read-only repository activity. Empty disables it; no GitHub credential is read or sent.
// A comma-separated setting preserves the old single-repository configuration.
const githubRepositories = (process.env.TENERAL_GITHUB_REPOSITORIES?.trim() || process.env.TENERAL_GITHUB_REPOSITORY?.trim() || 'RayforceDB/rayforce,RayforceDB/teneral').split(',').map(s => s.trim()).filter(Boolean);
// The agent's past, for `recall` and `open`: asked of the database when its library is pinned and at hand, of the journal itself otherwise.
const organs = process.env.TENERAL_ORGANS ?? '';
const past = openPast(journal, organs === '' ? null : libraryAt(organs), (line) => console.error(line));
const ctx: ToolContext = { workspace, journal, gen, mutationCommit: null, id: env('TENERAL_ID'), inbox: inboxDir, peers: env('TENERAL_PEERS'), soul: soulDir, past };
// A previous generation's process groups must not write into the candidate under the new gates.
// Same-generation restarts keep their registry so `jobs` can list and stop them deliberately.
const stoppedJobs = stopPreviousJobs(journal, gen);
if (stoppedJobs.length > 0) console.error(`[jobs] stopped previous-generation groups: ${stoppedJobs.join(', ')}`);
process.on('exit', () => stopCurrentJobs(journal, gen));
// One-time import only: after this the journal is the live agenda, and the JSON file is never rewritten.
try {
  const imported = importLegacyWork(journal, gen, join(ownerDir, '..', 'work.json'));
  if (imported > 0) console.error(`[work] imported ${imported} active commitments into the journal agenda`);
} catch (err) {
  console.error(`[work] legacy agenda not imported: ${err instanceof Error ? err.message : String(err)}`);
}

let quitting = false;
let working = false;
let wake: (() => void) | null = null;
/** Owner stimuli journaled by this process: only these may shorten a failed turn's backoff. */
let ownerArrived = 0;
/** Aborts the turn in progress; null between turns. */
let current: AbortController | null = null;
/**
 * When the next try of a failed turn is due, or null when none is. After a provider-side failure
 * (a rate or usage limit) the turn is only retried at or after this time; a tick of the clock or
 * an inbox message does not hurry it. The owner's own line always does: that is in emit.
 */
let retryAt: number | null = null;

// A stimulus is on disk before anything reacts to it, so a crash right after cannot lose it.
function emit(s: Stimulus): void {
  appendEvent(journal, gen, { type: 'stimulus', source: s.source, text: s.text });
  if (ownerStimulus(s)) {
    ownerArrived += 1;
    // Only the owner's own channels end a wait for a failed turn. A tick, a peer, or another
    // Zulip sender is journaled but cannot hurry a provider already at its limit.
    retryAt = null;
  }
  wake?.();
}

/**
 * The owner asked for the work in progress to stop: only the owner's channel can (body/sensors.ts).
 * A turn that is running is aborted, and journals that itself (brain/loop.ts). A turn that is owed
 * but not running, because it failed and waits to be tried again or is only about to begin, is
 * ended here. When nothing is owed there is nothing to stop and the request is dropped: it is
 * never kept for a turn that has not been asked for yet.
 */
function interrupt(): void {
  if (current !== null) return current.abort();
  if (!needsTurn(readEvents(journal))) return;
  appendEvent(journal, gen, { type: 'turn.interrupted' });
  console.error('[interrupted]');
  wake?.();
}

/** The owner's words about memory that are not journaled yet (brain/owned.ts). */
const words: Word[] = [];

/**
 * The owner said something about the agent's memory. It is journaled between turns, never in the
 * middle of one, so that a note stands at a place where nothing is half done. Taking the
 * conversation back also ends the turn in progress: that turn belongs to what is taken back.
 */
function ownerWord(text: string): void {
  const word = parseWord(text);
  if (word === null) return console.error('[owner] a word about memory that could not be read was dropped');
  words.push(word);
  if (word.do === 'back') current?.abort();
  wake?.();
}

/** Journals the owner's words that wait. A word about something the journal does not hold is dropped. */
function settleWords(): void {
  for (const word of words.splice(0)) {
    const note = noteOf(word, readEvents(journal));
    if (note === null) console.error(`[owner] nothing in the journal for the word "${word.do}"; it was dropped`);
    else appendEvent(journal, gen, note);
  }
}

const sensors: Sensor[] = [
  // The terminal this process was started in, if any. In the background there is none: the input ends at once and the rest go on.
  terminal(console, () => { quitting = true; wake?.(); }),
  // The owner's lines from `./one talk`, which may come and go while this process lives.
  owner(ownerDir, undefined, interrupt, ownerWord),
  // Reads the journal and the soul before each tick: see clockMayTick for when it stays silent.
  clock(
    heartbeatMinutes * 60_000,
    () => {
      const events = readEvents(journal);
      // Past what the owner allows a day for time of its own, there is no tick: whatever arrives is still answered.
      return clockMayTick(events, soulDir) && (ownTokensDay === null || ownSpend(events, Date.now()) < ownTokensDay);
    },
    () => {
      const events = standing(readEvents(journal));
      return offered(known(events), Date.now(), idleTicks(events), reportAsk(events, Date.now(), reportHours * 3_600_000));
    },
  ),
  inbox(inboxDir, ctx.id, 2000, ctx.peers),
  ...githubRepositories.map(repository => github({
    repository,
    events: () => readEvents(journal),
    checkpoint: (cursor: GithubCursor) => {
      // A stimulus emitted in this poll is already on disk. If journaling it failed, the sensor
      // holds this checkpoint back. One note replaces all feed cursors for a repository atomically;
      // a crash before it repeats stimuli, whose ids suppress duplicates after restart.
      const pending = readEvents(journal).findLast(e => e.type === 'note' && e.kind === GITHUB_CURSOR_KIND && typeof e.data === 'object' && e.data !== null && !Array.isArray(e.data) && 'repository' in e.data && e.data.repository === repository);
      if (pending?.type === 'note' && JSON.stringify(pending.data) === JSON.stringify(cursor)) return;
      appendEvent(journal, gen, { type: 'note', kind: GITHUB_CURSOR_KIND, data: cursor });
    },
  })),
  ...(process.env.TENERAL_AUTH && hasToken(process.env.TENERAL_AUTH) ? [(emit: (s: Stimulus) => void) => {
    const worker = githubNotificationPoller({
      events: () => readEvents(journal),
      token: () => existsSync(join(process.env.TENERAL_AUTH!, 'github-token')) ? readFileSync(join(process.env.TENERAL_AUTH!, 'github-token'), 'utf8') : '',
      checkpoint: (cursor: GithubNotificationCursor) => appendEvent(journal, gen, { type: 'note', kind: GITHUB_NOTIFICATION_CURSOR_KIND, data: cursor }),
    }, emit);
    const timer = setTimeout(() => { void worker.poll(); setInterval(() => { void worker.poll(); }, 60_000); }, 60_000);
    return () => { clearTimeout(timer); worker.stop(); };
  }] : []),
  resumeWork(journal, gen, () => {
    if (working || quitting) return true;
    const events = readEvents(journal);
    return needsTurn(events) || heldByInterrupt(events);
  }),
  zulip({ conversations: true, credentials: () => zulipCredentials(join(workspace, '..', 'mica-zulip.json')), events: () => readEvents(journal), ownerId: confirmedZulipOwnerId(readEvents(journal), zulipOwnerId), keepImage: keepZulipImage }),
  // Reactions require an event queue; the existing message poll has no such events.
  // Delay registration so smoke runs do not depend on Zulip, and checkpoint only after delivery.
  emit => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const reactions = zulipReactionPoller({
      credentials: () => zulipCredentials(join(workspace, '..', 'mica-zulip.json')),
      events: () => readEvents(journal),
      checkpoint: (cursor: ZulipQueueCursor) => {
        const pending = readEvents(journal).findLast(e => e.type === 'note' && e.kind === ZULIP_QUEUE_CURSOR_KIND);
        if (pending?.type === 'note' && JSON.stringify(pending.data) === JSON.stringify(cursor)) return;
        appendEvent(journal, gen, { type: 'note', kind: ZULIP_QUEUE_CURSOR_KIND, data: cursor });
      },
    }, emit);
    const start = setTimeout(() => {
      void reactions.poll();
      timer = setInterval(() => { void reactions.poll(); }, 30_000);
    }, 60_000);
    return () => { clearTimeout(start); if (timer) clearInterval(timer); reactions.stop(); };
  },
  mail({
    key: () => mailKey(process.env, join(workspace, '..', '..', '.env')),
    events: () => readEvents(journal),
    quiet: id => appendEvent(journal, gen, { type: 'note', kind: 'mail.quiet.v1', data: id }),
  }),
];

/** One turn. Returns what was thrown, or null when it ran to its end. */
async function turn(): Promise<{ error: unknown } | null> {
  // To stderr, so the terminal is not silent for the minutes a reply or a tool can take.
  console.error('[thinking]');
  current = new AbortController();
  try {
    const outcome = await runTurn({
      journal, gen, provider, tools: [...TOOLS, subagent(provider), subagents(provider), research(provider)], ctx, budgetChars, tailChars, sight, imageRoute: imageRoute(process.env), budget: budgetChoice,
      // Composed again every round: the agent may have just rewritten its soul.
      system: () => composeSystem(prompt, soulDir, journal),
      onText: (t) => console.log(`\n${t}\n`),
      onDelta: (t) => console.log(t),
      onTool: (name) => console.error(`[tool] ${name}`),
      signal: current.signal,
    });
    if (outcome === 'mutation') process.exit(75);
    // Not a failure: nothing is counted and nothing is tried again. The loop below finds no turn owed and waits.
    if (outcome === 'interrupted') console.error('[interrupted]');
    return null;
  } catch (error) {
    return { error };
  } finally {
    current = null;
  }
}

/** Sleeps until a sensor emits or the agent is told to quit, or for `ms` when given. */
function idle(ms?: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = ms === undefined ? undefined : setTimeout(resolve, ms);
    wake = () => { clearTimeout(timer); resolve(); };
  }).then(() => { wake = null; });
}

/** How long after a memory could not be formed before the next try. The episode waits; nothing is lost by waiting. */
const REST_RETRY_MS = 15 * 60_000;
let restNotBefore = 0;

/**
 * What the agent does when nothing is asked of it: it forms one memory, of the oldest episode
 * that is over and has none (brain/sleep.ts). Whatever arrives meanwhile cancels the request and
 * is answered first. Returns false when there was nothing to remember, or no use in trying now.
 */
async function rest(): Promise<boolean> {
  if (Date.now() < restNotBefore) return false;
  const woken = new AbortController();
  wake = () => woken.abort();
  try {
    const slept = await sleep({
      journal, gen, provider, specs: TOOLS.map((t) => t.spec), budgetChars: budgetChoice.budgetChars, tailChars,
      system: () => composeSystem(prompt, soulDir, journal),
      signal: woken.signal,
    });
    const said = { remembered: 'formed a memory', merged: 'made several memories into one', reflected: 'looked over what it is doing', quarantined: 'no memory could be formed of one stretch; it stays in the journal as it happened' };
    if (slept === 'remembered' || slept === 'merged' || slept === 'reflected' || slept === 'quarantined') console.error(`[memory] ${said[slept]}`);
    return slept !== 'nothing';
  } catch (err) {
    if (woken.signal.aborted) return true;
    // Not a failed turn: nobody waits for this, so it is neither counted nor journaled, only tried again later.
    console.error(`[memory] could not form a memory now: ${err instanceof Error ? err.message : String(err)}`);
    restNotBefore = Date.now() + REST_RETRY_MS;
    return false;
  } finally {
    wake = null;
  }
}

// Everything above loaded and parsed: this generation can start.
appendEvent(journal, gen, { type: 'generation.ready', commit: gen });
// A journal with no stimulus yet means this individual was never born: the letter goes first.
const firstWords = birth(readEvents(journal), letter);
if (firstWords !== null) emit(firstWords);
const stops = sensors.map((start) => start(emit));
stops.push(watchJournal(journal, () => wake?.()));

// Failed turns in a row, and how many of the latest kind. What each kind leads to is in brain/retry.ts.
let failures = 0;
let streak: { kind: FailureKind; count: number } = { kind: 'passing', count: 0 };
for (;;) {
  settleWords();
  // Also true right after a restart: an unfinished turn or a stem note is picked up here.
  while (!quitting && needsTurn(readEvents(journal))) {
    if (retryAt !== null && Date.now() < retryAt) {
      // A failed turn is still owed but its next try is not due. Sleep past it without waking on
      // every stimulus: a clock tick or an inbox message must not hammer a provider already at
      // its limit (see retryAt). The owner's own line clears it in emit.
      const wait = retryAt - Date.now();
      console.error(`[retry] waiting ${describeDelay(wait)} for the provider's limit before the next try, or until the owner writes`);
      await idle(wait);
      // Any stimulus can end the sleep. Recheck the deadline before calling the provider: only
      // the owner's own message clears retryAt, and the scheduled time may not have arrived.
      continue;
    }
    const before = ownerArrived;
    working = true;
    const failed = await turn();
    working = false;
    settleWords();
    if (failed === null) {
      retryAt = null;
      failures = 0;
      streak.count = 0;
      continue;
    }
    const { error } = failed;
    const kind = failureKind(error);
    failures += 1;
    streak = { kind, count: kind === streak.kind ? streak.count + 1 : 1 };
    // The stack when it is this code's own fault: it is what the next generation needs to mend it.
    console.error(`[turn failed] ${error instanceof Error ? (kind === 'own' ? error.stack ?? error.message : error.message) : String(error)}`);
    const next = verdict(kind, streak.count);
    if (next === 'exit') {
      // Not the provider: waiting mends nothing. As a crash the stem counts it, and rolls this generation back if it goes on.
      console.error(`[giving up] ${PATIENCE} turns in a row failed in this generation's own code; exiting so the stem can act`);
      process.exit(1);
    }
    if (next === 'record' && error instanceof ProviderError) {
      // The one failure that is journaled: as a reply, it ends the owed turn, and it is where the owner will read it.
      const note = refusalNote(error, kind);
      appendEvent(journal, gen, { type: 'assistant', text: note, toolCalls: [] });
      console.log(`\n${note}\n`);
      failures = 0;
      streak.count = 0;
      continue;
    }
    const delay = retryDelayMs(failures, error instanceof ProviderError ? error.retryAfterMs : null);
    const ownerWrote = ownerArrived !== before;
    const note = {
      type: 'note' as const,
      kind: 'turn.failed',
      data: {
        kind, failures, message: (error instanceof Error ? error.message : String(error)).slice(0, 600),
        retryAt: ownerWrote ? null : new Date(Date.now() + delay).toISOString(),
      },
    };
    // For the owner and the record: the turn is still owed, and the journal shows why nothing is
    // coming and when the next try is. Written before any await, so it cannot loop with the retry.
    appendEvent(journal, gen, note);
    if (ownerWrote) {
      // The owner wrote while the turn ran; that message gets its try now, once. Other traffic
      // remains journaled but leaves the provider's backoff in force.
      console.error(`[retry] ${failures} in a row; the owner wrote meanwhile, trying again now`);
      continue;
    }
    retryAt = Date.now() + delay;
    console.error(`[retry] ${failures} in a row; trying again in ${describeDelay(delay)}, or when the owner writes`);
    await idle(delay);
  }
  if (quitting) break;
  // Nothing is owed: time to remember. After each memory the loop looks again for a turn to take.
  if (await rest()) continue;
  if (quitting) break;
  // Before waiting: the memory sits its exam when enough has been remembered since the last one. No model is asked;
  // the result is journaled, for the owner to see and for a later change of the memory to be held against (immune/gates.ts).
  try {
    const events = standing(readEvents(journal));
    if (due(events)) appendEvent(journal, gen, { type: 'note', kind: RESULT_KIND, data: sit(past, events) });
  } catch (err) {
    console.error(`[memory] the exam could not be sat: ${err instanceof Error ? err.message : String(err)}`);
  }
  // And what the store gained is written out, so that the next start finds it on disk.
  try {
    past.sync();
    past.persist();
  } catch (err) {
    console.error(`[memory] the store could not be written: ${err instanceof Error ? err.message : String(err)}`);
  }
  // A prompt only where someone can type at it; in the background it would be noise in the log.
  if (process.stdin.isTTY) process.stdout.write('> ');
  await idle();
}

for (const stop of stops) stop();
process.exit(0);
