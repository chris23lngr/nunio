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
  type AuthorizationFault,
  type FakeMcpServer,
  type FakeMcpServerOptions,
  type McpFault,
  type ReceivedCall,
  type Revocation,
  startFakeMcpServer,
  type TokenRequest,
} from "./testing/mcp-server.js";
export { seedIntegrationCatalog } from "./testing/seed.js";
export {
  type SmtpFault,
  type SmtpFaultServer,
  startSmtpFaultServer,
} from "./testing/smtp-faults.js";
export { testnotizenTools } from "./testing/testnotizen.js";
