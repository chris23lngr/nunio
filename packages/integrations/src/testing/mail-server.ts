/**
 * A throwaway GreenMail with real IMAP and SMTP over TLS, for Email tests.
 *
 * GreenMail serves implicit TLS itself; STARTTLS goes through an in-process front (see `starttls.ts`). It has no
 * SPECIAL-USE, so a folder's special use comes from its name, as `imapflow` reads a `Sent` folder as `\Sent`.
 */
import { createSecureContext } from "node:tls";
import type { FetchMessageObject } from "imapflow";
import { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer";
import { GenericContainer, Wait } from "testcontainers";
import { P12_PASSWORD, testCertificate } from "./certificate.js";
import { startStartTlsFront } from "./starttls.js";

export interface Endpoint {
  host: string;
  port: number;
}

export interface MailAccount {
  address: string;
  password: string;
}

export interface SeedMail {
  from: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  /** The text body; quoted history is part of it. */
  text?: string;
  html?: string;
  date?: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: { filename: string; content: string | Buffer }[];
  /** IMAP flags such as `\Seen`; a seeded mail is unread by default. */
  flags?: string[];
}

export interface StoredMail {
  uid: number;
  flags: string[];
  envelope: NonNullable<FetchMessageObject["envelope"]>;
  /** The raw RFC 822 message. */
  source: string;
}

export interface FakeMailServer {
  /** PEM of the CA behind every TLS endpoint; clients pass it as `tls.ca`. */
  ca: string;
  imap: { implicitTls: Endpoint; startTls: Endpoint };
  smtp: { implicitTls: Endpoint; startTls: Endpoint };
  /** The address is also the login. */
  createAccount(address: string, password: string): Promise<MailAccount>;
  createFolder(account: MailAccount, path: string): Promise<void>;
  /** APPENDs the mail to `folder` and returns its UID. */
  seed(account: MailAccount, folder: string, mail: SeedMail): Promise<number>;
  /** Every mail in `folder`, read with PEEK so flags stay as they were. */
  messages(account: MailAccount, folder: string): Promise<StoredMail[]>;
  stop(): Promise<void>;
}

const IMAP = 3143;
const IMAPS = 3993;
const SMTP = 3025;
const SMTPS = 3465;
const API = 8080;
const KEYSTORE = "/home/greenmail/greenmail.p12";

export async function startFakeMailServer(): Promise<FakeMailServer> {
  const certificate = testCertificate();
  const container = await new GenericContainer("greenmail/standalone:2.1.15")
    .withEnvironment({
      // The image's default plus its own keystore path, minus `auth.disabled`, so passwords count.
      GREENMAIL_OPTS: [
        "-Dgreenmail.setup.test.all",
        "-Dgreenmail.hostname=0.0.0.0",
        `-Dgreenmail.tls.keystore.file=${KEYSTORE}`,
        `-Dgreenmail.tls.keystore.password=${P12_PASSWORD}`,
      ].join(" "),
    })
    .withCopyContentToContainer([
      { content: certificate.p12, target: KEYSTORE, mode: 0o644 },
    ])
    .withExposedPorts(IMAP, IMAPS, SMTP, SMTPS, API)
    .withWaitStrategy(Wait.forHttp("/api/service/readiness", API))
    .start();

  const host = container.getHost();
  const endpoint = (port: number): Endpoint => ({
    host,
    port: container.getMappedPort(port),
  });
  const secureContext = createSecureContext({
    key: certificate.key,
    cert: certificate.cert,
  });
  const fronts = await Promise.all([
    startStartTlsFront("imap", endpoint(IMAP), secureContext),
    startStartTlsFront("smtp", endpoint(SMTP), secureContext),
  ]).catch(async (error) => {
    await container.stop();
    throw error;
  });
  const [imapFront, smtpFront] = fronts;
  const api = `http://${host}:${container.getMappedPort(API)}`;
  const imaps = endpoint(IMAPS);

  async function withImap<T>(
    account: MailAccount,
    run: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow({
      ...imaps,
      secure: true,
      auth: { user: account.address, pass: account.password },
      tls: { ca: certificate.ca },
      logger: false,
    });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.logout();
    }
  }

  return {
    ca: certificate.ca,
    imap: {
      implicitTls: imaps,
      startTls: { host: "127.0.0.1", port: imapFront.port },
    },
    smtp: {
      implicitTls: endpoint(SMTPS),
      startTls: { host: "127.0.0.1", port: smtpFront.port },
    },
    async createAccount(address, password) {
      const response = await fetch(`${api}/api/user`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address, login: address, password }),
      });
      if (!response.ok)
        throw new Error(
          `GreenMail refused account ${address}: ${response.status}`,
        );
      return { address, password };
    },
    async createFolder(account, path) {
      await withImap(account, (client) => client.mailboxCreate(path));
    },
    async seed(account, folder, { flags = [], ...mail }) {
      const raw = await new MailComposer(mail).compile().build();
      const appended = await withImap(account, (client) =>
        client.append(folder, raw, flags),
      );
      if (!appended || appended.uid === undefined)
        throw new Error(`GreenMail did not append to ${folder}`);
      return appended.uid;
    },
    messages(account, folder) {
      return withImap(account, async (client) => {
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          if (client.mailbox === false || client.mailbox.exists === 0)
            return [];
          const fetched = await client.fetchAll("1:*", {
            uid: true,
            flags: true,
            envelope: true,
            source: true,
          });
          return fetched.map((message) => ({
            uid: message.uid,
            flags: [...(message.flags ?? [])],
            envelope: message.envelope ?? {},
            source: message.source?.toString("utf8") ?? "",
          }));
        } finally {
          lock.release();
        }
      });
    },
    async stop() {
      await Promise.all(fronts.map((front) => front.close()));
      await container.stop();
    },
  };
}
