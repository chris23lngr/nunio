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
const fromUtf8 = (bytes: Uint8Array | null | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);

export function createPayloadCodec({ key, keyVersion }: { key: Buffer; keyVersion: string }): PayloadCodec {
  if (key.length !== 32) throw new Error("the codec key must be 32 bytes");

  const encrypt = (plain: Uint8Array) => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([iv, sealed, cipher.getAuthTag()]);
  };

  const decrypt = (data: Uint8Array) => {
    const iv = data.subarray(0, IV_BYTES);
    const tag = data.subarray(data.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data.subarray(IV_BYTES, data.length - TAG_BYTES)), decipher.final()]);
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
        if (version !== keyVersion) throw new Error(`no codec key for version ${version}`);
        return PayloadProto.decode(decrypt(payload.data ?? new Uint8Array()));
      });
    },
  };
}
