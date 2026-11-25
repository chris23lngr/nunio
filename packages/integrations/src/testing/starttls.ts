/**
 * GreenMail offers no STARTTLS, so this front speaks the plaintext opening of IMAP or SMTP up to STARTTLS, upgrades
 * the client to TLS, and from then on pipes it to GreenMail's plain port. Everything after the upgrade, login
 * included, is GreenMail's own.
 */
import type { Socket } from "node:net";
import { createServer, connect as tcpConnect } from "node:net";
import type { SecureContext } from "node:tls";
import { TLSSocket } from "node:tls";

export interface StartTlsFront {
  port: number;
  close(): Promise<void>;
}

type Reply = (line: string) => { reply: string; upgrade?: true; end?: true };

const dialogues: Record<"imap" | "smtp", { greeting: string; reply: Reply }> = {
  imap: {
    greeting:
      "* OK [CAPABILITY IMAP4rev1 STARTTLS LOGINDISABLED] fake ready\r\n",
    reply: (line) => {
      const [tag = "*", command = ""] = line.split(" ");
      switch (command.toUpperCase()) {
        case "CAPABILITY":
          return {
            reply: `* CAPABILITY IMAP4rev1 STARTTLS LOGINDISABLED\r\n${tag} OK done\r\n`,
          };
        case "STARTTLS":
          return { reply: `${tag} OK begin TLS\r\n`, upgrade: true };
        case "LOGOUT":
          return { reply: `* BYE\r\n${tag} OK done\r\n`, end: true };
        default:
          return { reply: `${tag} BAD STARTTLS first\r\n` };
      }
    },
  },
  smtp: {
    greeting: "220 fake ESMTP\r\n",
    reply: (line) => {
      switch (line.split(" ")[0]?.toUpperCase()) {
        case "EHLO":
          return { reply: "250-fake\r\n250 STARTTLS\r\n" };
        case "STARTTLS":
          return { reply: "220 begin TLS\r\n", upgrade: true };
        case "QUIT":
          return { reply: "221 bye\r\n", end: true };
        default:
          return { reply: "530 STARTTLS first\r\n" };
      }
    },
  },
};

export async function startStartTlsFront(
  protocol: "imap" | "smtp",
  upstream: { host: string; port: number },
  secureContext: SecureContext,
): Promise<StartTlsFront> {
  const { greeting, reply } = dialogues[protocol];
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };

  const server = createServer((client) => {
    track(client);
    client.write(greeting);
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("latin1");
      let end = buffered.indexOf("\r\n");
      while (end >= 0) {
        const answer = reply(buffered.slice(0, end));
        buffered = buffered.slice(end + 2);
        if (answer.upgrade) {
          client.off("data", onData);
          client.write(answer.reply);
          upgrade(client);
          return;
        }
        if (answer.end) {
          client.end(answer.reply);
          return;
        }
        client.write(answer.reply);
        end = buffered.indexOf("\r\n");
      }
    };
    client.on("data", onData);
  });

  // The upstream's greeting is swallowed: the client already had one, and speaks first after TLS.
  function upgrade(client: Socket) {
    const secure = new TLSSocket(client, { isServer: true, secureContext });
    track(secure);
    secure.pause();
    const plain = tcpConnect(upstream);
    track(plain);
    secure.on("close", () => plain.destroy());
    plain.on("close", () => secure.destroy());
    plain.once("data", (greetingChunk) => {
      const rest = greetingChunk.subarray(greetingChunk.indexOf("\r\n") + 2);
      if (rest.length > 0) secure.write(rest);
      plain.pipe(secure);
      secure.pipe(plain);
      secure.resume();
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The STARTTLS front has no TCP port");
  return {
    port: address.port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
