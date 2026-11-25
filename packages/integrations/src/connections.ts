import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { ConnectionCredentialKeys, SourceKeys } from "@nunio/keys";
import type { MailboxCheck, MailboxLogin } from "./email/mailbox.js";
import { checkMailbox } from "./email/mailbox.js";
import type { MailServer } from "./email/providers.js";
import { discoverMailbox, mailProviderFor } from "./email/providers.js";
import type { Lookup } from "./email/servers.js";

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
  /** The address's provider needs Microsoft 365 OAuth, a later slice. */
  | { ok: false; reason: "unsupported" }
  /** An unknown domain, and no hosts entered. */
  | { ok: false; reason: "servers_required" };

export type EmailCheck = MailboxCheck | Refusal;

export type EmailConnect =
  | { ok: true; connection: ConnectionSummary }
  | Exclude<EmailCheck, { ok: true }>
  /** Email isn't offered. */
  | { ok: false; reason: "not_offered" }
  /** The student already has an Email Connection. */
  | { ok: false; reason: "already_connected" }
  /** A chosen folder the mailbox doesn't have. */
  | { ok: false; reason: "unknown_folder" };

const EMAIL = "email";

/** A unique violation, as when the student connected Email in another tab meanwhile. */
const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === "P2002";

/**
 * Connections (#261): connecting Email now; OAuth, reconnecting, folders and disconnecting come with later slices.
 * Credentials are sealed under the "connection credentials" master key, and each Connection gets a content key
 * wrapped like a Source key.
 */
export function createConnections({
  db,
  keys,
  credentials,
  fakes,
  lookup,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  credentials: ConnectionCredentialKeys;
  /** INTEGRATION_FAKES: the `nunio.test` provider, private mail hosts and the fakes' ports. */
  fakes: boolean;
  lookup?: Lookup;
}) {
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

  return {
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
    async testEmail(login: EmailLogin): Promise<EmailCheck> {
      const mailbox = mailboxLogin(login);
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
      const offered = await db.integration.findFirst({
        where: { key: EMAIL, status: "offered" },
      });
      if (!offered) return { ok: false, reason: "not_offered" };
      const existing = await withOwner(db, p, (tx) =>
        tx.connection.findFirst({ where: { integrationKey: EMAIL } }),
      );
      if (existing) return { ok: false, reason: "already_connected" };

      const mailbox = mailboxLogin(login);
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
