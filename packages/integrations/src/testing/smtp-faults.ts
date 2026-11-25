/**
 * An in-process SMTP server that fails the way GreenMail can't. It offers STARTTLS under the fakes' shared CA and
 * accepts any login, so a client configured for a real server reaches the fault.
 */
import type { Socket } from "node:net";
import { createServer } from "node:net";
import { SMTPServer } from "smtp-server";
import { testCertificate } from "./certificate.js";
import type { Endpoint } from "./mail-server.js";

export type SmtpFault =
  /** `550` to MAIL FROM, before any DATA. */
  | "reject-before-data"
  /** Takes the whole message and never answers. */
  | "no-reply-after-data"
  /** Takes the whole message and closes the connection without answering. */
  | "drop-after-data"
  /** Nothing listens on the port. */
  | "refuse-connection";

export interface SmtpFaultServer extends Endpoint {
  /** PEM of the CA behind STARTTLS; clients pass it as `tls.ca`. */
  ca: string;
  stop(): Promise<void>;
}

export async function startSmtpFaultServer(
  fault: SmtpFault,
): Promise<SmtpFaultServer> {
  const { ca, key, cert } = testCertificate();
  const host = "127.0.0.1";
  if (fault === "refuse-connection")
    return { host, port: await closedPort(host), ca, stop: async () => {} };

  const sockets = new Set<Socket>();
  const server = new SMTPServer({
    key,
    cert,
    logger: false,
    onAuth: (_auth, _session, callback) => callback(null, { user: "fake" }),
    onMailFrom: (_address, _session, callback) => {
      if (fault !== "reject-before-data") return callback();
      callback(
        Object.assign(new Error("Mailbox unavailable"), { responseCode: 550 }),
      );
    },
    onData: (stream, _session) => {
      stream.resume();
      stream.on("end", () => {
        if (fault === "drop-after-data")
          for (const socket of sockets) socket.destroy();
      });
    },
  });
  server.server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.server.address();
  if (address === null || typeof address === "string")
    throw new Error("The SMTP fault server has no TCP port");
  return {
    host,
    port: address.port,
    ca,
    stop: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A port that was just free and now has nothing listening, so connecting is refused. */
async function closedPort(host: string): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string")
    throw new Error("No free TCP port");
  return address.port;
}
