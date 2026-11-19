# One workflow per Run; Responsibilities are records plus triggers

Each Run is one bounded Temporal workflow. A Responsibility is not a workflow. It is a database record (scope, Grants, Budget, state) plus a Temporal Schedule or event trigger that starts Runs. Pausing a Responsibility pauses its Schedule, and every in-progress Run rechecks the Responsibility's state before its next Action. Ending it deletes the Schedule and keeps the record. Approval waits live inside the Run's workflow and expire after 7 days by default, never later than the related Obligation's deadline. An expired Approval ends that Action as not approved and raises an Intervention.

We rejected one long-lived workflow per Responsibility because semester-long executions must survive every code deploy, which is where Temporal versioning is most costly. They also accumulate large histories that clash with short retention and with storing only opaque IDs in payloads.

## Amendment (2026-11-19): Approvals outlive the Run

Agents replace Responsibilities, and a Run that waited up to 7 days for its Approvals would skip every scheduled Run and "Jetzt starten" in the meantime, so one ignored card would stop a daily Agent for a week ([What happens to an Agent's next Runs while one awaits Approval](https://github.com/chris23lngr/nunio/issues/153)).

- **A Run ends when its model finishes.** Its workflow no longer waits for Approvals. An Action needing Approval goes back to the model as asked, not happened, and stays open in the Inbox after the Run ends. The student's decision is applied by the API through the gate, as for a Chat's Approvals ([ADR-0019](0019-the-chat-model-calls-tools.md)), and the Action still belongs to its Run.
- **Expiry is lazy.** An Approval still expires after 7 days, never later than the related Obligation's deadline, but no timer closes it. It shows as expired, the gate refuses a late decision, and no Intervention is raised.
- **Pausing or Ending withdraws.** Pausing an Agent, for any reason, or Ending it withdraws all its open Approvals for good. Resuming brings none back; the next Run asks again if the Action still makes sense.
- **The next Run sees them.** Each Run reads its Agent's open Approvals and those decided or expired since its previous Run, so it does not ask twice and can build on the answers. Nothing deduplicates across Runs.
- **One Run at a time.** The Schedule keeps skipping a start while the Agent's Run is still under way, and "Jetzt starten" is unavailable then. No start is queued.
- **Rejected:** keeping the wait, which stalls the Agent; letting Runs overlap, which allows up to 7 live Runs asking the same things; and having each new Run supersede the last, which caps an Approval's life at the Agent's rhythm.
