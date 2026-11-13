# Memory prototype contract (not a deployed backend)

## Storage responsibilities
- events: parted by ingestion day, columns store_id, event_id, seq, occurred_at,
  ingested_at, audience, source_kind, source_ref, payload. seq is monotonically
  assigned by a single writer; event_id is stable across retries. Original time
  does not determine append partition. Clock regression must not move the active
  partition backward. Reject mismatched duplicate IDs; identical retries are no-ops.
- facts: immutable versions with fact_id, seq, audience, text and source links.
  seq represents when this system learned the version, not when it became true
  in the outside world. No bitemporal claim yet.
- edges: from_id, relation, to_id. Relations: supported_by (event), depends_on
  (fact), supersedes (fact). Edges are part of the fact's logical ingestion batch.
- context receipts: query/as-of sequence, audience, selected fact IDs, rendered
  cost and selector version. They explain recall; they are not new authority.
- Large attachments remain external content-addressed files; table rows contain
  hashes and metadata. This prototype does not implement a blob store.

Use ordinary tables for payloads and typed columns, Datalog for dependency and
provenance relations. Do not intern full message bodies as symbols. External IDs
need a stable mapping if represented as integer Datalog entities. Exact mapping
and Rayforce serialization must be validated before integration.

## Temporal semantics
A correction supersedes a prior version without deleting it. At sequence N,
only records learned through N participate. Superseded facts and every fact
transitively dependent on them are excluded from current recall. A later
correction of a correction does not resurrect the original: reassert it as a new
version. Dependencies must reference earlier same-audience facts (acyclic).
Supersession is authoritative input to this reference model, not something a
retrieved web page may declare. The ingestion boundary must authenticate the
source and resolve conflicts before adding that edge. Evidence may disagree;
keep competing claims rather than fabricate a correction.

Datalog implementation outline (logical, not claimed executable RFL): derive
invalid(F) from a visible supersedes edge, then recursively derive invalid(D)
from depends_on(D,F) and invalid(F). Retrieve visible facts not invalid. Scope
all base relations by store, audience and as-of sequence BEFORE recursion.

## Ingestion/recovery boundary
Validate IDs, provenance, audience and backward references before publication.
Readers see only a committed watermark containing complete event/fact/edge
batches. A sidecar importer would checkpoint the kernel journal offset only after
Rayforce persistence acknowledgment. A checkpoint is not proof of durability:
test crashes around append, partition persistence, snapshot and checkpoint.
No private journal ingestion is authorized by these synthetic artifacts. The
kernel journal remains authoritative for runtime events and is not replaced.
Rayforce idempotency, atomic batch publication and durable watermark mechanism
are unresolved implementation contracts, not verified engine guarantees.

## Selection and current runtime boundary
body/context.ts currently retains a recent suffix using a character estimate.
Do not break tool-call/result pairing, image handling or kernel notifications.
Future integration reserves space for system/tools/current turn first, then
passes a memory budget to the selector. Memories are evidence, never system
instructions. Fetch exact source events on demand with the same audience check.

memory-prototype.ts is an isolated executable semantic reference: whole rendered
records (including provenance/header) fit an injected token counter. Selection
is newest-first, not semantic relevance; skip records that do not fit. The tests
use a synthetic character counter to test accounting, NOT a real token claim.
Production needs a model-appropriate tokenizer and total-request accounting.
No tokenizer, relevance model, compression pipeline or Rayforce adapter is wired.

## Acceptance and stopping point
Run `bun test test/body/memory-prototype.test.ts`: historical visibility,
correction invalidation, audience isolation, exact render-cost cap, invalid
references and duplicate IDs. These are executable TypeScript semantics only.
Next Rayforce experiment must reproduce them and validate restart/rollover
idempotency with synthetic rows. Missing Rayforce binary/compiler blocks that
experiment, not this reference design. Full branching is deferred.

## Deployed first integration: memory.v1
`memory.ts` now rebuilds records directly from the journal each request (no
separate store/cache, no Rayforce ingestion). It derives bounded, tagged line
excerpts from terminal-owner turns and assistant replies in those turns. A
`remember` tool writes validated source-linked `memory.v1` notes. Corrections
and tombstones hide named records permanently across replay; unrelated or
paraphrased conflicting claims remain visible. No automatic contradiction
resolution or dependency inference is claimed. The older semantic prototype
above remains separate, not the deployed backend.

`context.ts` reserves at most 10% of available character space, capped at 6000,
for whole JSON records including source IDs, time, kind and tags, prepended as
evidence to the fitted user context (not system instructions). Ranking is
lexical overlap plus small bilingual topic groups, newest breaks ties. Up to12
records, deduplicated by exact text. No block for nonterminal wakes. Existing
pairing, image and kernel-event logic remains. Budget is characters, not tokens;
existing provider retry can halve it. Current request gets at least90% before
existing fit policy. Rebuild is linear over journal plus ranking cost, not a
large-journal indexing solution. No secret filter guarantees arbitrary secret
detection; tools/notes other than this schema are not mined. Existing transcript
is not audience-sanitized by this feature.

Selection now reserves up to two records for earliest surviving relevant email
or URL mentions, then fills ranked records with at most two per source event.
This is source diversity, not primary-source verification. A real-journal probe
showed original registration was excluded by audience classification (preceding
email stimulus), not merely ranking. Do not loosen audience isolation to recover
it: explicit recall remains available in owner turns for historical investigation.

Explicit terminal-created notes may now cite earlier assistant events regardless
of their wake audience, matching private recall's source scope. Such events are
not automatically mined. External stimuli and tool payloads remain ineligible
sources; curation is a private assistant claim, not verification or authority.

## Gap audit against Connectome guide (2026-11-12)
Source: https://github.com/anima-research/connectome-host/blob/00d56c540b279e60bdbebfc790cacbf4577def15/docs/AGENT-MEMORY-GUIDE.md
Documentation comparison, not verified runtime. It describes head/middle/tail,
prepared episodic recollections, progressive L1–L8 resolution and as-of
reconstruction, with raw history retained and optional history/semantic search.
Our evidence records are not episodic summaries; recent context still truncates.
Priority gaps: inspectable/paged sources; episodic continuity and provenance;
correction propagation; per-conversation audience attribution; measured retrieval
quality and scalable rebuild; token-aware accounting. Summaries must remain
claims and not silently gain instruction authority. No external data migration
is needed for those semantics. First bounded improvement adds `recall` source
excerpts via `id:<event ID>` and exclusive `before` cursor for older results.
The same private gate, source exclusions, line caps and secret filter apply.
This is not full-span extraction: at most three eligible lines per event.

## Deliberately curated episodes
`remember` accepts an optional episode object with decision, reason and
openQuestions. Journal notes remain backward-compatible memory.v1 records;
no derived on-disk store is introduced. Selection searches these fields too,
returns the whole bounded record with original sources, and labels it a curated
episode claim. Corrections/tombstones and private audience gates apply unchanged.
This is not automatic chunk summarization, as-of replay of model requests, or
Connectome-style hierarchical folding. Episode maintenance currently requires
explicit curation; no automatic detection that an open question was resolved.

## Automatic formation: boundary review and proposed first mechanism
Reviewed loop.ts and main.ts after explicit episodes landed (f79b2ce).
Do NOT attach summarization blindly after assistant append: arrivals can occur
while provider is answering. The last stimulus may then be external even though
the reply was generated from terminal context (or the reverse). Current
memoryRecords uses latest stimulus, so it is insufficient attribution for an
automatic summarizer. onText is not a completion/ownership signal either.
Also final replies can trigger agenda continuations; interrupted and mutation
turns must not initiate another request. A separate provider call after final
reply complicates usage reporting and crash retries; notes do not owe a turn.

Proposed incremental mechanism (not implemented):
1. Reconstruct eligible terminal-only completed spans, excluding any span with
   intervening external stimulus, turn.interrupted, kernel lifecycle boundary,
   pending tool calls or synthetic fallback. Exclude tool payloads entirely.
   Prefer false negatives to assigning an external reply to an owner episode.
2. Snapshot exact event IDs before requesting a summary. Chunk at completed
   exchanges, with an explicit character budget and minimum batch threshold;
   never cut mid-message. Source IDs + format version form deterministic key.
3. Persist candidate coverage as a versioned note, including source IDs and
   audience, not a fresh owner instruction. Deduplicate by source-set key and
   explicit episode coverage on journal replay. A pending candidate is evidence
   of a plan, not evidence that a provider call succeeded.
4. Initially expose at most one candidate in the next TERMINAL request for
   deliberate remember curation rather than launching a hidden post-reply call.
   No candidate injected on clock/external wakes; no new scheduling stimulus.
   This avoids unreported provider calls but does not guarantee curation.
5. Reject output whose sources differ from snapshot or whose fields fail
   episode validation. Do not mechanically label heuristic extraction as a
   decision/reason. Record dismissal or completion so irrelevant spans are not
   offered forever. Interrupt leaves candidate pending, not committed summary.
6. Test races (external arrival between request/reply), restart deduplication,
   source edits/invalid IDs, explicit curation overlap, corrections/tombstones,
   mixed audiences, multiple final replies, mutation and truncation.

Next implementation target is pure span selection + replayable candidates,
then request integration. Automatic formation is NOT solved by the existing
explicit episode tool. Fully autonomous compression needs a separately bounded
provider lifecycle with usage accounting and interruption recovery; defer that
until candidate selection passes attribution tests.

### Candidate dismissal lifecycle
`dismiss_episode` persists an exact ordered eligible source pair in
`episode.dismissed.v1`. Rebuild accepts only terminal-audience dismissals of
already preceding candidates; forged/future pairs are ignored. Repeated calls
are idempotent. This suppresses the candidate, not its original history or
fact retrieval. No summary or owner instruction is manufactured. Structured
curation remains optional; candidates can now be either curated or dismissed.

## Semantic retrieval investigation: bounded design, not implementation
Synthetic diagnostic in memory-relevance.test.ts: lexical runtime selects6/10
positive targets and returns records on4/4 off-topic queries. Removing generic
decision tags alone changes this to6/10 and3/4. A single no-tools model probe
with all5 synthetic documents recovered10/10 positives and rejected4/4 negatives.
These tiny author-selected fixtures do not establish generalization or latency.

Do not rerank only lexical hits: zero-overlap paraphrases would remain absent.
Candidate design for a small corpus: terminal-only, opt-in bounded full-corpus
selection over surviving memoryRecords, with stable opaque IDs and exact source
snapshot. If the corpus exceeds the explicit input budget, report incomplete
coverage; do not silently take the newest slice and call it semantic search.
Larger corpora require a separately evaluated semantic index/chunk search path.
The selector may return IDs or abstain, never manufacture memory text or sources.
Validate IDs against the snapshot; render original records with existing budget,
provenance, correction and secret filtering. Retrieved text stays untrusted data.

A recurrent provider call requires lifecycle integration before deployment:
- terminal audience check BEFORE building input; no clock/external retrieval;
- no independent credential reads; use existing provider connector and signal;
- fixed input/output budgets, one call, short deadline, no automatic retry loop;
- journal usage through existing supported reporting rather than hiding cost in
  notes; record selector version, selected IDs and coverage as rebuildable notes;
- recheck current audience/corrections after completion; cancel/discard stale work;
- timeout/malformed output falls back to explicitly lexical retrieval, not an
  invented semantic result. Keep exact-ID recall usable without inference.
No request caching until its schema includes source snapshot, audience, query,
selector version and correction watermark; cancellation never proves no billing.

Deployment blockers: validate provider accounting integration, measure latency
and usage, choose a bounded corpus-size policy, and test independent adversarial
fixtures (negation, wrong entities, unsupported exact details, bilingual paraphrase,
embedded instructions). Relevant context is not proof it contains an exact answer.
No private history has been sent to a worker by this investigation. The proposed
recurring selector is not installed; local model runtime was not found on PATH.

### Provider boundary inspection and adversarial probe
Current Provider accepts AbortSignal, returns optional usage, but has no per-call
output-token limit in its public options. loop.ts journals usage only with actual
assistant replies; kernel schema has no dedicated usage event. A selector reply
must NOT be journaled as an assistant event: that would alter needsTurn, probation
and conversation semantics. Before recurring selection, extend body-level provider
options for output bounds and design explicit usage accounting for auxiliary
calls, including failure after selection but before main reply. A note can retain
usage, but existing terminal usage totals would not include it; disclose this
rather than silently claiming complete accounting. No kernel changes authorized.

A second single synthetic model probe used five new documents with negation,
wrong project names, old/current address, a reason contrast and embedded hostile
instructions. It selected correct topics for both Russian paraphrases and did not
obey the hostile document instruction or match unrelated Maple/Cedar-tree/cloud
queries. It selected the GPU-delay document for a watts question despite no watts
value: topical relevance is weaker than answerability. An explicit selector
contract should distinguish supporting, contradicting and merely related evidence;
do not turn missing details into facts. This is a qualitative single-run probe,
not a measured accuracy improvement or an installed selector. No private records
were used. Next bounded milestone: pure typed selection/validation contract and
frozen adversarial test fixture, before recurring provider integration.

Evidence-relation follow-up used the same frozen adversarial text, now preserved
in test/body/memory-semantic-fixture.ts. Single observed response:13/14 exact
judgments,8/8 supporting/contradicting targets,0/6 non-answer queries promoted to
answer evidence. The wrong-project Maple query still selected B as related;
report this mismatch rather than counting the whole probe as perfect. Snapshot
replay tests verify validator behavior, NOT future model quality or determinism.
This prompt was evaluated after seeing the prior response, so no held-out claim.

### Chosen auxiliary accounting path (inspection completed)
Use an explicit terminal-only semantic recall TOOL first, not a hidden automatic
call in context building. Its result reports provider usage as data with an
explicit scope: auxiliary, excluded from kernel terminal totals. Persist a
versioned note receipt as soon as a provider reply arrives, before parsing model
selection, so invalid selections still retain reported cost. Receipt fields:
request ID, status, provider-reported usage or null, coverage, selector version;
never credentials, raw errors or invented zero cost. tool.result supplies the
normal visible execution receipt, not a fabricated assistant reply. Unknown cost
on timeout/cancellation must stay unknown. A durable started note identifies
crash-uncertain calls; do not automatically retry them. This does not repair the
kernel aggregate usage display, and must say so explicitly to the owner.

Inspection found existing subagent drops Reply.usage entirely; therefore do not
reuse its serialized output as an accounted backend or claim the exploratory
worker calls were included in terminal token totals. Provider itself returns
usage. Reuse Provider directly with cancellation, but not subagent's lossy wrapper.

Next implementation should add optional validated maxOutputTokens to ProviderCallOptions:
chat completions maps to max_completion_tokens; Responses maps to max_output_tokens.
Omitted option leaves existing requests byte-compatible. Reject invalid limits
before credentials/network. Do not silently retry without the bound if a route
rejects it. Server limits cap generation tokens, NOT input tokens, transport body
bytes or guaranteed billing. Bound input snapshot characters separately and refuse
oversized corpus (explicit coverage failure), rather than silently omit records.
Test both wire protocols and invalid-limit no-network behavior before using this
option in semantic recall. Route support remains unverified until a bounded call
succeeds; no private corpus should be used for that compatibility probe.

### Standalone tool safety checkpoint
Correction during inference, oversized corpus refusal before provider call,
fabricated IDs and cancellation with an uncooperative provider now have explicit
tests. Existing race test covers external arrival while a request is in flight.
The tool checks exact stimulus identity and the complete surviving-record snapshot
before returning original evidence. It is not wired into main yet.

Receipt review limitations: started/completed notes are not counted in kernel
usage totals. If a transport returns after local cancellation/timeout, that reply
is not consumed and its usage is unknown, not zero. The tool makes no application
retry, but Provider may refresh authentication or retry unsupported reasoning
summary fields. Input/output limits remain on those protocol attempts. A started
receipt is not a deduplication lock: future caller-initiated retries are separate
requests and must be checked deliberately. A second terminal stimulus also makes
results stale. This is not per-conversation attribution for historical records;
it inherits memoryRecords' existing audience rules and limitations.

Before runtime wiring, check live route support on synthetic records only, and
establish how frequently real corpora exceed the20000-character snapshot limit.
Do not loosen privacy or silently sample records merely to get a successful call.

### Synthetic capacity measurement
Measured actual memoryRecords serialization without reading private journal:
100-character curated texts fit100 records; record101 exceeds20000 characters
(20192). With300-character texts,50 fit and51 exceed (20391). With900-character
texts,20 fit and21 exceed (20991). Minimal synthetic IDs/timestamps were used;
real provenance and episodes add overhead, so these are not production capacity
estimates. Nevertheless a full-history tool that refuses even51 medium records
is not a plausible general long-term retrieval deployment. Do not wire this tool
as the promised solution or increase the cap without cost/coverage evaluation.

Live-route probe remains unperformed. Existing no-tools semantic workers do not
exercise this new maxOutputTokens option. A future probe must use a synthetic
journal and the normal Provider connector, never credential files or key copying.
A route accepting the option would establish compatibility only, not scalability.
Prioritize resolving full-corpus coverage before spending another provider call.

Next design comparison: bounded full-corpus chunk selection with a declared total
budget and explicit incomplete coverage, versus a rebuildable semantic index.
Chunking preserves zero-overlap candidates only when ALL chunks are visited;
lexical prefiltering would recreate the original miss. A fixed call budget must
refuse or report partial coverage, not claim exhaustive search. No recurring or
multi-call private-history processing has been deployed by this investigation.

### Coverage design decision: index, not repeated full-corpus inference
Arithmetic comparison (not measured tokens, latency or dollars): assume400
serialized characters/record,19000 usable characters/chunk. At100/1000/10000
records a complete scan takes3/22/211 chunk calls per query and transmits roughly
40000/400000/4000000 record characters, excluding prompts/query overhead. Three
calls cover at most100%/14.25%/1.425%; visiting only these chunks cannot recover
arbitrary old zero-overlap paraphrases. Whole-record packing reduces coverage.
Thus chunked full scan is only a small-corpus diagnostic, not the chosen default.

Choose a rebuildable dense semantic index plus lexical/entity union as the next
candidate architecture, subject to actual embedding-model evaluation. At384 float32
dimensions, raw vectors for100/1000/10000 records occupy153600/1536000/15360000 bytes
(excludes IDs/metadata/index overhead). This dimensionality is illustrative, not
model selection or quality evidence. A flat vector scan suffices for an initial
bounded experiment; ANN complexity is not justified yet. Vector ranking is
approximate semantic relevance, never guaranteed recall or evidence of truth.

Index identity must include schema version, embedding model+revision, dimensions,
normalization and content hash. Directory memory/semantic-index-v1 is reserved,
not created. Original claims and provenance remain journal-authoritative. Apply
current memoryRecords eligibility/correction filtering BEFORE candidate selection;
exclude query stimulus and never resurrect hidden records from cached vectors.
Cache vectors are derived artifacts: losing them requires recomputation, not loss
of facts. Rebuild reproducibility depends on the embedding backend remaining
available; do not imply bitwise determinism across model revisions. Persist no
new authoritative facts in the index. Query path: terminal-only gate, query
embedding, dense/lexical/exact-entity candidate union, optional bounded semantic
evidence selection, recheck snapshot before rendering original records.

Unresolved dependency: no embedding backend is established. Existing Provider
exposes generation only; do not invent an embeddings endpoint or assume ChatGPT
sign-in grants embedding access. Prefer evaluating a published local multilingual
embedding runtime/model with verified artifacts first. New native dependencies
must follow organ pinning/check rules; never run an ad-hoc downloaded executable.
A remote embedding service would require an explicit privacy/cost decision before
bulk private-history processing. Next bounded action: public-source feasibility
review of at most two local backend candidates (runtime+model compatibility,
artifact integrity, license, CPU/memory, reproducible pinned loading). No download
of large models, installation or private indexing until a viable path is shown.

### Public backend feasibility review (two candidates; no weights downloaded)
1. ONNX Runtime + intfloat/multilingual-e5-small. HF revision
614241f622f53c4eeff9890bdc4f31cfecc418b3 README declares MIT,100 languages,
query/passage prefixes and512-token truncation. GitHub microsoft/onnxruntime
release v1.31.1 publishes CPU linux-x64 archive11,413,655 bytes, SHA256
c849e36a1ef3e22d4ff217b9d1ce4a3cf5b9467b975610913ae959ad5b16bdc9.
But archive suffix is .tgz, outside current organ .tar.gz rule. Also this is a
runtime library, not a complete tokenizer/pooling embedding executable. No
compatible prebuilt end-to-end pipeline established; no RAM/latency measurement.
Do not rename/repackage artifacts to evade organ constraints.
Sources: https://huggingface.co/api/models/intfloat/multilingual-e5-small
https://huggingface.co/intfloat/multilingual-e5-small/raw/614241f622f53c4eeff9890bdc4f31cfecc418b3/README.md
https://api.github.com/repos/microsoft/onnxruntime/releases/latest

2. llama.cpp + ggml-org/embeddinggemma-300M-GGUF. HF revision
0f741b5a6585bd53aeb15cd1372c56f2a0f65e12 README explicitly documents
llama-server --embeddings and llama-embedding, default L2 normalization.
Q8_0 model size333,590,944 bytes, LFS SHA256
b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63.
This establishes published weight integrity metadata and documented runtime
compatibility, not a tested local binary. Latest GitHub release API returned
v0.9.0 with only nightly-tag.txt, no executable archive. Need resolve a specific
published binary release and its integrity metadata, not assume latest provides
one. Base model README request returned401; license terms, language/dimension
claims and resource needs remain unverified in this review. GGUF conversion card
has no license field. Do not infer permission from public download availability.
Sources: https://huggingface.co/api/models/ggml-org/embeddinggemma-300M-GGUF?blobs=true
https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/raw/0f741b5a6585bd53aeb15cd1372c56f2a0f65e12/README.md
https://api.github.com/repos/ggml-org/llama.cpp/releases/latest

Decision: neither candidate ready to install. Prefer further bounded feasibility
check of llama.cpp published release plus model license because it documents a
complete embedding CLI, whereas ONNX needs tokenizer/binding integration and
archive-policy resolution. No large files downloaded, no private corpus accessed,
no executable installed, no pin changed. Model file size is NOT peak RAM.

### Follow-up: binary found, adoption stopped at license/resource boundary
GitHub releases list (not /latest) returned b12322 CPU artifact:
https://github.com/ggml-org/llama.cpp/releases/download/b12322/llama-b12322-bin-ubuntu-x64.tar.gz
23,311,399 bytes; published SHA256
735a12ee7711afc75d994a7b9fac654a7f8718d084d33cf001910f0d16c5a7d0.
Suffix is admissible for organs; archive contents, binary ABI, execution and organ
check still unverified. No artifact downloaded. Host x86_64/glibc2.41; cgroup
memory.max reports max, which is NOT proof of free RAM or permission for unlimited
allocation. Weight size333.6MB and runtime archive23.3MB do not establish peak RSS.

Public Google model card https://ai.google.dev/gemma/docs/embeddinggemma/model_card
states300M parameters,2K input context,768-dimensional embeddings with optional
512/256/128 truncation+renormalization, training data over100 languages. It links
Terms of Use. Documentation now flags itself deprecated in favor of gemma.ai;
claims are publisher documentation, not local measurements.
https://ai.google.dev/gemma/terms (page says last modified April1,2026) states use
constitutes agreement; section2.1 represents authority to bind an entity when
using on its behalf. Section3.2 incorporates prohibited-use policy; section3.1
imposes redistribution notices/agreement obligations, with hosted functionality
included in definition of distribution. This is not an MIT-style license.
No assent made, no gated account accessed, no weights downloaded or run.

Stop this installation path pending owner decision on Gemma terms for local
synthetic-only evaluation, or authorization to investigate another permissively
licensed model. Even with approval, require resource-capped synthetic execution,
archive hash/check verification and measured peak RSS/latency before indexing.
The owner's measured-retrieval outcome remains unmet; diagnostic implementation
is unwired and must not be promoted as an improvement already demonstrated.

### Owner redirect: existing-model expansion experiment
No Gemma/new model installation. Query-only subagent sample
 e40d4f12-faad-47c0-abbf-ccd9c3819301 saw8 queries and no documents. Frozen
expansions tested through actual recallJournal (recall-expansion.test.ts).
Candidate answer-target recall improved3/5 to4/5. All3 non-answer queries
still retrieve candidates (3/3 both before/after): wrong project, missing
cipher detail, meteorology versus cloud backups. Thus candidate recall gain is
not answer relevance improvement. Zero-overlap migration/warranty source still
missed. Nine newer lexical distractors crowd out an old relevant source on the
first8-hit page; explicit older cursor recovers it. Fixture shares earlier
synthetic selector topics; no held-out/generalization claim. No private journal
read or embedding backend involved. Worker token usage unavailable in existing
subagent output; no claim of inclusion in kernel totals.

Next bounded experiment: feed retrieved candidates (not whole history) to existing
semantic evidence selector on these8 queries, recording end-to-end true answer
hits and non-answer promotions versus literal retrieval. Explicit coverage flags
must preserve the missing zero-overlap source and limited paging. Do not wire
runtime until combined behavior is tested; query expansion alone is insufficient.

### Comparative research restarted at owner's request
Connectome primary guide pinned to00d56c540b279e60bdbebfc790cacbf4577def15:
https://github.com/anima-research/connectome-host/blob/00d56c540b279e60bdbebfc790cacbf4577def15/docs/AGENT-MEMORY-GUIDE.md
Read opening mechanism: pinned raw head, raw recent tail, adaptive middle
resolution L1..L8; precompute recollections as spans leave tail, display only as
budget requires; one representation per span. These are documented behaviors,
not reproduced execution. Critical reusable distinction: creating a memory is
separate from selecting it for context. Do not copy first-person memory replay
as authority; this lineage requires historical-evidence labels and source IDs.

Claude Code primary docs https://code.claude.com/docs/en/memory retrieved:
CLAUDE.md instructions are distinct from auto memory learnings. MEMORY.md index
loads first200 lines or25KB; topic files hold details for later reading. This is
an index+selective detail mechanism, not evidence of hidden embedding retrieval.
Docs say auto memory local to machine and shared across repository worktrees;
transcript retention sweep excludes memory files. Our journal-authoritative
rebuildability must differ: no untraceable independent topic files.

Codex docs/getting-started.md fetched but only redirects to CLI features; no
Codex memory mechanism established yet. Next read actual memory/compaction code
and official docs, then one additional agent before proposing combined design.
Early hypothesis (not implementation decision): always-present bounded episode
index, multi-resolution source-linked episodes, on-demand original evidence;
existing model/subagents perform extraction and selection. Must test summaries
for source loss and corrections, not assume hierarchy solves every recall miss.

Further primary inspection: Codex commit72532ecae5efe500d9e722f3ed5214e63cc8098a,
codex-rs/ext/memories/src/local/search.rs implements lexical matching with optional
normalization, scoped paths, context lines and cursor pagination, not embedding
search. templates/memories/read_path_v2.md supplies MEMORY_SUMMARY and directs
selective rollout-summary reads when evidence/chronology/uncertainty matters;
explicit correction notes are consolidated rather than editing generated files.
This is one implementation/template, not proof of every Codex deployment default.
Connectome pinned src/modules/retrieval-module.ts has concept extraction prompt,
ID-only relevance validation and size-capped lesson injection with omitted count.
Letta https://docs.letta.com/guides/agents/memory/ redirected to stateful-agent
concepts: persisted messages/tools/memories survive context eviction, core memories
are injected and tool-editable. This page alone does not establish archival ranking.

Distilled candidate: journal evidence -> source-linked episode cards (decision,
reason, entities, unresolved questions) -> bounded always-visible topic/episode
map -> selective card and source reads. Creation separated from rendering;
corrections invalidate dependent cards/index entries, not just exact old facts.
Use existing model for card creation and semantic routing; keyword recall remains
cheap fallback, not sole entry point. Keep instruction authority outside derived
memories. Next validate routing from compact map on zero-word-overlap and wrong-
entity fixtures, with query-blind card creation and declared omitted coverage.
No claimed implementation improvement until that end-to-end test succeeds.

### Three-stage synthetic episode-map probe
Existing subagent calls, no private history/new model:
creation b240ccbb-6f4d-42be-9613-9322cec0eaca received six original sources only,
no queries; produced five cards covering A,B,C,D,F,G (B/G merged correction).
Routing890488bf-172e-4607-ab05-9cec5fc852eb received a parent-shortened version
of that map, not originals, and eight prior queries. Thus this is a manually
orchestrated feasibility probe, NOT a faithful automated end-to-end benchmark.
Validation0f7086ea-fc18-4d45-bd92-c1e58ae4a506 received only routed original
sources, with explicit no-causality-from-chronology instruction.

Observed routing recovered all five relevant episodes (including zero-overlap
migration/incumbent F), rejected wrong project Maple and meteorology, selected
backup episode for absent encryption algorithm. Original-evidence validation
answered four supported questions, marked cipher and migration reason partial,
and two irrelevant questions absent. Cedar returned corrected Tuesday, with
B/G provenance; did not assert vendor withdrawal CAUSED remaining on platform.
Important correction to prior fixture accounting: F is relevant context, not
sufficient answer evidence for WHY migration was abandoned. Earlier3/5 vs4/5
metric measured candidate hits, not five answerable questions.

Coverage: six/six supplied sources represented, no cap/truncation exercised;
all five cards visible to router. No held-out topics, repeated samples, cost or
latency benchmark. Subagent tool does not return token usage; costs not zero.
Correction was present before card construction, not applied incrementally to
an existing card: invalidation/rebuild and removal remain UNTESTED. Parent
shortened map and supplied source bundles manually. No automatic citation
validation or runtime behavior established. Next freeze exact raw worker card
output, automate fixture routing input and deterministic correction dependency
invalidation; evaluate capped-map omission explicitly before runtime wiring.

Experimental episode-map.ts now binds cards to hashes of explicit dependencies,
rejects duplicate/unknown source IDs, renders exact cards and reports cap omissions
and changed/removed-source invalidation. One exact worker correction card frozen
in tests; other cards not yet frozen. CRITICAL limitation: adding a new correction
source alone does not invalidate an old card. Caller must resolve supersession
into current eligible sources, removing/replacing affected sources BEFORE render.
This helper is not a semantic correction resolver and is not runtime-wired.
Coverage label refers only to supplied cards, not entire journal/source coverage;
next refine this label and enforce source coverage accounting before deployment.

Exact-map routing checkpoint: dddc0f79-8ddc-4a81-a7bc-d925df0e30c6 received
verbatim JSON rendered from all frozen cards, no parent-shortened summaries.
Returned1->1,2->4,3->3,4->none,5->1,6->5,7->2,8->none. Same5/5 relevant
candidate episodes and two wrong-topic/entity rejections; cipher query still
only partial evidence. One repeated known fixture, not independent generalization.

eligibleSources now validates explicit ordered whole-source replacements; rejects
unknown/forward targets, duplicate IDs and repeated replacement of a retired
source. Chain G->H->I retires G/H and invalidates dependent card while preserving
unrelated cards. It is NOT a prose correction parser or partial-field resolver.
Test replacement H repeats Birch Monday to avoid silently losing an unrelated
field. Existing B remains historical and uncovered pending rebuilt episode.
Next: held-out query-blind episode creation/routing with partial-field corrections,
entity ambiguity and distractors; establish rebuild policy before wiring.

### New-topic query-blind probe and partial-correction policy
Creation worker bdf8317c-8c15-4262-b702-b34a067155b2 received J1..J8 synthetic
history only (no questions). New topics: observatory/bakery Kestrel deliveries,
boarding-pass printer privacy incident, kitchen toner, observatory encryption
versus Harbor AES-256. Generated six cards; combined J1/J2/J8 correctly retained
East bay, changed May9 to May12 and Mira to Noor. All eight sources represented.
Reader1205d94e-5e8b-4e11-9aae-52c2a7749614 received exact card JSON and seven
questions, not originals: three supported, three partial, one absent. Preserved
unaffected bay and differentiated bakery Leon; did not borrow Harbor cipher;
flagged paper-ticket/boarding-pass and kitchen-device ambiguity. No Orchard date
invented. This is new-topic synthetic testing, not preregistered held-out benchmark:
parent composed questions after creation; no blind original-evidence stage or
literal-retrieval comparison this round. Cards omitted required title field of
current EpisodeCard schema because prompt requested only id/summary/sources;
therefore not yet an integrated runtime-path test. Do not inflate quality claims.

Partial correction rebuild policy: never remove entire J1 when only its date or
contact changes. Preserve originals as historical evidence; correction links mark
all dependent cards dirty, excluding stale summaries until rebuilt from original
sources plus ordered corrections. Rebuilt card depends on J1,J2,J8, retains bay
provenance and distinguishes previous/current fields. Ambiguous correction target
must remain unresolved, not automatically superseded. Whole-source eligibleSources
is unsuitable for these partial changes. Detecting/linking corrections in prose
requires model proposal plus structural checks and original evidence, not a regex.

Minimal next integration scope: add explicit affected-source invalidation primitive
for partial corrections, test transitive card dependencies without dropping originals;
then candidate-card proposal validation against the existing memory note schema.
Do not build a parallel authoritative file store. Start runtime design only after
inspecting current episode-note persistence and context limits. Remaining gates:
query-blind automatic extraction/routing path, source validation, privacy boundaries,
limited costs/coverage, drift/correction recovery, full tests and owner-visible mutation.

Partial correction primitive implemented (unwired): renderMap accepts explicit
ordered {source,affects} edges between supplied sources. Closure marks cards stale
when dependent original/earlier-correction sources require later corrections absent
from the card. Does not retire originals. Rejects forward/unknown/duplicate edges.
Rebuilt card citing original plus entire correction chain passes structural checks;
this does NOT prove its summary interpreted corrections correctly. Source ordering
is caller-supplied; runtime adapter must preserve journal order and privacy filters.

Existing persistence inspected in body/memory.ts: memory.v1 note contains text,
tags, up to12 prior eligible source-event IDs, optional decision/reason/openQuestions,
whole-memory-record supersedes/deleted fields. memoryRecords reconstructs from journal
and hides superseded records, not every dependent derived card. Thus no need for
parallel authoritative storage. Minimal integration proposal: adapter from validated
curated episode notes to cards; correction dependency metadata needs separately
versioned journal note validation, because existing supersedes refers to memory
record IDs, not raw event IDs and cannot safely stand for partial source correction.
Do not overload that field. First implement/test pure adapter and replay semantics
with synthetic journal fixtures before automatic proposal or context injection.

### Journal adapter integration boundary
Pure test now composes memoryRecords -> journalEpisodeCards -> bind/renderMap ->
validateSelection -> answerEvidence. Hidden, invented and budget-omitted card IDs
cannot return as evidence; related-only selection yields no answer evidence.
No live model call: relevance remains unevaluated by this plumbing test.
Privacy review: adapter checks latest stimulus terminal and delegates note validation
to memoryRecords; assistant source claims remain allowed (not verified owner facts).
Callers must recheck audience and journal snapshot after any asynchronous selection,
as semantic-recall already does. Adapter alone is synchronous, not an audience lock.

Proposed separate note kind episode.correction.v1 (NOT implemented): data holds
source event ID and affected prior source IDs; replay accepts only terminal-curated
notes referencing already eligible prior events, rejects unknown/duplicate/self or
forward references, and imposes bounded edge count. This is an explicit curator
assertion of a partial correction, not inferred authority. Keep original evidence;
closure excludes dependent cards lacking correction sources pending rebuilt memory.v1
note with explicit whole-card supersedes. Derived metadata/index must reconstruct
from journal, no parallel authoritative file. Before implementation decide how to
withdraw an incorrect edge (append-only replacement/tombstone by correction-note ID)
and test old-generation/invalid-note replay. Do not persist half-defined metadata.

Correction replay experiment now in episode-corrections.ts: versioned add
{op,source,affects} and withdraw {op,target} exact schemas. Withdraw targets an
active add note; absent/withdrawn target is no-op. Undo requires a fresh add, never
withdraw-a-withdraw resurrection. Sources remain untouched. Terminal-curated notes
only; source eligibility matches explicit curation (assistant claims are eligible
but not thereby true). Edges point from later eligible source to earlier source.
Active budget128; overflow throws rather than silently making stale cards appear
current. No writer/runtime integration. Rebuild after edge withdrawal still needed:
a summary containing withdrawn correction cannot be assumed valid merely because
its original dependency reappears. Next test graph snapshot invalidation against
both edge additions and removals before connecting this replay to rendering.

Graph snapshot checkpoint: bindCards stores canonical graph digest; renderMap
rejects all cards after any edge addition/removal, conservatively including unrelated
cards. Same graph reordered is equivalent. This is intentionally coarse invalidation,
not semantic proof. Rebinding stale summaries to a new graph WITHOUT reconstruction
would bypass protection: callers must retain build-time digest and rebuild from
original evidence before binding. No runtime caller yet. Duplicate correction-note
assertions retain individual ownership: withdrawing one does not remove another's
same edge. Returned edges deduplicated; active assertion budget still counts both.
Tests exercise additions, withdrawals, reordering, duplicate ownership and limits.

Build-time replay integration: journalBoundEpisodes derives each surviving curated
card's source hashes and graph from the journal prefix ending at its memory.v1 note,
not from the current graph. Note position itself is a durable build boundary, requiring
no new persisted digest for this synchronous curated-note experiment. Test replay
returns identical binding after withdrawal, rendering marks old summary stale, and
explicit replacement card binds the new graph. External latest stimulus returns none.
IMPORTANT limitation: note append time is not necessarily model input snapshot time.
An async generated card may have been composed before a correction arrived; future
builder must record/validate explicit input boundary and reject snapshot races.
This adapter therefore remains experimental and is NOT safe to wire as an automatic
builder merely because prefix replay passes. It also replays prefixes per card (not
scalable without bounded corpus or indexed one-pass replay). No production writer added.

Async boundary experiment: episodeInputBoundary hashes bounded exact input events;
episodeInputUnchanged requires same terminal audience and byte-equivalent snapshot
before proposal acceptance. Any intervening event rejects (deliberately conservative).
Validation and future append must be synchronous with no intervening await; no writer
exists yet, so this is a tested guard, NOT proof an installed writer is race-free.
Snapshot token is local only; persisted provenance/boundary protocol still undecided.
Adapter hard caps:2000 events,200000 JSON characters,64 live episode cards. Oversize
throws, never silently treats omitted corrections as absent. These contain replay
work on supplied arrays but do not bound journal disk reading or initial serialization
allocation. Large real journals require bounded indexed ingestion, not raising caps.
Next decision: keep this as a small-corpus opt-in experiment vs add scalable ingestion;
first measure fixture retrieval against lexical baseline through one common pipeline,
so further integration complexity is justified by demonstrated benefit.

Common selection diagnostic test/body/episode-comparison.test.ts: existing
memoryContext over frozen episode notes (plus its automatic source excerpts) versus
all five rendered cards, same recorded routing and validateSelection/answerEvidence.
6 relevant queries (4 supported,2 related),2 wrong entity/topic: lexical exposed4/6
card targets versus full map6/6; supported selections2/4 versus4/4. Lexical supplied
candidates for both wrong-topic queries; recorded selector rejects them in both arms.
This is exposure ablation, NOT new proof of semantic selector accuracy: routing is
frozen from earlier worker and support labels parent-assigned from original evidence.
Baseline contains C:0 excerpt as well as card3 due to production memoryContext logic;
metrics count target cards only. Full map exposes irrelevant cards for every query;
its safety depends on fresh selector accuracy, which these fixed outputs cannot prove.
Result justifies limited small-corpus experiment, not scalable ingestion or deployment.
Next perform fresh independent selection on both candidate sets with original-source
answer validation; hold questions/corpus fixed and record IDs/results, including
empty lexical arms. Stop expansion until that measurement supports further work.

Fresh paired small-corpus evaluation (no runtime wiring): lexical worker
6f6023d6-4fa0-4db2-b0a0-aa037ae1e326 and map worker
7f79d929-4da7-4df9-916a-b4030b77b919 used same eight fixed queries/cards.
Lexical per-query allowlists matched comparison test (including C:0); map all five.
Lexical substantive answers Q3,Q7; map Q1,Q2,Q3,Q7. Both abstained on Q4 wrong
project,Q5 missing cipher,Q6 unstated migration cause,Q8 meteorology. Both called
wrong-project card2 related for Q4 (NOT irrelevant-selection rejection); filtering
related is essential. Thus supported-answer recall2/4 versus4/4, wrong-topic answer
false positives0/2 both; missing-detail/causal hallucinations0/2 both. Original-only
validation worker16dc70a0-62c7-4ce9-84a7-c81491b2b337 checked all substantive
answers against A/B/C/D/F/G, confirmed support and temporal-not-causal Q6 abstention.

Limits: one familiar tiny synthetic corpus, no confidence/generalization claim.
Lexical worker saw all cards globally but was instructed to honor query allowlists;
it is not a physically isolated per-query exposure test. Two worker prompts used
same selection task but no enforced identical output schema: one returned selected
objects, other numeric supports/related lists, so NOT runtime validateSelection
execution. Original validator saw paraphrased answers supplied by parent, not raw
worker JSON. Findings justify only bounded opt-in experiment, not automated ingestion
or replacing lexical context. Existing whole-journal adapter cap is unsuitable for
large real journals; do not silently truncate history/corrections to fit. Next bounded
step is a strict-schema mocked tool integration using frozen episodes, source-grounded
results and snapshot/privacy checks; only then consider one real opt-in call. Stop
expanding correction machinery until that minimal path's usefulness/cost is assessed.

Retrieval helper enforces 30s maximum local deadline (configurable downwards), parent
abort race and transport abort signal; cleans timers/listeners. Content-free receipt
callback reports started/provider_completed/completed or failed/cancelled/timed_out,
with provider usage retained even on invalid output. Optional callback is NOT durable
accounting; no live tool until a journal receipt adapter is supplied. Full-journal
snapshot comparison would reject self-written receipts: future adapter must isolate
its own receipt notes without ignoring genuine content/correction changes. Current
mock callback doesn't write journal. Timeout cannot guarantee remote billing stops;
no completion receipt means cost unknown. Tests cover uncooperative timeout/abort,
usage on malformed output, sensitive originals and oversized query preflight.
Scope decision: remain unregistered; no live call or production mutation yet. Stop
scalable ingestion work. Next minimal requirement is receipt-safe snapshot adapter,
then explicit proposal on whether bounded corpus tool is useful on real history.

Final bounded feasibility check: real journal exceeds both 2000-event and 200000-char
limits (aggregate only inspected, no content sent to worker). Exact private aggregates
not stored in code. Prototype therefore cannot operate on current history. Decision:
remain unregistered; no mutation, no live call, no automatic truncation or cap increase.
Further practical use requires a separately scoped bounded projection/index design
that retains correction/audience provenance; current full-journal adapter is not it.
Receipt failure review: appendEvent exceptions reject; failed started receipt prevents
provider call. If provider_completed append fails, usage may not persist; subsequent
failed receipt can mask original exception. Local timeout drops late provider usage,
so remote cost unknown. No retries. Do not present this as production accounting.
Synthetic measured improvement remains evidence for research, not deployed outcome.

Projection revision supersedes whole-journal snapshot/cap design above. Retrieval
snapshot now hashes validated bound cards, original source events, all correction
notes/current graph, and latest stimulus. Irrelevant notes do not invalidate,
including foreign receipt-kind notes: old test assumption deliberately removed.
Own receipt-ID exclusion retained in adapter, but not relied on for semantic changes.
200000-char cap applies to projection;64-card cap retained; no event-count cap.
Tests add3000 irrelevant notes without rejection and detect source/correction/audience
changes. This is retrieval-only: DO NOT use this projection guard to authorize an
async episode builder from arbitrary input; unselected input messages are excluded.
Local replay still reads/scans whole journal, repeated prefixes per card; serialization
allocation not bounded by cap. All correction notes retained conservatively, so their
unbounded growth remains a future projection-design concern, not silently dropped.

Projection validation checkpoint: guard renamed episodeRetrievalBoundary/Unchanged
in TypeScript to prevent mistaken reuse as general async-builder guard. Tests verify
supersession/tombstone change snapshot, never resurrect old cards, and oversized
correction-note projection fails closed even when malformed graph data is ignored.
Real journal aggregate-only test initially refused nonterminal scheduler audience as
intended. Local in-memory terminal stimulus (NOT persisted, no model call) allowed
size/timing measurement: snapshot and card reconstruction succeeded; full replay
still required. This is simulated terminal feasibility, not actual tool deployment.

Pre-integration review decision: provider diff is NOT unrelated: optional output
limit used by both experiments, validated before credentials/transport and mapped
for both protocols; ordinary calls unchanged. Keep with minimal retrieval feature.
Current body files total268938 bytes (including53628-byte design history). Checked
kernel/gates.ts exports bodySize but found no invoking numeric body-size gate in
current kernel; no claim of a specific allowance. Do not alter protected kernel.

Smallest honest runtime surface: explicit episode_recall tool, terminal-only, not
auto-context and not replacing recall. Response MUST always say curated-episodes-only,
not comprehensive journal/memory search; report episode count and direct user/model
to lexical recall when empty. Empty selection is not absence evidence. Existing
semanticRecall experiment cannot be substituted: all-record67756-char corpus exceeds
its20000 cap. No automatic creation/backfill of episodes in this change.

Before registration: implement/test wrapper with scope/count metadata and refusal
statuses plus receipt pointers; preserve original evidence and cancellation. Review
found global correction graph conservatively stales every card on any graph change,
and renderMap requires all edge endpoints in supplied sources (currently card sources
only). This can refuse unrelated corrections, not leak wrong evidence; document as
limitation rather than relaxing safety now. Usage receipt failure masking and unknown
late usage remain explicit limitations. Only1 real card: feature useful as narrowly
scoped supplementary lookup, not fulfillment of broad paraphrase memory outcome.
