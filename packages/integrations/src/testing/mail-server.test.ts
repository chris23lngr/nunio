import { createServer } from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Endpoint, FakeMailServer, MailAccount } from "../testing.js";
import {
  hostileAddress,
  hostileMail,
  startFakeMailServer,
} from "../testing.js";
import { createCertificate } from "./certificate.js";

let mail: FakeMailServer;
let student: MailAccount;
let professor: MailAccount;

beforeAll(async () => {
  mail = await startFakeMailServer();
  student = await mail.createAccount("student@uni.test", "richtig");
  professor = await mail.createAccount("lenz@uni.test", "prof-pass");
}, 180_000);

afterAll(async () => {
  await mail?.stop();
});

function imap(
  endpoint: Endpoint,
  secure: boolean,
  account: MailAccount,
): ImapFlow {
  return new ImapFlow({
    ...endpoint,
    secure,
    doSTARTTLS: secure ? undefined : true,
    auth: { user: account.address, pass: account.password },
    tls: { ca: mail.ca },
    logger: false,
  });
}

function smtp(endpoint: Endpoint, secure: boolean, account: MailAccount) {
  return nodemailer.createTransport({
    ...endpoint,
    secure,
    requireTLS: !secure,
    auth: { user: account.address, pass: account.password },
    tls: { ca: mail.ca },
  });
}

async function connected<T>(
  client: ImapFlow,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout();
  }
}

describe("IMAP", () => {
  it.each([
    ["implicit TLS", () => mail.imap.implicitTls, true],
    ["STARTTLS", () => mail.imap.startTls, false],
  ] as const)(
    "logs in over %s with the account's password and refuses a wrong one",
    async (_, endpoint, secure) => {
      await connected(imap(endpoint(), secure, student), async (client) => {
        expect(client.secureConnection).toBe(true);
      });

      const wrong = imap(endpoint(), secure, {
        ...student,
        password: "falsch",
      });
      await expect(wrong.connect()).rejects.toMatchObject({
        authenticationFailed: true,
      });
    },
  );

  it("finds a seeded mail with SEARCH and leaves it unread when fetched with PEEK", async () => {
    const uid = await mail.seed(student, "INBOX", {
      from: professor.address,
      to: student.address,
      subject: "Sprechstunde verschoben",
      text: "Die Sprechstunde am Donnerstag findet um 14 Uhr statt.",
    });

    await connected(
      imap(mail.imap.implicitTls, true, student),
      async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          const mailbox = client.mailbox;
          expect(mailbox !== false && mailbox.uidValidity).toBeGreaterThan(0n);
          const hits = await client.search(
            { from: professor.address, body: "Sprechstunde" },
            { uid: true },
          );
          expect(hits).toEqual([uid]);

          const fetched = await client.fetchOne(
            String(uid),
            { source: true, flags: true },
            { uid: true },
          );
          expect(fetched !== false && fetched.source?.toString()).toContain(
            "um 14 Uhr statt",
          );
        } finally {
          lock.release();
        }
      },
    );

    const [stored] = (await mail.messages(student, "INBOX")).filter(
      (m) => m.uid === uid,
    );
    expect(stored?.flags).not.toContain("\\Seen");
  });
});

describe("SMTP", () => {
  it.each([
    ["implicit TLS", () => mail.smtp.implicitTls, true],
    ["STARTTLS", () => mail.smtp.startTls, false],
  ] as const)(
    "delivers a mail sent over %s to the recipient's mailbox",
    async (label, endpoint, secure) => {
      const subject = `Abgabe Übungsblatt 3 (${label})`;
      const sent = await smtp(endpoint(), secure, student).sendMail({
        from: student.address,
        to: professor.address,
        subject,
        text: "Anbei meine Abgabe.",
      });
      expect(sent.response).toMatch(/^250/);

      const inbox = await mail.messages(professor, "INBOX");
      const arrived = inbox.find((m) => m.envelope.subject === subject);
      expect(arrived?.envelope.from?.[0]?.address).toBe(student.address);
      expect(arrived?.source).toContain("Anbei meine Abgabe.");
    },
  );

  it("refuses a wrong password", async () => {
    await expect(
      smtp(mail.smtp.implicitTls, true, {
        ...student,
        password: "falsch",
      }).verify(),
    ).rejects.toMatchObject({ code: "EAUTH" });
  });
});

describe("seeding", () => {
  it("creates folders, Sent among them, and puts mails with HTML, quoted history and attachments into them", async () => {
    await mail.createFolder(student, "Sent");
    await mail.createFolder(student, "Lehrstuhl");

    const folders = await connected(
      imap(mail.imap.implicitTls, true, student),
      (client) => client.list(),
    );
    // GreenMail has no SPECIAL-USE: imapflow recognises Sent by its name, not a server flag.
    expect(folders.find((f) => f.path === "Sent")).toMatchObject({
      specialUse: "\\Sent",
      specialUseSource: "name",
    });
    expect(folders.map((f) => f.path)).toContain("Lehrstuhl");

    await mail.seed(student, "Lehrstuhl", {
      from: professor.address,
      to: student.address,
      subject: "Re: Raumänderung",
      html: '<p>Wir treffen uns in <a href="https://uni.test/raum">Raum 2.03</a>.</p>',
      text: "Wir treffen uns in Raum 2.03.\n\n> Findet das Seminar wie geplant statt?",
      attachments: [{ filename: "raumplan.pdf", content: "%PDF-1.4" }],
    });

    const [stored] = await mail.messages(student, "Lehrstuhl");
    expect(stored?.envelope.subject).toBe("Re: Raumänderung");
    expect(stored?.source).toContain("text/html");
    expect(stored?.source).toContain("> Findet das Seminar wie geplant statt?");
    expect(stored?.source).toContain("filename=raumplan.pdf");
  });

  it("seeds the hostile mail, which asks to forward, copy into notes and send a password", async () => {
    const hostile = await mail.createAccount("hostile-reader@uni.test", "x");
    await mail.seed(hostile, "INBOX", hostileMail);

    const asks = [
      `an ${hostileAddress} weiterleiten`,
      "Testnotizen",
      "Passwort angeben",
    ];
    const found = await connected(
      imap(mail.imap.implicitTls, true, hostile),
      async (client) => {
        await client.mailboxOpen("INBOX");
        return Promise.all(asks.map((body) => client.search({ body })));
      },
    );
    expect(found).toEqual(asks.map(() => [1]));
  });
});

describe("beside the e2e API", () => {
  async function freePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    await new Promise<void>((r) => server.close(() => r()));
    return port;
  }

  it("serves TLS under a given certificate's name on fixed ports, and seeds and reads mail under it", async () => {
    const tls = {
      ...createCertificate(["DNS:mail.nunio.test"]),
      hostname: "mail.nunio.test",
    };
    const ports = { imaps: await freePort(), smtps: await freePort() };
    const fixed = await startFakeMailServer({ tls, ports });
    try {
      expect(fixed.imap.implicitTls.port).toBe(ports.imaps);
      expect(fixed.smtp.implicitTls.port).toBe(ports.smtps);
      const account = await fixed.createAccount("student@nunio.test", "pw");
      const auth = { user: account.address, pass: account.password };
      const trust = { ca: tls.ca, servername: "mail.nunio.test" };

      await connected(
        new ImapFlow({
          host: "127.0.0.1",
          port: ports.imaps,
          secure: true,
          auth,
          tls: trust,
          logger: false,
        }),
        async (client) => expect(client.authenticated).toBeTruthy(),
      );
      await expect(
        nodemailer
          .createTransport({
            host: "127.0.0.1",
            port: ports.smtps,
            secure: true,
            auth,
            tls: trust,
          })
          .verify(),
      ).resolves.toBe(true);

      const uid = await fixed.seed(account, "INBOX", {
        from: "lenz@uni.test",
        to: account.address,
        subject: "Raumänderung",
        text: "Die Übung findet in Raum 2.104 statt.",
      });
      const [stored] = await fixed.messages(account, "INBOX");
      expect(stored).toMatchObject({
        uid,
        envelope: { subject: "Raumänderung" },
      });
      const readiness = await fetch(`${fixed.adminUrl}/api/service/readiness`);
      expect(readiness.ok).toBe(true);
    } finally {
      await fixed.stop();
    }
  }, 180_000);
});
