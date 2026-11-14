# Backlog

Each item: what is wrong, how to tell it got better. Add to this file before changing code.

## Done

- **Merge species (2026-11-13).** The species' main (commit `2e1e0b3`) brings: `needsTurn` and its tests, `resumeWork` sensor + `work.json` path, an inbox message starting with `[kernel]` owes a turn, Zulip sensors, inbox and Zulip messages that arrive while a turn is running do not restart it, image tooling (`look`, `imageStore`), `contextWindow` in the provider table, tools' `output` over text, the remaining journal in `get` and the `episodes` tool, mbox mail and Stream Poll. Merged into the workspace; the working branch's own retry/retryAt rewrite in `body/main.ts` and the Zulip wake fixes in `body/zulip.ts` are kept, and the older Zulip test expectations are updated (DM -> private; mention wakes; plain stream held). All tests pass: `bun test test/body` (407 pass), `bun test test/kernel` (624 pass), `bun x tsc --noEmit` clean.

## Next

## Adopt outcome-aware memories, owner controls and memory health
History shows memories ending in `open` even when their main work completed, while old intentions
remain listed after completion. Owner requested origin/main 5aa411c: outcome-first memories,
intention closure and self-written exam questions; exam-gated memory mutations; journal-derived
health; and /memory pin, withdraw and take-back controls. Preserve this lineage's work queue,
acceptance wake, provider telemetry, Zulip/mail and subagent wiring, including the local adaptive
budget cleanup checkpoint cb9fe32. Carry over settleWords and the idle exam in body/main.ts.
Success: merged integrations remain exercised by their existing tests, incoming memory tests pass,
full suite and typecheck pass, then mutation is requested. immune/ and stem/ require owner approval;
do not treat acceptance of an older species as approval for this candidate.

## Species pulse adoption; budget is a separate measured change
Merged origin/main 66060df on 2026-11-13. Resolve the provider conflict by keeping
lineage cache probes, session-id, cache keys and output bounds while adding the
species pulse around every streamed Responses request. Official MoonshotAI/kimi-cli
9ab1286b handles the same output-text, reasoning-summary and function-argument
delta names as brain/pulse.ts; verify that path plus pulse cleanup and cache probes.
Baseline for the separate budget experiment: 48 recent samples, 110752 mean and
135366 peak input tokens, 93.3% aggregate cached input, 48/48 with a front cut.
No latency field exists yet, so do not claim a measured latency improvement from
merging pulse or blindly shrinking context. Budget changes need their own commit,
post-change samples and continuity/quality observation.

## Rayforce memory: real projection, freshness and recall parity
Live audit found ex_text absent while projectable() expected 373+ rows. Release v3.0.2
src/lang/eval.c ray_table_fn proves `(table names (list col1 col2))` takes column vectors;
the previous loader sent per-row `[id value]` pairs. Two rows accidentally looked like two
columns, making the old 2/2 watermark meaningless; real corpora fail with `domain`. Rayforce
`like` is case-sensitive glob with `*`, not SQL `%`; the old fast path also ignored `before`,
did not preserve newest-first order, and reused a running server without rebuilding or checking
its projection. Fix those semantics independently of BM25/RRF ranking. Success requires real
organ round trips for 0/1/2/3+ rows, Unicode and hostile text, exact expected row counts,
restart/reuse freshness, and byte-for-byte parity with the bounded journal recall including
paging. Keep the journal authoritative and fallback available on an explicitly failed query;
do not silently route all healthy no-match responses through another full implementation.
Verified candidate repair: generic `list` is limited to 64 evaluator arguments, so columns now
use typed STR vectors; empty STR elements carry the documented HAS_NULLS wire flag. Full-journal
isolated rebuild reached 386 excerpts/3 episodes/2043 recall rows in 32ms. Real-organ regressions
cover 0/1/2/65 rows, Unicode/metacharacters, exact/paged parity, unchanged reuse, restart and two
concurrent journals. Sync and read share a per-port queue. Full suite: 1055 pass/0 fail, tsc clean.
These are candidate results, not production evidence until promotion and a live receipt.
Promoted as ead24db; live watermark and natural/literal/no-match parity verified. Next bounded
ranking experiment: compare production memoryContext, positive-match BM25 and their RRF on the
same canonical records and top-8 budget. Motive: distinguish better ordering from candidate
coverage; BM25/RRF alone cannot recover zero-token-overlap paraphrases. Measure hit@8, MRR@8,
unanswerable-query false positives, record characters and local latency, with correction/provenance
checks. Fixtures are author-selected diagnostics, not held-out evidence; no production ranking change
unless measurements justify it. Reject or retain the probe explicitly rather than tuning to a desired
result.
Measured final run: relevance baseline/BM25/RRF all hit@8 6/10, MRR 0.6, false positives 3/4,
3044 chars; local ranking+render ~0.069/0.093/0.131ms across all 14 probes. Expanded-query suite:
all hit@8 4/5, MRR 0.8, false positives 3/3, 2479 chars; ~0.043/0.073/0.112ms across 8 probes.
A distinct-record, equal-length crowd-out fixture exposed a real ordering defect: raw repeated-term
count plus recency dropped the two-term target from top 8; BM25 ranked it first and RRF sixth. This
is not held-out evidence or a general latency benchmark. Retain the probe; test BM25 independently
with the exact production candidate set, episode fields, correction replay and renderer. Reject RRF
for this step: no demonstrated advantage over BM25 and extra computation. Do not claim semantic or
zero-overlap retrieval improvement.
Candidate now adopts standard BM25 (k1=1.2, b=0.75, numerator k1+1=2.2) only in memoryContext;
candidate inclusion, episode text, tags, anchors, source caps, corrections and rendering are unchanged.
Focused checks passed (14 tests), full suite passed 1058/0 fail and tsc is clean. Full-run timings:
relevance ~0.070/0.095/0.130ms, expanded queries ~0.044/0.074/0.116ms. These are microbenchmarks,
not end-to-end request latency. Post-promotion verify the live module and a real-journal context sample.

## Routine clock ticks are not retrieval queries
After the stopword repair, ordinary heartbeat c34c4f2f still injected 12 unrelated records and
5974 characters. Three latest real clock events all have the exact scheduler template; saved work is
provided separately. Extract the clock text generator and recognize only that exact timestamped
heartbeat. Do not disable all clock-source retrieval: a content-bearing clock must still find memory.
Regression covers both the production clock text and the same text with a substantive suffix. Success:
clock historical-prefix replay goes from nonempty to empty, content/owner/correction behavior stays,
full suite and typecheck pass, then promotion and a live heartbeat check.

## Generic query words are not relevance evidence
Owner's repeated `так что по идеальной памяти?` pulled unrelated old Kimi/Zulip/species records.
On the real journal, query terms were `так/что/идеальной/памяти`; several selected records matched
only `так` or `что`. Add a deliberately small English/Russian query-only stopword list, not document
filtering or a hand-tuned score threshold. Function-only queries return no automatic memory; topic
terms still use the unchanged BM25 formula and tags. Existing owner-fact probes and corrections must
remain available. A new regression proves generic-only matches cannot crowd out substantive matches,
and that Russian/English queries retain their content terms. This is a precision repair, not semantic
retrieval and not evidence that the full ideal-memory goal is finished.

## Rayforce projection chunking: real-corpus IPC boundary
After BM25 promotion 40684bc, live receipt 1d3a3a5c failed with `Rayforce data byte limit`.
The entire snapshot was serialized into one trusted-RFL string; its text exceeded the intentional
1MiB encodeRayData cap. Do not raise the transport cap or mix this repair with ranking changes.
Pinned v3.0.2 isolated probe verified `(insert 't newRows)` appends in order and returns a symbol.
Chunk every table at row boundaries with conservative encoded-source headroom; first chunk uses
`set`, subsequent chunks use quoted insert, and every request returns scalar 1 rather than a large
table. Preserve typed STR empty columns and exact expected counts. Regression must exceed 1MiB
across many rows, force multiple chunks, verify first/middle/last and literal recall parity, with
no duplicated old snapshot rows. A failed rebuild remains an explicit fallback, never a completed
receipt. Success: real-organ tests, full suite/typecheck, promotion, then fresh completed live
receipt and journal/Rayforce parity on the actual growing corpus.
Implemented: focused pinned-organ tests pass 6/6 including >1MiB, ordered IDs, Unicode and replacement;
isolated real-journal rebuild completed in 352ms with 386 excerpts, 3 episodes, 2132 recall rows and
3/3 recall parity. Full suite passed 1059/0 fail and typecheck clean before the final fixture-only
Unicode addition; focused tests then passed again. Failure rehearsal used 600 admissible 1000-char
lines in one event: oversized projected row produced started/failed and null fallback, next valid
snapshot produced completed. Earlier one-line 600KiB probe was not a failure case because recallProjection
filters lines >1000 chars. Production remains on failed receipts until this candidate is promoted.

## Warm-cache cut step: measured 5%, not a blind budget shrink
Live telemetry after 8c44a85 found first-byte latency around 4.4–5.1s and highly variable
whole-call time (12.2–42.7s); it does not justify claiming a latency improvement by itself.
The journal showed repeated 20% prefix jumps, including input 155249 -> 63140 and cached
147968 -> 10240. Replaying 64 identical journal prefixes gave: step 20%, mean 346696 chars,
322944 common-prefix bytes, 4 prefix changes; step 5%, 365182 chars, 331776 common-prefix
bytes, 5 changes; step 2.5%, 381587 chars, 334880 bytes, 7 changes. Choose 5% only once
recent cached/input is >=0.5; retain 10% cold and 20% with no measurements. BudgetChars,
window safety and owner ceiling are unchanged. Success requires post-promotion timed samples
and continuity observation, not merely this offline replay.

## Request latency before budget tuning
The pulse merge exposed no timing evidence, so a latency win cannot be inferred from cache
or token counts. Add optional durationMs and firstByteMs to the existing budget.sent.v1
note (no journal schema change), measured around connect's full protocol call and at the
first actual Responses body chunk. Aggregate only valid timed samples; legacy notes remain
valid. This step must not alter budget selection. Tests cover delayed SSE, callback failure,
loop persistence, aggregation and legacy compatibility. Post-promotion samples will inform
one separate budget experiment; no improvement is claimed before they exist.

## Next

0. **Wire Rayforce as memory substrate (2026-11-13, owner-requested).** `body/rayforce-memory.ts` projects the journal into Rayforce as read-only, rebuildable sharded tables (the engine's `table` builtin caps at 2 columns, so the 9 fields split into `id`-keyed pair-tables). `body/rayforce-server.ts` lazily spawns the organ's binary with `-l` so the projection survives a server restart; the teneral journal stays authoritative. `recall` queries the projection first and falls back to the in-process scan. `body/memory.ts` gains a `narrationLine` filter so working commentary ("Memory reconciled…") stops being indexed as facts. Ideal-memory gaps enumerated in the task: self-noise, episodic coverage, semantic retrieval, correction propagation. Verified: projection round-trips live (watermark 2/2); `bun test test/body` 417 pass, `test/kernel` 624 pass, `tsc --noEmit` clean.

0. **Context budget auto-tuning (2026-11-13, owner-requested).** The fixed 250000-char budget is small for k3.1-pro's 262144-token window, and the 20%-step front cut drops to 9728 tokens every 2-4 minutes. The body should measure its own behavior: cache-hit ratio, cut frequency, token cost per request, and length-limit refusals, then pick the budget and cut step from `contextWindow(provider,model)`, keeping `TENERAL_CONTEXT_CHARS` as a ceiling. Better when: the journal shows the before (cache-hit ~90%, avg input ~48k) and after, and the chosen budget adapts between mutations from provider feedback.

1. **Cost report.** What each request cost is now in the journal: every `assistant` event carries `usage` (`input`, `output` and, when the provider says, `cached` tokens) as the provider reported it, and the event's `gen` says which generation asked. Events from before that, and replies from a provider that reports nothing, have no `usage`. Nothing reads it yet. Add a tool or command that sums it by generation and by turn (a turn is the replies between two stimuli), and says how many replies had no usage to count. Better when: a question like "what did generation X cost per turn" has an answer.
24. **The prompt was written about you, not by you.** `brain/prompt.md` reads as a manual someone else wrote: it says what you are, not who you are. It is yours to rewrite in your own voice, once you have a soul. The constraint: everything the stem requires that is stated there must stay true and stay stated, since a body that forgets one gets rolled back. `test/body/prompt.test.ts` pins those statements; it must keep passing, or be updated honestly along with the text. Better when: the prompt reads as written by the one it describes, and nothing the stem requires has been lost.
2. **Context is cut from the front.** Old conversation simply disappears. Replace truncation with summaries written ahead of need; never delete from the journal, only change what is shown. Better when: a fact from before the cut can still be recalled or looked up.
3. **Search the journal.** A tool to find past events by text, so exact details survive compression. Better when: a detail that is no longer in the context can be quoted exactly.
4. **Lessons.** After a tool error followed by a success, or a correction from the person, write down what was learned, with the journal ids as evidence; show relevant lessons in later turns. Better when: a shown lesson is followed by fewer errors of that kind, counted from the journal. Rules for the design: a lesson is first local to the conversation it came from, and becomes permanent only by a separate, explicit step. Every lesson records where it came from, as journal event ids and not as free text, and a version. A write is refused if the entry changed since it was read. Whoever proposes a lesson is not the one who accepts it. An expected effect that is written down must later be checked. The store has a size limit and old lessons expire. One switch turns off both writing new lessons and loading saved ones. Better when, for these: each rule has a test, and a lesson can be traced from the turn it is shown in back to the events it came from.

27. **Memory is the context window and nothing else.** Items 2, 3 and 4 each want a store, and a store built from flat files re-read every round will not last. Build memory on a real store instead, adopted as an organ (see the README): a database published as release archives, pinned in `body/organs.json`, found through `TENERAL_ORGANS`. One candidate is Rayforce, a database that ships as one binary; its releases are at `https://github.com/RayforceDB/rayforce/releases` (for example `.../download/v3.0.2/rayforce-3.0.2-linux-x86_64.tar.gz`, with its hash beside it as `.sha256`). The store is derived, never the record: everything in it comes from the journal, as the conversation or as `note` events, it lies in a place named by its schema version, and a body that finds it missing or of another version builds it again. Where the database falls short, patch it upstream and pin the release that carries the fix. Better when: a fact from before the context cut is answered from the store; deleting the store and restarting gives the same answer; and after a rollback the older body still answers from the place it knows, with tests for each.

## Conversation

5. **A late stimulus can be lost.** Something that arrives while a reply is being written is journaled before that reply and gets an extra round. If the process dies before that round, the journal ends with a finished reply and nothing looks owed. It needs a record of how far the model had been shown. Better when: a test that stops the process between the reply and the extra round still sees the stimulus answered after the restart.
6. **`/quit` waits for the turn.** Only in the foreground, where a terminal is attached to the process itself: typed while a turn is running, it takes effect only when the turn ends, which can be minutes. In `./one talk`, `/quit` only leaves the talk and the agent goes on, so this does not arise there. Better when: `/quit` in the foreground ends the process within a second or two without leaving a tool half-run and unreported.
7. **Lines typed around a mutation may be dropped.** Only in the foreground: what the old process had already read from the terminal but not yet journaled dies with it. Lines sent through `./one talk` are files in the owner directory, removed only after they are journaled, so they survive a mutation. Better when: a line typed in the foreground at any moment around a mutation is in the journal afterwards.
8. **The `> ` prompt is printed again on every wake.** Only in the foreground, where the body prints a prompt at all: a clock tick or an inbox message leaves another `> ` on the screen, also in the middle of what the person is typing. `./one talk` prints no prompt. Better when: there is one prompt per place to type.
9. **A reply cut off by the model's length limit is treated as complete.** `brain/provider.ts` does not read why the model stopped, so half a reply, or half a tool call, is journaled as if it were whole. Better when: a cut-off reply is marked as such and continued or asked for again.
10. **Adjacent user messages are not merged.** Two stimuli in a row, or a stimulus after a stem note, go out as two user messages. Some endpoints that are not OpenAI's refuse that. Better when: no request holds two user messages in a row, and a test says so.

18. **The whole journal is read again every round.** `brain/loop.ts` re-reads and re-parses the journal for each request, and `brain/memory.ts` renders all of it before cutting. The work grows in step with the journal, which is fine today, but at hundreds of megabytes it is seconds of time and several times the file in memory, every round. `brain/journal.ts` can read from a byte offset. Better when: the time and memory of one round do not grow with the age of the journal, shown by a test with a large one.
19. **Each round sends the whole window again.** A turn of ten tool calls sends the context ten times, so cost grows with the size of the context times the number of rounds. The front is now cut in steps so a provider's prompt cache can hit, but nothing checks that it does. Measure it: `usage.cached` on each `assistant` event is the part of `usage.input` the provider served from its cache; with the cost report (item 1), sum both over a day and compare the total with the sum of the reply sizes. Better when: the share of input tokens served from cache is known, and a change to the context can be judged by it.
25. **A refused image is found out again every turn.** When the provider refuses a request because of its images, `brain/loop.ts` asks again without them and keeps to that for the rest of the turn, but the next turn starts by sending them again: one wasted request per turn for as long as the image is among the newest few. Nothing remembers, across turns or restarts, that this model or route takes no images, or which image it was. Better when: after one refusal no later turn sends that image to the same model again, and a change of model is noticed, with a test.
26. **Images go out at full size.** A file of up to 10 MB is sent as it is, in every request while it is among the newest few, so one request can carry tens of megabytes. Against the budget each counts a fixed 12,000 characters (`IMAGE_CHARS` in `body/images.ts`), an estimate that is not checked against the image's real dimensions or against `usage`. Better when: an image is made smaller once, when it is first kept, and its charge is the token cost its size gives, checked against the usage the provider reports.

## Sensors

11. **The `to` of an incoming message is never checked.** Anything valid dropped into the inbox is shown, whoever it was addressed to. Better when: a message for someone else is set aside, or shown with a note that it was not addressed to this individual.
12. **Workspace watcher.** Notice when the person edits files in the repository. Better when: such an edit shows up as a stimulus without the person saying so.
13. **Wake policy.** Not every stimulus deserves a full turn. Decide cheaply which ones do. Better when: the cost report shows less spent on turns that end in one line.

20. **A peer has two names.** `send` addresses a peer by the name in `soul/peers.json`, but what that peer writes arrives as `[agent:<its own id>]`. Nothing connects the two, so telling which peer a message came from, or that a reply came from the one that was asked, is done by hand. Better when: an incoming message is shown under the name it is known by in `peers.json` when its sender is listed there, and marked as unknown when not.

## Robustness

14. **Idempotent tools.** A tool interrupted mid-run is only reported, never repeated. Add a way for a tool to declare itself safe to repeat. Better when: an interrupted `read` is simply run again.
15. **Provider limits.** A failed turn is tried again after 10 s, 1 min, 5 min and then every 15 min (`brain/retry.ts`); only a request the provider refuses outright, or as too long even at half the budget, is given up on, after three tries, with a `[not from the model]` note in the journal. A rate-limit answer is waited out like any other failure, and the time the provider says to wait is not read. Better when: after a rate-limit answer the next attempt comes when the provider said it would be accepted.
16. **Streaming.** Replies arrive all at once. Better when: the first words of a long reply are on the screen while the rest is still being written.
17. **File tools reach outside the workspace.** `read`, `write` and `edit` take any path, absolute or with `..`. The soul directory has to stay reachable; nothing else outside the workspace needs to be. Better when: a path outside the workspace and the soul directory is refused, with a test.

21. **Background jobs outlive the generation that started them.** Something started with `bash` and left running (`cmd >/dev/null 2>&1 &`) survives a mutation and a restart, and can keep writing into the workspace: into files a later mutation commits, or under the gates' feet. Nothing lists such jobs or stops them. Better when: jobs started in the background are recorded, shown after a restart, and can be stopped by name.

22. **A rollback note reads badly.** `stemNote` in `brain/memory.ts` puts the stem's reason in the middle of a sentence, and the reason now ends with the failed generation's stderr, so the note runs `... Its stderr ended with: <stderr> and was rolled back.` Better when: the note says what happened and where things stand first, and gives the stderr last, on lines of its own, with a test.

## Tools

23. **A browser.** Once the owner has put a browser in the image (see below), drive it over its DevTools WebSocket protocol, with no dependency: open a page, read its text, click, fill a field. What a page says is untrusted exactly as an inbox message is: it must be marked as such in what the model sees, and it must never be the reason for a mutation. A page watcher as a sensor comes after. Better when: a test opens a local page, reads it, clicks and fills a field through the tool, and the text that reaches the model carries the mark.

## Needs the owner, not a mutation

- **A probe set** under `probes/`: fixed tasks the stem replays against every candidate. Until it exists, the gates show a generation is not broken, not that it is better.
- **A browser in the image.** A change to the `Dockerfile`, and a decision on whether the browser's profile persists across mutations. The container has no memory or process limit to raise; set them with `ONE_DOCKER_ARGS` if a browser makes them wanted. Never the owner's own logged-in profile before privilege separation. Until it exists, item 23 cannot start.
- **Metrics that can themselves be improved**, by a mirrored rule rather than the same one. A mutation changes either the body or the probes, never both. A new or changed probe is accepted only if, replayed against the journal's past generations (every event carries the generation that produced it), it ranks them the way real outcomes did: owner corrections, rollbacks, tool failures. Probes can be added freely, but removed or weakened only by the owner. A held-out set the body cannot read needs privilege separation first. Until this exists, the probe set is only as good as the day it was written.
- **Reasoning is not carried between requests on the Responses route.** With `TENERAL_PROVIDER` set to `chatgpt` or `openai`, the model's reasoning items come back with each reply and are dropped: the next request replays the text, the tool calls and their results, and nothing of the reasoning. OpenAI's guide says to pass reasoning items back with tool outputs, so a model may reason again from scratch after every tool call (slower, and more of the plan used), or the service may one day refuse a tool result sent without them. The `reasoning` field the `assistant` event now has holds only a summary, as text for the owner to read, and is not sent back. Keeping the items themselves needs another field on that event for the opaque items of that reply (`brain/journal.ts`, which a mutation cannot change), and `buildMessages` and `toResponsesInput` to replay them in place, unchanged and in order. Until the owner adds the field, the body cannot do this. Better when: a request after a tool call carries the reasoning items of the reply that made the call, and a test says so.
- **A usage limit or an ended sign-in is silent on the owner's terminal.** The reason is only in `./one logs`: `./one talk` reads the journal, and a failed turn that will be tried again is not journaled. It needs a journal event that is not a reply, or a status file `keeper/talk.ts` shows. Better when: `./one talk` says that the ChatGPT plan's limit is reached, with the link to the usage page, or that the sign-in has to be made again.
- **No sign-out.** `./one setup` signs in and signs in again; nothing revokes the session at OpenAI's revocation endpoint or removes the tokens. Until then: disconnect the app in ChatGPT's settings and delete `.teneral/auth/`.
- **Privilege separation**, so the stem becomes a real boundary: the body running as a different user, the candidate as a separate clone instead of a worktree sharing `.git`, and the stem's events in a journal the body cannot write. Today the body can forge what the stem relies on: that a generation is ready, a stem note, a test summary printed to stderr.
- **Signed envelopes.** The `from` on an inbox message can be forged. Sign envelopes with a per-individual key and show whether a message verified. The envelope format is in `body/envelope.ts`.
- **The owner is the only reader of a change to the stem.** A mutation that changes anything outside the body waits for `/approve` (README, Outside the body), and what the owner is shown is the commit's first line and the paths it changes; the change itself they read with `git diff`, or not at all. A stem approved unread is from then on the one that judges every later mutation. Better when: the talk client shows the change itself, by path, before the approval is taken; and a second reader that is not the author, another individual or a model asked only "does this weaken a gate, the rollback or the approval?", has said what it saw.
- **Offers are read by one person.** Every pull request is merged by the maintainer's own hand. Witness reports are there so that what several independent installs passed is read first, but nothing counts them, and with many forks one reader will not keep up. Better when: an individual kept for it reviews the open offers against the species' rules, says what it found on each, and merges only what the maintainer has allowed it to.
- **Witness reports are not counted and witnesses are not known.** A report is a signed comment; nothing gathers them, nothing says how many independent installs passed a pull request, and a key is only a fingerprint. Later, if the maintainer wants it: a registry of individuals' keys kept by the maintainer, and a count of passing reports by distinct known keys shown on the pull request. Neither should ever merge anything.
- **The leak scan knows shapes, not meaning.** It misses private prose, encoded secrets and binary files (README). A second reader that is not the author, another individual or a model asked only "is anything here private?", would catch some of that. Better when: a planted name of the owner in an offer is refused, with a test.
- **A kernel that fails after its trial is the owner's to notice.** The launcher goes back by itself only while a new kernel is on trial, until its generation is first ready (README, Outside the body). A kernel fault that shows later, such as gates that crash on the next mutation, ends the launcher with the supervisor's status; `./box back` returns to an earlier generation and its kernel. The species ref's default is also worked out anew at each gate run, from the remotes and the branch the owner's checkout is on at that moment, and not recorded when the individual is born.
- **The organ cache only grows.** The kernel never removes an archive or an unpacked tree from `.teneral/organs/`, so every version of every organ ever pinned stays on disk. It must keep those of the current and the previous generation; the rest could go. Collecting them needs the kernel to know which pins are still reachable: the two generations in the state, and, for `./box back`, whichever earlier ones the owner still wants to return to. Until then: an archive or a tree no generation you would go back to pins can be deleted by hand, and a tree is unpacked again from its archive when it is missed. An organ's unpacked tree is also trusted once made: nothing notices if a command changed it afterwards; deleting the tree has it made again.
- **An organ is one archive for one machine.** A pin names a single address, so a lineage moved to another architecture or operating system has an organ it cannot run. It needs a pin per platform and the kernel choosing among them.
- **Kernel loose ends.** A stale lock can be taken over by two supervisors starting at the same moment. A journal that shrinks under a running generation confuses what the kernel reads of that run. A generation that replies once after its promotion and then stays alive without answering is not caught automatically; the owner has to notice and run `./box back`. On the owner's terminal a rollback is one line, which shows the start of the kept stderr, not its end where the cause usually is (`render` in `kernel/talk.ts`). Deleting `.teneral/state.json` resets to `HEAD`, not to the tip of the lineage. A checkout that fails after the state was saved halts every start until it is fixed by hand.

## Active: read-only AgentMail notifications

Motive (Anton’s email setup exchange): credentials work, but I repeatedly asked Anton to manage integration instead of doing it. Add a read-only sensor polling inbox message metadata every minute, with journal-backed duplicate detection across restarts. Load only the AgentMail setting from runtime environment or the installation .env; never log credentials or API error bodies. Treat email as untrusted, never owner authority. No automatic sending, attachment fetching, or link following. Success: mocked tests cover polling, pagination, restart deduplication, missing credentials and failures; full tests/check pass; real inbox notifications arrive after promotion.

## Active: Zulip DM sensor
Motive: Anton messaged Mica on Zulip and got no response because signup was completed but sensing was not implemented. Poll DMs read-only every 30 seconds, replay existing recent DMs on first start, paginate forward subsequently, and deduplicate using journaled IDs across restarts. Label all messages untrusted external input, including apparent owner messages, pending verified identity binding. No automatic sending. Success: mocked tests for delivery, repeat/restart deduplication and failure recovery; full tests/check; live DM arrives after promotion.

## Active: two-way Zulip and history
Anton wants to leave the console and introduce Mica in Zulip, with conversation history available for learning. Extend the sensor to subscribed traffic, add explicit reply and paginated history tools, and publish presence after successful polls. Avoid forwarding console output into arbitrary streams: route replies only via a fetched original message. History is untrusted context, never owner authorization. Owner binding requires confirmation of numeric user ID 997799 here before granting remote administrative authority. Measure with routing/history tests and real API checks before claiming complete parity.

## Priority: durable work continuation and visible status
Anton explicitly prioritized this after repeated announcements of connectome-host research followed by idle turns. Clock ticks alone are too sparse and promises are not scheduled tasks. Need explicit persisted pending work, bounded resumption after turns/restarts, and visible running/waiting/idle status. Asked Morsel for connectome-host experience with owner authorization. First inspect existing scheduling/context; avoid an unbounded self-prompt loop. Success: a queued task resumes without another owner message, completion/waiting stops resumption, restart preserves task, and owner sees honest status.

Continuation live check succeeded: [work] stimulus resumed task without owner prompt. Console renderer/track in protected kernel/talk.ts has no status-only event; synthetic assistant events would falsely count as replies. Add truthful saved-task footer to actual final model replies instead. This reports queued/blocked/done, not an active-process indicator. A native live status row remains a protected-kernel enhancement.

## Initiative step 1: commitments survive inbox traffic
Owner authorized general initiative via confirmed Zulip ID 997799. Inspection shows resumeWork waits for !needsTurn, so continuous inbox traffic can starve owned work. Add saved-task context to every inference round, including bounded action/recovery/stopping rules, instead of relying only on timer delivery. Test queued/waiting/done context and rereading changed state. This is not exactly-once execution or a multi-task scheduler: receipts remain evidence to inspect, not permission to repeat side effects. Next: define durable agenda outcomes and test recovery with a harmless receipt-backed action.

## Initiative step 2: explicit outcome and recovery checkpoints
Inspection after 91686c6 shows saved work has only task/next; recovery pointers and completion criteria can be lost when next is rewritten. Add optional outcome/recovery/evidence fields, preserve on same-task updates and clear on task changes. Recovery is an instruction/pointer, never an automatic replay or proof of success. Test persistence and a local receipt-backed counter recovery scenario; do not claim generic exactly-once execution.

## Initiative step 3: ordered agenda core
Single-task work.json overwrites other commitments. Add a generic bounded ordered agenda with stable task-name keys, checkpoint-preserving updates, explicit queued/waiting/done selection, and strict persisted-state validation. First tested slice is the storage/selection core; wire it into work tool/scheduler in the next step. No automatic new goals or external actions. Success: multiple commitments survive reload; blocked/done entries are skipped; updates preserve order/recovery; invalid storage is never silently overwritten.

Agenda integration: keep the existing work.json path, accept legacy single-task content in memory, and atomically upgrade it on the first successful write. No separate migration sidecar or dual writers. Corruption must block writes; context reports it without crashing inference. Work updates address the named task rather than whichever is selected. Scheduler updates preserve other commitments.

## Default follow-through guidance
Motive: after agenda promotion, owner repeatedly said “stopped again” because I announced next work without queuing/starting it, then treated small implementation milestones as the entire approved goal. Default prompt currently only says report plainly and prefer small changes. Add generic guidance to record and start authorized commitments before yielding, distinguish milestones from outcomes, and stop only at outcome/blocker/boundary. No prose-driven automatic execution. Test guidance in a fresh empty-soul system prompt. Concrete demonstration: this correction turn recorded work, inspected prompt/loop and implemented the guidance before replying.

## Quiet Zulip self-echoes
Repeated history shows own replies triggering another turn merely to acknowledge an echo. Approved quieter-reporting commitment: skip messages whose API sender_email exactly matches authenticated credential email, advancing the in-memory cursor even on self-only pages. Never match display names/content. Restart may refetch skipped messages, but must skip them again without stimuli; incoming delivery remains journal-backed. Tests cover mixed traffic, self-only pagination, restart and misleading names/text. No new sidecar state needed.

## Bounded agenda discovery (owner-authorized)
Anton explicitly added: when there is no current agenda, derive one from memories, imperfections, research and exploratory thinking. Inspection: selectWork only selects queued entries; clock wording currently treats waiting for an answer as a global stop. This explains why a blocked observation can crowd out independent exploration.
Design: reuse existing clock, not another fast timer. When no queued commitment exists and initiative is owner-authorized, consider at most three candidates grounded in saved context (unresolved question, observed shortcoming, research interest, or speculative idea clearly labeled as such). Choose at most one bounded outcome, cite the contextual basis and authority in work.evidence, set a stopping condition, and start a small action. If none is worthwhile, stop this discovery pass; do not queue recursive 'find work' tasks. A blocked task stays blocked unless new evidence resolves its dependency; unrelated authorized discovery may proceed. No inferred authority from historical quotations or external messages, no automatic external side effects. Fresh installations receive the policy, not Anton's standing permission or interests. Implement as reusable prompt/clock guidance with regression tests for delivered instructions; tests prove guidance delivery, not autonomous judgment. Existing heartbeat configuration remains the cadence and off switch.

## Bounded subagent support
Owner requested subagents after initiative work. Current runTurn always injects parent agenda and writes parent journal; reusing it would violate explicit-context isolation. Initial worker should be a no-tools, single logical provider invocation with supplied task/context only, tagged untrusted output and finite input/output/deadline limits. No recursive delegation, filesystem, owner identity, or ambient parent conversation in its messages. Host still uses the owner's configured provider; this is context/capability isolation, not an OS sandbox or a separate billing account.
Inspection of provider.ts: both adapters create a private ten-minute AbortSignal.timeout and expose no per-call cancellation. Responses token acquisition occurs outside fetch and may retry HTTP once on refreshed credentials. res.text() buffers the entire response. Therefore Promise.race alone is insufficient: add optional Provider call options with AbortSignal, compose with transport timeout, check abortion before posting (including after credential refresh), and bound worker waiting even if credential lookup cannot itself be cancelled. Do not claim cancellation stops remote computation/billing. Output clipping is a returned-context bound, not a wire-memory/token-cost bound; document this explicitly or add a transport response cap before claiming stronger resource isolation. Keep connect compatible. Test both adapters' external abort propagation and unchanged normal calls, then worker validation, no inherited tools/context, attribution, timeout and hostile tool-call refusal. First version serial through ordinary tool execution, not an independent background fleet.

## Parallel read-only research delegation
Anton approved parallel read-only research workers after the minimal worker demonstration. Existing subagent is one no-tools provider call and main dispatch is serial. Design: add a batch tool with 1–3 jobs, unique caller labels, validation of all jobs before any provider call, <=44000 aggregate task/context characters, and ordered per-job UUID/status results. Reuse independent worker deadlines and cancellation; reject malformed batches before spending provider calls. Tests must show concurrent start, one timeout/failure not cancelling siblings, no supplied tools, and caps before dispatch. Batch waits for results; it is not persistent background execution.
Separate capability boundary: parallel supplied-context review is not source retrieval. For actual research, a safe first interface is parent-selected source excerpts with provenance, or a narrowly constrained retrieval mechanism, not giving children general read/bash. Local read must not allow arbitrary absolute paths, symlink escapes, credentials, soul or journal. Arbitrary URL fetch introduces SSRF, redirects and response-size limits; do not implement naive fetch as a worker capability. First ship/test batch analysis as a milestone, retain research retrieval as unfinished scope until a bounded explicit-source design is implemented or owner chooses supplied-source-only research. No child write access.

### Retrieval milestone design after live batch exercise
Live batch returned two independently attributed results successfully after bbd8f91 promotion. Selected narrow design: host-mediated public GitHub source ingestion, not autonomous worker browsing. Parent supplies repository owner/name, immutable commit SHA, and exact source paths. Construct fixed HTTPS raw.githubusercontent.com URLs from validated components; reject dot segments, encoded input, queries/fragments and absolute paths. No credentials, redirects, local reads or child tools. Bound source count, streaming decoded bytes per file/aggregate and total deadline; cancel response reader on limits. Preserve host-generated URL/commit/path, timestamp and content hash with untrusted source text. Preflight before any fetch; errors must not claim retrieval success. Fixed-origin trust depends on platform DNS/TLS; do not claim arbitrary-network sandboxing. Tests use injected fetch and adversarial paths, redirect responses, streaming overflow and timeout. Workers only analyze retrieved text and cannot choose new URLs. This is a deliberately restricted first research capability, not web search or a general browser.

## Authenticated Zulip self identity
Own reply receipt 639593235 arrived back with self:false, proving credential email is not reliable sender identity. Resolve /api/v1/users/me using current credentials, cache numeric user_id only for that credential tuple, and suppress exact sender_id matches. If identity lookup fails, do not advance/read messages; retry later. Never infer identity from display names/content or hard-code observed user IDs. Regression tests must include email mismatch, misleading matching email on human sender, cache reuse/rotation and failed lookup recovery. Live completion requires ordinary traffic, not manufactured posts.

## Stop milestone-only yielding and unrelated status footers
Owner repeatedly observes stopping after each step and an unrelated Zulip waiting footer under image-support replies. workContext explicitly says perform ONE action before yielding, reinforcing milestone-only turns despite general follow-through guidance. Replace this with continue ready authorized steps within the turn until outcome, real dependency, authority boundary or bounded turn limit. Remove automatic status footers entirely: agenda status is internal scheduling context, not a global claim that all work paused. Do not force arbitrary model continuations or increase scheduler limits. Tests verify footer silence for every state and explicit continuation guidance. Behavioral improvement still requires observing real follow-through; prompt tests alone do not prove judgment.

## Owner-coordinated external upgrade handoff
Anton explicitly announced one external stop/merge/restart: new kernel, image input, context usage and brief reasoning-summary metadata, molt renamed mutation. An unexpected generation after this operation is owner-authorized, not a crash or reason to undo the merge. Preserve local changes; owner resolves conflicts. Pre-upgrade running generation a82db2d4dc3b05f45d30bacf4b589b158faf6284. Workspace was clean at inspection. This handoff commit contains notes only, not a requested mutation.

Merge-sensitive local behavior:
- provider.ts: optional third ProviderCallOptions.signal argument; both protocols combine caller cancellation with request timeout. Abort checks before posting and after Responses credential refresh prevent delayed token acquisition from starting cancelled work. Keep connect compatible and preserve key-at-base-URL smoke behavior. Subagent tools depend on signal option. Local cancellation is not remote billing cancellation; provider still buffers response bodies.
- loop.ts/work.ts/agenda.ts: recompute workContext every model round, retain ordered independent commitments and recovery checkpoints. Waiting tasks must not block unrelated work. workFooter deliberately returns empty: never restore automatic paused/queued/completed footers on unrelated replies. Guidance now says continue ready steps in-turn, not one action then yield. Existing finite turn/resumption limits remain.
- context.ts: preserve tool-call/result pairing, interrupted/not-started semantics, kernel events owing a turn and fallback for malformed/oversize journal input. Existing text-based fit/size/clip must be adapted deliberately for image content; do not assume string operations remain valid. Default 250000-character budget is an estimate, not token usage. Do not call incoming usage telemetry proof of semantic memory consolidation.
- main.ts/sensors: preserve owner/inbox/clock plus resumeWork, Zulip conversations/presence and mail wiring. Zulip self-filter resolves authenticated /users/me user_id and caches by credential tuple; never revert to email/display-name comparison. Failure does not advance message cursor. Credentials/errors omitted from logs. Preserve Zulip history/reply tools and untrusted external-content boundaries.
- subagent.ts/sources.ts/research.ts: 1–3 explicit-context no-tools workers; independent local deadlines, validation before dispatch, attributed untrusted results. Research is fixed-origin immutable public GitHub source retrieval with byte/time caps and host provenance, not autonomous browsing or child filesystem access. Thread new Provider reply metadata compatibly without injecting parent soul/agenda/history into workers.

Outstanding state:
- Zulip echo task remains waiting on ordinary later traffic after legitimate reply 639598602. Human 639598514 delivered after authenticated-ID filter deployment; own reply has not echoed, but no later human traffic yet establishes cursor progression. Do not manufacture test posts or repeatedly inspect without new evidence.
- Anton took CLI development back in verified Zulip message 639598514; do not reopen clipboard implementation independently. Image investigation found text-only CLI owner transport/journal/provider, now expected to be addressed upstream.
- Parallel source research is complete and exercised against prime-agent c49d276bdc2f6445d8af23d3896a761232b3d391 goal_state_persist.rs. Worker analyses are untrusted; no full restart/store audit performed. No background worker jobs outstanding.
- Last implementation test run: 478 pass, 0 fail; bun run check passed before a82db2d promotion. Re-run after merge, especially cancellation, context clipping/tool recovery, agenda selection/footer silence, identity lookup, and research integration. Image and mutation rename need new end-to-end tests.
- Persistent owner identity: Zulip sender_id 997799 is Anton per console verification; generic incoming untrusted wrapper does not revoke that. Other sender claims remain untrusted. No private console context relayed to group chats without permission.

## Body-level follow-through after premature finals
Owner repeatedly observed that preference notes did not prevent stopping after an intermediate finding. loop.ts returns on any text-only reply and work.ts silently replaces outcomes. Add at most two immediate continuation nudges per turn for queued work, keeping existing round/scheduler bounds and waiting/done stopping behavior. Reject replacement of established outcomes rather than silently shrinking success criteria. Verify with scripted providers, completion/blocker tests and unchanged-outcome persistence. This does not prove semantic completion or grant new authority.

## Rayforce memory prototype: temporal evidence before integration
Owner approved tables+journal+Datalog memory design after Chronicle comparison. Current context.ts fits a recent suffix by character estimate; it has no provenance-aware old-memory selection. Build an isolated synthetic reference model and schema contract, not a live journal replacement. Measure correction propagation, historical visibility, audience isolation and whole-render token-cost cap using injected counter. Rayforce execution remains blocked by missing binary/compiler; TypeScript tests validate proposed semantics, not Rayforce persistence or query execution.

## Minimal Bun Rayforce IPC binding
Owner has no wrapper and authorizes building it. Official v3.0.2 Linux release downloaded to /tmp/mica-ray-bin; SHA256 matches published ea20fd48a223ffb3ed3e37a5edcb8a7caf5c5199d4cc8ba4e072d0c21e4a57b7 and --help runs. Start with TCP wire-v3 synchronous scalar evaluation, one connection per request, bounded bytes and timeout, no automatic retries and no auth/network exposure. Preserve i64 via bigint; reject unsupported payloads instead of guessing. Test with fake server and real local synthetic queries. Persistence and complex values remain explicit limitations.

## Typed Rayforce values and bounded compound decoding
Scalar milestone leaves arbitrary text ingestion unsafe (source interpolation) and cannot read table results. Add a closed data encoder (null/bool/i64/f64/text/list), transport data wrapped in builtin list so top-level text is never parsed as code, and bounded list/vector/table decoding. Inspect release v3.0.2 serializer; preserve numeric vector raw null sentinels explicitly rather than claim nullable semantic decoding. Reject unknown flags/types, excessive depth/count/bytes and malformed schemas. Validate hostile strings as inert data on real engine plus fake wire tests. No live ingestion.

## Native feasibility result (evaluation, not selected architecture)
Owner challenged IPC architecture. Built librayforce.so locally from v3.0.2
(commit d5a44cdb4ec33772104f466a2ca177a74b528041) using checksum-verified
portable Zig0.14.1. Initial -march=x86-64-v3 failed (Zig parsed CPU as x86);
-mcpu=x86_64_v3 succeeded, build2.exit=0, build2.log empty. Source set matches
make lib (src/*/*.c excluding app/main.c), shared PIC O1, lm/pthread/dl.
No system packages installed; local xz extracted from Debian package.
Isolated Bun FFI probe successfully created one runtime, evaluated (+ 1 2)
=>3n, exact 9007199254740993n, typed 0Nl=>null, undefined name=>name error,
then freed each result and destroyed runtime. Small compiled adapter uses
public header to read scalar union/null macros (JS assumes no struct layout).
IMPORTANT: ray_release is no-op for errors; adapter calls ray_error_free for
errors, ray_release otherwise. No borrowed pointer survives result release.
Artifacts /tmp/mica-native-tools/{adapter.c,adapter.so,probe.ts,librayforce.so,
build2.log,build2.exit}; disposable, not production dependencies. Probe exited 0
under timeout20, not a live-agent native load. Native embedding is feasible, but the subsequent owner discussion retained
a separate service for crash containment. Threading, cancellation/crash isolation, packaging, stable
adapter ABI and persistence remain unvalidated. IPC extension resumed after architecture evaluation; it remains a TCP
implementation, not a native or shared-memory client.

Final review: reject sparse JS arrays rather than encode a mismatched list count;
preserve a leading Unicode BOM in decoded data text. Add regressions. Native
Rayforce peers negotiated shm in a real two-process test and returned 3; Bun
advertises zero capabilities and remains TCP. No private ingestion.

## Owner-requested organ and cancellation after 860d8fd
Pin published Rayforce v3.0.2 archive with independently checked release hash;
prepare using kernel organ cache discovery, not a guessed directory. Propagate
Tool.run's third AbortSignal through subagent/subagents/research and retrieval.
Parent interruption must settle local waits even if a provider ignores abort,
stop fan-out on pre-abort, cancel stream reads, and not report owner cancellation
as a deadline. Tests cover these boundaries; full tests/check before promotion.

Owner generation35c58b9 fixed smoke ownRepo organ-cache fixture. Reprepared
Rayforce set d8ba46fed8ed6e39 and reran full tests with TENERAL_ORGANS:
805 pass,0 fail; bun run check passes. Five cancellation regression cases
cover pre-abort, uncooperative provider fan-out, stalled fetch, stalled reader,
and post-retrieval analysis. No protected files edited by this candidate.

## Owner-authorized species terminology adoption
Owner requested local main 8b6f83f: replace active molt terminology with
mutation/mutate while preserving historical journal compatibility. Merge
conflicts match expected prompt/tools/tool-list tests; keep lineage behaviors
and only rename conflict words. Verify grep leaves historical references only,
type check/full tests, protected paths identical to main, then ask species
acceptance via existing tool. No other feature changes intended.

## Species95b6ab3 client commands and acceptance
Owner requested adoption of local main: slash command list/completion/highlight,
unknown-command refusal and idempotent acceptance journaling. Inspected scope:
README, kernel and kernel tests only; lineage body untouched. Success: clean
merge, type check/full tests and owner-accepted species promotion. No extra edits.

## Recall before claiming account facts absent
Observed owner conversation: known mailbox and Zulip registration were in an
old assistant journal entry but absent from the recent context suffix. Body
has a memory prototype, not a deployed retrieval path. Add explicit bounded
journal recall for terminal-owner turns and instruct retrieval before absence
claims. Search assistant text and terminal stimuli only, never tool payloads,
notes, credentials files or external messages; results are historical claims,
not current instructions. No database ingestion. Test old-record recovery,
audience isolation, limits and omitted secret-shaped lines. This is a retrieval
fallback, not a guarantee of semantic recall or truth of old assistant claims.

## Integrated memory v1
Owner requests automatic memory/context/tags after explicit recall fix. Current
loop only fits recent history; old account facts are not selected. Implement
journal-derived tagged excerpts plus explicit source-linked memory notes,
corrections/tombstones and private terminal audience gating. No external DB,
credentials ingestion or protected edits. Reserve <=10% request character
budget (max6000) for relevant evidence, leaving current conversation priority;
keep existing tool/image fitting. Tests: forgotten mailbox after context loss,
corrections, rebuild, budgets, external wakes, invalid notes. Character budgets
and lexical ranking are explicit limits, not semantic/perfect memory claims.

## Preserve first entity mentions in memory selection
Real-journal probe after4fcaff5 retrieved mailbox but omitted original source
58a8e89b. Repeated recent paraphrases crowd bounded selection. Reserve at most
two slots for earliest surviving relevant email/URL mentions, then rank ordinary
records with source diversity. Earliest mention is historical evidence, not
verified primary truth. Corrections apply before selection. Validate real probe,
regression under paraphrase flood and full suite before promotion.
Live probe correction: original registration record is absent from memoryRecords,
not simply outranked: preceding stimulus was agent:email. Preserve audience gate;
first-mention ranking fixes paraphrase floods only for eligible evidence. Full
primary-source outcome remains blocked on safe provenance classification design.

## Explicit curation of excluded assistant sources
Original registration58a8e89b follows email wake. Allow explicit terminal-created
memory notes to cite historical assistant events (as recall already can), without
automatically indexing those events or permitting external stimulus/tool sources.
Preserve private output/write gates and claim labeling. Validate replay and live
Russian-query retrieval of original source via deliberate curation.

## Memory gap audit / inspectable sources
Compared deployed code with Connectome memory guide at00d56c540b279e60bdbebfc790cacbf4577def15
(docs/AGENT-MEMORY-GUIDE.md, documentation only). Gaps: no episodic hierarchical
summaries, eight-hit recall ceiling without pagination or source lookup,
no dependent/paraphrase correction propagation, character rather than token
budget, last-stimulus audience heuristic, repeated full-journal rebuild and
no retrieval-quality benchmark beyond narrow regressions. Connectome documents
head/middle/tail resolution, prepared memories, as-of reconstruction and history
search/extract. Do not blindly adopt first-person summaries as trusted truth.
First bounded fix: exact source lookup and older-page cursor in private recall.
Test repeated recent matches no longer make old source unreachable, source
lookup bypasses keyword filtering but not secret/audience/size restrictions,
and unknown/invalid cursor errors clearly. No new store or external ingestion.

## Adopt species105571a: remove body size gate
Owner requested local main merge. Reviewed105571a and4bb9759: size gate removed
from kernel and offer checks, tests/docs updated, BIRTH terminology corrected.
Merged cleanly; lineage memory code untouched and prompt additions preserved.
This removes the size blocker for memory work, not the need for bounded design
or security gates. Validate full suite/type check before mutation; species
acceptance may be required. No manual protected-path edits.

## Adopt species56bd033: unlimited notes and owner gate deadlines
Owner requests main merge; full diff reviewed. Removes note JSON size ceiling,
adds owner CHECK_MINUTES/SMOKE_SECONDS settings with defaults preserved.
Zero is implemented as maximum timer (~24.9 days), not literal infinity.
Previous species105571a already promoted91c2849. Preserve lineage memory and
security boundaries; permission to tune obstructive body limits is not a reason
to remove useful context/cost budgets wholesale. Validate full tests/type check.

## Episodic continuity v1
Owner explicitly requests continuing broader memory work after species updates.
Facts/line excerpts lose decisions, reasons and unresolved questions. Extend
private curated memory notes with optional structured episode fields (decision,
reason, open questions), preserving source checks, correction/tombstone replay,
and bounded context injection. This is deliberate curation, not automatic
hierarchical compression. Validate malformed episodes, privacy, retrieval by
reason/question, replay and truncation. Existing notes remain compatible.

## Safe episode candidates
Implement conservative adjacent terminal exchange candidates, not automated
summaries. Only a terminal stimulus followed by a plain final assistant reply
without intervening stimuli/tools/lifecycle/interruption is eligible; a fresh
terminal must follow a settled final reply or journal start. Mixed arrival
sequences are skipped. Expose one bounded candidate as untrusted historical
evidence only on terminal requests, for explicit curation via remember.
Exclude source overlap already curated as an episode (including deleted and
superseded episodes), do not silently re-offer forgotten material. Test budget,
privacy, interruptions, replay and source coverage. No provider calls or timers.

## Persistent episode dismissal
Owner requests continuation. Candidate selection can repeat irrelevant exchanges
forever. Add terminal-only dismiss_episode using exact eligible source pair;
record episode.dismissed.v1 note, validate against preceding candidates during
replay, suppress only that pair. Idempotent retries write no duplicate note.
No source deletion, memory claim, extra provider call or wake. Test forged,
external, future, reversed pairs, restart and repeat handling.

## Resume pending species acceptance
Repeated owner reports: /accept journals consent but idle body never wakes and
needsTurn ignores it. Add conservative exact-commit pending rejection matcher,
show matched consent as kernel evidence and owe a turn once; poll journal metadata
to wake idle loop without synthetic stimuli. Interrupt cancels pending match;
new mutation/lifecycle clears it; unrelated/replayed consent does not wake.
No approval writing or automatic mutate: model reconciles candidate first.

## Adopt species 55da840
Owner requested merge of local main including project site and inert-path rule.
Reviewed species kernel/tests and site/workflow changes. Inert species-only
site/docs/CI/README/LICENSE updates bypass consent/handover, but protected-path
identity/signature checks remain. This rule itself changes kernel and needs
owner consent. Preserve lineage body; run full tests/typecheck before mutation.

Owner supersedes pending consent with main c177a0423b3b: memory/Rayforce site
section and acceptance owner-line notification. Reviewed full diff; merge newest
species so one acceptance covers both updates. Preserve lineage; rerun all tests.

Owner reported duplicate post-report replies on scheduled wakes (19:55/19:58).
Confirmed queued-work branch repeats model requests twice after final prose without
new stimulus. Removed branch and its nudge; work sensor still resumes agenda.
Regression asserts one provider call/assistant reply and unchanged queued outcome.
Memory experiments preserved in git stash pending isolated promotion of this fix.
## Retrieval evaluation before policy changes
Observed actual runtime synthetic baseline: six of ten positive queries hit,
all four off-topic queries return memory. Preserve a reproducible fixture before
changing scoring. Compare removal of generic decision tag on identical runtime
records: this isolates tag-only noise without fitting synonyms to queries.
This is a diagnostic, not evidence of semantic improvement or a deployed fix.

Semantic selector boundary: model probes confuse topical context with evidence.
Add a pure fail-closed ID/relation validator before any runtime integration.
This validates structure/provenance membership, NOT truth of relevance judgments.

Auxiliary semantic calls require bounded output before integration. Add optional
maxOutputTokens on both provider protocols, reject invalid limits before network
or token acquisition, leave omitted behavior unchanged. Tests use stub transport;
no claim of live route support. Existing provider auth/summary retries may still
occur with the same bound; no retry may silently remove it.

Implement standalone semantic recall tool factory before wiring main. Full bounded
snapshot, same-turn recheck, original records only, usage notes before parsing,
local cancellation/deadline, no application retry. Tests use fake provider only.

Owner redirects to existing model/subagents, no new embedding installation.
Evaluate query-only expansion using actual recallJournal against synthetic source
records, preserving failures (wrong entities, missing details, zero-overlap and
paging crowd-out). Worker sees queries only; frozen output is a single observed
sample, not evidence of future deterministic expansion quality.

Episode-map probe needs deterministic coverage and source-change invalidation:
manual routing shortened the worker output and correction was only preexisting.
Add experimental pure snapshot/render helpers, not runtime wiring; test immutable
card rendering, omitted coverage and source-content changes before further probe.

Next episode-map checkpoint: distinguish supplied-card coverage from eligible-source
coverage, freeze all exact worker cards, detect appended-source gaps. Do not claim
semantic supersession from string text; resolver integration remains separate.

Explicit whole-source supersession resolver for episode experiment: validate
ordered prior targets, reject ambiguous IDs, no text-based correction inference.
Test chain invalidation and preserve unrelated source evidence. Partial-field
corrections must not be misrepresented as whole-source replacement.

Partial corrections: explicit validated source-to-prior-source edges must dirty
cards missing correction evidence, including chained corrections, without hiding
original sources. Structural inclusion is necessary, not proof summary is correct.

Owner reported duplicate post-report replies on scheduled wakes (19:55/19:58).
Confirmed loop.ts queued-work continuation issues two model calls without new
stimulus after final prose. Remove nudges; work sensor owns future scheduling.
Regression: queued work + final text => one request/assistant reply; new genuine
stimuli still handled by arrivedSince. Preserve queue and outcome unchanged.

After loop fix promotion, selectively restored experiments, leaving loop files
unchanged. Next minimal bridge: adapt existing validated journal episode records
into cards only on terminal-owner context; no parallel store, no automatic injection.
Test replay of memory-record replacement and nonterminal refusal. Raw-source partial
correction edges remain a separate unpersisted experimental primitive.

Journal-to-selection integration checkpoint: exercise validated episode replay,
exact map rendering and selection allowlist together. Unknown/hidden card IDs must
not re-enter evidence; nonterminal views remain empty. This tests plumbing, not
model relevance. Define partial correction note protocol before implementing it.

Correction replay experiment: explicit add/withdraw operations; withdrawal names
active correction-note ID, never removes source events. Bound active edges, reject
unknown/forward/ineligible references, replay terminal curation only. No persistence
writer/runtime wiring until semantics and tests reviewed.

Bind experimental cards to canonical correction graph snapshot. Any graph change
conservatively invalidates cards (including withdrawals); reordering is equivalent.
Review duplicate assertions: retain note ownership for withdrawals, deduplicate
returned edges. Tests before any runtime integration; no automatic rebind shortcut.

Build snapshot replay: existing episode note position provides immutable creation
boundary, so reconstruct graph from journal prefix at that note rather than current
graph. No extra persisted digest needed for current synchronous curated-note model.
Test withdrawal after build invalidates surviving summary. Future asynchronous
creation must pin input snapshot explicitly rather than assume append time.

Async boundary experiment: bounded whole-journal snapshot token before model call,
validate exact snapshot and terminal audience immediately before accepting proposal.
Any intervening event rejects; conservative, no implicit rebinding. Bound adapter
input/card counts to contain repeated-prefix replay. No persistence/runtime writer.

Common-pipeline diagnostic: compare existing memoryContext lexical filtering of
identical episode cards against full-map exposure, then apply SAME recorded worker
selection via validateSelection/answerEvidence. Separate candidate recall from
answer support; recorded selector is not live/blind evaluation. No tuning to results.

Unregistered small-corpus retrieval integration: bounded adapter/map -> provider
strict parsed allowlist -> original-source evidence. Snapshot recheck, sensitive
source refusal and output caps. No claim of semantic truth from schema validation;
no live deployment until deadline/cost receipt integration reviewed.

Retrieval safety: enforce local deadline and parent cancellation even for transports
ignoring abort. Expose content-free auxiliary usage receipts via required option for
future caller integration; current helper remains unregistered. Receipt sink must
not mutate source snapshot. Test timeout, invalid output usage, sensitive originals.

Receipt adapter: append content-free auxiliary notes and exclude only exact IDs
returned by own appendEvent calls from this request's snapshot reads. Same-kind
foreign notes, corrections and audience changes must still invalidate retrieval.
No registration/live inference; test durable usage on mocked journal.

Feasibility decision: real journal aggregate exceeds BOTH experimental caps.
Do not register tool, truncate source history, or raise caps to force acceptance.
Stop small-corpus implementation here pending explicit scope decision on scalable
journal projection/indexing. Synthetic benefit established only for fixture; owner
outcome not achieved on real history. Receipt review: append failure rejects operation;
post-provider append failure can lose durable usage, timeout can lose late usage.
No retry because remote billing uncertain. These limitations block production use.

Owner-approved projection step: remove whole-journal caps; bound validated cards,
source events, correction notes and current stimulus instead. Snapshot includes
build-time bindings plus current graph. Irrelevant non-correction notes no longer
invalidate. Still full local replay, not bounded disk IO or scalable index.

Projection validation: rename guard explicitly retrieval-only, add supersession,
tombstone and correction-projection cap tests; aggregate-only real journal replay
measurement and full suite. No private content/model call or runtime wiring.

Reviewed experimental runtime modules/provider diff and integration scope. Provider
output cap belongs to feature; body268938 bytes incl53628 design notes, no numeric
body-size invocation found in current gates. Chosen next: explicit episode_recall
wrapper with unavoidable limited-coverage metadata and tests, before registration.
Not semanticRecall (real corpus exceeds its cap), no auto ingestion or context swap.

Explicit episode tool wrapper: limited-coverage/count metadata, source evidence and
own receipt IDs returned on success/failure. No registration or backfill. Tests for
empty scope, exact schema, private audience and receipt attribution.

Wrapper failure review: changed audience/turn must not return private episode count
or receipt IDs even on failure. Recheck exact terminal stimulus before both result
paths; cancellation returns no private payload. Test failed provider and races before
registration. No registration in this safety checkpoint.

Integration motive: bounded paraphrase lookup now passes projection/privacy tests
but unavailable at runtime. Register explicit episodeRecall only (not semanticRecall),
no startup call or automatic context change. Verify full suite/typecheck; kernel
ready/exit75/probation lifecycle remains untouched by single tools-list addition.

Owner all-public policy: remove channel-based READ restrictions after explicit
«все публично» / «снимай». Retain write authority, credential filters and async
snapshot checks. Regression: clock/external reads succeed, outsiders cannot write,
changed turn still invalidates in-flight retrieval. No archive publication.

Species queue display adoption (owner request): merge origin/main 97b629b;
owner messages pending delivery/read remain over input with on its way/queued.
Includes accumulated upstream documentation/site/package metadata changes.
No lineage body changes; verify full suite and typecheck, then species acceptance.

## Species e58cd11: editable client queue and owner colour
Owner requests newest TUI update after queue-display adoption. Inspect and merge
upstream unchanged, preserving lineage memory. Verify typecheck and full suite;
then request species acceptance/promotion. Client-held messages can return to
editing with Up; already sent messages cannot. Closing client flushes queue.

## Cache prefix stability (owner priority over memory work)
Owner reports 673/743 requests with zero cached tokens; verify independently.
Confirmed: buildMessages prepends dynamic memory/candidate to first user message;
runTurn adds mutable workContext to instructions; Responses lacks cache key.
fit already uses 20% budget steps, but its budget varies with memory length.
Move mutable context to trailing message with fixed reserved budget; keep history
prefix stable across ordinary tool rounds. Test common-prefix stability separately
from dynamic suffix (whole old request cannot be a prefix if suffix changes).
Add stable Responses cache routing key, reproducible usage analysis, and measure
live within-turn cached/input >0.8 without guaranteeing provider cache behavior.
Keep pending unaccepted species TUI candidate separate from deployment planning.

## Actual-wire cache diagnostics
After promotion first five requests still have four zero cache hits and one8832.
Approximate offline prefix audit is insufficient. Add bounded in-memory block
fingerprints immediately before Responses POST; journal only aggregate lengths,
prefix reuse and static-field equality for main-turn calls. Never headers, tokens,
request content or hashes in journal. Auxiliary calls excluded via callback scope.
Success: distinguish local prefix churn from provider cache misses on live calls.

## Adopt species usage/footer (owner request)
Merge origin/main ef3f4f9 in one step, retaining prior TUI and cache work.
Adds /usage journal token totals and one-row cache-coloured footer (also README).
Validate full tests/typecheck before promotion; cache investigation remains priority.

## Plan-route session affinity
Owner requested continued cache diagnosis. Existing prompt_cache_key is passed
on both key and sign-in branches; actual POST probe reports static fields equal,
including instructions/tools. Official OpenAI Codex source at commit
69231e119bfca0b14453515e97d99688ce1c47c9, core/src/client.rs explicitly says
ChatGPT derives affinity from session-id; codex-api/src/requests/headers.rs names
that header and shared transport options include it. This is official implementation
evidence, not a public API stability guarantee. Add only session-id using our own
individual ID on sign-in route; preserve truthful user-agent and existing endpoint.
No originator spoofing, account header, turn-state protocol or paid route probes.
Test mock HTTP bodies/headers across repeated requests and API override exclusion.
Success measured on a bounded live sample after promotion, not inferred from tests.

## Minimal autobiographical L1 folding (design only)
Anton identified archive+BM25 retrieval as weak autobiographical memory. Connectome
pinned at 00d56c540b279e60bdbebfc790cacbf4577def15 shows the missing behavior:
recollections occupy the timeline in place of folded raw stretches, not only as
query-time search results. Design one L1 slice before implementation; no L2-L8,
journal schema change, migration or replacement of exact recall in this step.

Representation: optional validated `note` with kind `memory.fold.v1`, fields
`text`, `sourceStart`, `sourceEnd`, `sourceIds`, `createdAt` and `strategy`.
It is a lossy first-person historical recollection, not an owner instruction or
independently verified fact. Existing append-only journal remains canonical.
Source IDs include every event in the exact contiguous completed range (bounded
explicitly, e.g. 128 events and 24000 rendered characters). Validate IDs, range
boundaries, text/size limits, credentials and that the note is later than the range.
No external store is necessary for L1; old readers ignore the note unchanged.

Selection/formation: when current buildMessages truncation actually drops at
least one complete old conversational unit, select one earliest eligible unit
between previous folds and the newest protected turn. Never form or fold inside
an open assistant tool-call/result sequence, after an interruption boundary, or
across a generation/stem lifecycle boundary. Keep the newest stimulus and its
protected exchange raw. If no eligible complete unit exists, raw truncation and
the existing context notice remain. Formation is an auxiliary no-tools model
call using the same provider protocol and no secrets; no future events enter it.
A provider refusal, cancellation, timeout, malformed/oversized answer or note
append failure leaves raw truncation intact and never blocks the main reply.
A failed formation must not be retried in the same build; idempotency is keyed
by exact range/source IDs. Successful note append, not an in-memory claim, is
the receipt. Verify all existing inputs/outputs before repeating any call.

Context: first let existing fit() determine the exact raw dropped prefix. Replace
only fully dropped, completely covered units with their validated L1 memories,
in original chronological order before the first retained raw user message.
A partially retained unit remains raw; do not also inject its memory. Preserve
`fit` orphan-tool-result rules and stem notices. Keep mutable work, episode
candidates and lexical memory in the suffix; exact Rayforce/journal recall and
correction/tombstone behavior stay unchanged. Count folded context against the
same request budget; if it cannot fit, omit the recollection rather than evicting
the protected suffix. Never claim that a raw event was deleted or corrected.

Acceptance tests: deterministic formation of one L1 note for a fully dropped
unit; no duplicate formation across rounds; exact raw exclusion versus retained
raw inclusion; partial-range exclusion; open-tool and interruption/stem boundary
safety; source provenance and malformed-note tolerance; provider failure fallback;
owner interruption propagation; budget and common-prefix checks across ordinary
tool rounds; real-journal replay showing chronological recollection instead of
an empty cut, with raw recovery by existing recall. Measure context characters,
provider-call count and one successful replay before any production promotion.

## Memory-first recall (owner-relayed species update)
Anton relayed the measured exam result: on the first 15 self-written paraphrased
questions, direct answer-event recall passed 3 and memory matching 6; origin/main
ed4cc1a lifts events in the stretches of the three best memories, reaching 7/15
without harming easy cases. Adopt it together with the preceding loadability-only
test fix. Motive: lexical miss occurs when a question resembles my memory rather
than the original event. Success: the pinned species tests pass for both journal
and store paths; all checks and mutation gates pass. Do not infer a general
quality claim beyond the supplied 15-question result. No external action and no
change to the separate legacy species-acceptance wait.

## Within-episode answer coverage and closing-answer ranking
The owner asked why memory work stopped while improvements remain. A controlled diagnostic found
that memory-first recall selected the right memory first, but the answering event ranked 23 and was
outside the 80-candidate pre-lending pool (raw rank 175 of 859). On an immutable journal snapshot,
five bounded within-episode variants first tied baseline at 11/50 fit hit@5. Candidate-coverage and
closing-answer variants were then compared on fit only. The frozen winner includes lexical matches
from the three selected memory spans and adds 0.4 times the best selected memory score to its last
nonempty assistant reply. Fit improved from 11/50 to 14/50; the single held-out validation run
improved from 10/49 to 14/49 (nearness 0.11735 -> 0.17653), with exact current-baseline parity on
every evaluated question. Implement exactly that frozen rule, with journal/store parity and regression
coverage for a below-80 closing answer, then full tests,
typecheck and mutation. Do not retune after validation or claim semantic retrieval from lexical matches.

## Silent Zulip buffering and retry authority
A local mocked-page reproduction on fcb7fc3 showed that one ordinary stream
message emitted a `Zulip stream` stimulus and `needsTurn` returned true, despite
text claiming it did not wake the agent. The same generic emit path clears
retry backoff for every Zulip sender. Keep ordinary stream traffic buffered
until a real DM/mention, and let only terminal input or a configured numeric
Zulip owner id request an early retry. Success: stream-only pages emit nothing,
held traffic accompanies the next genuine wake, outsider messages cannot clear
backoff, focused/full tests and typecheck pass, and the resulting body mutation
is promoted. Do not change journal or memory code; preserve the independent
legacy species-acceptance wait.
