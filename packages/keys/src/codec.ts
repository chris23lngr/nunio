// Payload Codec (ADR-0004, ADR-0007): Temporal stores only ciphertext. AES-256-GCM under a master
// key whose version travels with every payload, so keys can be rotated incrementally.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Payload, PayloadCodec } from "@temporalio/common";
import proto from "@temporalio/proto";

const { Payload: PayloadProto } = proto.temporal.api.common.v1;

const ENCODING = "binary/encrypted";
const KEY_VERSION = "encryption-key-version";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const utf8 = (text: string) => new TextEncoder().encode(text);
const fromUtf8 = (bytes: Uint8Array | null | undefined) =>
  bytes ? new TextDecoder().decode(bytes) : undefined;

// Encodes under the current key; decodes under any configured version so rotation keeps old histories readable.
export function createPayloadCodec({
  key,
  keyVersion,
  previousKeys = {},
}: {
  key: Buffer;
  keyVersion: string;
  previousKeys?: Readonly<Record<string, Buffer>>;
}): PayloadCodec {
  const keys: Record<string, Buffer> = { ...previousKeys, [keyVersion]: key };
  if (Object.values(keys).some((k) => k.length !== 32))
    throw new Error("the codec key must be 32 bytes");

  const encrypt = (plain: Uint8Array) => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, sealed, cipher.getAuthTag()]);
  };

  const decrypt = (key: Buffer, data: Uint8Array) => {
    const iv = data.subarray(0, IV_BYTES);
    const tag = data.subarray(data.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(data.subarray(IV_BYTES, data.length - TAG_BYTES)),
      decipher.final(),
    ]);
  };

  return {
    async encode(payloads: Payload[]) {
      return payloads.map((payload) => ({
        metadata: { encoding: utf8(ENCODING), [KEY_VERSION]: utf8(keyVersion) },
        data: encrypt(PayloadProto.encode(payload).finish()),
      }));
    },
    async decode(payloads: Payload[]) {
      return payloads.map((payload) => {
        if (fromUtf8(payload.metadata?.encoding) !== ENCODING) return payload;
        const version = fromUtf8(payload.metadata?.[KEY_VERSION]);
        const versionKey =
          version !== undefined && Object.hasOwn(keys, version)
            ? keys[version]
            : undefined;
        if (!versionKey) throw new Error(`no codec key for version ${version}`);
        return PayloadProto.decode(
          decrypt(versionKey, payload.data ?? new Uint8Array()),
        );
      });
    },
  };
}

/** CODEC_KEY/CODEC_KEY_VERSION encode; optional CODEC_PREVIOUS_KEYS ({"version":"base64"}) still decode. */
export function payloadCodecFromEnv(env: NodeJS.ProcessEnv): PayloadCodec {
  if (!env.CODEC_KEY || !env.CODEC_KEY_VERSION)
    throw new Error("the codec key is not configured");
  let previous: Record<string, string>;
  try {
    previous = JSON.parse(env.CODEC_PREVIOUS_KEYS ?? "{}");
  } catch {
    throw new Error("invalid codec key configuration");
  }
  return createPayloadCodec({
    key: Buffer.from(env.CODEC_KEY, "base64"),
    keyVersion: env.CODEC_KEY_VERSION,
    previousKeys: Object.fromEntries(
      Object.entries(previous).map(([version, key]) => [
        version,
        Buffer.from(key, "base64"),
      ]),
    ),
  });
}
