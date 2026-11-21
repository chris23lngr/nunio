import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Auth } from "./auth.js";
import { createAuth } from "./auth.js";

const origin = "http://localhost:3000";
const run = Date.now().toString(36);
const email = (name: string) => `${name}+${run}@example.com`;

let db: TestDatabase;
let prisma: PrismaClient;
let admin: PrismaClient;
let auth: Auth;
const messages: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient(createPool(db.runtimeConnectionString));
  admin = createPrismaClient(createPool(db.connectionString));
  auth = createAuth({
    prisma,
    baseURL: origin,
    appOrigin: origin,
    trustedOrigins: [origin],
    secret: "passkey-test-secret-that-is-long-enough",
    email: {
      projectId: "test-project",
      secretKey: "test-scaleway-key",
      from: "accounts@nunio.test",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          to: { email: string }[];
          subject: string;
          text: string;
        };
        messages.push({
          to: body.to[0]!.email,
          subject: body.subject,
          text: body.text,
        });
        return Response.json(
          { emails: [{ id: "test-email" }] },
          { status: 201 },
        );
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A platform authenticator in software: ES256 keys and `none` attestation, as WebAuthn L3 describes them. */
class Authenticator {
  readonly id = randomBytes(16).toString("base64url");
  private readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  private counter = 0;

  constructor(private readonly userVerified = true) {}

  private authenticatorData(attested: boolean): Buffer {
    const flags = 0x01 | (this.userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(++this.counter);
    const parts = [
      createHash("sha256").update(new URL(origin).hostname).digest(),
      Buffer.from([flags]),
      counter,
    ];
    if (attested) {
      const jwk = this.keys.publicKey.export({ format: "jwk" });
      const credentialId = Buffer.from(this.id, "base64url");
      const length = Buffer.alloc(2);
      length.writeUInt16BE(credentialId.length);
      const publicKey = isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x!, "base64url")],
          [-3, Buffer.from(jwk.y!, "base64url")],
        ]),
      );
      parts.push(
        Buffer.alloc(16),
        length,
        credentialId,
        Buffer.from(publicKey),
      );
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin }));
  }

  create(challenge: string) {
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", this.authenticatorData(true)],
      ]) as never,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData("webauthn.create", challenge).toString(
          "base64url",
        ),
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        transports: ["internal"],
      },
    };
  }

  get(challenge: string) {
    const clientDataJSON = this.clientData("webauthn.get", challenge);
    const authenticatorData = this.authenticatorData(false);
    const signature = createSign("SHA256")
      .update(
        Buffer.concat([
          authenticatorData,
          createHash("sha256").update(clientDataJSON).digest(),
        ]),
      )
      .sign(this.keys.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }
}

function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ origin });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

/** The cookies a response sets, joined with `cookie` as a browser would send them. */
function withCookies(response: Response, cookie = ""): string {
  const set = response.headers.getSetCookie().map((c) => c.split(";")[0]!);
  return [cookie, ...set].filter(Boolean).join("; ");
}

/** A verified student and a session created now. */
async function student(name: string) {
  const address = email(name);
  await admin.user.create({
    data: {
      id: randomBytes(12).toString("hex"),
      name,
      email: address,
      emailVerified: true,
    },
  });
  await call("/email-otp/send-verification-otp", {
    body: { email: address, type: "sign-in" },
  });
  const code = messages
    .findLast((message) => message.to === address)!
    .text.match(/\b\d{6}\b/)![0];
  const signIn = await call("/sign-in/email-otp", {
    body: { email: address, otp: code },
  });
  expect(signIn.status).toBe(200);
  return { address, cookie: withCookies(signIn) };
}

async function addPasskey(
  cookie: string,
  authenticator: Authenticator,
  name = "MacBook – Safari",
) {
  const options = await call(
    `/passkey/generate-register-options?name=${encodeURIComponent(name)}`,
    { cookie },
  );
  if (options.status !== 200) return options;
  const { challenge } = (await options.json()) as { challenge: string };
  return call("/passkey/verify-registration", {
    cookie: withCookies(options, cookie),
    body: { response: authenticator.create(challenge), name },
  });
}

async function signInWithPasskey(authenticator: Authenticator) {
  const options = await call("/passkey/generate-authenticate-options");
  const { challenge } = (await options.json()) as { challenge: string };
  return call("/passkey/verify-authentication", {
    cookie: withCookies(options),
    body: { response: authenticator.get(challenge) },
  });
}

async function passkeys(cookie: string) {
  return (await (
    await call("/passkey/list-user-passkeys", { cookie })
  ).json()) as {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
  }[];
}

describe("adding a passkey", () => {
  it("asks the browser for a passkey with user verification on the app's host", async () => {
    const { cookie } = await student("options");
    const response = await call("/passkey/generate-register-options", {
      cookie,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rp: { id: "localhost", name: "nunio" },
      authenticatorSelection: { userVerification: "required" },
    });
  });

  it("registers a passkey from a recent sign-in and lists it", async () => {
    const { cookie } = await student("adds");
    const response = await addPasskey(cookie, new Authenticator());

    expect(response.status).toBe(200);
    expect(await passkeys(cookie)).toEqual([
      expect.objectContaining({ name: "MacBook – Safari", lastUsedAt: null }),
    ]);
  });

  it("refuses a passkey that did not verify the student", async () => {
    const { cookie } = await student("no-verification");
    const response = await addPasskey(cookie, new Authenticator(false));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await passkeys(cookie)).toEqual([]);
  });

  it("asks the student to sign in again after ten minutes", async () => {
    const { cookie } = await student("adds-late");
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    const response = await addPasskey(cookie, new Authenticator());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
  });

  it("emails the student the passkey's name and time, without a link", async () => {
    const { address, cookie } = await student("security-mail");
    await addPasskey(cookie, new Authenticator(), "iPhone – Safari");

    const message = messages.findLast((message) => message.to === address);
    expect(message?.subject).toBe("Neuer Passkey für dein nunio-Konto");
    expect(message?.text).toContain("iPhone – Safari");
    expect(message?.text).toMatch(/\d{2}\.\d{2}\.\d{4} um \d{2}:\d{2} Uhr/);
    expect(message?.text).not.toMatch(/https?:\/\//);
  });
});

describe("signing in with a passkey", () => {
  it("creates a session and records when the passkey was last used", async () => {
    const { address, cookie } = await student("passkey-sign-in");
    const authenticator = new Authenticator();
    await addPasskey(cookie, authenticator);
    const response = await signInWithPasskey(authenticator);

    expect(response.status).toBe(200);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: withCookies(response) }),
      query: { disableRefresh: true },
    });
    expect(session?.user.email).toBe(address);
    const [listed] = await passkeys(cookie);
    expect(listed?.lastUsedAt).not.toBeNull();
  });

  it("records no use when the sign-in is refused", async () => {
    const { address, cookie } = await student("passkey-refused");
    const authenticator = new Authenticator();
    await addPasskey(cookie, authenticator);
    const { id: studentId } = await admin.user.findUniqueOrThrow({
      where: { email: address },
    });
    await admin.deletionRequest.create({ data: { studentId } });
    const response = await signInWithPasskey(authenticator);

    expect(response.status).toBe(403);
    const [stored] = await admin.passkey.findMany({
      where: { userId: studentId },
    });
    expect(stored?.lastUsedAt).toBeNull();
  });

  it("asks the browser for user verification", async () => {
    const response = await call("/passkey/generate-authenticate-options");

    expect(await response.json()).toMatchObject({
      rpId: "localhost",
      userVerification: "required",
    });
  });

  it("counts as a recent sign-in for sensitive actions", async () => {
    const { cookie } = await student("passkey-recent");
    const authenticator = new Authenticator();
    await addPasskey(cookie, authenticator);
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 60 * 60_000);
    const fresh = withCookies(await signInWithPasskey(authenticator));

    expect(
      (await call("/revoke-sessions", { body: {}, cookie: fresh })).status,
    ).toBe(200);
  });
});

describe("deleting a passkey", () => {
  it("deletes any of the student's passkeys from a recent sign-in, including the last", async () => {
    const { cookie } = await student("deletes");
    await addPasskey(cookie, new Authenticator());
    const [listed] = await passkeys(cookie);
    const response = await call("/passkey/delete-passkey", {
      cookie,
      body: { id: listed!.id },
    });

    expect(response.status).toBe(200);
    expect(await passkeys(cookie)).toEqual([]);
  });

  it("asks the student to sign in again after ten minutes", async () => {
    const { cookie } = await student("deletes-late");
    await addPasskey(cookie, new Authenticator());
    const [listed] = await passkeys(cookie);
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    const response = await call("/passkey/delete-passkey", {
      cookie,
      body: { id: listed!.id },
    });

    expect(response.status).toBe(403);
    expect(await passkeys(cookie)).toHaveLength(1);
  });
});

describe("renaming a passkey", () => {
  it("is not offered", async () => {
    const { cookie } = await student("renames");
    await addPasskey(cookie, new Authenticator());
    const [listed] = await passkeys(cookie);
    const response = await call("/passkey/update-passkey", {
      cookie,
      body: { id: listed!.id, name: "Renamed" },
    });

    expect(response.status).toBe(404);
    expect((await passkeys(cookie))[0]?.name).toBe("MacBook – Safari");
  });
});

describe("the passkey prompt", () => {
  it("remembers that the student does not want to be asked again", async () => {
    const { cookie } = await student("dismisses");
    expect(
      (
        await call("/update-user", {
          cookie,
          body: { passkeyPromptDismissed: true },
        })
      ).status,
    ).toBe(200);

    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableRefresh: true },
    });
    expect(session?.user).toMatchObject({ passkeyPromptDismissed: true });
  });
});
