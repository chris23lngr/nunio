/**
 * Integrations, Connections, and Destination executors.
 */
export { createActionArgs } from "./action-args.js";
export {
  type Catalog,
  type CatalogIntegration,
  type CatalogTool,
  createCatalog,
  isGrantable,
  type ToolClass,
} from "./catalog.js";
export {
  type ConnectionDetail,
  type ConnectionSummary,
  type Connections,
  type ConnectionTool,
  createConnections,
  type EmailCheck,
  type EmailConnect,
  type EmailLogin,
  type FolderListing,
  type ToolMode,
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
export {
  callMcpWrite,
  createIntegrationExecutor,
  WRITE_TIMEOUT_MS,
  type WriteFailure,
} from "./executor.js";
export { integrationFakes } from "./fakes.js";
export { definitionHash, type ToolDefinition } from "./pin.js";
export {
  createIntegrationReads,
  type IntegrationReads,
  READ_TIMEOUT_MS,
  type ReadResult,
  type ReadSession,
} from "./reads.js";
export { READ_RESULT_MAX_CHARACTERS } from "./shape.js";
