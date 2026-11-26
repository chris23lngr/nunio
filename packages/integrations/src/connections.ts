import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Principal, Transaction } from "@nunio/delegation";
import { accessRefusal, withOwner } from "@nunio/delegation";
import type { ConnectionCredentialKeys, SourceKeys } from "@nunio/keys";
import type { MailboxCheck, MailboxLogin } from "./email/mailbox.js";
import { checkMailbox } from "./email/mailbox.js";
import type { MailServer } from "./email/providers.js";
import { discoverMailbox, mailProviderFor } from "./email/providers.js";
import type { Lookup } from "./email/servers.js";
import { mailTls } from "./email/servers.js";
import { createOAuthConnect } from "./oauth.js";

/** A student's Connection as Einstellungen › Verbindungen shows it; never its credentials. */
export interface ConnectionSummary {
  integrationKey: string;
  state: "connected" | "needs_reconnection";
  accountLabel: string;
  /** Email: the folders nunio may read. */
  folders: string[];
  /** How many of the student's Agents use a tool of it. */
  agentCount: number;
}

/** What the student enters in the Connect dialog for Email. */
export interface EmailLogin {
  address: string;
  password: string;
  /** The login, when it isn't the address. */
  username?: string;
  /** Hosts and ports from the manual form or "Server ändern"; by default the recognised provider's. */
  servers?: { imap: MailServer; smtp: MailServer };
}

type Refusal =
  /** Email isn't offered. */
  | { ok: false; reason: "not_offered" }
  /** No active Pilot Entitlement, or a pending deletion: the student may not start new work. */
  | { ok: false; reason: "not_entitled" | "deletion_pending" }
  /** The address's provider needs Microsoft 365 OAuth, a later slice. */
  | { ok: false; reason: "unsupported" }
  /** An unknown domain, and no hosts entered. */
  | { ok: false; reason: "servers_required" }
  /** A port without TLS (see `mailTls`); nothing was contacted. */
  | { ok: false; reason: "port_refused" }
  /** More mailbox logins than `MAIL_LOGIN_LIMIT` allows in its window. */
  | { ok: false; reason: "too_many_attempts" };

/** The student already has an Email Connection. */
type AlreadyConnected = { ok: false; reason: "already_connected" };

export type EmailCheck = MailboxCheck | Refusal;

export type EmailConnect =
  | { ok: true; connection: ConnectionSummary }
  | Exclude<EmailCheck, { ok: true }>
  | AlreadyConnected
  /** A chosen folder the mailbox doesn't have. */
  | { ok: false; reason: "unknown_folder" };

const EMAIL = "email";

/**
 * Mailbox logins per student in a fixed window. Testing and connecting log in to a server the student names with a
 * password they enter, so without a limit nunio could be used to guess passwords for any mailbox.
 */
export const MAIL_LOGIN_LIMIT = { max: 10, windowMs: 15 * 60_000 };

/** A unique violation, as when the student connected Email in another tab meanwhile. */
const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === "P2002";

/**
 * Connections (#261): connecting Email and OAuth Integrations now; reconnecting, folders and disconnecting come with
 * later slices. Credentials are sealed under the "connection credentials" master key, and each Connection gets a
 * content key wrapped like a Source key.
 */
export function createConnections({
  db,
  keys,
  credentials,
  fakes,
  apiOrigin,
  lookup,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  credentials: ConnectionCredentialKeys;
  /** INTEGRATION_FAKES: the `nunio.test` provider, private mail and OAuth hosts and the fakes' ports. */
  fakes: boolean;
  /** The API's own origin, where nunio's Client ID Metadata Document and the OAuth callbacks live. */
  apiOrigin: string;
  lookup?: Lookup;
}) {
  const oauth = createOAuthConnect({ db, keys, credentials, fakes, apiOrigin });

  /** The login nunio tests and stores: the entered servers, or else the recognised provider's. */
  function mailboxLogin(login: EmailLogin): MailboxLogin | Refusal {
    const provider = mailProviderFor(login.address, { fakes });
    if (provider?.auth === "m365_oauth")
      return { ok: false, reason: "unsupported" };
    const servers = login.servers ?? provider;
    if (!servers) return { ok: false, reason: "servers_required" };
    return {
      username: login.username ?? login.address,
      password: login.password,
      imap: { host: servers.imap.host, port: servers.imap.port },
      smtp: { host: servers.smtp.host, port: servers.smtp.port },
    };
  }

  /**
   * Counts a mailbox login against the student's limit in its fixed window; false once the limit is reached. One
   * statement, like the sign-in code limits: the upsert's row lock serialises concurrent attempts across instances.
   */
  function admitLogin(tx: Transaction, studentId: string): Promise<boolean> {
    const now = Date.now();
    const expired = now - MAIL_LOGIN_LIMIT.windowMs;
    return tx.$executeRaw`
      INSERT INTO "mail_login_limit" ("studentId", "count", "windowStart") VALUES (${studentId}, 1, ${now})
      ON CONFLICT ("studentId") DO UPDATE SET
        "count" = CASE WHEN "mail_login_limit"."windowStart" <= ${expired} THEN 1 ELSE "mail_login_limit"."count" + 1 END,
        "windowStart" = CASE WHEN "mail_login_limit"."windowStart" <= ${expired} THEN ${now} ELSE "mail_login_limit"."windowStart" END
      WHERE "mail_login_limit"."windowStart" <= ${expired} OR "mail_login_limit"."count" < ${MAIL_LOGIN_LIMIT.max}`.then(
      (admitted) => admitted === 1,
    );
  }

  /**
   * Everything nunio checks before it logs in to a mailbox, in one transaction: Email offered, the student's access,
   * (when connecting) no Email Connection yet, the servers and their ports, and last the login limit. Only a login
   * nunio will try counts; resolving the hosts comes after it.
   */
  function beforeLogin(
    p: Principal,
    login: EmailLogin,
    options: { connecting: false },
  ): Promise<MailboxLogin | Refusal>;
  function beforeLogin(
    p: Principal,
    login: EmailLogin,
    options: { connecting: true },
  ): Promise<MailboxLogin | Refusal | AlreadyConnected>;
  function beforeLogin(
    p: Principal,
    login: EmailLogin,
    { connecting }: { connecting: boolean },
  ): Promise<MailboxLogin | Refusal | AlreadyConnected> {
    return withOwner(db, p, async (tx, studentId) => {
      const offered = await tx.integration.findFirst({
        where: { key: EMAIL, status: "offered" },
      });
      if (!offered) return { ok: false, reason: "not_offered" };
      const refusal = await accessRefusal(tx, studentId);
      if (refusal) return { ok: false, reason: refusal };
      if (
        connecting &&
        (await tx.connection.findFirst({ where: { integrationKey: EMAIL } }))
      )
        return { ok: false, reason: "already_connected" };
      const mailbox = mailboxLogin(login);
      if ("ok" in mailbox) return mailbox;
      if (
        !mailTls("imap", mailbox.imap.port, { fakes }) ||
        !mailTls("smtp", mailbox.smtp.port, { fakes })
      )
        return { ok: false, reason: "port_refused" };
      if (!(await admitLogin(tx, studentId)))
        return { ok: false, reason: "too_many_attempts" };
      return mailbox;
    });
  }

  return {
    /** nunio's Client ID Metadata Document, served publicly at its client id. */
    clientMetadataDocument: oauth.clientMetadataDocument,
    /** Starts connecting an OAuth Integration: returns the vendor's sign-in URL, or why not. */
    startOAuth: oauth.start,
    /** The vendor's redirect back: creates the Connection, or stores nothing and says why. */
    finishOAuth: oauth.finish,

    /** The student's Connections, by Integration. */
    async list(p: Principal): Promise<ConnectionSummary[]> {
      const rows = await withOwner(db, p, (tx) => tx.connection.findMany());
      return rows.map((row) => ({
        integrationKey: row.integrationKey,
        state: row.state as ConnectionSummary["state"],
        accountLabel: row.accountLabel,
        folders: row.folders,
        // No Agent can use a Connection's tools yet.
        agentCount: 0,
      }));
    },

    /** The university and servers nunio recognises from an address, or "unknown" for the manual form. */
    discoverEmail(address: string) {
      return discoverMailbox(address, { fakes });
    },

    /** Tests reading (IMAP) and sending (SMTP) without sending, and lists the folders; stores nothing. */
    async testEmail(p: Principal, login: EmailLogin): Promise<EmailCheck> {
      const mailbox = await beforeLogin(p, login, { connecting: false });
      if ("ok" in mailbox) return mailbox;
      return checkMailbox(mailbox, { fakes, lookup });
    },

    /**
     * Tests the mailbox again, then saves the Connection with the chosen folders, the servers and the address as its
     * account label, its sealed credentials and a new content key. On any failure it stores nothing.
     */
    async connectEmail(
      p: Principal,
      login: EmailLogin & { folders: string[] },
    ): Promise<EmailConnect> {
      const mailbox = await beforeLogin(p, login, { connecting: true });
      if ("ok" in mailbox) return mailbox;
      const check = await checkMailbox(mailbox, { fakes, lookup });
      if (!check.ok) return check;
      const listed = new Set(check.folders.map((folder) => folder.path));
      if (!login.folders.every((folder) => listed.has(folder)))
        return { ok: false, reason: "unknown_folder" };

      const id = randomUUID();
      const { wrapped } = keys.generateConnectionKey(id);
      const sealed = credentials.seal(
        id,
        JSON.stringify({
          username: mailbox.username,
          password: mailbox.password,
        }),
      );
      const folders = [...new Set(login.folders)];
      try {
        await withOwner(db, p, async (tx, studentId) => {
          await tx.connection.create({
            data: {
              id,
              studentId,
              integrationKey: EMAIL,
              accountLabel: login.address,
              folders,
              servers: {
                imap: { ...mailbox.imap },
                smtp: { ...mailbox.smtp },
              },
              keyVersion: wrapped.version,
              keyCiphertext: wrapped.ciphertext,
            },
          });
          await tx.connectionCredential.create({
            data: {
              connectionId: id,
              studentId,
              keyVersion: sealed.version,
              ciphertext: sealed.ciphertext,
            },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error))
          return { ok: false, reason: "already_connected" };
        throw error;
      }
      return {
        ok: true,
        connection: {
          integrationKey: EMAIL,
          state: "connected",
          accountLabel: login.address,
          folders,
          agentCount: 0,
        },
      };
    },
  };
}

export type Connections = ReturnType<typeof createConnections>;
