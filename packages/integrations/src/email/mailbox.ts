import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { MailServer } from "./providers.js";
import type { Lookup } from "./servers.js";
import { MailServerRefused, mailTls, resolvePublicHost } from "./servers.js";

/** A mailbox folder, as the folder chips show it. */
export interface MailFolder {
  /** The IMAP path nunio stores. */
  path: string;
  name: string;
  /** Its special use, such as `\Inbox` or `\Sent`, or null. */
  specialUse: string | null;
  /** INBOX is preselected; the student picks the rest. */
  preselected: boolean;
}

export interface MailboxLogin {
  /** The login, often the address. */
  username: string;
  password: string;
  imap: MailServer;
  smtp: MailServer;
}

export type MailboxCheck =
  | { ok: true; folders: MailFolder[] }
  /** A port without TLS (see `mailTls`). */
  | { ok: false; reason: "port_refused" }
  /** A host that doesn't resolve, or not only to public addresses. */
  | { ok: false; reason: "server_refused" }
  /** The step that failed: "Lesen (IMAP)" or "Senden (SMTP)". */
  | { ok: false; reason: "login_failed"; step: "imap" | "smtp" };

// Short enough for the student waiting on the Connect dialog.
const CONNECTION_TIMEOUT = 15_000;

/**
 * Logs in to IMAP and lists the folders, then authenticates to SMTP without sending anything. Each host's address is
 * checked to be public right before nunio connects to it, and its certificate is verified against the host name.
 */
export async function checkMailbox(
  login: MailboxLogin,
  { fakes, lookup }: { fakes: boolean; lookup?: Lookup },
): Promise<MailboxCheck> {
  const imapTls = mailTls("imap", login.imap.port, { fakes });
  const smtpTls = mailTls("smtp", login.smtp.port, { fakes });
  if (!imapTls || !smtpTls) return { ok: false, reason: "port_refused" };
  let imapAddress: string;
  let smtpAddress: string;
  try {
    imapAddress = await resolvePublicHost(login.imap.host, { fakes, lookup });
    smtpAddress = await resolvePublicHost(login.smtp.host, { fakes, lookup });
  } catch (error) {
    if (error instanceof MailServerRefused)
      return { ok: false, reason: "server_refused" };
    throw error;
  }

  // The certificate is checked against the host name; an IP literal host has no SNI name.
  const servername = (host: string) => (isIP(host) ? undefined : host);
  const imap = new ImapFlow({
    host: imapAddress,
    port: login.imap.port,
    servername: servername(login.imap.host),
    secure: imapTls === "implicit",
    doSTARTTLS: imapTls === "starttls" ? true : undefined,
    auth: { user: login.username, pass: login.password },
    disableAutoIdle: true,
    connectionTimeout: CONNECTION_TIMEOUT,
    greetingTimeout: CONNECTION_TIMEOUT,
    socketTimeout: CONNECTION_TIMEOUT * 2,
    logger: false,
  });
  // A failed connection also reports itself as an "error" event; the rejected promise below handles it.
  imap.on("error", () => {});
  let folders: MailFolder[];
  try {
    await imap.connect();
    const listed = await imap.list();
    folders = listed
      .filter((folder) => !folder.flags.has("\\Noselect"))
      .map((folder) => ({
        path: folder.path,
        name: folder.name,
        specialUse: folder.specialUse ?? null,
        preselected: folder.specialUse === "\\Inbox",
      }))
      // INBOX first, then by path, whatever order the server lists them in.
      .sort(
        (a, b) =>
          Number(b.preselected) - Number(a.preselected) ||
          a.path.localeCompare(b.path, "de"),
      );
    await imap.logout();
  } catch {
    imap.close();
    return { ok: false, reason: "login_failed", step: "imap" };
  }

  const smtp = nodemailer.createTransport({
    host: smtpAddress,
    port: login.smtp.port,
    secure: smtpTls === "implicit",
    requireTLS: smtpTls === "starttls",
    auth: { user: login.username, pass: login.password },
    tls: { servername: servername(login.smtp.host) },
    connectionTimeout: CONNECTION_TIMEOUT,
    greetingTimeout: CONNECTION_TIMEOUT,
    socketTimeout: CONNECTION_TIMEOUT * 2,
  });
  try {
    // Connects and authenticates; sends nothing.
    await smtp.verify();
  } catch {
    return { ok: false, reason: "login_failed", step: "smtp" };
  } finally {
    smtp.close();
  }
  return { ok: true, folders };
}
