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
  if (key.length !== 32 || sealed.length < 28) throw new Error("Invalid encryption envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

export function createSourceKeys({ activeVersion, masters }: {
  activeVersion: string;
  masters: Readonly<Record<string, Buffer>>;
}) {
  const master = (version: string) => {
    const key = Object.hasOwn(masters, version) ? masters[version] : undefined;
    if (!key || key.length !== 32) throw new Error(`No 32-byte Source master key for version ${version}`);
    return key;
  };
  master(activeVersion);
  return {
    generate(sourceId: string): { key: Buffer; wrapped: WrappedKey } {
      const key = randomBytes(32);
      const ciphertext = seal(master(activeVersion), JSON.stringify(["source-key", sourceId, activeVersion]), key);
      return { key, wrapped: { version: activeVersion, ciphertext: ciphertext.toString("base64") } };
    },
    unwrap(sourceId: string, wrapped: WrappedKey): Buffer {
      const key = open(master(wrapped.version), JSON.stringify(["source-key", sourceId, wrapped.version]),
        Buffer.from(wrapped.ciphertext, "base64"));
      if (key.length !== 32) throw new Error("Invalid Source key");
      return key;
    },
  };
}

export type SourceKeys = ReturnType<typeof createSourceKeys>;

/** Source ID and purpose are authenticated, preventing envelopes being moved between Sources. */
export function encryptSourceText(key: Buffer, sourceId: string, text: string): Buffer {
  return seal(key, JSON.stringify(["source-text", sourceId]), Buffer.from(text));
}

export function decryptSourceText(key: Buffer, sourceId: string, ciphertext: Uint8Array): string {
  return open(key, JSON.stringify(["source-text", sourceId]), ciphertext).toString("utf8");
}

export function sourceKeysFromEnv(env: NodeJS.ProcessEnv): SourceKeys {
  if (!env.SOURCE_KEY_VERSION || !env.SOURCE_MASTER_KEYS) throw new Error("Source master keys are not configured");
  let values: Record<string, string>;
  try { values = JSON.parse(env.SOURCE_MASTER_KEYS); }
  catch { throw new Error("Invalid Source master key configuration"); }
  const masters: Record<string, Buffer> = Object.fromEntries(Object.entries(values).map(([version, key]) => [version, Buffer.from(key, "base64")]));
  return createSourceKeys({ activeVersion: env.SOURCE_KEY_VERSION, masters });
}
export { createPayloadCodec, payloadCodecFromEnv } from "./codec.js";
