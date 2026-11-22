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

## Amendment (2026-11-22): One scheduled Run a day across clock changes

An Agent's Schedule fires at its Uhrzeit in the Plan's time zone, and Temporal matches that Uhrzeit against the clock literally, with no handling of daylight saving time ([Agent Schedule edge cases](https://github.com/chris23lngr/nunio/issues/227)). An Uhrzeit in the hour the clocks go back (02:00–02:59 in Europe) comes round twice, so the Schedule fires twice, an hour apart. Skipping starts while a Run is under way does not help once the first has ended.

- **One scheduled Run per day and Uhrzeit.** A start from the Schedule records no Run if the Schedule already started one due on the same day at the same Uhrzeit in the Plan's time zone. Each start is keyed on the time it was due, which Temporal appends to its workflow ID, not on when the worker takes it up: a worker down across midnight still starts yesterday's late Run as yesterday's, and today's as today's. Changing the Uhrzeit to later on a day the Agent has already run starts that day's Run at the new Uhrzeit. "Jetzt starten" is not limited.
- **The hour the clocks skip has no Run.** An Uhrzeit in the hour the clocks go forward (02:00–02:59 in Europe) does not exist that day, so the Agent has no scheduled Run that day and runs again the next. We accept one missed day a year rather than refusing those Uhrzeiten every other day of the year or moving them in code.
- **Rejected:** one scheduled Run per calendar day, keyed on when the worker took the start up: a start taken up after midnight counted as the next day's and refused that day's Run. Refusing 02:00–02:59 in time zones with daylight saving time, which differ in which hour they change and would forbid a valid Uhrzeit all year for one day's sake; and running the Schedule in UTC, which would move every Agent's Uhrzeit by an hour twice a year.
