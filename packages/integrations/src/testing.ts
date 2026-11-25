/**
 * Fakes for testing Integrations without vendor accounts.
 */
export { hostileAddress, hostileMail } from "./testing/hostile-mail.js";
export {
  type Endpoint,
  type FakeMailServer,
  type MailAccount,
  type SeedMail,
  type StoredMail,
  startFakeMailServer,
} from "./testing/mail-server.js";
export {
  type SmtpFault,
  type SmtpFaultServer,
  startSmtpFaultServer,
} from "./testing/smtp-faults.js";
