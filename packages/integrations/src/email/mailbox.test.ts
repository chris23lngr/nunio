import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCertificate } from "../testing/certificate.js";
import type { FakeMailServer, MailAccount } from "../testing.js";
import { startFakeMailServer } from "../testing.js";
import { checkMailbox } from "./mailbox.js";

let mail: FakeMailServer;
let student: MailAccount;
const defaultCAs = getCACertificates("default");

beforeAll(async () => {
  // A certificate for the host name only, so connecting succeeds only if it is checked against that name.
  mail = await startFakeMailServer({
    tls: {
      ...createCertificate(["DNS:mail.uni.test"]),
      hostname: "mail.uni.test",
    },
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
