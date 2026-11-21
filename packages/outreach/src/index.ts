/**
 * Interventions, Notices, Briefings, and the messages that point to the Inbox. See docs/design/outreach.md.
 */

export {
  type BriefingBundle,
  type BriefingRefusal,
  briefingTextId,
  sendBriefing,
} from "./briefings.js";
export { causeOf, interventionKinds, type Kind, keyOf } from "./causes.js";
export { type NoticeRefusal, noticeTextId, sendNotice } from "./notices.js";
export {
  type BriefingView,
  createOutreach,
  type InterventionView,
  type NoticeView,
  NotOpenError,
  type Outreach,
  openIntervention,
  type PushSubscriptionJson,
  UnknownInterventionError,
  UnknownNoticeError,
} from "./outreach.js";
export { raiseForEndedRun } from "./raise.js";
export {
  createOutreachSender,
  type Mailer,
  type OutreachSender,
  type Pusher,
} from "./sender.js";
export { createWebPusher } from "./web-push.js";
