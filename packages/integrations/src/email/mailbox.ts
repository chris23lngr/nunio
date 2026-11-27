import { isIP } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { MailServer } from "./providers.js";
import type { Lookup, MailTls } from "./servers.js";
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

/** A mail server as nunio connects to it: the address it checked, and the host name the certificate must match. */
export interface MailEndpoint {
  host: string;
  address: string;
  port: number;
  tls: MailTls;
}

// Short enough for the student waiting on the Connect dialog.
const CONNECTION_TIMEOUT = 15_000;

/** A failure before nunio logs in: a port without TLS, or a host that isn't public. */
type EndpointRefusal = { ok: false; reason: "port_refused" | "server_refused" };

/** Holds a server to the port rule and checks its host's address is public right before nunio connects to it. */
export async function mailEndpoint(
  kind: "imap" | "smtp",
  server: MailServer,
  { fakes, lookup }: { fakes: boolean; lookup?: Lookup },
): Promise<MailEndpoint | EndpointRefusal> {
  const tls = mailTls(kind, server.port, { fakes });
  if (!tls) return { ok: false, reason: "port_refused" };
  try {
    const address = await resolvePublicHost(server.host, { fakes, lookup });
    return { ...server, address, tls };
  } catch (error) {
    if (error instanceof MailServerRefused)
      return { ok: false, reason: "server_refused" };
    throw error;
  }
}

/**
 * Holds the servers to the port rule and checks each host's address is public right before nunio connects to it,
 * then logs in (see `loginToMailbox`).
 */
export async function checkMailbox(
  login: MailboxLogin,
  options: { fakes: boolean; lookup?: Lookup },
): Promise<MailboxCheck> {
  // Both ports first: a port without TLS is refused before nunio looks up any host.
  if (
    !mailTls("imap", login.imap.port, options) ||
    !mailTls("smtp", login.smtp.port, options)
  )
    return { ok: false, reason: "port_refused" };
  const imap = await mailEndpoint("imap", login.imap, options);
  if ("ok" in imap) return imap;
  const smtp = await mailEndpoint("smtp", login.smtp, options);
  if ("ok" in smtp) return smtp;
  return loginToMailbox({
    username: login.username,
    password: login.password,
    imap,
    smtp,
  });
}

/** Logs in to IMAP only and lists the folders, for changing them on the Connection's page. */
export async function listMailboxFolders(
  login: Omit<MailboxLogin, "smtp">,
  options: { fakes: boolean; lookup?: Lookup },
): Promise<Exclude<MailboxCheck, { step: "smtp" }>> {
  const imap = await mailEndpoint("imap", login.imap, options);
  if ("ok" in imap) return imap;
  const folders = await imapFolders(login.username, login.password, imap);
  return folders
    ? { ok: true, folders }
    : { ok: false, reason: "login_failed", step: "imap" };
}

/** The certificate is checked against the host name; an IP literal host has no SNI name. */
const servername = (host: string) => (isIP(host) ? undefined : host);

/**
 * Logs in to IMAP and lists the folders, then authenticates to SMTP without sending anything, at endpoints
 * `checkMailbox` already held to the port rule and the public-address check.
 */
export async function loginToMailbox({
  username,
  password,
  imap: imapAt,
  smtp: smtpAt,
}: {
  username: string;
  password: string;
  imap: MailEndpoint;
  smtp: MailEndpoint;
}): Promise<MailboxCheck> {
  const folders = await imapFolders(username, password, imapAt);
  if (!folders) return { ok: false, reason: "login_failed", step: "imap" };

  const smtp = nodemailer.createTransport({
    host: smtpAt.address,
    port: smtpAt.port,
    secure: smtpAt.tls === "implicit",
    requireTLS: smtpAt.tls === "starttls",
    auth: { user: username, pass: password },
    // Authenticates even when the server doesn't advertise AUTH, so a server that would take mail without a
    // login can't pass as one that checked the password.
    forceAuth: true,
    tls: { servername: servername(smtpAt.host) },
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

/**
 * An IMAP client for the endpoint nunio checked: it connects to the checked address and verifies the certificate
 * against the host name. Not yet connected.
 */
export function imapClient(
  username: string,
  password: string,
  imapAt: MailEndpoint,
): ImapFlow {
  const imap = new ImapFlow({
    host: imapAt.address,
    port: imapAt.port,
    servername: servername(imapAt.host),
    secure: imapAt.tls === "implicit",
    doSTARTTLS: imapAt.tls === "starttls" ? true : undefined,
    auth: { user: username, pass: password },
    disableAutoIdle: true,
    connectionTimeout: CONNECTION_TIMEOUT,
    greetingTimeout: CONNECTION_TIMEOUT,
    socketTimeout: CONNECTION_TIMEOUT * 2,
    logger: false,
  });
  // A failed connection also reports itself as an "error" event; the rejected promise handles it.
  imap.on("error", () => {});
  return imap;
}

/** Logs in to IMAP and lists the selectable folders, INBOX first; null when connecting or logging in fails. */
async function imapFolders(
  username: string,
  password: string,
  imapAt: MailEndpoint,
): Promise<MailFolder[] | null> {
  const imap = imapClient(username, password, imapAt);
  try {
    await imap.connect();
    const listed = await imap.list();
    await imap.logout();
    return (
      listed
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
        )
    );
  } catch {
    imap.close();
    return null;
  }
}
