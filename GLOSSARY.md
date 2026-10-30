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
A unit of study the student is taking that ends in one assessment and grade (a German *Modul*), holding its long-lived academic context such as materials and rules. A Course may bundle a lecture, tutorial, and lab.
_Avoid_: Module, class, subject, Lehrveranstaltung

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
_Avoid_: Citation, origin, reference

**Correction**:
The student's override of a Fact. A Correction keeps winning over later extraction; disagreement from a newer Source is flagged to the student, never silently applied or hidden.
_Avoid_: Edit, fix, override

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
A piece of work nunio produced, such as a practice set, a draft, or flashcards. An Artifact is never evidence of the student's understanding.
_Avoid_: Output, result, deliverable, generation

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
The student's total included AI usage, shared across all Runs. During the pilot only the founder increases it, manually; it does not reset automatically.
_Avoid_: Credits, quota, budget

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
The Action of handing in an Artifact to a Destination.
_Avoid_: Upload, delivery, hand-in

**Handoff**:
nunio preparing a Submission that the student performs themselves, used for every Destination nunio cannot submit to directly.
_Avoid_: Manual submission, export

**Unconfirmed**:
The state of a Submission nunio attempted but cannot confirm succeeded. The student must resolve it; nunio never retries it blindly.
_Avoid_: Pending, failed, unknown

**Reported as Submitted**:
The state of an Obligation the student says they handed in through a Handoff, which nunio cannot verify. It is distinct from a confirmed Submission.
_Avoid_: Done, completed, submitted

### Understanding

**Topic**:
A unit of Course content the student is expected to understand, such as "uniform convergence". Topics are Facts: extracted with Provenance and correctable by the student.
_Avoid_: Concept, learning objective, skill, chapter

**Attempt**:
The student's own answer to a practice item.
_Avoid_: Answer, response, submission, try

**Feedback**:
nunio's assessment of an Attempt.
_Avoid_: Grade, score, correction, evaluation

**Self-assessment**:
The student's own statement about how well they understand a Topic.
_Avoid_: Confidence rating, self-report, reflection

**Evidence**:
Anything that tells nunio something about the student's understanding of a Topic: an Attempt, a Self-assessment, or an external grade. An external grade on work nunio helped produce counts only with that caveat attached; an Artifact on its own is never Evidence.
_Avoid_: Proof, signal, data point

**Understanding Level**:
A deliberately coarse judgment of the student's understanding of one Topic, drawn from Evidence: not yet practiced, shaky, solid, or disputed when Self-assessment and Attempts disagree. It never fades on its own; it always shows when Evidence last supported it.
_Avoid_: Mastery, score, progress, proficiency

### Outreach

**Intervention**:
Something nunio initiates toward the student that asks for their attention or a decision, such as a deadline risk or a changed exam room. A finished Artifact on its own is not an Intervention.
_Avoid_: Alert, notification, nudge, suggestion

**Dismissal**:
The student's judgment that an Intervention was not useful. Merely seeing or acknowledging an Intervention is not a Dismissal.
_Avoid_: Ignore, close, snooze

**Briefing**:
A scheduled summary nunio delivers that bundles the current Interventions, ready Artifacts, and ongoing work.
_Avoid_: Digest, daily summary, report

### Delegation

**Responsibility**:
An ongoing delegation the student owns, such as "keep this course organized", with its own scope, budget, and pause control. One-off requests are never Responsibilities.
_Avoid_: Automation, task, job, agent

**Paused**:
The state of a Responsibility that takes no further Actions, including in a Run already under way, while keeping its Grants. A Responsibility is Paused by the student, by exhausting its Budget, or by losing a Connection it depends on; only the student resumes it, even after its Budget resets.
_Avoid_: Suspended, stopped, disabled, on hold

**Ended**:
The state of a Responsibility stopped for good: its Grants are gone and its history remains.
_Avoid_: Revoked, cancelled, deleted, archived, completed

**Run**:
A single, bounded execution of Agent work, started either from a Chat or by a Responsibility.
_Avoid_: Job, task, session

**Action**:
One concrete effect a Run has on the student's plan or outside world, such as creating a study block or submitting an artifact. Messages nunio sends the student, such as Interventions and Briefings, are not Actions.
_Avoid_: Operation, step, tool call

**Approval**:
The student's consent to one exact Action, given by confirming that Action as nunio shows it back to them. A Chat request alone is never an Approval; any deviation from the approved Action needs a new Approval. An unanswered request for Approval expires.
_Avoid_: Confirmation, consent, permission

**Grant**:
Standing authority, given in advance, for a Responsibility to take a kind of Action within a defined scope without per-Action Approval. Grants exist only within a Responsibility.
_Avoid_: Permission, automation permission, authority
