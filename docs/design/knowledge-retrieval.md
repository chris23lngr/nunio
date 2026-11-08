# Knowledge retrieval

Status: accepted design, 2026-10-29; Phase 7 implemented `retrieve`, `cite`, Chat and planning scopes, 2026-11-08 (see "Phase 7 decisions"). `pin`, Run snapshots and widening wait for Runs in Phase 9. Domain terms follow [GLOSSARY.md](../../GLOSSARY.md). Architecture terms (module, interface, seam, adapter, depth) follow the codebase-design vocabulary. Related: [delegation-gate.md](delegation-gate.md), ADR-0007, ADR-0009, invariant 5 in [durable-ai.md](../research/durable-ai.md).

## Purpose

The read side of the `knowledge` package is the only way course material and Facts reach a model, a Chat answer, or another module. Scope, Run snapshots, Correction precedence, untrusted-text handling, and deletion are enforced here once, instead of in every Agent tool and route. The design merges three alternatives produced under different constraints: smallest interface, most flexible, and simplest common case.

## Interface

```ts
export function createKnowledgeReader(deps: {
  db: PrismaClient;          // local-substitutable; internal seam
  embedder: Embedder;        // true external; real port
  delegation: Delegation;    // in-process; used only for meter()
  clock: Clock;              // in-process; injected
}): KnowledgeReader;

export interface KnowledgeReader {
  pin(p: Principal, req: { runId: string; from: { chatId: string } | { responsibilityId: string };
                           widen?: { courseIds?: string[]; sourceIds?: string[] } }): Promise<Pinned>;
  retrieve(p: Principal, scope: ScopeRef, q: Query): Promise<Retrieval>;
  cite(p: Principal, refs: CitationRef[]): Promise<Map<CitationRef, Provenance | "gone">>;
}

// A reference, not authority: serialisable through Temporal; owner and selection are resolved server-side on every call.
export type ScopeRef = { chatId: string } | { runId: string } | { planning: true };

export type Query =
  | { kind: "passages"; text: string; limit?: number; narrow?: Narrow }       // metered (query embedding)
  | { kind: "facts"; types: FactType[]; text?: string; narrow?: Narrow };    // metered only when text is given
type Narrow = { courseIds?: string[]; sourceIds?: string[]; projectId?: string };   // intersected, never unioned
type FactType = "obligation" | "topic" | "fixed_event" | "course_rule" | "exam_logistics";

export type Retrieval =
  | { status: "ok"; revision: string; items: Item[]; truncated: boolean; render(): PromptData }
  | { status: "refused"; reason: "not_owner" | "run_unpinned" | "budget_exhausted" | "allowance_exhausted" };

type Item = { channel: "course_material" | "operational"; cite: CitationRef } & (
  | { kind: "passage"; text: Untrusted; provenance: Provenance; score: number }
  | { kind: "fact"; factId: string; type: FactType; value: Untrusted; uncertainty?: string;
      provenance: Provenance;                                            // the Correction when one exists
      disagreement?: { value: Untrusted; provenance: Provenance } });   // newer Source; flagged, never applied

type Provenance =
  | { kind: "source"; sourceId: string; title: string; location: { page?: number; section?: string; span?: [number, number] } }
  | { kind: "correction"; correctionId: string; at: Date }
  | { kind: "entry"; at: Date };

type Untrusted = Brand<{ readonly length: number }, "Untrusted">;        // toString()/toJSON() return "[untrusted]"
type PromptData = { data: string; citations: { tag: string; cite: CitationRef }[] };   // nonce-fenced data block, [S1] tags

export interface Embedder {
  model: string; dims: number;
  embed(texts: string[], opts: { signal: AbortSignal }): Promise<{ vectors: number[][]; usage: Usage }>;
}
```

### Invariants

- **Scope is enforced inside the query.** It is the owner, intersected with the selection resolved from the `ScopeRef` and checked against the Principal, intersected with `narrow`. Every SQL statement applies it, and Postgres row-level security under a runtime role with a transaction-local owner is a second defence.
  - An empty scope returns `ok` with no items, without an embedding call or a `meter` reservation.
  - `narrow`, `limit`, and weak scores never add a Source. Low-scoring hits are dropped, and `render()` says nothing relevant was found in the selected material.
- **Only a student widens.** Only `pin` with a student Principal and `widen` broadens a Run's scope, and the API calls it only after the student authorizes the change. A Run Principal cannot widen.
- **Planning scope.** `{ planning: true }` is accepted only for `facts` queries, with the types `obligation`, `fixed_event`, `course_rule`, and `topic`, across all of the owner's Courses. The Plan spans every Course, so a Rebalance must see every Obligation and Fixed Event. Passages are never owner-wide: course content always stays under explicit selection.
- **Snapshots.** `pin` fixes a Run's selection at Run start. It is idempotent on `runId`, and a repeat call by a Run Principal returns the existing pin. For Runs, **additions are frozen** (new Sources and new extractions stay out) while **removals and Corrections apply live** on every call. Chats always read their current selection; only Runs pin. A Chat-started Run pins the Chat's selection at the moment it starts.
- **Disconnect.** Data read live through a Disconnected Connection, such as calendar availability, disappears immediately. Sources already imported through it stay until the student deletes them, as GLOSSARY.md defines.
- **Deletion is immediate everywhere.** A deleted Source's passages, Facts, summaries, and cached results vanish on the next call. Summaries and caches record `derivedFrom[]` and are visible only while every Source they came from is live. Stored Chat messages keep only `CitationRef`s, never snippets, and resolve them through `cite()` at display time, which returns `"gone"` for deleted Sources.
- **A Correction always wins.** Its value is in `value`, and a disagreeing newer Source appears only in `disagreement`.
- **Untrusted text** leaves the module only through `render()`: a nonce-fenced data block with escaped fence look-alikes and `[S1]` tags, intended for a tool result or data message, never for instructions. Operational items are labelled and rendered in a separate section.
- **Metering.** Query embeddings run through `delegation.meter(p, estimate, embed)`. A per-owner query-embedding cache holds only query text. Vectors carry their embedding model, and mismatched vectors are skipped.

### Ordering and errors

`pin` must be a Run's first knowledge call; otherwise `retrieve({ runId })` returns `run_unpinned`. Results are ordered by score descending, then (sourceId, span). Facts break ties in the order Correction, entry, extraction.

Domain outcomes are values. A thrown error means one of two things:

- **An infrastructure fault** (`KnowledgeUnavailable`). It is safe to retry, because reads are idempotent apart from a settled meter.
- **A programmer error** (`InvalidQueryError`, `ScopeMismatchError`). Do not retry.

If `meter` cannot tell whether an embedding call finished, the reservation stays held, as `delegation` defines.

## What the implementation hides

- **Scope resolution:** from a Principal to its owner and to the Chat, Run, or Responsibility selection. Pinned revisions are stored as rows (selected IDs plus a Fact-sequence cutoff), and liveness is rechecked against deleted Sources and Disconnected Connections.
- **Retrieval strategies (internal seam):** exact filtered pgvector first (`WHERE owner AND source_id = ANY($live) … ORDER BY embedding <=> $q LIMIT k`, with filter columns indexed). Later options: keyword (`tsvector`), hybrid via reciprocal-rank fusion, a metered reranker, and HNSW with `hnsw.iterative_scan` plus an exact fallback when results run short. `truncated` reports reduced recall. Strategy settings are internal Responsibility configuration and are not exposed to the model initially.
- **Source-kind profiles (internal seam):** chunking, location anchors and display, and whether a kind is course material or operational. A new Source type means adding one profile.
- **Crypto-shredding consistency (ADR-0007):** chunk text, summaries, and cached rendered blocks are encrypted under the Source's own data key and decrypted only after scope filtering. Embedding rows are deleted with the key, in the same transaction.
- **Correction merge and disagreement detection,** and mapping Facts to passages by location.
- **Rendering:** nonce fences, section labels, ref numbering, the score floor, and deduplication of overlapping chunks.

## Seams and adapters

| Dependency | Category | Seam | Adapters |
|---|---|---|---|
| Postgres + pgvector (Prisma 7, raw SQL for vectors) | Local-substitutable | Internal only | Real Postgres; Testcontainers with the pgvector image |
| Embedding provider | True external | **Real port** (`Embedder`) | Provider adapter; deterministic fake (hash-seeded vectors, scripted failure and hang) |
| `delegation` | In-process | None; the real module is used | Real `createDelegation` on the same test database |
| Clock | In-process | Small | System clock; manual clock |

Rejected as hypothetical seams: a vector-store port, a reranker port before a reranker exists, and a cache port. The parser and the write side of `knowledge` are not dependencies of the read side; tests seed data through the write side's interface, never with raw SQL.

## Testing

All tests cross `pin`, `retrieve`, and `cite`. Scenarios:

- **Scope:**
  - An empty scope returns nothing and makes no embed or meter call.
  - A foreign owner's ID or a deselected Course in `narrow` returns nothing.
  - A Run Principal cannot widen; a student Principal can.
  - Planning scope is refused for passages.
- **Snapshots:** a Source added after `pin` is invisible to the Run and visible to the Chat.
- **Deletion:**
  - Deleting a Source mid-Run removes its passages, Facts, summaries, and cached blocks on the next call.
  - `cite()` returns `"gone"`.
  - A Disconnect removes operational items and keeps imported Sources.
- **Corrections:** a Correction beats re-extraction, and a newer conflicting Source appears in `disagreement`.
- **Untrusted text:**
  - An injection string in a passage stays inside the fence.
  - `String(item.text)` returns `"[untrusted]"`.
  - Operational items never appear in the course-material section.
- **Metering:**
  - An exhausted Budget gives `budget_exhausted` with zero embed calls.
  - A Fact query without text never calls `meter`.
  - A mismatched embedding model is skipped.
- **Strategy parity:** whenever an approximate or hybrid strategy is enabled, it runs the same scenarios as the exact path. Results must stay in scope, and recall is measured against the exact path.
- **Per-profile contract suite:** location anchors round-trip, and display text is non-empty.

## Phase 7 decisions

- **Runs wait for Phase 9.** `ScopeRef` is `{ chatId }` or `{ planning: true }`, both read only by a student; a Run Principal gets `ScopeMismatchError`. `pin`, snapshots, widening and the `run_unpinned` refusal arrive with Runs and Run Principals. Budgets are likewise a Phase 9 concept, so the only usage refusals are `meter`'s.
- **Errors.** `retrieve` and `cite` throw `InvalidQueryError` and `ScopeMismatchError` for programmer errors; any other fault (database, embedding provider) becomes `KnowledgeUnavailable` with its cause.
- **Chats live in `knowledge`.** `createChats` stores the selection (`chat_course`, `chat_source`) and messages, whose citations are `[{ tag, cite }]` only, and owns the ask flow: retrieve, meter the answer, record. Creating a Chat refuses a selection with a foreign or deleted Source or Course as `gone`.
- **Encrypted answers (ADR-0007).** An answer is encrypted under its own key, which is wrapped in turn under the key of every Source whose passages the answer was given (`derivedFrom`). Deleting any of those Sources shreds it: the message reads back with `text: null`, and its citations as gone. A question, or an answer drawn from no Source, holds no course material and is stored as plain text.
- **Selection.** Passages come from the selected live Sources and every live Source of a selected Course. Facts come from selected Courses only, so a Source-only selection yields passages, never Facts. `narrow` takes `courseIds` and `sourceIds`; Projects arrive in Phase 8. Every statement also names the owner, with RLS as the second defence.
- **`revision`** is a digest of the live Source IDs in scope and the embedding model for passages, and of the reviewed values for Facts. **`truncated`** is true when the limit cut off further passages above the floor.
- **Channels.** Every Item carries `channel`; all Phase 7 items are `course_material`, and `render()` writes one fenced section per channel, so operational items (with Connections) never join course material.
- **Facts** reuse the write side's review merge, so a Correction or entry is the shown value and a newer Source's differing value is `disagreement`. Rejected items and Courses are excluded. Ties break Correction, entry, extraction. A `text` filter over Facts is not implemented (Facts carry no embeddings), so Fact queries never meter. Correction Provenance is `{ kind: "correction" }`: Corrections carry no separate ID or timestamp yet.
- **Planning scope** accepts `obligation`, `course_rule` and `topic`; `fixed_event` arrives with Fixed Events in Phase 8. Anything else throws `InvalidQueryError`.
- **Chat answers** use passages only: Facts and passages each number their own `[S1]` tags, and combining them is deferred. The answer model (Sonnet 5.5, task `explanation`) gets the rendered block as a separate user message; citation tags it was not given are removed.
- **Query-embedding cache.** `query_embedding` holds, per student and model, the SHA-256 of the whitespace-normalised question and its vector, never course material. A repeated question is neither embedded nor metered. Entries have no expiry and go with the student's account.
- **The `Embedder` port** is the one in `@nunio/ai`, shared with ingestion. It carries the model's `relevanceFloor`, since cosine scales differ by model.
- **Relevance floor.** `baai/bge-m3` uses 0.45, calibrated by the Phase 7 eval: off-topic questions top out near 0.34 and the lowest relevant hit scored 0.474, so 0.45 drops off-topic questions without losing recall on the set. Study questions a document cannot answer still score up to 0.58, so the floor alone does not signal "nothing relevant"; the answer model's instruction to say so remains the main guard.

## Accepted limits

- A Run can see its context shrink mid-task, because removals apply live.
- The same question can return different results in a Chat and in a Run started from it, because only Runs pin.
- Exact scans grow linearly with each student's scoped chunks. That is acceptable at pilot scale; an approximate index waits for measured need and the parity suite.
- `render()` fixes one prompt-fencing convention inside `knowledge`. Callers needing another layout build it from `items` and must not reach inside `Untrusted`, which a lint rule enforces.
- An answer is withdrawn when any Source it was given is deleted, even one it did not cite.
- Template-heavy documents such as module handbooks retrieve poorly when the module name is not in the chunk that holds the answer (Phase 7 eval). Prefixing chunks with their Source title and section, or a keyword strategy, are the candidates.
- Deleted Sources remain recoverable from database backups only until Neon's point-in-time recovery window ends (see ADR-0007).
