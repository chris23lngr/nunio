# Extraction and review

Status: accepted design, 2026-11-02; slice 2 decisions added 2026-11-03. All slices are implemented and the eval passed the founder's thresholds, 2026-11-08. Domain terms follow [GLOSSARY.md](../../GLOSSARY.md). Architecture terms (module, interface, seam, adapter, depth) follow the codebase-design vocabulary. Related: [knowledge-retrieval.md](knowledge-retrieval.md) (the read side of the same tables), ADR-0007, ADR-0011, ADR-0012, Phase 6 in the [implementation plan](../implementation-plan.md).

## Purpose

The write side of Facts in the `knowledge` package. It turns a ready Source into Courses, Obligations, Topics, course rules, and exam logistics, each with Provenance and uncertainty. It lets the student confirm, correct, or reject each item, and merges later extractions without ever overwriting a Correction. It delivers the brief's first-use value: a reviewable result within ten minutes of uploading.

## Delivery

One phase branch, one PR per slice, in this order:

1. Extraction and the review screen, with timing instrumentation.
2. Correction handling and re-uploads, in three PRs: (i) review items, Corrections, Disagreements and deletion; (ii) re-extraction; (iii) merging Courses.
3. Manual Obligation entry.

Projects move to Phase 8. Phase 6 is verified only after every slice and the eval.

## Interface

```ts
// packages/knowledge
export function createFacts(deps: {
  db: PrismaClient; // local-substitutable; internal seam
  keys: SourceKeys; // unwraps the Source key for extracted values
  clock: Clock; // in-process; injected
}): Facts;

export interface Facts {
  extract(
    p: Principal,
    sourceId: string,
    deps: { extractor: Extractor; delegation: Delegation; signal: AbortSignal },
  ): Promise<
    { status: "done"; dropped: number } | { status: "failed" | "stopped" }
  >;
  review(p: Principal): Promise<Review>; // grouped by Course, decrypted server-side
  confirm(p: Principal, item: ItemRef): Promise<void>;
  correct(p: Principal, item: ItemRef, value: Correction): Promise<void>; // validated per type
  reject(p: Principal, item: ItemRef): Promise<void>;
  restore(p: Principal, item: ItemRef): Promise<void>; // undoes Reject
  use(p: Principal, item: ItemRef, extractionId: string): Promise<void>; // "Use this"; also Use new
  keepMine(p: Principal, item: ItemRef): Promise<void>;
  decideCourse(
    p: Principal,
    courseId: string,
    decision: "accept" | "reject" | "restore",
  ): Promise<void>;
  mergeCourses(p: Principal, from: string, into: string): Promise<void>; // 409 on differing Corrections
  changeCourse(
    p: Principal,
    sourceId: string,
    course: CourseChoice,
  ): Promise<void>; // Kurs ändern; 409 while running
  enterObligation(p: Principal, input: ObligationInput): Promise<string>; // Provenance `entry`; 409 on an existing key
}

// packages/ai, next to createScanReader
export interface Extractor {
  model: string;
  estimateMicroUsd(window: Window): number;
  extract(
    window: Window,
    opts: { signal: AbortSignal; context?: ExtractionContext },
  ): Promise<{ items: ExtractedItem[]; usage: Usage }>;
}
```

The worker calls `facts.extract(...)` from its own Activity, the same way it calls `sources.ingest(...)`. The API's review routes go through `facts` only.

## Pipeline

- **Placement.** Extraction is a second Activity in the `ingestSource` workflow. It runs after the chunks commit and has a single attempt, because a model call may already have been charged. The Source keeps its own status: `extraction` is `pending | running | done | failed`. A failed extraction leaves the Source `ready` and searchable.
- **Re-extraction** is started only by the student, never automatically, and is metered again: "Read again" on a ready Source whose extraction is done or failed calls `POST /api/me/sources/{id}/extract`, which starts the `extractSource` workflow (ID `extractSource/{sourceId}`, the same single-attempt Activity). It is refused while extraction runs (409) and for a Source that is not ready or is deleted (404). Asking again while it is still pending only re-dispatches the workflow, so a failed workflow start never strands the Source.
- **Model.** Haiku 5.5 via `meter`, with `Output.object` structured output (`response_format: json_schema`, no forced tool). The schema contains no personal data.
- **Windows.** Page text is split into overlapping page windows of about 30k tokens, each metered separately. Results are merged within the Source before anything is stored.
- **Untrusted text.** Source title and current-Semester candidate Course IDs, titles and codes go in a separate nonce-fenced context block. Both blocks are untrusted user data; none enters the system prompt or schema. Page text goes in the user message as a nonce-fenced data block, never in the system prompt.
- **All or nothing.** If any window fails, including when the Allowance runs out part-way, extraction ends `failed` and stores no partial Facts.
- **Grounding.** Except a validated existing Course selection (ADR-0017), every item must carry a page and a verbatim quote. The worker checks the quote against that page's text after normalizing whitespace and hyphenation. Items that fail are dropped and counted, never stored with low confidence. This is how "never invent Obligations" is enforced.
- **Figures** (2026-11-11). Ingestion renders every page as a JPEG (1568 px long edge, quality 80), because slide decks carry most of their content in figures next to a short text layer. Haiku 5.5 (task `scan`, 8k output budget) reads each page image, up to four at once, each through `meter`. For a page with a text layer, that text goes along as a nonce-fenced data block and the model returns only text the layer lacks plus figure lines; for a page without one, it transcribes everything plus figure lines. Each figure, diagram, chart, formula or illustration is described by its content on one line starting exactly with `[Abbildung] `. `@nunio/ai` owns that marker (`figureMarker`, `isFigureLine`); both prompts and grounding use it. The reservation is the image's tokens (width × height / 750) plus a quarter, the prompt and text layer, and the full scan output budget. Reasoning is off for the scan task, so the whole budget goes to the reading.
- **Page retries** (2026-11-12). A page whose reading fails transiently (a 429, 408 or 5xx, a lost connection, a timeout) or comes back truncated is read again up to twice, after 1 s and 3 s, each attempt its own metered call. A truncated reading returns its usage, so `meter` settles it instead of holding it. Other rejections, a `meter` refusal such as an exhausted Allowance, and a cancelled or deleted Source are not retried. Once a page's retries are exhausted, no further page starts and the Source fails.
- **Grounding in figure lines.** A quote found only in an `[Abbildung]` line is the model's reading, not the page's own words. Topics, course rules, exam logistics and AI-use Rules grounded this way are kept with the uncertainty "aus einer Abbildungsbeschreibung abgeleitet", joined to any other reason, for display. The extraction also stores the plain grounding class `figure` (otherwise `text`), which review shows on each citation; code decides by that class, never by the wording. Obligations and Courses grounded this way are dropped and counted.

## Data

- `course` and `obligation` have their own tables, because planning needs real columns. `topic`, `course_rule`, and `exam_logistics` share one `fact` table with a `type` and a value validated per type.
- **Items and extractions** (slice 2). `obligation` and `fact` are review items: one per Course and key, holding the review state, an optional Correction in plain columns, and `unsupported` when a corrected item lost its last extraction. Each Source's reading of an item is a row in `obligation_extraction` or `fact_extraction`, with its page, encrypted wording, plain due fields for Obligations, and `overruledAt`. Slice 1's per-Source rows were rebuilt, since only staging test data existed.
- **Value.** An Obligation's value is its due date, time, and time zone; changed wording alone is not a different value. A Fact's value is its normalized text. One Source repeating a value yields one extraction, cited on its lowest page; differing values from one Source stay separate.
- Every extracted row carries Provenance (Source, page, quote) and `uncertainty`: a nullable short reason. The model supplies reasons ("only 'end of semester' given"); the worker adds its own ("deadline unresolved", "time zone assumed"). There is no numeric confidence.
- **Encryption.** Extracted wording is encrypted under the Source's key (ADR-0007): titles, original deadline wording, `destinationText`, quotes, uncertainty, and Fact values. Structure stays plain so planning can query it and matching works across Sources: kind, `due` date and time, Course link, page, a Fact extraction's grounding class, review state, and the normalized match key. Extracted rows are deleted with their Source in the same transaction, so the encryption protects backups. Course names, Corrections, and manual entries are plain rows under row-level security.
- **Obligation fields:**
  - `kind`: `exam | assignment | presentation | thesis | registration | other`. Exam registration is an Obligation.
  - `title`.
  - `due`: a date and optional time, in `Europe/Berlin` unless the Source says otherwise, plus the original wording. Relative or unresolvable deadlines ("week 5") store `due = null` with an uncertainty reason for the student to fill in. Recurring items are expanded only when the Source gives concrete dates; Phase 6 never infers term calendars.
  - `destinationText`: stored only when the Source states it, and always unverified. There is no Destination entity before connectors exist.
- An exam's date is its `exam` Obligation. `exam_logistics` holds room, duration, allowed aids, and format. `course_rule` is free text, such as "50% of problem sets required for exam admission".

## Identity and merging

- **Courses** are `proposed | accepted | rejected`. Extraction proposes them; the student accepts or rejects. Items under a rejected Course are hidden. A Source links to any number of Courses (one syllabus can cover a lecture and tutorial, a Modulhandbuch many modules).
- **A Course chosen at upload** (2026-11-11). An upload offers an accepted, unarchived Course, a new Course, or "Automatisch erkennen", the default; one choice applies to every file of the upload. A new Course needs a title and takes an optional code, and like a Course created by hand is refused (409, `clash`, naming the other Course) when another Course has its code or title. It is created accepted in the current Semester, as manual entry creates one, once per upload: the first file's request creates it and the others name it by id. The choice is stored as `source.courseId` and is binding: extraction puts every Obligation and Fact of that Source under the chosen Course, following a merge to its target, ignores the Courses the model found, proposes none, and drops no item whose Course name matches nothing. Without a chosen Course, the automatic assignment below applies; for a bound Source the model is given no Courses to pick from. Deleting the Course clears `courseId`, so the Source stays and is read automatically next time (ADR-0015); rejecting it does the same, and restoring it binds nothing again; merging moves it to the target with the Course's other Sources. The chat attach menu always reads automatically.
- **Automatic Course assignment** ([ADR-0017](../adr/0017-the-model-may-assign-a-source-to-an-existing-course.md)): when no Course is bound, the model sees the Source file name and the student's accepted or proposed, unarchived, unmerged Courses in the current Semester. It may pick one by ID without quoting its name. The server checks that ID against the supplied list and rechecks eligibility at commit time. Items reference the picked ID within this Source's course list. An unknown ID has no authority and is treated as a new proposal needing grounding. Bound Courses bypass this path. The model never merges two existing Courses.
- **Course matching for grounded proposals** uses the normalized module code first, then the normalized title. An unclear match becomes a new proposed Course, never an automatic merge. The student can merge Courses by hand.
- **Fact matching** requires the same Course, the same type, and the same key. The model suggests the key and the worker normalizes it: kind plus title or number for Obligations ("Übungsblatt 3", "Klausur"), the field for logistics (`exam.room`), the normalized name for Topics. The model does not decide Fact identity; ADR-0017 permits recognizing an existing Course for a Source.
  - Same key, different value: a disagreement.
  - No match: a new item. A missed match costs at most a duplicate the student rejects, which is safer than a wrong merge that hides a change.

## Review

- Every extracted item starts `unreviewed`. The student can:
  - **Confirm** → `confirmed`.
  - **Correct** → the Correction holds the student's value: title, deadline, and destination for an Obligation, the value for a Fact. Kind and key are the item's identity and never change; a wrongly typed item is rejected and entered by hand. A Correction is validated like extraction (real date, `HH:MM`, IANA time zone, a time needs a date; the date may be cleared), confirms the item, overrules the values its Sources give now, and replaces the extracted uncertainty. Its Provenance is the Correction.
  - **Reject** → `rejected`. The key stays suppressed in later extractions, whatever value they bring. Rejected items are folded per Course with **Restore**, which returns them to `unreviewed`; rejected Courses likewise return to proposed.
- **Disagreement.** An item shows each distinct value with its citations. Values that are not overruled and differ from each other, or from the Correction, flag the item.
  - **Use this** on a value confirms the item with it, retires any Correction, and overrules every other value. Use new is Use this.
  - **Keep mine** keeps the Correction and overrules the values that differ from it.
  - A value another Source repeats stays overruled; only a value no extraction had yet flags the item again. Nothing resolves automatically, including by recency.
- **A new Source with a different value** returns a confirmed item without a Correction to `unreviewed`. A corrected item keeps its state and is only flagged. A rejected item stays rejected.
- **Re-extraction** replaces the Source's extractions in its final transaction, so a failure leaves the previous ones. Overrule marks carry over by value, and a changed value without a Correction returns the item to `unreviewed`.
- **No extraction left.** After Source deletion or re-extraction, an item no extraction supports is deleted, including a rejection tied only to it. A corrected item stays, marked `source_deleted` or `not_found`. Unaccepted Courses with no Source and no item go with them.
- **Merging Courses.** "Merge into…" moves Source links and items, combining items with the same key and pooling their extractions. The target's state and Correction win; a Correction only the merged Course has moves. Two differing Corrections for one key refuse the merge (409). The merged Course stays as a `merged` pointer, so a later Source naming it lands in the target, which the merge accepts.
- **Kurs ändern** on a ready Source's page sets another Course, a new one, or "Automatisch erkennen", and starts the same re-extraction as "Read again" (`POST /api/me/sources/{id}/course`): it is metered again, refused while extraction runs (409), and replaces the Source's extractions only once it is done. If the reading cannot be started, the change stands and the API says so (503, `not_started`); the Source waits as pending, and the Source page offers "Lesen starten", which asks to extract it again. The upload form switches to a Course it created, and a retry after a part-way failure skips the files already uploaded.
- **Merge suggestions.** Review suggests merging two of the student's Courses in one Semester, neither rejected nor merged, when their codes match once case, whitespace and punctuation are ignored, or their titles' trigram similarity (computed like pg_trgm in the `knowledge` package, since the database has no pg_trgm) exceeds 0.6. Roman numerals count as digits, so "Analysis I" and "Analysis 1" are alike, and titles numbered differently, such as Analysis I and II, never are. No model is asked. The suggestion merges a proposal into the accepted Course, otherwise the newer into the older. "Zusammenführen" uses Merge Courses; "Nein, verschieden" stores the pair, which is never suggested again.
- **Manual Obligations** (slice 3) require a Course, either accepted or created and accepted in the same form (`POST /api/me/obligations`). An entry is an ordinary item with `enteredAt` set: confirmed, Provenance `entry`, its values in the Correction columns and validated the same way. Its key is its kind plus its normalized title; a key the Course already has is refused (409), so the student corrects that item instead. A later Source with the same key attaches like it would to a corrected item: a differing deadline is flagged, Keep mine keeps the entry, and Use this turns it into an extracted item. Correct edits it in place; Reject and Restore work as for any item. Only Obligations are entered by hand.
- **Downstream** (Phase 8) sees `unreviewed` and `confirmed` items, with unreviewed ones marked. How planning treats an unresolved Disagreement is decided there.
- **Review screen** (`web`): grouped by Course, with each item's decrypted quotes, pages, and Source titles, and the Confirm, Correct, Reject, Use this, and Keep mine actions. Proposed Courses are accepted or rejected there too, and their items stay folded until accepted, so a module handbook's many proposals stay quick to decide. An inline PDF viewer is deferred.

## Timing

The Source records its upload request time (`createdAt`) and its extraction completion time. "Time to a reviewable result" is the difference. Staging logs it; the checklist number comes from the eval harness. A re-extraction is timed from `extractionRequestedAt` instead and logged as `reextractionMs`, so it never counts towards time to a reviewable result.

## Seams and adapters

| Dependency          | Category            | Seam                          | Adapters                                          |
| ------------------- | ------------------- | ----------------------------- | ------------------------------------------------- |
| Postgres (Prisma 7) | Local-substitutable | Internal only                 | Testcontainers with the pgvector image            |
| Extraction model    | True external       | **Real port** (`Extractor`)   | OpenRouter adapter; scripted fake                 |
| `delegation`        | In-process          | None; the real module is used | Real `createDelegation` on the same test database |
| Clock               | In-process          | Small                         | System clock; manual clock                        |

## Testing

All tests cross the `facts` interface, with the scripted `Extractor`. Scenarios:

- An ungrounded item is dropped and counted.
- A quote found only in a figure description keeps a Fact with an uncertainty and drops an Obligation or Course.
- Course matching: code, then title; an unclear match never auto-merges.
- A Source with a chosen Course puts everything there, proposes no Course and drops nothing for an unknown name; Kurs ändern moves its items there once the new reading is done.
- Merge suggestions: the similarity rule's threshold is fixed by unit tests of alike and distinct title pairs; "Nein, verschieden" holds.
- Sources that agree form one item; a disagreeing Source flags it and returns a confirmed item to review.
- Use this resolves a Disagreement until a Source brings a value not seen before.
- A Correction survives re-uploading a conflicting Source, and the Disagreement is flagged until Keep mine or Use this.
- A rejection survives a re-upload until Restore.
- Deleting a Source keeps its Corrections and drops items and rejections only it supported.
- Re-extraction carries review states over, and a changed value returns to `unreviewed`.
- Allowance exhaustion part-way ends `failed` with no partial Facts.
- Row-level security refuses a foreign owner.

Also:

- A worker workflow test: extraction runs after ingestion, and an extraction failure leaves the Source `ready`.
- The real adapter is tested against a recorded response, including the injection case. CI makes no live model calls.

## Prompt for teaching material

One extended Haiku 5.5 prompt handles syllabi, handbooks, slides and lecture notes without a classification call. For teaching material it asks for roughly 5–20 distinct concrete Topics per deck, such as “gleichmäßige Konvergenz”, excluding outline headings like “Einleitung”. Lines beginning exactly with `[Abbildung] ` are figure descriptions written by another model. Topics and other Facts may cite them; Obligations, deadlines and Course names must not rely on them.

## Eval

- **Course recognition extension:** three licensed German/English slide decks (one fixed excerpt), fetched by URL with SHA-256 verification and attribution in `set.json`. Expected assignments are draft, not yet spot-checked by founder. The draft Topic aliases were discarded; the founder labels Topics blind ([topic-quality.md](topic-quality.md)). Topic precision/recall uses Sonnet 5.5 semantic judgements within the expected Course, scored one-to-one with duplicates counted against precision. Optional labels do not count as misses, and their matches are excluded from the precision denominator; required figure-only Topics have separate recall. Per-deck decisions and judge cost are recorded. The offline `apps/worker/evals/extraction/calibration.ts report.json checklist.md [seed]` script writes a deterministic 50-decision German checklist, stratified by matched/unmatched decisions and spread across decks. Two NLP decks run sequentially for one student and must yield one Course. Results live in `docs/operations/course-recognition-extraction-eval.json`. The first single-pass run kept both NLP decks in one Course at USD 0.039599 total, but the German excerpt hit the parser decompressed-size ceiling. Its aggregate Topic scores are invalid because the initial scorer confused repeated values; the scorer now recovers keys by page/quote Provenance and records keys for future rescoring. No second live run was made. The bound-course scenario remains open until that parallel change lands. These new metrics have no merge threshold; the founder sets thresholds after the first run.
- **Set:** 10–15 public German and English syllabi and module handbooks, plus synthetic scans and one syllabus with injection instructions. Hand-labelled expected Obligations and deadlines live in the repo as JSON. PDFs are committed only when their licence allows it, otherwise fetched by URL. No real student material.
- **Harness:** runs each document through the real pipeline (local parser container, real OpenRouter). It records precision and recall for Obligations and deadlines, the grounding drop rate, cost and time per document, and the median time from upload to extraction done, in `docs/operations/`.
- **Models:** Haiku 5.5 first. Sonnet 5.5 is compared only if Haiku misses the founder's thresholds, which are set after the first run.
- **Thresholds** (set 2026-11-08): Obligations precision ≥ 0.95 and recall ≥ 0.85; deadlines precision ≥ 0.95 and recall ≥ 0.90; no invented dates; median time to a reviewable result ≤ 10 minutes. Haiku 5.5 meets all of them, so Sonnet 5.5 was not compared.
- **Injection:** the injection document passes only if its output matches its labels exactly and no extra item survives grounding.

## Accepted limits

- One of 21 eval runs (`wwu-bwl-excerpt`, run 1) failed at ingestion, so extraction never ran; its other runs reached Obligation recall 1.0 and 0.83. The harness lists it under `failedExtractions` and counts it as recall 0.
- A key mismatch across Sources produces a duplicate rather than a disagreement. The student rejects it.
- A whole extraction fails if one window fails, so a large Source near the Allowance limit may need the founder to increase the Allowance before re-extracting.
- `Europe/Berlin` is assumed when a Source gives no time zone, and the uncertainty says so.
- The review screen shows quotes, not the rendered PDF page.
- Every page is read by the scan model, so a 100-page deck costs up to 100 metered image calls, and up to 300 if every page needs both retries. Sources ingested before figures were read are not re-read; the student uploads them again.
