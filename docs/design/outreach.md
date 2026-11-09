# Outreach

Status: accepted design, 2026-11-09, for Phase 10 of the [implementation plan](../implementation-plan.md). Domain terms follow [GLOSSARY.md](../../GLOSSARY.md) (Intervention, Acknowledgement, Dismissal, Lapse, Quiet Hours, Briefing, Inbox). Architecture terms (module, interface, seam, adapter, depth) follow the codebase-design vocabulary. Related decisions: ADR-0008 (amendment of 2026-11-09 on push services), ADR-0013, ADR-0014. Delivery facts come from [outreach-delivery.md](../research/outreach-delivery.md).

## Purpose

A new `packages/outreach` is the single module that decides what nunio tells the student and when. It works out which Interventions are open, records Acknowledgements and Dismissals, makes Briefings, and sends the content-free email and push that point to the Inbox. The API and the worker call it through the same interface. No other code inserts Interventions, checks Quiet Hours, or sends a notification. Outreach never goes through the delegation gate: messages are not Actions.

## Interface

```ts
export function createOutreach(deps: {
  db: PrismaClient;                 // local-substitutable; internal seam
  plan: Plan;                       // Shortfalls, from the Plan's view
  facts: Facts;                     // Disagreements, from review
  delegation: Delegation;           // expired Approvals and Unconfirmed Actions, from history
  responsibilities: Responsibilities; // ongoing work for Briefings
  mailer: Mailer;                   // true external; Scaleway adapter and a fake
  pusher: Pusher;                   // true external; web-push adapter and a fake
  clock: Clock;                     // in-process; injected
  inboxUrl: string;                 // the only link an email or push carries
}): Outreach;

export interface Outreach {
  /** Worker only, every five minutes: for each active student, sync Interventions, make a due Briefing, send what is due. */
  tick(): Promise<void>;
  inbox(student: Principal): Promise<InboxView>;
  close(student: Principal, interventionId: string, as: "acknowledged" | "dismissed"): Promise<void>;
  settings(student: Principal): Promise<OutreachSettings>;
  updateSettings(student: Principal, patch: Partial<OutreachSettings>): Promise<OutreachSettings>;
  subscribe(student: Principal, subscription: PushSubscriptionJSON): Promise<void>;
  unsubscribe(student: Principal, endpoint: string): Promise<void>;
}

export type OutreachSettings = {
  quietHours: { fromMinute: number; toMinute: number } | null; // in the Plan's time zone; may wrap midnight
  dailyLimit: number;                                          // email and push combined; Briefings excluded
  briefingAtMinute: number | null;                             // null turns Briefings off
  email: boolean;
};

export interface Mailer { send(to: string, message: { subject: string; text: string }): Promise<void>; }
export interface Pusher {
  send(subscription: StoredSubscription, options: { ttlSeconds: number; urgency: "low" | "normal" }): Promise<"sent" | "gone">;
}
```

### Invariants

- **One open Intervention per cause.** A cause is `shortfall:<workId>`, `disagreement:<fact|obligation>:<id>`, `approval_expired:<actionId>` or `unconfirmed:<actionId>`. While a cause continues, no new Intervention is raised for it, even after an Acknowledgement or Dismissal. Once the cause ends and returns, a new one is raised.
- **Closing is exclusive.** An Intervention closes once, as acknowledged, dismissed or lapsed. `close` on a closed Intervention throws `NotOpenError`. Acknowledging never resolves the Unconfirmed Action or Disagreement behind it.
- **Sending never closes anything.** No email or push result changes an Intervention or a Briefing.
- **Content-free messages.** Subjects, bodies and push payloads name only the kind and count of items and link to `inboxUrl` (ADR-0014). Pushes are empty; the service worker shows fixed text.
- **Nothing outside the app during Quiet Hours.** A message due then waits until they end and is sent only if an Intervention it announces is still open.
- **Briefings are snapshots.** A Briefing stores what it bundled when it was made and is never edited. An empty one is not made. It makes no model calls and draws nothing on the Allowance.

### Error modes

- `NotOpenError`: `close` on a closed or unknown Intervention (the API answers 409, or 404 for another student's).
- A failing `Mailer` or `Pusher` leaves the message due; the next tick retries it until it is no longer applicable. A crash between sending and recording can send one message twice. That is accepted: messages are not Actions and carry no content.
- `Pusher` returning `"gone"` (404 or 410) deletes the subscription.

## What the implementation hides

- **Sync.** Each tick derives the student's current causes from `plan.view`, `facts.review` and `delegation.history` (a pure `causesOf` function, an internal seam), raises an Intervention for each new cause, and marks the cause ended for each one that no longer holds. Ending the cause of an open Intervention is a Lapse. Producers never raise Interventions themselves, so a Shortfall that appears only because time passed is still caught.
- **Live details.** An open Intervention stores its cause, not a copy of its content. `inbox` renders it from the cause's current state, so a growing Shortfall needs no update. A closed one whose subject is gone is shown as gone.
- **Delivery queue.** Raising an Intervention or making a Briefing queues one delivery per enabled channel. Each tick sends what is due per student and channel as one message ("3 items need your attention"), after rechecking that an announced Intervention is still open, that it is outside Quiet Hours, and that the daily limit leaves room. A delivery past the limit is dropped; its Intervention stays in the Inbox and the next Briefing.
- **Timing.** Pushes carry a TTL of 12 hours (Briefings `low` urgency), never the library's four-week default. Quiet Hours and the Briefing time are evaluated in the Plan's time zone at send time, so changed settings apply to what is already queued.
- **Briefings.** Once the student's local time passes `briefingAtMinute`, the tick makes that day's Briefing from open Interventions, waiting Approvals and active Responsibilities (ready Artifacts from Phase 11), then records the day as done even when nothing was made.
- **Students across tenants.** The tick lists students with an active Pilot entitlement through a `SECURITY DEFINER` function, then works on each as `principal.fromSession({ studentId })`, as the worker's Source activities already do. A failure for one student is logged and does not stop the others.

## Data

- `intervention`: the existing table from Phase 9. `dedupeKey` becomes the cause key; its unique index becomes partial, on `(studentId, dedupeKey) WHERE "causeEndedAt" IS NULL`. New `causeEndedAt`; a row is lapsed when it is set while `acknowledgedAt` and `dismissedAt` are not. The runtime role gains `UPDATE ("causeEndedAt")`.
- `briefing`: student, local date, `createdAt`, and the bundled items as JSON.
- `delivery`: student, channel (`email` | `push`), what it announces (an Intervention or a Briefing), `dueAt`, `sentAt`, `droppedAt` with a reason (`closed`, `limit`, `disabled`).
- `outreach_settings`: the fields of `OutreachSettings` and the last Briefing date. Defaults: no Quiet Hours set, a limit of 3, Briefings at 07:00, email on.
- `push_subscription`: student, `endpoint` (unique), `p256dh`, `auth`, `expirationTime`, VAPID key id, `createdAt`. Deleted on `"gone"`, on `unsubscribe`, on `pushsubscriptionchange` (the service worker re-subscribes), and with the account. Endpoints are secrets in logs.

All tables are owned by the student under the same row-level security policy as `intervention`.

## Seams and adapters

- `Mailer`: a Scaleway TEM adapter in `outreach` built on the request `identity` already makes (`packages/identity/src/email.ts`), and a fake for tests. Two adapters, a real seam.
- `Pusher`: a `web-push` adapter (version chosen by a spike, see Accepted limits) with the VAPID key from the environment, and a fake for tests.
- `plan`, `facts`, `delegation`, `responsibilities`: the existing modules, passed in as `createPlan` already takes `facts`. No new port: tests run them over real Postgres.
- The worker runs `tick` from an `outreachTick` workflow on a five-minute Temporal Schedule ensured at start, like `reconcile-actions`. No per-student workflow or Schedule.
- Phase 9's `raiseIntervention` activity stays so that recorded Run histories still replay. Its rows use the same cause keys, so sync adopts them; a missed raise is caught on the next tick.

## API and web

- `GET /api/me/inbox`: open Interventions first, then recent Briefings and closed Interventions. `POST /api/me/interventions/{id}` with `{ as: "acknowledged" | "dismissed" }`. `GET` and `PATCH /api/me/outreach-settings`. `POST` and `DELETE /api/me/push-subscriptions`. All authenticated and CSRF-protected like the existing student routes.
- `web`: `features/inbox` (the Inbox and its two closing buttons, kept visually distinct) and settings. A service worker shows "You have something new in nunio" on any push and opens the Inbox. Permission is requested only from a button tap, and on iOS only inside the Home Screen app, with install guidance elsewhere. Denied or unsupported push hides the option and changes nothing else.

## Testing

Through the `Outreach` interface over real Postgres, with a fake clock, `Mailer` and `Pusher`:

- Two ticks with the same causes raise one Intervention; a cause that ends lapses it; its return raises a new one; an acknowledged or dismissed Intervention with a continuing cause raises nothing.
- Acknowledgement and Dismissal are recorded separately, and `close` twice throws `NotOpenError`.
- A successful push or email leaves every Intervention open.
- With no push subscription, or after `"gone"`, the Inbox and email work unchanged; in `web`, a denied permission leaves every page usable (Playwright).
- A delivery due in Quiet Hours waits, and is dropped if its Intervention closed meanwhile; the daily limit drops the excess; a Briefing day with nothing open makes no Briefing; a Briefing is not changed by later lapses.
- `causesOf` is table-tested on its own.
- Each message's subject, text and push body contain no Course, Obligation or Fact text.

## Accepted limits

- Interventions appear up to five minutes after their cause, and a message held by Quiet Hours goes out up to five minutes after they end.
- Expired-Approval causes never end by themselves, so those Interventions close only by Acknowledgement or Dismissal.
- A Shortfall that hovers around zero can lapse and return repeatedly, each time raising a new Intervention; the daily limit bounds the messages. Revisit with pilot data.
- Overlaps and Unplanned work stay on Home and do not raise Interventions.
- Before building the `Pusher` adapter: a spike sends to Chrome, Firefox and an iOS Home Screen app and chooses between `web-push` 4.0.0 and 3.6.7. Before enabling Briefing email: a staging send checks whether TEM's DKIM signature covers RFC 8058 headers.
