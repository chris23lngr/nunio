import nodemailer from "nodemailer";
import { afterEach, describe, expect, it } from "vitest";
import type { SmtpFault, SmtpFaultServer } from "../testing.js";
import { startSmtpFaultServer } from "../testing.js";

let server: SmtpFaultServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function send(fault: SmtpFault) {
  server = await startSmtpFaultServer(fault);
  return nodemailer
    .createTransport({
      host: server.host,
      port: server.port,
      requireTLS: true,
      auth: { user: "student@uni.test", pass: "egal" },
      tls: { ca: server.ca },
      socketTimeout: 1_000,
    })
    .sendMail({
      from: "student@uni.test",
      to: "lenz@uni.test",
      subject: "Abgabe",
      text: "Anbei meine Abgabe.",
    });
}

describe("SMTP fault server", () => {
  it("rejects the mail before DATA", async () => {
    await expect(send("reject-before-data")).rejects.toMatchObject({
      code: "EENVELOPE",
      responseCode: 550,
    });
  });

  it("takes DATA and never answers 250", async () => {
    await expect(send("no-reply-after-data")).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
  });

  it("drops the connection after DATA", async () => {
    await expect(send("drop-after-data")).rejects.toMatchObject({
      code: "ECONNECTION",
    });
  });

  it("refuses the connection", async () => {
    await expect(send("refuse-connection")).rejects.toMatchObject({
      code: "ESOCKET",
    });
  });
});
