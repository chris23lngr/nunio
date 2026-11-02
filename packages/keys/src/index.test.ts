import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSourceKeys, decryptSourceText, encryptSourceText } from "./index.js";

describe("Source keys", () => {
  it("generates independent keys and unwraps them after master-key rotation", () => {
    const v1 = randomBytes(32);
    const v2 = randomBytes(32);
    const first = createSourceKeys({ activeVersion: "v1", masters: { v1 } }).generate("source-a");
    const rotated = createSourceKeys({ activeVersion: "v2", masters: { v1, v2 } });
    const second = rotated.generate("source-b");
    expect(first.key).toHaveLength(32);
    expect(second.key).not.toEqual(first.key);
    expect(rotated.unwrap("source-a", first.wrapped)).toEqual(first.key);
    expect(rotated.unwrap("source-b", second.wrapped)).toEqual(second.key);
    expect(() => rotated.unwrap("source-b", first.wrapped)).toThrow();
    expect(() => rotated.unwrap("source-a", { ...first.wrapped, version: "v2" })).toThrow();
    expect(() => createSourceKeys({ activeVersion: "v2", masters: { v2 } }).unwrap("source-a", first.wrapped)).toThrow();
  });

  it("encrypts German chunk text and refuses another Source, another key, or tampering", () => {
    const key = randomBytes(32);
    const text = "Prüfung am 12. März – Raum H1";
    const sealed = encryptSourceText(key, "source-a", text);
    expect(sealed.includes(Buffer.from(text))).toBe(false);
    expect(encryptSourceText(key, "source-a", text)).not.toEqual(sealed);
    expect(decryptSourceText(key, "source-a", sealed)).toBe(text);
    expect(() => decryptSourceText(key, "source-b", sealed)).toThrow();
    expect(() => decryptSourceText(randomBytes(32), "source-a", sealed)).toThrow();
    sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 1;
    expect(() => decryptSourceText(key, "source-a", sealed)).toThrow();
  });
});
