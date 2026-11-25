/**
 * Integrations, Connections, and Destination executors.
 */
export {
  type Catalog,
  type CatalogIntegration,
  type CatalogTool,
  createCatalog,
  isGrantable,
  type ToolClass,
} from "./catalog.js";
export {
  type ConnectionSummary,
  type Connections,
  createConnections,
  type EmailCheck,
  type EmailConnect,
  type EmailLogin,
} from "./connections.js";
export type { MailboxCheck, MailFolder } from "./email/mailbox.js";
export {
  type Discovery,
  discoverMailbox,
  type MailProvider,
  type MailServer,
  mailProviderFor,
  mailProviders,
} from "./email/providers.js";
export {
  type Lookup,
  MailServerRefused,
  type MailTls,
  mailTls,
  resolvePublicHost,
} from "./email/servers.js";
export { integrationFakes } from "./fakes.js";
export { definitionHash, type ToolDefinition } from "./pin.js";
