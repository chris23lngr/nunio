import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The version selects a master key; only this authenticated envelope is persisted (ADR-0007). */
export interface WrappedKey {
  version: string;
  ciphertext: string;
}

function seal(key: Buffer, context: string, plain: Uint8Array): Buffer {
  if (key.length !== 32) throw new Error("Encryption keys must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function open(key: Buffer, context: string, sealed: Uint8Array): Buffer {
  if (key.length !== 32 || sealed.length < 28)
    throw new Error("Invalid encryption envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(sealed.subarray(28)),
    decipher.final(),
  ]);
}

/** Selects a versioned 32-byte master key; throws when the version is not configured. */
function masterKeys(
  name: string,
  activeVersion: string,
  masters: Readonly<Record<string, Buffer>>,
) {
  const master = (version: string) => {
    const key = Object.hasOwn(masters, version) ? masters[version] : undefined;
    if (!key || key.length !== 32)
      throw new Error(`No 32-byte ${name} master key for version ${version}`);
    return key;
  };
  master(activeVersion);
  return master;
}

export function createSourceKeys({
  activeVersion,
  masters,
}: {
  activeVersion: string;
  masters: Readonly<Record<string, Buffer>>;
}) {
  const master = masterKeys("Source", activeVersion, masters);
  const generate = (purpose: string, id: string) => {
    const key = randomBytes(32);
    const ciphertext = seal(
      master(activeVersion),
      JSON.stringify([purpose, id, activeVersion]),
      key,
    );
    return {
      key,
      wrapped: {
        version: activeVersion,
        ciphertext: ciphertext.toString("base64"),
      },
    };
  };
  const unwrap = (purpose: string, id: string, wrapped: WrappedKey) => {
    const key = open(
      master(wrapped.version),
      JSON.stringify([purpose, id, wrapped.version]),
      Buffer.from(wrapped.ciphertext, "base64"),
    );
    if (key.length !== 32) throw new Error("Invalid data key");
    return key;
  };
  return {
    generate(sourceId: string): { key: Buffer; wrapped: WrappedKey } {
      return generate("source-key", sourceId);
    },
    unwrap(sourceId: string, wrapped: WrappedKey): Buffer {
      return unwrap("source-key", sourceId, wrapped);
    },
    /** A Connection's content key, wrapped like a Source key; deleting it shreds what was sealed under it (#266). */
    generateConnectionKey(connectionId: string): {
      key: Buffer;
      wrapped: WrappedKey;
    } {
      return generate("connection-key", connectionId);
    },
    unwrapConnectionKey(connectionId: string, wrapped: WrappedKey): Buffer {
      return unwrap("connection-key", connectionId, wrapped);
    },
  };
}

export type SourceKeys = ReturnType<typeof createSourceKeys>;

/** Source ID and purpose are authenticated, preventing envelopes being moved between Sources. */
export function encryptSourceText(
  key: Buffer,
  sourceId: string,
  text: string,
): Buffer {
  return seal(
    key,
    JSON.stringify(["source-text", sourceId]),
    Buffer.from(text),
  );
}

export function decryptSourceText(
  key: Buffer,
  sourceId: string,
  ciphertext: Uint8Array,
): string {
  return open(
    key,
    JSON.stringify(["source-text", sourceId]),
    ciphertext,
  ).toString("utf8");
}

/** Text derived from Sources, such as a Chat answer, under its own data key; the owning record's ID and purpose are authenticated. */
export function encryptDerivedText(
  key: Buffer,
  recordId: string,
  text: string,
): Buffer {
  return seal(
    key,
    JSON.stringify(["derived-text", recordId]),
    Buffer.from(text),
  );
}

export function decryptDerivedText(
  key: Buffer,
  recordId: string,
  ciphertext: Uint8Array,
): string {
  return open(
    key,
    JSON.stringify(["derived-text", recordId]),
    ciphertext,
  ).toString("utf8");
}

/** Wraps a derived text's data key under one Source's key, so deleting that Source shreds it (ADR-0007). */
export function wrapUnderSource(
  sourceKey: Buffer,
  sourceId: string,
  data: Uint8Array,
): Buffer {
  return seal(
    sourceKey,
    JSON.stringify(["derived-key", sourceId]),
    Buffer.from(data),
  );
}

export function unwrapUnderSource(
  sourceKey: Buffer,
  sourceId: string,
  wrapped: Uint8Array,
): Buffer {
  return open(sourceKey, JSON.stringify(["derived-key", sourceId]), wrapped);
}

/** A JSON object mapping version IDs to base64 master keys, as the platform secret holds it. */
function mastersFrom(name: string, json: string): Record<string, Buffer> {
  let values: Record<string, string>;
  try {
    values = JSON.parse(json);
  } catch {
    throw new Error(`Invalid ${name} master key configuration`);
  }
  return Object.fromEntries(
    Object.entries(values).map(([version, key]) => [
      version,
      Buffer.from(key, "base64"),
    ]),
  );
}

export function sourceKeysFromEnv(env: NodeJS.ProcessEnv): SourceKeys {
  if (!env.SOURCE_KEY_VERSION || !env.SOURCE_MASTER_KEYS)
    throw new Error("Source master keys are not configured");
  return createSourceKeys({
    activeVersion: env.SOURCE_KEY_VERSION,
    masters: mastersFrom("Source", env.SOURCE_MASTER_KEYS),
  });
}

/** Credentials sealed under a versioned "connection credentials" master key. */
export interface SealedCredentials {
  version: string;
  ciphertext: string;
}

/**
 * Seals a Connection's credentials (a mailbox password, OAuth tokens) directly under the "connection credentials"
 * master key, with no per-Connection data key (ADR-0007 amendment). The Connection's ID is authenticated, so sealed
 * credentials can't be moved to another Connection.
 */
export function createConnectionCredentialKeys({
  activeVersion,
  masters,
}: {
  activeVersion: string;
  masters: Readonly<Record<string, Buffer>>;
}) {
  const master = masterKeys("Connection credential", activeVersion, masters);
  const context = (connectionId: string, version: string) =>
    JSON.stringify(["connection-credentials", connectionId, version]);
  return {
    seal(connectionId: string, credentials: string): SealedCredentials {
      return {
        version: activeVersion,
        ciphertext: seal(
          master(activeVersion),
          context(connectionId, activeVersion),
          Buffer.from(credentials),
        ).toString("base64"),
      };
    },
    open(connectionId: string, sealed: SealedCredentials): string {
      return open(
        master(sealed.version),
        context(connectionId, sealed.version),
        Buffer.from(sealed.ciphertext, "base64"),
      ).toString("utf8");
    },
  };
}

export type ConnectionCredentialKeys = ReturnType<
  typeof createConnectionCredentialKeys
>;

export function connectionCredentialKeysFromEnv(
  env: NodeJS.ProcessEnv,
): ConnectionCredentialKeys {
  if (
    !env.CONNECTION_CREDENTIAL_KEY_VERSION ||
    !env.CONNECTION_CREDENTIAL_MASTER_KEYS
  )
    throw new Error("Connection credential master keys are not configured");
  return createConnectionCredentialKeys({
    activeVersion: env.CONNECTION_CREDENTIAL_KEY_VERSION,
    masters: mastersFrom(
      "Connection credential",
      env.CONNECTION_CREDENTIAL_MASTER_KEYS,
    ),
  });
}
export { createPayloadCodec, payloadCodecFromEnv } from "./codec.js";
