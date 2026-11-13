---

## status: accepted

# The Chat model calls tools

A Chat answer used to be a fixed sequence: one retrieval with the question's text, one metered model call, then recording the turn. The model saw no earlier turns and decided nothing. Now an answer is a loop of model steps in which the model calls tools. It searches the Chat's selection, reads the student's Plan and Facts ([ADR-0020](0020-a-chat-reads-the-students-plan-and-facts.md)), proposes Study Block Actions and starts practice set or flashcard Runs. Chats move from `packages/knowledge` to a new `packages/chat`, because the tools need `planning`, `artifacts` and `delegation`, which already depend on `knowledge`.

- **Loop.** Each step is its own `streamText` call inside `meter`, so every step is reserved before it runs. A turn has at most 6 steps. The last one is sent with `toolChoice: "none"`, so the model has to answer. ADR-0011 forbids forcing a tool, not withholding tools. The model may call several tools in one step. Every step uses the Model the student chose. A turn refused or interrupted at any step records nothing, and the steps already taken stay metered.
- **Retrieval is the model's choice.** No retrieval runs before the first step. The model may state course content only from material it searched, with a Citation, and dates or the Plan only from tool results. Without a tool call it may only ask back, make small talk, or refer to the history. The retrieval eval measures how often it answers a question about the material without searching.
- **History.** The model gets the last 10 questions and answers as text. Withdrawn answers are left out, and Citation tags are removed from earlier answers, because tags are numbered per turn. Each earlier proposal or started Artifact adds one line with its current status. Earlier searches and tool results are not repeated. An answer may restate the earlier answers it was given, so it is also withdrawn with their Sources.
- **Tool results.** The model sees the full result. The student sees what the client needs: a summary, or the data for a card. An answer stores only its ordered parts as the student saw them, sealed under the same Source dependencies as its text. Full results are never stored. `derivedFrom` covers every Source whose passages or extracted wording appeared in any tool result of the turn, so deleting it withdraws the answer.
- **Proposals.** The model proposes `studyBlock.create` and `studyBlock.move` through tools. Their arguments are checked against the Plan's rules: Protected Time, Fixed Events, Locks and the study window. A violation goes back to the model with its reason, and a broken Preference is shown on the card. A valid proposal waits for the student through the AI SDK's `toolApproval`, but authority comes only from the gate (ADR-0010). The Action is recorded as awaiting Approval, with key `chatId:messageId:n`, in the same transaction as the answer. The student's click sends the fingerprint the card shows, and the API calls `decide`, then `perform`. After an Approval in the open Chat, the model reports the outcome in a new assistant message. A denial, or an Approval given on Home, continues nothing. A Chat's Approval expires like a Run's: after 7 days, capped at the Obligation's deadline.
- **Artifacts.** A tool starts a practice set or flashcards Run without a further click, because a confirmation for work the student just asked for is poor UX. At most one Run starts per turn, only for Courses and Topics in the Chat's selection, and only once the answer is committed, so a failed turn starts nothing. The Run counts as started by the student. Drafts and Critiques are not offered from a Chat, because a misread request could produce assessed work.

Instructions hidden in a Source can steer tool calls. A proposal does nothing without the student's click, but an Artifact Run started this way spends Allowance. The one-Run-per-turn limit bounds that, and an injection eval must show zero Runs started by injected instructions before release.

**Amendment (2026-11-12, stage 4):** proposals are asked as follows.
- **When the Action is recorded.** The gate's `perform` opens its own transaction, so a proposal's Action is recorded right _after_ the answer is saved, not in the same transaction. A failed turn still leaves no card. If the gate refuses in that moment, say for a block Locked meanwhile, the card shows that the proposal could not be asked.
- **Checking a proposal.** The tool's approval check runs `plan.check` and refuses a proposal with its reason if it is in the past, in Protected Time, or overlaps a Fixed Event or another Study Block, or if it moves a Locked block. A broken Preference (study window, daily or work limit) is only noted on the card.
- **Naming work and blocks.** The model names them by the handles the Plan tool gave out this turn (`O1`, `T1`, `B1`).
- **Performing.** The API performs a Chat Action as soon as the student approves it, on Home or in the Chat, since it has no Run to do so.
- **The Chat card.** Approving there sends `{ approval: { id, fingerprint } }` on the stream route, and the model reports the outcome in a new answer. Denying uses the plain Approval route and continues nothing.
- **Expiry.** An expired Chat Approval drops out of the Approvals list and Home, since no timer closes it.
- **History.** Each earlier proposal follows its answer as one line with its current status.

**Amendment (2026-11-13, stage 5):** Artifacts start as follows.
- **Naming Topics.** The model names Topics by the Citation tags the Course tool gave them.
- **Within the selection.** It may name only Topics the Chat's scope serves, that is, Topics of its selected Courses. A Chat that selected only Sources therefore starts no Artifact, and neither does a Chat with nothing selected, which isn't offered the tools.
- **Linking the card.** The Artifact's ID is chosen when the tool runs and kept in the answer, so its card can point to it before the Run starts.
- **One per turn.** The limit is claimed before the tool's first await, because tool calls in one step run at once.
- **What the student sees.** The card shows the Artifact's status as of when the Chat loaded, and the step line counts the Topics rather than naming them.
- **History.** A started Artifact adds a line with its status to later turns.

**Amendment (2026-11-13):** [ADR-0021](0021-a-chat-sees-understanding-shortfalls-and-artifacts.md) adds Understanding Levels, Shortfalls and Artifacts to the read tools, adds `studyBlock.remove` to the proposals, and lists further work a Chat does not offer.

## Considered Options

- **Retrieval before the first step, plus a search tool:** every answer is grounded, but follow-up questions are searched with weak terms, and even "thanks" costs a retrieval.
- **One reservation for the whole turn's worst case:** simpler metering, but it holds Allowance most turns never use.
- **The AI SDK's tool approval as the Approval itself:** less code, but the consent is not bound to a fingerprint and bypasses the gate.
- **A start card before each Artifact Run:** stops injected Runs completely, but adds a confirmation the student does not want.
