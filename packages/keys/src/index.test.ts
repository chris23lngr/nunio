import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  connectionCredentialKeysFromEnv,
  createConnectionCredentialKeys,
  createSourceKeys,
  decryptSourceText,
  encryptSourceText,
} from "./index.js";

describe("Source keys", () => {
  it("generates independent keys and unwraps them after master-key rotation", () => {
    const v1 = randomBytes(32);
    const v2 = randomBytes(32);
    const first = createSourceKeys({
      activeVersion: "v1",
      masters: { v1 },
    }).generate("source-a");
    const rotated = createSourceKeys({
      activeVersion: "v2",
      masters: { v1, v2 },
    });
    const second = rotated.generate("source-b");
    expect(first.key).toHaveLength(32);
    expect(second.key).not.toEqual(first.key);
    expect(rotated.unwrap("source-a", first.wrapped)).toEqual(first.key);
    expect(rotated.unwrap("source-b", second.wrapped)).toEqual(second.key);
    expect(() => rotated.unwrap("source-b", first.wrapped)).toThrow();
    expect(() =>
      rotated.unwrap("source-a", { ...first.wrapped, version: "v2" }),
    ).toThrow();
    expect(() =>
      createSourceKeys({ activeVersion: "v2", masters: { v2 } }).unwrap(
        "source-a",
        first.wrapped,
      ),
    ).toThrow();
  });

  it("encrypts German chunk text and refuses another Source, another key, or tampering", () => {
    const key = randomBytes(32);
    const text = "Prüfung am 12. März – Raum H1";
    const sealed = encryptSourceText(key, "source-a", text);
    expect(sealed.includes(Buffer.from(text))).toBe(false);
    expect(encryptSourceText(key, "source-a", text)).not.toEqual(sealed);
    expect(decryptSourceText(key, "source-a", sealed)).toBe(text);
    expect(() => decryptSourceText(key, "source-b", sealed)).toThrow();
    expect(() =>
      decryptSourceText(randomBytes(32), "source-a", sealed),
    ).toThrow();
    sealed[sealed.length - 1] = sealed[sealed.length - 1]! ^ 1;
    expect(() => decryptSourceText(key, "source-a", sealed)).toThrow();
  });
});

describe("Connection content keys", () => {
  it("wraps a Connection's key under the Source master key, bound to that Connection", () => {
    const v1 = randomBytes(32);
    const keys = createSourceKeys({ activeVersion: "v1", masters: { v1 } });
    const { key, wrapped } = keys.generateConnectionKey("connection-a");
    expect(key).toHaveLength(32);
    expect(wrapped.version).toBe("v1");
    expect(
      createSourceKeys({
        activeVersion: "v2",
        masters: { v1, v2: randomBytes(32) },
      }).unwrapConnectionKey("connection-a", wrapped),
    ).toEqual(key);
    expect(() => keys.unwrapConnectionKey("connection-b", wrapped)).toThrow();
    // A Source key and a Connection key are never interchangeable, even under the same ID.
    expect(() => keys.unwrap("connection-a", wrapped)).toThrow();
    const source = keys.generate("connection-a");
    expect(() =>
      keys.unwrapConnectionKey("connection-a", source.wrapped),
    ).toThrow();
  });
});

describe("Connection credentials", () => {
  const credentials = '{"username":"jschuh","password":"Prüfung-2026!"}';

  it("round-trips credentials and opens them after master-key rotation", () => {
    const v1 = randomBytes(32);
    const sealed = createConnectionCredentialKeys({
      activeVersion: "v1",
      masters: { v1 },
    }).seal("connection-a", credentials);
    expect(sealed.version).toBe("v1");
    expect(Buffer.from(sealed.ciphertext, "base64").includes(credentials)).toBe(
      false,
    );
    const rotated = createConnectionCredentialKeys({
      activeVersion: "v2",
      masters: { v1, v2: randomBytes(32) },
    });
    expect(rotated.open("connection-a", sealed)).toBe(credentials);
    expect(rotated.seal("connection-a", credentials).version).toBe("v2");
  });

  it("refuses another Connection, a missing master key or tampering", () => {
    const keys = createConnectionCredentialKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    });
    const sealed = keys.seal("connection-a", credentials);
    expect(() => keys.open("connection-b", sealed)).toThrow();
    expect(() =>
      keys.open("connection-a", { ...sealed, version: "v2" }),
    ).toThrow();
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    expect(() =>
      keys.open("connection-a", {
        ...sealed,
        ciphertext: bytes.toString("base64"),
      }),
    ).toThrow();
    expect(() =>
      createConnectionCredentialKeys({ activeVersion: "v1", masters: {} }),
    ).toThrow();
  });

  it("reads its master keys from the environment, apart from the Source master keys", () => {
    const key = randomBytes(32).toString("base64");
    const keys = connectionCredentialKeysFromEnv({
      CONNECTION_CREDENTIAL_KEY_VERSION: "v1",
      CONNECTION_CREDENTIAL_MASTER_KEYS: JSON.stringify({ v1: key }),
    });
    expect(keys.open("c", keys.seal("c", credentials))).toBe(credentials);
    expect(() =>
      connectionCredentialKeysFromEnv({
        SOURCE_KEY_VERSION: "v1",
        SOURCE_MASTER_KEYS: JSON.stringify({ v1: key }),
      }),
    ).toThrow("Connection credential master keys are not configured");
  });
});
