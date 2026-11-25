import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestCertificate } from "../testing/certificate.js";
import { createCertificate } from "../testing/certificate.js";
import type { FakeMailServer, MailAccount } from "../testing.js";
import { startFakeMailServer } from "../testing.js";
import { checkMailbox, loginToMailbox } from "./mailbox.js";

let mail: FakeMailServer;
let student: MailAccount;
let certificate: TestCertificate;
const defaultCAs = getCACertificates("default");

beforeAll(async () => {
  // A certificate for the host name only, so connecting succeeds only if it is checked against that name.
  certificate = createCertificate(["DNS:mail.uni.test"]);
  mail = await startFakeMailServer({
    tls: { ...certificate, hostname: "mail.uni.test" },
  });
  setDefaultCACertificates([...defaultCAs, mail.ca]);
  student = await mail.createAccount("student@uni.test", "richtig");
}, 180_000);

afterAll(async () => {
  setDefaultCACertificates(defaultCAs);
  await mail?.stop();
});

/** Resolves the fake's host name to the loopback address the container is published on. */
const lookup = async () => [{ address: "127.0.0.1", family: 4 }];

describe("checking a mailbox", () => {
  it("connects to the address it checked and verifies the certificate against the host name", async () => {
    const check = await checkMailbox(
      {
        username: student.address,
        password: student.password,
        imap: { host: "mail.uni.test", port: mail.imap.implicitTls.port },
        smtp: { host: "mail.uni.test", port: mail.smtp.implicitTls.port },
      },
      { fakes: true, lookup },
    );
    expect(check).toMatchObject({
      ok: true,
      folders: [{ path: "INBOX", preselected: true }],
    });
  });

  it("fails the IMAP step when the certificate is for another name", async () => {
    const check = await checkMailbox(
      {
        username: student.address,
        password: student.password,
        imap: { host: "other.uni.test", port: mail.imap.implicitTls.port },
        smtp: { host: "mail.uni.test", port: mail.smtp.implicitTls.port },
      },
      { fakes: true, lookup },
    );
    expect(check).toEqual({ ok: false, reason: "login_failed", step: "imap" });
  });
});

describe("checking a mailbox, further", () => {
  it("fails the SMTP step when its certificate is for another name", async () => {
    const check = await checkMailbox(
      {
        username: student.address,
        password: student.password,
        imap: { host: "mail.uni.test", port: mail.imap.implicitTls.port },
        smtp: { host: "other.uni.test", port: mail.smtp.implicitTls.port },
      },
      { fakes: true, lookup },
    );
    expect(check).toEqual({ ok: false, reason: "login_failed", step: "smtp" });
  });

  it("fails the SMTP step when the server doesn't offer AUTH, rather than skipping it", async () => {
    const open = new SMTPServer({
      secure: true,
      key: certificate.key,
      cert: certificate.cert,
      disabledCommands: ["AUTH"],
      logger: false,
    });
    await new Promise<void>((resolve) => open.listen(0, "127.0.0.1", resolve));
    const { port } = open.server.address() as { port: number };
    try {
      const check = await checkMailbox(
        {
          username: student.address,
          password: student.password,
          imap: { host: "mail.uni.test", port: mail.imap.implicitTls.port },
          smtp: { host: "mail.uni.test", port },
        },
        { fakes: true, lookup },
      );
      expect(check).toEqual({
        ok: false,
        reason: "login_failed",
        step: "smtp",
      });
    } finally {
      await new Promise<void>((resolve) => open.close(() => resolve()));
    }
  });

  // The port rule takes STARTTLS only on 143 and 587, which tests can't bind; these call the login directly.
  const startTls = (host = "mail.uni.test") => ({
    imap: {
      host,
      address: "127.0.0.1",
      port: mail.imap.startTls.port,
      tls: "starttls" as const,
    },
    smtp: {
      host,
      address: "127.0.0.1",
      port: mail.smtp.startTls.port,
      tls: "starttls" as const,
    },
  });

  it("logs in to IMAP and authenticates to SMTP over STARTTLS", async () => {
    const check = await loginToMailbox({
      username: student.address,
      password: student.password,
      ...startTls(),
    });
    expect(check).toMatchObject({
      ok: true,
      folders: [{ path: "INBOX", preselected: true }],
    });
  });

  it("checks the certificate after STARTTLS against the host name", async () => {
    const check = await loginToMailbox({
      username: student.address,
      password: student.password,
      ...startTls("other.uni.test"),
    });
    expect(check).toEqual({ ok: false, reason: "login_failed", step: "imap" });
  });

  it("refuses SMTP over STARTTLS when the certificate is for another name", async () => {
    const { imap } = startTls();
    const { smtp } = startTls("other.uni.test");
    const check = await loginToMailbox({
      username: student.address,
      password: student.password,
      imap,
      smtp,
    });
    expect(check).toEqual({ ok: false, reason: "login_failed", step: "smtp" });
  });
});
