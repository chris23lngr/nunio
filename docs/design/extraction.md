# Extraction and review

Status: accepted design, 2026-11-02. Not yet implemented. Domain terms follow [GLOSSARY.md](../../GLOSSARY.md). Architecture terms (module, interface, seam, adapter, depth) follow the codebase-design vocabulary. Related: [knowledge-retrieval.md](knowledge-retrieval.md) (the read side of the same tables), ADR-0007, ADR-0011, ADR-0012, Phase 6 in the [implementation plan](../implementation-plan.md).

## Purpose

The write side of Facts in the `knowledge` package. It turns a ready Source into Courses, Obligations, Topics, course rules, and exam logistics, each with Provenance and uncertainty. It lets the student confirm, correct, or reject each item, and merges later extractions without ever overwriting a Correction. It delivers the brief's first-use value: a reviewable result within ten minutes of uploading.

## Delivery

One phase branch, one PR per slice, in this order:

1. Extraction and the review screen, with timing instrumentation.
2. Correction handling and re-uploads.
3. Manual Obligation entry.

Projects move to Phase 8. Phase 6 is verified only after every slice and the eval.

## Interface

```ts
// packages/knowledge
export function createFacts(deps: {
  db: PrismaClient;          // local-substitutable; internal seam
  keys: SourceKeys;          // unwraps the Source key for extracted values
  clock: Clock;              // in-process; injected
}): Facts;

export interface Facts {
  extract(p: Principal, sourceId: string, deps: { extractor: Extractor; delegation: Delegation; signal: AbortSignal }):
    Promise<{ status: "done"; dropped: number } | { status: "failed" | "stopped" }>;
  review(p: Principal): Promise<Review>;                  // grouped by Course, decrypted server-side
  confirm(p: Principal, item: ItemRef): Promise<void>;
  correct(p: Principal, item: ItemRef, value: unknown): Promise<void>;   // validated per type
  reject(p: Principal, item: ItemRef): Promise<void>;
  resolve(p: Principal, item: ItemRef, choice: "keep_mine" | "use_new"): Promise<void>;
  decideCourse(p: Principal, courseId: string, decision: "accept" | "reject"): Promise<void>;
  mergeCourses(p: Principal, into: string, from: string): Promise<void>;
  enterObligation(p: Principal, input: ObligationInput): Promise<string>;  // Provenance `entry`
}

// packages/ai, next to createScanReader
export interface Extractor {
  model: string;
  estimateMicroUsd(window: Window): number;
  extract(window: Window, opts: { signal: AbortSignal }): Promise<{ items: ExtractedItem[]; usage: Usage }>;
}
```

The worker calls `facts.extract(...)` from its own Activity, the same way it calls `sources.ingest(...)`. The API's review routes go through `facts` only.

## Pipeline

- **Placement.** Extraction is a second Activity in the `ingestSource` workflow. It runs after the chunks commit and has a single attempt, because a model call may already have been charged. The Source keeps its own status: `extraction` is `pending | running | done | failed`. A failed extraction leaves the Source `ready` and searchable.
- **Re-extraction** is started only by the student, never automatically, and is metered again.
- **Model.** Haiku 5.5 via `meter`, with `Output.object` structured output (`response_format: json_schema`, no forced tool). The schema contains no personal data.
- **Windows.** Page text is split into overlapping page windows of about 30k tokens, each metered separately. Results are merged within the Source before anything is stored.
- **Untrusted text.** Page text goes in the user message as a nonce-fenced data block, never in the system prompt.
- **All or nothing.** If any window fails, including when the Allowance runs out part-way, extraction ends `failed` and stores no partial Facts.
- **Grounding.** Every item must carry a page and a verbatim quote. The worker checks the quote against that page's text after normalizing whitespace and hyphenation. Items that fail are dropped and counted, never stored with low confidence. This is how "never invent Obligations" is enforced.

## Data

- `course` and `obligation` have their own tables, because planning needs real columns. `topic`, `course_rule`, and `exam_logistics` share one `fact` table with a `type` and a value validated per type.
- Every extracted row carries Provenance (Source, page, quote) and `uncertainty`: a nullable short reason. The model supplies reasons ("only 'end of semester' given"); the worker adds its own ("deadline unresolved", "time zone assumed"). There is no numeric confidence.
- **Encryption.** Extracted wording is encrypted under the Source's key (ADR-0007): titles, original deadline wording, `destinationText`, quotes, uncertainty, and Fact values. Structure stays plain so planning can query it and matching works across Sources: kind, `due` date and time, Course link, page, review state, and the normalized match key. Extracted rows are deleted with their Source in the same transaction, so the encryption protects backups. Course names, Corrections, and manual entries are plain rows under row-level security.
- **Obligation fields:**
  - `kind`: `exam | assignment | presentation | thesis | registration | other`. Exam registration is an Obligation.
  - `title`.
  - `due`: a date and optional time, in `Europe/Berlin` unless the Source says otherwise, plus the original wording. Relative or unresolvable deadlines ("week 5") store `due = null` with an uncertainty reason for the student to fill in. Recurring items are expanded only when the Source gives concrete dates; Phase 6 never infers term calendars.
  - `destinationText`: stored only when the Source states it, and always unverified. There is no Destination entity before connectors exist.
- An exam's date is its `exam` Obligation. `exam_logistics` holds room, duration, allowed aids, and format. `course_rule` is free text, such as "50% of problem sets required for exam admission".

## Identity and merging

- **Courses** are `proposed | accepted | rejected`. Extraction proposes them; the student accepts or rejects. Items under a rejected Course are hidden. A Source links to any number of Courses (one syllabus can cover a lecture and tutorial, a Modulhandbuch many modules).
- **Course matching** uses the normalized module code first, then the normalized title. An unclear match becomes a new proposed Course, never an automatic merge. The student can merge Courses by hand.
- **Fact matching** requires the same Course, the same type, and the same key. The model suggests the key and the worker normalizes it: kind plus title or number for Obligations ("Übungsblatt 3", "Klausur"), the field for logistics (`exam.room`), the normalized name for Topics. The model never decides that two items are the same.
  - Same key, different value: a disagreement.
  - No match: a new item. A missed match costs at most a duplicate the student rejects, which is safer than a wrong merge that hides a change.

## Review

- Every extracted item starts `unreviewed`. The student can:
  - **Confirm** → `confirmed`.
  - **Correct** → a Correction row holds the student's value; the item's Provenance becomes the Correction.
  - **Reject** → `rejected`. The key stays suppressed in later extractions.
- **A Correction always wins.** When a newer Source disagrees, both values are shown with a flag. **Keep mine** clears the flag until the extracted value changes again. **Use the new value** retires the Correction, and the item follows extraction again. Nothing resolves automatically, including by recency.
- **Re-extraction** replaces the Source's extracted rows in one transaction. Corrections and rejections are reapplied by key. Review states carry over when key and value are unchanged; a changed value returns to `unreviewed`.
- **Source deletion** removes its extracted rows and rejections tied only to it. Corrections stay as standalone Facts with Correction Provenance, and the review screen notes that the original Source is gone.
- **Manual Obligations** require a Course, either accepted or created in the same form. Their Provenance is `entry`, and they are edited directly, without a Correction.
- **Downstream** (Phase 8) sees `unreviewed` and `confirmed` items, with unreviewed ones marked.
- **Review screen** (`web`): grouped by Course, with each item's decrypted quote, page, and Source title, and the Confirm, Correct, and Reject actions. Proposed Courses are accepted or rejected there too. An inline PDF viewer is deferred.

## Timing

The Source records its upload request time (`createdAt`) and its extraction completion time. "Time to a reviewable result" is the difference. Staging logs it; the checklist number comes from the eval harness.

## Seams and adapters

| Dependency | Category | Seam | Adapters |
|---|---|---|---|
| Postgres (Prisma 7) | Local-substitutable | Internal only | Testcontainers with the pgvector image |
| Extraction model | True external | **Real port** (`Extractor`) | OpenRouter adapter; scripted fake |
| `delegation` | In-process | None; the real module is used | Real `createDelegation` on the same test database |
| Clock | In-process | Small | System clock; manual clock |

## Testing

All tests cross the `facts` interface, with the scripted `Extractor`. Scenarios:

- An ungrounded item is dropped and counted.
- Course matching: code, then title; an unclear match never auto-merges.
- A Correction survives re-uploading a conflicting Source, and the disagreement is flagged.
- A rejection survives a re-upload.
- Deleting a Source keeps its Corrections.
- Re-extraction carries review states over, and a changed value returns to `unreviewed`.
- Allowance exhaustion part-way ends `failed` with no partial Facts.
- Row-level security refuses a foreign owner.

Also:

- A worker workflow test: extraction runs after ingestion, and an extraction failure leaves the Source `ready`.
- The real adapter is tested against a recorded response, including the injection case. CI makes no live model calls.

## Eval

- **Set:** 10–15 public German and English syllabi and module handbooks, plus synthetic scans and one syllabus with injection instructions. Hand-labelled expected Obligations and deadlines live in the repo as JSON. PDFs are committed only when their licence allows it, otherwise fetched by URL. No real student material.
- **Harness:** runs each document through the real pipeline (local parser container, real OpenRouter). It records precision and recall for Obligations and deadlines, the grounding drop rate, cost and time per document, and the median time from upload to extraction done, in `docs/operations/`.
- **Models:** Haiku 5.5 first. Sonnet 5.5 is compared only if Haiku misses the founder's thresholds, which are set after the first run.
- **Injection:** the injection document passes only if its output matches its labels exactly and no extra item survives grounding.

## Accepted limits

- A key mismatch across Sources produces a duplicate rather than a disagreement. The student rejects it.
- A whole extraction fails if one window fails, so a large Source near the Allowance limit may need the founder to increase the Allowance before re-extracting.
- `Europe/Berlin` is assumed when a Source gives no time zone, and the uncertainty says so.
- The review screen shows quotes, not the rendered PDF page.
