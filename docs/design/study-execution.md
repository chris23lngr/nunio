# Study execution

Status: proposed design, 2026-11-10, for Phase 11 of the [implementation plan](../implementation-plan.md). Domain terms follow [GLOSSARY.md](../../GLOSSARY.md) (Artifact, Own Work, Critique, AI-use Rule, Practice Item, Attempt, Feedback, Self-assessment, Evidence, Understanding Level, Handoff, Reported as Submitted). Architecture terms (module, interface, seam, adapter, depth) follow the codebase-design vocabulary. Related decisions: ADR-0001, ADR-0002, ADR-0006, ADR-0007. Builds on [knowledge-retrieval.md](knowledge-retrieval.md) (Run snapshots, encrypted derived text) and [delegation-gate.md](delegation-gate.md) (`meter`, Runs).

## Purpose

Phase 11 adds two modules and extends two existing ones. Each piece of behaviour lives where its knowledge already is:

- A new **`packages/artifacts`** is the single module that makes, stores, shows and exports Artifacts, and prepares Handoffs. It is the only module that turns course material into nunio's own work.
- **`packages/understanding`**, today an empty package, is the single module that records Attempts, Feedback and Self-assessments and works out Understanding Levels. It reads a Practice Item from `artifacts` through one method and writes nothing there.
- **`facts`** (`packages/knowledge`) resolves AI-use Rules and records Reported as Submitted, because Correction precedence, Disagreements and Obligations already live there.
- **`responsibilities`** (`packages/delegation`) starts Runs the student starts, because every Run row is already created there.

Only `understanding` writes Evidence, and only from an Attempt or a Self-assessment. "An Artifact never changes an Understanding Level" therefore holds by construction: `artifacts` has no way to reach Evidence.

Nothing here goes through the delegation gate's `perform`. Making an Artifact is not an Action, and a Handoff is performed by the student. Model calls are metered through `delegation.meter`.

## Interface

```ts
export function createArtifacts(deps: {
  db: PrismaClient; // local-substitutable; internal seam
  derived: DerivedText; // in-process; seals text under its Sources' keys
  reader: KnowledgeReader; // passages and Facts, through a Run's pinned scope
  facts: Facts; // AI-use Rules, Obligations and their Destination wording
  responsibilities: Responsibilities; // starts the student's Runs
  delegation: Delegation; // meter() only
  maker: Maker; // true external; model adapter and a fake
  clock: Clock; // in-process; injected
}): Artifacts;

export interface Artifacts {
  /** API: checks the request, starts and pins its Run; the API then starts `artifactRun/{runId}`. */
  request(
    student: Principal,
    req: ArtifactRequest,
  ): Promise<
    | { status: "started"; artifactId: string; runId: string }
    | { status: "refused"; reason: Refusal }
  >;
  /** Worker only, the Run's one Activity: checks the request again, makes the Artifact, stores version 1. */
  make(runId: string): Promise<"ready" | "failed">;
  list(
    student: Principal,
    q: {
      ready?: true;
      courseId?: string;
      obligationId?: string;
      derivedFrom?: string /* sourceId: what deleting it would withdraw */;
    },
  ): Promise<ArtifactSummary[]>;
  /** Marks it opened; a withdrawn Artifact comes back without content. */
  open(
    student: Principal,
    artifactId: string,
    version?: number,
  ): Promise<ArtifactView | "gone">;
  /** Drafts and flashcards only. */
  edit(
    student: Principal,
    artifactId: string,
    edit: { baseVersion: number; content: EditableContent },
  ): Promise<
    | { status: "ok"; version: number }
    | { status: "stale" | "withdrawn" | "not_editable" }
  >;
  exportFlashcards(
    student: Principal,
    artifactId: string,
  ): Promise<{ filename: string; tsv: string } | "gone">;
  /** The Obligation's Destination wording, its AI-use Rule's conditions, and its drafts to choose from. */
  handoff(
    student: Principal,
    obligationId: string,
  ): Promise<HandoffView | "gone">;
  /** For `understanding` only: one item with what grading needs. Does not mark the Artifact opened. */
  practiceItem(
    student: Principal,
    ref: { artifactId: string; itemId: string },
  ): Promise<PracticeItem | "gone">;
}

export type ArtifactRequest = {
  from:
    | { chatId: string }
    | { selection: { courseIds: string[]; sourceIds: string[] } };
} & (
  | {
      kind: "practice_set";
      topicIds: string[];
      quoteFrom?: string[] /* sourceIds */;
    }
  | { kind: "flashcards"; topicIds: string[] }
  | {
      kind: "draft";
      obligationId: string;
      instructions: string;
      conditionsConfirmed?: true;
    }
  | {
      kind: "critique";
      obligationId: string;
      of: { ownWork: string } | { artifactId: string; version: number };
      conditionsConfirmed?: true;
    }
);

export type Refusal =
  | "gone" // a Topic, Course, Source, Obligation or Chat that is not the student's or no longer exists
  | "ai_use_unknown" // ask the student; their answer goes to facts.enterRule
  | "ai_use_forbidden"
  | "ai_use_conditions" // allowed with conditions the student has not confirmed for this request
  | "not_handed_in" // an exam or registration: nothing is handed in, so nothing is drafted
  | "allowance_exhausted";

export type PracticeItem = {
  topicIds: string[];
  derivedFrom: string[]; // sourceIds; Feedback is sealed under the same Sources
  prompt: PromptData; // the question, model answer and cited passages, fenced
};

export function createUnderstanding(deps: {
  db: PrismaClient;
  derived: DerivedText;
  artifacts: Artifacts; // practiceItem() only
  delegation: Delegation; // meter() only
  grader: Grader; // true external; model adapter and a fake
  clock: Clock;
}): Understanding;

export interface Understanding {
  /** Records the Attempt, then grades it. A failed grading keeps the Attempt, ungraded. */
  attempt(
    student: Principal,
    item: { artifactId: string; itemId: string },
    text: string,
  ): Promise<
    | { status: "graded"; attempt: AttemptView }
    | { status: "ungraded"; attemptId: string }
    | { status: "refused"; reason: "gone" | "allowance_exhausted" }
  >;
  /** Grades an ungraded Attempt again, or regrades one the student doubts; metered again. */
  grade(student: Principal, attemptId: string): Promise<AttemptView | "gone">;
  selfAssess(
    student: Principal,
    topicId: string,
    level: "shaky" | "solid",
  ): Promise<void>;
  levels(student: Principal, q: { courseId: string }): Promise<TopicLevel[]>;
  history(student: Principal, topicId: string): Promise<EvidenceView[]>;
}

export type TopicLevel = {
  topicId: string;
  level: "not_yet_practiced" | "shaky" | "solid" | "disputed";
  fromAttempts: "shaky" | "solid" | null; // what disputed is made of
  selfAssessment: "shaky" | "solid" | null;
  lastEvidenceAt: Date | null;
};

// Added to Facts (packages/knowledge)
interface Facts {
  aiUse(student: Principal, obligationId: string): Promise<AiUse | "gone">;
  enterRule(
    student: Principal,
    rule: {
      obligationId: string;
      level: "obligation" | "course";
      value: AiUseClass; // a Fact holds one value, so the student's entry has no wording
    },
  ): Promise<{ status: "ok" } | { status: "gone" }>;
  /** The student says they handed it in through a Handoff, or takes that back. */
  reportSubmitted(
    student: Principal,
    obligationId: string,
    reported: boolean,
  ): Promise<{ status: "ok" | "gone" | "not_handed_in" }>;
}
export type AiUseClass = "forbidden" | "conditional" | "allowed";
export type AiUse =
  | { status: "unknown"; reason: "none" | "uncertain" | "disagreement" }
  | {
      status: AiUseClass;
      level: "obligation" | "course";
      text: string | null; // the Source's wording, for showing; null for the student's own. A prompt fences it.
      provenance: Provenance;
    };

// Added to Responsibilities (packages/delegation)
interface Responsibilities {
  /** A Run the student started, with no Responsibility and so no Grants (ADR-0001). Idempotent on runId. */
  startStudentRun(
    student: Principal,
    run: { runId: string; workflowId: string; chatId?: string },
  ): Promise<{ status: "ok" | "gone" }>;
}

// Shared by chats, artifacts and understanding (packages/knowledge)
export interface DerivedText {
  /** `id` is the record the text belongs to; null when a Source is already gone. */
  seal(
    tx: Transaction,
    id: string,
    derivedFrom: readonly string[],
    text: string,
  ): Promise<Sealed | null>;
  /** Null once any of its Sources is deleted. */
  open(tx: Transaction, id: string, sealed: Sealed): Promise<string | null>;
}

// In @nunio/ai, beside Answerer and Extractor
export interface Maker {
  estimateMicroUsd(input: MakerInput): number;
  make(
    input: MakerInput,
    options: { signal: AbortSignal },
  ): Promise<{ value: MadeContent; usage: { microUsd: number } }>;
}
export interface Grader {
  estimateMicroUsd(input: GradeInput): number;
  grade(
    input: GradeInput,
    options: { signal: AbortSignal },
  ): Promise<{
    value: {
      verdict: "correct" | "partial" | "incorrect";
      text: string;
      cited: string[];
    };
    usage: { microUsd: number };
  }>;
}
```

### Invariants

- **Only Attempts move a Level.** `levels` applies a pure function, `levelOf(attempts, selfAssessments)`, per Topic:
  - No Attempt gives _not yet practiced_, whatever the Self-assessment says. The Self-assessment is still shown beside it.
  - Otherwise the Level from Attempts is _solid_ when the two most recent graded Attempts on the Topic are both `correct`, and _shaky_ otherwise. `partial` counts as not correct. Ungraded Attempts don't count.
  - It is _disputed_ when the latest Self-assessment differs from the Level from Attempts, in either direction. It stays disputed until a new Self-assessment or new Attempts agree.
  - An Attempt on an item with several Topics counts for each of them. Nothing depends on the clock (ADR-0002). `lastEvidenceAt` is the latest Attempt or Self-assessment.
- **Artifacts are never Evidence.** `artifacts` can't write an Attempt or a Self-assessment, and a Critique carries no verdict.
- **Withdrawn with their Sources.** Every Artifact version, and every Feedback, is sealed through `DerivedText` under the key of each Source whose passages or Facts it was given, exactly like a Chat answer. Deleting any of those Sources shreds all of it, edited versions included:
  - `open` then returns the Artifact's kind, Topics, Obligation and dates without content;
  - `exportFlashcards` and `practiceItem` return `"gone"`;
  - verdicts and Self-assessments are not course material, so they stay and keep counting.
- **AI-use Rules gate drafts and Critiques, never practice.** `request` asks `facts.aiUse` for the Obligation:
  - `unknown` refuses with `ai_use_unknown`; the UI asks, and the answer goes to `facts.enterRule`;
  - `forbidden` refuses;
  - `conditional` refuses until the request carries `conditionsConfirmed`, sent after the UI has shown the rule text.

  `make` asks again before calling the model, so a rule that changed meanwhile fails the Run. Practice sets and flashcards on the same Topics are never gated, because practice is not assessed work.
- **Exams get no drafts.** A `draft` or `critique` for an Obligation of kind `exam` or `registration` is refused with `not_handed_in`.
- **Ready means finished and unopened.** An Artifact is ready from the end of a successful `make` until its first `open`, unless it is withdrawn first. There's no Acknowledgement, and it never raises an Intervention.
- **Versions are immutable.** `edit` writes a new version against `baseVersion`, and a concurrent edit gets `stale`. Practice sets and Critiques can't be edited, so an Attempt always refers to the item as it was answered.
- **A Handoff is not an Action.** `handoff` only shows what the student needs; `facts.reportSubmitted` records Reported as Submitted, which the student can take back. Nothing is sent anywhere.

### Error modes

- Domain outcomes are values (`refused`, `gone`, `stale`, `withdrawn`). A thrown `ArtifactsUnavailable` or `UnderstandingUnavailable` is an infrastructure fault and safe to retry.
- `make` makes a single attempt, like extraction: a model call that crashed may already have cost money. A failed Artifact shows as failed, and asking again starts a new Run.
- An Artifact still `making` 15 minutes after its Run started is listed as failed. That covers a workflow the API failed to start after `request`.
- A grading failure leaves the Attempt `ungraded`, and `grade` asks again.
- If `meter` cannot tell whether a model call finished, the reservation stays held, as `delegation` defines.

## What the implementation hides

- **Starting a Run.** `request` mints the `runId`, calls `responsibilities.startStudentRun`, pins the Run's scope through `reader.pin` (from the Chat, or from the explicit selection), and records the Artifact as `making`. `make` reads only through `{ runId }`. This builds the part of knowledge-retrieval.md that Phase 9 deferred:
  - `pin` and the `{ runId }` scope for Run Principals;
  - frozen additions with live removals;
  - `run_unpinned`.

  `meter` already charges a Run with no Responsibility to the Allowance alone.
- **Making.** A practice set retrieves passages for each Topic (its name as the query, narrowed to the Topic's Course), plus the Topics' Facts. With `quoteFrom`, it also retrieves the given Sources' passages, and the model must quote their problems verbatim rather than invent new ones. Each Practice Item carries:
  - its Topic IDs, checked against the request;
  - a model answer;
  - its `[S1]` citations;
  - for quoted items, the quote's Provenance.

  Flashcards follow the same path. A draft gets the Obligation's passages and the student's instructions, and a Critique gets the work and the rule text. The Own Work in a Critique request is stored with the request, as plain text under row-level security, like a Chat question. Citation tags the model was not given are removed, as in Chat answers.
- **Grading.** `attempt` gives the `Grader` (task `feedback`) the item's fenced prompt and the student's text. Feedback keeps only citations the item had and is sealed under the item's `derivedFrom`.
- **Rule resolution** (in `facts`). AI-use Rules are a new Fact type, `ai_use_rule`, extracted with the other course rules:
  - the value is the class, and the verbatim quote is the rule text;
  - the match key is `course` for a Course's rule, or `obligation:<the Obligation's matchKey>` for an Obligation's, since Facts belong to a Course;
  - a pure `resolveAiUse(obligationRule, courseRule)` picks the Obligation's rule over the Course's, after the usual merge in which a Correction or entry wins. An uncertain value or an open Disagreement gives `unknown`.
- **Anki export.** A UTF-8 TSV with file headers:
  - `#separator:tab`, `#html:false`, `#notetype:Basic`, `#columns:Front	Back	Tags`;
  - `#guid column` with a stable ID per card, derived from the Artifact and card, so a re-import updates notes instead of duplicating them;
  - Topic names as tags;
  - fields containing a tab, newline or quote are quoted, with quotes doubled.

  It exports the latest version. The web shows a preview of the rows as Anki will map them before the download.
- **Reported as Submitted** is a new `reportedSubmittedAt` on the Obligation. `planning` stops planning an Obligation reported as submitted and raises no Shortfall for it. Home shows it as Reported as Submitted, never as done.

## Data

- `run`: gains `chatId` (nullable). Pinned selections are stored as knowledge-retrieval.md describes.
- `artifact`: student, `kind` (`practice_set` | `flashcards` | `draft` | `critique`), `runId`, Course or Obligation, the request as JSON (Topic IDs, instructions, Own Work), `status` (`making` | `ready` | `failed`) with a failure reason, `openedAt`, `createdAt`.
- `artifact_version`: Artifact, `version`, the sealed content, `editedByStudent`, `createdAt`.
- `artifact_source`: an Artifact's `derivedFrom` Sources, so `list` can tell what's ready or withdrawn without decrypting.
- `practice_item`: Artifact, `itemId`, Topic IDs. This is plain structure, so Levels need no decryption.
- `practice_attempt` (`attempt` already names an Action's dispatch attempt): student, Artifact and `itemId`, text, `verdict` (null while ungraded), sealed Feedback, `createdAt`.
- `self_assessment`: student, Topic, `level`, `createdAt`; a history, never updated in place.
- `obligation`: gains `reportedSubmittedAt`. `fact_type` gains `ai_use_rule`.

All tables are owned by the student under the same row-level security policy as `chat_message`. Evidence references its Topic's Fact and is deleted with it; merging Courses moves it to the surviving Topic.

## Seams and adapters

| Dependency                                          | Category            | Seam                               | Adapters                                        |
| --------------------------------------------------- | ------------------- | ---------------------------------- | ----------------------------------------------- |
| Postgres                                            | Local-substitutable | Internal only                      | Real Postgres; Testcontainers                   |
| Models for making and grading                       | True external       | **Real ports** (`Maker`, `Grader`) | Model adapters in `@nunio/ai`; scriptable fakes |
| `reader`, `facts`, `responsibilities`, `delegation` | In-process          | None; the real modules             | Real modules on the same test database          |
| `DerivedText`                                       | In-process          | Shared helper, not a port          | One implementation, moved out of `chats`        |
| Clock                                               | In-process          | Small                              | System clock; manual clock                      |
- `levelOf` and `resolveAiUse` are internal seams: pure functions table-tested on their own, never exported from their package's root.
- `DerivedText` replaces the private key-wrapping code in `chats.ts`, which today is the only caller. With three callers it earns a module of its own; Chats' existing tests must pass unchanged.
- Default model tasks are `explanation` for practice sets and flashcards, and `feedback` for grading, drafts and Critiques. Phase 12's evals confirm them.
- The worker runs `make` from an `artifactRun` workflow, one per Run (ADR-0006). The API starts it after `request`, as it starts Source workflows. Temporal stays in the apps, not in the modules.
- `outreach` gains `artifacts` as a dependency. A Briefing bundles ready Artifacts by kind and count, and stays content-free outside the app (ADR-0014). Home's `artifacts` list is `list({ ready: true })`.

### Rejected alternatives

- **One `study` module** for Artifacts and Levels. It would be one interface of a dozen methods, Level tests would carry Artifact setup, and the by-construction guarantee that Artifacts never reach Evidence would be lost. The two share only `practiceItem`.
- **Grading in `artifacts`,** with `understanding` only storing verdicts. That would put Evidence writes in `artifacts`, for the same loss.
- **AI-use Rule resolution in `artifacts`.** It would re-implement Correction precedence and Disagreement detection, which already live in `facts`.
- **Own Work as its own store.** Only a Critique reads it, and a Handoff needs nothing from nunio but the student's word, so it stays in the Critique's request.
- **A separate `dependents` method.** It is `list({ derivedFrom })`.
- **Runs started inside `artifacts`.** Every Run row is created in `responsibilities`, so the student's Runs are started there too.

## API and web

- `POST /api/me/artifacts` (a request), `GET /api/me/artifacts` (with `?derivedFrom=` for the Source deletion dialog), `GET /api/me/artifacts/{id}`, `POST /api/me/artifacts/{id}/versions`, `GET /api/me/artifacts/{id}/anki.tsv`.
- `GET /api/me/obligations/{id}/ai-use`, `POST /api/me/obligations/{id}/ai-use` (the student's entry), `GET /api/me/obligations/{id}/handoff`, `POST /api/me/obligations/{id}/reported-submitted`.
- `POST /api/me/attempts`, `POST /api/me/attempts/{id}/grade`, `POST /api/me/topics/{id}/self-assessment`, `GET /api/me/courses/{id}/levels`.

All are authenticated and CSRF-protected like the existing student routes.

In `web`, `features/study` has:
- a Course's Topics with their Levels and last-Evidence dates, where _disputed_ shows both sides, and "Practice this Topic" (a request from the Topic's Course);
- the practice view, with an answer box per item and its Feedback;
- flashcards with the import preview;
- drafts and Critiques, with the rule shown and the question asked when it is unknown;
- the Handoff dialog.

## Testing

Through the `Artifacts`, `Understanding` and `Facts` interfaces over real Postgres, with a fake clock, `Maker` and `Grader`:

- **Levels.** `levelOf` is table-tested on its own for every case above, including multi-Topic items, ungraded Attempts and a Self-assessment with no Attempts.
- **Artifacts never touch Levels.** Making, opening, editing, exporting and withdrawing Artifacts leaves `levels` unchanged.
- **Disputed.** A _solid_ Self-assessment against two incorrect Attempts shows _disputed_, and so does the reverse.
- **AI-use Rules.**
  - `resolveAiUse` is table-tested.
  - An unknown, forbidden or unconfirmed conditional rule refuses a draft, as does a rule changed between `request` and `make`.
  - A practice set on the same Topics is not refused.
- **Withdrawal.**
  - Deleting a Source withdraws its Artifacts, edited versions included, and `list({ derivedFrom })` lists them beforehand.
  - Feedback text is gone while its verdict still counts.
  - A Source added after `request` is invisible to `make`.
- **Anki.** The TSV round-trips German characters, tabs, quotes and multiline answers, and re-importing it updates notes. This is checked by parsing in tests, and once by importing into the supported Anki version.
- **Handoff.** Reporting and taking back Reported as Submitted are recorded, Plan stops planning a reported Obligation, and no Action is created.
- **Runs.** A student's Run reads only its pinned scope, cannot widen it, and has no Grants. An exhausted Allowance refuses before any model call.

## Accepted limits

- Attempts and Own Work are typed text. A photo of handwritten work needs a vision model and the Source quarantine path, and waits for pilot demand.
- nunio cannot tell an old exam from a problem sheet still to be handed in. A practice set quoting from a graded sheet whose AI-use Rule forbids AI gets no check; the request UI says so.
- The exam preset (Phase 9) still proposes only the Rebalance. Practice sets inside a Responsibility's Runs, and Topic coverage, are left for later.
- External grades are Evidence for a Course (GLOSSARY.md) but are not recorded yet.
- Feedback is a model's judgment. The student can ask for a regrade, but can't set a verdict aside.
- _Solid_ needs two correct Attempts in a row, so one good answer still shows _shaky_.
- Deleting the only Source behind a Topic deletes the Topic with its Evidence, unless the student had corrected it.
