# nunio

nunio is a proactive study platform for university students. It keeps an actionable understanding of courses, obligations, time, and progress, and does study work on the student's behalf within explicit permissions.

## Language

### Interaction

**Chat**:
A conversation between the student and nunio over an explicitly selected set of courses and materials. A Chat can start an Agent but is never itself an Agent.
_Avoid_: Assistant, conversation agent

**Agent**:
A worker that carries out proactive or multi-step study work for the student without the student driving each step.
_Avoid_: Bot, assistant, automation

### Organization

**Course**:
A unit of study the student is taking that ends in one assessment and grade (a German _Modul_), holding its long-lived academic context such as materials and rules. A Course may bundle a lecture, tutorial, and lab.
_Avoid_: Module, class, subject, Lehrveranstaltung

**Semester**:
A named academic half-year, a Wintersemester from October to March or a Sommersemester from April to September, such as Wintersemester 2026/27. Every Course belongs to exactly one Semester, the one the student takes it in, which the student sets; it organizes Courses and changes nothing about how nunio works on them.
_Avoid_: Term, session, academic period

**Archived**:
The state of a Course the student is no longer studying, whether passed, dropped, or given up. Everything in it stays and the student can unarchive it, but nunio no longer plans or acts for it. Not to be confused with Ended, which applies only to Responsibilities.
_Avoid_: Completed, finished, inactive, hidden

**Deleting a Course**:
The student removing a Course for good, with everything that exists only within it. Its Sources stay, so a later reading may propose the Course again; Rejecting it, not Deleting it, is how the student keeps it away.
_Avoid_: Removing, archiving, rejecting

**Project**:
An optional, outcome-oriented workspace, such as exam preparation or a thesis, related to zero or more Courses and optionally working toward one Obligation.
_Avoid_: Workspace, goal, folder

### Connections

**Integration**:
A kind of external service nunio supports, such as Moodle or Google Calendar.
_Avoid_: Connector, plugin, app

**Connection**:
The student's authorized link to one external account through an Integration, such as their own Moodle account.
_Avoid_: Integration, account link, connector

**Disconnect**:
The student ending a Connection. nunio loses access immediately; Sources already imported stay until the student deletes them separately.
_Avoid_: Revoke, unlink, remove

### Knowledge

**Source**:
An item the student uploaded or connected, such as a syllabus PDF or a calendar, from which Facts are extracted.
_Avoid_: Document, file, material, import

**Fact**:
One piece of nunio's understanding of the student's studies, such as an exam room, always carrying its Provenance and any uncertainty. The set of all Facts needs no separate name.
_Avoid_: Shared knowledge, memory, extracted information, data

**Provenance**:
Where a Fact came from: the Source and location it was extracted from, or the student's own entry or Correction.
_Avoid_: Origin, reference

**Citation**:
A mark in a Chat answer, such as [S1], pointing to the passage or Fact it rests on. It is stored only as a reference and shown with its Provenance, or as gone once its Source is deleted.
_Avoid_: Quote, snippet, source link

**Correction**:
The student's override of a Fact. A Correction keeps winning over later extraction; disagreement from a newer Source is flagged to the student, never silently applied or hidden.
_Avoid_: Edit, fix, override

**Disagreement**:
Sources, or a Source and a Correction, giving different values for the same Fact. It stays flagged until the student uses one value, keeps their Correction, or corrects it; values the student set aside this way are overruled and no longer count.
_Avoid_: Conflict, mismatch

**Reject**:
The student's judgment that an extracted Fact, or a Course nunio proposed, is wrong or not theirs, even after accepting it. A Course the student created cannot be rejected, only deleted. A rejected item is folded away and stays rejected when later extraction finds it again, until the student restores it. Rejecting is not a Dismissal, which applies only to Interventions.
_Avoid_: Dismiss, delete, hide

### Study work

**Obligation**:
Something the student owes outside nunio by a deadline, such as a problem set, an exam, or a thesis hand-in. Obligations are extracted or entered, never invented by nunio.
_Avoid_: Assignment, deadline, due item, commitment

**Task**:
A visible, completable step the student or nunio takes toward an Obligation or goal, such as "do questions 1–4".
_Avoid_: To-do, step, job

**Study Block**:
A slot of time in the student's calendar that nunio created for study work. Calendar events nunio did not create are never Study Blocks.
_Avoid_: Session, time block, event

**Artifact**:
A piece of work nunio produced in a Run, such as a practice set, a draft, or flashcards. It stays an Artifact when the student edits it. An Artifact is never Evidence of the student's understanding.
_Avoid_: Output, result, deliverable, generation

**Own Work**:
Work the student produced themselves toward an Obligation, such as their handwritten solutions to a problem set. Own Work is never an Artifact and never Evidence.
_Avoid_: Draft, homework, student artifact

**Critique**:
nunio's comments on Own Work or an Artifact before it is handed in. A Critique is not Feedback and never Evidence.
_Avoid_: Review, Feedback, correction

**AI-use Rule**:
A Course's or Obligation's rule on whether the student may use AI for assessed work: forbidden, allowed with conditions, or allowed. It is a Fact, and one on the Obligation wins over the Course's; while it is unknown, nunio asks before drafting or giving a Critique.
_Avoid_: AI policy, academic integrity rule, AI permission

### Planning

**Plan**:
The student's single, current arrangement of Tasks and Study Blocks over time, across all Courses and Projects.
_Avoid_: Schedule, timetable, calendar, roadmap

**Fixed Event**:
A calendar event nunio did not create, such as a lecture or a job shift. nunio plans around Fixed Events and never changes them on its own.
_Avoid_: Commitment, appointment, external event

**Estimate**:
The expected effort for a Task or Obligation, proposed by nunio and correctable by the student.
_Avoid_: Duration, effort, workload

**Capacity**:
The study time available in a period once Fixed Events, Protected Time, and Preferences are accounted for.
_Avoid_: Availability, free time, bandwidth

**Shortfall**:
The amount by which Estimates exceed Capacity before a deadline. A Shortfall is always shown to the student with proposed tradeoffs, never resolved silently.
_Avoid_: Overload, conflict, deficit

**Priority**:
The student's ranking of how much their Courses, Projects, or Obligations matter relative to each other, used to choose tradeoffs when there is a Shortfall.
_Avoid_: Importance, weight, urgency

**Rebalance**:
nunio's automatic rearrangement of the Plan within its Grants and the student's Preferences. A Rebalance never moves a Locked Study Block, and moves one the student placed or moved only with Approval.
_Avoid_: Reschedule, replan, optimize

**Lock**:
The student's explicit instruction that a Study Block must not be moved by nunio, not even by asking. Moving a Study Block does not Lock it.
_Avoid_: Pin, freeze, fix

### Limits

**Protected Time**:
Time the student has marked as off-limits; nunio never schedules into it, even with a deadline at risk.
_Avoid_: Blocked time, busy time, quiet time

**Preference**:
A soft rule about how the student wants to study, such as "at most 4 hours a day", applied task over course over global. Breaking a Preference needs Approval.
_Avoid_: Setting, rule, constraint

**Budget**:
The cap on AI usage for one Responsibility. A Responsibility that exhausts its Budget pauses and asks; it never draws further on the Allowance by itself.
_Avoid_: Limit, quota, allowance

**Allowance**:
The student's total included AI usage, shared across all Runs and the reading of Sources, and counted in the model cost it incurs. During the pilot only the founder increases it, manually; it does not reset automatically.
_Avoid_: Credits, quota, budget

**Model**:
One exact, immutable configuration for calling an AI model, named by its key such as `sonnet-5.5-reasoning-high`: the provider's model, its reasoning effort and its output budget. A different configuration is a different Model.
_Avoid_: Variant, model ID, LLM

**Model Catalog**:
The founder-managed list of Models, with which ones Chat offers, the Chat default, and prices synced from the AI provider. Students choose among the Models it offers; tasks use Models chosen in code.
_Avoid_: Allowlist, model registry

**Invitation**:
The founder's single-use offer for one email address to join the pilot, shared manually and expiring after seven days. Accepting it reserves it for a pending account; pilot access activates only after email verification.
_Avoid_: Invite code, referral, sign-up link

**Pilot entitlement**:
A student's access to the pilot: none, active, or revoked. It has no fixed end; only the founder revokes it, which blocks new uploads and AI work but keeps sign-in, existing results, and deletion requests.
_Avoid_: Subscription, license, trial, plan

### Handing in

**Destination**:
The external place where an Obligation is handed in, such as a specific Moodle course or a professor's email address. A Destination is either verified for direct Submission by nunio or not.
_Avoid_: Target, channel, endpoint

**Submission**:
The Action of handing in the student's work for an Obligation, Own Work or an Artifact, to a Destination.
_Avoid_: Upload, delivery, hand-in

**Handoff**:
nunio preparing a Submission that the student performs themselves, used for every Destination nunio cannot submit to directly.
_Avoid_: Manual submission, export

**Reported as Submitted**:
The state of an Obligation the student says they handed in through a Handoff, which nunio cannot verify. It is distinct from a confirmed Submission.
_Avoid_: Done, completed, submitted

### Understanding

**Topic**:
A unit of Course content the student is expected to understand, such as "uniform convergence". Topics are Facts: extracted with Provenance and correctable by the student.
_Avoid_: Concept, learning objective, skill, chapter

**Practice Item**:
One question about one or more Topics, from a practice set nunio produced or from the student's own Sources, such as a problem from an old exam.
_Avoid_: Question, exercise, task, card

**Attempt**:
The student's own answer to a Practice Item, given in nunio. Flashcards reviewed outside nunio produce no Attempts.
_Avoid_: Answer, response, submission, try

**Feedback**:
nunio's assessment of an Attempt. Only Attempts get Feedback.
_Avoid_: Grade, score, correction, evaluation, Critique

**Self-assessment**:
The student's own statement about how well they understand a Topic.
_Avoid_: Confidence rating, self-report, reflection

**Evidence**:
Anything that tells nunio something about the student's understanding: an Attempt or a Self-assessment, which concern Topics, or an external grade, which concerns a Course. An external grade on work nunio helped produce counts only with that caveat attached; an Artifact, Own Work, or a Critique is never Evidence.
_Avoid_: Proof, signal, data point

**Understanding Level**:
A deliberately coarse judgment of the student's understanding of one Topic: not yet practiced until there is an Attempt; then shaky or solid as the Attempts show, the most recent counting most; or disputed when Self-assessment and Attempts disagree, in either direction. Only Attempts move it; a Self-assessment alone sits beside it and external grades never set it. It never fades on its own; it always shows when Evidence last supported it.
_Avoid_: Mastery, score, progress, proficiency

### Outreach

**Intervention**:
Something nunio initiates toward the student that asks for their attention or a decision, such as a deadline risk or a changed exam room. Each concerns one cause, such as one Obligation's Shortfall, and is raised once for as long as that cause continues; it stays open until the student acknowledges or dismisses it, or it lapses. A finished Artifact on its own is not an Intervention.
_Avoid_: Alert, notification, nudge, suggestion

**Acknowledgement**:
The student noting an open Intervention, which closes it without judging whether it was useful. Acknowledging never settles a decision the Intervention asks for, such as resolving an Unconfirmed Action.
_Avoid_: Read, seen, mark done, resolve

**Dismissal**:
The student's judgment that an Intervention was not useful, which closes it. Merely seeing or acknowledging an Intervention is not a Dismissal.
_Avoid_: Ignore, close, snooze

**Lapse**:
An open Intervention closing by itself because its cause no longer holds, such as a Shortfall the student has since made room for. A lapsed Intervention is neither acknowledged nor dismissed; if its cause returns, nunio raises a new Intervention.
_Avoid_: Resolve, expire, auto-close

**Quiet Hours**:
A daily window in the student's time zone in which nunio sends them nothing outside the app; what is held goes out afterwards only if it still applies. Quiet Hours are independent of Protected Time.
_Avoid_: Do not disturb, mute, quiet time

**Briefing**:
A scheduled summary nunio delivers that bundles the current Interventions, ready Artifacts, and ongoing work, as they stood when it was made. A Briefing is not an Intervention and cannot be dismissed; nothing to bundle means no Briefing.
_Avoid_: Digest, daily summary, report

**Inbox**:
The place in nunio where the student's Interventions and Briefings live. Anything nunio sends outside the app only points to the Inbox and never closes an Intervention.
_Avoid_: Notification center, feed, activity

### Delegation

**Responsibility**:
An ongoing delegation the student owns, such as "keep this course organized", with its own scope, budget, and pause control. One-off requests are never Responsibilities.
_Avoid_: Automation, task, job, agent

**Paused**:
The state of a Responsibility that takes no further Actions, including in a Run already under way, while keeping its Grants. A Responsibility is Paused by the student, by exhausting its Budget, by losing a Connection it depends on, or by its Course being Archived; only the student resumes it, even after its Budget resets or its Course is unarchived.
_Avoid_: Suspended, stopped, disabled, on hold

**Ended**:
The state of a Responsibility stopped for good: its Grants are gone and its history remains.
_Avoid_: Revoked, cancelled, deleted, archived, completed

**Run**:
A single, bounded execution of Agent work, started either by the student, such as from a Chat, or by a Responsibility. Reading or deleting a Source is never a Run.
_Avoid_: Job, task, session

**Action**:
One concrete effect a Run has on the student's plan or outside world, such as creating a study block or submitting an artifact. Messages nunio sends the student, such as Interventions and Briefings, are not Actions, and neither is making an Artifact.
_Avoid_: Operation, step, tool call

**Approval**:
The student's consent to one exact Action, given by confirming that Action as nunio shows it back to them. A Chat request alone is never an Approval; any deviation from the approved Action needs a new Approval. An unanswered request for Approval expires.
_Avoid_: Confirmation, consent, permission

**Grant**:
Standing authority, given in advance, for a Responsibility to take a kind of Action within a defined scope without per-Action Approval. Grants exist only within a Responsibility.
_Avoid_: Permission, automation permission, authority

**Unconfirmed**:
The state of an Action nunio attempted but cannot confirm took effect, such as a Submission whose Destination gave no answer. The student must resolve it; nunio never retries it blindly.
_Avoid_: Pending, failed, unknown
