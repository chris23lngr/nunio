/**
 * Interventions, Briefings, and the messages that point to the Inbox. See docs/design/outreach.md.
 */

export { interventionKinds, type Kind, keyOf } from "./causes.js";
export {
  createOutreach,
  type InterventionView,
  InvalidUnsubscribeError,
  NotOpenError,
  type Outreach,
  type PushSubscriptionJson,
  UnknownInterventionError,
} from "./outreach.js";
export {
  createOutreachSender,
  type Mailer,
  type OutreachSender,
  type Pusher,
} from "./sender.js";
export { createWebPusher } from "./web-push.js";
