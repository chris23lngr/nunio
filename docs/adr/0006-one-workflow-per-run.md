# One workflow per Run; Responsibilities are records plus triggers

Each Run is one bounded Temporal workflow. A Responsibility is not a workflow. It is a database record (scope, Grants, Budget, state) plus a Temporal Schedule or event trigger that starts Runs. Pausing a Responsibility pauses its Schedule, and every in-progress Run rechecks the Responsibility's state before its next Action. Ending it deletes the Schedule and keeps the record. Approval waits live inside the Run's workflow and expire after 7 days by default, never later than the related Obligation's deadline. An expired Approval ends that Action as not approved and raises an Intervention.

We rejected one long-lived workflow per Responsibility because semester-long executions must survive every code deploy, which is where Temporal versioning is most costly. They also accumulate large histories that clash with short retention and with storing only opaque IDs in payloads.

## Amendment (2026-11-19): Approvals in an Agent's Runs

An Agent's Run that awaits Approval raises one Intervention for as long as any of its Approvals is open ([What a Run records and shows in Activity](https://github.com/chris23lngr/nunio/issues/149)). The Intervention lapses when the last Approval is decided, expires or is withdrawn, and opening it leads to that Run's Approvals in the Agent's Activity. One Intervention per Run, rather than one per Approval, keeps a Run's up to five questions to a single announcement.

- **Expiry.** An expired Approval in an Agent's Run no longer raises an Intervention of its own: its Activity records the expiry. An Approval asked in a Chat still raises one when it expires.
- **Pause and End.** Pausing or Ending an Agent withdraws its Runs' open Approvals at once, because a Paused Agent takes no further Actions.
