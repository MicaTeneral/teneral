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
