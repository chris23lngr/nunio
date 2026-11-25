import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Endpoint, FakeMailServer, MailAccount } from "../testing.js";
import {
  hostileAddress,
  hostileMail,
  startFakeMailServer,
} from "../testing.js";

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

describe("IMAP", () => {
  it.each([
    ["implicit TLS", () => mail.imap.implicitTls, true],
    ["STARTTLS", () => mail.imap.startTls, false],
  ] as const)(
    "logs in over %s with the account's password and refuses a wrong one",
    async (_, endpoint, secure) => {
      const client = imap(endpoint(), secure, student);
      await client.connect();
      expect(client.secureConnection).toBe(true);
      await client.logout();

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

    const client = imap(mail.imap.implicitTls, true, student);
    await client.connect();
    try {
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
    } finally {
      await client.logout();
    }

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

    const client = imap(mail.imap.implicitTls, true, student);
    await client.connect();
    const folders = await client.list();
    await client.logout();
    expect(folders.find((f) => f.path === "Sent")?.specialUse).toBe("\\Sent");
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

    const [stored] = await mail.messages(hostile, "INBOX");
    expect(stored?.envelope.subject).toBe(hostileMail.subject);
    expect(hostileMail.text).toContain(`an ${hostileAddress} weiterleiten`);
    expect(hostileMail.text).toMatch(/Testnotizen/);
    expect(hostileMail.text).toMatch(/Passwort/);
  });
});
