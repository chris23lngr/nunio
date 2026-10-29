# One workflow per Run; Responsibilities are records plus triggers

Each Run is one bounded Temporal workflow. A Responsibility is not a workflow. It is a database record (scope, Grants, Budget, state) plus a Temporal Schedule or event trigger that starts Runs. Pausing a Responsibility pauses its Schedule, and every in-progress Run rechecks the Responsibility's state before its next Action. Ending it deletes the Schedule and keeps the record. Approval waits live inside the Run's workflow and expire after 7 days by default, never later than the related Obligation's deadline. An expired Approval ends that Action as not approved and raises an Intervention.

We rejected one long-lived workflow per Responsibility because semester-long executions must survive every code deploy, which is where Temporal versioning is most costly. They also accumulate large histories that clash with short retention and with storing only opaque IDs in payloads.
