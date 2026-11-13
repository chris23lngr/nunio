---

## status: accepted

# A Chat sees Understanding Levels, Shortfalls and Artifacts, and proposes removing Study Blocks

A Chat could read the Plan and a Course's Facts (ADR-0020). It could not say where the student is weak, whether they will make a deadline, or what practice they already have, and it could create and move Study Blocks but not remove one. Now the existing tools return more, and one Action kind is added. No new read tool is added, because each costs a step of the six a turn has (ADR-0019).

- **`courseFacts` adds Understanding Levels.** Each Topic line gives its Understanding Level, what the Attempts alone show, the latest Self-assessment and when Evidence last supported it.
- **`courseFacts` adds the Course's Artifacts.** For each practice set and set of flashcards it gives the kind, status, Topic tags, when it was made and whether it was opened. It shows no content and leaves out withdrawn Artifacts.
- **`agenda` adds Shortfalls.** Each Obligation in the range gets its Shortfall and tradeoffs, or the reason it cannot be planned. Every result also lists all current Shortfalls in short, with handle, deadline and missing minutes, so a deadline beyond the 31-day range can still be judged. The model may explain a tradeoff, but only carries one out through Study Block proposals.
- **The reads cover all Courses.** Levels, Artifact status and Shortfalls are the student's own data, not course material, so like Facts (ADR-0020) they are not bound to the selection. They contain no Source wording, so they add nothing to an answer's `derivedFrom`. Artifacts still start only for Topics of the selected Courses (ADR-0019). For a weak Topic outside them, the model tells the student to select its Course.
- **`studyBlock.remove`** is a new gate kind, proposed by `proposeStudyBlockRemove` and asked like a move: checked against the Plan, then shown on a card for Approval in the Chat and on Home. A Locked block is refused, since a Lock means nunio does not even ask, and so is a block that has started. No Grant covers the kind, so a Responsibility never removes a block without Approval. The fingerprint covers the block's work, start and end.
- **Grounding.** The model states a Level, a Shortfall or an existing Artifact only from this turn's tool results, and never tells the student they will make a deadline without having read `agenda`. Levels and Shortfalls carry no Citation, like Tasks and Study Blocks. Before starting a practice set or flashcards, the model points out a ready, unopened Artifact on the same Topics. It never calls a Topic weak for being not yet practiced.
- **Not offered from a Chat:**
  - recording a Self-assessment, because the model would infer Evidence from free text;
  - practising with Attempts and Feedback, which belongs to study execution;
  - creating a Responsibility, because Grants exist only there (ADR-0001) and must not come from a misread sentence;
  - acknowledging or dismissing an Intervention, because a Dismissal is the student's judgment.

## Considered Options

- **A read tool for each capability** (`understanding`, `capacity`, `artifacts`): each answers one question cleanly, but a common question needs two or three steps, and the Topic tags `startPracticeSet` takes would come from another tool.
- **Shortfalls only for the range read:** a smaller result, but "will I make the exam in ten weeks?" could not be answered.
- **Removing Locked blocks with Approval:** one more thing the Chat could do, but it would break the Lock's promise that nunio leaves the block alone.
