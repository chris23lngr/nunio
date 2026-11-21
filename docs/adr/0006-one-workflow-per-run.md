# One workflow per Run; Agents are records plus triggers

Each Run is one bounded Temporal workflow. An Agent is not a workflow. It is a database record (scope, Grants, Budget, state) plus a Temporal Schedule or event trigger that starts Runs. Pausing an Agent pauses its Schedule, and every in-progress Run rechecks the Agent's state before its next Action. Ending it deletes the Schedule and keeps the record. Approval waits live inside the Run's workflow and expire after 7 days by default, never later than the related Obligation's deadline. An expired Approval ends that Action as not approved and raises an Intervention.

We rejected one long-lived workflow per Agent because semester-long executions must survive every code deploy, which is where Temporal versioning is most costly. They also accumulate large histories that clash with short retention and with storing only opaque IDs in payloads.

## Amendment (2026-11-19): Approvals outlive the Run

Agents run on the student's free-text Instructions, and a Run that waited up to 7 days for its Approvals would skip every scheduled Run and "Jetzt starten" in the meantime, so one ignored card would stop a daily Agent for a week ([What happens to an Agent's next Runs while one awaits Approval](https://github.com/chris23lngr/nunio/issues/153)).

- **A Run ends when its model finishes.** Its workflow no longer waits for Approvals. An Action needing Approval goes back to the model as asked, not happened, and stays open in the Inbox after the Run ends. The student's decision is applied by the API through the gate, as for a Chat's Approvals ([ADR-0019](0019-the-chat-model-calls-tools.md)), and the Action still belongs to its Run.
- **Expiry is lazy.** An Approval still expires after 7 days, never later than the related Obligation's deadline, but no timer closes it. It shows as expired, the gate refuses a late decision, and no Intervention is raised.
- **Pausing or Ending withdraws.** Pausing an Agent, for any reason, or Ending it withdraws all its open Approvals for good. Resuming brings none back; the next Run asks again if the Action still makes sense.
- **The next Run sees them.** Each Run reads its Agent's open Approvals and those decided or expired since its previous Run, so it does not ask twice and can build on the answers. Nothing deduplicates across Runs.
- **One Run at a time.** The Schedule keeps skipping a start while the Agent's Run is still under way, and "Jetzt starten" is unavailable then. No start is queued.
- **Rejected:** keeping the wait, which stalls the Agent; letting Runs overlap, which allows up to 7 live Runs asking the same things; and having each new Run supersede the last, which caps an Approval's life at the Agent's rhythm.

## Amendment (2026-11-19): One Intervention per Agent Run with open Approvals

The Approvals an Agent's Run leaves open reach the Inbox as one Intervention per Run ([What a Run records and shows in Activity](https://github.com/chris23lngr/nunio/issues/149)). It is raised when the Run ends with at least one Approval open, announced under the student's outreach settings, and lapses when the last of them is decided, expires or is withdrawn. Like expiry, lapsing needs no timer. Opening it leads to that Run's Approvals in the Agent's Activity. One Intervention per Run, rather than one per Approval, keeps a Run's up to five questions to a single announcement. Expiry and withdrawal still raise nothing of their own.

## Amendment (2026-11-21): An Agent's Artifacts outlive deleting it

An Agent's Run may start one Artifact Run with "Karteikarten erstellen" or "Übungsaufgaben erstellen" ([Karteikarten and Übungsaufgaben erstellen](https://github.com/chris23lngr/nunio/issues/186)). The Artifact Run is its own Run, its cost charged to the Run that started it. Deleting the Agent removes its Runs and their Activity, but keeps the flashcards and practice sets it made, and the student's Attempts on them, as for Artifacts started in a Chat. Deleting them too was rejected: it would quietly take study material and Evidence the student relies on.
