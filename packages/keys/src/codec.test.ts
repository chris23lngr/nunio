import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { payloadCodecFromEnv } from "./codec.js";

const payload = { metadata: { encoding: new TextEncoder().encode("json/plain") }, data: new TextEncoder().encode('"Prüfung"') };

it("decodes payloads written before a codec key rotation and encodes under the current key", async () => {
  const v1 = randomBytes(32).toString("base64");
  const v2 = randomBytes(32).toString("base64");
  const before = payloadCodecFromEnv({ CODEC_KEY: v1, CODEC_KEY_VERSION: "v1" });
  const after = payloadCodecFromEnv({ CODEC_KEY: v2, CODEC_KEY_VERSION: "v2", CODEC_PREVIOUS_KEYS: JSON.stringify({ v1 }) });
  const [old] = await before.encode([payload]);
  const [current] = await after.encode([payload]);
  expect(new TextDecoder().decode(current!.metadata!["encryption-key-version"])).toBe("v2");
  const decoded = await after.decode([old!, current!]);
  expect(decoded.map(p => new TextDecoder().decode(p.data!))).toEqual(['"Prüfung"', '"Prüfung"']);
  await expect(before.decode([current!])).rejects.toThrow("no codec key for version v2");
});
